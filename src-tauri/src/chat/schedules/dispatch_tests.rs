//! Safe composition tests: SQLCipher, the native service, original Coordinator,
//! actual HostBridge and declared HTTP responses. No Host/Runtime/Provider process.
#[path = "manual_composition_tests.rs"]
mod manual_composition_tests;
use super::*;
use crate::chat::{
    authorization::AuthoritativeChatProjection,
    database::ChatScope,
    keychain::{DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore},
    public_tasks::NativePublicTaskControlPlane,
    schedules::{
        execution_generated::*, generated::*, ScheduleExecutionService, ScheduleStorageMode,
    },
    sidecar::HostConnection,
};
use crate::{local_profile::*, native_auth::NativeAuthRuntime};
use serde_json::{json, Value};
use std::{
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::PathBuf,
    sync::Mutex,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
};

struct Keys;
impl DatabaseKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<DatabaseKey, ChatError> {
        Ok(DatabaseKey::from_bytes([155; 32]))
    }
}
impl ReceiptKeyStore for Keys {
    fn load_or_create(&self, _: bool) -> Result<ReceiptKey, ChatError> {
        Ok(ReceiptKey::from_bytes([156; 32]))
    }
}
fn scope() -> ChatScope {
    ChatScope::new(DEMO_FAST_OWNER_USER_ID.into(), DEMO_FAST_TENANT_ID.into()).unwrap()
}
fn authority() -> NativeAuthRuntime {
    NativeAuthRuntime::from_environment_with_test_profile(
        None,
        false,
        LocalRuntimeProfile::DemoFast,
    )
}
struct Fixture {
    root: PathBuf,
    db: DatabaseWorker,
    app: ConversationApplication,
    service: ScheduleExecutionService,
    context: Uuid,
    gate: super::super::lifecycle::Lifecycle,
    server: Server,
}
struct Server {
    state: Arc<Mutex<ServerState>>,
    stop: oneshot::Sender<()>,
    join: tokio::task::JoinHandle<()>,
}
type ReadyHook =
    Box<dyn FnOnce() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send>;
