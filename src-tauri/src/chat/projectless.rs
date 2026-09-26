//! App-owned working directories for ordinary conversations without a chosen project.
use super::database::{validate_project_path, ChatRepository, ChatScope};
use super::error::{map_sqlite_error, ChatError};
use super::migrations;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn present(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map(|version| version >= migrations::PROJECTLESS_SCHEMA_VERSION)
        .map_err(map_sqlite_error)
}

pub(super) fn project_projection(db: &Connection) -> Result<&'static str, ChatError> {
    Ok(if present(db)? {
        "CASE WHEN p.workspace_source='managed_chat' THEN NULL ELSE s.project_id END"
    } else {
        "s.project_id"
    })
}

pub(super) fn require_chat_project(
    db: &Connection,
    scope: &ChatScope,
    project: &str,
) -> Result<(), ChatError> {
    if present(db)? {
        let managed: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND workspace_source='managed_chat' AND removed_at IS NULL)",
            params![project, scope.owner_user_id, scope.tenant_id], |row| row.get(0),
        ).map_err(map_sqlite_error)?;
        if managed {
            return Ok(());
        }
    }
    super::schedules::workspace::require_user(db, scope, project)
}

fn resource_id(scope: &ChatScope, operation: Uuid) -> Uuid {
    let digest = Sha256::digest(format!(
        "projectless-chat-v1\0{}\0{}\0{operation}",
        scope.owner_user_id, scope.tenant_id,
    ));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 15) | 0x80;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Uuid::from_bytes(bytes)
}

fn directory(
    root: &Path,
    scope: &ChatScope,
    resource: &str,
    create: bool,
) -> Result<PathBuf, ChatError> {
    for id in [&scope.owner_user_id, &scope.tenant_id, resource] {
        let parsed = Uuid::parse_str(id).map_err(|_| ChatError::InvalidInput)?;
        if parsed.is_nil() || parsed.to_string() != *id {
            return Err(ChatError::InvalidInput);
        }
    }
    let mut path = validate_project_path(root)?;
    for component in [
        "chat-workspaces",
        &scope.tenant_id,
        &scope.owner_user_id,
        resource,
    ] {
        path.push(component);
        if create {
            match std::fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ChatError::ProjectUnavailable),
            }
        }
        if validate_project_path(&path)? != path {
            return Err(ChatError::ProjectUnavailable);
        }
    }
    Ok(path)
}

fn path_hash(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()))
}

impl ChatRepository {
    pub(super) fn ensure_projectless_workspace(
        &mut self,
        operation: Uuid,
    ) -> Result<Uuid, ChatError> {
        if operation.is_nil() {
            return Err(ChatError::InvalidInput);
        }
        super::schedules::execution_guard::foreground(&self.connection)?;
        migrations::migrate_to_target(
            &mut self.connection,
            migrations::PROJECTLESS_SCHEMA_VERSION,
        )?;
        let resource = resource_id(&self.scope, operation);
        let id = resource.to_string();
        let root = self
            .database_path
            .parent()
            .ok_or(ChatError::DatabaseUnavailable)?;
        let path = directory(root, &self.scope, &id, true)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .as_secs() as i64;
        self.connection.execute(
            "INSERT OR IGNORE INTO chat_projects(id,owner_user_id,tenant_id,safe_name,canonical_hash,bookmark_ref,last_used_at,workspace_source,managed_resource_id) VALUES(?1,?2,?3,'任务工作区',?4,NULL,?5,'managed_chat',?1)",
            params![id, self.scope.owner_user_id, self.scope.tenant_id, path_hash(&path), now],
        ).map_err(map_sqlite_error)?;
        if self.resolve_projectless_workspace(&id)?.as_ref() != Some(&path) {
            return Err(ChatError::ProjectUnavailable);
        }
        Ok(resource)
    }

