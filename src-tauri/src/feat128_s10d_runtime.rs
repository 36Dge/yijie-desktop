use crate::chat::{ArtifactKind, ChatRuntime};
use crate::feat126_secure_storage::Feat126SecureStorageProfile;
use crate::native_auth::NativeAuthRuntime;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

const OWNER: &str = "12800000-0000-4000-8000-000000000001";
const TENANT: &str = "12800000-0000-4000-8000-100000000001";
const RESULT_BASENAME: &str = "s10d-h-result.json";
const CONTROL_BASENAME: &str = "s10d-h-window.json";
const SCREENSHOT_ACK_BASENAME: &str = "s10d-h-screenshot.ack";
const GLOBAL_TIMEOUT_SECONDS: u64 = 300;
const SCREENSHOT_TIMEOUT_SECONDS: u64 = 45;
const STAGES: [&str; 4] = [
    "production_page_ready",
    "four_shells_ready",
    "axe_focus_ready",
    "screenshot_ready",
];

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadyAck {
    schema_version: u8,
    status: &'static str,
}

impl RuntimeReadyAck {
    fn ready() -> Self {
        Self {
            schema_version: 1,
            status: "ready",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeCheckpointRequest {
    schema_version: u8,
    stage: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeObservation {
    schema_version: u8,
    status: String,
    failure_code: Option<String>,
    production_path: RuntimeProductionPath,
    lifecycle: RuntimeLifecycle,
    ui: RuntimeUi,
}

impl RuntimeObservation {
    fn shutdown_failure(lifecycle: RuntimeLifecycle, axe_stages: Vec<String>) -> Self {
        Self {
            schema_version: 1,
            status: "failed".to_owned(),
            failure_code: Some("runtime_graceful_shutdown_failed".to_owned()),
            production_path: RuntimeProductionPath {
                production_bootstrap: false,
                production_chat_page: false,
                production_commands: false,
                single_v3: false,
                sqlcipher: false,
                history_v3: false,
                artifact_store: false,
                typed_clients: false,
            },
            lifecycle,
            ui: RuntimeUi {
                axe_serious_critical: -1,
                focus_order: false,
                axe_stages,
            },
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeProductionPath {
    production_bootstrap: bool,
    production_chat_page: bool,
    production_commands: bool,
    single_v3: bool,
    sqlcipher: bool,
    history_v3: bool,
    artifact_store: bool,
    typed_clients: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeLifecycle {
    dom_ready_shells: u8,
    dom_kinds: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeUi {
    axe_serious_critical: i8,
    focus_order: bool,
    axe_stages: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeResult<'a> {
    schema_version: u8,
    status: &'a str,
    failure_code: Option<&'a str>,
    production_path: &'a RuntimeProductionPath,
    lifecycle: RuntimeResultLifecycle<'a>,
    ui: RuntimeResultUi<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeResultLifecycle<'a> {
    host_native: &'a NativeLifecycleEvidence,
    dom: &'a RuntimeLifecycle,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NativeLifecycleEvidence {
    announced: u8,
    progress: u8,
    ready: u8,
    kinds: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Feat128S10dArtifactStage {
    Announced,
    Progress,
    Ready,
}

#[derive(Clone, Debug)]
struct NativeArtifactState {
    kind: &'static str,
    ordinal: usize,
    stage: Feat128S10dArtifactStage,
}

#[derive(Default)]
struct NativeLifecycleTracker {
    active: bool,
    artifacts: BTreeMap<Uuid, NativeArtifactState>,
}

static NATIVE_LIFECYCLE: LazyLock<Mutex<NativeLifecycleTracker>> =
    LazyLock::new(|| Mutex::new(NativeLifecycleTracker::default()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeResultUi<'a> {
    axe_serious_critical: i8,
    focus_order: bool,
    axe_stages: &'a [String],
    screenshot_sha256: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowControl {
    schema_version: u8,
    status: &'static str,
    window_number: isize,
}

pub struct Feat128S10dRuntime {
    project_path: PathBuf,
    result_path: PathBuf,
    control_path: PathBuf,
    screenshot_ack_path: PathBuf,
    prepared: Mutex<bool>,
    stages: Mutex<BTreeSet<String>>,
    screenshot_sha256: Mutex<Option<String>>,
    completed: Mutex<bool>,
}

pub(crate) fn feat128_s10d_record_native_artifact(
    artifact_id: Uuid,
    kind: ArtifactKind,
    ordinal: usize,
    stage: Feat128S10dArtifactStage,
) -> Result<(), &'static str> {
    let mut tracker = NATIVE_LIFECYCLE
        .lock()
        .map_err(|_| "runtime_native_lifecycle_invalid")?;
    if !tracker.active {
        return Ok(());
    }
    tracker.record(artifact_id, kind, ordinal, stage)
}

fn reset_native_lifecycle() -> Result<(), &'static str> {
    let mut tracker = NATIVE_LIFECYCLE
        .lock()
        .map_err(|_| "runtime_native_lifecycle_invalid")?;
    tracker.artifacts.clear();
    tracker.active = true;
    Ok(())
}

fn native_lifecycle_evidence() -> Result<NativeLifecycleEvidence, &'static str> {
    let tracker = NATIVE_LIFECYCLE
        .lock()
        .map_err(|_| "runtime_native_lifecycle_invalid")?;
    Ok(tracker.evidence())
}

fn close_native_lifecycle() -> Result<(), &'static str> {
    let mut tracker = NATIVE_LIFECYCLE
        .lock()
        .map_err(|_| "runtime_native_lifecycle_invalid")?;
    tracker.close();
    Ok(())
}

impl NativeLifecycleTracker {
    fn close(&mut self) {
        self.active = false;
        self.artifacts.clear();
    }

    fn record(
        &mut self,
        artifact_id: Uuid,
        kind: ArtifactKind,
        ordinal: usize,
        stage: Feat128S10dArtifactStage,
    ) -> Result<(), &'static str> {
        if artifact_id.is_nil() || ordinal >= 4 {
            return Err("runtime_native_lifecycle_invalid");
        }
        let kind = kind.as_str();
        match stage {
            Feat128S10dArtifactStage::Announced => {
                if self.artifacts.contains_key(&artifact_id)
                    || self
                        .artifacts
                        .values()
                        .any(|state| state.ordinal == ordinal || state.kind == kind)
                {
                    return Err("runtime_native_lifecycle_invalid");
                }
                self.artifacts.insert(
                    artifact_id,
                    NativeArtifactState {
                        kind,
                        ordinal,
                        stage,
                    },
                );
            }
            Feat128S10dArtifactStage::Progress | Feat128S10dArtifactStage::Ready => {
                let state = self
                    .artifacts
                    .get_mut(&artifact_id)
                    .ok_or("runtime_native_lifecycle_invalid")?;
                let expected = match stage {
                    Feat128S10dArtifactStage::Progress => Feat128S10dArtifactStage::Announced,
                    Feat128S10dArtifactStage::Ready => Feat128S10dArtifactStage::Progress,
                    Feat128S10dArtifactStage::Announced => unreachable!(),
                };
                if state.kind != kind || state.ordinal != ordinal || state.stage != expected {
                    return Err("runtime_native_lifecycle_invalid");
                }
                state.stage = stage;
            }
        }
        Ok(())
    }

    fn evidence(&self) -> NativeLifecycleEvidence {
        let mut kinds = BTreeSet::new();
        let mut evidence = NativeLifecycleEvidence::default();
        for state in self.artifacts.values() {
            evidence.announced = evidence.announced.saturating_add(1);
            if matches!(
                state.stage,
                Feat128S10dArtifactStage::Progress | Feat128S10dArtifactStage::Ready
            ) {
                evidence.progress = evidence.progress.saturating_add(1);
            }
            if state.stage == Feat128S10dArtifactStage::Ready {
                evidence.ready = evidence.ready.saturating_add(1);
            }
            kinds.insert(state.kind);
        }
        evidence.kinds = u8::try_from(kinds.len()).unwrap_or(u8::MAX);
        evidence
    }
}

fn classify_lifecycle_timeout(
    native: &NativeLifecycleEvidence,
    dom: &RuntimeLifecycle,
) -> &'static str {
    let complete = NativeLifecycleEvidence {
        announced: 4,
        progress: 4,
        ready: 4,
        kinds: 4,
    };
    if native != &complete {
        "native_lifecycle_incomplete"
    } else if dom.dom_ready_shells != 4 {
        "native_complete_dom_ready_incomplete"
    } else if dom.dom_kinds != 4 {
        "native_complete_dom_kind_incomplete"
    } else {
        "lifecycle_complete_finish_failed"
    }
}

impl Feat128S10dRuntime {
    pub fn from_environment(
        profile: Option<Arc<Feat126SecureStorageProfile>>,
    ) -> Result<Self, &'static str> {
        validate_environment(|name| std::env::var(name).ok())?;
        let profile = profile.ok_or("runtime_storage_profile_invalid")?;
        if !profile.uses_ephemeral_backend() {
            return Err("runtime_storage_profile_invalid");
        }
        let run_root = profile
            .desktop_app_data()
            .parent()
            .ok_or("runtime_run_root_invalid")?;
        let project_path = run_root.join("project");
        profile
            .validate_project_path(&project_path)
            .map_err(|_| "runtime_project_bootstrap_failed")?;
        let result_path =
            exact_run_path(run_root, "YIJIE_FEAT128_S10D_RESULT_PATH", RESULT_BASENAME)?;
        let control_path = exact_run_path(
            run_root,
            "YIJIE_FEAT128_S10D_CONTROL_PATH",
            CONTROL_BASENAME,
        )?;
        let screenshot_ack_path = exact_run_path(
            run_root,
            "YIJIE_FEAT128_S10D_SCREENSHOT_ACK_PATH",
            SCREENSHOT_ACK_BASENAME,
        )?;
        Ok(Self {
            project_path,
            result_path,
            control_path,
            screenshot_ack_path,
            prepared: Mutex::new(false),
            stages: Mutex::new(BTreeSet::new()),
            screenshot_sha256: Mutex::new(None),
            completed: Mutex::new(false),
        })
    }

    pub fn start_watchdog(app: AppHandle) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(GLOBAL_TIMEOUT_SECONDS)).await;
            let runtime = app.state::<Feat128S10dRuntime>();
            if runtime.record_failure("runtime_global_timeout").is_ok() {
                app.exit(1);
            }
        });
    }

    fn start_prepare(&self) -> Result<(), &'static str> {
        let mut prepared = self.prepared.lock().map_err(|_| "runtime_state_invalid")?;
        if *prepared {
            return Err("runtime_prepare_duplicate");
        }
        reset_native_lifecycle()?;
        *prepared = true;
        Ok(())
    }

