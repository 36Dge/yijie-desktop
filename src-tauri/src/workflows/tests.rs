//! Normal local HTTP consumer conformance, not a Coze/desktop application or D4 harness.
//! No fault injection, executable replacement, permission damage, or hostile resources.
use super::*;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

const EPOCH: &str = "15300000-0000-4000-8000-000000000001";
const WORKFLOW_ID: &str = "workflow-153";

fn random_secret() -> SecretValue {
    let mut bytes = Zeroizing::new([0_u8; 32]);
    getrandom::fill(bytes.as_mut()).unwrap();
    SecretValue::new(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn limits() -> Limits {
    // Values are read from the consumed source rather than copied into test defaults.
    let fields = validation::source()["$defs"]["Limits"]["properties"]
        .as_object()
        .unwrap();
    let values: serde_json::Map<String, serde_json::Value> = fields
        .iter()
        .map(|(name, schema)| (name.clone(), schema["enum"][0].clone()))
        .collect();
    serde_json::from_value(serde_json::Value::Object(values)).unwrap()
}

fn initial_workflow(name: String) -> Workflow {
    Workflow {
        workflow_id: WORKFLOW_ID.into(),
        description: None,
        name,
        revision: "revision-1".into(),
        canvas: r#"{"nodes":[],"edges":[]}"#.into(),
        runnable: false,
        published_version: None,
        updated_at_ms: 1,
    }
}

#[derive(Default)]
struct ProviderState {
    workflow: Option<Workflow>,
    deleted: bool,
    runs: HashMap<String, Run>,
    operations: HashMap<String, OperationReceipt>,
    saves: usize,
    closes: usize,
    session_creations: usize,
    next_bootstrap: Option<(oneshot::Sender<()>, oneshot::Receiver<()>)>,
}

struct Fixture {
    runtime: WorkflowRuntime,
    state: Arc<Mutex<ProviderState>>,
    secret: SecretValue,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
    credential_path: PathBuf,
}

impl Fixture {
    async fn new() -> Self {
        let token = random_secret();
        let secret = random_secret();
        let credential_path = std::env::temp_dir().join(format!(
            "yijie-workflow-conformance-{}.json",
            uuid::Uuid::now_v7()
        ));
        let bytes = Zeroizing::new(
            serde_json::to_vec(&serde_json::json!({
                "schema_version": 1, "run_epoch": EPOCH, "token": token.expose()
            }))
            .unwrap(),
        );
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&credential_path)
            .unwrap();
        file.write_all(&bytes).unwrap();
        drop(file);
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let (stop, mut stopped) = oneshot::channel();
        let state = Arc::new(Mutex::new(ProviderState::default()));
        let task_state = state.clone();
        let task_secret = secret.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stopped => break,
                    accepted = listener.accept() => {
                        let (stream, _) = accepted.unwrap();
                        serve_one(stream, &token, &task_secret, &task_state).await;
                    }
                }
            }
        });
        let authority = NativeAuthRuntime::from_environment_with_test_profile(
            None,
            false,
            LocalRuntimeProfile::DemoFast,
        );
        let runtime = WorkflowRuntime {
            configuration: Arc::new(Configuration::Enabled {
                credential_path: credential_path.clone(),
            }),
            authority,
            transport: Some(Arc::new(Transport::for_normal_loopback_provider(port))),
            state: Arc::new(Mutex::new(BindingState::default())),
            opening: Arc::new(Mutex::new(())),
            context_revision: Arc::new(AtomicU64::new(0)),
        };
        Self {
            runtime,
            state,
            secret,
            stop,
            task,
            credential_path,
        }
    }

    async fn finish(self) {
        self.runtime.shutdown_for_app_exit().await;
        self.stop.send(()).unwrap();
        self.task.await.unwrap();
        std::fs::remove_file(self.credential_path).unwrap();
    }
}

