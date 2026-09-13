use super::config::{Configuration, Credentials};
use super::generated::*;
use super::transport::Transport;
use super::{error, validation};
use crate::local_profile::LocalRuntimeProfile;
use crate::native_auth::{NativeAuthRuntime, SecretValue};
use reqwest::Method;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const MAX_EDITOR_REQUESTS: usize = 2048;
const EDITOR_TTL_MS: i64 = 300_000;

struct EditorBinding {
    bridge_id: String,
    session_id: String,
    workflow_id: String,
    epoch: String,
    generation: i64,
    context_revision: u64,
    expires_at_ms: i64,
    deadline: Instant,
    secret: Option<SecretValue>,
    requests: HashMap<String, Option<String>>,
}

#[derive(Default)]
struct BindingState {
    epoch: Option<String>,
    generation: i64,
    editor: Option<EditorBinding>,
    shutdown: bool,
}

struct ExchangeLease {
    bridge_id: String,
    workflow_id: String,
    generation: i64,
    epoch: String,
    secret: SecretValue,
    operation_id: Option<String>,
}

#[derive(Clone)]
pub(crate) struct WorkflowRuntime {
    configuration: Arc<Configuration>,
    authority: NativeAuthRuntime,
    transport: Option<Arc<Transport>>,
    state: Arc<Mutex<BindingState>>,
    opening: Arc<Mutex<()>>,
    context_revision: Arc<AtomicU64>,
}

impl WorkflowRuntime {
    pub(crate) fn new(profile: LocalRuntimeProfile, authority: NativeAuthRuntime) -> Self {
        Self {
            configuration: Arc::new(Configuration::from_environment(profile)),
            authority,
            transport: Transport::new().ok().map(Arc::new),
            state: Arc::new(Mutex::new(BindingState::default())),
            opening: Arc::new(Mutex::new(())),
            context_revision: Arc::new(AtomicU64::new(0)),
        }
    }

    fn check_authority(&self) -> Result<(), ErrorResponse> {
        self.authority
            .workflow_local_authority()
            .map_err(|_| error(ErrorCode::Unauthorized))?;
        Ok(())
    }

    fn transport(&self) -> Result<&Transport, ErrorResponse> {
        self.transport
            .as_deref()
            .ok_or_else(|| error(ErrorCode::ServiceUnavailable))
    }

    async fn credentials(&self) -> Result<Credentials, ErrorResponse> {
        let credentials = self.configuration.credentials()?;
        self.check_authority()?;
        let mut state = self.state.lock().await;
        if state.shutdown {
            return Err(error(ErrorCode::ServiceUnavailable));
        }
        if state.epoch.as_deref() != Some(&credentials.epoch) {
            if state.epoch.is_some() {
                self.context_revision.fetch_add(1, Ordering::AcqRel);
            }
            state.editor = None;
            state.epoch = Some(credentials.epoch.clone());
        }
        Ok(credentials)
    }

    async fn status_for(&self, credentials: &Credentials) -> Result<ServiceStatus, ErrorResponse> {
        let status: ServiceStatus = self
            .transport()?
            .request(
                credentials,
                Method::GET,
                "/v1/workflow-local/status",
                None,
                None,
                200,
                "ServiceStatus",
                None,
            )
            .await?;
        if status.run_epoch != credentials.epoch || status.ready != (status.state == "ready") {
            self.invalidate_local().await;
            return Err(error(ErrorCode::ProtocolMismatch));
        }
        Ok(status)
    }

    async fn ready(&self) -> Result<Credentials, ErrorResponse> {
        let credentials = self.credentials().await?;
        if !self.status_for(&credentials).await?.ready {
            return Err(error(ErrorCode::ServiceUnavailable));
        }
        Ok(credentials)
    }

    pub(super) async fn service_status(&self) -> Result<ServiceStatus, ErrorResponse> {
        let credentials = self.credentials().await?;
        self.status_for(&credentials).await
    }