    fn record_stage(&self, stage: &str) -> Result<(), &'static str> {
        let index = STAGES
            .iter()
            .position(|candidate| *candidate == stage)
            .ok_or("runtime_checkpoint_invalid")?;
        let mut stages = self.stages.lock().map_err(|_| "runtime_state_invalid")?;
        if stages.len() != index || stages.contains(stage) {
            return Err("runtime_checkpoint_invalid");
        }
        stages.insert(stage.to_owned());
        Ok(())
    }

    fn write_window_control(&self, window_number: isize) -> Result<(), &'static str> {
        if window_number <= 0 {
            return Err("runtime_window_invalid");
        }
        atomic_private_json(
            &self.control_path,
            &WindowControl {
                schema_version: 1,
                status: "screenshot_requested",
                window_number,
            },
        )
    }

    async fn wait_for_screenshot(&self) -> Result<(), &'static str> {
        let deadline =
            tokio::time::Instant::now() + Duration::from_secs(SCREENSHOT_TIMEOUT_SECONDS);
        loop {
            if let Ok(value) = fs::read_to_string(&self.screenshot_ack_path) {
                let value = value.trim();
                if value.len() != 64
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err("runtime_screenshot_ack_invalid");
                }
                *self
                    .screenshot_sha256
                    .lock()
                    .map_err(|_| "runtime_state_invalid")? = Some(value.to_owned());
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("runtime_screenshot_timeout");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    fn record(&self, observation: &RuntimeObservation) -> Result<bool, &'static str> {
        validate_observation(observation)?;
        let native_lifecycle = native_lifecycle_evidence()?;
        let complete_native = NativeLifecycleEvidence {
            announced: 4,
            progress: 4,
            ready: 4,
            kinds: 4,
        };
        let classification =
            if observation.status == "passed" && native_lifecycle != complete_native {
                Some("native_lifecycle_incomplete")
            } else if observation.status == "failed"
                && observation.failure_code.as_deref() == Some("runtime_lifecycle_timeout")
            {
                Some(classify_lifecycle_timeout(
                    &native_lifecycle,
                    &observation.lifecycle,
                ))
            } else {
                observation.failure_code.as_deref()
            };
        let passed = observation.status == "passed" && classification.is_none();
        let mut completed = self.completed.lock().map_err(|_| "runtime_state_invalid")?;
        if *completed {
            return Err("runtime_finish_duplicate");
        }
        if passed {
            let stages = self.stages.lock().map_err(|_| "runtime_state_invalid")?;
            if stages.len() != STAGES.len() {
                return Err("runtime_checkpoint_incomplete");
            }
        }
        let screenshot = self
            .screenshot_sha256
            .lock()
            .map_err(|_| "runtime_state_invalid")?;
        let result = RuntimeResult {
            schema_version: 1,
            status: if passed { "passed" } else { "failed" },
            failure_code: classification,
            production_path: &observation.production_path,
            lifecycle: RuntimeResultLifecycle {
                host_native: &native_lifecycle,
                dom: &observation.lifecycle,
            },
            ui: RuntimeResultUi {
                axe_serious_critical: observation.ui.axe_serious_critical,
                focus_order: observation.ui.focus_order,
                axe_stages: &observation.ui.axe_stages,
                screenshot_sha256: screenshot.as_deref(),
            },
        };
        close_native_lifecycle()?;
        atomic_private_json(&self.result_path, &result)?;
        *completed = true;
        Ok(passed)
    }

    fn record_failure(&self, failure_code: &str) -> Result<(), &'static str> {
        self.record(&RuntimeObservation {
            schema_version: 1,
            status: "failed".to_owned(),
            failure_code: Some(failure_code.to_owned()),
            production_path: RuntimeProductionPath {
                production_bootstrap: false,
                production_chat_page: false,
                production_commands: false,
                single_v3: false,
                sqlcipher: false,
                history_v3: false,
                artifact_store: false,
                typed_clients: false,
            },
            lifecycle: RuntimeLifecycle {
                dom_ready_shells: 0,
                dom_kinds: 0,
            },
            ui: RuntimeUi {
                axe_serious_critical: -1,
                focus_order: false,
                axe_stages: Vec::new(),
            },
        })
        .map(|_| ())
    }
}

