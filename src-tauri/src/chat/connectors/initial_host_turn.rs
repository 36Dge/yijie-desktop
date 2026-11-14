//! Explicit new messages after an owner-validated rejection, never a replay.
use crate::chat::{
    database::{ChatRepository, ChatScope},
    error::ChatError,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use uuid::Uuid;
fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}

// These two issue codes are written only by settle_market_rejection after the
// complete source-generated Host proof has matched the immutable local intent.
// Unknown errors, ordinary blocked delivery and pending turns cannot qualify.
pub(crate) fn proven_unbound(
    db: &Connection,
    scope: &ChatScope,
    session: Uuid,
    exclude: Option<Uuid>,
) -> Result<bool, ChatError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM chat_sessions s JOIN chat_projects p ON p.id=s.project_id
      JOIN chat_public_task_bindings b ON b.session_id=s.id
      WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3
        AND s.agent_session_id IS NULL AND s.runtime_thread_id IS NULL
        AND p.removed_at IS NULL AND b.state='bound' AND b.public_task_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id)
        AND EXISTS(SELECT 1 FROM chat_turns t WHERE t.session_id=s.id AND (?4 IS NULL OR t.operation_id!=?4))
        AND NOT EXISTS(SELECT 1 FROM chat_native_bindings n WHERE n.session_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.session_id=s.id AND (?4 IS NULL OR t.operation_id!=?4)
          AND (t.status!='failed' OR t.submission_status!='failed' OR t.runtime_turn_id IS NOT NULL
            OR NOT EXISTS(SELECT 1 FROM chat_market_submissions m JOIN chat_market_dispatch d USING(submission_operation_id)
              WHERE m.local_turn_id=t.id AND m.session_id=s.id AND m.turn_operation_id=t.operation_id
                AND d.state='blocked' AND d.host_instance_id IS NOT NULL
                AND d.issue_code IN ('skill_maintenance_busy','skill_unavailable')))))",
      params![session.to_string(),scope.owner_user_id,scope.tenant_id,exclude.map(|v|v.to_string())],|r|r.get(0)).map_err(db_error)
}

pub(crate) fn is_initial(
    db: &Connection,
    session: Uuid,
    operation: Uuid,
    revision: i64,
) -> Result<bool, ChatError> {
    let exists: bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_market_initial_host_turns')",[],|r|r.get(0)).map_err(db_error)?;
    if !exists {
        return Ok(false);
    }
    let saved: Option<i64>=db.query_row("SELECT local_model_revision FROM chat_market_initial_host_turns WHERE operation_id=?1 AND session_id=?2 AND format_version=1",params![operation.to_string(),session.to_string()],|r|r.get(0)).optional().map_err(db_error)?;
    match saved {
        Some(value) if value != revision => Err(ChatError::ConversationConflict),
        Some(_) => Ok(true),
        None => Ok(false),
    }
}

pub(crate) fn bind(
    db: &Transaction<'_>,
    scope: &ChatScope,
    ids: [Uuid; 5],
    host: &str,
) -> Result<(), ChatError> {
    let [session, operation, task, agent, thread] = ids;
    let allowed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM chat_market_initial_host_turns i
      JOIN chat_market_submissions m ON m.submission_operation_id=i.operation_id AND m.session_id=i.session_id
      JOIN chat_market_dispatch d ON d.submission_operation_id=i.operation_id
      JOIN chat_public_task_bindings b ON b.session_id=i.session_id
      JOIN chat_sessions s ON s.id=i.session_id
      WHERE i.operation_id=?1 AND i.session_id=?2 AND i.format_version=1 AND b.state='bound' AND b.public_task_id=?3
        AND d.host_instance_id=?4 AND d.state IN ('inflight','uncertain','accepted')
        AND s.owner_user_id=?5 AND s.tenant_id=?6)",params![operation.to_string(),session.to_string(),task.to_string(),host,scope.owner_user_id,scope.tenant_id],|r|r.get(0)).map_err(db_error)?;
    if !allowed {
        return Err(ChatError::ConversationConflict);
    }
    ChatRepository::bind_host_identity(db, scope, session, agent, thread)
}