    pub(super) async fn list(&self, input: ListRequest) -> Result<WorkflowList, ErrorResponse> {
        input_valid("ListRequest", &input)?;
        let credentials = self.ready().await?;
        self.transport()?
            .request(
                &credentials,
                Method::GET,
                &with_page("/v1/workflows", input.cursor.as_deref(), input.limit),
                None,
                None,
                200,
                "WorkflowList",
                None,
            )
            .await
    }

    pub(super) async fn create(&self, input: CreateInput) -> Result<Workflow, ErrorResponse> {
        input_valid("CreateInput", &input)?;
        let credentials = self.ready().await?;
        let request = CreateRequest {
            name: input.name,
            operation_id: uuid::Uuid::now_v7().to_string(),
        };
        self.transport()?
            .request(
                &credentials,
                Method::POST,
                "/v1/workflows",
                Some(encode("CreateRequest", &request)?),
                None,
                201,
                "Workflow",
                Some(&request.operation_id),
            )
            .await
    }

    pub(super) async fn open(
        &self,
        input: EditorOpenRequest,
    ) -> Result<EditorOpenedView, ErrorResponse> {
        // Capture before any await, including the serialized-open queue and status request.
        let context_revision = self.context_revision.load(Ordering::Acquire);
        input_valid("EditorOpenRequest", &input)?;
        let _opening = self.opening.lock().await;
        let credentials = self.ready().await?;
        let old = self.state.lock().await.editor.take();
        if let Some(old) = old {
            self.retire(&credentials, old).await?;
        }
        if self.context_revision.load(Ordering::Acquire) != context_revision {
            return Err(error(ErrorCode::SessionExpired));
        }
        let started = Instant::now();
        let (session, secret) = self
            .transport()?
            .open_session(&credentials, encode("EditorOpenRequest", &input)?)
            .await?;
        let session_id = session.session_id.clone();
        let installed = async {
            if session.run_epoch != credentials.epoch || session.workflow_id != input.workflow_id {
                return Err(error(ErrorCode::ProtocolMismatch));
            }
            let deadline =
                editor_deadline(started, Instant::now(), session.expires_at_ms, now_ms()?)?;
            let bootstrap: Bootstrap = self
                .transport()?
                .request(
                    &credentials,
                    Method::GET,
                    &workflow_path(&input.workflow_id, "bootstrap"),
                    None,
                    Some(&secret),
                    200,
                    "Bootstrap",
                    None,
                )
                .await?;
            self.validate_bootstrap(&bootstrap, &input.workflow_id)?;
            let mut state = self.state.lock().await;
            if state.shutdown
                || self.context_revision.load(Ordering::Acquire) != context_revision
                || state.epoch.as_deref() != Some(&credentials.epoch)
                || Instant::now() >= deadline
                || now_ms()? >= session.expires_at_ms
            {
                return Err(error(ErrorCode::SessionExpired));
            }
            state.generation = state
                .generation
                .checked_add(1)
                .ok_or_else(|| error(ErrorCode::InternalError))?;
            let view = EditorOpenedView {
                bridge_id: uuid::Uuid::now_v7().to_string(),
                workflow: bootstrap.workflow,
                generation: state.generation,
                expires_at_ms: session.expires_at_ms,
                protocol_version: 1,
            };
            validation::typed("EditorOpenedView", &view)
                .map_err(|_| error(ErrorCode::ProtocolMismatch))?;
            state.editor = Some(EditorBinding {
                bridge_id: view.bridge_id.clone(),
                session_id: session.session_id,
                workflow_id: input.workflow_id,
                epoch: credentials.epoch.clone(),
                generation: state.generation,
                context_revision,
                expires_at_ms: session.expires_at_ms,
                deadline,
                secret: Some(secret),
                requests: HashMap::new(),
            });
            Ok(view)
        }
        .await;
        if installed.is_err() {
            // Every failure after a decoded session follows normal revocation, outside state locks.
            let _ = self.delete_session(&credentials, &session_id).await;
        }
        installed
    }