#[tauri::command]
pub async fn feat128_s10d_runtime_prepare_v1(
    window: WebviewWindow,
    runtime: State<'_, Feat128S10dRuntime>,
    auth: State<'_, NativeAuthRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<RuntimeReadyAck, &'static str> {
    if window.label() != "main" {
        return Err("runtime_window_invalid");
    }
    runtime.start_prepare()?;
    auth.feat128_s10d_activate_authority()?;
    chat.feat128_s10d_register_profile_project(runtime.project_path.clone())
        .await
        .map_err(|_| "runtime_project_bootstrap_failed")?;
    Ok(RuntimeReadyAck::ready())
}

#[tauri::command]
pub async fn feat128_s10d_runtime_checkpoint_v1(
    request: RuntimeCheckpointRequest,
    window: WebviewWindow,
    runtime: State<'_, Feat128S10dRuntime>,
) -> Result<RuntimeReadyAck, &'static str> {
    if request.schema_version != 1 || window.label() != "main" {
        return Err("runtime_checkpoint_invalid");
    }
    runtime.record_stage(&request.stage)?;
    if request.stage == "screenshot_ready" {
        runtime.write_window_control(window_number(&window)?)?;
        runtime.wait_for_screenshot().await?;
    }
    Ok(RuntimeReadyAck::ready())
}

