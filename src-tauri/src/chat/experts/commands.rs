//! Safe Native expert commands. Every mutation shares the existing market
//! admission gate; SQLite remains the conversation authority.
use super::{generated as wire, store};
use crate::chat::{
    authorization::{AuthorizationFailure, ChatAuthorizationManager},
    connectors::{control::ExpertControlError, selection_generated},
    database::{ChatRepository, ChatScope},
    error::ChatError,
    ChatRuntime, RuntimeMode,
};
use crate::skills::SkillRuntime;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;
type Error = wire::ErrorCode;

fn now() -> Result<i64, Error> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|v| i64::try_from(v.as_secs()).ok())
        .ok_or(Error::TemporarilyUnavailable)
}
fn encode(value: &impl Serialize) -> Result<Value, Error> {
    serde_json::to_value(value).map_err(|_| Error::TemporarilyUnavailable)
}
fn auth_error(error: AuthorizationFailure) -> Error {
    match error {
        AuthorizationFailure::ContextInvalid => Error::ContextInvalid,
        AuthorizationFailure::CapabilityDenied => Error::PermissionDenied,
    }
}
fn db_error(_: impl std::fmt::Debug) -> Error {
    Error::TemporarilyUnavailable
}
fn valid_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}

#[derive(Clone)]
struct Access {
    manager: ChatAuthorizationManager,
    scope: ChatScope,
    context: Uuid,
}
impl Access {
    fn new(chat: &ChatRuntime, context: &str) -> Result<Self, Error> {
        let scope = match &chat.mode {
            RuntimeMode::Local(config) => config.scope.clone(),
            _ => return Err(Error::PermissionDenied),
        };
        Ok(Self {
            manager: chat
                .authorization_manager()
                .map_err(|_| Error::ContextInvalid)?,
            scope,
            context: Uuid::parse_str(context).map_err(|_| Error::ContextInvalid)?,
        })
    }
    fn authority(&self, required: &[&str]) -> Result<wire::ScopeBinding, Error> {
        self.manager
            .with_market_authority(self.context, &self.scope, required, now()?, |value| value)
            .map_err(auth_error)
    }
    fn run<T>(
        &self,
        required: &[&str],
        operation: impl FnOnce(wire::ScopeBinding) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.manager
            .with_market_authority(self.context, &self.scope, required, now()?, operation)
            .map_err(auth_error)?
    }

    fn response(&self, request_id: String, data: Value) -> Result<Value, Error> {
        // Reads may await Host reconciliation and fall back to the saved
        // receipt. That fallback is still data for the current UI reader.
        self.authority(&["task.read"])?;
        Ok(serde_json::json!({"schemaVersion":1,"requestId":request_id,"data":data}))
    }
}

#[derive(Clone)]
enum Action {
    Read(wire::BindingReadPayload),
    Set(wire::BindingSetPayload),
    Operation(wire::BindingOperationReadPayload),
    Recover(wire::BindingOperationReadPayload),
}
fn decode(name: &str, raw: Value) -> Result<(String, String, Action), Error> {
    macro_rules! read {
        ($ty:ty,$kind:ident) => {{
            let r: $ty = serde_json::from_value(raw).map_err(|_| Error::InvalidRequest)?;
            Ok((r.request_id, r.context_id, Action::$kind(r.payload)))
        }};
    }
    match name {
        "chat_expert_binding_read_v1" => read!(wire::BindingReadRequest, Read),
        "chat_expert_binding_set_v1" => read!(wire::BindingSetRequest, Set),
        "chat_expert_binding_operation_read_v1" => {
            read!(wire::BindingOperationReadRequest, Operation)
        }
        "chat_expert_binding_recover_v1" => read!(wire::BindingRecoverRequest, Recover),
        _ => Err(Error::UnsupportedCapability),
    }
}

async fn local_host(chat: &ChatRuntime) -> Result<std::sync::Arc<crate::chat::HostBridge>, Error> {
    chat.ensure_demo_fast_sidecar()
        .await
        .map_err(|_| Error::QualificationRequired)?;
    chat.local_host_bridge()
        .await
        .map_err(|_| Error::QualificationRequired)
}