    fn validate_bootstrap(
        &self,
        bootstrap: &Bootstrap,
        workflow_id: &str,
    ) -> Result<(), ErrorResponse> {
        let (owner, tenant, _) = self
            .authority
            .workflow_local_authority()
            .map_err(|_| error(ErrorCode::Unauthorized))?;
        let mut node_types = bootstrap.node_types.clone();
        node_types.sort_unstable();
        if bootstrap.workflow.workflow_id != workflow_id
            || bootstrap.principal.owner_id != owner.to_string()
            || bootstrap.principal.tenant_id != tenant.to_string()
            || node_types != [1, 2, 15]
        {
            return Err(error(ErrorCode::ProtocolMismatch));
        }
        Ok(())
    }

    async fn exchange_lease(
        &self,
        credentials: &Credentials,
        input: &EditorExchangeInput,
    ) -> Result<ExchangeLease, ErrorResponse> {
        let mut state = self.state.lock().await;
        let editor = state
            .editor
            .as_mut()
            .ok_or_else(|| error(ErrorCode::SessionExpired))?;
        if editor.bridge_id != input.bridge_id
            || editor.generation != input.generation
            || editor.epoch != credentials.epoch
            || editor.context_revision != self.context_revision.load(Ordering::Acquire)
        {
            return Err(error(ErrorCode::SessionExpired));
        }
        if Instant::now() >= editor.deadline || now_ms()? >= editor.expires_at_ms {
            editor.secret = None;
            return Err(error(ErrorCode::SessionExpired));
        }
        if let Some(operation_id) = editor.requests.get(&input.request_id) {
            let mut failure = error(ErrorCode::OperationConflict);
            failure.operation_id = operation_id.clone();
            return Err(failure);
        }
        if editor.requests.len() >= MAX_EDITOR_REQUESTS {
            return Err(error(ErrorCode::SessionExpired));
        }
        let operation_id = matches!(
            input.operation,
            EditorOperation::SaveDraft
                | EditorOperation::TestDraft
                | EditorOperation::PublishInternal
        )
        .then(|| uuid::Uuid::now_v7().to_string());
        let secret = editor
            .secret
            .as_ref()
            .ok_or_else(|| error(ErrorCode::SessionExpired))?
            .clone();
        editor
            .requests
            .insert(input.request_id.clone(), operation_id.clone());
        Ok(ExchangeLease {
            bridge_id: editor.bridge_id.clone(),
            workflow_id: editor.workflow_id.clone(),
            generation: editor.generation,
            epoch: editor.epoch.clone(),
            secret,
            operation_id,
        })
    }

    async fn lease_still_current(&self, lease: &ExchangeLease) -> bool {
        let state = self.state.lock().await;
        !state.shutdown
            && state.editor.as_ref().is_some_and(|editor| {
                editor.bridge_id == lease.bridge_id
                    && editor.generation == lease.generation
                    && editor.epoch == lease.epoch
                    && editor.context_revision == self.context_revision.load(Ordering::Acquire)
            })
    }