async fn serve_one(
    mut stream: TcpStream,
    token: &SecretValue,
    secret: &SecretValue,
    state: &Mutex<ProviderState>,
) {
    let mut raw = Zeroizing::new(Vec::new());
    let (header_end, body_size) = loop {
        let mut chunk = [0_u8; 4096];
        let count = stream.read(&mut chunk).await.unwrap();
        assert!(count > 0);
        raw.extend_from_slice(&chunk[..count]);
        assert!(raw.len() < validation::MAX_MESSAGE_BYTES + 8192);
        if let Some(end) = raw.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&raw[..end]).unwrap();
            let size = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if raw.len() >= end + 4 + size {
                break (end, size);
            }
        }
    };
    let headers = std::str::from_utf8(&raw[..header_end]).unwrap();
    let mut first = headers.lines().next().unwrap().split_whitespace();
    let method = first.next().unwrap().to_owned();
    let path = first.next().unwrap().split('?').next().unwrap().to_owned();
    let header = |wanted: &str| {
        headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case(wanted).then(|| value.trim())
        })
    };
    let expected_authorization = Zeroizing::new(format!("Bearer {}", token.expose()));
    assert!(header("authorization") == Some(expected_authorization.as_str()));
    assert!(header("x-yijie-run-epoch") == Some(EPOCH));
    assert_eq!(header("x-yijie-workflow-metadata"), Some("description-v1"));
    let session_required = method == "PUT"
        || path.ends_with("/bootstrap")
        || path.ends_with("/test-runs")
        || path.ends_with("/versions");
    assert!(if session_required {
        header("x-yijie-editor-session") == Some(secret.expose())
    } else {
        header("x-yijie-editor-session").is_none()
    });
    let input: serde_json::Value = if body_size == 0 {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&raw[header_end + 4..header_end + 4 + body_size]).unwrap()
    };
    let mut state = state.lock().await;
    let (status, output) = match (method.as_str(), path.as_str()) {
        ("GET", "/v1/workflow-local/status") => (
            200,
            serde_json::to_value(ServiceStatus {
                protocol_version: 1,
                run_epoch: EPOCH.into(),
                ready: true,
                state: "ready".into(),
                limits: limits(),
            })
            .unwrap(),
        ),
        ("DELETE", path) if path == format!("/v1/workflows/{WORKFLOW_ID}") => {
            validation::value("DeleteRequest", &input).unwrap();
            let request: DeleteRequest = serde_json::from_value(input).unwrap();
            assert_eq!(
                request.expected_revision,
                state.workflow.as_ref().unwrap().revision
            );
            state.deleted = true;
            (
                200,
                serde_json::json!({"workflow_id":WORKFLOW_ID,"deleted":true}),
            )
        }
        ("POST", "/v1/workflows") => {
            validation::value("CreateRequest", &input).unwrap();
            let request: CreateRequest = serde_json::from_value(input).unwrap();
            assert!(
                uuid::Uuid::parse_str(&request.operation_id)
                    .unwrap()
                    .get_version_num()
                    == 7
            );
            let mut workflow = initial_workflow(request.name);
            workflow.description = request.description;
            state.operations.insert(
                request.operation_id.clone(),
                receipt(request.operation_id, OperationKind::Create, &workflow, None),
            );
            state.workflow = Some(workflow.clone());
            (201, serde_json::to_value(workflow).unwrap())
        }
        ("GET", "/v1/workflows") => (
            200,
            serde_json::to_value(WorkflowList {
                items: state
                    .workflow
                    .iter()
                    .map(|workflow| WorkflowSummary {
                        description: workflow.description.clone(),
                        workflow_id: workflow.workflow_id.clone(),
                        name: workflow.name.clone(),
                        revision: workflow.revision.clone(),
                        runnable: workflow.runnable,
                        published_version: workflow.published_version.clone(),
                        updated_at_ms: workflow.updated_at_ms,
                    })
                    .collect(),
                next_cursor: None,
            })
            .unwrap(),
        ),
        ("POST", "/v1/workflow-local/editor-sessions") => {
            validation::value("EditorOpenRequest", &input).unwrap();
            state.session_creations += 1;
            (
                201,
                serde_json::to_value(EditorSessionSecret {
                    session_id: format!("session-{}", state.session_creations),
                    workflow_id: WORKFLOW_ID.into(),
                    secret: secret.expose().into(),
                    run_epoch: EPOCH.into(),
                    expires_at_ms: now_ms().unwrap() + EDITOR_TTL_MS,
                })
                .unwrap(),
            )
        }
        ("DELETE", path) if path.starts_with("/v1/workflow-local/editor-sessions/") => {
            state.closes += 1;
            (
                200,
                serde_json::to_value(CloseResult { closed: true }).unwrap(),
            )
        }
        ("GET", path) if path.ends_with("/bootstrap") => (
            200,
            serde_json::to_value(Bootstrap {
                workflow: state.workflow.clone().unwrap(),
                principal: Principal {
                    owner_id: crate::local_profile::DEMO_FAST_OWNER_USER_ID.into(),
                    tenant_id: crate::local_profile::DEMO_FAST_TENANT_ID.into(),
                    user_id: "user-153".into(),
                    space_id: "space-153".into(),
                },
                node_types: vec![1, 15, 2],
                limits: limits(),
            })
            .unwrap(),
        ),
        ("GET", "/v1/workflows/workflow-153") => (
            200,
            serde_json::to_value(state.workflow.clone().unwrap()).unwrap(),
        ),
        ("PUT", "/v1/workflows/workflow-153") => {
            validation::value("SaveRequest", &input).unwrap();
            let request: SaveRequest = serde_json::from_value(input).unwrap();
            let workflow = state.workflow.as_mut().unwrap();
            assert!(workflow.revision == request.expected_revision);
            workflow.name = request.name;
            workflow.canvas = request.canvas;
            workflow.revision = "revision-2".into();
            let workflow = workflow.clone();
            state.operations.insert(
                request.operation_id.clone(),
                receipt(request.operation_id, OperationKind::Save, &workflow, None),
            );
            state.saves += 1;
            (200, serde_json::to_value(workflow).unwrap())
        }
        ("POST", "/v1/workflows/workflow-153/test-runs") => {
            validation::value("TestRequest", &input).unwrap();
            let request: TestRequest = serde_json::from_value(input).unwrap();
            let workflow = state.workflow.clone().unwrap();
            assert!(workflow.revision == request.expected_revision);
            let run = sample_run(
                request.operation_id.clone(),
                RunMode::Debug,
                request.input,
                Some(request.expected_revision),
                None,
            );
            state.operations.insert(
                request.operation_id.clone(),
                receipt(
                    request.operation_id,
                    OperationKind::Test,
                    &workflow,
                    Some(run.run_id.clone()),
                ),
            );
            state.runs.insert(run.run_id.clone(), run.clone());
            (202, serde_json::to_value(run).unwrap())
        }
        ("POST", "/v1/workflows/workflow-153/versions") => {
            validation::value("PublishRequest", &input).unwrap();
            let request: PublishRequest = serde_json::from_value(input).unwrap();
            let successful = state.runs.get(&request.successful_test_run_id).unwrap();
            assert!(successful.terminal && successful.state == "succeeded");
            assert!(successful.revision.as_deref() == Some(&request.expected_revision));
            let workflow = state.workflow.as_mut().unwrap();
            assert!(workflow.revision == request.expected_revision);
            workflow.published_version = Some("v0.0.1".into());
            workflow.runnable = true;
            let workflow = workflow.clone();
            state.operations.insert(
                request.operation_id.clone(),
                receipt(
                    request.operation_id,
                    OperationKind::Publish,
                    &workflow,
                    None,
                ),
            );
            (200, serde_json::to_value(workflow).unwrap())
        }
        ("POST", "/v1/workflows/workflow-153/runs") => {
            validation::value("RunRequest", &input).unwrap();
            let request: RunRequest = serde_json::from_value(input).unwrap();
            let workflow = state.workflow.clone().unwrap();
            assert!(workflow.published_version.as_deref() == Some(request.version.as_str()));
            let run = sample_run(
                request.operation_id.clone(),
                RunMode::Release,
                request.input,
                None,
                Some(request.version),
            );
            state.operations.insert(
                request.operation_id.clone(),
                receipt(
                    request.operation_id,
                    OperationKind::Run,
                    &workflow,
                    Some(run.run_id.clone()),
                ),
            );
            state.runs.insert(run.run_id.clone(), run.clone());
            (202, serde_json::to_value(run).unwrap())
        }
        ("GET", path) if path.starts_with("/v1/workflow-local/operations/") => {
            let id = path.rsplit('/').next().unwrap();
            (
                200,
                serde_json::to_value(state.operations.get(id).unwrap()).unwrap(),
            )
        }
        ("GET", "/v1/workflows/workflow-153/runs") => (
            200,
            serde_json::to_value(RunList {
                items: state
                    .runs
                    .values()
                    .map(|run| RunSummary {
                        run_id: run.run_id.clone(),
                        workflow_id: run.workflow_id.clone(),
                        operation_id: run.operation_id.clone(),
                        mode: run.mode,
                        revision: run.revision.clone(),
                        version: run.version.clone(),
                        state: run.state.clone(),
                        terminal: run.terminal,
                        started_at_ms: run.started_at_ms,
                        finished_at_ms: run.finished_at_ms,
                        error: run.error.clone(),
                    })
                    .collect(),
                next_cursor: None,
            })
            .unwrap(),
        ),
        ("GET", path) if path.starts_with("/v1/workflows/workflow-153/runs/") => {
            let id = path.rsplit('/').next().unwrap();
            (
                200,
                serde_json::to_value(state.runs.get(id).unwrap()).unwrap(),
            )
        }
        _ => panic!("unplanned normal conformance route"),
    };
    let bootstrap_turn = if path.ends_with("/bootstrap") {
        state.next_bootstrap.take()
    } else {
        None
    };
    drop(state);
    if let Some((reached, continue_response)) = bootstrap_turn {
        reached.send(()).unwrap();
        continue_response.await.unwrap();
    }
    let bytes = Zeroizing::new(serde_json::to_vec(&output).unwrap());
    let headers = format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
    stream.write_all(headers.as_bytes()).await.unwrap();
    stream.write_all(&bytes).await.unwrap();
    stream.shutdown().await.unwrap();
}