fn binding_digest(
    repo: &ChatRepository,
    scope: &ChatScope,
    request: &wire::BindingSetPayload,
) -> Result<String, Error> {
    let bytes = serde_json::to_vec(&(
        "yijie.expert-binding/v1",
        &scope.owner_user_id,
        &scope.tenant_id,
        request,
    ))
    .map_err(|_| Error::InvalidRequest)?;
    Ok(repo.market_intent_digest(&bytes))
}
fn required_binding(request: &wire::BindingSetPayload) -> Vec<&'static str> {
    let mut required = vec!["task.read", "task.create"];
    if request.expert.is_some() {
        required.push("plugin.read")
    };
    required
}

fn plan_binding(
    repo: &mut ChatRepository,
    access: &Access,
    request: &wire::BindingSetPayload,
    resolved: Option<&store::ResolvedExpert>,
    host_instance: String,
) -> Result<(wire::BindingResult, wire::ApplyPayload), Error> {
    let native_scope = access.authority(&required_binding(request))?;
    let session = Uuid::parse_str(&request.session_id).map_err(|_| Error::InvalidRequest)?;
    crate::chat::schedules::drafts::guard_conversation(
        &repo.connection,
        &access.scope,
        &request.session_id,
        false,
    )
    .map_err(|_| Error::PermissionDenied)?;
    let model = repo
        .model_state(session)
        .map_err(|_| Error::ModelUnavailable)?;
    if model.state != "ready" {
        return Err(Error::ModelUnavailable);
    }
    let permissions = repo.permission_state(Some(session)).map_err(db_error)?;
    if permissions.busy {
        return Err(Error::Busy);
    }
    let (agent,thread):(Option<String>,Option<String>)=repo.connection.query_row(
        "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![request.session_id,access.scope.owner_user_id,access.scope.tenant_id],|row|Ok((row.get(0)?,row.get(1)?)),
    ).map_err(|_|Error::NotFound)?;
    let (Some(agent), Some(thread)) = (agent, thread) else {
        return Err(Error::ThreadUnavailable);
    };
    let market:Option<String>=repo.connection.query_row("SELECT snapshot_json FROM chat_market_submissions WHERE session_id=?1 ORDER BY rowid DESC LIMIT 1",[&request.session_id],|row|row.get(0)).optional().map_err(db_error)?;
    let market_snapshot = if let Some(json) = market {
        serde_json::from_str(&json).map_err(|_| Error::BindingUnavailable)?
    } else {
        let turn:String=repo.connection.query_row("SELECT operation_id FROM chat_turns WHERE session_id=?1 ORDER BY rowid DESC LIMIT 1",[&request.session_id],|row|row.get(0)).map_err(|_|Error::ThreadUnavailable)?;
        selection_generated::freeze_selection(turn, vec![])
            .map_err(|_| Error::BindingUnavailable)?
    };
    let payload=wire::ApplyPayload {
        operation_id:request.operation_id.clone(),host_instance_id:host_instance,scope:native_scope,
        local_session_id:request.session_id.clone(),agent_session_id:agent,native_thread_id:thread,
        expected_binding_revision:request.expected_binding_revision,binding_revision:request.expected_binding_revision.checked_add(1).ok_or(Error::CapacityExceeded)?,
        expert:resolved.map(|value|value.reference.clone()),
        intent:serde_json::from_value(serde_json::json!({"profileId":model.profile_id.ok_or(Error::ModelUnavailable)?,"expectedRevision":model.revision})).map_err(|_|Error::ModelUnavailable)?,
        permission_mode:serde_json::from_value(serde_json::json!(permissions.mode.as_str())).map_err(|_|Error::PermissionModeUnavailable)?,market_snapshot,
    };
    payload.validate().map_err(|_| Error::InvalidRequest)?;
    let digest = binding_digest(repo, &access.scope, request)?;
    let timestamp = now()?;
    let tx = repo.connection.transaction().map_err(db_error)?;
    let result = access.run(&required_binding(request), |_| {
        let result = store::begin(&tx, &access.scope, request, resolved, &digest, timestamp)?;
        if !store::record_apply(&tx, &access.scope, &payload, timestamp)? {
            return Err(Error::OperationPending);
        }
        Ok(result)
    })?;
    tx.commit().map_err(db_error)?;
    Ok((result, payload))
}

