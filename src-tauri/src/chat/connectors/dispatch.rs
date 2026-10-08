//! Native durable market delivery, alongside (never through) the legacy outbox.
use super::{generated as management, host_generated as wire, selection_generated};
use crate::chat::{
    application::DispatchOutcome,
    authorization::ChatAuthorizationManager,
    database::{ChatRepository, ChatScope},
    error::ChatError,
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
}

impl ChatRepository {
    fn pending_market(&self, now: i64) -> Result<Option<Pending>, ChatError> {
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
        let mut q = self.connection.prepare("SELECT m.submission_operation_id,m.session_id,m.local_turn_id,m.turn_operation_id,m.snapshot_json,m.authorization_revision,m.permission_mode,d.state,m.native_process_epoch,b.public_task_id,b.client_reference_id,s.project_id,s.agent_session_id FROM chat_market_submissions m JOIN chat_market_dispatch d ON d.submission_operation_id=m.submission_operation_id JOIN chat_sessions s ON s.id=m.session_id JOIN chat_public_task_bindings b ON b.session_id=s.id WHERE s.owner_user_id=?1 AND s.tenant_id=?2 AND m.format_version=1 AND d.format_version=1 AND m.authorization_revision>0 AND (d.state='pending' OR (d.state IN ('inflight','uncertain') AND d.updated_at<=?3)) AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs j WHERE j.session_id=s.id) ORDER BY m.created_at,m.submission_operation_id LIMIT 1").map_err(db_error)?;
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
        let changed=tx.execute("UPDATE chat_market_dispatch SET state=?2,host_instance_id=COALESCE(?3,host_instance_id),issue_code=?4,updated_at=?5 WHERE submission_operation_id=?1 AND state IN ('pending','inflight','uncertain')",params![operation.to_string(),state,host,code,now]).map_err(db_error)?;
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
    if pending.state != "pending" {
        database
            .call(move |r| r.market_mark(operation, "uncertain", None, None, now))
            .await?;
        if let Some(task) = pending.task {
            if let Ok(receipt) = host.market_operation(task, pending.turn_operation).await {
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
    let auth = authority.market_dispatch_authority(
        &pending.scope,
        pending.authorization_revision,
        create,
        !pending.snapshot.selection.is_empty(),
        admission_now,
    );
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
    if authority
        .market_dispatch_authority(
            &pending.scope,
            pending.authorization_revision,
            create,
            !pending.snapshot.selection.is_empty(),
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
    lifecycle.validate(epoch)?;
    let registration: wire::GrantRegisterResponse =
        match control.request(&request.request_id, &request).await {
            Ok(response) => response,
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
    let grant = registration.data;
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
    if authority
        .market_dispatch_authority(
            &pending.scope,
            pending.authorization_revision,
            create,
            !pending.snapshot.selection.is_empty(),
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
    let result = host.market_submit(&trigger).await;
    match result {
        Ok(receipt) if receipt.state == wire::SubmissionState::Accepted => {
            let saved = pending.clone();
            database
                .call(move |r| r.market_accept(&saved, &receipt))
                .await?;
            Ok(Some(DispatchOutcome::TurnAccepted {
                session_id: pending.session,
            }))
        }
        _ => {
            database
                .call(move |r| {
                    r.market_mark(
                        operation,
                        "uncertain",
                        None,
                        Some("submission_unknown"),
                        now,
                    )
                })
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
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            drop(self.repo.take());
            std::fs::remove_dir_all(&self.root).unwrap();
        }
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
}