fn receipt(
    operation_id: String,
    kind: OperationKind,
    workflow: &Workflow,
    run_id: Option<String>,
) -> OperationReceipt {
    OperationReceipt {
        operation_id,
        kind,
        phase: OperationPhase::Completed,
        workflow_id: Some(workflow.workflow_id.clone()),
        revision: Some(workflow.revision.clone()),
        version: workflow.published_version.clone(),
        run_id,
        error: None,
    }
}

fn sample_run(
    operation_id: String,
    mode: RunMode,
    input: TextInput,
    revision: Option<String>,
    version: Option<String>,
) -> Run {
    let debug = mode == RunMode::Debug;
    let output = debug.then(|| input.input.clone());
    Run {
        run_id: if mode == RunMode::Debug {
            "debug-153"
        } else {
            "release-153"
        }
        .into(),
        workflow_id: WORKFLOW_ID.into(),
        operation_id,
        mode,
        revision,
        version,
        // A source-permitted new native state remains a string; the consumer does not invent success.
        state: if debug {
            "succeeded"
        } else {
            "engine_native_observed"
        }
        .into(),
        terminal: debug,
        input: Some(input),
        output,
        nodes: Some(vec![]),
        started_at_ms: 1,
        finished_at_ms: debug.then_some(2),
        error: None,
    }
}