async fn binding_operation(
    chat: &ChatRuntime,
    access: &Access,
    session: String,
    operation: String,
) -> Result<wire::BindingResult, Error> {
    access.authority(&["task.read"])?;
    let worker = chat.database().await.map_err(db_error)?;
    let read_access = access.clone();
    let read_session = session.clone();
    let read_operation = operation.clone();
    let (result, attempt) = worker
        .call(move |repo| {
            Ok(read_access.run(&["task.read"], |_| {
                Ok((
                    store::read_operation(
                        &repo.connection,
                        &read_access.scope,
                        &read_session,
                        &read_operation,
                    )?
                    .ok_or(Error::NotFound)?,
                    store::apply_payload(
                        &repo.connection,
                        &read_access.scope,
                        &read_session,
                        &read_operation,
                    )?,
                ))
            }))
        })
        .await
        .map_err(db_error)??;
    if matches!(
        result.operation.state,
        wire::OperationState::Succeeded | wire::OperationState::Rejected
    ) {
        return Ok(result);
    }
    let Some(attempt) = attempt else {
        return Ok(result);
    };
    let host = local_host(chat).await?;
    let control = host.market_control().ok_or(Error::UnsupportedCapability)?;
    let id = Uuid::now_v7().to_string();
    let response: wire::PrivateOperationReadResponse = match control
        .expert_request(
            &id,
            &wire::PrivateOperationReadRequest {
                schema_version: 1,
                request_id: id.clone(),
                method: "expert_operation_read".into(),
                payload: wire::PrivateOperationReadPayload {
                    host_instance_id: host.instance_nonce().into(),
                    scope: access.authority(&["task.read"])?,
                    local_session_id: session.clone(),
                    agent_session_id: attempt.agent_session_id,
                    operation_id: operation,
                },
            },
            "expert_operation_read",
        )
        .await
    {
        Ok(value) => value,
        Err(_) => return Ok(result),
    };
    let finish_access = access.clone();
    worker
        .call(move |repo| {
            Ok(finish_access.run(&["task.read"], |_| {
                let tx = repo.connection.transaction().map_err(db_error)?;
                let result = store::finish(&tx, &finish_access.scope, &response.data, now()?)?;
                tx.commit().map_err(db_error)?;
                Ok(result)
            }))
        })
        .await
        .map_err(db_error)?
}

async fn set_binding(
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    access: &Access,
    request: wire::BindingSetPayload,
) -> Result<Value, Error> {
    access.authority(&required_binding(&request))?;
    let _gate = access.manager.market_admission_lock().await;
    let worker = chat.database().await.map_err(db_error)?;
    let replay_access = access.clone();
    let replay = request.clone();
    let prior = worker
        .call(move |repo| {
            Ok(replay_access.run(&required_binding(&replay), |_| {
                store::replay_binding(
                    &repo.connection,
                    &replay_access.scope,
                    &replay,
                    &binding_digest(repo, &replay_access.scope, &replay)?,
                )
            }))
        })
        .await
        .map_err(db_error)??;
    if let Some(prior) = prior {
        return if matches!(
            prior.operation.state,
            wire::OperationState::Pending | wire::OperationState::Unknown
        ) {
            encode(
                &binding_operation(chat, access, request.session_id, request.operation_id).await?,
            )
        } else {
            encode(&prior)
        };
    }
    let host = local_host(chat).await?;
    super::require_execution(
        chat,
        skills,
        &host,
        access.authority(&required_binding(&request))?,
    )
    .await?;
    let resolved = if let Some(selected) = &request.expert {
        Some(skills.expert_resolve(chat, selected).await?)
    } else {
        None
    };
    let plan_access = access.clone();
    let plan_request = request.clone();
    let instance = host.instance_nonce().to_owned();
    let (_, payload) = worker
        .call(move |repo| {
            Ok(plan_binding(
                repo,
                &plan_access,
                &plan_request,
                resolved.as_ref(),
                instance,
            ))
        })
        .await
        .map_err(db_error)??;
    let id = Uuid::now_v7().to_string();
    // The database worker yielded after freezing this request. A normal UI
    // context renewal can invalidate its sender without closing the owner pipe.
    // Refuse before I/O, then settle that original intent as never dispatched.
    let response = if let Err(code) = authorize_apply_dispatch(access, &payload) {
        Err(ExpertControlError::Rejected(wire::Error {
            schema_version: 1,
            request_id: None,
            code,
            retryable: false,
        }))
    } else if let Some(control) = host.market_control() {
        control
            .expert_request::<_, wire::ApplyResponse>(
                &id,
                &wire::ApplyRequest {
                    schema_version: 1,
                    request_id: id.clone(),
                    method: "expert_apply_binding".into(),
                    payload,
                },
                "expert_apply_binding",
            )
            .await
            .map(|response| response.data)
    } else {
        Err(ExpertControlError::Closed)
    };
    // The original authenticated mutation must be durably settled even if the
    // UI context expires while the owned request is in flight. No new grant is
    // issued here; the response still must match the journaled attempt.
    let settled_scope = access.scope.clone();
    let result = worker
        .call(move |repo| Ok(settle_binding(repo, &settled_scope, &request, response)))
        .await
        .map_err(db_error)??;
    access.authority(&["task.read"])?;
    encode(&result)
}