#[tauri::command]
pub async fn feat128_s10d_runtime_finish_v1(
    request: RuntimeObservation,
    app: AppHandle,
    runtime: State<'_, Feat128S10dRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<(), &'static str> {
    let request = match chat.feat128_s10d_shutdown().await {
        Ok(()) => request,
        Err(_) => RuntimeObservation::shutdown_failure(request.lifecycle, request.ui.axe_stages),
    };
    let passed = runtime.record(&request)?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}

fn validate_environment<F>(mut read: F) -> Result<(), &'static str>
where
    F: FnMut(&str) -> Option<String>,
{
    let exact = [
        ("VITE_FEAT128_S10D_RUNTIME", "true"),
        ("YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED", "true"),
        ("YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED", "true"),
        ("YIJIE_ENV", "local"),
        ("YIJIE_CHAT_LOCAL_ENABLED", "true"),
        ("YIJIE_CHAT_LOCAL_HOST_ENABLED", "true"),
        ("YIJIE_CHAT_ARTIFACTS_V3_ENABLED", "true"),
        ("YIJIE_CHAT_LOCAL_OWNER_USER_ID", OWNER),
        ("YIJIE_CHAT_LOCAL_TENANT_ID", TENANT),
        (
            "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL",
            "http://127.0.0.1:18082/v1",
        ),
    ];
    if exact
        .iter()
        .any(|(name, expected)| read(name).as_deref() != Some(*expected))
    {
        return Err("runtime_environment_invalid");
    }
    for forbidden in [
        "MINIMAX_API_KEY",
        "YIJIE_MINIMAX_API_KEY",
        "YIJIE_MODEL_PROVIDER",
        "YIJIE_PROVIDER",
        "YIJIE_API_KEY",
        "YIJIE_API_KEY_FILE",
    ] {
        if read(forbidden).is_some() {
            return Err("runtime_environment_invalid");
        }
    }
    Ok(())
}

fn exact_run_path(root: &Path, environment: &str, basename: &str) -> Result<PathBuf, &'static str> {
    let expected = root.join(basename);
    let configured = std::env::var(environment).map_err(|_| "runtime_path_invalid")?;
    if Path::new(&configured) != expected {
        return Err("runtime_path_invalid");
    }
    Ok(expected)
}

