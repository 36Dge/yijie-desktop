//! Candidate manual dispatch through the original worker/Coordinator/HostBridge.
//! The ordinary constructor never installs a native dispatch authority.
use super::*;
use crate::chat::{
    error::ChatError, host_bridge::HostBridge, host_domain::HostSessionState, lifecycle::Lifecycle,
};
use std::path::PathBuf;

pub(crate) fn timestamp() -> Result<i64, ChatError> {
    now().map_err(|_| ChatError::DatabaseUnavailable)
}
fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn denied(_: Error) -> ChatError {
    ChatError::ConversationConflict
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Context {
    run: String,
    kind: String,
    project: String,
    pub(crate) task: Option<Uuid>,
    pub(crate) session: Option<Uuid>,
    thread: Option<Uuid>,
    automatic: Option<(crate::chat::lifecycle::ContinuityTicket, i64)>,
}

/// This validates an existing debit, not permission to reserve another debit.
/// A grant at its limit can dispatch its own run, but cannot create a new run.
#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_operation(
    db: &Connection,
    scope: &ChatScope,
    a: &ScheduleAuthority,
    operation: Uuid,
    at: i64,
    claimed: bool,
    lifecycle: Option<&Lifecycle>,
) -> Result<Context, ChatError> {
    a.require(scope, ScheduleCapability::ScheduleRun, at)
        .map_err(|_| ChatError::ScopeDenied)?;
    if db
        .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map_err(db_error)?
        < crate::chat::migrations::SCHEDULE_DISPATCH_SCHEMA_VERSION
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    type Row = (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let row: Option<Row> = db.query_row("SELECT r.run_id,o.kind,b.project_id,p.public_task_id,s.agent_session_id,s.runtime_thread_id
        FROM chat_outbox o JOIN chat_scheduled_runs r ON r.run_id=o.scheduled_run_id
        JOIN chat_scheduled_run_bindings b ON b.run_id=r.run_id AND b.conversation_id=o.session_id
        JOIN chat_scheduled_recovery e ON e.run_id=r.run_id
        JOIN chat_sessions s ON s.id=b.conversation_id AND s.project_id=b.project_id
        JOIN chat_turns t ON t.id=b.local_turn_id AND t.session_id=s.id AND t.operation_id=r.operation_id
        JOIN chat_projects w ON w.id=b.project_id AND w.owner_user_id=s.owner_user_id AND w.tenant_id=s.tenant_id
        JOIN chat_scheduled_reservation v ON v.run_id=r.run_id
        JOIN chat_task_permissions m ON m.session_id=s.id
        LEFT JOIN chat_public_task_bindings p ON p.session_id=s.id AND p.state='bound'
        WHERE o.operation_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3
        AND s.owner_user_id=r.owner_user_id AND s.tenant_id=r.tenant_id
        AND r.format_version=1 AND e.format_version=1 AND e.release_kind IS NULL AND e.refunded=0
        AND (e.native_claim=1 OR (o.attempt_count=0 AND (b.create_operation_id IS NULL OR EXISTS(SELECT 1 FROM chat_public_task_bindings pc WHERE pc.create_operation_id=b.create_operation_id AND pc.attempt_count=0 AND pc.state='pending'))))
        AND r.trigger_source IN ('manual','automatic','rerun') AND r.delivery_state IN ('reserved','sending')
        AND r.native_outcome='unobserved' AND b.target_deleted=0 AND t.scheduled_quiescent=0
        AND t.status='queued' AND t.runtime_turn_id IS NULL AND COALESCE(t.submission_status,'queued')='queued'
        AND w.removed_at IS NULL AND m.mode='ask' AND o.payload_version=2
        AND ((?4=1 AND o.state='inflight') OR (?4=0 AND o.state IN ('pending','inflight')))
        AND ((o.kind='create_session' AND b.create_operation_id=o.operation_id AND e.create_attempt='never'
                AND s.agent_session_id IS NULL AND s.runtime_thread_id IS NULL)
          OR (o.kind='start_turn' AND r.operation_id=o.operation_id AND e.turn_attempt='never'
                AND s.agent_session_id IS NOT NULL AND s.runtime_thread_id IS NOT NULL AND p.public_task_id IS NOT NULL
                AND (e.create_attempt='not_required' OR EXISTS(SELECT 1 FROM chat_outbox c WHERE c.operation_id=b.create_operation_id AND c.scheduled_run_id=r.run_id AND c.state='done'))))",
        params![operation.to_string(),scope.owner_user_id,scope.tenant_id,claimed],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))
        .optional().map_err(db_error)?;
    let (run, kind, project, task, session, thread) = row.ok_or(ChatError::ConversationConflict)?;
    let r = read_run(db, scope, &run).map_err(denied)?;
    triggers::validate_send(db, &r, lifecycle, at).map_err(denied)?;
    let g = grant(db, scope, &r.grant_id, at).map_err(denied)?;
    let p = plan(db, scope, &r.plan_id).map_err(denied)?;
    let w = workspace(db, scope, &p).map_err(denied)?;
    if matches!(g.state, GrantState::Expired | GrantState::Stale)
        || g.authorization_revision != a.revision
        || g.plan_revision != r.plan_revision
        || p.revision != r.plan_revision
        || p.schedule_epoch != r.schedule_epoch
        || p.state == PlanState::Deleted
        || (!super::single::is_single(db, scope, &r.grant_id).map_err(denied)?
            && p.authorization_ref.as_deref() != Some(&r.grant_id))
        || definition_digest(&p, &w).map_err(denied)? != g.definition_digest
        || w != g.workspace
        || r.workspace != w
        || g.occupied_runs < 1
        || g.occupied_runs > g.max_runs
    {
        return Err(ChatError::ConversationConflict);
    }
    // A durable, unrefunded run is the individual debit. Check the aggregate
    // against all retained runs, not just the current reservation.
    let debits:i64=db.query_row("SELECT count(*) FROM chat_scheduled_runs r JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.grant_id=?1 AND e.refunded=0",[&r.grant_id],|r|r.get(0)).map_err(db_error)?;
    if debits != g.occupied_runs {
        return Err(ChatError::ConversationConflict);
    }
    let target_ok:bool=match p.definition.target.mode {
        TargetMode::ExistingChat=>db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings WHERE run_id=?1 AND conversation_id=?2)",params![run,p.definition.target.conversation_id],|r|r.get(0)),
        TargetMode::DedicatedChat=>db.query_row("SELECT EXISTS(SELECT 1 FROM chat_scheduled_target_bindings d JOIN chat_scheduled_run_bindings b ON b.conversation_id=d.conversation_id AND b.project_id=d.project_id WHERE b.run_id=?1 AND d.plan_id=?2 AND d.owner_user_id=?3 AND d.tenant_id=?4)",params![run,p.plan_id,scope.owner_user_id,scope.tenant_id],|r|r.get(0)),
        TargetMode::NewChatEachRun=>Ok(project==directories_resource(scope,&r.plan_id,&r.request_id)),
    }.map_err(db_error)?;
    if !target_ok || other_busy(db, &run)? {
        return Err(ChatError::ConversationConflict);
    }
    let parse = |v: Option<String>| {
        v.map(|s| Uuid::parse_str(&s).map_err(|_| ChatError::DatabaseUnavailable))
            .transpose()
    };
    Ok(Context {
        run,
        kind,
        project,
        task: parse(task)?,
        session: parse(session)?,
        thread: parse(thread)?,
        automatic: if r.trigger == super::super::execution_generated::RunTrigger::Automatic {
            let at = db
                .query_row(
                    "SELECT scheduled_at FROM chat_scheduled_trigger_facts WHERE run_id=?1",
                    [&r.run_id],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(db_error)?;
            Some((
                lifecycle
                    .ok_or(ChatError::OrchestrationUnavailable)?
                    .ticket()?,
                at,
            ))
        } else {
            None
        },
    })
}
fn directories_resource(scope: &ChatScope, plan: &str, request: &str) -> String {
    super::super::workspace::resource_id(scope, plan, Some(request))
}
fn other_busy(db: &Connection, run: &str) -> Result<bool, ChatError> {
    let active = super::super::recovery::effective_turn(db, "t")?;
    let outbox = super::super::recovery::unreleased(db, "o.scheduled_run_id")?;
    let interrupt = super::super::execution_guard::interrupt_eligible(db, "o")?;
    db.query_row(&format!("SELECT
      EXISTS(SELECT 1 FROM chat_deletion_jobs)
      OR EXISTS(SELECT 1 FROM chat_scheduled_reservation WHERE run_id!=?1)
      OR EXISTS(SELECT 1 FROM chat_scheduled_runs r LEFT JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE r.run_id!=?1 AND (r.format_version!=1 OR e.format_version!=1 OR e.run_id IS NULL OR (e.release_kind IS NULL AND (r.delivery_state NOT IN ('terminal','cancelled') OR r.needs_attention=1))))
      OR EXISTS(SELECT 1 FROM chat_turns t WHERE {active} AND (t.status IN ('streaming','stopping') OR t.submission_status='uncertain' OR (t.status='queued' AND COALESCE(t.submission_status,'queued') NOT IN ('failed','cancelled'))) AND NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_runs r ON r.run_id=b.run_id WHERE b.run_id=?1 AND b.local_turn_id=t.id AND b.conversation_id=t.session_id AND r.operation_id=t.operation_id))
      OR EXISTS(SELECT 1 FROM chat_outbox o WHERE o.kind IN ('create_session','start_turn','interrupt_turn') AND o.state IN ('pending','inflight') AND {outbox} AND (o.kind!='interrupt_turn' OR {interrupt}) AND NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_runs r ON r.run_id=b.run_id WHERE b.run_id=?1 AND o.scheduled_run_id=r.run_id AND o.session_id=b.conversation_id AND ((o.kind='create_session' AND o.operation_id=b.create_operation_id) OR (o.kind='start_turn' AND o.operation_id=r.operation_id))))
      OR EXISTS(SELECT 1 FROM chat_public_task_bindings p WHERE p.state IN ('pending','inflight','retry_wait') AND NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b WHERE b.run_id=?1 AND b.create_operation_id=p.create_operation_id AND b.conversation_id=p.session_id) AND NOT EXISTS(SELECT 1 FROM chat_scheduled_run_bindings b JOIN chat_scheduled_recovery e ON e.run_id=b.run_id WHERE b.create_operation_id=p.create_operation_id AND e.format_version=1 AND e.release_kind IS NOT NULL))"),[run],|r|r.get(0)).map_err(db_error)
}