fn authorize_apply_dispatch(access: &Access, payload: &wire::ApplyPayload) -> Result<(), Error> {
    let current = access.authority(&recovery_permissions(payload.expert.is_some()))?;
    if current != payload.scope {
        return Err(Error::ContextInvalid);
    }
    Ok(())
}

fn settle_binding(
    repo: &mut ChatRepository,
    scope: &ChatScope,
    request: &wire::BindingSetPayload,
    response: Result<wire::ApplyReceipt, ExpertControlError>,
) -> Result<wire::BindingResult, Error> {
    let tx = repo.connection.transaction().map_err(db_error)?;
    let result = match response {
        Ok(receipt) => store::finish(&tx, scope, &receipt, now()?),
        Err(error) => {
            let failure = match error {
                ExpertControlError::Rejected(error)
                    if !matches!(
                        error.code,
                        Error::OutcomeUnknown | Error::TemporarilyUnavailable
                    ) =>
                {
                    store::AttemptFailure::Rejected(error.code)
                }
                ExpertControlError::Busy => store::AttemptFailure::Rejected(Error::Busy),
                ExpertControlError::InvalidRequest => {
                    store::AttemptFailure::Rejected(Error::InvalidRequest)
                }
                _ => store::AttemptFailure::Unknown,
            };
            store::fail_attempt(
                &tx,
                scope,
                &request.session_id,
                &request.operation_id,
                failure,
                now()?,
            )
        }
    }?;
    tx.commit().map_err(db_error)?;
    Ok(result)
}

fn recovery_permissions(has_expert: bool) -> Vec<&'static str> {
    let mut required = vec!["task.read", "task.create"];
    if has_expert {
        required.push("plugin.read");
    }
    required
}

fn read_recovery(
    repo: &ChatRepository,
    access: &Access,
    request: &wire::BindingOperationReadPayload,
) -> Result<(wire::BindingResult, Option<wire::ApplyPayload>), Error> {
    request.validate().map_err(|_| Error::InvalidRequest)?;
    access
        .run(&recovery_permissions(false), |_| {
            let result = store::read_operation(
                &repo.connection,
                &access.scope,
                &request.session_id,
                &request.operation_id,
            )?
            .ok_or(Error::NotFound)?;
            Ok(result)
        })
        .and_then(|result| {
            access.run(
                &recovery_permissions(result.operation.requested_expert.is_some()),
                |_| {
                    if matches!(
                        result.operation.state,
                        wire::OperationState::Succeeded | wire::OperationState::Rejected
                    ) {
                        return Ok((result, None));
                    }
                    let original = store::apply_payload(
                        &repo.connection,
                        &access.scope,
                        &request.session_id,
                        &request.operation_id,
                    )?
                    .ok_or(Error::BindingUnavailable)?;
                    Ok((result, Some(original)))
                },
            )
        })
}