    pub(super) async fn exchange(
        &self,
        input: EditorExchangeInput,
    ) -> Result<EditorExchangeResult, ErrorResponse> {
        input_valid("EditorExchangeInput", &input)?;
        exact_operation_fields("EditorExchangeInput", &input)?;
        let credentials = self.ready().await?;
        let lease = self.exchange_lease(&credentials, &input).await?;
        let mut result = EditorExchangeResult {
            request_id: input.request_id.clone(),
            operation_id: lease.operation_id.clone(),
            bootstrap: None,
            workflow: None,
            run: None,
            receipt: None,
        };
        let transport = self.transport()?;
        let operation_id = lease.operation_id.as_deref();
        let result_inner: Result<(), ErrorResponse> = async {
            match input.operation {
                EditorOperation::Bootstrap => {
                    let bootstrap: Bootstrap = transport
                        .request(
                            &credentials,
                            Method::GET,
                            &workflow_path(&lease.workflow_id, "bootstrap"),
                            None,
                            Some(&lease.secret),
                            200,
                            "Bootstrap",
                            None,
                        )
                        .await?;
                    self.validate_bootstrap(&bootstrap, &lease.workflow_id)?;
                    result.bootstrap = Some(bootstrap);
                }
                EditorOperation::ReadDraft => {
                    result.workflow = Some(
                        transport
                            .request(
                                &credentials,
                                Method::GET,
                                &workflow_path(&lease.workflow_id, ""),
                                None,
                                None,
                                200,
                                "Workflow",
                                None,
                            )
                            .await?,
                    );
                }
                EditorOperation::SaveDraft => {
                    let request = SaveRequest {
                        operation_id: operation_id.expect("write operation allocated").to_owned(),
                        expected_revision: input
                            .expected_revision
                            .clone()
                            .expect("source required field"),
                        name: input.name.clone().expect("source required field"),
                        canvas: input.canvas.clone().expect("source required field"),
                    };
                    result.workflow = Some(
                        transport
                            .request(
                                &credentials,
                                Method::PUT,
                                &workflow_path(&lease.workflow_id, ""),
                                Some(encode("SaveRequest", &request)?),
                                Some(&lease.secret),
                                200,
                                "Workflow",
                                operation_id,
                            )
                            .await?,
                    );
                }
                EditorOperation::TestDraft => {
                    let request = TestRequest {
                        operation_id: operation_id.expect("write operation allocated").to_owned(),
                        expected_revision: input
                            .expected_revision
                            .clone()
                            .expect("source required field"),
                        input: input.input.clone().expect("source required field"),
                    };
                    result.run = Some(
                        transport
                            .request(
                                &credentials,
                                Method::POST,
                                &workflow_path(&lease.workflow_id, "test-runs"),
                                Some(encode("TestRequest", &request)?),
                                Some(&lease.secret),
                                202,
                                "Run",
                                operation_id,
                            )
                            .await?,
                    );
                }
                EditorOperation::PublishInternal => {
                    let request = PublishRequest {
                        operation_id: operation_id.expect("write operation allocated").to_owned(),
                        expected_revision: input
                            .expected_revision
                            .clone()
                            .expect("source required field"),
                        successful_test_run_id: input
                            .successful_test_run_id
                            .clone()
                            .expect("source required field"),
                    };
                    result.workflow = Some(
                        transport
                            .request(
                                &credentials,
                                Method::POST,
                                &workflow_path(&lease.workflow_id, "versions"),
                                Some(encode("PublishRequest", &request)?),
                                Some(&lease.secret),
                                200,
                                "Workflow",
                                operation_id,
                            )
                            .await?,
                    );
                }
                EditorOperation::ReadRun => {
                    let run_id = input.run_id.as_deref().expect("source required field");
                    result.run = Some(
                        transport
                            .request(
                                &credentials,
                                Method::GET,
                                &workflow_path(&lease.workflow_id, &format!("runs/{run_id}")),
                                None,
                                None,
                                200,
                                "Run",
                                None,
                            )
                            .await?,
                    );
                    if result.run.as_ref().is_some_and(|run| run.run_id != run_id) {
                        return Err(error(ErrorCode::ProtocolMismatch));
                    }
                }
                EditorOperation::ReadOperation => {
                    let id = input
                        .operation_id
                        .as_deref()
                        .expect("source required field");
                    let receipt = self.read_operation(&credentials, id).await?;
                    if receipt.workflow_id.as_deref() != Some(&lease.workflow_id) {
                        return Err(error(ErrorCode::ResourceNotFound));
                    }
                    result.receipt = Some(receipt);
                }
            }
            if result
                .workflow
                .as_ref()
                .is_some_and(|workflow| workflow.workflow_id != lease.workflow_id)
                || result
                    .run
                    .as_ref()
                    .is_some_and(|run| run.workflow_id != lease.workflow_id)
                || result
                    .run
                    .as_ref()
                    .is_some_and(|run| operation_id.is_some_and(|id| run.operation_id != id))
            {
                return Err(error(ErrorCode::ProtocolMismatch));
            }
            if let Some(run) = result
                .run
                .as_ref()
                .filter(|_| input.operation == EditorOperation::TestDraft)
            {
                if run.mode != RunMode::Debug || run.revision != input.expected_revision {
                    return Err(error(ErrorCode::ProtocolMismatch));
                }
            }
            validation::typed("EditorExchangeResult", &result)
                .map_err(|_| error(ErrorCode::ProtocolMismatch))?;
            Ok(())
        }
        .await;
        if !self.lease_still_current(&lease).await {
            return Err(with_operation(
                error(if operation_id.is_some() {
                    ErrorCode::OperationUnknown
                } else {
                    ErrorCode::SessionExpired
                }),
                operation_id,
            ));
        }
        result_inner.map_err(|failure| with_operation(failure, operation_id))?;
        Ok(result)
    }