fn validate_observation(value: &RuntimeObservation) -> Result<(), &'static str> {
    validate_axe_stages(&value.ui.axe_stages)?;
    let passed = value.schema_version == 1
        && value.status == "passed"
        && value.failure_code.is_none()
        && value.production_path.production_bootstrap
        && value.production_path.production_chat_page
        && value.production_path.production_commands
        && value.production_path.single_v3
        && value.production_path.sqlcipher
        && value.production_path.history_v3
        && value.production_path.artifact_store
        && value.production_path.typed_clients
        && value.lifecycle.dom_ready_shells == 4
        && value.lifecycle.dom_kinds == 4
        && value.ui.axe_serious_critical == 0
        && value.ui.focus_order
        && value.ui.axe_stages
            == [
                "axe_script_loaded",
                "axe_nonce_consumed",
                "axe_bootstrap_started",
                "axe_import_resolved",
                "axe_run_resolved",
            ];
    let failed = value.schema_version == 1
        && value.status == "failed"
        && value
            .failure_code
            .as_deref()
            .is_some_and(valid_failure_code)
        && !value.production_path.production_bootstrap
        && !value.production_path.production_chat_page
        && !value.production_path.production_commands
        && !value.production_path.single_v3
        && !value.production_path.sqlcipher
        && !value.production_path.history_v3
        && !value.production_path.artifact_store
        && !value.production_path.typed_clients
        && value.lifecycle.dom_ready_shells <= 4
        && value.lifecycle.dom_kinds <= 4
        && value.ui.axe_serious_critical == -1
        && !value.ui.focus_order;
    if passed || failed {
        Ok(())
    } else {
        Err("runtime_observation_invalid")
    }
}