/// Revalidate the original composition after asynchronous resource/Host reads.
/// This never creates a replacement operation or changes the saved payload.
fn guard_recovery(
    repo: &ChatRepository,
    access: &Access,
    original: &wire::ApplyPayload,
) -> Result<wire::BindingResult, Error> {
    let request = wire::BindingOperationReadPayload {
        session_id: original.local_session_id.clone(),
        operation_id: original.operation_id.clone(),
    };
    let (result, saved) = read_recovery(repo, access, &request)?;
    let Some(saved) = saved else {
        return Ok(result);
    };
    if saved != *original
        || original.scope.owner_user_id != access.scope.owner_user_id
        || original.scope.tenant_id != access.scope.tenant_id
    {
        return Err(Error::RequestConflict);
    }
    let binding = store::read(&repo.connection, &access.scope, &original.local_session_id)?;
    if binding.operation_id.as_deref() != Some(&original.operation_id)
        || binding.binding_revision != original.expected_binding_revision
        || !matches!(
            binding.state,
            wire::BindingState::Applying | wire::BindingState::Unknown
        )
    {
        return Err(Error::RevisionConflict);
    }
    crate::chat::schedules::drafts::guard_conversation(
        &repo.connection,
        &access.scope,
        &original.local_session_id,
        false,
    )
    .map_err(|_| Error::PermissionDenied)?;
    crate::chat::schedules::execution_guard::foreground(&repo.connection).map_err(|error| {
        if error == ChatError::ConversationConflict {
            Error::Busy
        } else {
            Error::TemporarilyUnavailable
        }
    })?;
    let session = Uuid::parse_str(&original.local_session_id).map_err(|_| Error::InvalidRequest)?;
    let model = repo
        .model_state(session)
        .map_err(|_| Error::ModelUnavailable)?;
    let profile = serde_json::to_value(original.intent.profile_id).map_err(db_error)?;
    if model.state != "ready"
        || model.revision != original.intent.expected_revision
        || model.profile_id.as_deref() != profile.as_str()
    {
        return Err(Error::ModelUnavailable);
    }
    let permissions = repo.permission_state(Some(session)).map_err(db_error)?;
    if permissions.busy {
        return Err(Error::Busy);
    }
    if serde_json::to_value(original.permission_mode)
        .map_err(db_error)?
        .as_str()
        != Some(permissions.mode.as_str())
    {
        return Err(Error::PermissionModeUnavailable);
    }
    let identities:(Option<String>,Option<String>) = repo.connection.query_row(
        "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![original.local_session_id,access.scope.owner_user_id,access.scope.tenant_id],
        |row|Ok((row.get(0)?,row.get(1)?)),
    ).map_err(|_| Error::NotFound)?;
    if identities
        != (
            Some(original.agent_session_id.clone()),
            Some(original.native_thread_id.clone()),
        )
    {
        return Err(Error::ThreadUnavailable);
    }
    let busy:bool = repo.connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM chat_outbox WHERE session_id=?1 AND state IN ('pending','inflight')) OR EXISTS(SELECT 1 FROM chat_market_submissions m JOIN chat_market_dispatch d ON d.submission_operation_id=m.submission_operation_id WHERE m.session_id=?1 AND d.state IN ('pending','inflight','uncertain')) OR EXISTS(SELECT 1 FROM chat_deletion_jobs WHERE session_id=?1)",
        [&original.local_session_id], |row|row.get(0),
    ).map_err(db_error)?;
    if busy {
        return Err(Error::Busy);
    }
    Ok(result)
}

fn settle_recovery(
    repo: &mut ChatRepository,
    scope: &ChatScope,
    original: &wire::ApplyPayload,
    response: Result<wire::ApplyReceipt, ExpertControlError>,
) -> Result<wire::BindingResult, Error> {
    let tx = repo.connection.transaction().map_err(db_error)?;
    let result = match response {
        Ok(receipt)
            if receipt.operation_id == original.operation_id
                && receipt.local_session_id == original.local_session_id =>
        {
            store::finish(&tx, scope, &receipt, now()?)?
        }
        // A recovery rejection describes this reconciliation attempt; it does
        // not prove that the original apply never changed the Runtime.
        _ => store::fail_attempt(
            &tx,
            scope,
            &original.local_session_id,
            &original.operation_id,
            store::AttemptFailure::Unknown,
            now()?,
        )?,
    };
    tx.commit().map_err(db_error)?;
    Ok(result)
}

fn recovery_request(
    access: &Access,
    current_host_instance: String,
    original: &wire::ApplyPayload,
) -> Result<wire::PrivateBindingRecoverRequest, Error> {
    let payload = wire::PrivateBindingRecoverRequest {
        schema_version: 1,
        request_id: Uuid::now_v7().to_string(),
        method: "expert_binding_recover".into(),
        payload: wire::PrivateBindingRecoverPayload {
            host_instance_id: current_host_instance,
            scope: access.authority(&recovery_permissions(original.expert.is_some()))?,
            original: original.clone(),
        },
    };
    payload.validate().map_err(|_| Error::InvalidRequest)?;
    Ok(payload)
}

