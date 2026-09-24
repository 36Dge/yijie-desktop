//! Reader guards are active even when the execution writer is disabled.
use crate::chat::{database::ChatRepository, error::ChatError, migrations};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

pub(in crate::chat) fn present(db: &Connection) -> Result<bool, ChatError> {
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    Ok(version >= migrations::SCHEDULE_EXECUTION_SCHEMA_VERSION)
}

pub(super) fn held(db: &Connection) -> Result<bool, ChatError> {
    if !present(db)? {
        return Ok(false);
    }
    let unreleased = super::recovery::unreleased(db, "chat_scheduled_runs.run_id")?;
    db.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM chat_scheduled_reservation)
        OR EXISTS(SELECT 1 FROM chat_scheduled_runs
          WHERE format_version!=1 OR ((delivery_state NOT IN ('terminal','cancelled')
             OR needs_attention=1) AND {unreleased}))"
        ),
        [],
        |r| r.get(0),
    )
    .map_err(|_| ChatError::DatabaseUnavailable)
}

pub(crate) fn foreground(db: &Connection) -> Result<(), ChatError> {
    if held(db)? {
        Err(ChatError::ConversationConflict)
    } else {
        Ok(())
    }
}

/// Compatible v15/v16 SQL must not refer to the v17 column or tables.
/// Interrupts remain available for the existing normal cancellation path.
pub(crate) fn outbox_predicate(db: &Connection, alias: &str) -> Result<String, ChatError> {
    if !present(db)? {
        return Ok("1=1".into());
    }
    let idle = if held(db)? { "0" } else { "1" };
    let eligible = super::recovery::unreleased(db, &format!("{alias}.scheduled_run_id"))?;
    let interrupt = interrupt_eligible(db, alias)?;
    let draft = super::drafts::ordinary_outbox_predicate(db, alias)?;
    Ok(format!(
        "({draft} AND {eligible} AND (({alias}.kind='interrupt_turn' AND {interrupt}) OR ({alias}.kind!='interrupt_turn' AND {idle}=1 AND {alias}.scheduled_run_id IS NULL)))"
    ))
}

/// Called again immediately before outbound I/O, including after directory or
/// control-plane awaits. A held foreground outbox itself blocks new reservations.
impl ChatRepository {
    pub fn guard_conversation_dispatch(&self, operation_id: Uuid) -> Result<(), ChatError> {
        if self.guard_draft_dispatch(operation_id)? {
            return Ok(());
        }
        if !present(&self.connection)? {
            return Ok(());
        }
        let row: Option<(String, Option<String>, bool)> = self
            .connection
            .query_row(
                "SELECT o.kind,o.scheduled_run_id,
               (o.state='inflight' AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=o.session_id))
             FROM chat_outbox o
             JOIN chat_sessions s ON s.id=o.session_id
             WHERE o.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3",
                rusqlite::params![
                    operation_id.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        let (kind, scheduled, still_claimed) = row.ok_or(ChatError::NotFound)?;
        if kind == "interrupt_turn" {
            let predicate = interrupt_eligible(&self.connection, "o")?;
            let unreleased = super::recovery::unreleased(&self.connection, "o.scheduled_run_id")?;
            let eligible:bool=self.connection.query_row(&format!("SELECT ({predicate} AND {unreleased}) FROM chat_outbox o WHERE o.operation_id=?1"),[operation_id.to_string()],|r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)?;
            return if still_claimed && eligible {
                Ok(())
            } else {
                Err(ChatError::ConversationConflict)
            };
        }
        if self.schedule_background_only && scheduled.is_none() {
            return Err(ChatError::ConversationConflict);
        }
        if scheduled.is_some() {
            let now = super::dispatch::timestamp()?;
            let a = self
                .schedule_dispatch_authority
                .as_ref()
                .ok_or(ChatError::OrchestrationUnavailable)?
                .schedule_authority(now)
                .map_err(|_| ChatError::ScopeDenied)?;
            if !super::automatic::allows(
                &self.connection,
                &self.scope,
                &a,
                operation_id,
                now,
                self.schedule_trigger_lifecycle.as_ref(),
                &self.manual_runtime,
            ) {
                return Err(ChatError::ConversationConflict);
            }
            super::dispatch::validate_operation(
                &self.connection,
                &self.scope,
                &a,
                operation_id,
                now,
                true,
                self.schedule_trigger_lifecycle.as_ref(),
            )?;
            return Ok(());
        }
        if !still_claimed {
            return Err(ChatError::ConversationConflict);
        }
        foreground(&self.connection)
    }
}

// Legacy v1 failures retained a queued projection. A failed operation is
// not runnable and must not reserve the global lane forever. Require an
// exact turn payload and no native binding; unknown/submitted turns and any
// nonfailed matching operation stay busy. Never rewrite historical state.
pub(super) const FAILED_LEGACY_QUEUE: &str = "(t.runtime_turn_id IS NULL
      AND COALESCE(t.submission_status,'queued')='queued'
      AND EXISTS(SELECT 1 FROM chat_outbox f WHERE f.session_id=t.session_id
        AND f.kind IN ('create_session','start_turn') AND f.state='failed'
        AND f.payload_version IN (1,2)
        AND CASE WHEN json_valid(CAST(f.encrypted_payload AS TEXT))
          THEN json_extract(CAST(f.encrypted_payload AS TEXT),'$.turn_id')=t.id ELSE 0 END)
      AND NOT EXISTS(SELECT 1 FROM chat_outbox f WHERE f.session_id=t.session_id
        AND f.kind IN ('create_session','start_turn') AND f.state!='failed'
        AND CASE WHEN json_valid(CAST(f.encrypted_payload AS TEXT))
          THEN json_extract(CAST(f.encrypted_payload AS TEXT),'$.turn_id')=t.id ELSE 1 END))";