pub(crate) fn eligible_operation(
    db: &Connection,
    scope: &ChatScope,
    a: Option<&ScheduleAuthority>,
    at: i64,
    lifecycle: Option<&Lifecycle>,
    manual: &super::super::manual::NativeState,
) -> Result<Option<Uuid>, ChatError> {
    let Some(a) = a else { return Ok(None) };
    if !super::super::recovery::present(db)? {
        return Ok(None);
    };
    let mut q=db.prepare("SELECT o.operation_id FROM chat_outbox o JOIN chat_scheduled_reservation v ON v.run_id=o.scheduled_run_id WHERE o.kind IN ('create_session','start_turn') AND o.state IN ('pending','inflight') AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?1) ORDER BY o.operation_id LIMIT 2").map_err(db_error)?;
    let rows = q
        .query_map([at], |r| r.get::<_, String>(0))
        .map_err(db_error)?;
    for row in rows {
        let op =
            Uuid::parse_str(&row.map_err(db_error)?).map_err(|_| ChatError::DatabaseUnavailable)?;
        if !super::super::automatic::allows(db, scope, a, op, at, lifecycle, manual) {
            continue;
        }
        match validate_operation(db, scope, a, op, at, false, lifecycle) {
            Ok(_) => return Ok(Some(op)),
            Err(ChatError::DatabaseUnavailable) => return Err(ChatError::DatabaseUnavailable),
            Err(_) => {}
        }
    }
    Ok(None)
}