fn exchange_input(
    view: &EditorOpenedView,
    request_id: &str,
    operation: EditorOperation,
) -> EditorExchangeInput {
    EditorExchangeInput {
        bridge_id: view.bridge_id.clone(),
        generation: view.generation,
        protocol_version: 1,
        request_id: request_id.into(),
        operation,
        expected_revision: None,
        name: None,
        canvas: None,
        input: None,
        successful_test_run_id: None,
        run_id: None,
        operation_id: None,
    }
}

#[tokio::test]
async fn normal_context_change_during_open_retires_the_late_session() {
    let fixture = Fixture::new().await;
    fixture
        .runtime
        .create(CreateInput {
            description: None,
            name: "上下文切换合成流程".into(),
        })
        .await
        .unwrap();
    let (reached, ready) = oneshot::channel();
    let (continue_response, response_turn) = oneshot::channel();
    fixture.state.lock().await.next_bootstrap = Some((reached, response_turn));
    let runtime = fixture.runtime.clone();
    let opening = tokio::spawn(async move {
        runtime
            .open(EditorOpenRequest {
                workflow_id: WORKFLOW_ID.into(),
            })
            .await
    });
    // Schedule an ordinary context transition before the normal bootstrap response.
    ready.await.unwrap();
    fixture.runtime.invalidate_local().await;
    continue_response.send(()).unwrap();
    assert_eq!(
        opening.await.unwrap().unwrap_err().code,
        ErrorCode::SessionExpired
    );
    assert!(fixture.runtime.state.lock().await.editor.is_none());
    assert_eq!(fixture.state.lock().await.closes, 1);
    fixture.finish().await;
}