struct ServerState {
    task: Uuid,
    session: Uuid,
    thread: Uuid,
    turn: Uuid,
    cwd: PathBuf,
    draft_workspace: Option<String>,
    requests: Vec<(String, String, Value)>,
    pending: bool,
    reject: bool,
    mapping: bool,
    accepted: bool,
    complete: bool,
    on_ready: Option<ReadyHook>,
    on_stream: Option<ReadyHook>,
}
impl ServerState {
    fn session(&self) -> Value {
        json!({"session":{"task_id":self.task,"agent_session_id":self.session,
        "codex_thread_id":self.thread,"active_turn_id":"","state":"idle","cwd":self.cwd,
        "model":"MiniMax-M3","model_provider":"minimax","failure_code":"",
        "created_at":"2026-09-18T10:00:00Z","updated_at":"2026-09-18T10:00:01Z"}})
    }
    fn posts(&self) -> usize {
        self.requests.iter().filter(|r| r.0 == "POST").count()
    }
}
async fn request(stream: &mut tokio::net::TcpStream) -> (String, String, Value) {
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let n = stream.read(&mut buf).await.unwrap();
        assert_ne!(n, 0);
        bytes.extend_from_slice(&buf[..n]);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&bytes[..end]).unwrap();
            let length = headers
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|v| v.parse::<usize>().ok())
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                let mut first = headers.lines().next().unwrap().split_whitespace();
                return (
                    first.next().unwrap().into(),
                    first.next().unwrap().into(),
                    if length == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap()
                    },
                );
            }
        }
    }
}
impl Fixture {
    async fn new(candidate: bool) -> Self {
        Self::new_mode(candidate, false).await
    }
    async fn new_mode(candidate: bool, triggers: bool) -> Self {
        Self::new_options(candidate, triggers, false).await
    }
    async fn new_options(candidate: bool, triggers: bool, draft: bool) -> Self {
        let gate = super::super::lifecycle::Lifecycle::default();
        let root = std::env::temp_dir().join(format!("feat155-3c1-{}", Uuid::now_v7()));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        let db = if draft {
            DatabaseWorker::start_scheduled_candidate(
                root.join("chat"),
                scope(),
                Box::new(Keys),
                Box::new(Keys),
                authority(),
                gate.clone(),
            )
            .await
            .unwrap()
        } else if triggers {
            DatabaseWorker::start_schedule_trigger_candidate(
                root.join("chat"),
                scope(),
                Box::new(Keys),
                Box::new(Keys),
                authority(),
                gate.clone(),
            )
            .await
            .unwrap()
        } else if candidate {
            DatabaseWorker::start_schedule_dispatch_candidate(
                root.join("chat"),
                scope(),
                Box::new(Keys),
                Box::new(Keys),
                authority(),
            )
            .await
            .unwrap()
        } else {
            DatabaseWorker::start_with_schedule_storage(
                root.join("chat"),
                scope(),
                Box::new(Keys),
                Box::new(Keys),
                ScheduleStorageMode::DispatchFoundation,
            )
            .unwrap()
        };
        let ui = ChatAuthorizationManager::new(&scope()).unwrap();
        let n = unix_seconds().unwrap();
        let context = ui
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                    1,
                    n + 240,
                    demo_fast_capabilities(),
                )
                .unwrap(),
                n,
            )
            .unwrap()
            .context_id;
        let service = ScheduleExecutionService::new(db.clone(), authority(), ui);
        let nonce = Uuid::now_v7().to_string();
        let token = root.join("api-token");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&token)
            .unwrap();
        writeln!(file, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap();
        drop(file);
        let state = Arc::new(Mutex::new(ServerState {
            task: Uuid::now_v7(),
            session: Uuid::now_v7(),
            thread: Uuid::now_v7(),
            turn: Uuid::now_v7(),
            cwd: root.clone(),
            draft_workspace: None,
            requests: vec![],
            pending: false,
            reject: false,
            mapping: false,
            accepted: false,
            complete: true,
            on_ready: None,
            on_stream: None,
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (stop, mut stopped) = oneshot::channel();
        let shared = state.clone();
        let response_nonce = nonce.clone();
        let join = tokio::spawn(async move {
            loop {
                let socket = tokio::select! {biased; _=&mut stopped=>break, socket=listener.accept()=>socket.unwrap().0};
                let mut socket = socket;
                let (method, path, body) = request(&mut socket).await;
                let (status, value, callback) = {
                    let mut s = shared.lock().unwrap();
                    s.requests
                        .push((method.clone(), path.clone(), body.clone()));
                    let mut status = "200 OK";
                    let mut callback = None;
                    let value = if path.starts_with("/v8/agent-sessions/")
                        && path.ends_with("/events")
                    {
                        status = "SSE";
                        callback = s.on_stream.take();
                        let stream = Uuid::now_v7();
                        let event = json!({"schema_version":8,"event_id":Uuid::now_v7(),"stream_id":stream,"sequence":1,"occurred_at":"2026-09-18T10:00:00Z","task_id":s.task,"agent_session_id":s.session,"codex_thread_id":s.thread,"turn_id":s.turn,"event_type":"native.notification","terminal":true,"payload":{"native":{"source":"runtime_notification","method":"turn/completed","threadId":s.thread,"turnId":s.turn,"availability":"available","turn":{"id":s.turn,"status":"completed","items":[],"itemsComplete":false}}}});
                        json!({"stream":stream,"body":format!("id: {stream}:1\nevent: native.notification\ndata: {event}\n\n")})
                    } else if path == "/v1/scheduled-plan-draft-capability" {
                        json!({"schema_version":1,"available":!s.reject,"reason":if s.reject{"policy_unqualified"}else{"ready"}})
                    } else if path == "/v1/scheduled-plan-draft-sessions" {
                        assert!(crate::chat::schedules::drafts::valid_wire(
                            "CreateRequest",
                            &body
                        ));
                        s.task = Uuid::parse_str(body["task_id"].as_str().unwrap()).unwrap();
                        s.mapping = true;
                        s.draft_workspace = body["workspace_id"].as_str().map(str::to_owned);
                        json!({"schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft","task_id":s.task,"agent_session_id":s.session,"workspace_id":body["workspace_id"]})
                    } else if path.starts_with("/v1/scheduled-plan-draft-session-mappings/") {
                        json!({"schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft","task_id":s.task,"agent_session_id":s.session,"workspace_id":s.draft_workspace,"mapping_state":"bound","codex_thread_id":s.thread,"responding_host_instance_id":response_nonce})
                    } else if path.starts_with("/v1/scheduled-plan-draft-sessions/")
                        && path.ends_with("/resume")
                    {
                        json!({"schema_version":1,"policy_version":1,"purpose":"scheduled_plan_draft","task_id":s.task,"agent_session_id":s.session,"workspace_id":s.draft_workspace})
                    } else if path.starts_with("/v1/scheduled-plan-draft-sessions/")
                        && path.ends_with("/turns")
                    {
                        assert!(crate::chat::schedules::drafts::valid_wire(
                            "TurnRequest",
                            &body
                        ));
                        s.accepted = true;
                        json!({"schema_version":1,"policy_version":1,"agent_session_id":s.session,"operation_id":body["operation_id"],"turn_id":s.turn})
                    } else if path == "/readyz" {
                        callback = s.on_ready.take();
                        json!({"status":"ready","runtime_state":"ready"})
                    } else if path == "/healthz" {
                        json!({"service":"yijie-agent-host","status":"ok"})
                    } else if method == "POST" && path.ends_with("/agent-sessions") {
                        status = "201 Created";
                        s.task = Uuid::parse_str(path.split('/').nth(3).unwrap()).unwrap();
                        s.cwd = PathBuf::from(body["cwd"].as_str().unwrap());
                        s.mapping = true;
                        s.session()
                    } else if method == "POST"
                        && (path.ends_with("/permission-turns")
                            || path.starts_with("/v2/agent-sessions/") && path.ends_with("/turns"))
                    {
                        if s.reject {
                            status = "409 Conflict";
                            json!({"error":{"code":"session_not_usable","message":"Session is not usable"}})
                        } else {
                            status = "202 Accepted";
                            s.accepted = true;
                            json!({"turn_id":s.turn})
                        }
                    } else if path.ends_with("/agent-session-mapping") {
                        if s.mapping {
                            json!({"task_id":s.task,"agent_session_id":s.session,"mapping_state":"bound","codex_thread_id":s.thread,"responding_host_instance_id":response_nonce})
                        } else {
                            status = "404 Not Found";
                            json!({"error":{"code":"recovery_record_not_found","message":"No current record"}})
                        }
                    } else if path.contains("/turn-operations/") {
                        if s.accepted {
                            json!({"agent_session_id":s.session,"operation_id":path.rsplit('/').next().unwrap(),"state":"accepted","turn_id":s.turn,"responding_host_instance_id":response_nonce})
                        } else {
                            status = "404 Not Found";
                            json!({"error":{"code":"recovery_record_not_found","message":"No current record"}})
                        }
                    } else if path.ends_with("/runtime-approvals") {
                        if s.pending {
                            json!({"requests":[{"id":Uuid::now_v7(),"kind":"command","summary":"普通审批","scope":"当前会话","reason":"需要确认","status":"pending"}]})
                        } else {
                            json!({"requests":[]})
                        }
                    } else if method == "GET"
                        && path
                            == format!("/v1/agent-sessions/{}/turns/{}/timing", s.session, s.turn)
                    {
                        json!({"schema_version":1,"source":"runtime_read","agent_session_id":s.session,"thread_id":s.thread,"turn_id":s.turn,"started_at":{"state":"known","value":0},"completed_at":{"state":"known","value":0},"duration_ms":{"state":"known","value":440}})
                    } else if path.ends_with("/native-thread") {
                        json!({"schema_version":2,"source":"runtime_read","thread_id":s.thread,"turns":[{"id":s.turn,"status":if s.complete{"completed"}else{"inProgress"},"items":[],"itemsComplete":true}],"availability":"complete"})
                    } else if method == "GET" && path == format!("/v1/agent-sessions/{}", s.session)
                    {
                        s.session()
                    } else {
                        panic!("unexpected normal composition request {method} {path}")
                    };
                    (status, value, callback)
                };
                if status == "SSE" {
                    let body = value["body"].as_str().unwrap();
                    let stream = value["stream"].as_str().unwrap();
                    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nX-Accel-Buffering: no\r\nX-Yijie-Event-Schema-Version: 8\r\nX-Yijie-Event-Stream-ID: {stream}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
                    socket.write_all(response.as_bytes()).await.unwrap();
                    if let Some(callback) = callback {
                        callback().await;
                    }
                    socket.write_all(body.as_bytes()).await.unwrap();
                    socket.shutdown().await.unwrap();
                    continue;
                }
                if let Some(callback) = callback {
                    callback().await;
                }
                let body = value.to_string();
                let response=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Yijie-Host-Instance-Nonce: {response_nonce}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
                socket.shutdown().await.unwrap();
            }
        });
        let host = HostBridge::from_connection(HostConnection {
            port,
            token_path: token,
            instance_nonce: nonce,
        })
        .unwrap()
        .with_lifecycle(gate.clone());
        let app = ConversationApplication::new(
            db.clone(),
            Arc::new(host),
            Arc::new(NativePublicTaskControlPlane::new(
                authority(),
                Uuid::parse_str(DEMO_FAST_OWNER_USER_ID).unwrap(),
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
            )),
        )
        .with_native_lifecycle(gate.clone(), Some(authority()));
        Self {
            root,
            db,
            app,
            service,
            context,
            gate,
            server: Server { state, stop, join },
        }
    }
    async fn prepare(
        &self,
        mode: TargetMode,
        chat: Option<String>,
        max: i64,
    ) -> (PlanView, GrantView, RunView) {
        let p = self
            .service
            .save_plan(
                self.context,
                SavePlanRequest {
                    request_id: Uuid::now_v7().to_string(),
                    plan_id: None,
                    expected_revision: None,
                    definition: PlanDefinition {
                        name: "普通合成计划".into(),
                        content: "普通合成文本".into(),
                        rule: TimeRule {
                            frequency: TimeRuleFrequency::Daily,
                            time_zone: "Asia/Shanghai".into(),
                            local_time: "09:00".into(),
                            local_date: None,
                            weekdays: None,
                        },
                        target: TargetReference {
                            mode,
                            conversation_id: chat,
                        },
                    },
                },
            )
            .await
            .unwrap();
        let g = self
            .service
            .confirm_grant(
                self.context,
                GrantConfirmation {
                    request_id: Uuid::now_v7().to_string(),
                    plan_id: p.plan_id.clone(),
                    expected_revision: p.revision,
                    max_runs: max,
                    expires_at: unix_seconds().unwrap() + 3600,
                },
            )
            .await
            .unwrap();
        let run = self
            .service
            .prepare_manual(g.grant_id.clone(), p.revision, Uuid::now_v7().to_string())
            .await
            .unwrap();
        (p, g, run)
    }
    async fn binding(&self, run: &RunView) -> (Uuid, Uuid, Option<Uuid>) {
        let id = run.run_id.clone();
        self.db.call(move |r| {let x:(String,String,Option<String>)=r.connection.query_row("SELECT conversation_id,local_turn_id,create_operation_id FROM chat_scheduled_run_bindings WHERE run_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();Ok((Uuid::parse_str(&x.0).unwrap(),Uuid::parse_str(&x.1).unwrap(),x.2.map(|v|Uuid::parse_str(&v).unwrap())))}).await.unwrap()
    }
    async fn local_binding(&self) {
        assert!(matches!(
            self.app.dispatch_next().await.unwrap(),
            DispatchOutcome::ControlPlaneChanged(_)
        ));
    }
    async fn create(&self) {
        let result = self.app.dispatch_next().await.unwrap();
        assert!(
            matches!(result, DispatchOutcome::SessionBound { .. }),
            "{result:?}"
        );
    }
    async fn turn(&self) {
        let result = self.app.dispatch_next().await.unwrap();
        assert!(
            matches!(result, DispatchOutcome::TurnAccepted { .. }),
            "{result:?}"
        );
    }
    async fn finish(&self, run: &RunView) {
        let (chat, turn, _) = self.binding(run).await;
        *self.app.recovery_poll.lock().unwrap() = None;
        self.app.recover_schedule_once().await.unwrap();
        self.app.stream_active_turn(chat).await.unwrap();
        assert!(!self
            .app
            .native_history(chat, vec![turn])
            .await
            .unwrap()
            .views
            .is_empty());
        assert_eq!(
            self.service
                .read_run(run.run_id.clone())
                .await
                .unwrap()
                .native_outcome,
            NativeOutcome::Completed
        );
    }
    async fn close(self) {
        let Self {
            root,
            db,
            app,
            service,
            server,
            ..
        } = self;
        drop(app);
        drop(service);
        drop(db);
        server.stop.send(()).unwrap();
        server.join.await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn feat155_3c1_three_targets_last_debit_and_dedicated_reuse() {
    for mode in [TargetMode::DedicatedChat, TargetMode::NewChatEachRun] {
        let f = Fixture::new(true).await;
        let (p, g, r) = f.prepare(mode, None, 2).await;
        f.local_binding().await;
        f.create().await;
        f.turn().await;
        f.finish(&r).await;
        let (chat, _, _) = f.binding(&r).await;
        if mode == TargetMode::DedicatedChat {
            f.server.state.lock().unwrap().turn = Uuid::now_v7();
            let again = f
                .service
                .prepare_manual(g.grant_id.clone(), p.revision, Uuid::now_v7().to_string())
                .await
                .unwrap();
            assert_eq!(f.binding(&again).await.0, chat);
            assert_eq!(
                f.service
                    .read_grant(g.grant_id.clone())
                    .await
                    .unwrap()
                    .state,
                GrantState::Exhausted
            );
            f.turn().await;
            f.finish(&again).await;
            assert_eq!(
                f.service
                    .read_grant(g.grant_id.clone())
                    .await
                    .unwrap()
                    .occupied_runs,
                2
            );
            assert_eq!(
                f.service
                    .prepare_manual(g.grant_id, p.revision, Uuid::now_v7().to_string())
                    .await
                    .unwrap_err(),
                ExecutionErrorCode::GrantExhausted
            );
            assert_eq!(f.server.state.lock().unwrap().posts(), 3);
        } else {
            assert_eq!(f.server.state.lock().unwrap().posts(), 2);
        }
        // A plan using the existing managed chat keeps the exact session and path.
        f.server.state.lock().unwrap().turn = Uuid::now_v7();
        let (_, g, r) = f
            .prepare(TargetMode::ExistingChat, Some(chat.to_string()), 1)
            .await;
        let request = r.request_id.clone();
        assert_eq!(
            f.service
                .prepare_manual(g.grant_id.clone(), r.plan_revision, request)
                .await
                .unwrap(),
            r
        );
        f.turn().await;
        f.finish(&r).await;
        assert_eq!(
            f.service
                .read_grant(g.grant_id)
                .await
                .unwrap()
                .occupied_runs,
            1
        );
        assert!(f
            .server
            .state
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|r| r.0 == "POST" && r.1.ends_with("/permission-turns"))
            .all(|r| r.2["permission_mode"] == "ask"));
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c1_default_reader_and_writer_cannot_dispatch() {
    let f = Fixture::new(false).await;
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    assert_eq!(f.db.schema_version().await.unwrap(), 20);
    assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    let op = f.binding(&run).await.2.unwrap();
    assert!(f.db.guard_conversation_dispatch(op).await.is_err());
    assert!(f.server.state.lock().unwrap().requests.is_empty());
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_pending_approval_blocks_then_same_operation_can_start() {
    let f = Fixture::new(true).await;
    let (_, g, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    f.create().await;
    f.server.state.lock().unwrap().pending = true;
    f.app.dispatch_next().await.unwrap();
    assert_eq!(f.server.state.lock().unwrap().posts(), 1);
    let id = run.run_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT turn_attempt FROM chat_scheduled_recovery WHERE run_id=?1",
                    [id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "never"
        );
        Ok(())
    })
    .await
    .unwrap();
    f.server.state.lock().unwrap().pending = false;
    // Move only the normal synthetic retry deadline; never change the device clock.
    let op = run.operation_id.clone();
    f.db.call(move |r| {
        r.connection
            .execute(
                "UPDATE chat_outbox SET next_attempt_at=0 WHERE operation_id=?1",
                [op],
            )
            .unwrap();
        Ok(())
    })
    .await
    .unwrap();
    f.turn().await;
    f.finish(&run).await;
    assert_eq!(
        f.service
            .read_grant(g.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        1
    );
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_attempted_rejection_never_reposts_or_refunds() {
    let f = Fixture::new(true).await;
    let (_, g, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    f.create().await;
    f.server.state.lock().unwrap().reject = true;
    f.app.dispatch_next().await.unwrap();
    assert_eq!(
        f.service
            .read_run(run.run_id.clone())
            .await
            .unwrap()
            .delivery_state,
        DeliveryState::Uncertain
    );
    let op = run.operation_id.clone();
    f.db.call(move |r| {
        r.connection
            .execute(
                "UPDATE chat_outbox SET next_attempt_at=0 WHERE operation_id=?1",
                [op],
            )
            .unwrap();
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    f.app.recover_schedule_once().await.unwrap();
    assert!(f.service.cancel_unsent(run.run_id.clone()).await.is_err());
    assert_eq!(f.server.state.lock().unwrap().posts(), 2);
    assert_eq!(
        f.service
            .read_grant(g.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        1
    );
    let id = run.run_id;
    f.db.call(move|r|{let x:(String,Option<String>,String)=r.connection.query_row("SELECT e.turn_attempt,e.turn_error_code,r.native_outcome FROM chat_scheduled_recovery e JOIN chat_scheduled_runs r ON r.run_id=e.run_id WHERE e.run_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(x.0,"attempted");assert!(x.1.is_some());assert_eq!(x.2,"unobserved");Ok(())}).await.unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_sleep_during_host_ready_prevents_attempt_and_post() {
    let f = Fixture::new(true).await;
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    let gate = f.gate.clone();
    f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
        Box::pin(async move { gate.transition(super::super::lifecycle::Phase::Suspended) })
    }));
    f.app.dispatch_next().await.unwrap();
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    let id = run.run_id;
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT create_attempt FROM chat_scheduled_recovery WHERE run_id=?1",
                    [id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "never"
        );
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat155_3c1_original_coordinator_reaches_native_terminal_and_stops_normally() {
    let f = Fixture::new(true).await;
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    // Keep the read snapshot nonterminal so this case deterministically exercises
    // native SSE even when the normal one-second recovery poll fires first.
    f.server.state.lock().unwrap().complete = false;
    let coordinator =
        ConversationCoordinator::start(f.app.clone(), Duration::from_millis(10)).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if f.service
                .read_run(run.run_id.clone())
                .await
                .unwrap()
                .native_outcome
                == NativeOutcome::Completed
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    coordinator.stop().await.unwrap(); // normal join even when the assertion fails
    assert!(result.is_ok());
    assert_eq!(f.server.state.lock().unwrap().posts(), 2);
    assert!(f
        .server
        .state
        .lock()
        .unwrap()
        .requests
        .iter()
        .any(|r| r.1.starts_with("/v8/")));
    f.db.call(|r| {
        assert_eq!(
            r.connection
                .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_mapping_recovery_enqueues_only_original_turn_once() {
    let f = Fixture::new(true).await;
    let (_, g, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    let (chat, _, create) = f.binding(&run).await;
    let create = create.unwrap();
    let nonce = Uuid::now_v7().to_string(); // declared prior normally stopped owner
    f.db.call(move |r| {
        let claimed = r
            .claim_next_conversation_outbox(unix_seconds()?, 30)?
            .unwrap();
        assert_eq!(claimed.operation_id, create);
        r.begin_conversation_dispatch(create, &nonce)?;
        r.record_stopped_schedule_generation(&nonce)
    })
    .await
    .unwrap();
    let directory =
        f.db.call(move |r| {
            let project: String = r
                .connection
                .query_row(
                    "SELECT project_id FROM chat_sessions WHERE id=?1",
                    [chat.to_string()],
                    |r| r.get(0),
                )
                .unwrap();
            r.resolve_schedule_project(&project)
        })
        .await
        .unwrap();
    let task =
        f.db.call(move |r| {
            let id: String = r
                .connection
                .query_row(
                    "SELECT public_task_id FROM chat_public_task_bindings WHERE session_id=?1",
                    [chat.to_string()],
                    |r| r.get(0),
                )
                .unwrap();
            Ok(Uuid::parse_str(&id).unwrap())
        })
        .await
        .unwrap();
    {
        let mut s = f.server.state.lock().unwrap();
        s.task = task;
        s.cwd = directory;
        s.mapping = true;
    }
    // Declared persisted pre-existing remote mapping, no dropped response or fault injection.
    f.app.recover_schedule_once().await.unwrap();
    let mapping = f
        .app
        .host()
        .unwrap()
        .schedule_session_mapping(task)
        .await
        .unwrap()
        .unwrap();
    let id = run.run_id.clone();
    f.db.call(move |r| {
        let n = unix_seconds()?;
        r.apply_schedule_mapping(
            &authority().schedule_authority(n).unwrap(),
            &id,
            &mapping,
            n,
        )
    })
    .await
    .unwrap();
    f.turn().await;
    f.finish(&run).await;
    assert_eq!(f.server.state.lock().unwrap().posts(), 1);
    assert_eq!(
        f.service
            .read_grant(g.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        1
    );
    let op = run.operation_id.clone();
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT count(*) FROM chat_outbox WHERE operation_id=?1",
                    [op],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_grant_change_during_readiness_is_checked_before_io() {
    let f = Fixture::new(true).await;
    let (_, g, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    let db = f.db.clone();
    let grant = g.grant_id.clone();
    f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
        Box::pin(async move {
            db.call(move |r| {
                r.connection
                    .execute(
                        "UPDATE chat_scheduled_grants SET expires_at=?2 WHERE grant_id=?1",
                        rusqlite::params![grant, unix_seconds()? - 1],
                    )
                    .unwrap();
                Ok(())
            })
            .await
            .unwrap();
        })
    }));
    assert!(matches!(
        f.app.dispatch_next().await.unwrap(),
        DispatchOutcome::RetryScheduled { .. }
    ));
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    let id = run.run_id;
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT create_attempt FROM chat_scheduled_recovery WHERE run_id=?1",
                    [id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "never"
        );
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}
#[tokio::test]
async fn feat155_3c1_claim_rechecks_edit_ask_target_and_other_occupancy() {
    for case in ["edit", "ask", "target", "other"] {
        let f = Fixture::new(true).await;
        let (p, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
        match case {
            "edit" => {
                let mut d = p.definition.clone();
                d.content = "已编辑的普通文本".into();
                f.service
                    .save_plan(
                        f.context,
                        SavePlanRequest {
                            request_id: Uuid::now_v7().to_string(),
                            plan_id: Some(p.plan_id),
                            expected_revision: Some(p.revision),
                            definition: d,
                        },
                    )
                    .await
                    .unwrap();
            }
            "ask" => {
                let (chat, _, _) = f.binding(&run).await;
                f.db.call(move |r| {
                    r.connection
                        .execute(
                            "UPDATE chat_task_permissions SET mode='auto' WHERE session_id=?1",
                            [chat.to_string()],
                        )
                        .unwrap();
                    Ok(())
                })
                .await
                .unwrap();
            }
            "target" => {
                let id = run.run_id.clone();
                f.db.call(move|r|{r.connection.execute("UPDATE chat_scheduled_run_bindings SET target_deleted=1 WHERE run_id=?1",[id]).unwrap();Ok(())}).await.unwrap();
            }
            _ => {
                let id = Uuid::now_v7().to_string();
                let (chat, _, _) = f.binding(&run).await;
                f.db.call(move|r|{r.connection.execute("INSERT INTO chat_outbox(operation_id,session_id,kind,state,attempt_count,payload_version,encrypted_payload) VALUES(?1,?2,'start_turn','pending',0,2,?3)",rusqlite::params![id,chat.to_string(),b"{}".as_slice()]).unwrap();Ok(())}).await.unwrap();
            }
        }
        assert_eq!(
            f.app.dispatch_next().await.unwrap(),
            DispatchOutcome::Idle,
            "{case}"
        );
        assert_eq!(f.server.state.lock().unwrap().posts(), 0);
        f.close().await;
    }
}
#[tokio::test]
async fn feat155_3c1_reader_reopens_20_preserving_run_and_default_15() {
    let f = Fixture::new(true).await;
    let (_, _, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    let Fixture {
        root,
        db,
        app,
        service,
        server,
        ..
    } = f;
    drop(app);
    drop(service);
    drop(db);
    let reader =
        DatabaseWorker::start(root.join("chat"), scope(), Box::new(Keys), Box::new(Keys)).unwrap();
    assert_eq!(reader.schema_version().await.unwrap(), 20);
    reader
        .call(move |r| {
            assert!(r
                .claim_next_conversation_outbox(unix_seconds()?, 30)?
                .is_none());
            assert!(r.schedule_dispatch_authority.is_none());
            assert_eq!(
                r.connection
                    .query_row(
                        "SELECT delivery_state FROM chat_scheduled_runs WHERE run_id=?1",
                        [run.run_id],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "reserved"
            );
            Ok(())
        })
        .await
        .unwrap();
    drop(reader);
    let old = DatabaseWorker::start(
        root.join("old-chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
    )
    .unwrap();
    assert_eq!(old.schema_version().await.unwrap(), 15);
    let project = root.join("project");
    std::fs::create_dir(&project).unwrap();
    let selection = crate::chat::native_project::create_selection(&project)
        .unwrap()
        .unwrap();
    let project = old
        .register_project(selection.canonical_path, selection.bookmark)
        .await
        .unwrap();
    let pending = old
        .call(move |r| {
            r.create_session_and_enqueue(
                Uuid::parse_str(&project.id).unwrap(),
                "普通旧聊天",
                Uuid::now_v7(),
            )
        })
        .await
        .unwrap();
    drop(old);
    let new = DatabaseWorker::start_with_schedule_storage(
        root.join("old-chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
        ScheduleStorageMode::DispatchFoundation,
    )
    .unwrap();
    assert_eq!(new.schema_version().await.unwrap(), 20);
    assert_eq!(
        new.load_history(pending.session_id, None, Some(20))
            .await
            .unwrap()
            .turns
            .len(),
        1
    );
    drop(new);
    let reopened = DatabaseWorker::start(
        root.join("old-chat"),
        scope(),
        Box::new(Keys),
        Box::new(Keys),
    )
    .unwrap();
    assert_eq!(reopened.schema_version().await.unwrap(), 20);
    assert_eq!(
        reopened
            .load_history(pending.session_id, None, Some(20))
            .await
            .unwrap()
            .turns
            .len(),
        1
    );
    drop(reopened);
    server.stop.send(()).unwrap();
    server.join.await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn feat155_3c1_never_sent_native_claim_cancels_and_refunds_once() {
    let f = Fixture::new(true).await;
    let (_, g, run) = f.prepare(TargetMode::DedicatedChat, None, 1).await;
    f.local_binding().await;
    // Local public-task binding/claims happened; neither Host stage attempted I/O.
    f.service.cancel_unsent(run.run_id.clone()).await.unwrap();
    f.service.cancel_unsent(run.run_id.clone()).await.unwrap();
    assert_eq!(
        f.service
            .read_grant(g.grant_id)
            .await
            .unwrap()
            .occupied_runs,
        0
    );
    assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    let id = run.run_id;
    f.db.call(move |r| {
        assert_eq!(
            r.connection
                .query_row(
                    "SELECT release_kind FROM chat_scheduled_recovery WHERE run_id=?1",
                    [id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "never_sent_cancel"
        );
        assert_eq!(
            r.connection
                .query_row("SELECT count(*) FROM chat_scheduled_reservation", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}

#[tokio::test]
async fn feat155_3c1_existing_user_bookmark_keeps_original_path_and_session() {
    let f = Fixture::new(true).await;
    let project = f.root.join("user-project");
    std::fs::create_dir(&project).unwrap();
    let selection = crate::chat::native_project::create_selection(&project)
        .unwrap()
        .unwrap();
    let expected = selection.canonical_path.clone();
    let registered =
        f.db.register_project(selection.canonical_path, selection.bookmark)
            .await
            .unwrap();
    let pending =
        f.db.call(move |r| {
            r.create_session_and_enqueue_multimodal(
                Uuid::parse_str(&registered.id).unwrap(),
                &[DraftContentBlock::Text("普通旧聊天".into())],
                Uuid::now_v7(),
                1,
            )
        })
        .await
        .unwrap();
    f.local_binding().await;
    f.create().await;
    f.turn().await;
    f.app.stream_active_turn(pending.session_id).await.unwrap();
    let before = f.server.state.lock().unwrap().posts();
    let session = f.server.state.lock().unwrap().session;
    f.server.state.lock().unwrap().turn = Uuid::now_v7();
    let (_, _, run) = f
        .prepare(
            TargetMode::ExistingChat,
            Some(pending.session_id.to_string()),
            1,
        )
        .await;
    f.turn().await;
    f.finish(&run).await;
    {
        let s = f.server.state.lock().unwrap();
        assert_eq!(s.cwd, expected);
        assert_eq!(s.session, session);
        assert_eq!(s.posts(), before + 1);
    }
    f.close().await;
}

#[path = "trigger_tests.rs"]
mod trigger_tests;

#[tokio::test]
async fn feat155_draft_original_coordinator_typed_routes_and_policy_denial() {
    for deny in [false, true] {
        let f = Fixture::new_options(false, false, true).await;
        let ui = ChatAuthorizationManager::new(&scope()).unwrap();
        let n = unix_seconds().unwrap();
        let context = ui
            .bind(
                AuthoritativeChatProjection::from_trusted_native_projection(
                    Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                    1,
                    n + 240,
                    demo_fast_capabilities(),
                )
                .unwrap(),
                n,
            )
            .unwrap()
            .context_id;
        let nonce = f.app.host().unwrap().instance_nonce().to_owned();
        let epoch = f.gate.epoch();
        f.db.call(move |r| r.draft_host_observed(nonce, epoch))
            .await
            .unwrap();
        let value=crate::chat::schedules::ipc::execute_composition_fixture(&f.db,authority(),ui,crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":context,"payload":{"text":"每天九点总结"}}),"schedule_submit_draft_v1").await.unwrap();
        f.local_binding().await;
        f.server.state.lock().unwrap().reject = deny;
        if deny {
            assert_eq!(
                f.app.dispatch_next().await.unwrap_err(),
                ChatError::SidecarUnavailable
            );
            assert_eq!(f.server.state.lock().unwrap().posts(), 0);
        } else {
            f.create().await;
            f.turn().await;
            assert!(matches!(
                f.app.dispatch_next().await.unwrap(),
                DispatchOutcome::Idle
            ));
            let state = f.server.state.lock().unwrap();
            assert_eq!(state.posts(), 3);
            assert!(state
                .requests
                .iter()
                .filter(|r| r.0 == "POST")
                .all(|r| r.1.starts_with("/v1/scheduled-plan-draft-sessions")));
            assert!(!value["data"]["source_id"].is_null());
            if let Ok(dir) = std::env::var("YIJIE_FEAT155_CONFORMANCE_DIR") {
                let rows:Vec<_>=state.requests.iter().filter(|r|r.0=="POST").map(|r|json!({"schema":if r.1.ends_with("/turns"){"TurnRequest"}else if r.1.ends_with("/resume"){"ResumeRequest"}else{"CreateRequest"},"value":r.2})).collect();
                std::fs::write(
                    std::path::Path::new(&dir).join("desktop-draft-producer.json"),
                    serde_json::to_vec_pretty(&rows).unwrap(),
                )
                .unwrap();
            }
        }
        f.close().await;
    }
}

async fn draft_submit_action(f: &Fixture) -> (Value, ChatAuthorizationManager, Uuid) {
    let ui = ChatAuthorizationManager::new(&scope()).unwrap();
    let n = unix_seconds().unwrap();
    let context = ui
        .bind(
            AuthoritativeChatProjection::from_trusted_native_projection(
                Uuid::parse_str(DEMO_FAST_TENANT_ID).unwrap(),
                1,
                n + 240,
                demo_fast_capabilities(),
            )
            .unwrap(),
            n,
        )
        .unwrap()
        .context_id;
    let nonce = f.app.host().unwrap().instance_nonce().to_owned();
    let epoch = f.gate.epoch();
    f.db.call(move |r| r.draft_host_observed(nonce, epoch))
        .await
        .unwrap();
    let value=crate::chat::schedules::ipc::execute_composition_fixture(&f.db,authority(),ui.clone(),crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":context,"payload":{"text":"每天九点总结"}}),"schedule_submit_draft_v1").await.unwrap();
    (value["data"].clone(), ui, context)
}
#[tokio::test]
async fn feat155_draft_http_readonly_recovery_and_later_coordinator_never_post() {
    let f = Fixture::new_options(false, false, true).await;
    let (receipt, ui, context) = draft_submit_action(&f).await;
    f.local_binding().await;
    let id = receipt["source_id"].as_str().unwrap().to_owned();
    let c =
        f.db.call(move |r| {
            let claim = r
                .claim_next_conversation_outbox(unix_seconds().unwrap() + 1, 30)?
                .unwrap();
            r.mark_draft_attempt(claim.operation_id)?;
            r.draft_runtime.actions.clear();
            r.draft_source_context(&id)
        })
        .await
        .unwrap();
    {
        let mut s = f.server.state.lock().unwrap();
        s.task = c.task.unwrap();
        s.mapping = true;
        s.draft_workspace = Some(c.workspace.clone());
    }
    for _ in 0..3 {
        let id = c.source.clone();
        let c =
            f.db.call(move |r| r.draft_source_context(&id))
                .await
                .unwrap();
        crate::chat::schedules::draft_recovery::recover_source(
            &f.db,
            f.app.host().unwrap(),
            &f.gate,
            c,
        )
        .await
        .unwrap();
        f.app.native_schedule_tick().await.unwrap();
        assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    }
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    let result=crate::chat::schedules::ipc::execute_composition_fixture(&f.db,authority(),ui,crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":context,"payload":{"source_id":receipt["source_id"]}}),"schedule_continue_draft_source_v1").await.unwrap();
    assert_eq!(result["data"]["operation_id"], receipt["operation_id"]);
    f.turn().await;
    let count = f.server.state.lock().unwrap().posts();
    assert_eq!(count, 2);
    for _ in 0..2 {
        f.app.native_schedule_tick().await.unwrap();
        assert_eq!(f.app.dispatch_next().await.unwrap(), DispatchOutcome::Idle);
    }
    assert_eq!(f.server.state.lock().unwrap().posts(), count);
    f.close().await;
}
#[tokio::test]
async fn feat155_draft_last_post_rechecks_normal_revocation_and_suspend() {
    for suspend in [false, true] {
        let f = Fixture::new_options(false, false, true).await;
        let (receipt, ui, _) = draft_submit_action(&f).await;
        f.local_binding().await;
        let lifecycle = f.gate.clone();
        f.server.state.lock().unwrap().on_ready = Some(Box::new(move || {
            Box::pin(async move {
                if suspend {
                    lifecycle.transition(super::super::lifecycle::Phase::Suspended)
                } else {
                    ui.invalidate_all().unwrap();
                }
            })
        }));
        let _outcome = f.app.dispatch_next().await;
        assert_eq!(f.server.state.lock().unwrap().posts(), 0);
        let id = receipt["source_id"].as_str().unwrap().to_owned();
        f.db.call(move |r| {
            let c = r.draft_source_context(&id)?;
            assert!(!c.create_attempted);
            assert!(!c.turn_attempted);
            Ok(())
        })
        .await
        .unwrap();
        f.close().await;
    }
}

#[tokio::test]
async fn feat155_draft_accepted_recovery_null_origin_observes_sse_without_post() {
    let f = Fixture::new_options(false, false, true).await;
    let (receipt, ui, context) = draft_submit_action(&f).await;
    f.local_binding().await;
    let id = receipt["source_id"].as_str().unwrap().to_owned();
    // Declared pre-existing accepted identities, not a dropped network response.
    let c =
        f.db.call(move |r| {
            let claim = r
                .claim_next_conversation_outbox(unix_seconds().unwrap() + 1, 30)?
                .unwrap();
            r.mark_draft_attempt(claim.operation_id)?;
            r.draft_runtime.actions.clear();
            r.draft_source_context(&id)
        })
        .await
        .unwrap();
    {
        let mut s = f.server.state.lock().unwrap();
        s.task = c.task.unwrap();
        s.mapping = true;
        s.draft_workspace = Some(c.workspace.clone());
        s.complete = false;
    }
    crate::chat::schedules::draft_recovery::recover_source(
        &f.db,
        f.app.host().unwrap(),
        &f.gate,
        c.clone(),
    )
    .await
    .unwrap();
    crate::chat::schedules::ipc::execute_composition_fixture(&f.db,authority(),ui,crate::chat::schedules::ipc::ScheduleIpcRuntime::default(),json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":context,"payload":{"source_id":receipt["source_id"]}}),"schedule_continue_draft_source_v1").await.unwrap();
    let id = c.source.clone();
    let c =
        f.db.call(move |r| {
            let claim = r
                .claim_next_conversation_outbox(unix_seconds().unwrap() + 1, 30)?
                .unwrap();
            r.mark_draft_attempt(claim.operation_id)?;
            r.draft_runtime.actions.clear();
            r.draft_source_context(&id)
        })
        .await
        .unwrap();
    f.server.state.lock().unwrap().accepted = true;
    crate::chat::schedules::draft_recovery::recover_source(
        &f.db,
        f.app.host().unwrap(),
        &f.gate,
        c.clone(),
    )
    .await
    .unwrap();
    f.app.stream_active_turn(c.conversation).await.unwrap();
    assert_eq!(f.server.state.lock().unwrap().posts(), 0);
    f.db.call(move |r| {
        let origin: Option<String> = r
            .connection
            .query_row(
                "SELECT host_instance_nonce FROM chat_native_bindings WHERE turn_id=?1",
                [c.local_turn.to_string()],
                |r| r.get(0),
            )
            .unwrap();
        assert!(origin.is_none());
        assert!(r
            .claim_next_conversation_outbox(unix_seconds().unwrap() + 120, 30)?
            .is_none());
        Ok(())
    })
    .await
    .unwrap();
    f.close().await;
}

#[path = "single_composition_tests.rs"]
mod single_composition_tests;