pub(super) const ACTIVE_CLEANUP: &str =
    "outcome_code!='retry_limit_exceeded' OR lease_expires_at!=0";

/// All foreground submissions reserve implicitly via their existing durable
/// turn/outbox. This preserves foreground/foreground behavior and closes the
/// accepted-but-not-yet-recorded and create-session I/O windows.
pub(super) fn foreground_busy(db: &Connection) -> Result<bool, ChatError> {
    let turn = super::recovery::effective_turn(db, "t")?;
    let outbox = super::recovery::unreleased(db, "o.scheduled_run_id")?;
    let interrupt = interrupt_eligible(db, "o")?;
    let public = if super::recovery::present(db)? {
        "NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_recovery e ON e.run_id=b.run_id WHERE b.create_operation_id=p.create_operation_id AND e.format_version=1 AND e.release_kind IS NOT NULL)"
    } else {
        "1=1"
    };
    let failed_legacy = FAILED_LEGACY_QUEUE;
    let cleanup = ACTIVE_CLEANUP;
    db.query_row(&format!("SELECT
      EXISTS(SELECT 1 FROM chat_turns t WHERE {turn} AND (status IN ('streaming','stopping')
        OR submission_status='uncertain'
        OR (status='queued' AND COALESCE(submission_status,'queued') NOT IN ('failed','cancelled') AND NOT {failed_legacy})))
      OR EXISTS(SELECT 1 FROM chat_outbox o WHERE kind IN ('create_session','start_turn','interrupt_turn')
        AND state IN ('pending','inflight') AND {outbox} AND (kind!='interrupt_turn' OR {interrupt}))
      OR EXISTS(SELECT 1 FROM chat_public_task_bindings p WHERE state IN ('pending','inflight','retry_wait') AND {public})
      OR EXISTS(SELECT 1 FROM chat_deletion_jobs WHERE {cleanup})"),
      [], |r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)
}
pub(super) fn interrupt_eligible(db: &Connection, alias: &str) -> Result<String, ChatError> {
    Ok(if super::recovery::present(db)? {
        // The old interrupt payload identifies a local turn. A new turn in the
        // same conversation must never make a stale interrupt eligible again.
        format!("NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=json_extract(CAST({alias}.encrypted_payload AS TEXT),'$.turn_id') AND t.scheduled_quiescent=1)")
    } else {
        "1=1".into()
    })
}

/// A plan can be deleted only after its own reservation and execution facts are
/// quiescent. Another plan's work does not affect this decision.
pub(super) fn plan_held(
    db: &Connection,
    scope: &crate::chat::database::ChatScope,
    plan: &str,
) -> Result<bool, ChatError> {
    if !present(db)? {
        return Ok(false);
    }
    let unreleased = super::recovery::unreleased(db, "r.run_id")?;
    db.query_row(&format!("SELECT EXISTS(SELECT 1 FROM chat_scheduled_runs r
      WHERE r.owner_user_id=?1 AND r.tenant_id=?2 AND r.plan_id=?3 AND
      (r.format_version!=1 OR EXISTS(SELECT 1 FROM chat_scheduled_reservation q WHERE q.run_id=r.run_id)
       OR ({unreleased} AND (r.delivery_state NOT IN ('terminal','cancelled') OR r.needs_attention=1
         OR EXISTS(SELECT 1 FROM chat_outbox o WHERE o.scheduled_run_id=r.run_id AND o.state IN ('pending','inflight'))))))"),
      rusqlite::params![scope.owner_user_id,scope.tenant_id,plan], |r|r.get(0)).map_err(|_|ChatError::DatabaseUnavailable)
}