#[tokio::test]
async fn delayed_normal_window_cleanup_preserves_a_new_context_binding() {
    let fixture = Fixture::new().await;
    let runtime = &fixture.runtime;
    runtime
        .create(CreateInput {
            description: None,
            name: "正常页面上下文".into(),
        })
        .await
        .unwrap();
    runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    // Window callbacks mark the context synchronously; their async cleanup may
    // run after the user has normally reopened the page in a new context.
    let invalidated = runtime.context_revision.fetch_add(1, Ordering::AcqRel);
    let reopened = runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    runtime.revoke_invalidated(invalidated).await;
    let result = runtime
        .exchange(exchange_input(
            &reopened,
            "req-new-context",
            EditorOperation::ReadDraft,
        ))
        .await
        .unwrap();
    assert_eq!(result.workflow.unwrap().workflow_id, WORKFLOW_ID);
    assert_eq!(fixture.state.lock().await.closes, 1);
    fixture.finish().await;
}

#[tokio::test]
async fn normal_close_invalidates_a_queued_editor_reopen() {
    let fixture = Fixture::new().await;
    let runtime = fixture.runtime.clone();
    runtime
        .create(CreateInput {
            description: None,
            name: "正常关闭合成流程".into(),
        })
        .await
        .unwrap();
    let opened = runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    let opening_turn = runtime.opening.lock().await;
    let queued = runtime.open(EditorOpenRequest {
        workflow_id: WORKFLOW_ID.into(),
    });
    tokio::pin!(queued);
    // Poll until the ordinary serialization lock parks the open. No service failure is induced.
    tokio::select! {
        biased;
        _ = &mut queued => panic!("reopen must wait its normal serialization turn"),
        _ = std::future::ready(()) => {}
    }
    runtime
        .close(EditorCloseInput {
            bridge_id: opened.bridge_id,
        })
        .await
        .unwrap();
    drop(opening_turn);
    assert_eq!(queued.await.unwrap_err().code, ErrorCode::SessionExpired);
    assert!(runtime.state.lock().await.editor.is_none());
    assert_eq!(fixture.state.lock().await.session_creations, 1);
    assert_eq!(fixture.state.lock().await.closes, 1);
    fixture.finish().await;
}

