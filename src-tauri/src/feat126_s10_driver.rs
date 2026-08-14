//! Compile-time gated FEAT-126 S10BO2 Desktop driver.
//!
//! The module is compiled only into the non-publishable feature binary. Rust
//! owns the synthetic identity, tenant, project path, native bookmark and
//! inherited control descriptors. The WebView receives only opaque local IDs
//! and fixed content-free lifecycle projections.

use crate::chat::{ChatIpcRuntime, ChatRuntime};
use crate::feat126_secure_storage::Feat126SecureStorageProfile;
#[cfg(test)]
use crate::native_auth::SyntheticLoginFailure;
use crate::native_auth::{AuthStatus, NativeAuthRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::FromRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Runtime, State};
use tokio::sync::{mpsc, watch, Mutex};
use uuid::Uuid;

const MASTER_ENV: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
const DRIVER_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_ENABLED";
const EPHEMERAL_ENV: &str = "YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED";
const REAL_CHAIN_ENV: &str = "YIJIE_FEAT126_S10P3_REAL_MAIN_CHAIN";
const RUN_ENV: &str = "YIJIE_FEAT126_S10_RUN_ID";
const NONCE_ENV: &str = "YIJIE_FEAT126_S10_DRIVER_NONCE";
const R8_ENV: &str = "YIJIE_FEAT126_S10_R8_ENABLED";
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
const STARTUP_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(50);
const STARTUP_SETUP_ENTERED: u8 = 1 << 0;
const STARTUP_APP_HANDLE_READY: u8 = 1 << 1;
const STARTUP_PAGE_LOAD_STARTED: u8 = 1 << 2;
const STARTUP_PAGE_LOAD_FINISHED: u8 = 1 << 3;
const STARTUP_FRONTEND_BOOTSTRAP: u8 = 1 << 4;
const STARTUP_FIRST_DRIVER_IPC: u8 = 1 << 5;
const STARTUP_READY_REQUIRED: u8 = STARTUP_SETUP_ENTERED
    | STARTUP_APP_HANDLE_READY
    | STARTUP_PAGE_LOAD_STARTED
    | STARTUP_FRONTEND_BOOTSTRAP
    | STARTUP_FIRST_DRIVER_IPC;
static SETUP_PANIC_HOOK_LOCK: StdMutex<()> = StdMutex::new(());
const STARTUP_FAILURE_CLASSES: &[&str] = &[
    "driver_app_data_invalid",
    "driver_authority_invalid",
    "driver_bind_failed",
    "driver_bind_context_denied",
    "driver_bind_context_invalid",
    "driver_bind_context_unauthenticated",
    "driver_bind_context_unavailable",
    "driver_bind_event_failed",
    "driver_bind_project_snapshot_failed",
    "driver_bind_readiness_snapshot_failed",
    "driver_bind_session_snapshot_failed",
    "driver_control_channel_invalid",
    "driver_control_monitor_invalid",
    "driver_control_projection_invalid",
    "driver_frontend_startup_invalid",
    "driver_frontend_bootstrap_timeout",
    "driver_frontend_ipc_timeout",
    "driver_login_failed",
    "driver_login_authorization_page_failed",
    "driver_login_authorization_request_invalid",
    "driver_login_authorization_start_failed",
    "driver_login_callback_rejected",
    "driver_login_concurrent",
    "driver_login_credential_submit_failed",
    "driver_login_credentials_rejected",
    "driver_login_form_invalid",
    "driver_login_projection_invalid",
    "driver_login_runtime_invalid",
    "driver_login_secret_invalid",
    "driver_login_session_failed",
    "driver_login_storage_failed",
    "driver_login_token_exchange_failed",
    "driver_nonce_invalid",
    "driver_profile_invalid",
    "driver_project_invalid",
    "driver_project_projection_invalid",
    "driver_project_revalidation_failed",
    "driver_readiness_failed",
    "driver_ready_emit_failed",
    "driver_run_id_invalid",
    "driver_secret_authority_invalid",
    "driver_setup_panic",
    "driver_setup_timeout",
    "driver_page_load_timeout",
    "driver_startup_timeout",
    "driver_tauri_startup_invalid",
];
const POST_READY_FAILURE_CLASSES: &[&str] = &[
    "driver_case_create_failed",
    "driver_case_failed",
    "driver_case_project_pin_failed",
    "driver_case_result_failed",
    "driver_case_session_pin_failed",
    "driver_case_session_rename_failed",
    "driver_control_projection_invalid",
    "driver_frontend_startup_invalid",
];
const R8_OBSERVATION_KEYS: &[(&str, &[&str])] = &[
    (
        "s10b_005_planned_restart",
        &[
            "history_page_20",
            "history_page_50",
            "restart_closed",
            "resync_same_session",
            "cursor_monotonic",
        ],
    ),
    (
        "s10b_006",
        &[
            "fallback_title",
            "user_rename_wins",
            "session_pin",
            "project_pin",
            "stable_sort",
        ],
    ),
    (
        "s10b_007",
        &[
            "gap_recovery",
            "reconnect",
            "race_closed",
            "no_late_commit",
            "cursor_resync",
        ],
    ),
    (
        "s10b_011",
        &[
            "metadata_p95_200ms",
            "history_p95_300ms",
            "reducer_10000",
            "db_1m_messages",
            "idempotency_10000",
        ],
    ),
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
    PlannedRestart,
    Abort,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ControlTerminal {
    PlannedRestart,
    Abort,
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
    outbound: StdMutex<Option<File>>,
    outcome: watch::Sender<ControlOutcome>,
    monitor_started: AtomicBool,
    startup_terminal: StdMutex<StartupTerminal>,
    post_ready_terminal: AtomicBool,
    startup_stages: AtomicU8,
    r8_enabled: bool,
    r8_case_index: AtomicU8,
    r8_case_offset: u8,
    r8_phase: &'static str,
    r8_commands: Mutex<mpsc::Receiver<String>>,
    r8_command_sender: mpsc::Sender<String>,
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
    #[serde(default)]
    case_id: Option<String>,
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
struct CaseResultFrame<'a> {
    schema_version: u8,
    run_id: &'a str,
    nonce: &'a str,
    sequence: u64,
    kind: &'static str,
    case_id: &'a str,
    status: &'static str,
    assertion_count: usize,
    assertion_set_sha256: &'a str,
}

const R8_ASSERTIONS: &[(&str, &[&str])] = &[
    (
        "s10b_002",
        &[
            "opaque_project",
            "single_session",
            "single_turn",
            "completed_terminal",
        ],
    ),
    (
        "s10b_003",
        &[
            "assistant_plaintext",
            "reasoning_complete",
            "reasoning_ordered",
            "terminal_exact",
        ],
    ),
    (
        "s10b_004",
        &[
            "interrupt_terminal",
            "incomplete_answer",
            "incomplete_reasoning",
            "terminal_once",
        ],
    ),
    (
        "s10b_005_planned_restart",
        &[
            "history_page_20",
            "history_page_50",
            "restart_closed",
            "resync_same_session",
            "cursor_monotonic",
        ],
    ),
    (
        "s10b_006",
        &[
            "fallback_title",
            "user_rename_wins",
            "session_pin",
            "project_pin",
            "stable_sort",
        ],
    ),
    (
        "s10b_007",
        &[
            "gap_recovery",
            "reconnect",
            "race_closed",
            "no_late_commit",
            "cursor_resync",
        ],
    ),
    (
        "s10b_008",
        &[
            "desktop_delete",
            "host_delete",
            "runtime_delete",
            "receipt_closed",
            "restart_unreadable",
        ],
    ),
    (
        "s10b_009",
        &[
            "public_task_content_free",
            "audit_content_free",
            "counts_bound",
            "path_absent",
            "title_absent",
        ],
    ),
    (
        "s10b_010",
        &[
            "log_content_free",
            "bbolt_content_free",
            "audit_content_free",
            "telemetry_content_free",
            "process_output_content_free",
        ],
    ),
    (
        "s10b_011",
        &[
            "metadata_p95_200ms",
            "history_p95_300ms",
            "reducer_10000",
            "db_1m_messages",
            "idempotency_10000",
        ],
    ),
];

fn r8_assertions(case_id: &str) -> Result<&'static [&'static str], &'static str> {
    R8_ASSERTIONS
        .iter()
        .find(|(id, _)| *id == case_id)
        .map(|(_, values)| *values)
        .ok_or("driver_case_result_invalid")
}

