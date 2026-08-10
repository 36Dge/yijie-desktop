//! Compile-time gated FEAT-126 S10BO2 Desktop driver.
//!
//! The module is compiled only into the non-publishable feature binary. Rust
//! owns the synthetic identity, tenant, project path, native bookmark and
//! inherited control descriptors. The WebView receives only opaque local IDs
//! and fixed content-free lifecycle projections.

use crate::chat::{ChatIpcRuntime, ChatRuntime};
use crate::feat126_secure_storage::Feat126SecureStorageProfile;
use crate::native_auth::{AuthStatus, NativeAuthRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Manager, State};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

const MASTER_ENV: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
const DRIVER_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_ENABLED";
const EPHEMERAL_ENV: &str = "YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED";
const REAL_CHAIN_ENV: &str = "YIJIE_FEAT126_S10P3_REAL_MAIN_CHAIN";
const RUN_ENV: &str = "YIJIE_FEAT126_S10_RUN_ID";
const NONCE_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_NONCE";
const SECRET_PATH_ENV: &str = "YIJIE_FEAT126_S10_INFRA_SECRETS_PATH";
const LOCAL_ENABLED_ENV: &str = "YIJIE_CHAT_LOCAL_ENABLED";
const OWNER_ENV: &str = "YIJIE_CHAT_LOCAL_OWNER_USER_ID";
const TENANT_ENV: &str = "YIJIE_CHAT_LOCAL_TENANT_ID";
const LOCAL_ENV: &str = "YIJIE_ENV";
const FIXED_OWNER: &str = "12500000-0000-4000-8000-000000000001";
const FIXED_TENANT: &str = "12500000-0000-4000-8000-100000000001";
const CONTROL_READ_FD: i32 = 3;
const CONTROL_WRITE_FD: i32 = 4;
const MAX_FRAME_BYTES: usize = 1024;
const STARTUP_FAILURE_CLASSES: &[&str] = &[
    "driver_app_data_invalid",
    "driver_authority_invalid",
    "driver_bind_failed",
    "driver_control_channel_invalid",
    "driver_control_monitor_invalid",
    "driver_control_projection_invalid",
    "driver_frontend_startup_invalid",
    "driver_login_failed",
    "driver_login_projection_invalid",
    "driver_nonce_invalid",
    "driver_profile_invalid",
    "driver_project_invalid",
    "driver_project_projection_invalid",
    "driver_project_revalidation_failed",
    "driver_readiness_failed",
    "driver_ready_emit_failed",
    "driver_run_id_invalid",
    "driver_secret_authority_invalid",
    "driver_tauri_startup_invalid",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DriverPhase {
    Created,
    Authenticated,
    ProjectRegistered,
    Bound,
    Ready,
    Aborting,
    Closed,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ControlOutcome {
    Pending,
    Abort,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartupTerminal {
    Pending,
    Ready,
    Failed,
}

struct DriverState {
    phase: DriverPhase,
    project_id: Option<String>,
    context_id: Option<String>,
    project_revalidated: bool,
    recovery_requested: bool,
}

struct DriverInner {
    run_id: String,
    nonce: String,
    state: Mutex<DriverState>,
    inbound: StdMutex<Option<File>>,
    outbound: StdMutex<File>,
    outcome: watch::Sender<ControlOutcome>,
    monitor_started: AtomicBool,
    startup_terminal: StdMutex<StartupTerminal>,
}

#[derive(Clone)]
pub(crate) struct Feat126S10DriverRuntime {
    inner: Arc<DriverInner>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ControlFrame {
    schema_version: u8,
    run_id: String,
    nonce: String,
    sequence: u64,
    kind: String,
}

#[derive(Serialize)]
struct OutboundFrame<'a> {
    schema_version: u8,
    run_id: &'a str,
    nonce: &'a str,
    sequence: u64,
    kind: &'static str,
}

#[derive(Serialize)]
struct StartupFailureFrame<'a> {
    schema_version: u8,
    run_id: &'a str,
    nonce: &'a str,
    sequence: u64,
    kind: &'static str,
    failure_class: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverLoginProjection {
    schema_version: u8,
    status: &'static str,
    flow: &'static str,
    pkce_method: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverProjectProjection {
    schema_version: u8,
    project_id: String,
    capability: &'static str,
}

#[derive(Serialize)]
pub(crate) struct DriverControlProjection {
    kind: &'static str,
}

impl Feat126S10DriverRuntime {
    pub(crate) fn from_environment(
        profile: Option<Arc<Feat126SecureStorageProfile>>,
    ) -> Result<Self, &'static str> {
        if std::env::var(MASTER_ENV).as_deref() != Ok("true")
            || std::env::var(DRIVER_ENV).as_deref() != Ok("true")
            || std::env::var(EPHEMERAL_ENV).as_deref() != Ok("true")
            || std::env::var(REAL_CHAIN_ENV).as_deref() != Ok("true")
            || std::env::var(LOCAL_ENABLED_ENV).as_deref() != Ok("true")
            || std::env::var(LOCAL_ENV).as_deref() != Ok("local")
            || std::env::var(OWNER_ENV).as_deref() != Ok(FIXED_OWNER)
            || std::env::var(TENANT_ENV).as_deref() != Ok(FIXED_TENANT)
        {
            return Err("driver_authority_invalid");
        }
        let profile = profile.ok_or("driver_profile_invalid")?;
        if !profile.uses_ephemeral_backend() {
            return Err("driver_profile_invalid");
        }
        let run_id = std::env::var(RUN_ENV).map_err(|_| "driver_run_id_invalid")?;
        validate_uuid_v4(&run_id).map_err(|_| "driver_run_id_invalid")?;
        if profile.run_id() != run_id || profile.validate_fixed_project().is_err() {
            return Err("driver_profile_invalid");
        }
        let nonce = std::env::var(NONCE_ENV).map_err(|_| "driver_nonce_invalid")?;
        validate_uuid_v4(&nonce).map_err(|_| "driver_nonce_invalid")?;
        let secrets = std::env::var(SECRET_PATH_ENV)
            .map(PathBuf::from)
            .map_err(|_| "driver_secret_authority_invalid")?;
        if secrets != profile.expected_infra_secrets_path() {
            return Err("driver_secret_authority_invalid");
        }
        let inbound = inherited_control_fd(CONTROL_READ_FD)?;
        let outbound = inherited_control_fd(CONTROL_WRITE_FD)?;
        let (outcome, _) = watch::channel(ControlOutcome::Pending);
        Ok(Self {
            inner: Arc::new(DriverInner {
                run_id,
                nonce,
                state: Mutex::new(DriverState {
                    phase: DriverPhase::Created,
                    project_id: None,
                    context_id: None,
                    project_revalidated: false,
                    recovery_requested: false,
                }),
                inbound: StdMutex::new(Some(inbound)),
                outbound: StdMutex::new(outbound),
                outcome,
                monitor_started: AtomicBool::new(false),
                startup_terminal: StdMutex::new(StartupTerminal::Pending),
            }),
        })
    }

    pub(crate) fn start_control_monitor(&self, app: AppHandle) -> Result<(), &'static str> {
        if self.inner.monitor_started.swap(true, Ordering::SeqCst) {
            return Err("driver_control_monitor_invalid");
        }
        let inbound = self
            .inner
            .inbound
            .lock()
            .map_err(|_| "driver_control_channel_invalid")?
            .take()
            .ok_or("driver_control_channel_invalid")?;
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let read_runtime = runtime.clone();
            let frame = tokio::task::spawn_blocking(move || {
                read_control_frame(
                    inbound,
                    &read_runtime.inner.run_id,
                    &read_runtime.inner.nonce,
                )
            })
            .await
            .ok()
            .and_then(Result::ok);
            let valid_abort = frame.is_some() && runtime.begin_abort().await.is_ok();
            let stopped = app
                .state::<ChatRuntime>()
                .feat126_s10_stop_owned_host()
                .await
                .is_ok();
            if valid_abort && stopped {
                runtime.inner.outcome.send_replace(ControlOutcome::Abort);
            } else {
                runtime.emit_startup_failure("driver_control_monitor_invalid");
                runtime.fail().await;
                app.exit(1);
            }
        });
        Ok(())
    }

    pub(crate) fn emit_startup_failure(&self, failure_class: &str) {
        if !STARTUP_FAILURE_CLASSES.contains(&failure_class) {
            return;
        }
        let Ok(mut terminal) = self.inner.startup_terminal.lock() else {
            return;
        };
        if *terminal != StartupTerminal::Pending {
            return;
        }
        *terminal = StartupTerminal::Failed;
        let _ = self.write_startup_failure(failure_class);
    }

    async fn require_phase(&self, expected: DriverPhase) -> Result<(), &'static str> {
        let state = self.inner.state.lock().await;
        if state.phase == expected {
            Ok(())
        } else {
            Err("driver_state_invalid")
        }
    }

    async fn transition(
        &self,
        expected: DriverPhase,
        next: DriverPhase,
    ) -> Result<(), &'static str> {
        let mut state = self.inner.state.lock().await;
        if state.phase != expected {
            return Err("driver_state_invalid");
        }
        state.phase = next;
        Ok(())
    }

    async fn set_project(&self, project_id: String) -> Result<(), &'static str> {
        validate_uuid(&project_id).map_err(|_| "driver_project_invalid")?;
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Authenticated || state.project_id.is_some() {
            return Err("driver_state_invalid");
        }
        state.project_id = Some(project_id);
        state.phase = DriverPhase::ProjectRegistered;
        Ok(())
    }

    async fn project_id(&self, expected: DriverPhase) -> Result<String, &'static str> {
        let state = self.inner.state.lock().await;
        if state.phase != expected {
            return Err("driver_state_invalid");
        }
        state.project_id.clone().ok_or("driver_project_invalid")
    }

    async fn bind_context(&self, response: &Value) -> Result<(), &'static str> {
        let context_id = response
            .as_object()
            .and_then(|envelope| envelope.get("data"))
            .and_then(Value::as_object)
            .and_then(|data| data.get("contextId"))
            .and_then(Value::as_str)
            .ok_or("driver_bind_failed")?;
        validate_uuid(context_id).map_err(|_| "driver_bind_failed")?;
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::ProjectRegistered || state.context_id.is_some() {
            return Err("driver_state_invalid");
        }
        state.context_id = Some(context_id.to_owned());
        state.phase = DriverPhase::Bound;
        Ok(())
    }

    async fn validate_bound_request(&self, request: &Value) -> Result<Uuid, &'static str> {
        let (request_id, context_id, _) = decode_driver_request(request)?;
        let context_id = context_id.hyphenated().to_string();
        let state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Bound
            || state.context_id.as_deref() != Some(context_id.as_str())
        {
            return Err("driver_context_invalid");
        }
        Ok(request_id)
    }

    async fn validate_project_request(&self, request: &Value) -> Result<(), &'static str> {
        let (_, _, payload) = decode_driver_request(request)?;
        if payload.len() != 2
            || payload.get("operationId").and_then(Value::as_str).is_none()
            || payload.get("projectId").and_then(Value::as_str).is_none()
        {
            return Err("driver_project_invalid");
        }
        let project_id = payload["projectId"]
            .as_str()
            .ok_or("driver_project_invalid")?;
        validate_uuid(project_id).map_err(|_| "driver_project_invalid")?;
        let state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Bound
            || state.project_id.as_deref() != Some(project_id)
            || state.project_revalidated
        {
            return Err("driver_project_invalid");
        }
        Ok(())
    }

    async fn mark_project_revalidated(&self) -> Result<(), &'static str> {
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Bound || state.project_revalidated {
            return Err("driver_state_invalid");
        }
        state.project_revalidated = true;
        Ok(())
    }

    async fn begin_recovery(&self, request: &Value) -> Result<(), &'static str> {
        let (_, _, payload) = decode_driver_request(request)?;
        if payload.len() != 2
            || payload.get("intent").and_then(Value::as_str) != Some("start_or_retry")
            || payload.get("operationId").and_then(Value::as_str).is_none()
        {
            return Err("driver_recovery_invalid");
        }
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Bound
            || !state.project_revalidated
            || state.recovery_requested
        {
            return Err("driver_recovery_invalid");
        }
        state.recovery_requested = true;
        Ok(())
    }

    async fn emit_ready(&self) -> Result<(), &'static str> {
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Bound
            || state.project_id.is_none()
            || !state.project_revalidated
            || !state.recovery_requested
            || *self.inner.outcome.borrow() != ControlOutcome::Pending
        {
            return Err("driver_state_invalid");
        }
        let mut terminal = self
            .inner
            .startup_terminal
            .lock()
            .map_err(|_| "driver_state_invalid")?;
        if *terminal != StartupTerminal::Pending {
            return Err("driver_state_invalid");
        }
        self.write_frame(1, "component_ready")?;
        state.phase = DriverPhase::Ready;
        *terminal = StartupTerminal::Ready;
        Ok(())
    }

    async fn begin_abort(&self) -> Result<(), &'static str> {
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Ready {
            return Err("driver_control_order_invalid");
        }
        state.phase = DriverPhase::Aborting;
        Ok(())
    }

    async fn wait_for_abort(&self) -> Result<(), &'static str> {
        {
            let state = self.inner.state.lock().await;
            if !matches!(state.phase, DriverPhase::Ready | DriverPhase::Aborting) {
                return Err("driver_state_invalid");
            }
        }
        let mut outcome = self.inner.outcome.subscribe();
        loop {
            match *outcome.borrow_and_update() {
                ControlOutcome::Abort => return Ok(()),
                ControlOutcome::Failed => return Err("driver_control_failed"),
                ControlOutcome::Pending => {}
            }
            outcome
                .changed()
                .await
                .map_err(|_| "driver_control_failed")?;
        }
    }

    async fn emit_abort_complete(&self) -> Result<(), &'static str> {
        let mut state = self.inner.state.lock().await;
        if state.phase != DriverPhase::Aborting
            || *self.inner.outcome.borrow() != ControlOutcome::Abort
        {
            return Err("driver_state_invalid");
        }
        self.write_frame(2, "abort_complete")?;
        state.phase = DriverPhase::Closed;
        Ok(())
    }

    async fn fail(&self) {
        let mut state = self.inner.state.lock().await;
        state.phase = DriverPhase::Failed;
        self.inner.outcome.send_replace(ControlOutcome::Failed);
    }

    fn write_frame(&self, sequence: u64, kind: &'static str) -> Result<(), &'static str> {
        let mut encoded = serde_json::to_vec(&OutboundFrame {
            schema_version: 1,
            run_id: &self.inner.run_id,
            nonce: &self.inner.nonce,
            sequence,
            kind,
        })
        .map_err(|_| "driver_control_write_failed")?;
        encoded.push(b'\n');
        if encoded.len() > MAX_FRAME_BYTES {
            return Err("driver_control_write_failed");
        }
        let mut outbound = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed")
    }

    fn write_startup_failure(&self, failure_class: &str) -> Result<(), &'static str> {
        let encoded =
            encode_startup_failure_frame(&self.inner.run_id, &self.inner.nonce, failure_class)?;
        let mut outbound = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed")
    }
}