#[tokio::test]
async fn normal_loopback_native_consumer_preserves_resources_operations_and_expired_close() {
    let fixture = Fixture::new().await;
    let runtime = &fixture.runtime;
    assert!(runtime.service_status().await.unwrap().ready);
    assert!(runtime
        .list(ListRequest {
            cursor: None,
            limit: None
        })
        .await
        .unwrap()
        .items
        .is_empty());
    let created = runtime
        .create(CreateInput {
            description: Some("本地文本用途".into()),
            name: "合成通用流程".into(),
        })
        .await
        .unwrap();
    assert_eq!(created.workflow_id, WORKFLOW_ID);
    assert_eq!(created.description.as_deref(), Some("本地文本用途"));
    assert_eq!(
        runtime
            .list(ListRequest {
                cursor: None,
                limit: Some(20)
            })
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    let opened = runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    let visible = serde_json::to_string(&opened).unwrap();
    assert!(!visible.contains(fixture.secret.expose()));
    assert!(!visible.contains("session_id"));
    assert!(!visible.contains("secret"));
    let bootstrap = runtime
        .exchange(exchange_input(
            &opened,
            "req-bootstrap",
            EditorOperation::Bootstrap,
        ))
        .await
        .unwrap();
    assert_eq!(
        bootstrap.bootstrap.unwrap().workflow.workflow_id,
        WORKFLOW_ID
    );
    let read = runtime
        .exchange(exchange_input(
            &opened,
            "req-read",
            EditorOperation::ReadDraft,
        ))
        .await
        .unwrap();
    assert_eq!(read.workflow.unwrap().revision, opened.workflow.revision);
    let mut save = exchange_input(&opened, "req-save", EditorOperation::SaveDraft);
    save.expected_revision = Some(opened.workflow.revision.clone());
    save.name = Some("已保存的合成流程".into());
    save.canvas = Some(r#"{"nodes":[],"edges":[],"remark":"合成草稿"}"#.into());
    let saved = runtime.exchange(save.clone()).await.unwrap();
    let save_id = saved.operation_id.clone().unwrap();
    assert_eq!(
        uuid::Uuid::parse_str(&save_id).unwrap().get_version_num(),
        7
    );
    let duplicate = runtime.exchange(save).await.unwrap_err();
    assert_eq!(duplicate.code, ErrorCode::OperationConflict);
    assert_eq!(duplicate.operation_id.as_deref(), Some(save_id.as_str()));
    assert_eq!(fixture.state.lock().await.saves, 1);
    let mut test = exchange_input(&opened, "req-test", EditorOperation::TestDraft);
    test.expected_revision = Some("revision-2".into());
    test.input = Some(TextInput {
        input: "合成输入".into(),
    });
    let tested = runtime.exchange(test).await.unwrap().run.unwrap();
    assert!(tested.terminal);
    assert_eq!(tested.state, "succeeded");
    let mut publish = exchange_input(&opened, "req-publish", EditorOperation::PublishInternal);
    publish.expected_revision = Some("revision-2".into());
    publish.successful_test_run_id = Some(tested.run_id);
    let published = runtime.exchange(publish).await.unwrap().workflow.unwrap();
    assert_eq!(published.published_version.as_deref(), Some("v0.0.1"));
    let run = runtime
        .start_run(RunInput {
            workflow_id: WORKFLOW_ID.into(),
            version: "v0.0.1".into(),
            input: TextInput {
                input: "演示".into(),
            },
        })
        .await
        .unwrap();
    {
        // Evaluate the legitimate expiry transition with an expired in-memory deadline, without changing system time or a service.
        let mut state = runtime.state.lock().await;
        state.editor.as_mut().unwrap().deadline = Instant::now();
    }
    assert_eq!(
        runtime
            .exchange(exchange_input(
                &opened,
                "req-expired",
                EditorOperation::ReadDraft
            ))
            .await
            .unwrap_err()
            .code,
        ErrorCode::SessionExpired
    );
    assert!(runtime
        .state
        .lock()
        .await
        .editor
        .as_ref()
        .unwrap()
        .secret
        .is_none());
    assert!(
        runtime
            .close(EditorCloseInput {
                bridge_id: opened.bridge_id.clone()
            })
            .await
            .unwrap()
            .closed
    );
    assert!(
        runtime
            .close(EditorCloseInput {
                bridge_id: opened.bridge_id
            })
            .await
            .unwrap()
            .closed
    );
    assert_eq!(fixture.state.lock().await.closes, 1);
    let queried = runtime
        .query(RunQueryInput {
            kind: RunQueryKind::Run,
            workflow_id: Some(WORKFLOW_ID.into()),
            run_id: Some(run.run_id.clone()),
            operation_id: None,
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
    assert_eq!(queried.run.unwrap().run_id, run.run_id);
    let history = runtime
        .query(RunQueryInput {
            kind: RunQueryKind::History,
            workflow_id: Some(WORKFLOW_ID.into()),
            run_id: None,
            operation_id: None,
            cursor: None,
            limit: Some(50),
        })
        .await
        .unwrap()
        .history
        .unwrap();
    assert_eq!(history.items.len(), 2);
    let recorded = runtime
        .query(RunQueryInput {
            kind: RunQueryKind::Operation,
            workflow_id: None,
            run_id: None,
            operation_id: Some(save_id.clone()),
            cursor: None,
            limit: None,
        })
        .await
        .unwrap();
    assert_eq!(recorded.receipt.unwrap().operation_id, save_id);
    let reopened = runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    assert!(reopened.generation > opened.generation);
    assert_eq!(reopened.workflow.name, "已保存的合成流程");
    runtime.invalidate_local().await;
    assert!(runtime.state.lock().await.editor.is_none());
    assert_eq!(fixture.state.lock().await.closes, 2);
    runtime
        .open(EditorOpenRequest {
            workflow_id: WORKFLOW_ID.into(),
        })
        .await
        .unwrap();
    let provider_state = fixture.state.clone();
    fixture.finish().await;
    assert_eq!(provider_state.lock().await.closes, 3);
}

#[test]
fn normal_clock_offsets_keep_the_original_monotonic_session_cap() {
    let started = Instant::now();
    let observed = started + Duration::from_millis(20);
    let local_now = 1_000_020;
    let cap = started + Duration::from_millis(EDITOR_TTL_MS as u64);
    // An ordinary two-second container lead does not reject a newly issued session.
    assert_eq!(
        editor_deadline(started, observed, 1_302_000, local_now).unwrap(),
        cap
    );
    // A lagging server expires sooner; the request's original monotonic cap still applies.
    assert_eq!(
        editor_deadline(started, observed, 1_298_000, local_now).unwrap(),
        started + Duration::from_millis(298_000)
    );
    assert_eq!(
        editor_deadline(started, observed, local_now, local_now)
            .unwrap_err()
            .code,
        ErrorCode::SessionExpired
    );
    assert_eq!(
        editor_deadline(started, cap, 1_600_000, 1_300_000)
            .unwrap_err()
            .code,
        ErrorCode::SessionExpired
    );
}

#[test]
fn source_validator_enforces_utf8_and_preserves_new_engine_state() {
    assert!(validation::typed(
        "TextInput",
        &TextInput {
            input: "文".repeat(1365)
        }
    )
    .is_ok());
    assert!(validation::typed(
        "TextInput",
        &TextInput {
            input: "文".repeat(1366)
        }
    )
    .is_err());
    let run = sample_run(
        uuid::Uuid::now_v7().to_string(),
        RunMode::Release,
        TextInput {
            input: "normal".into(),
        },
        None,
        Some("v0.0.1".into()),
    );
    assert!(validation::typed("Run", &run).is_ok());
    assert!(!run.terminal);
}

#[test]
fn uncertain_write_keeps_the_native_operation_id_without_reissuing_it() {
    let operation_id = uuid::Uuid::now_v7().to_string();
    let result = with_operation(error(ErrorCode::ProtocolMismatch), Some(&operation_id));
    assert_eq!(result.code, ErrorCode::OperationUnknown);
    assert_eq!(result.operation_id.as_deref(), Some(operation_id.as_str()));
}

#[tokio::test]
async fn disabled_profile_never_requires_an_editor_or_network_for_status() {
    let runtime = WorkflowRuntime::new(
        LocalRuntimeProfile::Standard,
        NativeAuthRuntime::from_environment_with_test_profile(
            None,
            false,
            LocalRuntimeProfile::Standard,
        ),
    );
    assert_eq!(
        runtime.service_status().await.unwrap_err().code,
        ErrorCode::ProfileDisabled
    );
}

#[tokio::test]
async fn normal_delete_is_idempotent_and_clears_matching_native_editor() {
    let fixture = Fixture::new().await;
    let w = fixture
        .runtime
        .create(CreateInput {
            name: "删除合成流程".into(),
            description: None,
        })
        .await
        .unwrap();
    fixture
        .runtime
        .open(EditorOpenRequest {
            workflow_id: w.workflow_id.clone(),
        })
        .await
        .unwrap();
    for _ in 0..2 {
        let result = fixture
            .runtime
            .delete(DeleteInput {
                workflow_id: w.workflow_id.clone(),
                expected_revision: w.revision.clone(),
            })
            .await
            .unwrap();
        assert!(result.deleted);
        assert_eq!(result.workflow_id, w.workflow_id);
    }
    assert!(fixture.state.lock().await.deleted);
    assert!(fixture.runtime.state.lock().await.editor.is_none());
    fixture.finish().await;
}