fn r8_assertion_digest(assertions: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for assertion in assertions {
        hasher.update(assertion.as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

const R8_CASES: &[&str] = &[
    "s10b_002",
    "s10b_003",
    "s10b_004",
    "s10b_005_planned_restart",
    "s10b_006",
    "s10b_007",
    "s10b_008",
    "s10b_009",
    "s10b_010",
    "s10b_011",
];

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
struct PostReadyFailureFrame<'a> {
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
        let r8_enabled = std::env::var(R8_ENV).as_deref() == Ok("true");
        let (r8_phase, r8_case_offset) = if r8_enabled {
            match std::env::var("YIJIE_FEAT126_S10_R8_PHASE").as_deref() {
                Ok("before_restart") => ("before_restart", 0),
                Ok("after_restart") => ("after_restart", 3),
                _ => return Err("driver_authority_invalid"),
            }
        } else {
            ("disabled", 0)
        };
        let (r8_command_sender, r8_commands) = mpsc::channel(1);
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
                outbound: StdMutex::new(Some(outbound)),
                outcome,
                monitor_started: AtomicBool::new(false),
                startup_terminal: StdMutex::new(StartupTerminal::Pending),
                post_ready_terminal: AtomicBool::new(false),
                startup_stages: AtomicU8::new(0),
                r8_enabled,
                r8_case_index: AtomicU8::new(0),
                r8_case_offset,
                r8_phase,
                r8_commands: Mutex::new(r8_commands),
                r8_command_sender,
            }),
        })
    }

    pub(crate) fn start_startup_watchdog(&self) {
        self.start_startup_watchdog_with(STARTUP_WATCHDOG_TIMEOUT, || std::process::exit(1));
    }

    fn start_startup_watchdog_with<F>(&self, timeout: Duration, terminate: F)
    where
        F: FnOnce() + Send + 'static,
    {
        let runtime = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            if runtime.emit_startup_timeout_failure() {
                terminate();
            }
        });
    }

    pub(crate) fn record_setup_entry(&self) {
        self.inner
            .startup_stages
            .fetch_or(STARTUP_SETUP_ENTERED, Ordering::SeqCst);
    }

    pub(crate) fn record_app_handle_ready<R: Runtime>(
        &self,
        _app: &AppHandle<R>,
    ) -> Result<(), &'static str> {
        if self.inner.startup_stages.load(Ordering::SeqCst) & STARTUP_SETUP_ENTERED == 0 {
            return Err("driver_tauri_startup_invalid");
        }
        self.inner
            .startup_stages
            .fetch_or(STARTUP_APP_HANDLE_READY, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn record_page_load(&self, event: PageLoadEvent) {
        let stage = match event {
            PageLoadEvent::Started => STARTUP_PAGE_LOAD_STARTED,
            PageLoadEvent::Finished => STARTUP_PAGE_LOAD_STARTED | STARTUP_PAGE_LOAD_FINISHED,
        };
        self.inner.startup_stages.fetch_or(stage, Ordering::SeqCst);
    }

    fn record_frontend_bootstrap(&self, stage: &str) -> Result<(), &'static str> {
        if stage != "frontend_bootstrap"
            || self.inner.startup_stages.load(Ordering::SeqCst) & STARTUP_APP_HANDLE_READY == 0
        {
            return Err("driver_frontend_startup_invalid");
        }
        self.inner
            .startup_stages
            .fetch_or(STARTUP_FRONTEND_BOOTSTRAP, Ordering::SeqCst);
        Ok(())
    }

    fn record_first_driver_ipc(&self) -> Result<(), &'static str> {
        if self.inner.startup_stages.load(Ordering::SeqCst) & STARTUP_FRONTEND_BOOTSTRAP == 0 {
            return Err("driver_frontend_startup_invalid");
        }
        self.inner
            .startup_stages
            .fetch_or(STARTUP_FIRST_DRIVER_IPC, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn guard_setup<T, F>(&self, operation: F) -> Result<T, Box<dyn Error>>
    where
        F: FnOnce() -> Result<T, Box<dyn Error>>,
    {
        let hook_guard = SETUP_PANIC_HOOK_LOCK.lock().map_err(|_| {
            self.emit_startup_failure("driver_setup_panic");
            std::io::Error::other("driver_setup_panic")
        })?;
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation));
        std::panic::set_hook(previous_hook);
        drop(hook_guard);
        match result {
            Ok(result) => result,
            Err(_) => {
                self.emit_startup_failure("driver_setup_panic");
                Err(std::io::Error::other("driver_setup_panic").into())
            }
        }
    }

    fn startup_timeout_failure_class(&self) -> &'static str {
        let stages = self.inner.startup_stages.load(Ordering::SeqCst);
        if stages & STARTUP_SETUP_ENTERED == 0 || stages & STARTUP_APP_HANDLE_READY == 0 {
            return "driver_setup_timeout";
        }
        if stages & STARTUP_PAGE_LOAD_STARTED == 0 {
            return "driver_page_load_timeout";
        }
        if stages & STARTUP_FRONTEND_BOOTSTRAP == 0 {
            return if stages & STARTUP_PAGE_LOAD_FINISHED == 0 {
                "driver_page_load_timeout"
            } else {
                "driver_frontend_bootstrap_timeout"
            };
        }
        if stages & STARTUP_FIRST_DRIVER_IPC == 0 {
            return "driver_frontend_ipc_timeout";
        }
        "driver_startup_timeout"
    }

    fn emit_startup_timeout_failure(&self) -> bool {
        self.emit_startup_failure(self.startup_timeout_failure_class())
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
            let r8_phase = runtime.inner.r8_phase;
            let frames = tokio::task::spawn_blocking(move || {
                read_control_frames(
                    inbound,
                    &read_runtime.inner.run_id,
                    &read_runtime.inner.nonce,
                    r8_phase,
                    read_runtime.inner.r8_command_sender.clone(),
                )
            })
            .await
            .ok();
            let terminal = frames.and_then(Result::ok);
            let valid = match terminal {
                Some(ControlTerminal::Abort) => runtime.begin_abort().await.is_ok(),
                Some(ControlTerminal::PlannedRestart) => true,
                None => false,
            };
            if valid {
                runtime.inner.outcome.send_replace(match terminal {
                    Some(ControlTerminal::PlannedRestart) => ControlOutcome::PlannedRestart,
                    _ => ControlOutcome::Abort,
                });
            } else if runtime.emit_control_monitor_failure() {
                runtime.fail().await;
                app.exit(1);
            }
        });
        Ok(())
    }

    pub(crate) fn emit_startup_failure(&self, failure_class: &str) -> bool {
        if !STARTUP_FAILURE_CLASSES.contains(&failure_class) {
            return false;
        }
        let Ok(mut terminal) = self.inner.startup_terminal.lock() else {
            return false;
        };
        if *terminal != StartupTerminal::Pending {
            return false;
        }
        *terminal = StartupTerminal::Failed;
        let _ = self.write_startup_failure(failure_class);
        true
    }

    pub(crate) fn emit_post_ready_failure(&self, failure_class: &str) -> bool {
        if !POST_READY_FAILURE_CLASSES.contains(&failure_class) {
            return false;
        }
        let Ok(startup_terminal) = self.inner.startup_terminal.lock() else {
            return false;
        };
        if *startup_terminal != StartupTerminal::Ready {
            return false;
        }
        drop(startup_terminal);
        if self
            .inner
            .post_ready_terminal
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }
        let _ = self.write_claimed_post_ready_failure(failure_class);
        true
    }

    fn emit_control_monitor_failure(&self) -> bool {
        let ready = self
            .inner
            .startup_terminal
            .lock()
            .map(|terminal| *terminal == StartupTerminal::Ready)
            .unwrap_or(false);
        if ready {
            self.emit_post_ready_failure("driver_control_projection_invalid")
        } else {
            self.emit_startup_failure("driver_control_monitor_invalid")
        }
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

    async fn validate_r8_chat_request(&self, request: &Value) -> Result<Uuid, &'static str> {
        let (request_id, context_id, _) = decode_driver_request(request)?;
        let context_id = context_id.hyphenated().to_string();
        let state = self.inner.state.lock().await;
        if !matches!(state.phase, DriverPhase::Bound | DriverPhase::Ready)
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
            || self.inner.startup_stages.load(Ordering::SeqCst) & STARTUP_READY_REQUIRED
                != STARTUP_READY_REQUIRED
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
                ControlOutcome::PlannedRestart => return Err("driver_control_failed"),
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
        self.write_post_ready_terminal("abort_complete")?;
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
        let mut outbound_guard = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        let outbound = outbound_guard
            .as_mut()
            .ok_or("driver_control_write_failed")?;
        outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed")
    }

    fn write_post_ready_terminal(&self, kind: &'static str) -> Result<(), &'static str> {
        if !["abort_complete", "planned_restart"].contains(&kind)
            || self
                .inner
                .post_ready_terminal
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            return Err("driver_control_order_invalid");
        }
        let mut outbound_guard = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        let sequence = if self.inner.r8_enabled {
            u64::from(self.inner.r8_case_index.load(Ordering::SeqCst)) + 2
        } else {
            2
        };
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
        let result = outbound_guard
            .as_mut()
            .ok_or("driver_control_write_failed")?
            .write_all(&encoded)
            .and_then(|_| outbound_guard.as_mut().unwrap().flush())
            .map_err(|_| "driver_control_write_failed");
        outbound_guard.take();
        result
    }

    pub(crate) async fn emit_case_result(
        &self,
        case_id: &str,
        status: &str,
        assertions: &[String],
        assertion_count: usize,
        assertion_set_sha256: &str,
    ) -> Result<(), &'static str> {
        if !self.inner.r8_enabled || status != "passed" {
            return Err("driver_case_result_invalid");
        }
        let index = self.inner.r8_case_index.load(Ordering::SeqCst) as usize;
        let global_index = self.inner.r8_case_offset as usize + index;
        if R8_CASES.get(global_index).copied() != Some(case_id) {
            return Err("driver_case_result_invalid");
        }
        let expected = r8_assertions(case_id)?;
        if assertion_count != expected.len()
            || assertions.len() != expected.len()
            || assertions
                .iter()
                .map(String::as_str)
                .ne(expected.iter().copied())
            || assertion_set_sha256 != r8_assertion_digest(expected)
        {
            return Err("driver_case_result_invalid");
        }
        let sequence = (index as u64) + 2;
        let mut encoded = serde_json::to_vec(&CaseResultFrame {
            schema_version: 1,
            run_id: &self.inner.run_id,
            nonce: &self.inner.nonce,
            sequence,
            kind: "case_result",
            case_id,
            status: "passed",
            assertion_count,
            assertion_set_sha256,
        })
        .map_err(|_| "driver_control_write_failed")?;
        encoded.push(b'\n');
        if encoded.len() > MAX_FRAME_BYTES {
            return Err("driver_control_write_failed");
        }
        let mut outbound_guard = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        if self.inner.post_ready_terminal.load(Ordering::SeqCst) {
            return Err("driver_control_order_invalid");
        }
        let outbound = outbound_guard
            .as_mut()
            .ok_or("driver_control_write_failed")?;
        outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed")?;
        self.inner.r8_case_index.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn wait_case(&self) -> Result<String, &'static str> {
        if !self.inner.r8_enabled {
            return Err("driver_control_order_invalid");
        }
        self.inner
            .r8_commands
            .lock()
            .await
            .recv()
            .await
            .ok_or("driver_control_eof")
    }

    async fn wait_for_planned_restart(&self) -> Result<(), &'static str> {
        let mut outcome = self.inner.outcome.subscribe();
        loop {
            match *outcome.borrow_and_update() {
                ControlOutcome::PlannedRestart => return Ok(()),
                ControlOutcome::Abort | ControlOutcome::Failed => {
                    return Err("driver_control_failed")
                }
                ControlOutcome::Pending => {}
            }
            outcome
                .changed()
                .await
                .map_err(|_| "driver_control_failed")?;
        }
    }

    fn write_startup_failure(&self, failure_class: &str) -> Result<(), &'static str> {
        let encoded =
            encode_startup_failure_frame(&self.inner.run_id, &self.inner.nonce, failure_class)?;
        let mut outbound_guard = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        let outbound = outbound_guard
            .as_mut()
            .ok_or("driver_control_write_failed")?;
        let result = outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed");
        outbound_guard.take();
        result
    }
    fn write_claimed_post_ready_failure(&self, failure_class: &str) -> Result<(), &'static str> {
        let mut outbound_guard = self
            .inner
            .outbound
            .lock()
            .map_err(|_| "driver_control_write_failed")?;
        let sequence = u64::from(self.inner.r8_case_index.load(Ordering::SeqCst)) + 2;
        let encoded = encode_post_ready_failure_frame(
            &self.inner.run_id,
            &self.inner.nonce,
            sequence,
            failure_class,
        )?;
        let outbound = outbound_guard
            .as_mut()
            .ok_or("driver_control_write_failed")?;
        let result = outbound
            .write_all(&encoded)
            .and_then(|_| outbound.flush())
            .map_err(|_| "driver_control_write_failed");
        outbound_guard.take();
        result
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