impl ChatRepository {
    fn dispatch_directory(&self, project: &str) -> Result<PathBuf, ChatError> {
        let path = self.resolve_schedule_project(project)?;
        let hash = format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()));
        let matches:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_projects WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3 AND canonical_hash=?4 AND removed_at IS NULL)",params![project,self.scope.owner_user_id,self.scope.tenant_id,hash],|r|r.get(0)).map_err(db_error)?;
        if !matches {
            return Err(ChatError::ProjectUnavailable);
        }
        Ok(path)
    }
    pub(crate) fn scheduled_dispatch_context(
        &self,
        operation: Uuid,
    ) -> Result<Option<Context>, ChatError> {
        if !guard::present(&self.connection)? {
            return Ok(None);
        };
        let scheduled:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE operation_id=?1 AND scheduled_run_id IS NOT NULL AND kind!='interrupt_turn')",[operation.to_string()],|r|r.get(0)).map_err(db_error)?;
        if !scheduled {
            return Ok(None);
        };
        let at = timestamp()?;
        let a = self
            .schedule_dispatch_authority
            .as_ref()
            .ok_or(ChatError::OrchestrationUnavailable)?
            .schedule_authority(at)
            .map_err(|_| ChatError::ScopeDenied)?;
        if !super::super::automatic::allows(
            &self.connection,
            &self.scope,
            &a,
            operation,
            at,
            self.schedule_trigger_lifecycle.as_ref(),
            &self.manual_runtime,
        ) {
            return Err(ChatError::ConversationConflict);
        }
        validate_operation(
            &self.connection,
            &self.scope,
            &a,
            operation,
            at,
            true,
            self.schedule_trigger_lifecycle.as_ref(),
        )
        .map(Some)
    }
    pub(crate) fn scheduled_operation_cancelled(&self, operation: Uuid) -> Result<bool, ChatError> {
        if !super::super::recovery::present(&self.connection)? {
            return Ok(false);
        }
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox o JOIN chat_scheduled_runs r ON r.run_id=o.scheduled_run_id JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE o.operation_id=?1 AND r.owner_user_id=?2 AND r.tenant_id=?3 AND r.delivery_state='cancelled' AND e.release_kind='never_sent_cancel')",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|r.get(0)).map_err(db_error)
    }
    pub(crate) fn schedule_dispatch_failed(
        &mut self,
        operation: Uuid,
        code: &str,
    ) -> Result<Option<bool>, ChatError> {
        if !super::super::recovery::present(&self.connection)? {
            return Ok(None);
        };
        let tx = self.connection.transaction().map_err(db_error)?;
        let row:Option<(String,String,String)>=tx.query_row("SELECT o.scheduled_run_id,o.kind,CASE WHEN o.kind='create_session' THEN e.create_attempt ELSE e.turn_attempt END FROM chat_outbox o JOIN chat_scheduled_recovery e ON e.run_id=o.scheduled_run_id JOIN chat_scheduled_runs r ON r.run_id=e.run_id WHERE o.operation_id=?1 AND o.kind IN ('create_session','start_turn') AND r.owner_user_id=?2 AND r.tenant_id=?3 AND e.release_kind IS NULL",params![operation.to_string(),self.scope.owner_user_id,self.scope.tenant_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
        let Some((run, kind, attempt)) = row else {
            return Ok(None);
        };
        // Keep the original operation observable, never manufacture a native terminal.
        tx.execute("UPDATE chat_outbox SET state=CASE WHEN ?2='never' THEN 'pending' ELSE state END,next_attempt_at=CASE WHEN ?2='never' THEN ?3 ELSE NULL END WHERE operation_id=?1",params![operation.to_string(),attempt,timestamp()?+5]).map_err(db_error)?;
        tx.execute("UPDATE chat_scheduled_runs SET delivery_state=CASE WHEN ?2='never' THEN delivery_state ELSE 'uncertain' END,needs_attention=1 WHERE run_id=?1",params![run,attempt]).map_err(db_error)?;
        if kind == "start_turn" && attempt != "never" {
            tx.execute("UPDATE chat_turns SET submission_status='uncertain' WHERE operation_id=?1 AND runtime_turn_id IS NULL",[operation.to_string()]).map_err(db_error)?;
        }
        // Closed content-free native/Host code, not response text or prompt data.
        if tx
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map_err(db_error)?
            >= crate::chat::migrations::SCHEDULE_DISPATCH_SCHEMA_VERSION
        {
            let column = if kind == "create_session" {
                "create_error_code"
            } else {
                "turn_error_code"
            };
            tx.execute(
                &format!("UPDATE chat_scheduled_recovery SET {column}=?2 WHERE run_id=?1"),
                params![run, code],
            )
            .map_err(db_error)?;
        }
        if attempt != "never" {
            triggers::hold_unknown(&tx, &run)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(Some(attempt != "never"))
    }
}

#[derive(Clone)]
pub(crate) struct Admission {
    pub(crate) database: DatabaseWorker,
    pub(crate) lifecycle: Lifecycle,
    pub(crate) epoch: u64,
    pub(crate) operation: Uuid,
    pub(crate) context: Context,
    pub(crate) directory: PathBuf,
}
impl Admission {
    /// Runs after Host readiness/token/identity awaits, immediately before POST.
    pub(crate) async fn begin(
        &self,
        host: &HostBridge,
        path: &str,
        body: &[u8],
    ) -> Result<(), ChatError> {
        self.lifecycle.validate(self.epoch)?;
        let c = &self.context;
        let expected = if c.kind == "create_session" {
            format!(
                "/v1/tasks/{}/agent-sessions",
                c.task.ok_or(ChatError::ConversationConflict)?
            )
        } else {
            format!(
                "/v1/agent-sessions/{}/permission-turns",
                c.session.ok_or(ChatError::ConversationConflict)?
            )
        };
        if path != expected {
            return Err(ChatError::ConversationConflict);
        }
        let payload: serde_json::Value =
            serde_json::from_slice(body).map_err(|_| ChatError::InvalidInput)?;
        let valid_body = if c.kind == "create_session" {
            payload["cwd"].as_str() == self.directory.to_str()
                && payload["request_id"] == self.operation.to_string()
        } else {
            payload["permission_mode"] == "ask"
                && payload["turn"]["operation_id"] == self.operation.to_string()
        };
        if !valid_body {
            return Err(ChatError::ConversationConflict);
        };
        if let Some(session) = c.session {
            let state = host
                .get_session(session)
                .await
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let approvals = host
                .runtime_approvals(session)
                .await
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
            if state.agent_session_id != session
                || Some(state.task_id) != c.task
                || state.codex_thread_id != c.thread
                || state.active_turn_id.is_some()
                || state.state != HostSessionState::Idle
                || !state.model_ready
                || state.cwd != self.directory
                || approvals.requests.iter().any(|p| p.status == "pending")
            {
                let run = c.run.clone();
                self.database
                    .call(move |r| r.automatic_busy(&run, timestamp()?))
                    .await?;
                return Err(ChatError::ConversationConflict);
            }
        }
        let expected = self.context.clone();
        let path = self.directory.clone();
        let operation = self.operation;
        let nonce = host.instance_nonce().to_owned();
        let gate = self.lifecycle.clone();
        let epoch = self.epoch;
        self.database
            .call(move |r| {
                gate.validate(epoch)?;
                let context = r
                    .scheduled_dispatch_context(operation)?
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                if context != expected || r.dispatch_directory(&context.project)? != path {
                    return Err(ChatError::ConversationConflict);
                };
                if context.automatic.is_none()
                    && r.manual_runtime.enabled
                    && r.manual_runtime
                        .host
                        .as_ref()
                        .is_none_or(|(h, e)| h != &nonce || *e != epoch)
                {
                    return Err(ChatError::OrchestrationUnavailable);
                }
                r.begin_conversation_dispatch(operation, &nonce)
            })
            .await?;
        self.lifecycle.validate(self.epoch)?;
        if let Some((ticket, at)) = &self.context.automatic {
            self.lifecycle.validate_ticket(ticket, *at, timestamp()?)?;
        }
        Ok(())
    }
}

pub(crate) async fn admitted_host(
    database: &DatabaseWorker,
    host: &HostBridge,
    gate: &Lifecycle,
    epoch: u64,
    operation: Uuid,
) -> Result<HostBridge, ChatError> {
    let context = database
        .call(move |r| r.scheduled_dispatch_context(operation))
        .await?;
    if let Some(context) = context {
        let project = context.project.clone();
        let directory = database
            .call(move |r| r.dispatch_directory(&project))
            .await?;
        gate.validate(epoch)?;
        Ok(host.with_schedule_admission(Admission {
            database: database.clone(),
            lifecycle: gate.clone(),
            epoch,
            operation,
            context,
            directory,
        }))
    } else if let Some(context) = database
        .call(move |r| r.draft_context_for_operation(operation))
        .await?
    {
        gate.validate(epoch)?;
        Ok(
            host.with_draft_admission(super::super::draft_admission::Admission {
                database: database.clone(),
                lifecycle: gate.clone(),
                epoch,
                operation,
                context,
            }),
        )
    } else {
        database
            .begin_conversation_dispatch(operation, host.instance_nonce().to_owned())
            .await?;
        gate.validate(epoch)?;
        Ok(host.clone())
    }
}
