//! Native directory references, independent of user plan/grant definitions.
use super::execution_generated::{WorkspaceReference, WorkspaceSource};
use crate::chat::{
    database::{validate_project_path, ChatRepository, ChatScope},
    error::ChatError,
    migrations,
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) fn present(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v >= migrations::SCHEDULE_PREPARATION_SCHEMA_VERSION)
        .map_err(|_| ChatError::DatabaseUnavailable)
}
pub(crate) fn reference(
    db: &Connection,
    scope: &ChatScope,
    project: &str,
) -> Result<WorkspaceReference, ChatError> {
    let sql = if present(db)? {
        "SELECT workspace_source,managed_resource_id FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND removed_at IS NULL"
    } else {
        "SELECT 'user_project',NULL FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND removed_at IS NULL"
    };
    let (source, resource): (String, Option<String>) = db
        .query_row(
            sql,
            params![project, scope.owner_user_id, scope.tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| ChatError::DatabaseUnavailable)?
        .ok_or(ChatError::ProjectUnavailable)?;
    match (source.as_str(), resource) {
        ("user_project", None) => Ok(WorkspaceReference {
            source: WorkspaceSource::UserProject,
            resource_id: project.into(),
        }),
        ("managed_schedule", Some(resource)) if Uuid::parse_str(&resource).is_ok() => {
            Ok(WorkspaceReference {
                source: WorkspaceSource::ManagedSchedule,
                resource_id: resource,
            })
        }
        _ => Err(ChatError::ProjectUnavailable),
    }
}
pub(crate) fn require_user(
    db: &Connection,
    scope: &ChatScope,
    project: &str,
) -> Result<(), ChatError> {
    if !present(db)? {
        return Ok(());
    }
    let source:Option<String>=db.query_row("SELECT workspace_source FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",params![project,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).optional().map_err(|_|ChatError::DatabaseUnavailable)?;
    if source.is_some_and(|s| s != "user_project") {
        return Err(ChatError::ProjectUnavailable);
    }
    Ok(())
}
pub(crate) fn user_filter(db: &Connection) -> Result<&'static str, ChatError> {
    Ok(if present(db)? {
        " AND workspace_source='user_project'"
    } else {
        ""
    })
}
pub(crate) fn guard_deletion(
    db: &Connection,
    scope: &ChatScope,
    chat: &str,
) -> Result<(), ChatError> {
    if !present(db)? {
        return Ok(());
    }
    let unreleased = super::recovery::unreleased(db, "r.run_id")?;
    let busy:bool=db.query_row(&format!("SELECT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_runs r ON r.run_id=b.run_id WHERE b.conversation_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3 AND (r.format_version!=1 OR ({unreleased} AND (r.delivery_state NOT IN ('terminal','cancelled') OR r.needs_attention=1 OR EXISTS(SELECT 1 FROM chat_scheduled_reservation v WHERE v.run_id=r.run_id)))))"),params![chat,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)?;
    if busy {
        return Err(ChatError::ConversationConflict);
    }
    Ok(())
}
pub(super) fn resource_id(scope: &ChatScope, plan: &str, request: Option<&str>) -> String {
    let digest = Sha256::digest(format!(
        "feat155-directory-v1\0{}\0{}\0{plan}\0{}",
        scope.owner_user_id,
        scope.tenant_id,
        request.unwrap_or("dedicated")
    ));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 15) | 0x80;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}
pub(super) fn managed_path(
    chat_directory: &Path,
    scope: &ChatScope,
    resource: &str,
    create: bool,
) -> Result<PathBuf, ChatError> {
    // Components are native identity values, never paths supplied by a request.
    for id in [&scope.owner_user_id, &scope.tenant_id, resource] {
        let parsed = Uuid::parse_str(id).map_err(|_| ChatError::InvalidInput)?;
        if parsed.is_nil() || parsed.to_string() != *id {
            return Err(ChatError::InvalidInput);
        }
    }
    let mut path = validate_project_path(chat_directory)?;
    for component in [
        "scheduled-workspaces",
        scope.tenant_id.as_str(),
        scope.owner_user_id.as_str(),
        resource,
    ] {
        path.push(component);
        if create {
            match std::fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ChatError::ProjectUnavailable),
            }
        }
        if validate_project_path(&path)? != path {
            return Err(ChatError::ProjectUnavailable);
        }
    }
    Ok(path)
}
impl ChatRepository {
    pub(crate) fn resolve_schedule_project(&self, project: &str) -> Result<PathBuf, ChatError> {
        if let Some(path) = self.resolve_projectless_workspace(project)? {
            return Ok(path);
        }
        let w = reference(&self.connection, &self.scope, project)?;
        match w.source {
            WorkspaceSource::UserProject => Ok(crate::chat::native_project::resolve_bookmark(
                &self.project_bookmark(project)?,
            )?
            .canonical_path),
            WorkspaceSource::ManagedSchedule => managed_path(
                self.database_path
                    .parent()
                    .ok_or(ChatError::DatabaseUnavailable)?,
                &self.scope,
                &w.resource_id,
                false,
            ),
        }
    }
}
