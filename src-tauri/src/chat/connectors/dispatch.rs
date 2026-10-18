//! Native durable market delivery, alongside (never through) the legacy outbox.
use super::{generated as management, host_generated as wire, selection_generated};
use crate::chat::{
    application::DispatchOutcome,
    authorization::ChatAuthorizationManager,
    database::{ChatRepository, ChatScope},
    error::ChatError,
    experts::{generated as expert_wire, store as expert_store},
    host_bridge::HostBridge,
    lifecycle::Lifecycle,
    public_tasks::{PublicTaskControlPlane, PublicTaskCreateIntent, PublicTaskCreateOutcome},
    worker::DatabaseWorker,
};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn id(value: &str) -> Result<Uuid, ChatError> {
    Uuid::parse_str(value).map_err(|_| ChatError::DatabaseUnavailable)
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, ChatError> {
    serde_json::from_str(value).map_err(|_| ChatError::DatabaseUnavailable)
}

fn expert_submission_issue(error: super::control::ExpertControlError) -> String {
    match error {
        super::control::ExpertControlError::Rejected(error) => serde_json::to_value(error.code)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "submission_unknown".into()),
        _ => "submission_unknown".into(),
    }
}

#[derive(Clone)]
struct Pending {
    operation: Uuid,
    session: Uuid,
    turn: Uuid,
    turn_operation: Uuid,
    snapshot: selection_generated::SelectionSnapshot,
    authorization_revision: u64,
    permission_mode: wire::PermissionMode,
    state: String,
    native_epoch: Option<String>,
    task: Option<Uuid>,
    client_reference: Uuid,
    project: String,
    agent_session: Option<Uuid>,
    scope: ChatScope,
    expert_snapshot: Option<expert_wire::TurnExpertSnapshot>,
}

impl ChatRepository {
    fn pending_market(&self, now: i64) -> Result<Option<Pending>, ChatError> {
        self.pending_market_with_experts(now, crate::chat::experts::enabled())
    }

