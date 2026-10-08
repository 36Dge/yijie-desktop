//! Immutable market selections use the same transaction as messages/outbox.
//! New delivery requires live Native-owned provider evidence; durable replay
//! reads the original receipt without renewing that authority.
use super::{generated as management, selection_generated as wire};
use crate::chat::{
    database::{ChatRepository, ChatScope, ConversationEnqueueContext, DraftContentBlock},
    error::ChatError,
    models,
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

fn db_error(_: rusqlite::Error) -> ChatError {
    ChatError::DatabaseUnavailable
}
fn invalid(_: impl std::fmt::Debug) -> ChatError {
    ChatError::InvalidInput
}
fn id(value: &str) -> Result<Uuid, ChatError> {
    Uuid::parse_str(value).map_err(invalid)
}
fn table(db: &Connection) -> Result<bool, ChatError> {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_market_submissions')", [], |r| r.get(0)).map_err(db_error)
}
pub(crate) fn dispatch_predicate(db: &Connection, alias: &str) -> Result<String, ChatError> {
    if !table(db)? {
        return Ok("1=1".into());
    }
    // Only internal, constant SQL aliases may be used here.
    let column = match alias {
        "o" | "chat_outbox" | "b" | "market_outbox" => format!("{alias}.operation_id"),
        "chat_public_task_bindings" => "chat_public_task_bindings.create_operation_id".into(),
        _ => return Err(ChatError::InvalidInput),
    };
    Ok(format!("NOT EXISTS(SELECT 1 FROM chat_market_operation_refs market WHERE market.operation_id={column})"))
}
pub(crate) fn require_legacy_session(
    db: &Connection,
    scope: &ChatScope,
    session: Uuid,
) -> Result<(), ChatError> {
    if !table(db)? {
        return Ok(());
    }
    let marked: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_market_submissions m JOIN chat_sessions s ON s.id=m.session_id WHERE s.id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3)", params![session.to_string(),scope.owner_user_id,scope.tenant_id], |r|r.get(0)).map_err(db_error)?;
    if marked {
        Err(ChatError::OrchestrationUnavailable)
    } else {
        Ok(())
    }
}
pub(crate) fn require_legacy_operation(
    db: &Connection,
    scope: &ChatScope,
    operation: Uuid,
) -> Result<(), ChatError> {
    if !table(db)? {
        return Ok(());
    }
    let marked: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_market_operation_refs a JOIN chat_market_submissions m ON m.submission_operation_id=a.submission_operation_id JOIN chat_sessions s ON s.id=m.session_id WHERE a.operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3)", params![operation.to_string(),scope.owner_user_id,scope.tenant_id], |r|r.get(0)).map_err(db_error)?;
    if marked {
        Err(ChatError::OrchestrationUnavailable)
    } else {
        Ok(())
    }
}

fn normalize(payload: &wire::SubmitPayload) -> Result<wire::SubmitPayload, ChatError> {
    payload.validate().map_err(invalid)?;
    let mut value = payload.clone();
    value
        .selection
        .sort_by(|a, b| a.installation_id.cmp(&b.installation_id));
    Ok(value)
}
fn blocks(payload: &wire::SubmitPayload) -> Result<Vec<DraftContentBlock>, ChatError> {
    payload
        .content_blocks
        .iter()
        .map(|block| {
            Ok(match block {
                wire::ContentBlock::Text(v) => DraftContentBlock::Text(v.text.clone()),
                wire::ContentBlock::File(v) => DraftContentBlock::File(id(&v.attachment_id)?),
                wire::ContentBlock::Image(v) => DraftContentBlock::Image(id(&v.attachment_id)?),
            })
        })
        .collect()
}