async fn recover_binding(
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    access: &Access,
    request: wire::BindingOperationReadPayload,
) -> Result<Value, Error> {
    access.authority(&recovery_permissions(false))?;
    let _gate = access.manager.market_admission_lock().await;
    let worker = chat.database().await.map_err(db_error)?;
    let read_access = access.clone();
    let (result, original) = worker
        .call(move |repo| Ok(read_recovery(repo, &read_access, &request)))
        .await
        .map_err(db_error)??;
    let Some(original) = original else {
        return encode(&result);
    };
    let required = recovery_permissions(original.expert.is_some());
    let host = local_host(chat).await?;
    super::require_execution(chat, skills, &host, access.authority(&required)?).await?;
    if let Some(reference) = &original.expert {
        let selection = wire::ExpertSelection {
            expert_id: reference.expert_id.clone(),
            version: reference.version.clone(),
        };
        if skills.expert_resolve(chat, &selection).await?.reference != *reference {
            return Err(Error::VersionUnavailable);
        }
    }
    let guard_access = access.clone();
    let guard_original = original.clone();
    let current = worker
        .call(move |repo| Ok(guard_recovery(repo, &guard_access, &guard_original)))
        .await
        .map_err(db_error)??;
    if matches!(
        current.operation.state,
        wire::OperationState::Succeeded | wire::OperationState::Rejected
    ) {
        return encode(&current);
    }
    // Build only after the worker/asset awaits so the explicit recovery uses
    // current sender authority; its original frozen payload is never replaced.
    let payload = recovery_request(access, host.instance_nonce().into(), &original)?;
    let response = if let Some(control) = host.market_control() {
        control
            .expert_request::<_, wire::PrivateBindingRecoverResponse>(
                &payload.request_id,
                &payload,
                "expert_binding_recover",
            )
            .await
            .map(|value| value.data)
    } else {
        Err(ExpertControlError::Closed)
    };
    let scope = access.scope.clone();
    let settled = worker
        .call(move |repo| Ok(settle_recovery(repo, &scope, &original, response)))
        .await
        .map_err(db_error)??;
    access.authority(&["task.read"])?;
    encode(&settled)
}

async fn command(
    raw: Value,
    chat: &ChatRuntime,
    skills: &SkillRuntime,
    name: &str,
) -> Result<Value, wire::Error> {
    if name.starts_with("experts_") {
        return super::resources::command(raw, chat, skills, name).await;
    }
    let known_id = raw
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|id| valid_id(id))
        .map(str::to_owned);
    let result = async {
        let (request_id, context, action) = decode(name, raw)?;
        if !super::enabled() {
            return Err(Error::UnsupportedCapability);
        }
        let access = Access::new(chat, &context)?;
        let data = match action {
            Action::Set(payload) => set_binding(chat, skills, &access, payload).await?,
            Action::Recover(payload) => recover_binding(chat, skills, &access, payload).await?,
            Action::Operation(payload) => encode(
                &binding_operation(chat, &access, payload.session_id, payload.operation_id).await?,
            )?,
            Action::Read(payload) => {
                access.authority(&["task.read"])?;
                let worker = chat.database().await.map_err(db_error)?;
                let read_access = access.clone();
                let binding = worker
                    .call(move |repo| {
                        Ok(read_access.run(&["task.read"], |_| {
                            store::read(&repo.connection, &read_access.scope, &payload.session_id)
                        }))
                    })
                    .await
                    .map_err(db_error)??;
                if matches!(
                    binding.state,
                    wire::BindingState::Applying | wire::BindingState::Unknown
                ) {
                    if let Some(operation) = binding.operation_id.clone() {
                        encode(
                            &binding_operation(chat, &access, binding.session_id, operation)
                                .await?
                                .binding,
                        )?
                    } else {
                        encode(&binding)?
                    }
                } else {
                    encode(&binding)?
                }
            }
        };
        access.response(request_id, data)
    }
    .await;
    result.map_err(|code| wire::Error {
        schema_version: 1,
        request_id: known_id,
        code,
        retryable: code == Error::TemporarilyUnavailable,
    })
}

macro_rules! command {
    ($name:ident) => {
        #[tauri::command]
        pub(crate) async fn $name(
            request: Value,
            chat_runtime: tauri::State<'_, ChatRuntime>,
            skill_runtime: tauri::State<'_, SkillRuntime>,
        ) -> Result<Value, wire::Error> {
            command(request, &chat_runtime, &skill_runtime, stringify!($name)).await
        }
    };
}
command!(experts_snapshot_v1);
command!(experts_prepare_v1);
command!(experts_remove_v1);
command!(experts_operation_read_v1);
command!(experts_operation_recover_v1);
command!(chat_expert_binding_read_v1);
command!(chat_expert_binding_set_v1);
command!(chat_expert_binding_operation_read_v1);
command!(chat_expert_binding_recover_v1);

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