    fn pending_market_with_experts(
        &self,
        now: i64,
        experts_enabled: bool,
    ) -> Result<Option<Pending>, ChatError> {
        let exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='chat_market_dispatch')",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if !exists || self.schedule_background_only {
            return Ok(None);
        }
        let expert_filter = if !experts_enabled
            && super::selection::expert_storage_available(&self.connection)?
        {
            "AND (d.state!='pending' OR NOT EXISTS(SELECT 1 FROM chat_expert_submissions e WHERE e.submission_operation_id=m.submission_operation_id))"
        } else {
            ""
        };
        let sql = format!("SELECT m.submission_operation_id,m.session_id,m.local_turn_id,m.turn_operation_id,m.snapshot_json,m.authorization_revision,m.permission_mode,d.state,m.native_process_epoch,b.public_task_id,b.client_reference_id,s.project_id,s.agent_session_id FROM chat_market_submissions m JOIN chat_market_dispatch d ON d.submission_operation_id=m.submission_operation_id JOIN chat_sessions s ON s.id=m.session_id JOIN chat_public_task_bindings b ON b.session_id=s.id WHERE s.owner_user_id=?1 AND s.tenant_id=?2 AND m.format_version=1 AND d.format_version=1 AND m.authorization_revision>0 AND (d.state='pending' OR (d.state IN ('inflight','uncertain') AND d.updated_at<=?3)) AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id) {expert_filter} ORDER BY m.created_at,m.submission_operation_id LIMIT 1");
        let mut q = self.connection.prepare(&sql).map_err(db_error)?;
        type Row = (
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            Option<String>,
        );
        let row: Option<Row> = q
            .query_row(
                params![self.scope.owner_user_id, self.scope.tenant_id, now - 5],
                |r| {
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
                        r.get(11)?,
                        r.get(12)?,
                    ))
                },
            )
            .optional()
            .map_err(db_error)?;
        row.map(|r| {
            let expert_snapshot = expert_store::submission(&self.connection, &self.scope, &r.0)
                .map_err(|_| ChatError::DatabaseUnavailable)?
                .map(|value| value.0);
            if expert_snapshot.is_none()
                && super::selection::expert_managed(&self.connection, &r.1)?
            {
                return Err(ChatError::DatabaseUnavailable);
            }
            if expert_snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot.turn_operation_id != r.3)
            {
                return Err(ChatError::DatabaseUnavailable);
            }
            Ok(Pending {
                operation: id(&r.0)?,
                session: id(&r.1)?,
                turn: id(&r.2)?,
                turn_operation: id(&r.3)?,
                snapshot: decode(&r.4)?,
                authorization_revision: u64::try_from(r.5)
                    .map_err(|_| ChatError::DatabaseUnavailable)?,
                permission_mode: decode(&format!("\"{}\"", r.6))?,
                state: r.7,
                native_epoch: r.8,
                task: r.9.as_deref().map(id).transpose()?,
                client_reference: id(&r.10)?,
                project: r.11,
                agent_session: r.12.as_deref().map(id).transpose()?,
                scope: self.scope.clone(),
                expert_snapshot,
            })
        })
        .transpose()
    }

    fn market_public_claim(&mut self, pending: &Pending, now: i64) -> Result<(), ChatError> {
        let changed=self.connection.execute("UPDATE chat_public_task_bindings SET state='inflight',attempt_count=attempt_count+1,lease_expires_at=?2,next_attempt_at=NULL,last_error_code=NULL,updated_at=?3 WHERE create_operation_id=?1 AND state IN ('pending','inflight','retry_wait') AND public_task_id IS NULL AND attempt_count<16",params![pending.operation.to_string(),now+30,now]).map_err(db_error)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        Ok(())
    }

    fn market_body(
        &self,
        pending: &Pending,
        now: i64,
        admission: Option<&super::provider::ProviderAdmission>,
    ) -> Result<wire::Submission, ChatError> {
        let task = pending.task.ok_or(ChatError::ConversationConflict)?;
        if let Some(snapshot) = &pending.expert_snapshot {
            let binding =
                expert_store::read(&self.connection, &self.scope, &pending.session.to_string())
                    .map_err(|_| ChatError::OrchestrationUnavailable)?;
            let reference = expert_store::reference(
                &self.connection,
                &self.scope,
                &pending.session.to_string(),
            )
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
            if binding.binding_revision != snapshot.binding_revision || reference != snapshot.expert
            {
                return Err(ChatError::ConversationConflict);
            }
        }
        let current_permission = self.permission_state(Some(pending.session))?.mode.as_str();
        let frozen_permission = match pending.permission_mode {
            wire::PermissionMode::Ask => "ask",
            wire::PermissionMode::Auto => "auto",
            wire::PermissionMode::Full => "full",
        };
        if current_permission != frozen_permission
            || (!pending.snapshot.selection.is_empty() && frozen_permission != "ask")
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let (message, digest): (String,String) = self.connection.query_row("SELECT m.id,json_extract(CAST(o.encrypted_payload AS TEXT),'$.block_digest') FROM chat_messages m JOIN chat_turns t ON t.id=m.turn_id JOIN chat_outbox o ON o.operation_id=?1 WHERE t.id=?2 AND t.session_id=?3 AND m.role='user' AND o.payload_version=2",params![pending.operation.to_string(),pending.turn.to_string(),pending.session.to_string()], |r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        if crate::chat::database::stored_content_block_digest(&self.connection, id(&message)?)?
            != digest
        {
            return Err(ChatError::DatabaseUnavailable);
        }
        let content_blocks = self
            .materialize_turn_blocks(&message, now)?
            .into_iter()
            .map(|block| {
                // Reuse the existing attachment materializer; the generated Host
                // schema is the sole wire authority for its full content blocks.
                let value = serde_json::to_value(block).map_err(|_| ChatError::InvalidInput)?;
                serde_json::from_value::<wire::ContentBlock>(value)
                    .map_err(|_| ChatError::InvalidInput)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let (profile, revision): (String,i64) = self.connection.query_row("SELECT profile_id,revision FROM chat_operation_models WHERE operation_id=?1 AND session_id=?2",params![pending.turn_operation.to_string(),pending.session.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        let profile_id = decode(&format!("\"{profile}\""))?;
        if !pending.snapshot.selection.is_empty() {
            let admission = admission.ok_or(ChatError::OrchestrationUnavailable)?;
            super::provider::preflight(
                &self.connection,
                &self.scope,
                &pending.snapshot.selection,
                admission,
            )
            .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        let services = bindings(self, &pending.snapshot.selection)?;
        let cwd = self
            .resolve_schedule_project(&pending.project)?
            .to_str()
            .ok_or(ChatError::InvalidInput)?
            .to_owned();
        let body = wire::Submission {
            task_id: task.to_string(),
            local_session_id: pending.session.to_string(),
            agent_session_id: pending.agent_session.map(|id| id.to_string()),
            submission_operation_id: pending.operation.to_string(),
            cwd,
            content_blocks,
            intent: wire::ModelIntent {
                profile_id,
                expected_revision: revision,
            },
            permission_mode: pending.permission_mode,
            snapshot: pending.snapshot.clone(),
            services,
        };
        body.validate().map_err(|_| ChatError::InvalidInput)?;
        Ok(body)
    }

    fn market_mark(
        &mut self,
        operation: Uuid,
        state: &str,
        host: Option<&str>,
        code: Option<&str>,
        now: i64,
    ) -> Result<(), ChatError> {
        let tx = self.connection.transaction().map_err(db_error)?;
        let changed=tx.execute("UPDATE chat_market_dispatch SET state=?2,host_instance_id=COALESCE(?3,host_instance_id),issue_code=CASE WHEN ?2='uncertain' AND ?4 IS NULL THEN issue_code ELSE ?4 END,updated_at=?5 WHERE submission_operation_id=?1 AND state IN ('pending','inflight','uncertain')",params![operation.to_string(),state,host,code,now]).map_err(db_error)?;
        if changed != 1 {
            return Err(ChatError::ConversationConflict);
        }
        if state == "blocked" {
            tx.execute("UPDATE chat_turns SET status='failed',submission_status='failed' WHERE id=(SELECT local_turn_id FROM chat_market_submissions WHERE submission_operation_id=?1) AND runtime_turn_id IS NULL",[operation.to_string()]).map_err(db_error)?;
            tx.execute("UPDATE chat_outbox SET state='failed',next_attempt_at=NULL WHERE operation_id IN (SELECT operation_id FROM chat_market_operation_refs WHERE submission_operation_id=?1) AND state IN ('pending','inflight')",[operation.to_string()]).map_err(db_error)?;
        }
        if state == "uncertain" {
            tx.execute("UPDATE chat_turns SET submission_status='uncertain' WHERE id=(SELECT local_turn_id FROM chat_market_submissions WHERE submission_operation_id=?1) AND runtime_turn_id IS NULL",[operation.to_string()]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)
    }

    fn settle_expert_busy_rejection(
        &mut self,
        pending: &Pending,
        now: i64,
    ) -> Result<bool, ChatError> {
        // The worker serializes this recheck and the existing terminal write.
        // Only the correlated expert-submit busy diagnostic is qualifying;
        // a missing receipt or an unknown transport result alone never is.
        let confirmed: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chat_market_dispatch d
             JOIN chat_market_submissions m USING(submission_operation_id)
             JOIN chat_expert_submissions e USING(submission_operation_id)
             JOIN chat_turns t ON t.id=m.local_turn_id AND t.session_id=m.session_id
             JOIN chat_sessions s ON s.id=m.session_id
             WHERE d.submission_operation_id=?1 AND m.session_id=?2 AND m.local_turn_id=?3
               AND m.turn_operation_id=?4 AND d.state='uncertain' AND d.issue_code='busy'
               AND d.host_instance_id IS NOT NULL AND t.runtime_turn_id IS NULL
               AND t.submission_status='uncertain' AND s.owner_user_id=?5 AND s.tenant_id=?6)",
                params![
                    pending.operation.to_string(),
                    pending.session.to_string(),
                    pending.turn.to_string(),
                    pending.turn_operation.to_string(),
                    self.scope.owner_user_id,
                    self.scope.tenant_id
                ],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        if confirmed {
            self.market_mark(pending.operation, "blocked", None, Some("busy"), now)?;
        }
        Ok(confirmed)
    }

    fn market_accept(
        &mut self,
        pending: &Pending,
        receipt: &wire::SubmissionReceipt,
    ) -> Result<(), ChatError> {
        receipt
            .validate()
            .map_err(|_| ChatError::ConversationConflict)?;
        let task = pending.task.ok_or(ChatError::ConversationConflict)?;
        if receipt.state != wire::SubmissionState::Accepted
            || receipt.task_id != task.to_string()
            || receipt.local_session_id != pending.session.to_string()
            || receipt.submission_operation_id != pending.operation.to_string()
            || receipt.turn_operation_id != pending.turn_operation.to_string()
            || receipt.selection_digest != pending.snapshot.selection_digest
        {
            return Err(ChatError::ConversationConflict);
        }
        let agent = id(receipt
            .agent_session_id
            .as_deref()
            .ok_or(ChatError::ConversationConflict)?)?;
        let thread = id(receipt
            .native_thread_id
            .as_deref()
            .ok_or(ChatError::ConversationConflict)?)?;
        let turn = id(receipt
            .native_turn_id
            .as_deref()
            .ok_or(ChatError::ConversationConflict)?)?;
        if pending.agent_session.is_some_and(|value| value != agent) {
            return Err(ChatError::ConversationConflict);
        }
        let tx = self.connection.transaction().map_err(db_error)?;
        if pending.expert_snapshot.is_some() {
            let original_host: Option<String> = tx
                .query_row(
                    "SELECT host_instance_id FROM chat_market_dispatch WHERE submission_operation_id=?1",
                    [pending.operation.to_string()],
                    |row| row.get(0),
                )
                .map_err(db_error)?;
            // Recovery may run under a new Host. Only the owner recorded before
            // the original dispatch can acknowledge this immutable attempt.
            if original_host.as_deref() != Some(receipt.host_instance_id.as_str()) {
                return Err(ChatError::ConversationConflict);
            }
        }
        let (profile, revision): (String, i64) = tx
            .query_row(
                "SELECT profile_id,revision FROM chat_operation_models WHERE operation_id=?1",
                [pending.turn_operation.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(db_error)?;
        if profile != crate::chat::models::profile_id(receipt.profile_id)
            || if pending.operation != pending.turn_operation {
                1
            } else {
                revision
            } != receipt.model_revision
        {
            return Err(ChatError::ConversationConflict);
        }
        if pending.operation != pending.turn_operation {
            Self::bind_host_session_parts(
                &tx,
                &self.scope,
                [pending.operation, task, agent, thread],
                super::now().map_err(|_| ChatError::DatabaseUnavailable)?,
                true,
                true,
            )?;
        } else {
            let existing: (String, String) = tx
                .query_row(
                    "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1",
                    [pending.session.to_string()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(db_error)?;
            if existing != (agent.to_string(), thread.to_string()) {
                return Err(ChatError::ConversationConflict);
            }
        }
        Self::bind_started_turn_parts(
            &tx,
            &self.scope,
            pending.turn_operation,
            turn,
            Some(&receipt.host_instance_id),
            true,
        )?;
        let text = serde_json::to_string(receipt).map_err(|_| ChatError::DatabaseUnavailable)?;
        tx.execute("UPDATE chat_market_dispatch SET state='accepted',receipt_json=?2,issue_code=NULL WHERE submission_operation_id=?1",params![pending.operation.to_string(),text]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }

    fn expert_accept(
        &mut self,
        pending: &Pending,
        receipt: &expert_wire::PrivateReceipt,
    ) -> Result<(), ChatError> {
        receipt
            .validate()
            .map_err(|_| ChatError::ConversationConflict)?;
        if pending.expert_snapshot.as_ref() != Some(&receipt.expert_snapshot) {
            return Err(ChatError::ConversationConflict);
        }
        // Store the compatible market receipt only after the full private
        // wrapper agrees with the immutable snapshot in the same submission.
        self.market_accept(pending, &receipt.receipt)
    }
}

fn dispatch_authority(
    authority: &ChatAuthorizationManager,
    pending: &Pending,
    create: bool,
    now: i64,
) -> Result<super::broker_generated::ScopeBinding, crate::chat::authorization::AuthorizationFailure>
{
    if let Some(snapshot) = &pending.expert_snapshot {
        authority.expert_dispatch_authority(
            &pending.scope,
            pending.authorization_revision,
            create,
            !pending.snapshot.selection.is_empty(),
            snapshot.expert.is_some(),
            now,
        )
    } else {
        authority.market_dispatch_authority(
            &pending.scope,
            pending.authorization_revision,
            create,
            !pending.snapshot.selection.is_empty(),
            now,
        )
    }
}

enum ExpertReceiptRead {
    Found(Box<expert_wire::PrivateReceipt>),
    Missing,
}

async fn read_expert_receipt(
    host: &HostBridge,
    authority: &ChatAuthorizationManager,
    pending: &Pending,
    lifecycle: &Lifecycle,
    epoch: u64,
    now: i64,
) -> Result<ExpertReceiptRead, ChatError> {
    let scope = authority
        .expert_observation_authority(&pending.scope, now)
        .map_err(|_| ChatError::ScopeDenied)?;
    let control = host.market_control().ok_or(ChatError::SidecarUnavailable)?;
    let request = expert_wire::SubmissionReadRequest {
        schema_version: 1,
        request_id: Uuid::now_v7().to_string(),
        method: "expert_submission_read".into(),
        payload: expert_wire::SubmissionReadPayload {
            host_instance_id: host.instance_nonce().into(),
            scope,
            task_id: pending
                .task
                .ok_or(ChatError::ConversationConflict)?
                .to_string(),
            local_session_id: pending.session.to_string(),
            turn_operation_id: pending.turn_operation.to_string(),
        },
    };
    request.validate().map_err(|_| ChatError::InvalidInput)?;
    lifecycle.validate(epoch)?;
    let response: Result<expert_wire::SubmissionReadResponse, _> = control
        .expert_request(&request.request_id, &request, &request.method)
        .await;
    lifecycle.validate(epoch)?;
    authority
        .expert_observation_authority(
            &pending.scope,
            super::now().map_err(|_| ChatError::DatabaseUnavailable)?,
        )
        .map_err(|_| ChatError::ScopeDenied)?;
    match response {
        Ok(response) => Ok(ExpertReceiptRead::Found(Box::new(response.data))),
        Err(super::control::ExpertControlError::Rejected(error))
            if error.code == expert_wire::ErrorCode::NotFound =>
        {
            Ok(ExpertReceiptRead::Missing)
        }
        _ => Err(ChatError::OrchestrationUnavailable),
    }
}

pub(crate) fn bindings(
    repo: &ChatRepository,
    refs: &[management::SelectionRef],
) -> Result<Vec<wire::ServiceBinding>, ChatError> {
    refs.iter()
        .map(|reference| {
            let item = super::store::find(
                &repo.connection,
                &repo.scope,
                &super::catalog().catalog,
                &reference.installation_id,
            )
            .map_err(|_| ChatError::ConversationConflict)?;
            if item.status != management::InstallationStatus::Installed
                || !item.desired_enabled
                || item.revision != reference.revision
                || item.generation != reference.generation
            {
                return Err(ChatError::ConversationConflict);
            }
            Ok(wire::ServiceBinding {
                reference: reference.clone(),
                service_id: item.service_id,
                credential_ref: item
                    .credential_ref
                    .ok_or(ChatError::OrchestrationUnavailable)?,
            })
        })
        .collect()
}

/// One bounded step in the existing Coordinator. Unknown submissions only query
/// the original durable operation; they never register a replacement grant.
pub(crate) async fn next(
    database: &DatabaseWorker,
    host: &HostBridge,
    authority: &ChatAuthorizationManager,
    public_tasks: &dyn PublicTaskControlPlane,
    lifecycle: &Lifecycle,
    epoch: u64,
    now: i64,
) -> Result<Option<DispatchOutcome>, ChatError> {
    let Some(mut pending) = database.call(move |r| r.pending_market(now)).await? else {
        return Ok(None);
    };
    let operation = pending.operation;
    // Feature-off keeps compatible receipt observation for an already attempted
    // turn, while prohibiting fresh expert grants/submissions.
    if pending.expert_snapshot.is_some()
        && pending.state == "pending"
        && !crate::chat::experts::enabled()
    {
        return Ok(Some(DispatchOutcome::Idle));
    }
    if pending.state != "pending" {
        database
            .call(move |r| r.market_mark(operation, "uncertain", None, None, now))
            .await?;
        if let Some(task) = pending.task {
            if pending.expert_snapshot.is_some() {
                match read_expert_receipt(host, authority, &pending, lifecycle, epoch, now).await {
                    Ok(ExpertReceiptRead::Found(receipt))
                        if receipt.receipt.state == wire::SubmissionState::Accepted =>
                    {
                        let saved = pending.clone();
                        database
                            .call(move |r| r.expert_accept(&saved, &receipt))
                            .await?;
                        return Ok(Some(DispatchOutcome::TurnAccepted {
                            session_id: pending.session,
                        }));
                    }
                    Ok(ExpertReceiptRead::Missing) => {
                        let saved = pending.clone();
                        if database
                            .call(move |r| r.settle_expert_busy_rejection(&saved, now))
                            .await?
                        {
                            return Ok(Some(DispatchOutcome::FailedSafely {
                                operation_id: operation,
                            }));
                        }
                    }
                    _ => {}
                }
            } else if let Ok(receipt) = host.market_operation(task, pending.turn_operation).await {
                if receipt.state == wire::SubmissionState::Accepted {
                    let saved = pending.clone();
                    database
                        .call(move |r| r.market_accept(&saved, &receipt))
                        .await?;
                    return Ok(Some(DispatchOutcome::TurnAccepted {
                        session_id: pending.session,
                    }));
                }
            }
        }
        return Ok(Some(DispatchOutcome::Idle));
    }
    let _admission = authority.market_admission_lock().await;
    let control = host.market_control().ok_or(ChatError::SidecarUnavailable)?;
    let create = pending.operation != pending.turn_operation;
    let admission_now = super::now().map_err(|_| ChatError::OrchestrationUnavailable)?;
    let auth = dispatch_authority(authority, &pending, create, admission_now);
    let scope = match auth {
        Ok(scope)
            if pending.native_epoch.as_deref() == Some(scope.native_process_epoch.as_str()) =>
        {
            scope
        }
        Ok(_) => {
            database
                .call(move |r| {
                    r.market_mark(
                        operation,
                        "blocked",
                        None,
                        Some("native_epoch_expired"),
                        now,
                    )
                })
                .await?;
            return Ok(Some(DispatchOutcome::FailedSafely {
                operation_id: operation,
            }));
        }
        Err(_) => {
            database
                .call(move |r| {
                    r.market_mark(
                        operation,
                        "blocked",
                        None,
                        Some("authority_unavailable"),
                        now,
                    )
                })
                .await?;
            return Ok(Some(DispatchOutcome::FailedSafely {
                operation_id: operation,
            }));
        }
    };
    lifecycle.validate(epoch)?;
    let provider = match super::provider::read_admission(
        database,
        host,
        &pending.scope,
        scope.clone(),
        &pending.snapshot.selection,
    )
    .await
    {
        Ok(admission) => admission,
        Err(_) => {
            database
                .call(move |r| {
                    r.market_mark(
                        operation,
                        "blocked",
                        None,
                        Some("selection_unavailable"),
                        now,
                    )
                })
                .await?;
            return Ok(Some(DispatchOutcome::FailedSafely {
                operation_id: operation,
            }));
        }
    };
    lifecycle.validate(epoch)?;
    if dispatch_authority(
        authority,
        &pending,
        create,
        super::now().map_err(|_| ChatError::OrchestrationUnavailable)?,
    )
    .is_err()
    {
        database
            .call(move |r| {
                r.market_mark(
                    operation,
                    "blocked",
                    None,
                    Some("authority_unavailable"),
                    now,
                )
            })
            .await?;
        return Ok(Some(DispatchOutcome::FailedSafely {
            operation_id: operation,
        }));
    }
    if pending.task.is_none() {
        let saved = pending.clone();
        database
            .call(move |r| r.market_public_claim(&saved, now))
            .await?;
        match public_tasks
            .create_task(PublicTaskCreateIntent {
                operation_id: operation,
                client_reference_id: pending.client_reference,
                authorization_revision: pending.authorization_revision,
            })
            .await
        {
            PublicTaskCreateOutcome::Bound { public_task_id } => {
                database
                    .bind_public_task(operation, public_task_id, now)
                    .await?;
                pending.task = Some(public_task_id);
            }
            _ => {
                database
                    .call(move |r| {
                        r.market_mark(
                            operation,
                            "blocked",
                            None,
                            Some("public_task_unavailable"),
                            now,
                        )
                    })
                    .await?;
                return Ok(Some(DispatchOutcome::FailedSafely {
                    operation_id: operation,
                }));
            }
        }
    }
    let saved = pending.clone();
    let body = match database
        .call(move |r| r.market_body(&saved, now, Some(&provider)))
        .await
    {
        Ok(body) => body,
        Err(error) => {
            database
                .call(move |r| {
                    r.market_mark(
                        operation,
                        "blocked",
                        None,
                        Some("selection_unavailable"),
                        now,
                    )
                })
                .await?;
            return Err(error);
        }
    };
    lifecycle.validate(epoch)?;
    let registration: Result<wire::GrantRegistration, ()> =
        if let Some(snapshot) = &pending.expert_snapshot {
            let request = expert_wire::PrivateGrantRequest {
                schema_version: 1,
                request_id: Uuid::now_v7().to_string(),
                method: "expert_grant_register".into(),
                payload: expert_wire::PrivateGrantPayload {
                    operation_id: operation.to_string(),
                    host_instance_id: host.instance_nonce().into(),
                    scope: scope.clone(),
                    submission: expert_wire::PrivateSubmission {
                        submission: body,
                        expert_snapshot: snapshot.clone(),
                    },
                },
            };
            request.validate().map_err(|_| ChatError::InvalidInput)?;
            let response: Result<expert_wire::PrivateGrantResponse, _> = control
                .expert_request(&request.request_id, &request, &request.method)
                .await;
            response.map_err(|_| ()).and_then(|response| {
                if response.data.expert_snapshot_digest != snapshot.snapshot_digest {
                    control.retire();
                    return Err(());
                }
                Ok(response.data.grant)
            })
        } else {
            let request = wire::GrantRegisterRequest {
                schema_version: 1,
                request_id: Uuid::now_v7().to_string(),
                method: "grant_register".into(),
                payload: wire::GrantRegisterPayload {
                    operation_id: operation.to_string(),
                    host_instance_id: host.instance_nonce().to_owned(),
                    scope: scope.clone(),
                    submission: body,
                },
            };
            request.validate().map_err(|_| ChatError::InvalidInput)?;
            let response: Result<wire::GrantRegisterResponse, _> =
                control.request(&request.request_id, &request).await;
            response.map(|response| response.data).map_err(|_| ())
        };
    let grant = match registration {
        Ok(grant) => grant,
        Err(_) => {
            database
                .call(move |r| {
                    r.market_mark(operation, "blocked", None, Some("grant_unavailable"), now)
                })
                .await?;
            return Ok(Some(DispatchOutcome::FailedSafely {
                operation_id: operation,
            }));
        }
    };
    if grant.host_instance_id != host.instance_nonce()
        || grant.native_process_epoch != scope.native_process_epoch
        || grant.turn_operation_id != pending.turn_operation.to_string()
        || grant.selection_digest != pending.snapshot.selection_digest
    {
        control.close().await;
        return Err(ChatError::ConversationConflict);
    }
    // Recheck after the asynchronous grant registration. Revocation never races
    // through a stale renderer context to the HTTP execution trigger.
    if dispatch_authority(
        authority,
        &pending,
        create,
        super::now().map_err(|_| ChatError::ScopeDenied)?,
    )
    .is_err()
        || lifecycle.validate(epoch).is_err()
    {
        control.retire();
        return Err(ChatError::ScopeDenied);
    }
    let instance = host.instance_nonce().to_owned();
    database
        .call(move |r| r.market_mark(operation, "inflight", Some(&instance), None, now))
        .await?;
    let trigger = wire::SubmitRequest {
        schema_version: 1,
        request_id: Uuid::now_v7().to_string(),
        payload: wire::SubmitPayload {
            grant_ref: grant.grant_ref,
            turn_operation_id: pending.turn_operation.to_string(),
        },
    };
    if !control.is_open() {
        return Err(ChatError::ScopeDenied);
    }
    let result = if pending.expert_snapshot.is_some() {
        let request = expert_wire::PrivateSubmitRequest {
            schema_version: 1,
            request_id: trigger.request_id,
            method: "expert_submit".into(),
            payload: trigger.payload,
        };
        request.validate().map_err(|_| ChatError::InvalidInput)?;
        let response: Result<expert_wire::PrivateSubmitResponse, _> = control
            .expert_request(&request.request_id, &request, &request.method)
            .await;
        response
            .map(|response| (response.data.receipt, Some(response.data.expert_snapshot)))
            .map_err(expert_submission_issue)
    } else {
        host.market_submit(&trigger)
            .await
            .map(|receipt| (receipt, None))
            .map_err(|_| "submission_unknown".to_owned())
    };
    match result {
        Ok((receipt, snapshot))
            if receipt.state == wire::SubmissionState::Accepted
                && snapshot == pending.expert_snapshot =>
        {
            let saved = pending.clone();
            database
                .call(move |r| r.market_accept(&saved, &receipt))
                .await?;
            Ok(Some(DispatchOutcome::TurnAccepted {
                session_id: pending.session,
            }))
        }
        unconfirmed => {
            // Keep the source-defined diagnostic for the original attempt.
            // Even a typed error does not prove a turn was never started, so
            // delivery stays uncertain and observation never retries submit.
            let issue = unconfirmed
                .err()
                .unwrap_or_else(|| "submission_unknown".into());
            database
                .call(move |r| r.market_mark(operation, "uncertain", None, Some(&issue), now))
                .await?;
            Ok(Some(DispatchOutcome::TurnSubmissionUncertain {
                operation_id: pending.turn_operation,
                session_id: pending.session,
                turn_id: pending.turn,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::keychain::{DatabaseKey, ReceiptKey};
    struct Fixture {
        root: std::path::PathBuf,
        repo: Option<ChatRepository>,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("feat157-dispatch-{}", Uuid::now_v7()));
            std::fs::create_dir(&root).unwrap();
            let scope =
                ChatScope::new(Uuid::now_v7().to_string(), Uuid::now_v7().to_string()).unwrap();
            let mut repo = ChatRepository::open(
                &root.join("chat"),
                &DatabaseKey::from_bytes([57; 32]),
                ReceiptKey::from_bytes([58; 32]),
                scope,
            )
            .unwrap();
            crate::chat::migrations::migrate_to_target(&mut repo.connection, 32).unwrap();
            Self {
                root,
                repo: Some(repo),
            }
        }
        fn repo(&mut self) -> &mut ChatRepository {
            self.repo.as_mut().unwrap()
        }
        fn create(&mut self) -> Pending {
            let payload:selection_generated::SubmitPayload=serde_json::from_value(serde_json::json!({"operationId":Uuid::now_v7(),"projectId":null,"contentBlocks":[{"type":"text","text":"Ordinary connector conversation"}],"intent":{"profileId":"kimi-k3-max-v1","expectedRevision":0},"selection":[]})).unwrap();
            self.repo()
                .market_submission_admitted(
                    payload,
                    1,
                    super::super::selection::ExecutionAdmission::test(),
                )
                .unwrap();
            let now = super::super::now().unwrap();
            let mut p = self.repo().pending_market(now).unwrap().unwrap();
            self.repo().market_public_claim(&p, now).unwrap();
            let task = Uuid::now_v7();
            self.repo()
                .bind_public_task(p.operation, task, now)
                .unwrap();
            p.task = Some(task);
            p
        }
        fn create_expert(&mut self) -> Pending {
            self.create_expert_input(None).0
        }
        fn create_expert_input(
            &mut self,
            attachment: Option<Uuid>,
        ) -> (Pending, expert_wire::NativeSubmitPayload) {
            crate::chat::migrations::migrate_to_target(&mut self.repo().connection, 34).unwrap();
            let mut request:expert_wire::NativeSubmitPayload=serde_json::from_value(serde_json::json!({"submission":{"operationId":Uuid::now_v7(),"projectId":null,"contentBlocks":[{"type":"text","text":"Ordinary expert dispatch storage check"}],"intent":{"profileId":"kimi-k3-max-v1","expectedRevision":0},"selection":[]},"expectedBindingRevision":0,"expert":{"expertId":"sample-expert","version":"0.1.0"}})).unwrap();
            if let Some(attachment) = attachment {
                request.submission.content_blocks.push(
                    serde_json::from_value(
                        serde_json::json!({"type":"file","attachmentId":attachment}),
                    )
                    .unwrap(),
                );
            }
            let resolved = expert_store::ResolvedExpert {
                reference: expert_wire::ExpertRef {
                    expert_id: "sample-expert".into(),
                    version: "0.1.0".into(),
                    archive_sha256: "a".repeat(64),
                    role_sha256: "b".repeat(64),
                    knowledge_manifest_sha256: "c".repeat(64),
                },
                display: expert_wire::ExpertDisplay {
                    expert_id: "sample-expert".into(),
                    version: "0.1.0".into(),
                    display_name: "普通合成专家".into(),
                    subtitle: "本地参考".into(),
                    icon_key: "skillOperations".into(),
                },
            };
            self.repo()
                .expert_submission_admitted(
                    request.clone(),
                    1,
                    super::super::selection::ExecutionAdmission::test(),
                    Some(resolved),
                )
                .unwrap();
            let now = super::super::now().unwrap();
            let mut pending = self
                .repo()
                .pending_market_with_experts(now, true)
                .unwrap()
                .unwrap();
            self.repo().market_public_claim(&pending, now).unwrap();
            let task = Uuid::now_v7();
            self.repo()
                .bind_public_task(pending.operation, task, now)
                .unwrap();
            pending.task = Some(task);
            (pending, request)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            drop(self.repo.take());
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
    #[test]
    fn feat158_expert_file_uses_existing_materializer_and_replays_after_normal_reopen() {
        use crate::chat::database::DraftTarget;
        let mut f = Fixture::new();
        let now = super::super::now().unwrap();
        let prepared = crate::chat::attachment::prepare_bytes(
            "ordinary-note.txt".into(),
            b"Ordinary storage bag: cotton, 30 cm, one item.".to_vec(),
            now,
        )
        .unwrap();
        let attachment = prepared.id;
        f.repo()
            .store_attachments(vec![prepared], 1, DraftTarget::New)
            .unwrap();
        let (pending, original_request) = f.create_expert_input(Some(attachment));
        let snapshot = pending.expert_snapshot.clone().unwrap();
        let original_body = f.repo().market_body(&pending, now, None).unwrap();
        let wrapper = expert_wire::PrivateSubmission {
            submission: original_body.clone(),
            expert_snapshot: snapshot.clone(),
        };
        wrapper.validate().unwrap();
        let value = serde_json::to_value(&wrapper).unwrap();
        let file = &value["submission"]["contentBlocks"][1];
        assert_eq!(file["type"], "file");
        assert_eq!(file["attachment_id"], attachment.to_string());
        assert_eq!(file["name"], "ordinary-note.txt");
        assert!(file["context_chunks"]
            .to_string()
            .contains("cotton, 30 cm, one item"));
        let receipt = f
            .repo()
            .expert_submission_replay(&original_request)
            .unwrap()
            .unwrap();
        let scope = f.repo().scope.clone();
        drop(f.repo.take());
        f.repo = Some(
            ChatRepository::open(
                &f.root.join("chat"),
                &DatabaseKey::from_bytes([57; 32]),
                ReceiptKey::from_bytes([58; 32]),
                scope,
            )
            .unwrap(),
        );
        assert_eq!(
            f.repo()
                .expert_submission_replay(&original_request)
                .unwrap(),
            Some(receipt)
        );
        assert_eq!(
            f.repo().market_body(&pending, now, None).unwrap(),
            original_body
        );
        assert_eq!(
            f.repo()
                .connection
                .query_row("SELECT count(*) FROM chat_expert_submissions", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(f
            .repo()
            .list_ready_attachments(DraftTarget::New)
            .unwrap()
            .is_empty());
        let repo = f.repo();
        let frozen = expert_store::submission(
            &repo.connection,
            &repo.scope,
            &pending.operation.to_string(),
        )
        .unwrap()
        .unwrap()
        .0;
        assert_eq!(frozen, snapshot);
    }
    #[test]
    fn native_market_first_turn_reuses_content_and_commits_actual_binding_atomically() {
        let mut f = Fixture::new();
        let p = f.create();
        let now = super::super::now().unwrap();
        let body = f.repo().market_body(&p, now, None).unwrap();
        assert_eq!(
            body.snapshot.turn_operation_id,
            p.turn_operation.to_string()
        );
        assert_eq!(body.task_id, p.task.unwrap().to_string());
        assert_ne!(body.task_id, body.local_session_id);
        assert_eq!(body.content_blocks.len(), 1);
        assert!(
            matches!(&body.content_blocks[0],wire::ContentBlock::Text(v) if v.text=="Ordinary connector conversation")
        );
        let receipt = wire::SubmissionReceipt {
            host_instance_id: Uuid::now_v7().to_string(),
            runtime_generation: Some(Uuid::now_v7().to_string()),
            task_id: body.task_id,
            local_session_id: body.local_session_id,
            submission_operation_id: p.operation.to_string(),
            turn_operation_id: p.turn_operation.to_string(),
            selection_digest: p.snapshot.selection_digest.clone(),
            state: wire::SubmissionState::Accepted,
            agent_session_id: Some(Uuid::now_v7().to_string()),
            native_thread_id: Some(Uuid::now_v7().to_string()),
            native_turn_id: Some(Uuid::now_v7().to_string()),
            profile_id: body.intent.profile_id,
            model_revision: 1,
        };
        f.repo().market_accept(&p, &receipt).unwrap();
        assert!(f.repo().pending_market(now + 10).unwrap().is_none());
        let actual:(String,String,String,String)=f.repo().connection.query_row("SELECT s.agent_session_id,s.runtime_thread_id,t.runtime_turn_id,t.submission_status FROM chat_turns t JOIN chat_sessions s ON s.id=t.session_id WHERE t.operation_id=?1",[p.turn_operation.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(
            actual,
            (
                receipt.agent_session_id.unwrap(),
                receipt.native_thread_id.unwrap(),
                receipt.native_turn_id.unwrap(),
                "submitted".into()
            )
        );
        let legacy = f
            .repo()
            .claim_next_conversation_outbox(now + 10, 30)
            .unwrap();
        assert!(legacy.is_none());
    }
    #[test]
    fn native_market_unknown_retains_original_operation_for_read_only_recovery() {
        let mut f = Fixture::new();
        let p = f.create();
        let now = super::super::now().unwrap();
        let host = Uuid::now_v7().to_string();
        f.repo()
            .market_mark(p.operation, "inflight", Some(&host), None, now)
            .unwrap();
        f.repo()
            .market_mark(
                p.operation,
                "uncertain",
                None,
                Some("submission_unknown"),
                now,
            )
            .unwrap();
        assert!(f.repo().pending_market(now + 4).unwrap().is_none());
        let recovery = f.repo().pending_market(now + 5).unwrap().unwrap();
        assert_eq!(recovery.operation, p.operation);
        assert_eq!(recovery.turn_operation, p.turn_operation);
        assert_eq!(recovery.state, "uncertain");
    }

    #[test]
    fn feat158_dispatch_preserves_private_snapshot_through_original_receipt_binding() {
        let mut fixture = Fixture::new();
        let pending = fixture.create_expert();
        let now = super::super::now().unwrap();
        let body = fixture.repo().market_body(&pending, now, None).unwrap();
        let snapshot = pending.expert_snapshot.clone().unwrap();
        assert_eq!(snapshot.turn_operation_id, body.snapshot.turn_operation_id);
        assert_eq!(snapshot.expert.as_ref().unwrap().expert_id, "sample-expert");
        let private = expert_wire::PrivateSubmission {
            submission: body.clone(),
            expert_snapshot: snapshot.clone(),
        };
        private.validate().unwrap();
        let receipt = expert_wire::PrivateReceipt {
            receipt: wire::SubmissionReceipt {
                host_instance_id: Uuid::now_v7().to_string(),
                runtime_generation: Some(Uuid::now_v7().to_string()),
                task_id: body.task_id,
                local_session_id: body.local_session_id,
                submission_operation_id: pending.operation.to_string(),
                turn_operation_id: pending.turn_operation.to_string(),
                selection_digest: pending.snapshot.selection_digest.clone(),
                state: wire::SubmissionState::Accepted,
                agent_session_id: Some(Uuid::now_v7().to_string()),
                native_thread_id: Some(Uuid::now_v7().to_string()),
                native_turn_id: Some(Uuid::now_v7().to_string()),
                profile_id: body.intent.profile_id,
                model_revision: 1,
            },
            expert_snapshot: snapshot,
        };
        fixture
            .repo()
            .market_mark(
                pending.operation,
                "inflight",
                Some(&receipt.receipt.host_instance_id),
                None,
                now,
            )
            .unwrap();
        // A normal close/reopen retains the original dispatch owner. Recovery
        // accepts that owner's receipt without depending on a new Host nonce.
        let scope = fixture.repo().scope.clone();
        drop(fixture.repo.take());
        fixture.repo = Some(
            ChatRepository::open(
                &fixture.root.join("chat"),
                &DatabaseKey::from_bytes([57; 32]),
                ReceiptKey::from_bytes([58; 32]),
                scope,
            )
            .unwrap(),
        );
        fixture.repo().expert_accept(&pending, &receipt).unwrap();
        assert!(fixture.repo().pending_market(now + 10).unwrap().is_none());
        let scope = fixture.repo().scope.clone();
        assert_eq!(
            expert_store::submission(
                &fixture.repo().connection,
                &scope,
                &pending.operation.to_string()
            )
            .unwrap()
            .unwrap()
            .0,
            receipt.expert_snapshot
        );
        assert!(fixture
            .repo()
            .claim_next_conversation_outbox(now + 10, 30)
            .unwrap()
            .is_none());
    }

    #[test]
    fn feat160_confirmed_busy_rejection_uses_existing_terminal_path_and_survives_reopen() {
        let mut f = Fixture::new();
        let pending = f.create_expert();
        let now = super::super::now().unwrap();
        let host = Uuid::now_v7().to_string();
        let issue = expert_submission_issue(super::super::control::ExpertControlError::Rejected(
            expert_wire::Error {
                schema_version: 1,
                request_id: None,
                code: expert_wire::ErrorCode::Busy,
                retryable: true,
            },
        ));
        f.repo()
            .market_mark(
                pending.operation,
                "uncertain",
                Some(&host),
                Some(&issue),
                now,
            )
            .unwrap();
        // Normal observation preserves the original correlated diagnostic.
        f.repo()
            .market_mark(pending.operation, "uncertain", None, None, now + 1)
            .unwrap();
        assert!(f
            .repo()
            .settle_expert_busy_rejection(&pending, now + 2)
            .unwrap());
        let scope = f.repo().scope.clone();
        drop(f.repo.take());
        f.repo = Some(
            ChatRepository::open(
                &f.root.join("chat"),
                &DatabaseKey::from_bytes([57; 32]),
                ReceiptKey::from_bytes([58; 32]),
                scope,
            )
            .unwrap(),
        );
        assert!(f.repo().pending_market(now + 5).unwrap().is_none());
        let submissions = f
            .repo()
            .local_submissions(pending.session, &[pending.turn])
            .unwrap();
        assert_eq!(submissions[0].status, "failed");
        assert_eq!(
            submissions[0].operation_id,
            pending.turn_operation.to_string()
        );
        assert!(!f
            .repo()
            .settle_expert_busy_rejection(&pending, now + 5)
            .unwrap());
        assert!(f
            .repo()
            .claim_next_conversation_outbox(now + 10, 30)
            .unwrap()
            .is_none());
        let repo = f.repo();
        assert_eq!(
            expert_store::submission(
                &repo.connection,
                &repo.scope,
                &pending.operation.to_string()
            )
            .unwrap()
            .unwrap()
            .0,
            pending.expert_snapshot.unwrap()
        );
    }

    #[test]
    fn feat160_missing_receipt_alone_keeps_unknown_and_never_resends() {
        for issue in [
            None,
            Some("submission_unknown"),
            Some("temporarily_unavailable"),
        ] {
            let mut f = Fixture::new();
            let pending = f.create_expert();
            let now = super::super::now().unwrap();
            f.repo()
                .market_mark(
                    pending.operation,
                    "uncertain",
                    Some(&Uuid::now_v7().to_string()),
                    issue,
                    now,
                )
                .unwrap();
            assert!(!f
                .repo()
                .settle_expert_busy_rejection(&pending, now + 1)
                .unwrap());
            let retained = f.repo().pending_market(now + 5).unwrap().unwrap();
            assert_eq!(retained.state, "uncertain");
            assert_eq!(retained.turn_operation, pending.turn_operation);
            assert!(f
                .repo()
                .claim_next_conversation_outbox(now + 10, 30)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn feat158_unknown_dispatch_retains_expert_and_never_enters_legacy_claim() {
        let mut fixture = Fixture::new();
        let pending = fixture.create_expert();
        let now = super::super::now().unwrap();
        fixture
            .repo()
            .market_mark(
                pending.operation,
                "uncertain",
                None,
                Some("submission_unknown"),
                now,
            )
            .unwrap();
        let retained = fixture.repo().pending_market(now + 5).unwrap().unwrap();
        assert_eq!(retained.operation, pending.operation);
        assert_eq!(retained.expert_snapshot, pending.expert_snapshot);
        assert_eq!(retained.state, "uncertain");
        assert!(fixture
            .repo()
            .claim_next_conversation_outbox(now + 10, 30)
            .unwrap()
            .is_none());
    }

    #[test]
    fn feat158_unknown_observation_preserves_typed_issue_and_local_submission_status() {
        let mut fixture = Fixture::new();
        let pending = fixture.create_expert();
        let now = super::super::now().unwrap();
        let issue = expert_submission_issue(super::super::control::ExpertControlError::Rejected(
            expert_wire::Error {
                schema_version: 1,
                request_id: None,
                code: expert_wire::ErrorCode::TemporarilyUnavailable,
                retryable: true,
            },
        ));
        assert_eq!(issue, "temporarily_unavailable");
        fixture
            .repo()
            .market_mark(pending.operation, "uncertain", None, Some(&issue), now)
            .unwrap();
        fixture
            .repo()
            .market_mark(pending.operation, "uncertain", None, None, now + 5)
            .unwrap();
        let saved: (String, String) = fixture.repo().connection.query_row(
            "SELECT state,issue_code FROM chat_market_dispatch WHERE submission_operation_id=?1",
            [pending.operation.to_string()], |row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(saved, ("uncertain".into(), issue));
        let submissions = fixture
            .repo()
            .local_submissions(pending.session, &[pending.turn])
            .unwrap();
        assert_eq!(submissions.len(), 1);
        assert_eq!(submissions[0].status, "uncertain");
        assert_eq!(
            submissions[0].operation_id,
            pending.turn_operation.to_string()
        );
        assert!(fixture
            .repo()
            .claim_next_conversation_outbox(now + 10, 30)
            .unwrap()
            .is_none());
    }

    #[test]
    fn feat158_feature_off_skips_new_expert_work_without_stalling_ordinary_conversations() {
        let mut fixture = Fixture::new();
        let expert = fixture.create_expert();
        let now = super::super::now().unwrap();
        assert!(fixture
            .repo()
            .pending_market_with_experts(now, false)
            .unwrap()
            .is_none());
        let ordinary = fixture.create();
        let selected = fixture
            .repo()
            .pending_market_with_experts(now, false)
            .unwrap()
            .unwrap();
        assert_eq!(selected.operation, ordinary.operation);
        assert_ne!(selected.operation, expert.operation);
        assert!(selected.expert_snapshot.is_none());
    }
}