    pub(super) async fn start_run(&self, input: RunInput) -> Result<Run, ErrorResponse> {
        input_valid("RunInput", &input)?;
        let credentials = self.ready().await?;
        let request = RunRequest {
            operation_id: uuid::Uuid::now_v7().to_string(),
            version: input.version,
            input: input.input,
        };
        let run: Run = self
            .transport()?
            .request(
                &credentials,
                Method::POST,
                &workflow_path(&input.workflow_id, "runs"),
                Some(encode("RunRequest", &request)?),
                None,
                202,
                "Run",
                Some(&request.operation_id),
            )
            .await?;
        if run.workflow_id != input.workflow_id
            || run.operation_id != request.operation_id
            || run.mode != RunMode::Release
            || run.version.as_deref() != Some(&request.version)
        {
            return Err(with_operation(
                error(ErrorCode::OperationUnknown),
                Some(&request.operation_id),
            ));
        }
        Ok(run)
    }

    async fn read_operation(
        &self,
        credentials: &Credentials,
        id: &str,
    ) -> Result<OperationReceipt, ErrorResponse> {
        let receipt: OperationReceipt = self
            .transport()?
            .request(
                credentials,
                Method::GET,
                &format!("/v1/workflow-local/operations/{id}"),
                None,
                None,
                200,
                "OperationReceipt",
                None,
            )
            .await
            .map_err(|mut failure| {
                if failure
                    .operation_id
                    .as_deref()
                    .is_some_and(|returned| returned != id)
                {
                    failure = error(ErrorCode::ProtocolMismatch);
                }
                failure.operation_id = Some(id.to_owned());
                failure
            })?;
        if receipt.operation_id != id {
            return Err(error(ErrorCode::ProtocolMismatch));
        }
        Ok(receipt)
    }

    pub(super) async fn query(
        &self,
        input: RunQueryInput,
    ) -> Result<RunQueryResult, ErrorResponse> {
        input_valid("RunQueryInput", &input)?;
        exact_operation_fields("RunQueryInput", &input)?;
        let credentials = self.ready().await?;
        let mut result = RunQueryResult {
            run: None,
            history: None,
            receipt: None,
        };
        match input.kind {
            RunQueryKind::Operation => {
                result.receipt = Some(
                    self.read_operation(
                        &credentials,
                        input
                            .operation_id
                            .as_deref()
                            .expect("source required field"),
                    )
                    .await?,
                );
            }
            RunQueryKind::Run => {
                let workflow_id = input.workflow_id.as_deref().expect("source required field");
                let run_id = input.run_id.as_deref().expect("source required field");
                let run: Run = self
                    .transport()?
                    .request(
                        &credentials,
                        Method::GET,
                        &workflow_path(workflow_id, &format!("runs/{run_id}")),
                        None,
                        None,
                        200,
                        "Run",
                        None,
                    )
                    .await?;
                if run.workflow_id != workflow_id || run.run_id != run_id {
                    return Err(error(ErrorCode::ProtocolMismatch));
                }
                result.run = Some(run);
            }
            RunQueryKind::History => {
                let workflow_id = input.workflow_id.as_deref().expect("source required field");
                let history: RunList = self
                    .transport()?
                    .request(
                        &credentials,
                        Method::GET,
                        &with_page(
                            &workflow_path(workflow_id, "runs"),
                            input.cursor.as_deref(),
                            input.limit,
                        ),
                        None,
                        None,
                        200,
                        "RunList",
                        None,
                    )
                    .await?;
                if history
                    .items
                    .iter()
                    .any(|run| run.workflow_id != workflow_id)
                {
                    return Err(error(ErrorCode::ProtocolMismatch));
                }
                result.history = Some(history);
            }
        }
        validation::typed("RunQueryResult", &result)
            .map_err(|_| error(ErrorCode::ProtocolMismatch))?;
        Ok(result)
    }