fn encode_startup_failure_frame(
    run_id: &str,
    nonce: &str,
    failure_class: &str,
) -> Result<Vec<u8>, &'static str> {
    validate_uuid_v4(run_id).map_err(|_| "driver_control_write_failed")?;
    validate_uuid_v4(nonce).map_err(|_| "driver_control_write_failed")?;
    if !STARTUP_FAILURE_CLASSES.contains(&failure_class) {
        return Err("driver_control_write_failed");
    }
    let mut encoded = serde_json::to_vec(&StartupFailureFrame {
        schema_version: 1,
        run_id,
        nonce,
        sequence: 1,
        kind: "startup_failed",
        failure_class,
    })
    .map_err(|_| "driver_control_write_failed")?;
    encoded.push(b'\n');
    if encoded.len() > MAX_FRAME_BYTES {
        return Err("driver_control_write_failed");
    }
    Ok(encoded)
}

pub(crate) fn emit_startup_failure_from_environment(failure_class: &str) {
    let Ok(run_id) = std::env::var(RUN_ENV) else {
        return;
    };
    let Ok(nonce) = std::env::var(NONCE_ENV) else {
        return;
    };
    let Ok(mut outbound) = inherited_control_fd(CONTROL_WRITE_FD) else {
        return;
    };
    let Ok(encoded) = encode_startup_failure_frame(&run_id, &nonce, failure_class) else {
        return;
    };
    let _ = outbound.write_all(&encoded).and_then(|_| outbound.flush());
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_login(
    driver: State<'_, Feat126S10DriverRuntime>,
    auth: State<'_, NativeAuthRuntime>,
) -> Result<DriverLoginProjection, String> {
    driver
        .require_phase(DriverPhase::Created)
        .await
        .map_err(str::to_owned)?;
    if auth
        .feat126_s10_driver_login()
        .await
        .map_err(|_| "driver_login_failed".to_owned())?
        != AuthStatus::SignedIn
    {
        return Err("driver_login_failed".to_owned());
    }
    driver
        .transition(DriverPhase::Created, DriverPhase::Authenticated)
        .await
        .map_err(str::to_owned)?;
    Ok(DriverLoginProjection {
        schema_version: 1,
        status: "signed_in",
        flow: "authorization_code",
        pkce_method: "S256",
    })
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_register_project(
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<DriverProjectProjection, String> {
    driver
        .require_phase(DriverPhase::Authenticated)
        .await
        .map_err(str::to_owned)?;
    let project = chat
        .feat126_s10_register_project()
        .await
        .map_err(|_| "driver_project_failed".to_owned())?;
    driver
        .set_project(project.id.clone())
        .await
        .map_err(str::to_owned)?;
    Ok(DriverProjectProjection {
        schema_version: 1,
        project_id: project.id,
        capability: "local_only",
    })
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_bind(
    app: AppHandle,
    driver: State<'_, Feat126S10DriverRuntime>,
    auth: State<'_, NativeAuthRuntime>,
    chat: State<'_, ChatRuntime>,
    ipc: State<'_, ChatIpcRuntime>,
) -> Result<Value, String> {
    driver
        .require_phase(DriverPhase::ProjectRegistered)
        .await
        .map_err(str::to_owned)?;
    let request_id = Uuid::now_v7();
    let request = json!({
        "schemaVersion": 1,
        "requestId": request_id,
        "payload": { "tenantSelector": FIXED_TENANT },
    });
    let response = crate::chat::ipc::chat_bind_context_v1(request, app, auth, chat, ipc)
        .await
        .map_err(|_| "driver_bind_failed".to_owned())?;
    let response = serde_json::to_value(response).map_err(|_| "driver_bind_failed".to_owned())?;
    driver
        .bind_context(&response)
        .await
        .map_err(str::to_owned)?;
    Ok(response)
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_list_projects(
    request: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
    ipc: State<'_, ChatIpcRuntime>,
) -> Result<Value, String> {
    driver
        .validate_bound_request(&request)
        .await
        .map_err(str::to_owned)?;
    let (_, _, payload) = decode_driver_request(&request).map_err(str::to_owned)?;
    if !payload.is_empty() {
        return Err("driver_request_invalid".to_owned());
    }
    let response = crate::chat::ipc::chat_list_projects_v1(request, chat, ipc)
        .await
        .map_err(|_| "driver_project_failed".to_owned())?;
    serde_json::to_value(response).map_err(|_| "driver_project_failed".to_owned())
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_list_sessions(
    request: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
) -> Result<Value, String> {
    let request_id = driver
        .validate_bound_request(&request)
        .await
        .map_err(str::to_owned)?;
    let (_, _, payload) = decode_driver_request(&request).map_err(str::to_owned)?;
    if payload
        .keys()
        .any(|key| !matches!(key.as_str(), "cursor" | "limit"))
    {
        return Err("driver_request_invalid".to_owned());
    }
    Ok(json!({
        "schemaVersion": 1,
        "requestId": request_id,
        "data": { "sessions": [], "nextCursor": null },
    }))
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_get_local_readiness(
    request: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Value, String> {
    driver
        .validate_bound_request(&request)
        .await
        .map_err(str::to_owned)?;
    let (_, _, payload) = decode_driver_request(&request).map_err(str::to_owned)?;
    if !payload.is_empty() {
        return Err("driver_request_invalid".to_owned());
    }
    let response = crate::chat::ipc::chat_get_local_readiness_v1(request, chat)
        .await
        .map_err(|_| "driver_readiness_failed".to_owned())?;
    serde_json::to_value(response).map_err(|_| "driver_readiness_failed".to_owned())
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_revalidate_project(
    request: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Value, String> {
    driver
        .validate_bound_request(&request)
        .await
        .map_err(str::to_owned)?;
    driver
        .validate_project_request(&request)
        .await
        .map_err(str::to_owned)?;
    let response = crate::chat::ipc::chat_revalidate_project_v1(request, chat)
        .await
        .map_err(|_| "driver_project_revalidation_failed".to_owned())?;
    driver
        .mark_project_revalidated()
        .await
        .map_err(str::to_owned)?;
    serde_json::to_value(response).map_err(|_| "driver_project_revalidation_failed".to_owned())
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_request_local_recovery(
    request: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Value, String> {
    driver
        .validate_bound_request(&request)
        .await
        .map_err(str::to_owned)?;
    driver
        .begin_recovery(&request)
        .await
        .map_err(str::to_owned)?;
    let response = crate::chat::ipc::chat_request_local_recovery_v1(request, chat)
        .await
        .map_err(|_| "driver_recovery_failed".to_owned())?;
    serde_json::to_value(response).map_err(|_| "driver_recovery_failed".to_owned())
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_component_ready(
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<(), String> {
    let project_id = driver
        .project_id(DriverPhase::Bound)
        .await
        .map_err(str::to_owned)?;
    chat.feat126_s10_verify_project_and_readiness(&project_id)
        .await
        .map_err(|_| "driver_readiness_failed".to_owned())?;
    driver.emit_ready().await.map_err(str::to_owned)
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_wait_abort(
    driver: State<'_, Feat126S10DriverRuntime>,
) -> Result<DriverControlProjection, String> {
    driver.wait_for_abort().await.map_err(str::to_owned)?;
    Ok(DriverControlProjection { kind: "abort" })
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_abort_complete(
    app: AppHandle,
    driver: State<'_, Feat126S10DriverRuntime>,
    auth: State<'_, NativeAuthRuntime>,
    chat: State<'_, ChatRuntime>,
    ipc: State<'_, ChatIpcRuntime>,
) -> Result<(), String> {
    auth.logout()
        .await
        .map_err(|_| "driver_auth_cleanup_failed".to_owned())?;
    if let Ok(manager) = chat.authorization_manager() {
        let _ = manager.invalidate_all();
    }
    ipc.invalidate_pending_bindings();
    ipc.invalidate_all();
    driver.emit_abort_complete().await.map_err(str::to_owned)?;
    tauri::async_runtime::spawn(async move {
        tokio::task::yield_now().await;
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_fail_closed(
    app: AppHandle,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
    failure_class: String,
) -> Result<(), String> {
    let failure_class = if STARTUP_FAILURE_CLASSES.contains(&failure_class.as_str()) {
        failure_class.as_str()
    } else {
        "driver_frontend_startup_invalid"
    };
    driver.emit_startup_failure(failure_class);
    driver.fail().await;
    let result = chat
        .feat126_s10_stop_owned_host()
        .await
        .map_err(|_| "driver_abort_failed".to_owned());
    app.exit(1);
    result
}

fn validate_uuid(value: &str) -> Result<Uuid, ()> {
    let parsed = Uuid::parse_str(value).map_err(|_| ())?;
    if parsed.is_nil() || parsed.hyphenated().to_string() != value {
        return Err(());
    }
    Ok(parsed)
}

fn decode_driver_request(
    value: &Value,
) -> Result<(Uuid, Uuid, &serde_json::Map<String, Value>), &'static str> {
    let request = value.as_object().ok_or("driver_request_invalid")?;
    if request.len() != 4
        || request.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !request.contains_key("requestId")
        || !request.contains_key("contextId")
        || !request.contains_key("payload")
    {
        return Err("driver_request_invalid");
    }
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or("driver_request_invalid")?;
    let context_id = request
        .get("contextId")
        .and_then(Value::as_str)
        .ok_or("driver_request_invalid")?;
    let payload = request
        .get("payload")
        .and_then(Value::as_object)
        .ok_or("driver_request_invalid")?;
    Ok((
        validate_uuid(request_id).map_err(|_| "driver_request_invalid")?,
        validate_uuid(context_id).map_err(|_| "driver_request_invalid")?,
        payload,
    ))
}

fn validate_uuid_v4(value: &str) -> Result<Uuid, ()> {
    let parsed = validate_uuid(value)?;
    if parsed.get_version_num() != 4 {
        return Err(());
    }
    Ok(parsed)
}

fn inherited_control_fd(fd: i32) -> Result<File, &'static str> {
    let descriptor_flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if descriptor_flags < 0 {
        return Err("driver_control_channel_invalid");
    }
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(fd, metadata.as_mut_ptr()) } != 0 {
        return Err("driver_control_channel_invalid");
    }
    let metadata = unsafe { metadata.assume_init() };
    let file_type = metadata.st_mode & libc::S_IFMT;
    if file_type != libc::S_IFIFO && file_type != libc::S_IFSOCK {
        return Err("driver_control_channel_invalid");
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFD, descriptor_flags | libc::FD_CLOEXEC) } != 0 {
        return Err("driver_control_channel_invalid");
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn read_control_frame(
    mut reader: impl Read,
    run_id: &str,
    nonce: &str,
) -> Result<ControlFrame, &'static str> {
    let mut encoded = Vec::with_capacity(256);
    reader
        .by_ref()
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut encoded)
        .map_err(|_| "driver_control_read_failed")?;
    if encoded.is_empty() {
        return Err("driver_control_eof");
    }
    if encoded.len() > MAX_FRAME_BYTES {
        return Err("driver_control_frame_invalid");
    }
    decode_control_frame(&encoded, run_id, nonce)
}

fn decode_control_frame(
    encoded: &[u8],
    run_id: &str,
    nonce: &str,
) -> Result<ControlFrame, &'static str> {
    if encoded.is_empty()
        || encoded.len() > MAX_FRAME_BYTES
        || encoded.last() != Some(&b'\n')
        || encoded[..encoded.len() - 1]
            .iter()
            .any(|byte| matches!(byte, b'\n' | b'\r'))
        || std::str::from_utf8(encoded).is_err()
    {
        return Err("driver_control_frame_invalid");
    }
    let frame: ControlFrame = serde_json::from_slice(&encoded[..encoded.len() - 1])
        .map_err(|_| "driver_control_frame_invalid")?;
    if frame.schema_version != 1
        || frame.run_id != run_id
        || frame.nonce != nonce
        || frame.sequence != 1
        || frame.kind != "abort"
    {
        return Err("driver_control_frame_invalid");
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::io::Cursor;
    use std::os::unix::fs::OpenOptionsExt;

    const RUN_ID: &str = "019fbd88-cbc3-4bf1-934d-7b05cd693f80";
    const NONCE: &str = "019fbd88-cbc3-4bf1-934d-7b05cd693f81";

    fn frame() -> String {
        format!(
            "{{\"schema_version\":1,\"run_id\":\"{RUN_ID}\",\"nonce\":\"{NONCE}\",\"sequence\":1,\"kind\":\"abort\"}}\n"
        )
    }

    fn runtime_with_output() -> (Feat126S10DriverRuntime, PathBuf) {
        let path = std::env::temp_dir().join(format!("yijie-s10bo2-control-{}", Uuid::now_v7()));
        let outbound = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        let inbound = File::open("/dev/null").unwrap();
        let (outcome, _) = watch::channel(ControlOutcome::Pending);
        (
            Feat126S10DriverRuntime {
                inner: Arc::new(DriverInner {
                    run_id: RUN_ID.to_owned(),
                    nonce: NONCE.to_owned(),
                    state: Mutex::new(DriverState {
                        phase: DriverPhase::Created,
                        project_id: None,
                        context_id: None,
                        project_revalidated: false,
                        recovery_requested: false,
                    }),
                    inbound: StdMutex::new(Some(inbound)),
                    outbound: StdMutex::new(outbound),
                    outcome,
                    monitor_started: AtomicBool::new(false),
                    startup_terminal: StdMutex::new(StartupTerminal::Pending),
                }),
            },
            path,
        )
    }

    async fn prepare_runtime_for_ready(runtime: &Feat126S10DriverRuntime) {
        runtime
            .transition(DriverPhase::Created, DriverPhase::Authenticated)
            .await
            .unwrap();
        runtime
            .set_project("019fbd88-cbc3-7bf1-934d-7b05cd693f99".to_owned())
            .await
            .unwrap();
        runtime
            .transition(DriverPhase::ProjectRegistered, DriverPhase::Bound)
            .await
            .unwrap();
        let mut state = runtime.inner.state.lock().await;
        state.project_revalidated = true;
        state.recovery_requested = true;
    }

    #[test]
    fn accepts_only_the_exact_abort_frame() {
        assert_eq!(
            decode_control_frame(frame().as_bytes(), RUN_ID, NONCE)
                .unwrap()
                .kind,
            "abort"
        );
        for invalid in [
            frame().replace("\"sequence\":1", "\"sequence\":2"),
            frame().replace("\"kind\":\"abort\"", "\"kind\":\"retry\""),
            frame().replace("\"kind\":", "\"extra\":true,\"kind\":"),
            frame().replace(RUN_ID, "019fbd88-cbc3-4bf1-934d-7b05cd693f82"),
            frame().replace(NONCE, "019fbd88-cbc3-4bf1-934d-7b05cd693f82"),
        ] {
            assert!(decode_control_frame(invalid.as_bytes(), RUN_ID, NONCE).is_err());
        }
    }

    #[test]
    fn rejects_missing_lf_multiple_lines_invalid_utf8_and_oversize() {
        assert!(decode_control_frame(frame().trim_end().as_bytes(), RUN_ID, NONCE).is_err());
        assert!(
            decode_control_frame(format!("{}{}", frame(), frame()).as_bytes(), RUN_ID, NONCE,)
                .is_err()
        );
        assert!(decode_control_frame(&[0xff, b'\n'], RUN_ID, NONCE).is_err());
        assert!(decode_control_frame(&vec![b'x'; MAX_FRAME_BYTES + 1], RUN_ID, NONCE).is_err());
    }

    #[test]
    fn eof_and_truncation_fail_closed() {
        assert_eq!(
            read_control_frame(Cursor::new(Vec::<u8>::new()), RUN_ID, NONCE),
            Err("driver_control_eof")
        );
        assert_eq!(
            read_control_frame(Cursor::new(frame().trim_end().as_bytes()), RUN_ID, NONCE),
            Err("driver_control_frame_invalid")
        );
        assert_eq!(
            read_control_frame(
                Cursor::new(format!("{}{}", frame(), frame())),
                RUN_ID,
                NONCE,
            ),
            Err("driver_control_frame_invalid")
        );
    }

    #[test]
    fn startup_failure_frame_is_bounded_and_content_free() {
        let encoded =
            encode_startup_failure_frame(RUN_ID, NONCE, "driver_profile_invalid").unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(value["kind"], "startup_failed");
        assert_eq!(value["sequence"], 1);
        assert_eq!(value["failure_class"], "driver_profile_invalid");
        assert_eq!(value.as_object().unwrap().len(), 6);
        assert!(encoded.len() <= MAX_FRAME_BYTES);
        assert!(encode_startup_failure_frame(RUN_ID, NONCE, "driver_bind_failed").is_ok());
        assert!(encode_startup_failure_frame(RUN_ID, NONCE, "driver_control_eof").is_err());
    }

    #[test]
    fn startup_failure_is_one_shot_and_preserves_the_first_closed_leaf() {
        let (runtime, output) = runtime_with_output();
        runtime.emit_startup_failure("driver_control_monitor_invalid");
        runtime.emit_startup_failure("driver_profile_invalid");

        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        let failure: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        assert_eq!(failure["kind"], "startup_failed");
        assert_eq!(failure["failure_class"], "driver_control_monitor_invalid");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[tokio::test]
    async fn startup_failure_first_rejects_a_later_ready_terminal() {
        let (runtime, output) = runtime_with_output();
        prepare_runtime_for_ready(&runtime).await;
        runtime.emit_startup_failure("driver_control_monitor_invalid");

        assert_eq!(runtime.emit_ready().await, Err("driver_state_invalid"));
        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        let failure: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        assert_eq!(failure["kind"], "startup_failed");
        assert_eq!(failure["failure_class"], "driver_control_monitor_invalid");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[tokio::test]
    async fn ready_first_suppresses_a_later_startup_failure() {
        let (runtime, output) = runtime_with_output();
        prepare_runtime_for_ready(&runtime).await;
        runtime.emit_ready().await.unwrap();
        runtime.emit_startup_failure("driver_frontend_startup_invalid");

        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        let ready: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        assert_eq!(ready["kind"], "component_ready");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_ready_and_failure_emit_exactly_one_startup_terminal() {
        let (runtime, output) = runtime_with_output();
        prepare_runtime_for_ready(&runtime).await;
        let barrier = Arc::new(tokio::sync::Barrier::new(3));

        let ready_runtime = runtime.clone();
        let ready_barrier = barrier.clone();
        let ready = tokio::spawn(async move {
            ready_barrier.wait().await;
            ready_runtime.emit_ready().await
        });
        let failure_runtime = runtime.clone();
        let failure_barrier = barrier.clone();
        let failure = tokio::spawn(async move {
            failure_barrier.wait().await;
            failure_runtime.emit_startup_failure("driver_control_monitor_invalid");
        });
        barrier.wait().await;
        let (ready_result, failure_result) = tokio::join!(ready, failure);
        let ready_result = ready_result.unwrap();
        failure_result.unwrap();

        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        let terminal: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        match terminal["kind"].as_str().unwrap() {
            "component_ready" => assert_eq!(ready_result, Ok(())),
            "startup_failed" => {
                assert_eq!(ready_result, Err("driver_state_invalid"));
                assert_eq!(terminal["failure_class"], "driver_control_monitor_invalid");
            }
            kind => panic!("unexpected startup terminal: {kind}"),
        }
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn canonical_authority_requires_uuid_v4() {
        assert!(validate_uuid_v4(RUN_ID).is_ok());
        assert!(validate_uuid_v4("019fbd88-cbc3-7bf1-934d-7b05cd693f80").is_err());
        assert!(validate_uuid_v4("019FBD88-CBC3-4BF1-934D-7B05CD693F80").is_err());
    }

    #[test]
    fn abort_outcome_is_retained_before_waiter_subscribes() {
        let (outcome, initial) = watch::channel(ControlOutcome::Pending);
        drop(initial);
        outcome.send_replace(ControlOutcome::Abort);
        assert_eq!(*outcome.subscribe().borrow(), ControlOutcome::Abort);
    }

    #[tokio::test]
    async fn abort_before_ready_is_rejected_and_outbound_sequence_is_closed() {
        let (runtime, output) = runtime_with_output();
        assert_eq!(
            runtime.begin_abort().await,
            Err("driver_control_order_invalid")
        );
        prepare_runtime_for_ready(&runtime).await;
        runtime.emit_ready().await.unwrap();
        runtime.begin_abort().await.unwrap();
        runtime.inner.outcome.send_replace(ControlOutcome::Abort);
        runtime.emit_abort_complete().await.unwrap();
        runtime.emit_startup_failure("driver_frontend_startup_invalid");

        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 2);
        let ready: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        let complete: serde_json::Value = serde_json::from_str(frames[1]).unwrap();
        assert_eq!(ready["sequence"], 1);
        assert_eq!(ready["kind"], "component_ready");
        assert_eq!(complete["sequence"], 2);
        assert_eq!(complete["kind"], "abort_complete");
        assert!(runtime.emit_abort_complete().await.is_err());
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }
}