fn validate_axe_stages<T: AsRef<str>>(value: &[T]) -> Result<(), &'static str> {
    if value.len() > 5 {
        return Err("runtime_observation_invalid");
    }
    let stages = value.iter().map(AsRef::as_ref).collect::<Vec<_>>();
    match stages.as_slice() {
        []
        | ["axe_script_error"]
        | ["axe_script_loaded"]
        | ["axe_script_loaded", "axe_nonce_consumed"]
        | ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started"]
        | ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started", "axe_import_rejected"]
        | ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started", "axe_import_resolved"]
        | ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started", "axe_import_resolved", "axe_run_rejected" | "axe_run_resolved"] => {
            Ok(())
        }
        _ => Err("runtime_observation_invalid"),
    }
}

fn valid_failure_code(value: &str) -> bool {
    value.starts_with("runtime_")
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn atomic_private_json(path: &Path, value: &impl Serialize) -> Result<(), &'static str> {
    if fs::symlink_metadata(path).is_ok() {
        return Err("runtime_output_exists");
    }
    let temporary = path.with_extension("tmp");
    if fs::symlink_metadata(&temporary).is_ok() {
        return Err("runtime_output_exists");
    }
    let encoded = serde_json::to_vec(value).map_err(|_| "runtime_output_invalid")?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| "runtime_output_invalid")?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "runtime_output_invalid")?;
    fs::rename(&temporary, path).map_err(|_| "runtime_output_invalid")?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "runtime_output_invalid")?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn window_number(window: &WebviewWindow) -> Result<isize, &'static str> {
    use objc2::{msg_send, runtime::AnyObject};
    let pointer = window.ns_window().map_err(|_| "runtime_window_invalid")?;
    let object = pointer.cast::<AnyObject>();
    let number: isize = unsafe { msg_send![object, windowNumber] };
    (number > 0)
        .then_some(number)
        .ok_or("runtime_window_invalid")
}