    pub(super) fn resolve_projectless_workspace(
        &self,
        project: &str,
    ) -> Result<Option<PathBuf>, ChatError> {
        if !present(&self.connection)? {
            return Ok(None);
        }
        let row: Option<(String, String)> = self.connection.query_row(
            "SELECT managed_resource_id,canonical_hash FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND workspace_source='managed_chat' AND removed_at IS NULL",
            params![project, self.scope.owner_user_id, self.scope.tenant_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(map_sqlite_error)?;
        let Some((resource, hash)) = row else {
            return Ok(None);
        };
        let root = self
            .database_path
            .parent()
            .ok_or(ChatError::DatabaseUnavailable)?;
        let path = directory(root, &self.scope, &resource, false)?;
        if path_hash(&path) != hash {
            return Err(ChatError::ProjectUnavailable);
        }
        Ok(Some(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::database::DraftContentBlock;
    use crate::chat::keychain::{DatabaseKey, ReceiptKey};

    fn open(root: &Path, scope: ChatScope) -> ChatRepository {
        ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([71; 32]),
            ReceiptKey::from_bytes([72; 32]),
            scope,
        )
        .unwrap()
    }

    #[test]
    fn projectless_history_and_workspace_survive_reopen_without_entering_project_picker() {
        let root = std::env::temp_dir().join(format!("projectless-chat-{}", Uuid::now_v7()));
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = open(&root, scope.clone());
        let selected_path = root.join("selected");
        std::fs::create_dir(&selected_path).unwrap();
        let selected = repo
            .register_project(&selected_path, b"synthetic-bookmark")
            .unwrap();
        let selected_id = Uuid::parse_str(&selected.id).unwrap();
        let old = repo
            .create_session_and_enqueue(selected_id, "已有项目任务", Uuid::now_v7())
            .unwrap();

        let operation = Uuid::now_v7();
        let project = repo.ensure_projectless_workspace(operation).unwrap();
        assert_eq!(
            repo.schema_version().unwrap(),
            migrations::PROJECTLESS_SCHEMA_VERSION
        );
        assert_eq!(
            repo.ensure_projectless_workspace(operation).unwrap(),
            project
        );
        let created = repo
            .create_session_and_enqueue(project, "无项目任务", operation)
            .unwrap();
        assert_eq!(
            repo.create_session_and_enqueue(project, "无项目任务", operation)
                .unwrap()
                .session_id,
            created.session_id
        );
        let directory = repo.resolve_schedule_project(&project.to_string()).unwrap();
        assert!(directory.starts_with(
            std::fs::canonicalize(root.join("chat"))
                .unwrap()
                .join("chat-workspaces")
        ));
        std::fs::write(directory.join("result.txt"), "normal task output").unwrap();
        assert_eq!(repo.list_projects().unwrap(), vec![selected.clone()]);
        assert_eq!(
            repo.session_summary(old.session_id).unwrap().project_id,
            Some(selected_id)
        );
        let summary = repo.session_summary(created.session_id).unwrap();
        assert_eq!(summary.project_id, None);
        assert!(summary.project_available);
        assert_eq!(
            repo.load_history(created.session_id, None, None)
                .unwrap()
                .turns[0]
                .messages[0]
                .content,
            "无项目任务"
        );
        repo.rename_session(created.session_id, "重命名无项目任务")
            .unwrap();
        repo.set_session_pinned(created.session_id, true, 1)
            .unwrap();
        drop(repo);

        let reopened = open(&root, scope);
        assert_eq!(
            reopened.schema_version().unwrap(),
            migrations::PROJECTLESS_SCHEMA_VERSION
        );
        let summary = reopened
            .list_sessions(None, None)
            .unwrap()
            .sessions
            .into_iter()
            .find(|s| s.session_id == created.session_id)
            .unwrap();
        assert_eq!(summary.project_id, None);
        assert_eq!(summary.title, "重命名无项目任务");
        assert!(summary.pinned_at.is_some());
        assert_eq!(
            std::fs::read_to_string(
                reopened
                    .resolve_schedule_project(&project.to_string())
                    .unwrap()
                    .join("result.txt")
            )
            .unwrap(),
            "normal task output"
        );
        assert_eq!(reopened.list_projects().unwrap(), vec![selected]);
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projectless_multimodal_creation_retries_and_separate_tasks_keep_distinct_workspaces() {
        let root = std::env::temp_dir().join(format!("projectless-chat-{}", Uuid::now_v7()));
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let mut repo = open(&root, scope);
        let operation = Uuid::now_v7();
        let project = repo.ensure_projectless_workspace(operation).unwrap();
        let blocks = [DraftContentBlock::Text("普通无项目消息".into())];
        let created = repo
            .create_session_and_enqueue_multimodal(project, &blocks, operation, 1)
            .unwrap();
        assert_eq!(
            repo.create_session_and_enqueue_multimodal(project, &blocks, operation, 1)
                .unwrap()
                .session_id,
            created.session_id
        );
        let other = repo.ensure_projectless_workspace(Uuid::now_v7()).unwrap();
        assert_ne!(project, other);
        assert_ne!(
            repo.resolve_schedule_project(&project.to_string()).unwrap(),
            repo.resolve_schedule_project(&other.to_string()).unwrap()
        );
        assert_eq!(repo.list_sessions(None, None).unwrap().sessions.len(), 1);
        assert_eq!(
            repo.session_summary(created.session_id).unwrap().project_id,
            None
        );
        assert!(repo.list_projects().unwrap().is_empty());
        drop(repo);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn projectless_application_accepts_both_creation_routes_with_no_project() {
        use crate::chat::application::ConversationApplication;
        use crate::chat::keychain::{DatabaseKeyStore, ReceiptKeyStore};
        use crate::chat::worker::DatabaseWorker;
        struct Keys;
        impl DatabaseKeyStore for Keys {
            fn load_or_create(&self, _: bool) -> Result<DatabaseKey, ChatError> {
                Ok(DatabaseKey::from_bytes([71; 32]))
            }
        }
        impl ReceiptKeyStore for Keys {
            fn load_or_create(&self, _: bool) -> Result<ReceiptKey, ChatError> {
                Ok(ReceiptKey::from_bytes([72; 32]))
            }
        }
        let root = std::env::temp_dir().join(format!("projectless-application-{}", Uuid::now_v7()));
        let scope = ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
        let worker = DatabaseWorker::start_with_schedule_storage(
            root.join("chat"),
            scope,
            Box::new(Keys),
            Box::new(Keys),
            crate::chat::schedules::ScheduleStorageMode::TimingFoundation,
        )
        .unwrap();
        let app = ConversationApplication::new_offline(worker.clone());
        let text = app
            .create_local_session(None, "无项目文本任务".into(), Uuid::now_v7(), 1)
            .await
            .unwrap();
        let blocks = app
            .create_local_session_multimodal(
                None,
                vec![DraftContentBlock::Text("无项目内容块任务".into())],
                Uuid::now_v7(),
                1,
            )
            .await
            .unwrap();
        worker
            .call(move |repo| {
                assert_eq!(
                    repo.schema_version()?,
                    migrations::PROJECTLESS_SCHEMA_VERSION
                );
                assert!(repo.list_projects()?.is_empty());
                assert_eq!(repo.session_summary(text.session_id)?.project_id, None);
                assert_eq!(repo.session_summary(blocks.session_id)?.project_id, None);
                assert_eq!(
                    repo.load_history(text.session_id, None, None)?.turns.len(),
                    1
                );
                assert_eq!(
                    repo.load_history(blocks.session_id, None, None)?
                        .turns
                        .len(),
                    1
                );
                Ok(())
            })
            .await
            .unwrap();
        drop(app);
        drop(worker);
        std::fs::remove_dir_all(root).unwrap();
    }
}