    async fn delete_session(
        &self,
        credentials: &Credentials,
        session_id: &str,
    ) -> Result<CloseResult, ErrorResponse> {
        self.transport()?
            .request(
                credentials,
                Method::DELETE,
                &format!("/v1/workflow-local/editor-sessions/{session_id}"),
                None,
                None,
                200,
                "CloseResult",
                None,
            )
            .await
    }

    async fn retire(
        &self,
        credentials: &Credentials,
        mut editor: EditorBinding,
    ) -> Result<CloseResult, ErrorResponse> {
        editor.secret = None;
        if editor.epoch != credentials.epoch {
            return Ok(CloseResult { closed: true });
        }
        let result = self.delete_session(credentials, &editor.session_id).await?;
        if !result.closed {
            return Err(error(ErrorCode::ProtocolMismatch));
        }
        if super::exact_local_enabled()
            && matches!(self.configuration.as_ref(), Configuration::Enabled { .. })
        {
            // Native-only qualification evidence, emitted after the authenticated
            // DELETE and its typed response succeed. Never serialize the binding:
            // its session ID and secret must not reach logs or either WebView.
            eprintln!(
                "YIJIE_WORKFLOW_LOCAL_DIAGNOSTIC {}",
                serde_json::json!({
                    "event": "remote_close_confirmed",
                    "app_pid": std::process::id(),
                    "workflow_id": editor.workflow_id,
                    "bridge_id": editor.bridge_id,
                    "generation": editor.generation,
                    "run_epoch": editor.epoch,
                    "remote_closed": true,
                })
            );
        }
        Ok(result)
    }

    pub(super) async fn close(
        &self,
        input: EditorCloseInput,
    ) -> Result<CloseResult, ErrorResponse> {
        input_valid("EditorCloseInput", &input)?;
        self.check_authority()?;
        let editor = {
            let mut state = self.state.lock().await;
            if state
                .editor
                .as_ref()
                .is_some_and(|editor| editor.bridge_id == input.bridge_id)
            {
                self.context_revision.fetch_add(1, Ordering::AcqRel);
                state.editor.take()
            } else {
                None
            }
        };
        match editor {
            None => Ok(CloseResult { closed: true }),
            Some(editor) => {
                // The local binding is already closed even if revocation cannot reach the service.
                // Return that failure honestly; never recreate the binding or keep its secret alive.
                let credentials = self.configuration.credentials()?;
                self.retire(&credentials, editor).await
            }
        }
    }

    pub(crate) async fn invalidate_local(&self) {
        let invalidated = self.context_revision.fetch_add(1, Ordering::AcqRel);
        self.revoke_invalidated(invalidated).await;
    }