/// Native/Host readiness produces this process-local evidence.
/// No caller or renderer can submit a boolean to bypass this boundary.
pub(crate) struct ExecutionAdmission {
    native_process_epoch: String,
    provider: Option<super::provider::ProviderAdmission>,
    #[cfg(test)]
    storage_only: bool,
}
impl ExecutionAdmission {
    pub(crate) fn from_host(
        host: &crate::chat::host_bridge::HostBridge,
        authority: &crate::chat::authorization::ChatAuthorizationManager,
        provider: super::provider::ProviderAdmission,
    ) -> Result<Self, ChatError> {
        if host.market_control().is_none() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(Self {
            native_process_epoch: authority
                .market_identity(host.instance_nonce().to_owned())
                .native_process_epoch,
            provider: Some(provider),
            #[cfg(test)]
            storage_only: false,
        })
    }
    #[cfg(test)]
    pub(crate) fn test() -> Self {
        Self {
            native_process_epoch: Uuid::now_v7().to_string(),
            provider: None,
            storage_only: true,
        }
    }
}
#[cfg(test)]
fn require_execution_provider() -> Result<ExecutionAdmission, ChatError> {
    Err(ChatError::OrchestrationUnavailable)
}

impl ChatRepository {
    fn market_digest(&self, payload: &wire::SubmitPayload) -> Result<String, ChatError> {
        let value = serde_json::to_vec(&(
            "yijie.market-intent/v1",
            &self.scope.owner_user_id,
            &self.scope.tenant_id,
            payload,
        ))
        .map_err(invalid)?;
        Ok(self.market_intent_digest(&value))
    }

    fn market_submission_replay(
        &self,
        payload: &wire::SubmitPayload,
    ) -> Result<Option<wire::SubmissionReceipt>, ChatError> {
        if !table(&self.connection)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let payload = normalize(payload)?;
        let digest = self.market_digest(&payload)?;
        replay(&self.connection, &self.scope, &payload, &digest)
    }

    /// Same-scope accepted replay precedes current provider/installation checks.
    #[cfg(test)]
    pub(crate) fn market_submission(
        &mut self,
        payload: wire::SubmitPayload,
        authorization_revision: u64,
    ) -> Result<wire::SubmissionReceipt, ChatError> {
        if !table(&self.connection)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let payload = normalize(&payload)?;
        let digest = self.market_digest(&payload)?;
        if let Some(receipt) = replay(&self.connection, &self.scope, &payload, &digest)? {
            return Ok(receipt);
        }
        require_unused_operation(&self.connection, &payload.operation_id)?;
        let admission = require_execution_provider()?;
        self.freeze_market_submission(payload, authorization_revision, admission)
    }

    pub(crate) fn market_submission_admitted(
        &mut self,
        payload: wire::SubmitPayload,
        revision: u64,
        admission: ExecutionAdmission,
    ) -> Result<wire::SubmissionReceipt, ChatError> {
        self.freeze_market_submission(payload, revision, admission)
    }

