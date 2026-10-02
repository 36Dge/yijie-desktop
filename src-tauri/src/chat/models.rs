//! FEAT-156 native model authority. Selection and accepted outbox snapshots are
//! different records; a later UI selection never changes an accepted request.
use super::database::{
    ChatRepository, ConversationEnqueueContext, DraftContentBlock, PendingConversation,
};
use super::error::ChatError;
use super::models_generated as wire;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn enabled() -> bool {
    std::env::var("YIJIE_ENV").as_deref() == Ok("local")
        && std::env::var("YIJIE_LOCAL_PROFILE").as_deref() == Ok("demo_fast")
        && std::env::var("YIJIE_CHAT_MODELS_ENABLED").as_deref() == Ok("true")
}
pub fn profile_id(p: wire::ProfileId) -> &'static str {
    match p {
        wire::ProfileId::KimiK3MaxV1 => "kimi-k3-max-v1",
        wire::ProfileId::MinimaxM3HighV1 => "minimax-m3-high-v1",
    }
}
pub fn valid_profile(p: &str) -> bool {
    matches!(p, "kimi-k3-max-v1" | "minimax-m3-high-v1")
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelIntent {
    pub profile_id: wire::ProfileId,
    pub expected_revision: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    pub profile_id: Option<String>,
    pub revision: i64,
    pub state: String,
    pub pending: Option<PendingModelSelection>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingModelSelection {
    pub operation_id: String,
    pub profile_id: String,
    pub expected_revision: i64,
}
#[derive(Debug)]
pub struct ModelSubmission {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub turn_operation_id: Uuid,
}
fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
pub(super) fn table(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_model_selections')",[],|r|r.get(0)).map_err(db_error)
}
fn operation(db: &Connection, id: Uuid) -> Result<Option<(String, i64)>, ChatError> {
    db.query_row(
        "SELECT profile_id,revision FROM chat_operation_models WHERE operation_id=?1",
        [id.to_string()],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(db_error)
}
pub(super) fn freeze(
    db: &Connection,
    id: Uuid,
    session: Uuid,
    intent: &ModelIntent,
) -> Result<(), ChatError> {
    db.execute("INSERT INTO chat_operation_models(operation_id,session_id,profile_id,revision) VALUES(?1,?2,?3,?4) ON CONFLICT(operation_id) DO NOTHING",params![id.to_string(),session.to_string(),profile_id(intent.profile_id),intent.expected_revision]).map_err(db_error)?;
    Ok(())
}
impl ChatRepository {
    fn require_model_storage(&self) -> Result<(), ChatError> {
        if !table(&self.connection)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(())
    }
    pub(super) fn model_state(&self, session: Uuid) -> Result<ModelState, ChatError> {
        self.require_model_storage()?;
        self.agent_session_id_for_session_optional_model(session)?;
        Ok(self
            .connection
            .query_row(
                "SELECT profile_id,revision,state,operation_id,requested_profile_id,expected_revision FROM chat_model_selections WHERE session_id=?1",
                [session.to_string()],
                |r| {
                    Ok(ModelState {
                        profile_id: Some(r.get(0)?),
                        revision: r.get(1)?,
                        state: r.get(2)?,
                        pending: match (r.get::<_,Option<String>>(3)?, r.get::<_,Option<String>>(4)?,r.get::<_,Option<i64>>(5)?) {
                            (Some(operation_id),Some(profile_id),Some(expected_revision)) if r.get::<_,String>(2)? != "ready" => Some(PendingModelSelection{operation_id,profile_id,expected_revision}),
                            _ => None,
                        },
                    })
                },
            )
            .optional()
            .map_err(db_error)?
            .unwrap_or(ModelState {
                profile_id: None,
                revision: 0,
                state: "unknown".into(),
                pending: None,
            }))
    }
    pub(super) fn agent_session_id_for_session_optional_model(
        &self,
        session: Uuid,
    ) -> Result<Option<Uuid>, ChatError> {
        let id:Option<Option<String>>=self.connection.query_row("SELECT agent_session_id FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![session.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db_error)?;
        id.ok_or(ChatError::NotFound)?
            .map(|s| Uuid::parse_str(&s).map_err(|_| ChatError::DatabaseUnavailable))
            .transpose()
    }
    pub(super) fn resume_model_profile(&self, session: Uuid) -> Result<Option<String>, ChatError> {
        if !table(&self.connection)? {
            return Ok(None);
        }
        let state = self.model_state(session)?;
        if state.profile_id.is_some() && (state.state != "ready" || !enabled()) {
            return Err(ChatError::ConversationConflict);
        }
        Ok(state.profile_id)
    }
    pub(super) fn model_operation_profile(&self, id: Uuid) -> Result<Option<String>, ChatError> {
        if !table(&self.connection)? {
            return Ok(None);
        }
        let value:Option<String>=self.connection.query_row("SELECT m.profile_id FROM chat_operation_models m JOIN chat_sessions s ON s.id=m.session_id WHERE m.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",params![id.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).optional().map_err(db_error)?;
        if value.as_ref().is_some_and(|p| !valid_profile(p)) {
            return Err(ChatError::ConversationConflict);
        }
        Ok(value)
    }
    pub(super) fn create_model_session(
        &mut self,
        project: Option<Uuid>,
        blocks: Vec<DraftContentBlock>,
        op: Uuid,
        revision: u64,
        intent: ModelIntent,
    ) -> Result<PendingConversation, ChatError> {
        self.require_model_storage()?;
        super::database::validate_draft_blocks(&blocks)?;
        if op.is_nil() || revision == 0 || intent.expected_revision != 0 {
            return Err(ChatError::InvalidInput);
        }
        let project = match project {
            Some(p) => p,
            None => self.ensure_projectless_workspace(op)?,
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ChatError::InvalidInput)?
            .as_secs() as i64;
        let tx = self.connection.transaction().map_err(db_error)?;
        if let Some((id, _)) = operation(&tx, op)? {
            if id != profile_id(intent.profile_id) {
                return Err(ChatError::ConversationConflict);
            }
        }
        let result = Self::create_session_and_enqueue_in_transaction(
            &tx,
            ConversationEnqueueContext {
                scope: &self.scope,
                now,
                scheduled: None,
                draft: false,
            },
            project,
            &blocks,
            op,
            revision,
        )?;
        tx.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,?2,1,'ready') ON CONFLICT(session_id) DO NOTHING",params![result.session_id.to_string(),profile_id(intent.profile_id)]).map_err(db_error)?;
        freeze(&tx, result.create_operation_id, result.session_id, &intent)?;
        freeze(&tx, result.turn_operation_id, result.session_id, &intent)?;
        tx.commit().map_err(db_error)?;
        Ok(result)
    }
    pub(super) fn enqueue_model_turn(
        &mut self,
        session: Uuid,
        blocks: Vec<DraftContentBlock>,
        op: Uuid,
        intent: ModelIntent,
    ) -> Result<Uuid, ChatError> {
        self.require_model_storage()?;
        self.agent_session_id_for_session_optional_model(session)?;
        super::database::validate_draft_blocks(&blocks)?;
        if session.is_nil() || op.is_nil() || intent.expected_revision < 0 {
            return Err(ChatError::InvalidInput);
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| ChatError::InvalidInput)?
            .as_secs() as i64;
        let tx = self.connection.transaction().map_err(db_error)?;
        if let Some((id, rev)) = operation(&tx, op)? {
            if id != profile_id(intent.profile_id) || rev != intent.expected_revision {
                return Err(ChatError::ConversationConflict);
            }
        } else {
            let accepted:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_model_selections WHERE session_id=?1 AND profile_id=?2 AND revision=?3 AND state='ready')",params![session.to_string(),profile_id(intent.profile_id),intent.expected_revision],|r|r.get(0)).map_err(db_error)?;
            if !accepted {
                return Err(ChatError::ConversationConflict);
            }
        }
        let turn = Self::enqueue_turn_in_transaction(
            &tx,
            ConversationEnqueueContext {
                scope: &self.scope,
                now,
                scheduled: None,
                draft: false,
            },
            session,
            &blocks,
            op,
        )?;
        freeze(&tx, op, session, &intent)?;
        tx.commit().map_err(db_error)?;
        Ok(turn)
    }
    pub(super) fn sync_model_selection(
        &mut self,
        session: Uuid,
        value: wire::Selection,
    ) -> Result<ModelState, ChatError> {
        self.require_model_storage()?;
        let host = self
            .agent_session_id_for_session_optional_model(session)?
            .ok_or(ChatError::ConversationConflict)?;
        if value.schema_version != 1
            || value.agent_session_id != host.to_string()
            || value.revision < 0
        {
            return Err(ChatError::ConversationConflict);
        }
        let Some(profile) = value.profile_id else {
            self.connection
                .execute(
                    "UPDATE chat_model_selections SET state='unknown' WHERE session_id=?1",
                    [session.to_string()],
                )
                .map_err(db_error)?;
            return self.model_state(session);
        };
        let state = match value.state {
            wire::SelectionState::Ready => "ready",
            wire::SelectionState::Switching => "switching",
            wire::SelectionState::Unknown => "unknown",
        };
        // A late observation cannot overwrite a newer selection.
        self.connection.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,?2,?3,?4) ON CONFLICT(session_id) DO UPDATE SET profile_id=excluded.profile_id,revision=excluded.revision,state=excluded.state WHERE excluded.revision>chat_model_selections.revision OR (excluded.revision=chat_model_selections.revision AND (chat_model_selections.state='ready' OR chat_model_selections.operation_id=?5))",params![session.to_string(),profile_id(profile),value.revision,state,value.operation_id]).map_err(db_error)?;
        self.model_state(session)
    }
}
impl ChatRepository {
    pub(super) fn begin_model_selection(
        &mut self,
        session: Uuid,
        intent: ModelIntent,
        op: Uuid,
    ) -> Result<Uuid, ChatError> {
        self.require_model_storage()?;
        let host = self
            .agent_session_id_for_session_optional_model(session)?
            .ok_or(ChatError::ConversationConflict)?;
        if op.is_nil() || intent.expected_revision < 0 {
            return Err(ChatError::InvalidInput);
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        super::schedules::execution_guard::foreground(&tx)?;
        let writable: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id AND p.owner_user_id=s.owner_user_id AND p.tenant_id=s.tenant_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id))",
            params![session.to_string(), self.scope.owner_user_id, self.scope.tenant_id], |row| row.get(0),
        ).map_err(db_error)?;
        if !writable {
            return Err(ChatError::ConversationConflict);
        }
        let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE session_id=?1 AND state IN ('pending','inflight'))",[session.to_string()],|r|r.get(0)).map_err(db_error)?;
        if busy {
            return Err(ChatError::ConversationConflict);
        }
        type PendingRow = (i64, String, Option<String>, Option<String>, Option<i64>);
        let previous:Option<PendingRow>=tx.query_row("SELECT revision,state,operation_id,requested_profile_id,expected_revision FROM chat_model_selections WHERE session_id=?1",[session.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(db_error)?;
        let Some((revision, state, operation, target, expected)) = previous else {
            return Err(ChatError::ConversationConflict);
        };
        let replay = operation.as_deref() == Some(op.to_string().as_str())
            && target.as_deref() == Some(profile_id(intent.profile_id))
            && expected == Some(intent.expected_revision);
        if !replay && (revision != intent.expected_revision || state != "ready") {
            return Err(ChatError::ConversationConflict);
        }
        tx.execute("UPDATE chat_model_selections SET state='switching',operation_id=?2,requested_profile_id=?3,expected_revision=?4 WHERE session_id=?1",params![session.to_string(),op.to_string(),profile_id(intent.profile_id),intent.expected_revision]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(host)
    }
    pub(super) fn model_selection_unknown(
        &mut self,
        session: Uuid,
        op: Uuid,
    ) -> Result<(), ChatError> {
        self.connection.execute("UPDATE chat_model_selections SET state='unknown' WHERE session_id=?1 AND operation_id=?2",params![session.to_string(),op.to_string()]).map_err(db_error)?;
        Ok(())
    }
}

// Called inside the same transaction that creates the outbox and plan/draft receipt.
pub(super) fn freeze_conversation(
    db: &Connection,
    session: Uuid,
    turn: Uuid,
    create: Option<Uuid>,
    intent: &ModelIntent,
) -> Result<(), ChatError> {
    if !table(db)? {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if let Some(create) = create {
        if intent.expected_revision != 0 {
            return Err(ChatError::ConversationConflict);
        }
        db.execute("INSERT INTO chat_model_selections(session_id,profile_id,revision,state) VALUES(?1,?2,1,'ready')",params![session.to_string(),profile_id(intent.profile_id)]).map_err(db_error)?;
        freeze(db, create, session, intent)?;
    } else {
        let state: Option<(String, i64, String)> = db
            .query_row(
                "SELECT profile_id,revision,state FROM chat_model_selections WHERE session_id=?1",
                [session.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(db_error)?;
        match state {
            Some((id, revision, state))
                if id == profile_id(intent.profile_id)
                    && revision == intent.expected_revision
                    && state == "ready" => {}
            None if intent.profile_id == wire::ProfileId::MinimaxM3HighV1
                && intent.expected_revision == 0 => {}
            _ => return Err(ChatError::ConversationConflict),
        }
    }
    freeze(db, turn, session, intent)
}

// A compatible rollback reader must leave model-aware outboxes untouched.
pub(super) fn dispatch_predicate(db: &Connection, alias: &str) -> Result<String, ChatError> {
    if enabled() || !table(db)? {
        return Ok("1=1".into());
    }
    Ok(format!("NOT EXISTS(SELECT 1 FROM chat_operation_models model WHERE model.operation_id={alias}.operation_id)"))
}

pub(super) fn require_writer(
    db: &Connection,
    session: Uuid,
    scope: &super::database::ChatScope,
) -> Result<(), ChatError> {
    if enabled() || !table(db)? {
        return Ok(());
    }
    let managed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_model_selections m JOIN chat_sessions s ON s.id=m.session_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3)",params![session.to_string(),scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(db_error)?;
    if managed {
        Err(ChatError::OrchestrationUnavailable)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::{
        database::ChatScope,
        keychain::{DatabaseKey, ReceiptKey},
    };
    #[test]
    fn feat156_model_outbox_freezes_profile_and_rejects_changed_retry() {
        let root = std::env::temp_dir().join(format!("feat156-model-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let mut repo = ChatRepository::open(
            &root.join("chat"),
            &DatabaseKey::from_bytes([156; 32]),
            ReceiptKey::from_bytes([157; 32]),
            ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap(),
        )
        .unwrap();
        crate::chat::migrations::migrate_to_target(&mut repo.connection, 28).unwrap();
        let workspace = root.join("project");
        std::fs::create_dir(&workspace).unwrap();
        let project =
            Uuid::parse_str(&repo.register_project(&workspace, b"fixture").unwrap().id).unwrap();
        let op = Uuid::now_v7();
        let intent = ModelIntent {
            profile_id: wire::ProfileId::KimiK3MaxV1,
            expected_revision: 0,
        };
        let p = repo
            .create_model_session(
                Some(project),
                vec![DraftContentBlock::Text("hello".into())],
                op,
                1,
                intent.clone(),
            )
            .unwrap();
        assert_eq!(
            repo.model_operation_profile(p.turn_operation_id)
                .unwrap()
                .as_deref(),
            Some("kimi-k3-max-v1")
        );
        assert_eq!(repo.model_state(p.session_id).unwrap().revision, 1);
        let repeat = repo
            .create_model_session(
                Some(project),
                vec![DraftContentBlock::Text("hello".into())],
                op,
                1,
                intent,
            )
            .unwrap();
        assert_eq!(repeat.session_id, p.session_id);
        let changed = ModelIntent {
            profile_id: wire::ProfileId::MinimaxM3HighV1,
            expected_revision: 0,
        };
        assert!(matches!(
            repo.create_model_session(
                Some(project),
                vec![DraftContentBlock::Text("hello".into())],
                op,
                1,
                changed
            ),
            Err(ChatError::ConversationConflict)
        ));
        // Selection state changes never rewrite the previously accepted outbox.
        let host = Uuid::now_v7();
        repo.connection
            .execute(
                "UPDATE chat_sessions SET agent_session_id=?2 WHERE id=?1",
                params![p.session_id.to_string(), host.to_string()],
            )
            .unwrap();
        let selection = Uuid::now_v7().to_string();
        repo.connection.execute("UPDATE chat_model_selections SET state='switching',operation_id=?2,requested_profile_id='minimax-m3-high-v1',expected_revision=1 WHERE session_id=?1",params![p.session_id.to_string(),selection]).unwrap();
        let stale = wire::Selection {
            schema_version: 1,
            agent_session_id: host.to_string(),
            state: wire::SelectionState::Ready,
            revision: 1,
            profile_id: Some(wire::ProfileId::KimiK3MaxV1),
            operation_id: None,
        };
        assert_eq!(
            repo.sync_model_selection(p.session_id, stale)
                .unwrap()
                .state,
            "switching"
        );
        let selected = wire::Selection {
            schema_version: 1,
            agent_session_id: host.to_string(),
            state: wire::SelectionState::Ready,
            revision: 2,
            profile_id: Some(wire::ProfileId::MinimaxM3HighV1),
            operation_id: Some(selection),
        };
        assert_eq!(
            repo.sync_model_selection(p.session_id, selected)
                .unwrap()
                .profile_id
                .as_deref(),
            Some("minimax-m3-high-v1")
        );
        assert_eq!(
            repo.model_operation_profile(p.turn_operation_id)
                .unwrap()
                .as_deref(),
            Some("kimi-k3-max-v1")
        );
        // Normal local-history fixtures: the native binding is absent, then the
        // project is removed through its persisted lifecycle state. Neither may
        // begin a model mutation even with an otherwise ready selection.
        repo.connection
            .execute("UPDATE chat_outbox SET state='done'", [])
            .unwrap();
        let select = ModelIntent {
            profile_id: wire::ProfileId::KimiK3MaxV1,
            expected_revision: 2,
        };
        assert!(matches!(
            repo.begin_model_selection(p.session_id, select.clone(), Uuid::now_v7()),
            Err(ChatError::ConversationConflict)
        ));
        assert_eq!(repo.model_state(p.session_id).unwrap().state, "ready");
        repo.connection
            .execute(
                "UPDATE chat_sessions SET runtime_thread_id=?2 WHERE id=?1",
                params![p.session_id.to_string(), Uuid::now_v7().to_string()],
            )
            .unwrap();
        repo.connection
            .execute(
                "UPDATE chat_projects SET removed_at=1 WHERE id=?1",
                [project.to_string()],
            )
            .unwrap();
        assert!(matches!(
            repo.begin_model_selection(p.session_id, select, Uuid::now_v7()),
            Err(ChatError::ConversationConflict)
        ));
        assert_eq!(repo.model_state(p.session_id).unwrap().state, "ready");
        drop(repo);
        std::fs::remove_dir_all(root).unwrap();
    }
}