    pub(crate) fn invalidate_from_window_event(&self) {
        let invalidated = self.context_revision.fetch_add(1, Ordering::AcqRel);
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            runtime.revoke_invalidated(invalidated).await;
        });
    }

    async fn revoke_invalidated(&self, invalidated: u64) {
        let editor = {
            let mut state = self.state.lock().await;
            if state
                .editor
                .as_ref()
                .is_some_and(|editor| editor.context_revision <= invalidated)
            {
                state.editor.take()
            } else {
                None
            }
        };
        if let (Some(editor), Ok(credentials)) = (editor, self.configuration.credentials()) {
            // Revoke normally after dropping the local binding; failure never restores it.
            let _ = self.retire(&credentials, editor).await;
        }
    }

    pub(crate) async fn shutdown_for_app_exit(&self) {
        self.context_revision.fetch_add(1, Ordering::AcqRel);
        let editor = {
            let mut state = self.state.lock().await;
            state.shutdown = true;
            state.editor.take()
        };
        if let (Some(editor), Ok(credentials)) = (editor, self.configuration.credentials()) {
            let _ = self.retire(&credentials, editor).await;
        }
    }
}

fn input_valid<T: Serialize>(name: &str, input: &T) -> Result<(), ErrorResponse> {
    validation::typed(name, input).map_err(|_| error(ErrorCode::InvalidRequest))
}

fn encode<T: Serialize>(name: &str, input: &T) -> Result<Vec<u8>, ErrorResponse> {
    input_valid(name, input)?;
    serde_json::to_vec(input).map_err(|_| error(ErrorCode::InvalidRequest))
}

fn with_operation(mut failure: ErrorResponse, operation_id: Option<&str>) -> ErrorResponse {
    if let Some(id) = operation_id {
        if matches!(
            failure.code,
            ErrorCode::ProtocolMismatch | ErrorCode::InternalError
        ) {
            failure = error(ErrorCode::OperationUnknown);
        }
        failure.operation_id = Some(id.to_owned());
    }
    failure
}

fn workflow_path(workflow_id: &str, suffix: &str) -> String {
    if suffix.is_empty() {
        format!("/v1/workflows/{workflow_id}")
    } else {
        format!("/v1/workflows/{workflow_id}/{suffix}")
    }
}

fn with_page(path: &str, cursor: Option<&str>, limit: Option<i64>) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("limit", &limit.unwrap_or(20).to_string());
    if let Some(cursor) = cursor {
        query.append_pair("cursor", cursor);
    }
    format!("{path}?{}", query.finish())
}

fn now_ms() -> Result<i64, ErrorResponse> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| error(ErrorCode::ServiceUnavailable))?
            .as_millis(),
    )
    .map_err(|_| error(ErrorCode::ServiceUnavailable))
}

fn editor_deadline(
    started: Instant,
    observed: Instant,
    server_expires_at_ms: i64,
    local_now_ms: i64,
) -> Result<Instant, ErrorResponse> {
    let remaining = server_expires_at_ms.saturating_sub(local_now_ms);
    if remaining <= 0 {
        return Err(error(ErrorCode::SessionExpired));
    }
    // Host/container wall clocks need not agree exactly. Never extend the local 300-second cap.
    let deadline = (observed + Duration::from_millis(remaining.min(EDITOR_TTL_MS) as u64))
        .min(started + Duration::from_millis(EDITOR_TTL_MS as u64));
    if deadline <= observed {
        return Err(error(ErrorCode::SessionExpired));
    }
    Ok(deadline)
}

fn exact_operation_fields<T: Serialize>(name: &str, input: &T) -> Result<(), ErrorResponse> {
    let value = serde_json::to_value(input).map_err(|_| error(ErrorCode::InvalidRequest))?;
    let schema = &validation::source()["$defs"][name];
    let discriminator = schema["x-operation-field"].as_str().unwrap_or("operation");
    let operation = value[discriminator]
        .as_str()
        .ok_or_else(|| error(ErrorCode::InvalidRequest))?;
    let required = schema["x-operation-required"][operation].as_array();
    let base = schema["required"].as_array();
    let optional = schema["x-operation-optional"][operation].as_array();
    for key in value
        .as_object()
        .ok_or_else(|| error(ErrorCode::InvalidRequest))?
        .keys()
    {
        let allowed = [base, required, optional]
            .into_iter()
            .flatten()
            .any(|fields| fields.iter().any(|field| field.as_str() == Some(key)));
        if !allowed {
            return Err(error(ErrorCode::InvalidRequest));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
