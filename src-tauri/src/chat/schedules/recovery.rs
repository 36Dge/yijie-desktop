//! Native recovery facts and coordination only. Never grants dispatch authority.
use super::{
    execution::ScheduleAuthority, execution_generated::ScheduleCapability, recovery_generated::*,
};
use crate::chat::{
    database::{ChatRepository, ChatScope},
    error::ChatError,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use uuid::Uuid;
fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
pub(crate) fn present(db: &Connection) -> Result<bool, ChatError> {
    Ok(db
        .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map_err(db_error)?
        >= 19)
}
/// Trusted SQL aliases only, never input from an IPC or model.
pub(crate) fn effective_turn(db: &Connection, alias: &str) -> Result<String, ChatError> {
    Ok(if present(db)? {
        format!("{alias}.scheduled_quiescent=0")
    } else {
        "1=1".into()
    })
}
pub(crate) fn unreleased(db: &Connection, run: &str) -> Result<String, ChatError> {
    Ok(if present(db)? {
        format!("NOT EXISTS(SELECT 1 FROM chat_scheduled_recovery e WHERE e.run_id={run} AND e.format_version=1 AND e.release_kind IS NOT NULL)")
    } else {
        "1=1".into()
    })
}
pub(super) fn initialize(
    tx: &Transaction<'_>,
    run: &str,
    create: Option<&str>,
) -> Result<(), ChatError> {
    if present(tx)? {
        tx.execute("INSERT INTO chat_scheduled_recovery(run_id,create_attempt,turn_attempt) VALUES(?1,?2,'never')",params![run,if create.is_some(){"never"}else{"not_required"}]).map_err(db_error)?;
    }
    Ok(())
}
#[derive(Clone, Debug)]
pub(crate) struct Candidate {
    pub run: String,
    pub conversation: Uuid,
    pub local_turn: Uuid,
    pub operation: Uuid,
    pub task: Option<Uuid>,
    pub session: Option<Uuid>,
    pub thread: Option<Uuid>,
    pub runtime_turn: Option<Uuid>,
    pub create_attempt: String,
    pub turn_attempt: String,
    pub create_operation: Option<Uuid>,
}
fn uuid(s: String) -> Result<Uuid, ChatError> {
    Uuid::parse_str(&s).map_err(|_| ChatError::DatabaseUnavailable)
}
fn candidate(
    db: &Connection,
    scope: &ChatScope,
    run: Option<&str>,
) -> Result<Option<Candidate>, ChatError> {
    if !present(db)? {
        return Ok(None);
    }
    let mut q=db.prepare("SELECT r.run_id,b.conversation_id,b.local_turn_id,r.operation_id,p.public_task_id,s.agent_session_id,s.runtime_thread_id,t.runtime_turn_id,e.create_attempt,e.turn_attempt,b.create_operation_id FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id JOIN chat_sessions s ON s.id=b.conversation_id JOIN chat_turns t ON t.id=b.local_turn_id AND t.session_id=s.id AND t.operation_id=r.operation_id LEFT JOIN chat_public_task_bindings p ON p.session_id=s.id AND p.state='bound' JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.owner_user_id=?1 AND r.tenant_id=?2 AND s.owner_user_id=r.owner_user_id AND s.tenant_id=r.tenant_id AND r.format_version=1 AND e.format_version=1 AND e.release_kind IS NULL AND (r.delivery_state NOT IN ('terminal','cancelled') OR r.needs_attention=1 OR EXISTS(SELECT 1 FROM chat_scheduled_reservation v WHERE v.run_id=r.run_id)) AND b.target_deleted=0 AND t.scheduled_quiescent=0 AND (?3 IS NULL OR r.run_id=?3) AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id) ORDER BY r.run_id LIMIT 1").map_err(db_error)?;
    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
    );
    let row: Option<Row> = q
        .query_row(params![scope.owner_user_id, scope.tenant_id, run], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
            ))
        })
        .optional()
        .map_err(db_error)?;
    row.map(|r| {
        Ok(Candidate {
            run: r.0,
            conversation: uuid(r.1)?,
            local_turn: uuid(r.2)?,
            operation: uuid(r.3)?,
            task: r.4.map(uuid).transpose()?,
            session: r.5.map(uuid).transpose()?,
            thread: r.6.map(uuid).transpose()?,
            runtime_turn: r.7.map(uuid).transpose()?,
            create_attempt: r.8,
            turn_attempt: r.9,
            create_operation: r.10.map(uuid).transpose()?,
        })
    })
    .transpose()
}
fn authorize(a: &ScheduleAuthority, scope: &ChatScope, now: i64) -> Result<(), ChatError> {
    a.require(scope, ScheduleCapability::ScheduleRead, now)
        .map_err(|_| ChatError::ScopeDenied)
}
impl ChatRepository {
    pub(crate) fn scheduled_recovery_candidate(
        &self,
        a: &ScheduleAuthority,
        now: i64,
    ) -> Result<Option<Candidate>, ChatError> {
        authorize(a, &self.scope, now)?;
        candidate(&self.connection, &self.scope, None)
    }
    pub(crate) fn apply_schedule_mapping(
        &mut self,
        a: &ScheduleAuthority,
        run: &str,
        m: &SessionMapping,
        now: i64,
    ) -> Result<(), ChatError> {
        authorize(a, &self.scope, now)?;
        m.validate().map_err(|_| ChatError::ConversationConflict)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        let c = candidate(&tx, &self.scope, Some(run))?.ok_or(ChatError::NotFound)?;
        if c.task.map(|v| v.to_string()).as_deref() != Some(&m.task_id)
            || c.session
                .is_some_and(|v| v.to_string() != m.agent_session_id)
            || c.thread
                .is_some_and(|v| Some(v.to_string()) != m.codex_thread_id)
        {
            return Err(ChatError::ConversationConflict);
        }
        if let (Some(create), Some(thread)) = (c.create_operation, m.codex_thread_id.as_ref()) {
            Self::bind_host_session_in_transaction(
                &tx,
                &self.scope,
                [
                    create,
                    uuid(m.task_id.clone())?,
                    uuid(m.agent_session_id.clone())?,
                    uuid(thread.clone())?,
                ],
                now,
                true,
            )?;
            // A confirmed create resolves only that stage; it never retries a turn.
            tx.execute("UPDATE chat_scheduled_runs SET delivery_state='reserved',needs_attention=0 WHERE run_id=?1 AND delivery_state IN ('reserved','sending','uncertain') AND EXISTS(SELECT 1 FROM chat_scheduled_recovery e WHERE e.run_id=?1 AND e.turn_attempt='never')",[run]).map_err(db_error)?;
        } else {
            tx.execute("UPDATE chat_sessions SET agent_session_id=?1,runtime_thread_id=COALESCE(?2,runtime_thread_id) WHERE id=?3",params![m.agent_session_id,m.codex_thread_id,c.conversation.to_string()]).map_err(db_error)?;
        }
        tx.execute("UPDATE chat_scheduled_recovery SET create_attempt=CASE WHEN create_attempt='not_required' THEN create_attempt ELSE 'attempted' END WHERE run_id=?1",[run]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub(crate) fn apply_schedule_operation(
        &mut self,
        a: &ScheduleAuthority,
        run: &str,
        o: &TurnOperationResult,
        now: i64,
    ) -> Result<(), ChatError> {
        authorize(a, &self.scope, now)?;
        o.validate().map_err(|_| ChatError::ConversationConflict)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        let c = candidate(&tx, &self.scope, Some(run))?.ok_or(ChatError::NotFound)?;
        if c.session.map(|v| v.to_string()).as_deref() != Some(&o.agent_session_id)
            || c.operation.to_string() != o.operation_id
            || c.runtime_turn
                .is_some_and(|v| o.turn_id.as_ref().is_some_and(|id| v.to_string() != *id))
        {
            return Err(ChatError::ConversationConflict);
        }
        // Even pending/uncertain is positive evidence of an outbound attempt.
        // It can never retain the never-sent refund eligibility.
        tx.execute(
            "UPDATE chat_scheduled_recovery SET turn_attempt='attempted' WHERE run_id=?1",
            [run],
        )
        .map_err(db_error)?;
        if let Some(turn) = &o.turn_id {
            let thread = c.thread.ok_or(ChatError::ConversationConflict)?.to_string();
            let mismatch:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_native_bindings WHERE turn_id=?1 AND (session_id!=?2 OR runtime_thread_id!=?3 OR runtime_turn_id!=?4))",params![c.local_turn.to_string(),c.conversation.to_string(),thread,turn],|r|r.get(0)).map_err(db_error)?;
            if mismatch {
                return Err(ChatError::ConversationConflict);
            }
            // Accepted submission uses the existing active coordination state;
            // it is not a native completion or a business success.
            tx.execute("UPDATE chat_turns SET runtime_turn_id=?1,status=CASE WHEN status='queued' THEN 'streaming' ELSE status END,submission_status='submitted' WHERE id=?2",params![turn,c.local_turn.to_string()]).map_err(db_error)?;
            tx.execute("INSERT OR IGNORE INTO chat_native_bindings(turn_id,session_id,runtime_thread_id,runtime_turn_id,host_instance_nonce) SELECT ?1,?2,?3,?4,original_host_instance FROM chat_scheduled_recovery WHERE run_id=?5",params![c.local_turn.to_string(),c.conversation.to_string(),thread,turn,run]).map_err(db_error)?;
            tx.execute(
                "UPDATE chat_scheduled_recovery SET recovered_binding=1 WHERE run_id=?1",
                [run],
            )
            .map_err(db_error)?;
            tx.execute("UPDATE chat_outbox SET state='inflight',next_attempt_at=NULL WHERE operation_id=?1 AND scheduled_run_id=?2",params![c.operation.to_string(),run]).map_err(db_error)?;
            tx.execute(
                "UPDATE chat_scheduled_runs SET delivery_state='accepted' WHERE run_id=?1",
                [run],
            )
            .map_err(db_error)?;
        } else {
            tx.execute("UPDATE chat_scheduled_runs SET delivery_state='uncertain',needs_attention=1 WHERE run_id=?1",[run]).map_err(db_error)?;
            super::triggers::hold_unknown(&tx, run)?;
        }
        tx.commit().map_err(db_error)
    }
    pub(crate) fn schedule_unknown(&mut self, run: &str) -> Result<(), ChatError> {
        let tx = self.connection.transaction().map_err(db_error)?;
        tx.execute("UPDATE chat_scheduled_runs SET needs_attention=1 WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND delivery_state NOT IN ('terminal','cancelled')",params![run,self.scope.owner_user_id,self.scope.tenant_id]).map_err(db_error)?;
        super::triggers::hold_unknown(&tx, run)?;
        tx.commit().map_err(db_error)
    }
    pub(crate) fn schedule_needs_attention(&self, run: &str) -> Result<(), ChatError> {
        self.connection.execute("UPDATE chat_scheduled_runs SET needs_attention=1 WHERE run_id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND delivery_state NOT IN ('terminal','cancelled')",params![run,self.scope.owner_user_id,self.scope.tenant_id]).map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn is_recovered_schedule_turn(
        &self,
        session: Uuid,
        turn: Uuid,
    ) -> Result<bool, ChatError> {
        if !present(&self.connection)? {
            return Ok(false);
        }
        self.session_summary(session)?;
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_recovery e JOIN chat_scheduled_run_bindings b ON b.run_id=e.run_id WHERE b.conversation_id=?1 AND b.local_turn_id=?2 AND e.format_version=1 AND e.recovered_binding=1 AND e.release_kind IS NULL)",params![session.to_string(),turn.to_string()],|r|r.get(0)).map_err(db_error)
    }
    /// Internal cancellation requires durable absence of BOTH possible side effects.
    pub(crate) fn cancel_unsent_schedule(
        &mut self,
        a: &ScheduleAuthority,
        run: &str,
        now: i64,
    ) -> Result<(), ChatError> {
        self.cancel_unsent_schedule_reason(a, run, now, "cancelled")
    }
    pub(crate) fn cancel_unsent_schedule_reason(
        &mut self,
        a: &ScheduleAuthority,
        run: &str,
        now: i64,
        reason: &str,
    ) -> Result<(), ChatError> {
        authorize(a, &self.scope, now)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        let proof:Option<(String,String,Option<String>)>=tx.query_row("SELECT e.create_attempt,e.turn_attempt,e.release_kind FROM chat_scheduled_recovery e JOIN chat_scheduled_runs r ON r.run_id=e.run_id WHERE e.run_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3 AND r.format_version=1 AND e.format_version=1",params![run,self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
        let (create, turn, released) = proof.ok_or(ChatError::NotFound)?;
        if released.as_deref() == Some("never_sent_cancel") {
            return Ok(());
        }
        if released.is_some()
            || !matches!(create.as_str(), "never" | "not_required")
            || turn != "never"
        {
            return Err(ChatError::ConversationConflict);
        }
        let c = candidate(&tx, &self.scope, Some(run))?.ok_or(ChatError::NotFound)?;
        let attempted:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE scheduled_run_id=?1 AND (attempt_count>0 OR state!='pending')) OR EXISTS(SELECT 1 FROM chat_public_task_bindings p JOIN chat_scheduled_run_bindings b ON b.create_operation_id=p.create_operation_id WHERE b.run_id=?1 AND (p.attempt_count>0 OR p.state!='pending'))",[run],|r|r.get(0)).map_err(db_error)?;
        let native_claim = if tx
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map_err(db_error)?
            >= crate::chat::migrations::SCHEDULE_DISPATCH_SCHEMA_VERSION
        {
            tx.query_row(
                "SELECT native_claim=1 FROM chat_scheduled_recovery WHERE run_id=?1",
                [run],
                |r| r.get::<_, bool>(0),
            )
            .map_err(db_error)?
        } else {
            false
        };
        if (attempted && !native_claim) || c.runtime_turn.is_some() {
            return Err(ChatError::ConversationConflict);
        }
        tx.execute("UPDATE chat_scheduled_runs SET delivery_state='cancelled',needs_attention=0 WHERE run_id=?1",[run]).map_err(db_error)?;
        tx.execute("UPDATE chat_scheduled_grants SET occupied_runs=occupied_runs-1 WHERE grant_id=(SELECT grant_id FROM chat_scheduled_runs WHERE run_id=?1) AND occupied_runs>0",[run]).map_err(db_error)?;
        tx.execute(
            "UPDATE chat_turns SET submission_status='cancelled' WHERE id=?1",
            [c.local_turn.to_string()],
        )
        .map_err(db_error)?;
        tx.execute("UPDATE chat_outbox SET state='failed',next_attempt_at=NULL WHERE scheduled_run_id=?1 AND state IN ('pending','inflight')",[run]).map_err(db_error)?;
        release(&tx, run, "never_sent_cancel", run, true)?;
        super::triggers::cancelled(&tx, run, reason)?;
        tx.commit().map_err(db_error)
    }
}
fn release(
    tx: &Transaction<'_>,
    run: &str,
    kind: &str,
    reference: &str,
    refund: bool,
) -> Result<(), ChatError> {
    let changed=tx.execute("UPDATE chat_scheduled_recovery SET release_kind=?2,release_reference=?3,refunded=?4 WHERE run_id=?1 AND format_version=1 AND release_kind IS NULL",params![run,kind,reference,refund]).map_err(db_error)?;
    if changed == 0 {
        return Ok(());
    }
    tx.execute("UPDATE chat_turns SET scheduled_quiescent=1 WHERE id=(SELECT local_turn_id FROM chat_scheduled_run_bindings WHERE run_id=?1)",[run]).map_err(db_error)?;
    // Do not rewrite result/submission history to suppress retries. The immutable
    // proof is used by every claim and final dispatch guard (including interrupts).
    tx.execute(
        "DELETE FROM chat_scheduled_reservation WHERE run_id=?1",
        [run],
    )
    .map_err(db_error)?;
    Ok(())
}
/// Called only inside the original, identity-checked native fact transaction.
pub(crate) fn native_terminal(
    tx: &Transaction<'_>,
    local_turn: &str,
    runtime_turn: &str,
    status: &str,
) -> Result<(), ChatError> {
    if !present(tx)? || !matches!(status, "completed" | "failed" | "interrupted") {
        return Ok(());
    }
    let run:Option<String>=tx.query_row("SELECT r.run_id FROM chat_scheduled_runs r JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id JOIN chat_turns t ON t.id=b.local_turn_id AND t.operation_id=r.operation_id JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE t.id=?1 AND t.runtime_turn_id=?2 AND r.format_version=1 AND e.format_version=1 AND (e.release_kind IS NULL OR e.release_kind='generation_stopped')",params![local_turn,runtime_turn],|r|r.get(0)).optional().map_err(db_error)?;
    if let Some(run) = run {
        tx.execute("UPDATE chat_scheduled_runs SET delivery_state='terminal',native_outcome=?2,needs_attention=0 WHERE run_id=?1",params![run,status]).map_err(db_error)?;
        release(tx, &run, "native_terminal", runtime_turn, false)?;
        super::triggers::finish_once(tx, &run)?;
    }
    Ok(())
}

/// Reuse the legacy predicates exactly; only released scheduled history is absent.
pub(crate) fn coordination_sql(db: &Connection, sql: &str) -> Result<String, ChatError> {
    Ok(if present(db)? {
        sql.replace(
            "FROM chat_turns",
            "FROM (SELECT * FROM chat_turns WHERE scheduled_quiescent=0)",
        )
        .replace(
            "JOIN chat_turns",
            "JOIN (SELECT * FROM chat_turns WHERE scheduled_quiescent=0)",
        )
    } else {
        sql.into()
    })
}

impl ChatRepository {
    pub(crate) fn recover_schedule_clocks(&mut self, now: i64) -> Result<(), ChatError> {
        if !self.schedule_writes_enabled || !present(&self.connection)? {
            return Ok(());
        }
        let plans = self
            .list_schedules()
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        for p in plans {
            if p.state != super::generated::PlanState::Deleted {
                self.recover_schedule_clock(
                    &p.plan_id,
                    p.revision,
                    now,
                    super::time::Continuity::Recovered,
                )
                .map_err(|_| ChatError::DatabaseUnavailable)?;
            }
        }
        Ok(())
    }
}

impl ChatRepository {
    pub(crate) fn record_stopped_schedule_generation(&self, nonce: &str) -> Result<(), ChatError> {
        if !present(&self.connection)? {
            return Ok(());
        }
        let id = uuid(nonce.into())?;
        if id.is_nil() || id.to_string() != nonce {
            return Err(ChatError::InvalidInput);
        }
        self.connection.execute("INSERT OR IGNORE INTO chat_scheduled_stopped_generations(host_instance) VALUES(?1)",[nonce]).map_err(db_error)?;
        Ok(())
    }
    /// Called after precise current session status and live approval checks. The
    /// durable owned-stop fact, rather than a changed nonce, establishes cessation.
    pub(crate) fn release_stopped_schedule(
        &mut self,
        a: &ScheduleAuthority,
        run: &str,
        current_host: &str,
        now: i64,
    ) -> Result<(), ChatError> {
        authorize(a, &self.scope, now)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        let already:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_recovery e JOIN chat_scheduled_runs r ON r.run_id=e.run_id WHERE e.run_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3 AND e.format_version=1 AND e.release_kind IS NOT NULL)",params![run,self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db_error)?;
        if already {
            return Ok(());
        }
        let c = candidate(&tx, &self.scope, Some(run))?.ok_or(ChatError::NotFound)?;
        // A confirmed create plus a still-authorized never-sent turn is a
        // resumable next stage, not an unknown execution to quiesce. This pure
        // check does not grant dispatch authority to a compatible reader.
        if c.turn_attempt == "never"
            && super::automatic::allows(
                &tx,
                &self.scope,
                a,
                c.operation,
                now,
                self.schedule_trigger_lifecycle.as_ref(),
                &self.manual_runtime,
            )
            && c.thread.is_some()
            && super::dispatch::validate_operation(
                &tx,
                &self.scope,
                a,
                c.operation,
                now,
                false,
                self.schedule_trigger_lifecycle.as_ref(),
            )
            .is_ok()
        {
            return Ok(());
        }
        let original:Option<String>=tx.query_row("SELECT COALESCE(e.original_host_instance,e.create_host_instance) FROM chat_scheduled_recovery e WHERE e.run_id=?1 AND e.format_version=1 AND e.release_kind IS NULL
          AND (e.create_attempt IN ('never','not_required') OR (e.create_attempt='attempted' AND e.create_host_instance!=?2 AND EXISTS(SELECT 1 FROM chat_scheduled_stopped_generations g WHERE g.host_instance=e.create_host_instance AND g.format_version=1)))
          AND (e.turn_attempt='never' OR (e.turn_attempt='attempted' AND e.original_host_instance!=?2 AND EXISTS(SELECT 1 FROM chat_scheduled_stopped_generations g WHERE g.host_instance=e.original_host_instance AND g.format_version=1)))
          AND (e.create_attempt='attempted' OR e.turn_attempt='attempted')",params![run,current_host],|r|r.get(0)).optional().map_err(db_error)?;
        if let Some(original) = original {
            tx.execute("UPDATE chat_scheduled_runs SET delivery_state='uncertain',needs_attention=1 WHERE run_id=?1",[run]).map_err(db_error)?;
            super::triggers::hold_unknown(&tx, run)?;
            release(&tx, run, "generation_stopped", &original, false)?;
        }
        tx.commit().map_err(db_error)
    }
}

impl ChatRepository {
    /// Ordinary opens still reject scheduled I/O. An explicit native candidate
    /// revalidates the reserved run inside this transaction before marking I/O.
    pub(crate) fn begin_conversation_dispatch(
        &mut self,
        operation: Uuid,
        host: &str,
    ) -> Result<(), ChatError> {
        self.guard_conversation_dispatch(operation)?;
        if !present(&self.connection)? {
            return Ok(());
        }
        let row:Option<(String,String)>=self.connection.query_row("SELECT scheduled_run_id,kind FROM chat_outbox WHERE operation_id=?1 AND scheduled_run_id IS NOT NULL",[operation.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        let Some((run, kind)) = row else {
            return Ok(());
        };
        if kind == "interrupt_turn" {
            return Ok(());
        }
        let nonce = uuid(host.into())?;
        if nonce.is_nil() || nonce.to_string() != host {
            return Err(ChatError::InvalidInput);
        }
        let at = super::dispatch::timestamp()?;
        let a = self
            .schedule_dispatch_authority
            .as_ref()
            .ok_or(ChatError::OrchestrationUnavailable)?
            .schedule_authority(at)
            .map_err(|_| ChatError::ScopeDenied)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        super::dispatch::validate_operation(
            &tx,
            &self.scope,
            &a,
            operation,
            at,
            true,
            self.schedule_trigger_lifecycle.as_ref(),
        )?;
        let c = candidate(&tx, &self.scope, Some(&run))?.ok_or(ChatError::ConversationConflict)?;
        let query=match kind.as_str(){
   "create_session"=>"UPDATE chat_scheduled_recovery SET create_attempt='attempted',create_host_instance=?2 WHERE run_id=?1 AND release_kind IS NULL AND create_attempt='never' AND EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b WHERE b.run_id=?1 AND b.create_operation_id=?3)",
   "start_turn" if c.operation==operation=>"UPDATE chat_scheduled_recovery SET turn_attempt='attempted',original_host_instance=?2 WHERE run_id=?1 AND release_kind IS NULL AND turn_attempt='never' AND EXISTS(SELECT 1 FROM chat_scheduled_runs r WHERE r.run_id=?1 AND r.operation_id=?3)",
   _=>return Err(ChatError::ConversationConflict)
  };
        if tx
            .execute(query, params![run, host, operation.to_string()])
            .map_err(db_error)?
            != 1
        {
            return Err(ChatError::ConversationConflict);
        }
        tx.execute("UPDATE chat_scheduled_runs SET delivery_state='sending',needs_attention=0 WHERE run_id=?1",[&run]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
}