#[cfg(not(target_os = "macos"))]
fn window_number(_window: &WebviewWindow) -> Result<isize, &'static str> {
    Err("runtime_window_invalid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn valid_environment() -> HashMap<&'static str, String> {
        HashMap::from([
            ("VITE_FEAT128_S10D_RUNTIME", "true".to_owned()),
            ("YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED", "true".to_owned()),
            ("YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED", "true".to_owned()),
            ("YIJIE_ENV", "local".to_owned()),
            ("YIJIE_CHAT_LOCAL_ENABLED", "true".to_owned()),
            ("YIJIE_CHAT_LOCAL_HOST_ENABLED", "true".to_owned()),
            ("YIJIE_CHAT_ARTIFACTS_V3_ENABLED", "true".to_owned()),
            ("YIJIE_CHAT_LOCAL_OWNER_USER_ID", OWNER.to_owned()),
            ("YIJIE_CHAT_LOCAL_TENANT_ID", TENANT.to_owned()),
            (
                "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL",
                "http://127.0.0.1:18082/v1".to_owned(),
            ),
        ])
    }

    #[test]
    fn exact_profile_is_keyless_and_fail_closed() {
        let values = valid_environment();
        assert_eq!(
            validate_environment(|name| values.get(name).cloned()),
            Ok(())
        );
        let mut missing = values.clone();
        missing.remove("YIJIE_CHAT_ARTIFACTS_V3_ENABLED");
        assert_eq!(
            validate_environment(|name| missing.get(name).cloned()),
            Err("runtime_environment_invalid")
        );
        let mut provider = values;
        provider.insert("YIJIE_MODEL_PROVIDER", "synthetic".to_owned());
        assert_eq!(
            validate_environment(|name| provider.get(name).cloned()),
            Err("runtime_environment_invalid")
        );
    }

    #[test]
    fn stages_are_closed_and_monotonic() {
        let root = std::env::temp_dir().join(format!("feat128-s10d-{}", uuid::Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let runtime = Feat128S10dRuntime {
            project_path: root.join("project"),
            result_path: root.join(RESULT_BASENAME),
            control_path: root.join(CONTROL_BASENAME),
            screenshot_ack_path: root.join(SCREENSHOT_ACK_BASENAME),
            prepared: Mutex::new(false),
            stages: Mutex::new(BTreeSet::new()),
            screenshot_sha256: Mutex::new(None),
            completed: Mutex::new(false),
        };
        assert_eq!(
            runtime.record_stage("four_shells_ready"),
            Err("runtime_checkpoint_invalid")
        );
        assert_eq!(runtime.record_stage("production_page_ready"), Ok(()));
        assert_eq!(
            runtime.record_stage("production_page_ready"),
            Err("runtime_checkpoint_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn observations_reject_unknown_outcomes() {
        let passed: RuntimeObservation = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "status": "passed",
            "failureCode": null,
            "productionPath": {
                "productionBootstrap": true,
                "productionChatPage": true,
                "productionCommands": true,
                "singleV3": true,
                "sqlcipher": true,
                "historyV3": true,
                "artifactStore": true,
                "typedClients": true
            },
            "lifecycle": {"domReadyShells": 4, "domKinds": 4},
            "ui": {
                "axeSeriousCritical": 0,
                "focusOrder": true,
                "axeStages": ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started", "axe_import_resolved", "axe_run_resolved"]
            }
        }))
        .unwrap();
        assert_eq!(validate_observation(&passed), Ok(()));
        let unknown = serde_json::from_value::<RuntimeObservation>(serde_json::json!({
            "schemaVersion": 1,
            "status": "passed",
            "failureCode": null,
            "productionPath": {
                "productionBootstrap": true,
                "productionChatPage": true,
                "productionCommands": true,
                "singleV3": true,
                "sqlcipher": true,
                "historyV3": true,
                "artifactStore": true,
                "typedClients": true
            },
            "lifecycle": {"domReadyShells": 4, "domKinds": 4},
            "ui": {
                "axeSeriousCritical": 0,
                "focusOrder": true,
                "axeStages": ["axe_script_loaded", "axe_nonce_consumed", "axe_bootstrap_started", "axe_import_resolved", "axe_run_resolved"]
            },
            "requestId": "forbidden"
        }));
        assert!(unknown.is_err());
    }

    #[test]
    fn graceful_shutdown_failure_preserves_only_bounded_lifecycle_evidence() {
        let failure = RuntimeObservation::shutdown_failure(
            RuntimeLifecycle {
                dom_ready_shells: 4,
                dom_kinds: 4,
            },
            vec![
                "axe_script_loaded".to_owned(),
                "axe_nonce_consumed".to_owned(),
                "axe_bootstrap_started".to_owned(),
            ],
        );
        assert_eq!(validate_observation(&failure), Ok(()));
        assert_eq!(
            failure.failure_code.as_deref(),
            Some("runtime_graceful_shutdown_failed")
        );
        assert_eq!(failure.lifecycle.dom_ready_shells, 4);
        assert_eq!(failure.lifecycle.dom_kinds, 4);
        assert_eq!(failure.ui.axe_serious_critical, -1);
        assert!(!failure.ui.focus_order);
        assert_eq!(
            failure.ui.axe_stages,
            [
                "axe_script_loaded",
                "axe_nonce_consumed",
                "axe_bootstrap_started"
            ]
        );
    }

    #[test]
    fn axe_stage_sequences_are_closed_bounded_and_ordered() {
        for stages in [
            vec![],
            vec!["axe_script_error"],
            vec!["axe_script_loaded"],
            vec!["axe_script_loaded", "axe_nonce_consumed"],
            vec![
                "axe_script_loaded",
                "axe_nonce_consumed",
                "axe_bootstrap_started",
                "axe_import_resolved",
                "axe_run_resolved",
            ],
        ] {
            assert_eq!(validate_axe_stages(&stages), Ok(()));
        }
        for stages in [
            vec!["axe_run_resolved"],
            vec!["axe_script_loaded", "axe_bootstrap_started"],
            vec![
                "axe_script_loaded",
                "axe_nonce_consumed",
                "axe_import_resolved",
            ],
            vec!["axe_script_loaded", "axe_script_loaded"],
            vec!["axe_script_loaded", "raw_error"],
            vec![
                "axe_script_loaded",
                "axe_script_loaded",
                "axe_script_loaded",
                "axe_script_loaded",
                "axe_script_loaded",
                "axe_script_loaded",
            ],
        ] {
            assert_eq!(
                validate_axe_stages(&stages),
                Err("runtime_observation_invalid")
            );
        }
    }

    #[test]
    fn native_lifecycle_requires_four_exact_durable_stage_transitions() {
        let mut tracker = NativeLifecycleTracker::default();
        for (ordinal, kind) in [
            ArtifactKind::Image,
            ArtifactKind::Video,
            ArtifactKind::File,
            ArtifactKind::Report,
        ]
        .into_iter()
        .enumerate()
        {
            let artifact_id = Uuid::now_v7();
            tracker
                .record(
                    artifact_id,
                    kind,
                    ordinal,
                    Feat128S10dArtifactStage::Announced,
                )
                .unwrap();
            tracker
                .record(
                    artifact_id,
                    kind,
                    ordinal,
                    Feat128S10dArtifactStage::Progress,
                )
                .unwrap();
            tracker
                .record(artifact_id, kind, ordinal, Feat128S10dArtifactStage::Ready)
                .unwrap();
        }
        assert_eq!(
            tracker.evidence(),
            NativeLifecycleEvidence {
                announced: 4,
                progress: 4,
                ready: 4,
                kinds: 4,
            }
        );
        assert_eq!(
            tracker.record(
                Uuid::now_v7(),
                ArtifactKind::Image,
                0,
                Feat128S10dArtifactStage::Ready,
            ),
            Err("runtime_native_lifecycle_invalid")
        );
    }

    #[test]
    fn lifecycle_timeout_classification_is_closed_and_layered() {
        let complete = NativeLifecycleEvidence {
            announced: 4,
            progress: 4,
            ready: 4,
            kinds: 4,
        };
        assert_eq!(
            classify_lifecycle_timeout(
                &NativeLifecycleEvidence {
                    announced: 4,
                    progress: 3,
                    ready: 2,
                    kinds: 4,
                },
                &RuntimeLifecycle {
                    dom_ready_shells: 0,
                    dom_kinds: 0,
                },
            ),
            "native_lifecycle_incomplete"
        );
        assert_eq!(
            classify_lifecycle_timeout(
                &complete,
                &RuntimeLifecycle {
                    dom_ready_shells: 3,
                    dom_kinds: 3,
                },
            ),
            "native_complete_dom_ready_incomplete"
        );
        assert_eq!(
            classify_lifecycle_timeout(
                &complete,
                &RuntimeLifecycle {
                    dom_ready_shells: 4,
                    dom_kinds: 3,
                },
            ),
            "native_complete_dom_kind_incomplete"
        );
        assert_eq!(
            classify_lifecycle_timeout(
                &complete,
                &RuntimeLifecycle {
                    dom_ready_shells: 4,
                    dom_kinds: 4,
                },
            ),
            "lifecycle_complete_finish_failed"
        );
    }

    #[test]
    fn closing_tracker_clears_and_deactivates_all_evidence() {
        let mut tracker = NativeLifecycleTracker {
            active: true,
            ..NativeLifecycleTracker::default()
        };
        tracker
            .record(
                Uuid::now_v7(),
                ArtifactKind::Image,
                0,
                Feat128S10dArtifactStage::Announced,
            )
            .unwrap();
        tracker.close();
        assert!(!tracker.active);
        assert_eq!(tracker.evidence(), NativeLifecycleEvidence::default());
    }
}
