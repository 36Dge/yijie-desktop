//! Scoped projections and private approvals for actual market turns.
//! Renderer IDs only select local records; they never supply Host authority.
use super::{broker_generated, control::ControlError, host_generated as wire, selection_generated};
use crate::chat::{
    authorization::{AuthorizationFailure, ChatAuthorizationManager},
    database::ChatScope,
    worker::DatabaseWorker,
    ChatRuntime, RuntimeMode,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

type Code = wire::ErrorCode;
#[derive(Clone, PartialEq, Eq)]
struct TurnBinding {
    thread: String,
    turn: String,
    host: Option<String>,
    snapshot: selection_generated::SelectionSnapshot,
    display: Vec<wire::SelectionDisplay>,
}
#[derive(Clone, PartialEq, Eq)]
struct LocalView {
    agent: Option<String>,
    thread: Option<String>,
    managed: bool,
    display: Vec<wire::SelectionDisplay>,
    turns: Vec<TurnBinding>,
    turns_truncated: bool,
}
fn local(db: &Connection, scope: &ChatScope, session: &str) -> Result<LocalView, Code> {
    let (agent, thread) = db.query_row(
        "SELECT agent_session_id,runtime_thread_id FROM chat_sessions WHERE id=?1 AND owner_user_id=?2 AND tenant_id=?3",
        params![session, scope.owner_user_id, scope.tenant_id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().map_err(|_| Code::TemporarilyUnavailable)?.ok_or(Code::SessionNotFound)?;
    let display: Option<String> = db.query_row(
        "SELECT display_json FROM chat_market_submissions WHERE session_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1",
        [session], |r| r.get(0),
    ).optional().map_err(|_| Code::TemporarilyUnavailable)?;
    let managed = display.is_some();
    let display = display
        .map(|s| serde_json::from_str(&s).map_err(|_| Code::NotReady))
        .transpose()?
        .unwrap_or_default();
    let mut statement = db.prepare("SELECT b.runtime_thread_id,b.runtime_turn_id,b.host_instance_nonce,m.snapshot_json,m.display_json FROM chat_market_submissions m JOIN chat_native_bindings b ON b.turn_id=m.local_turn_id AND b.session_id=m.session_id WHERE m.session_id=?1 ORDER BY m.created_at DESC,m.rowid DESC LIMIT 129").map_err(|_| Code::TemporarilyUnavailable)?;
    let rows = statement
        .query_map([session], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let mut turns = Vec::new();
    let mut turns_truncated = false;
    for row in rows {
        if turns.len() == 128 {
            turns_truncated = true;
            break;
        }
        let (thread, turn, host, json, display) = row.map_err(|_| Code::TemporarilyUnavailable)?;
        turns.push(TurnBinding {
            thread,
            turn,
            host,
            snapshot: serde_json::from_str(&json).map_err(|_| Code::NotReady)?,
            display: serde_json::from_str(&display).map_err(|_| Code::NotReady)?,
        });
    }
    Ok(LocalView {
        agent,
        thread,
        managed,
        display,
        turns,
        turns_truncated,
    })
}
async fn read(db: &DatabaseWorker, scope: &ChatScope, session: &str) -> Result<LocalView, Code> {
    let scope = scope.clone();
    let session = session.to_owned();
    db.call(move |repo| Ok(local(&repo.connection, &scope, &session)))
        .await
        .map_err(|_| Code::TemporarilyUnavailable)?
}
fn now() -> Result<i64, Code> {
    super::now().map_err(|_| Code::TemporarilyUnavailable)
}
fn auth(error: AuthorizationFailure) -> Code {
    match error {
        AuthorizationFailure::ContextInvalid => Code::ContextInvalid,
        AuthorizationFailure::CapabilityDenied => Code::PermissionDenied,
    }
}
fn authority(runtime: &ChatRuntime) -> Result<(ChatScope, ChatAuthorizationManager), Code> {
    if !super::enabled() {
        return Err(Code::ExecutionUnavailable);
    }
    let RuntimeMode::Local(config) = &runtime.mode else {
        return Err(Code::PermissionDenied);
    };
    Ok((
        config.scope.clone(),
        runtime
            .authorization_manager()
            .map_err(|_| Code::ContextInvalid)?,
    ))
}
fn authorize(
    manager: &ChatAuthorizationManager,
    scope: &ChatScope,
    context: &str,
    permissions: &[&str],
) -> Result<broker_generated::ScopeBinding, Code> {
    manager
        .with_market_authority(
            Uuid::parse_str(context).map_err(|_| Code::ContextInvalid)?,
            scope,
            permissions,
            now()?,
            |scope| scope,
        )
        .map_err(auth)
}
fn validate_approval(
    approval: &wire::MarketApproval,
    view: &LocalView,
    scope: &ChatScope,
    host: &str,
) -> Result<(), Code> {
    let identity = &approval.identity;
    let context = &identity.binding.context;
    if Some(approval.agent_session_id.as_str()) != view.agent.as_deref()
        || context.agent_session_id != approval.agent_session_id
        || context.process.host_instance_id != host
        || context.scope.owner_user_id != scope.owner_user_id
        || context.scope.tenant_id != scope.tenant_id
        || !view.turns.iter().any(|b| {
            b.host.as_deref() == Some(host)
                && b.thread == identity.native_thread_id
                && b.turn == identity.native_turn_id
                && b.snapshot.turn_operation_id == identity.binding.turn_operation_id
                && b.snapshot.selection_digest == identity.binding.selection_digest
                && b.snapshot
                    .selection
                    .iter()
                    .any(|r| r == &identity.reference)
        })
    {
        return Err(Code::AuthorityMismatch);
    }
    Ok(())
}
fn validate_tools(
    tools: &wire::ToolSnapshot,
    view: &LocalView,
    binding: &TurnBinding,
) -> Result<(), Code> {
    if Some(tools.agent_session_id.as_str()) != view.agent.as_deref()
        || view.thread.as_deref() != Some(binding.thread.as_str())
        || tools.native_turn_id != binding.turn
        || tools.items.iter().any(|item| {
            item.native_turn_id != binding.turn || item.native_thread_id != binding.thread
        })
    {
        return Err(Code::AuthorityMismatch);
    }
    // A historical result is not an execution capability. Its original Host
    // nonce may differ; decisions still use validate_approval's exact nonce.
    Ok(())
}
async fn observe(
    runtime: &ChatRuntime,
    request: wire::NativeObserveRequest,
) -> Result<wire::NativeObservation, Code> {
    let (scope, manager) = authority(runtime)?;
    authorize(&manager, &scope, &request.context_id, &["task.read"])?;
    let db = runtime
        .database()
        .await
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let view = read(&db, &scope, &request.payload.session_id).await?;
    let selected = if let Some(turn) = &request.payload.native_turn_id {
        Some(
            view.turns
                .iter()
                .find(|binding| &binding.turn == turn)
                .ok_or(Code::NotFound)?,
        )
    } else {
        view.turns.first()
    };
    let mut result = wire::NativeObservation {
        managed: view.managed,
        selection_display: if request.payload.native_turn_id.is_some() {
            selected.map(|b| b.display.clone()).unwrap_or_default()
        } else {
            view.display.clone()
        },
        available_turns: Some(
            view.turns
                .iter()
                .map(|b| wire::ObservedTurn {
                    native_turn_id: b.turn.clone(),
                    selection_display: b.display.clone(),
                })
                .collect(),
        ),
        turns_truncated: Some(view.turns_truncated),
        approvals: None,
        tools: None,
    };
    // Ordinary history needs no Host. Readiness failures in a connector worker
    // must not block a conversation that has never used the market family.
    if !view.managed {
        authorize(&manager, &scope, &request.context_id, &["task.read"])?;
        if read(&db, &scope, &request.payload.session_id).await? != view {
            return Err(Code::RevisionConflict);
        }
        return Ok(result);
    }
    let host = match runtime.local_host_bridge().await {
        Ok(host) => Some(host),
        Err(crate::chat::ChatError::SidecarUnavailable) => None,
        Err(_) => return Err(Code::NotReady),
    };
    if let (Some(agent), Some(host)) = (view.agent.as_ref().filter(|_| view.managed), host) {
        let agent_id = Uuid::parse_str(agent).map_err(|_| Code::AuthorityMismatch)?;
        let approvals = host
            .market_approvals(agent_id)
            .await
            .map_err(|_| Code::TemporarilyUnavailable)?;
        if approvals.agent_session_id != *agent {
            return Err(Code::AuthorityMismatch);
        }
        for approval in &approvals.requests {
            validate_approval(approval, &view, &scope, host.instance_nonce())?;
        }
        result.approvals = Some(approvals);
        if let Some(binding) = selected {
            let tools = host
                .market_tools(
                    agent_id,
                    Uuid::parse_str(&binding.turn).map_err(|_| Code::AuthorityMismatch)?,
                )
                .await
                .map_err(|_| Code::TemporarilyUnavailable)?;
            validate_tools(&tools, &view, binding)?;
            result.tools = Some(tools);
        }
    }
    authorize(&manager, &scope, &request.context_id, &["task.read"])?;
    if read(&db, &scope, &request.payload.session_id).await? != view {
        return Err(Code::RevisionConflict);
    }
    Ok(result)
}
async fn decide(
    runtime: &ChatRuntime,
    request: wire::NativeApprovalDecideRequest,
) -> Result<wire::MarketApproval, Code> {
    let (scope, manager) = authority(runtime)?;
    let required = ["task.read", "task.create", "connector.use"];
    authorize(&manager, &scope, &request.context_id, &required)?;
    let db = runtime
        .database()
        .await
        .map_err(|_| Code::TemporarilyUnavailable)?;
    let view = read(&db, &scope, &request.payload.session_id).await?;
    if !view.managed {
        return Err(Code::ApprovalNotFound);
    }
    let agent = view.agent.as_deref().ok_or(Code::NotReady)?;
    let host = runtime
        .local_host_bridge()
        .await
        .map_err(|_| Code::NotReady)?;
    let approvals = host
        .market_approvals(Uuid::parse_str(agent).map_err(|_| Code::AuthorityMismatch)?)
        .await
        .map_err(|_| Code::TemporarilyUnavailable)?;
    if approvals.agent_session_id != agent {
        return Err(Code::AuthorityMismatch);
    }
    let approval = approvals
        .requests
        .iter()
        .find(|item| item.approval_id == request.payload.approval_id)
        .ok_or(Code::ApprovalNotFound)?;
    validate_approval(approval, &view, &scope, host.instance_nonce())?;
    if approval.revision != request.payload.expected_revision {
        return Err(Code::ApprovalStale);
    }
    if read(&db, &scope, &request.payload.session_id).await? != view {
        return Err(Code::RevisionConflict);
    }
    let current = authorize(&manager, &scope, &request.context_id, &required)?;
    let original = &approval.identity.binding.context.scope;
    if current.native_process_epoch != original.native_process_epoch
        || current.authorization_revision != original.authorization_revision
    {
        return Err(Code::AuthorityMismatch);
    }
    let control = host.market_control().ok_or(Code::NotReady)?;
    let private = wire::ApprovalDecideRequest {
        schema_version: 1,
        request_id: request.request_id.clone(),
        method: "approval_decide".into(),
        payload: wire::ApprovalDecidePayload {
            operation_id: request.payload.decision_id.clone(),
            host_instance_id: host.instance_nonce().into(),
            scope: current,
            agent_session_id: agent.into(),
            approval_id: approval.approval_id.clone(),
            call_ref: approval.identity.call_ref.clone(),
            expected_revision: request.payload.expected_revision,
            decision_id: request.payload.decision_id.clone(),
            decision: request.payload.decision,
        },
    };
    private.validate().map_err(|_| Code::InvalidRequest)?;
    let response: wire::ApprovalDecideResponse = control
        .request(&private.request_id, &private)
        .await
        .map_err(|error| match error {
            ControlError::Rejected(error) => error.code,
            ControlError::Busy => Code::Busy,
            ControlError::Closed | ControlError::OutcomeUnknown => Code::OperationUncertain,
            ControlError::InvalidRequest => Code::InvalidRequest,
        })?;
    validate_approval(&response.data, &view, &scope, host.instance_nonce())?;
    if response.data.approval_id != approval.approval_id
        || response.data.identity != approval.identity
        || response.data.decision_id.as_deref() != Some(request.payload.decision_id.as_str())
        || response.data.decision != Some(request.payload.decision)
    {
        return Err(Code::OperationUncertain);
    }
    authorize(&manager, &scope, &request.context_id, &required)?;
    Ok(response.data)
}
fn failure(request: &Value, code: Code) -> wire::NativeError {
    wire::NativeError {
        schema_version: 1,
        request_id: request
            .get("requestId")
            .and_then(Value::as_str)
            .filter(|id| super::store::id(id).is_ok())
            .map(str::to_owned),
        code,
        retryable: false,
    }
}
#[tauri::command]
pub(crate) async fn chat_market_observe_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<Value, wire::NativeError> {
    let decoded: wire::NativeObserveRequest = serde_json::from_value(request.clone())
        .map_err(|_| failure(&request, Code::InvalidRequest))?;
    let request_id = decoded.request_id.clone();
    let data = observe(&chat_runtime, decoded)
        .await
        .map_err(|code| failure(&request, code))?;
    serde_json::to_value(wire::NativeObserveResponse {
        schema_version: 1,
        request_id,
        data,
    })
    .map_err(|_| failure(&request, Code::TemporarilyUnavailable))
}
#[tauri::command]
pub(crate) async fn chat_market_approval_decide_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<Value, wire::NativeError> {
    let decoded: wire::NativeApprovalDecideRequest = serde_json::from_value(request.clone())
        .map_err(|_| failure(&request, Code::InvalidRequest))?;
    let request_id = decoded.request_id.clone();
    let data = decide(&chat_runtime, decoded)
        .await
        .map_err(|code| failure(&request, code))?;
    serde_json::to_value(wire::NativeApprovalDecideResponse {
        schema_version: 1,
        request_id,
        data,
    })
    .map_err(|_| failure(&request, Code::TemporarilyUnavailable))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(tail: u64) -> String {
        format!("15700000-0000-4000-8000-{tail:012}")
    }
    fn scope() -> ChatScope {
        ChatScope::new(id(6), id(7)).unwrap()
    }
    fn approval() -> wire::MarketApproval {
        serde_json::from_value(serde_json::json!({
            "approvalId":id(2),"agentSessionId":id(3),"kind":"mcp_market","revision":1,"state":"pending","expiresAtUnixMs":1000000,
            "identity":{"binding":{"context":{"process":{"hostInstanceId":id(4),"runtimeGeneration":id(5)},"scope":{"ownerUserId":id(6),"tenantId":id(7),"nativeProcessEpoch":id(8),"authorizationRevision":1,"authorizationExpiresAtUnixMs":1000000},"agentSessionId":id(3),"nativeThreadId":null},"capabilityRef":id(9),"turnOperationId":id(10),"selectionDigest":"a".repeat(64)},"nativeTurnId":id(11),"callRef":id(12),"serviceId":"tushareMcp","reference":{"installationId":id(1),"revision":2,"generation":1},"toolName":"daily","argsDigest":"b".repeat(64),"argsEncoding":"worker-json-v1","nativeThreadId":id(13)},
            "review":{"title":"普通合成查询","summary":"读取一条指定日期行情。","risk":"read"}
        })).unwrap()
    }
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE chat_sessions(id TEXT,owner_user_id TEXT,tenant_id TEXT,agent_session_id TEXT,runtime_thread_id TEXT);CREATE TABLE chat_market_submissions(session_id TEXT,local_turn_id TEXT,display_json TEXT,snapshot_json TEXT,created_at INTEGER);CREATE TABLE chat_native_bindings(session_id TEXT,turn_id TEXT,runtime_thread_id TEXT,runtime_turn_id TEXT,host_instance_nonce TEXT);").unwrap();
        db.execute(
            "INSERT INTO chat_sessions VALUES(?1,?2,?3,NULL,NULL)",
            params![id(20), id(6), id(7)],
        )
        .unwrap();
        db
    }
    #[test]
    fn native_market_observe_local_scope_and_unmanaged_history() {
        let db = database();
        let scope = scope();
        let view = local(&db, &scope, &id(20)).unwrap();
        assert!(!view.managed);
        assert!(view.agent.is_none());
        assert!(view.turns.is_empty());
        let other = ChatScope::new(id(30), id(7)).unwrap();
        assert!(matches!(
            local(&db, &other, &id(20)),
            Err(Code::SessionNotFound)
        ));
    }
    #[test]
    fn native_market_observe_pending_snapshot_has_no_fabricated_host_binding() {
        let db = database();
        let display = serde_json::json!([{"reference":{"installationId":id(1),"revision":2,"generation":1},"serviceId":"tushareMcp","displayName":"Tushare·金融数据"}]);
        db.execute(
            "INSERT INTO chat_market_submissions VALUES(?1,?2,?3,?4,1)",
            params![id(20), id(21), display.to_string(), "{}"],
        )
        .unwrap();
        let view = local(&db, &scope(), &id(20)).unwrap();
        assert!(view.managed);
        assert_eq!(view.display[0].display_name, "Tushare·金融数据");
        assert!(view.agent.is_none());
        assert!(view.turns.is_empty());
    }
    #[test]
    fn native_market_observe_history_keeps_original_names_and_bounds_the_index() {
        let db = database();
        let snapshot = serde_json::json!({"schemaVersion":1,"turnOperationId":id(10),"selection":[],"selectionDigest":selection_generated::selection_digest(&id(10), &[]).unwrap()});
        for n in 0..129 {
            let display = serde_json::json!([{"reference":{"installationId":id(1),"revision":2,"generation":1},"serviceId":"tushareMcp","displayName":format!("提交时名称{n}")}]);
            db.execute(
                "INSERT INTO chat_market_submissions VALUES(?1,?2,?3,?4,?5)",
                params![
                    id(20),
                    id(100 + n),
                    display.to_string(),
                    snapshot.to_string(),
                    n as i64
                ],
            )
            .unwrap();
            db.execute(
                "INSERT INTO chat_native_bindings VALUES(?1,?2,?3,?4,?5)",
                params![id(20), id(100 + n), id(13), id(300 + n), id(4)],
            )
            .unwrap();
        }
        let view = local(&db, &scope(), &id(20)).unwrap();
        assert_eq!(view.turns.len(), 128);
        assert!(view.turns_truncated);
        assert_eq!(view.display[0].display_name, "提交时名称128");
        assert_eq!(view.turns[127].display[0].display_name, "提交时名称1");
        assert_eq!(view.turns[127].turn, id(301));
    }
    #[test]
    fn native_market_observe_approval_uses_actual_turn_and_original_selection() {
        let approval = approval();
        let view = LocalView {
            agent: Some(id(3)),
            thread: Some(id(13)),
            managed: true,
            display: vec![],
            turns: vec![TurnBinding {
                thread: id(13),
                turn: id(11),
                host: Some(id(4)),
                snapshot: selection_generated::SelectionSnapshot {
                    schema_version: 1,
                    turn_operation_id: id(10),
                    selection: vec![approval.identity.reference.clone()],
                    selection_digest: "a".repeat(64),
                },
                display: vec![],
            }],
            turns_truncated: false,
        };
        assert_eq!(
            validate_approval(&approval, &view, &scope(), &id(4)),
            Ok(())
        );
        let mut old_turn = view.clone();
        old_turn.turns[0].turn = id(31);
        assert_eq!(
            validate_approval(&approval, &old_turn, &scope(), &id(4)),
            Err(Code::AuthorityMismatch)
        );
        let mut previous_host = view;
        previous_host.turns[0].host = Some(id(32));
        let tools: wire::ToolSnapshot = serde_json::from_value(serde_json::json!({
            "agentSessionId":id(3),"nativeTurnId":id(11),"truncated":false,"items":[{
                "nativeItemId":id(40),"nativeThreadId":id(13),"nativeTurnId":id(11),
                "serverName":"yijie_market","toolName":"tushare_daily","state":"failed",
                "resultText":"已观察到的历史失败结果","truncated":false
            }]
        }))
        .unwrap();
        assert_eq!(
            validate_tools(&tools, &previous_host, &previous_host.turns[0]),
            Ok(())
        );
        let mut other_thread = tools.clone();
        other_thread.items[0].native_thread_id = id(41);
        assert_eq!(
            validate_tools(&other_thread, &previous_host, &previous_host.turns[0]),
            Err(Code::AuthorityMismatch)
        );
        assert_eq!(
            validate_approval(&approval, &previous_host, &scope(), &id(4)),
            Err(Code::AuthorityMismatch)
        );
    }
}