fn encode_post_ready_failure_frame(
    run_id: &str,
    nonce: &str,
    sequence: u64,
    failure_class: &str,
) -> Result<Vec<u8>, &'static str> {
    validate_uuid_v4(run_id).map_err(|_| "driver_control_write_failed")?;
    validate_uuid_v4(nonce).map_err(|_| "driver_control_write_failed")?;
    if sequence < 2 || !POST_READY_FAILURE_CLASSES.contains(&failure_class) {
        return Err("driver_control_write_failed");
    }
    let mut encoded = serde_json::to_vec(&PostReadyFailureFrame {
        schema_version: 1,
        run_id,
        nonce,
        sequence,
        kind: "component_failed",
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
pub(crate) async fn feat126_s10_driver_startup_stage(
    driver: State<'_, Feat126S10DriverRuntime>,
    stage: String,
) -> Result<(), String> {
    driver
        .record_frontend_bootstrap(&stage)
        .map_err(str::to_owned)
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_login(
    driver: State<'_, Feat126S10DriverRuntime>,
    auth: State<'_, NativeAuthRuntime>,
) -> Result<DriverLoginProjection, String> {
    driver.record_first_driver_ipc().map_err(str::to_owned)?;
    driver
        .require_phase(DriverPhase::Created)
        .await
        .map_err(str::to_owned)?;
    if auth
        .feat126_s10_driver_login()
        .await
        .map_err(str::to_owned)?
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
) -> Result<Value, crate::chat::ipc::ChatIpcError> {
    let request_id = Uuid::now_v7();
    driver
        .require_phase(DriverPhase::ProjectRegistered)
        .await
        .map_err(|_| crate::chat::ipc::ChatIpcError::request_invalid(Some(request_id)))?;
    let request = json!({
        "schemaVersion": 1,
        "requestId": request_id,
        "payload": { "tenantSelector": FIXED_TENANT },
    });
    let response = crate::chat::ipc::chat_bind_context_v1(request, app, auth, chat, ipc).await?;
    let response = serde_json::to_value(response)
        .map_err(|_| crate::chat::ipc::ChatIpcError::request_invalid(Some(request_id)))?;
    driver
        .bind_context(&response)
        .await
        .map_err(|_| crate::chat::ipc::ChatIpcError::request_invalid(Some(request_id)))?;
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
pub(crate) async fn feat126_s10_driver_case_result(
    driver: State<'_, Feat126S10DriverRuntime>,
    case_id: String,
    status: String,
    assertions: Vec<String>,
    assertion_count: usize,
    assertion_set_sha256: String,
) -> Result<(), String> {
    driver
        .emit_case_result(
            &case_id,
            &status,
            &assertions,
            assertion_count,
            &assertion_set_sha256,
        )
        .await
        .map_err(str::to_owned)
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_r8_observation(
    case_id: String,
    observations: Value,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Value, String> {
    if !driver.inner.r8_enabled {
        return Err("driver_control_order_invalid".to_owned());
    }
    let index = driver.inner.r8_case_index.load(Ordering::SeqCst) as usize;
    let global_index = driver.inner.r8_case_offset as usize + index;
    if R8_CASES.get(global_index).copied() != Some(case_id.as_str()) {
        return Err("driver_case_result_invalid".to_owned());
    }
    let expected = R8_OBSERVATION_KEYS
        .iter()
        .find(|(candidate, _)| *candidate == case_id)
        .map(|(_, keys)| *keys)
        .ok_or("driver_case_result_invalid")?;
    let object = observations
        .as_object()
        .ok_or("driver_case_result_invalid")?;
    if object.len() != expected.len()
        || expected
            .iter()
            .any(|key| object.get(*key) != Some(&Value::Bool(true)))
    {
        return Err("driver_case_result_invalid".to_owned());
    }
    if case_id == "s10b_011" {
        let probe = chat
            .feat126_s10_run_r8_probe()
            .await
            .map_err(|_| "driver_case_failed".to_owned())?;
        if probe.metadata_p95_ms > 200
            || probe.history_p95_ms > 300
            || probe.reducer_observations != 10_000
            || probe.session_count != 10_000
            || probe.message_count != 1_000_000
            || probe.idempotency_pairs != 10_000
            || probe.duplicate_count != 0
        {
            return Err("driver_case_failed".to_owned());
        }
    }
    Ok(json!({
        "caseId": case_id,
        "observations": object,
        "schemaVersion": 1,
        "status": "passed",
    }))
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_r8_phase(
    driver: State<'_, Feat126S10DriverRuntime>,
) -> Result<Value, String> {
    if !driver.inner.r8_enabled {
        return Err("driver_control_order_invalid".to_owned());
    }
    Ok(json!({ "schemaVersion": 1, "phase": driver.inner.r8_phase }))
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_wait_case(
    driver: State<'_, Feat126S10DriverRuntime>,
) -> Result<Value, String> {
    let case_id = driver.wait_case().await.map_err(str::to_owned)?;
    Ok(json!({ "kind": "mode_transition", "caseId": case_id }))
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_chat(
    command: String,
    request: Value,
    app: AppHandle,
    driver: State<'_, Feat126S10DriverRuntime>,
    chat: State<'_, ChatRuntime>,
    ipc: State<'_, ChatIpcRuntime>,
) -> Result<Value, String> {
    if !driver.inner.r8_enabled {
        return Err("driver_command_forbidden".to_owned());
    }
    driver
        .validate_r8_chat_request(&request)
        .await
        .map_err(str::to_owned)?;
    macro_rules! value {
        ($future:expr) => {
            serde_json::to_value($future.await.map_err(|_| "driver_case_failed".to_owned())?)
                .map_err(|_| "driver_case_failed".to_owned())
        };
    }
    match command.as_str() {
        "chat_list_projects_v1" => {
            value!(crate::chat::ipc::chat_list_projects_v1(request, chat, ipc))
        }
        "chat_pick_project_v1" => value!(crate::chat::ipc::chat_pick_project_v1(request, chat)),
        "chat_set_project_pinned_v1" => {
            value!(crate::chat::ipc::chat_set_project_pinned_v1(request, chat))
        }
        "chat_create_session_v1" => value!(crate::chat::ipc::chat_create_session_v1(
            request, app, chat, ipc
        )),
        "chat_submit_turn_v1" => value!(crate::chat::ipc::chat_submit_turn_v1(
            request, app, chat, ipc
        )),
        "chat_list_sessions_v1" => {
            value!(crate::chat::ipc::chat_list_sessions_v1(request, chat, ipc))
        }
        "chat_load_history_v1" => {
            value!(crate::chat::ipc::chat_load_history_v1(request, chat, ipc))
        }
        "chat_load_reasoning_v1" => {
            value!(crate::chat::ipc::chat_load_reasoning_v1(request, chat, ipc))
        }
        "chat_rename_session_v1" => value!(crate::chat::ipc::chat_rename_session_v1(request, chat)),
        "chat_set_session_pinned_v1" => {
            value!(crate::chat::ipc::chat_set_session_pinned_v1(request, chat))
        }
        "chat_interrupt_turn_v1" => value!(crate::chat::ipc::chat_interrupt_turn_v1(
            request, app, chat, ipc
        )),
        "chat_delete_session_v1" => value!(crate::chat::ipc::chat_delete_session_v1(
            request, app, chat, ipc
        )),
        "chat_get_cleanup_status_v1" => value!(crate::chat::ipc::chat_get_cleanup_status_v1(
            request, chat, ipc
        )),
        "chat_get_session_control_plane_v1" => value!(
            crate::chat::ipc::chat_get_session_control_plane_v1(request, chat, ipc)
        ),
        "chat_subscribe_session_v1" => value!(crate::chat::ipc::chat_subscribe_session_v1(
            request, app, chat, ipc
        )),
        "chat_resync_session_v1" => {
            value!(crate::chat::ipc::chat_resync_session_v1(request, chat, ipc))
        }
        "chat_unsubscribe_session_v1" => value!(crate::chat::ipc::chat_unsubscribe_session_v1(
            request, chat, ipc
        )),
        "chat_cancel_request_v1" => {
            value!(crate::chat::ipc::chat_cancel_request_v1(request, chat, ipc))
        }
        _ => Err("driver_command_forbidden".to_owned()),
    }
}

#[tauri::command]
pub(crate) async fn feat126_s10_driver_planned_restart(
    app: AppHandle,
    driver: State<'_, Feat126S10DriverRuntime>,
    auth: State<'_, NativeAuthRuntime>,
    chat: State<'_, ChatRuntime>,
    ipc: State<'_, ChatIpcRuntime>,
) -> Result<(), String> {
    if driver.inner.r8_phase != "before_restart"
        || driver.inner.r8_case_index.load(Ordering::SeqCst) != 3
    {
        return Err("driver_control_order_invalid".to_owned());
    }
    driver
        .wait_for_planned_restart()
        .await
        .map_err(str::to_owned)?;
    ipc.feat126_s10_shutdown()
        .await
        .map_err(|_| "driver_abort_failed".to_owned())?;
    chat.feat126_s10_close_owned_runtime()
        .await
        .map_err(|_| "driver_abort_failed".to_owned())?;
    auth.logout()
        .await
        .map_err(|_| "driver_auth_cleanup_failed".to_owned())?;
    if let Ok(manager) = chat.authorization_manager() {
        manager
            .invalidate_all()
            .map_err(|_| "driver_auth_cleanup_failed".to_owned())?;
    }
    driver
        .write_post_ready_terminal("planned_restart")
        .map_err(str::to_owned)?;
    app.exit(0);
    Ok(())
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
    ipc.feat126_s10_shutdown()
        .await
        .map_err(|_| "driver_abort_failed".to_owned())?;
    chat.feat126_s10_close_owned_runtime()
        .await
        .map_err(|_| "driver_abort_failed".to_owned())?;
    auth.logout()
        .await
        .map_err(|_| "driver_auth_cleanup_failed".to_owned())?;
    if let Ok(manager) = chat.authorization_manager() {
        manager
            .invalidate_all()
            .map_err(|_| "driver_auth_cleanup_failed".to_owned())?;
    }
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
    let post_ready = driver
        .inner
        .startup_terminal
        .lock()
        .map(|terminal| *terminal == StartupTerminal::Ready)
        .unwrap_or(false);
    let emitted = if post_ready {
        let failure_class = if POST_READY_FAILURE_CLASSES.contains(&failure_class.as_str()) {
            failure_class.as_str()
        } else {
            "driver_case_failed"
        };
        driver.emit_post_ready_failure(failure_class)
    } else {
        let failure_class = if STARTUP_FAILURE_CLASSES.contains(&failure_class.as_str()) {
            failure_class.as_str()
        } else {
            "driver_frontend_startup_invalid"
        };
        driver.emit_startup_failure(failure_class)
    };
    if !emitted {
        return Ok(());
    }
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

fn read_control_frames(
    reader: File,
    run_id: &str,
    nonce: &str,
    r8_phase: &str,
    sender: mpsc::Sender<String>,
) -> Result<ControlTerminal, &'static str> {
    if r8_phase == "disabled" {
        read_control_frame(reader, run_id, nonce)?;
        return Ok(ControlTerminal::Abort);
    }
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(256);
    let expected_cases = match r8_phase {
        "before_restart" => &R8_CASES[..3],
        "after_restart" => &R8_CASES[3..],
        _ => return Err("driver_control_frame_invalid"),
    };
    let mut sequence = 0_u64;
    let mut case_index = 0_usize;
    loop {
        line.clear();
        let bytes = reader
            .read_until(b'\n', &mut line)
            .map_err(|_| "driver_control_read_failed")?;
        if bytes == 0 {
            return Err("driver_control_eof");
        }
        if line.len() > MAX_FRAME_BYTES {
            return Err("driver_control_frame_invalid");
        }
        let frame: ControlFrame =
            serde_json::from_slice(&line).map_err(|_| "driver_control_frame_invalid")?;
        sequence += 1;
        if frame.schema_version != 1
            || frame.run_id != run_id
            || frame.nonce != nonce
            || frame.sequence != sequence
        {
            return Err("driver_control_frame_invalid");
        }
        let terminal_kind = if r8_phase == "before_restart" {
            "planned_restart"
        } else {
            "abort"
        };
        if frame.kind == terminal_kind
            && frame.case_id.is_none()
            && case_index == expected_cases.len()
        {
            return Ok(if r8_phase == "before_restart" {
                ControlTerminal::PlannedRestart
            } else {
                ControlTerminal::Abort
            });
        }
        if frame.kind != "mode_transition" {
            return Err("driver_control_frame_invalid");
        }
        let case_id = frame.case_id.ok_or("driver_control_frame_invalid")?;
        if expected_cases.get(case_index).copied() != Some(case_id.as_str()) {
            return Err("driver_control_frame_invalid");
        }
        sender
            .blocking_send(case_id)
            .map_err(|_| "driver_control_monitor_invalid")?;
        case_index += 1;
    }
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
        || frame.case_id.is_some()
    {
        return Err("driver_control_frame_invalid");
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    #![allow(unexpected_cfgs)]

    use super::*;
    use std::fs::OpenOptions;
    use std::io::{Cursor, Seek};
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
        let (r8_command_sender, r8_commands) = mpsc::channel(1);
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
                    outbound: StdMutex::new(Some(outbound)),
                    outcome,
                    monitor_started: AtomicBool::new(false),
                    startup_terminal: StdMutex::new(StartupTerminal::Pending),
                    post_ready_terminal: AtomicBool::new(false),
                    startup_stages: AtomicU8::new(0),
                    r8_enabled: false,
                    r8_case_index: AtomicU8::new(0),
                    r8_case_offset: 0,
                    r8_phase: "disabled",
                    r8_commands: Mutex::new(r8_commands),
                    r8_command_sender,
                }),
            },
            path,
        )
    }

    fn runtime_with_r8_output(
        phase: &'static str,
        offset: u8,
    ) -> (Feat126S10DriverRuntime, PathBuf) {
        let (runtime, path) = runtime_with_output();
        let outbound = runtime.inner.outbound.lock().unwrap().take();
        let inbound = runtime.inner.inbound.lock().unwrap().take();
        let (outcome, _) = watch::channel(ControlOutcome::Pending);
        let (sender, receiver) = mpsc::channel(16);
        (
            Feat126S10DriverRuntime {
                inner: Arc::new(DriverInner {
                    run_id: RUN_ID.to_owned(),
                    nonce: NONCE.to_owned(),
                    state: Mutex::new(DriverState {
                        phase: DriverPhase::Ready,
                        project_id: Some("019fbd88-cbc3-7bf1-934d-7b05cd693f99".to_owned()),
                        context_id: Some("019fbd88-cbc3-7bf1-934d-7b05cd693f98".to_owned()),
                        project_revalidated: true,
                        recovery_requested: true,
                    }),
                    inbound: StdMutex::new(inbound),
                    outbound: StdMutex::new(outbound),
                    outcome,
                    monitor_started: AtomicBool::new(false),
                    startup_terminal: StdMutex::new(StartupTerminal::Ready),
                    post_ready_terminal: AtomicBool::new(false),
                    startup_stages: AtomicU8::new(STARTUP_READY_REQUIRED),
                    r8_enabled: true,
                    r8_case_index: AtomicU8::new(0),
                    r8_case_offset: offset,
                    r8_phase: phase,
                    r8_commands: Mutex::new(receiver),
                    r8_command_sender: sender,
                }),
            },
            path,
        )
    }

    async fn prepare_runtime_for_ready(runtime: &Feat126S10DriverRuntime) {
        runtime
            .inner
            .startup_stages
            .store(STARTUP_READY_REQUIRED, Ordering::SeqCst);
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

    fn driver_request(context_id: &str) -> Value {
        json!({
            "schemaVersion": 1,
            "requestId": "019fbd88-cbc3-7bf1-934d-7b05cd693f97",
            "contextId": context_id,
            "payload": {},
        })
    }

    #[tokio::test]
    async fn r8_chat_requests_remain_authorized_after_component_ready() {
        let (runtime, path) = runtime_with_r8_output("before_restart", 0);
        let context_id = runtime.inner.state.lock().await.context_id.clone().unwrap();
        assert!(runtime
            .validate_r8_chat_request(&driver_request(&context_id))
            .await
            .is_ok());
        assert_eq!(
            runtime
                .validate_bound_request(&driver_request(&context_id))
                .await,
            Err("driver_context_invalid")
        );
        assert_eq!(
            runtime
                .validate_r8_chat_request(&driver_request(RUN_ID))
                .await,
            Err("driver_context_invalid")
        );
        drop(runtime);
        std::fs::remove_file(path).unwrap();
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
    fn r8_control_reader_accepts_only_the_frozen_two_phase_order() {
        for (phase, cases, terminal) in [
            ("before_restart", &R8_CASES[..3], "planned_restart"),
            ("after_restart", &R8_CASES[3..], "abort"),
        ] {
            let path = std::env::temp_dir().join(format!("yijie-s10-r8-input-{}", Uuid::now_v7()));
            let mut file = OpenOptions::new()
                .create_new(true)
                .read(true)
                .write(true)
                .mode(0o600)
                .open(&path)
                .unwrap();
            for (index, case_id) in cases.iter().enumerate() {
                writeln!(
                    file,
                    "{{\"schema_version\":1,\"run_id\":\"{RUN_ID}\",\"nonce\":\"{NONCE}\",\"sequence\":{},\"kind\":\"mode_transition\",\"case_id\":\"{case_id}\"}}",
                    index + 1,
                )
                .unwrap();
            }
            writeln!(
                file,
                "{{\"schema_version\":1,\"run_id\":\"{RUN_ID}\",\"nonce\":\"{NONCE}\",\"sequence\":{},\"kind\":\"{terminal}\"}}",
                cases.len() + 1,
            )
            .unwrap();
            file.rewind().unwrap();
            let (sender, mut receiver) = mpsc::channel(16);
            assert_eq!(
                read_control_frames(file, RUN_ID, NONCE, phase, sender).unwrap(),
                if phase == "before_restart" {
                    ControlTerminal::PlannedRestart
                } else {
                    ControlTerminal::Abort
                },
            );
            let mut observed = Vec::new();
            while let Ok(case_id) = receiver.try_recv() {
                observed.push(case_id);
            }
            assert_eq!(observed, cases);
            std::fs::remove_file(path).unwrap();
        }
    }

    #[tokio::test]
    async fn r8_case_results_use_phase_local_sequences_before_the_terminal_frame() {
        for (phase, offset, cases, terminal) in [
            ("before_restart", 0, &R8_CASES[..3], "planned_restart"),
            ("after_restart", 3, &R8_CASES[3..], "abort_complete"),
        ] {
            let (runtime, output) = runtime_with_r8_output(phase, offset);
            for case_id in cases {
                let expected = r8_assertions(case_id).unwrap();
                runtime
                    .emit_case_result(
                        case_id,
                        "passed",
                        &expected
                            .iter()
                            .map(|value| (*value).to_owned())
                            .collect::<Vec<_>>(),
                        expected.len(),
                        &r8_assertion_digest(expected),
                    )
                    .await
                    .unwrap();
            }
            runtime
                .write_frame(cases.len() as u64 + 2, terminal)
                .unwrap();
            runtime.inner.outbound.lock().unwrap().take();
            let frames = std::fs::read_to_string(&output)
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str::<Value>(line).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(frames.len(), cases.len() + 1);
            for (index, case_id) in cases.iter().enumerate() {
                assert_eq!(frames[index]["sequence"], (index + 2) as u64);
                assert_eq!(frames[index]["kind"], "case_result");
                assert_eq!(frames[index]["case_id"], *case_id);
            }
            assert_eq!(frames.last().unwrap()["kind"], terminal);
            assert_eq!(frames.last().unwrap()["sequence"], cases.len() as u64 + 2);
            drop(runtime);
            std::fs::remove_file(output).unwrap();
        }
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
        for failure_class in [
            "driver_bind_context_denied",
            "driver_bind_context_invalid",
            "driver_bind_context_unauthenticated",
            "driver_bind_context_unavailable",
            "driver_bind_event_failed",
            "driver_bind_project_snapshot_failed",
            "driver_bind_readiness_snapshot_failed",
            "driver_bind_session_snapshot_failed",
        ] {
            assert!(encode_startup_failure_frame(RUN_ID, NONCE, failure_class).is_ok());
        }
        assert!(encode_startup_failure_frame(RUN_ID, NONCE, "driver_control_eof").is_err());
    }

    #[test]
    fn post_ready_failure_frame_is_content_free_and_closes_fd4() {
        let (runtime, output) = runtime_with_r8_output("after_restart", 3);
        for failure_class in [
            "driver_case_session_rename_failed",
            "driver_case_session_pin_failed",
            "driver_case_project_pin_failed",
        ] {
            assert!(encode_post_ready_failure_frame(RUN_ID, NONCE, 2, failure_class).is_ok());
        }
        let encoded =
            encode_post_ready_failure_frame(RUN_ID, NONCE, 2, "driver_case_failed").unwrap();
        let value: Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(value["kind"], "component_failed");
        assert_eq!(value["sequence"], 2);
        assert_eq!(value["failure_class"], "driver_case_failed");
        assert_eq!(value.as_object().unwrap().len(), 6);
        assert!(!encoded.windows(3).any(|window| window == b"/tmp"));
        assert!(runtime.emit_post_ready_failure("driver_case_failed"));
        assert!(!runtime.emit_post_ready_failure("driver_case_result_failed"));
        assert_eq!(
            runtime.write_post_ready_terminal("abort_complete"),
            Err("driver_control_order_invalid")
        );
        assert!(runtime.inner.outbound.lock().unwrap().is_none());
        let frame: Value =
            serde_json::from_str(std::fs::read_to_string(output).unwrap().trim()).unwrap();
        assert_eq!(frame["kind"], "component_failed");
    }

    #[tokio::test]
    async fn post_ready_success_terminal_suppresses_later_frames() {
        let (runtime, output) = runtime_with_r8_output("after_restart", 3);
        runtime.write_post_ready_terminal("abort_complete").unwrap();
        assert!(!runtime.emit_post_ready_failure("driver_case_failed"));
        let expected = r8_assertions("s10b_005_planned_restart").unwrap();
        assert_eq!(
            runtime
                .emit_case_result(
                    "s10b_005_planned_restart",
                    "passed",
                    &expected
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect::<Vec<_>>(),
                    expected.len(),
                    &r8_assertion_digest(expected),
                )
                .await,
            Err("driver_control_order_invalid")
        );
        assert!(runtime.inner.outbound.lock().unwrap().is_none());
        let frames = std::fs::read_to_string(output).unwrap();
        assert_eq!(frames.lines().count(), 1);
        let frame: Value = serde_json::from_str(frames.trim()).unwrap();
        assert_eq!(frame["kind"], "abort_complete");
    }

    #[test]
    fn every_synthetic_login_stage_is_an_fd4_startup_leaf() {
        for failure in SyntheticLoginFailure::ALL {
            let failure_class = failure.failure_class();
            assert!(STARTUP_FAILURE_CLASSES.contains(&failure_class));
            let frame = encode_startup_failure_frame(RUN_ID, NONCE, failure_class).unwrap();
            let value: Value = serde_json::from_slice(&frame).unwrap();
            assert_eq!(value["failure_class"], failure_class);
            assert_eq!(value.as_object().unwrap().len(), 6);
        }
    }

    #[test]
    fn control_monitor_failure_uses_the_reached_terminal_phase() {
        let (startup, startup_output) = runtime_with_output();
        assert!(startup.emit_control_monitor_failure());
        let startup_frame: Value =
            serde_json::from_str(std::fs::read_to_string(startup_output).unwrap().trim()).unwrap();
        assert_eq!(startup_frame["kind"], "startup_failed");
        assert_eq!(
            startup_frame["failure_class"],
            "driver_control_monitor_invalid"
        );

        let (ready, ready_output) = runtime_with_r8_output("after_restart", 3);
        assert!(ready.emit_control_monitor_failure());
        let ready_frame: Value =
            serde_json::from_str(std::fs::read_to_string(ready_output).unwrap().trim()).unwrap();
        assert_eq!(ready_frame["kind"], "component_failed");
        assert_eq!(
            ready_frame["failure_class"],
            "driver_control_projection_invalid"
        );
    }

    #[test]
    fn startup_failure_is_one_shot_and_preserves_the_first_closed_leaf() {
        let (runtime, output) = runtime_with_output();
        runtime.emit_startup_failure("driver_control_monitor_invalid");
        runtime.emit_startup_failure("driver_profile_invalid");

        assert!(runtime.inner.outbound.lock().unwrap().is_none());
        let encoded = std::fs::read_to_string(&output).unwrap();
        let frames = encoded.lines().collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        let failure: serde_json::Value = serde_json::from_str(frames[0]).unwrap();
        assert_eq!(failure["kind"], "startup_failed");
        assert_eq!(failure["failure_class"], "driver_control_monitor_invalid");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn startup_watchdog_projects_the_first_missing_content_free_stage() {
        let (runtime, output) = runtime_with_output();
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_setup_timeout"
        );
        runtime.record_setup_entry();
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_setup_timeout"
        );
        runtime
            .inner
            .startup_stages
            .fetch_or(STARTUP_APP_HANDLE_READY, Ordering::SeqCst);
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_page_load_timeout"
        );
        runtime.record_page_load(PageLoadEvent::Finished);
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_frontend_bootstrap_timeout"
        );
        runtime
            .record_frontend_bootstrap("frontend_bootstrap")
            .unwrap();
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_frontend_ipc_timeout"
        );
        runtime.record_first_driver_ipc().unwrap();
        assert_eq!(
            runtime.startup_timeout_failure_class(),
            "driver_startup_timeout"
        );
        assert!(runtime.emit_startup_timeout_failure());
        let encoded = std::fs::read_to_string(&output).unwrap();
        let failure: serde_json::Value = serde_json::from_str(encoded.trim_end()).unwrap();
        assert_eq!(failure["failure_class"], "driver_startup_timeout");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn startup_watchdog_emits_and_closes_fd4_before_termination() {
        let (runtime, output) = runtime_with_output();
        let (terminated, observed) = std::sync::mpsc::sync_channel(1);
        runtime.start_startup_watchdog_with(Duration::from_millis(20), move || {
            terminated.send(()).unwrap();
        });
        observed.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(runtime.inner.outbound.lock().unwrap().is_none());
        let encoded = std::fs::read_to_string(&output).unwrap();
        let failure: serde_json::Value = serde_json::from_str(encoded.trim_end()).unwrap();
        assert_eq!(failure["failure_class"], "driver_setup_timeout");
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[cfg(tauri_dep_test)]
    #[test]
    fn real_tauri_setup_fixture_records_an_app_handle_without_external_io() {
        let (runtime, output) = runtime_with_output();
        let setup_runtime = runtime.clone();
        let mut app = tauri::test::mock_builder()
            .setup(move |app| {
                setup_runtime.record_setup_entry();
                setup_runtime
                    .record_app_handle_ready(app.handle())
                    .map_err(std::io::Error::other)?;
                Ok(())
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        #[allow(deprecated)]
        app.run_iteration(|_, _| {});
        let stages = runtime.inner.startup_stages.load(Ordering::SeqCst);
        assert_eq!(
            stages & (STARTUP_SETUP_ENTERED | STARTUP_APP_HANDLE_READY),
            STARTUP_SETUP_ENTERED | STARTUP_APP_HANDLE_READY
        );
        drop(app);
        drop(runtime);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn setup_panic_is_closed_without_forwarding_the_panic_value() {
        let (runtime, output) = runtime_with_output();
        let result = runtime
            .guard_setup(|| -> Result<(), Box<dyn Error>> { panic!("sensitive setup detail") });
        assert!(result.is_err());
        let encoded = std::fs::read_to_string(&output).unwrap();
        let failure: serde_json::Value = serde_json::from_str(encoded.trim_end()).unwrap();
        assert_eq!(failure["failure_class"], "driver_setup_panic");
        assert!(!encoded.contains("sensitive setup detail"));
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

        assert!(runtime.inner.outbound.lock().unwrap().is_none());
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