    fn freeze_market_submission(
        &mut self,
        payload: wire::SubmitPayload,
        authorization_revision: u64,
        admission: ExecutionAdmission,
    ) -> Result<wire::SubmissionReceipt, ChatError> {
        if !table(&self.connection)? {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let payload = normalize(&payload)?;
        let request_digest = self.market_digest(&payload)?;
        if let Some(receipt) = replay(&self.connection, &self.scope, &payload, &request_digest)? {
            return Ok(receipt);
        }
        require_unused_operation(&self.connection, &payload.operation_id)?;
        #[cfg(test)]
        let require_qualification = !admission.storage_only;
        #[cfg(not(test))]
        let require_qualification = true;
        if require_qualification && !payload.selection.is_empty() {
            let provider = admission
                .provider
                .as_ref()
                .ok_or(ChatError::OrchestrationUnavailable)?;
            super::provider::preflight(&self.connection, &self.scope, &payload.selection, provider)
                .map_err(|_| ChatError::OrchestrationUnavailable)?;
        }
        let blocks = blocks(&payload)?;
        crate::chat::database::validate_draft_blocks(&blocks)?;
        if authorization_revision == 0
            || (payload.session_id.is_none() && payload.intent.expected_revision != 0)
        {
            return Err(ChatError::InvalidInput);
        }
        let op = id(&payload.operation_id)?;
        let session = payload.session_id.as_deref().map(id).transpose()?;
        if let Some(session) = session {
            // A local first turn without an actual Host binding cannot be
            // transformed into a fresh Host create with a continuation revision.
            if self
                .agent_session_id_for_session_optional_model(session)?
                .is_none()
            {
                return Err(ChatError::OrchestrationUnavailable);
            }
        }
        let permission_mode = self.permission_state(session)?.mode;
        if !payload.selection.is_empty()
            && permission_mode != crate::chat::runtime_permissions::PermissionMode::Ask
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let permission_mode = match permission_mode {
            crate::chat::runtime_permissions::PermissionMode::Ask => "ask",
            crate::chat::runtime_permissions::PermissionMode::Auto => "auto",
            crate::chat::runtime_permissions::PermissionMode::Full => "full",
        };
        // Reject known stale references before idempotent projectless workspace
        // provisioning, then check again within the message/outbox transaction.
        display_snapshot(&self.connection, &self.scope, &payload.selection)?;
        let project = match (session, payload.project_id.as_deref()) {
            (None, Some(project)) => Some(id(project)?),
            (None, None) => Some(self.ensure_projectless_workspace(op)?),
            (Some(_), None) => None,
            _ => return Err(ChatError::InvalidInput),
        };
        let now = super::now().map_err(|_| ChatError::DatabaseUnavailable)?;
        let tx = self.connection.transaction().map_err(db_error)?;
        // Recheck under the same transaction as the existing outbox writer.
        if let Some(receipt) = replay(&tx, &self.scope, &payload, &request_digest)? {
            return Ok(receipt);
        }
        require_unused_operation(&tx, &payload.operation_id)?;
        let display = display_snapshot(&tx, &self.scope, &payload.selection)?;
        let context = ConversationEnqueueContext {
            scope: &self.scope,
            now,
            scheduled: None,
            draft: false,
            market: true,
        };
        let (session, local_turn, turn_operation, create_operation) = if let Some(session) = session
        {
            let turn = Self::enqueue_turn_in_transaction(&tx, context, session, &blocks, op)?;
            (session, turn, op, None)
        } else {
            let pending = Self::create_session_and_enqueue_in_transaction(
                &tx,
                context,
                project.ok_or(ChatError::InvalidInput)?,
                &blocks,
                op,
                authorization_revision,
            )?;
            (
                pending.session_id,
                pending.turn_id,
                pending.turn_operation_id,
                Some(pending.create_operation_id),
            )
        };
        models::freeze_conversation(
            &tx,
            session,
            turn_operation,
            create_operation,
            &models::ModelIntent {
                profile_id: payload.intent.profile_id,
                expected_revision: payload.intent.expected_revision,
            },
        )?;
        let snapshot = wire::freeze_selection(turn_operation.to_string(), payload.selection)
            .map_err(invalid)?;
        let receipt = wire::SubmissionReceipt {
            outcome: "local_durable_accepted".into(),
            session_id: session.to_string(),
            local_turn_id: local_turn.to_string(),
            submission_operation_id: op.to_string(),
            turn_operation_id: turn_operation.to_string(),
            selection_digest: snapshot.selection_digest.clone(),
        };
        receipt.validate().map_err(invalid)?;
        tx.execute("INSERT INTO chat_market_submissions(submission_operation_id,session_id,local_turn_id,turn_operation_id,format_version,request_digest,snapshot_json,display_json,receipt_json,created_at,authorization_revision,permission_mode,native_process_epoch) VALUES(?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10,?11,?12)",params![receipt.submission_operation_id,receipt.session_id,receipt.local_turn_id,receipt.turn_operation_id,request_digest,serde_json::to_string(&snapshot).map_err(invalid)?,serde_json::to_string(&display).map_err(invalid)?,serde_json::to_string(&receipt).map_err(invalid)?,now,i64::try_from(authorization_revision).map_err(invalid)?,permission_mode,admission.native_process_epoch]).map_err(db_error)?;
        tx.execute("INSERT INTO chat_market_dispatch(submission_operation_id,format_version,state,updated_at) VALUES(?1,1,'pending',?2)",params![receipt.submission_operation_id,now]).map_err(db_error)?;
        for alias in std::iter::once(op).chain((op != turn_operation).then_some(turn_operation)) {
            tx.execute("INSERT INTO chat_market_operation_refs(operation_id,submission_operation_id) VALUES(?1,?2)",params![alias.to_string(),op.to_string()]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(receipt)
    }
}

fn replay(
    db: &Connection,
    scope: &ChatScope,
    payload: &wire::SubmitPayload,
    digest: &str,
) -> Result<Option<wire::SubmissionReceipt>, ChatError> {
    let stored: Option<(String,String,String)> = db.query_row("SELECT m.request_digest,m.snapshot_json,m.receipt_json FROM chat_market_submissions m JOIN chat_sessions s ON s.id=m.session_id WHERE m.submission_operation_id=?1 AND s.owner_user_id=?2 AND s.tenant_id=?3 AND m.format_version=1", params![payload.operation_id,scope.owner_user_id,scope.tenant_id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
    stored
        .map(|(saved, snapshot, receipt)| {
            if saved != digest {
                return Err(ChatError::ConversationConflict);
            }
            let snapshot: wire::SelectionSnapshot =
                serde_json::from_str(&snapshot).map_err(|_| ChatError::DatabaseUnavailable)?;
            let receipt: wire::SubmissionReceipt =
                serde_json::from_str(&receipt).map_err(|_| ChatError::DatabaseUnavailable)?;
            if receipt.submission_operation_id != payload.operation_id
                || snapshot.turn_operation_id != receipt.turn_operation_id
                || snapshot.selection_digest != receipt.selection_digest
                || snapshot.selection != payload.selection
            {
                return Err(ChatError::DatabaseUnavailable);
            }
            Ok(receipt)
        })
        .transpose()
}
fn require_unused_operation(db: &Connection, op: &str) -> Result<(), ChatError> {
    let used: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE operation_id=?1 UNION ALL SELECT 1 FROM chat_turns WHERE operation_id=?1 UNION ALL SELECT 1 FROM chat_operation_models WHERE operation_id=?1 UNION ALL SELECT 1 FROM chat_market_operation_refs WHERE operation_id=?1)", [op], |r|r.get(0)).map_err(db_error)?;
    if used {
        Err(ChatError::ConversationConflict)
    } else {
        Ok(())
    }
}
fn display_snapshot(
    db: &Connection,
    scope: &ChatScope,
    refs: &[management::SelectionRef],
) -> Result<Vec<management::SelectionDisplay>, ChatError> {
    refs.iter()
        .map(|reference| {
            let item = super::store::find(
                db,
                scope,
                &super::catalog().catalog,
                &reference.installation_id,
            )
            .map_err(|_| ChatError::ConversationConflict)?;
            if item.revision != reference.revision || item.generation != reference.generation {
                return Err(ChatError::ConversationConflict);
            }
            let entry = super::catalog()
                .catalog
                .iter()
                .find(|e| e.service_id == item.service_id)
                .ok_or(ChatError::NotFound)?;
            Ok(management::SelectionDisplay {
                service_id: entry.service_id.clone(),
                display_name: entry.display_name.clone(),
                reference: reference.clone(),
            })
        })
        .collect()
}

fn submission_error(error: ChatError) -> wire::ErrorCode {
    match error {
        ChatError::InvalidInput => wire::ErrorCode::InvalidRequest,
        ChatError::ConversationConflict => wire::ErrorCode::RequestConflict,
        ChatError::NotFound => wire::ErrorCode::NotFound,
        ChatError::OrchestrationUnavailable => wire::ErrorCode::ExecutionUnavailable,
        _ => wire::ErrorCode::TemporarilyUnavailable,
    }
}

#[tauri::command]
pub(crate) async fn chat_market_submit_v1(
    request: serde_json::Value,
    app: tauri::AppHandle,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, crate::chat::ipc::ChatIpcRuntime>,
) -> Result<wire::SubmitResponse, wire::Error> {
    use crate::chat::{authorization::AuthorizationFailure, RuntimeMode};
    let auth_error = |e| match e {
        AuthorizationFailure::ContextInvalid => wire::ErrorCode::ContextInvalid,
        AuthorizationFailure::CapabilityDenied => wire::ErrorCode::PermissionDenied,
    };
    let known_id = request
        .get("requestId")
        .and_then(serde_json::Value::as_str)
        .filter(|s| super::store::id(s).is_ok())
        .map(str::to_owned);
    let result = async {
        let request: wire::SubmitRequest =
            serde_json::from_value(request).map_err(|_| wire::ErrorCode::InvalidRequest)?;
        if !super::enabled() || !models::enabled() {
            return Err(wire::ErrorCode::ExecutionUnavailable);
        }
        let scope = match &chat_runtime.mode {
            RuntimeMode::Local(config) => config.scope.clone(),
            _ => return Err(wire::ErrorCode::PermissionDenied),
        };
        let context = id(&request.context_id).map_err(|_| wire::ErrorCode::ContextInvalid)?;
        let create = request.payload.session_id.is_none();
        let selected = !request.payload.selection.is_empty();
        let authority = chat_runtime
            .authorization_manager()
            .map_err(|_| wire::ErrorCode::ContextInvalid)?;
        let now = super::now().map_err(|_| wire::ErrorCode::TemporarilyUnavailable)?;
        authority
            .with_market_submit_context(context, &scope, create, selected, now, |_| ())
            .map_err(auth_error)?;
        let database = chat_runtime
            .database()
            .await
            .map_err(|_| wire::ErrorCode::TemporarilyUnavailable)?;
        // Serialize before checking replay too: an identical request queued
        // behind a first submit must observe its receipt before live admission.
        let _admission_gate = authority.market_admission_lock().await;
        let replay_scope = scope.clone();
        let replay_authority = authority.clone();
        let replay_payload = request.payload.clone();
        let previous = database
            .call(move |repo| {
                Ok(replay_authority
                    .with_market_submit_context(
                        context,
                        &replay_scope,
                        create,
                        selected,
                        super::now().map_err(|_| ChatError::DatabaseUnavailable)?,
                        |_| {
                            repo.market_submission_replay(&replay_payload)
                                .map_err(submission_error)
                        },
                    )
                    .map_err(auth_error)
                    .and_then(|value| value))
            })
            .await
            .map_err(|_| wire::ErrorCode::TemporarilyUnavailable)??;
        if let Some(receipt) = previous {
            // Reading a durable receipt neither starts a Host nor renews tool
            // authority. Pending/unknown execution is recovered by original ID.
            return Ok(wire::SubmitResponse {
                schema_version: 1,
                request_id: request.request_id,
                data: receipt,
            });
        }
        chat_runtime
            .ensure_demo_fast_sidecar()
            .await
            .map_err(|_| wire::ErrorCode::ExecutionUnavailable)?;
        let host = chat_runtime
            .local_host_bridge()
            .await
            .map_err(|_| wire::ErrorCode::ExecutionUnavailable)?;
        let current_time = super::now().map_err(|_| wire::ErrorCode::TemporarilyUnavailable)?;
        let revision = authority
            .with_market_submit_context(context, &scope, create, selected, current_time, |r| r)
            .map_err(auth_error)?;
        let provider_scope = authority
            .market_dispatch_authority(&scope, revision, create, selected, current_time)
            .map_err(auth_error)?;
        let provider = super::provider::read_admission(
            &database,
            &host,
            &scope,
            provider_scope,
            &request.payload.selection,
        )
        .await
        .map_err(|_| wire::ErrorCode::ExecutionUnavailable)?;
        let admission = ExecutionAdmission::from_host(&host, &authority, provider)
            .map_err(|_| wire::ErrorCode::ExecutionUnavailable)?;
        let wake_authority = authority.clone();
        let receipt = database
            .call(move |repo| {
                let now = super::now().map_err(|_| ChatError::DatabaseUnavailable)?;
                Ok(authority
                    .with_market_submit_context(
                        context,
                        &scope,
                        create,
                        selected,
                        now,
                        |revision| {
                            repo.market_submission_admitted(request.payload, revision, admission)
                                .map_err(submission_error)
                        },
                    )
                    .map_err(auth_error)
                    .and_then(|value| value))
            })
            .await
            .map_err(|_| wire::ErrorCode::TemporarilyUnavailable)??;
        drop(_admission_gate);
        // Wake the same owner used by ordinary chat. Its explicit market
        // dispatcher cannot fall back to legacy turn submission. A wake error
        // cannot undo the durable receipt or invent a replacement operation.
        if let Ok(application) = chat_runtime.local_conversation_application().await {
            let _ = ipc_runtime
                .ensure_coordinator(app, application, wake_authority)
                .await;
        }
        Ok(wire::SubmitResponse {
            schema_version: 1,
            request_id: request.request_id,
            data: receipt,
        })
    }
    .await;
    result.map_err(|code| wire::Error {
        schema_version: 1,
        request_id: known_id,
        retryable: code == wire::ErrorCode::TemporarilyUnavailable,
        code,
    })
}

#[cfg(test)]
#[path = "selection_tests.rs"]
mod tests;
