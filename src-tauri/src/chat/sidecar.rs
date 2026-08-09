use super::error::ChatError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const FEAT126_FAKE_RESPONSES_BASE_URL: &str = "http://127.0.0.1:18082/v1";
const MAX_CHILD_LOG_BYTES: u64 = 256 << 10;

#[derive(Clone, Debug, PartialEq, Eq)]
struct FEAT126TestProfile {
    run_id: String,
    fake_responses_base_url: String,
    run_root: PathBuf,
}

#[derive(Clone)]
pub struct SidecarConfig {
    binary: PathBuf,
    host_home: PathBuf,
    port: u16,
    codex_binary: Option<PathBuf>,
    codex_manifest: Option<PathBuf>,
    codex_home: Option<PathBuf>,
    test_profile: Option<FEAT126TestProfile>,
}

impl SidecarConfig {
    pub fn from_environment() -> Result<Option<Self>, ChatError> {
        if std::env::var("YIJIE_CHAT_LOCAL_HOST_ENABLED").as_deref() != Ok("true") {
            if std::env::var("YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED").as_deref() == Ok("true")
                || std::env::var("YIJIE_FEAT126_S10_RUN_ID").is_ok()
                || std::env::var("YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL").is_ok()
                || std::env::var("YIJIE_FEAT126_S10_RUN_ROOT").is_ok()
            {
                return Err(ChatError::InvalidConfiguration);
            }
            return Ok(None);
        }
        if std::env::var("YIJIE_ENV").as_deref() != Ok("local") {
            return Err(ChatError::InvalidConfiguration);
        }
        let binary = required_absolute_file("YIJIE_AGENT_HOST_BINARY")?;
        let host_home = required_absolute_directory("YIJIE_AGENT_HOST_HOME")?;
        let port = std::env::var("YIJIE_AGENT_HOST_PORT")
            .map_err(|_| ChatError::InvalidConfiguration)?
            .parse::<u16>()
            .map_err(|_| ChatError::InvalidConfiguration)?;
        if port == 0 {
            return Err(ChatError::InvalidConfiguration);
        }
        let codex_binary = optional_absolute_file("YIJIE_CODEX_BINARY")?;
        let codex_manifest = optional_absolute_regular_file("YIJIE_CODEX_MANIFEST")?;
        let codex_home = optional_absolute_directory("YIJIE_CODEX_HOME")?;
        let configured_count = [
            codex_binary.is_some(),
            codex_manifest.is_some(),
            codex_home.is_some(),
        ]
        .into_iter()
        .filter(|configured| *configured)
        .count();
        if configured_count != 0 && configured_count != 3 {
            return Err(ChatError::InvalidConfiguration);
        }
        if codex_home.as_ref() == Some(&host_home) {
            return Err(ChatError::InvalidConfiguration);
        }
        let test_profile = load_feat126_test_profile()?;
        let secure_storage =
            std::env::var("YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED").unwrap_or_default();
        let ephemeral_storage =
            std::env::var("YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED").unwrap_or_default();
        if !matches!(secure_storage.as_str(), "" | "false" | "true")
            || !matches!(ephemeral_storage.as_str(), "" | "false" | "true")
        {
            return Err(ChatError::InvalidConfiguration);
        }
        if secure_storage == "true" || ephemeral_storage == "true" {
            let secure_storage =
                crate::feat126_secure_storage::Feat126SecureStorageProfile::from_environment()
                    .map_err(|_| ChatError::InvalidConfiguration)?
                    .ok_or(ChatError::InvalidConfiguration)?;
            secure_storage
                .validate_child_homes(&host_home, codex_home.as_deref())
                .map_err(|_| ChatError::InvalidConfiguration)?;
        }
        Ok(Some(Self {
            binary,
            host_home,
            port,
            codex_binary,
            codex_manifest,
            codex_home,
            test_profile,
        }))
    }

    fn endpoint(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    fn environment(
        &self,
        instance_nonce: &str,
        log_directory: Option<&Path>,
        process_manifest: Option<&Path>,
    ) -> Vec<(&'static str, String)> {
        let test_enabled = self.test_profile.is_some();
        let mut values = vec![
            ("YIJIE_ENV", "local".to_owned()),
            ("YIJIE_AGENT_HOST_PORT", self.port.to_string()),
            (
                "YIJIE_AGENT_HOST_HOME",
                self.host_home.to_string_lossy().into_owned(),
            ),
            (
                "YIJIE_AGENT_HOST_V2_RAW_REASONING_ENABLED",
                test_enabled.to_string(),
            ),
            ("YIJIE_AGENT_HOST_V2_TITLE_ENABLED", "false".to_owned()),
            (
                "YIJIE_AGENT_HOST_V2_CLEANUP_ENABLED",
                test_enabled.to_string(),
            ),
            ("YIJIE_AGENT_HOST_INSTANCE_NONCE", instance_nonce.to_owned()),
            ("PATH", "/usr/bin:/bin".to_owned()),
        ];
        if let Some(profile) = &self.test_profile {
            values.extend([
                ("YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED", "true".to_owned()),
                ("YIJIE_FEAT126_S10_RUN_ID", profile.run_id.clone()),
                (
                    "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL",
                    profile.fake_responses_base_url.clone(),
                ),
                (
                    "YIJIE_FEAT126_S10_PARENT_PID",
                    std::process::id().to_string(),
                ),
                (
                    "YIJIE_FEAT126_S10_HOST_LOG_DIR",
                    log_directory
                        .expect("test profile log directory is prepared")
                        .to_string_lossy()
                        .into_owned(),
                ),
                (
                    "YIJIE_FEAT126_S10_PROCESS_MANIFEST",
                    process_manifest
                        .expect("test profile process manifest is prepared")
                        .to_string_lossy()
                        .into_owned(),
                ),
            ]);
        }
        if let Some(value) = &self.codex_binary {
            values.push(("YIJIE_CODEX_BINARY", value.to_string_lossy().into_owned()));
        }
        if let Some(value) = &self.codex_manifest {
            values.push(("YIJIE_CODEX_MANIFEST", value.to_string_lossy().into_owned()));
        }
        if let Some(value) = &self.codex_home {
            values.push(("YIJIE_CODEX_HOME", value.to_string_lossy().into_owned()));
        }
        values
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidecarState {
    Disabled,
    Stopped,
    Starting,
    HostLive,
    RuntimeReady,
    Failed,
}

struct SupervisorState {
    state: SidecarState,
    child: Option<Child>,
    child_identity: Option<OwnedProcessIdentity>,
    instance_nonce: Option<String>,
    capture: Option<ProcessCapture>,
    cleanup_unknown: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OwnedProcessIdentity {
    pid: u32,
    ppid: u32,
    binary: PathBuf,
    process_binary: PathBuf,
    binary_sha256: String,
    instance_nonce: String,
    start_time_seconds: u64,
    start_time_microseconds: u64,
}

enum SpawnIdentityOutcome {
    Owned(OwnedProcessIdentity),
    Exited(ExitStatus),
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessEvidence {
    schema_version: u32,
    run_id: String,
    role: String,
    pid: Option<u32>,
    ppid: u32,
    binary_sha256: String,
    instance_nonce: String,
    started_at_unix_ms: u64,
    ended_at_unix_ms: Option<u64>,
    state: String,
    exit_code: Option<i32>,
    stdout_bytes: u64,
    stderr_bytes: u64,
    stdout_truncated: bool,
    stderr_truncated: bool,
    log_limit_bytes: u64,
}

struct ProcessCapture {
    stdout_task: JoinHandle<LogCaptureResult>,
    stderr_task: JoinHandle<LogCaptureResult>,
    evidence_path: PathBuf,
    evidence: ProcessEvidence,
}

struct PreparedCapture {
    log_directory: PathBuf,
    process_manifest: PathBuf,
    stdout_file: File,
    stderr_file: File,
    evidence: ProcessEvidence,
}

#[derive(Default)]
struct LogCaptureResult {
    bytes: u64,
    truncated: bool,
}

#[derive(Clone)]
pub(super) struct HostConnection {
    pub(super) port: u16,
    pub(super) token_path: PathBuf,
    pub(super) instance_nonce: String,
}

pub struct SidecarSupervisor {
    config: Option<SidecarConfig>,
    client: reqwest::Client,
    inner: Mutex<SupervisorState>,
}

impl SidecarSupervisor {
    pub fn from_environment() -> Result<Self, ChatError> {
        let config = SidecarConfig::from_environment()?;
        let state = if config.is_some() {
            SidecarState::Stopped
        } else {
            SidecarState::Disabled
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_millis(250))
            .timeout(Duration::from_millis(500))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ChatError::InvalidConfiguration)?;
        Ok(Self {
            config,
            client,
            inner: Mutex::new(SupervisorState {
                state,
                child: None,
                child_identity: None,
                instance_nonce: None,
                capture: None,
                cleanup_unknown: false,
            }),
        })
    }

    pub async fn status(&self) -> SidecarState {
        self.refresh_child_state().await;
        self.inner.lock().await.state
    }

    pub async fn start(&self) -> Result<SidecarState, ChatError> {
        let config = self.config.as_ref().ok_or(ChatError::Disabled)?;
        self.refresh_child_state().await;
        let mut state = self.inner.lock().await;
        if state.cleanup_unknown {
            return Err(ChatError::CleanupIncomplete);
        }
        if state.state == SidecarState::RuntimeReady {
            return Ok(state.state);
        }
        if state.child.is_some() {
            return Err(ChatError::SidecarUnavailable);
        }
        state.state = SidecarState::Starting;
        let instance_nonce = match generate_instance_nonce(config.test_profile.is_some()) {
            Ok(nonce) => nonce,
            Err(error) => {
                state.state = SidecarState::Failed;
                return Err(error);
            }
        };
        let binary_sha256 = file_sha256(&config.binary)?;
        let prepared = if config.test_profile.is_some() {
            Some(prepare_capture(config, &instance_nonce)?)
        } else {
            None
        };
        let mut command = Command::new(&config.binary);
        command
            .env_clear()
            .envs(
                config.environment(
                    &instance_nonce,
                    prepared
                        .as_ref()
                        .map(|capture| capture.log_directory.as_path()),
                    prepared
                        .as_ref()
                        .map(|capture| capture.process_manifest.as_path()),
                ),
            )
            .stdin(Stdio::null())
            .kill_on_drop(true);
        if prepared.is_some() {
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
        } else {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                if let Some(mut capture) = prepared {
                    capture.evidence.state = "spawn_failed".to_owned();
                    capture.evidence.ended_at_unix_ms = Some(now_unix_ms());
                    let _ = write_process_evidence(&capture.process_manifest, &capture.evidence);
                }
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
        };
        let child_pid = child.id().ok_or(ChatError::SidecarUnavailable)?;
        let capture = if let Some(mut prepared) = prepared {
            prepared.evidence.pid = child.id();
            prepared.evidence.state = "starting".to_owned();
            write_process_evidence(&prepared.process_manifest, &prepared.evidence)?;
            let stdout = child.stdout.take().ok_or(ChatError::SidecarUnavailable)?;
            let stderr = child.stderr.take().ok_or(ChatError::SidecarUnavailable)?;
            Some(ProcessCapture {
                stdout_task: tokio::spawn(capture_bounded_log(stdout, prepared.stdout_file)),
                stderr_task: tokio::spawn(capture_bounded_log(stderr, prepared.stderr_file)),
                evidence_path: prepared.process_manifest,
                evidence: prepared.evidence,
            })
        } else {
            None
        };
        state.child = Some(child);
        state.instance_nonce = Some(instance_nonce.clone());
        state.capture = capture;
        let child_identity = match observe_spawn_identity(
            state
                .child
                .as_mut()
                .expect("spawned child is retained until identity capture"),
            child_pid,
            &config.binary,
            &binary_sha256,
            &instance_nonce,
        )
        .await
        {
            SpawnIdentityOutcome::Owned(identity) => identity,
            SpawnIdentityOutcome::Exited(exit_status) => {
                state.child = None;
                state.instance_nonce = None;
                finalize_capture(&mut state, Some(exit_status), "exited_during_startup").await;
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
            SpawnIdentityOutcome::Unknown => {
                retain_unknown_child(&mut state, "spawn_identity_unknown");
                return Err(ChatError::CleanupIncomplete);
            }
        };
        state.child_identity = Some(child_identity);
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
        loop {
            let child_status = match state.child.as_mut() {
                Some(child) => child.try_wait(),
                None => Ok(None),
            };
            match child_status {
                Ok(Some(exit_status)) => {
                    state.child = None;
                    state.child_identity = None;
                    state.instance_nonce = None;
                    finalize_capture(&mut state, Some(exit_status), "exited_during_startup").await;
                    state.state = SidecarState::Failed;
                    return Err(ChatError::SidecarUnavailable);
                }
                Err(_) => {
                    retain_unknown_child(&mut state, "startup_status_unknown");
                    return Err(ChatError::CleanupIncomplete);
                }
                Ok(None) => {}
            }
            if self.liveness(config, &instance_nonce).await {
                state.state = SidecarState::HostLive;
                if self.runtime_ready(config, &instance_nonce).await {
                    if let Some(capture) = state.capture.as_mut() {
                        capture.evidence.state = "ready".to_owned();
                        write_process_evidence(&capture.evidence_path, &capture.evidence)?;
                    }
                    state.state = SidecarState::RuntimeReady;
                    return Ok(state.state);
                }
            }
            if tokio::time::Instant::now() >= deadline {
                let identity = state.child_identity.clone();
                let exit_status = match (state.child.as_mut(), identity.as_ref()) {
                    (Some(child), Some(identity)) => terminate_child(child, identity).await,
                    _ => None,
                };
                if exit_status.is_none() && state.child.is_some() {
                    retain_unknown_child(&mut state, "startup_timeout_cleanup_unknown");
                    return Err(ChatError::CleanupIncomplete);
                }
                state.child = None;
                state.child_identity = None;
                state.instance_nonce = None;
                finalize_capture(&mut state, exit_status, "startup_timeout").await;
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    pub async fn stop(&self) -> Result<SidecarState, ChatError> {
        let mut state = self.inner.lock().await;
        if state.cleanup_unknown {
            return Err(ChatError::CleanupIncomplete);
        }
        let identity = state.child_identity.clone();
        let had_child = state.child.is_some();
        let exit_status = match (state.child.as_mut(), identity.as_ref()) {
            (Some(child), Some(identity)) => terminate_child(child, identity).await,
            _ => None,
        };
        if had_child && exit_status.is_none() {
            retain_unknown_child(&mut state, "stop_outcome_unknown");
            return Err(ChatError::CleanupIncomplete);
        }
        state.child = None;
        state.child_identity = None;
        state.instance_nonce = None;
        finalize_capture(&mut state, exit_status, "stopped").await;
        state.state = if self.config.is_some() {
            SidecarState::Stopped
        } else {
            SidecarState::Disabled
        };
        Ok(state.state)
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub async fn stop_strict_for_driver(&self) -> Result<SidecarState, ChatError> {
        let mut state = self.inner.lock().await;
        if state.cleanup_unknown {
            return Err(ChatError::CleanupIncomplete);
        }
        let had_child = state.child.is_some();
        let identity = state.child_identity.clone();
        let exit_status = match (state.child.as_mut(), identity.as_ref()) {
            (Some(child), Some(identity)) => terminate_child(child, identity).await,
            _ => None,
        };
        if !strict_driver_stop_outcome_known(had_child, exit_status.as_ref()) {
            retain_unknown_child(&mut state, "stop_outcome_unknown");
            return Err(ChatError::CleanupIncomplete);
        }
        state.child = None;
        state.child_identity = None;
        state.instance_nonce = None;
        finalize_capture(&mut state, exit_status, "stopped").await;
        state.state = if self.config.is_some() {
            SidecarState::Stopped
        } else {
            SidecarState::Disabled
        };
        Ok(state.state)
    }

    pub(super) async fn connection(&self) -> Result<HostConnection, ChatError> {
        let config = self.config.as_ref().ok_or(ChatError::Disabled)?;
        self.refresh_child_state().await;
        let state = self.inner.lock().await;
        if state.state != SidecarState::RuntimeReady || state.child.is_none() {
            return Err(ChatError::SidecarUnavailable);
        }
        let instance_nonce = state
            .instance_nonce
            .clone()
            .ok_or(ChatError::SidecarUnavailable)?;
        Ok(HostConnection {
            port: config.port,
            token_path: config.host_home.join("api-token"),
            instance_nonce,
        })
    }

    async fn refresh_child_state(&self) {
        let mut state = self.inner.lock().await;
        let child_status = match state.child.as_mut() {
            Some(child) => child.try_wait(),
            None => Ok(None),
        };
        match child_status {
            Ok(Some(exit_status)) => {
                state.child = None;
                state.child_identity = None;
                state.instance_nonce = None;
                finalize_capture(&mut state, Some(exit_status), "unexpected_exit").await;
                state.state = SidecarState::Failed;
            }
            Err(_) => retain_unknown_child(&mut state, "status_unknown"),
            Ok(None) => {}
        }
    }

    async fn liveness(&self, config: &SidecarConfig, instance_nonce: &str) -> bool {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct HealthResponse {
            service: String,
            status: String,
        }

        let Ok(response) = self.client.get(config.endpoint("/healthz")).send().await else {
            return false;
        };
        if !valid_instance_response(&response, instance_nonce) || !response.status().is_success() {
            return false;
        }
        let Ok(body) = response.bytes().await else {
            return false;
        };
        if body.len() > 1024 {
            return false;
        }
        serde_json::from_slice::<HealthResponse>(&body)
            .is_ok_and(|health| health.service == "yijie-agent-host" && health.status == "ok")
    }

    async fn runtime_ready(&self, config: &SidecarConfig, instance_nonce: &str) -> bool {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ReadyResponse {
            status: String,
            runtime_state: String,
        }

        let Ok(response) = self.client.get(config.endpoint("/readyz")).send().await else {
            return false;
        };
        if !valid_instance_response(&response, instance_nonce) || !response.status().is_success() {
            return false;
        }
        let Ok(body) = response.bytes().await else {
            return false;
        };
        if body.len() > 1024 {
            return false;
        }
        serde_json::from_slice::<ReadyResponse>(&body)
            .is_ok_and(|ready| ready.status == "ready" && ready.runtime_state == "ready")
    }
}

fn generate_instance_nonce(test_profile: bool) -> Result<String, ChatError> {
    if !test_profile {
        return Ok(uuid::Uuid::now_v7().to_string());
    }

    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| ChatError::SidecarUnavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(uuid::Uuid::from_bytes(bytes).to_string())
}

#[cfg(feature = "feat126-s10-driver")]
fn strict_driver_stop_outcome_known(had_child: bool, exit_status: Option<&ExitStatus>) -> bool {
    !had_child || exit_status.is_some()
}

fn valid_instance_response(response: &reqwest::Response, instance_nonce: &str) -> bool {
    response
        .headers()
        .get("X-Yijie-Host-Instance-Nonce")
        .and_then(|value| value.to_str().ok())
        == Some(instance_nonce)
        && response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"))
        && response
            .content_length()
            .is_some_and(|length| length <= 1024)
}

async fn terminate_child(child: &mut Child, expected: &OwnedProcessIdentity) -> Option<ExitStatus> {
    match child.try_wait() {
        Ok(Some(status)) => return Some(status),
        Ok(None) => {}
        Err(_) => return None,
    }
    if child.id() != Some(expected.pid)
        || owned_process_identity_matches(expected).ok() != Some(true)
        || unsafe { libc::kill(expected.pid as i32, libc::SIGTERM) } != 0
    {
        return None;
    }
    match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
        Ok(Ok(status)) => Some(status),
        Ok(Err(_)) => None,
        Err(_) => {
            match child.try_wait() {
                Ok(Some(status)) => return Some(status),
                Ok(None) => {}
                Err(_) => return None,
            }
            if child.id() != Some(expected.pid)
                || owned_process_identity_matches(expected).ok() != Some(true)
                || child.start_kill().is_err()
            {
                return None;
            }
            tokio::time::timeout(Duration::from_secs(3), child.wait())
                .await
                .ok()
                .and_then(Result::ok)
        }
    }
}

fn retain_unknown_child(state: &mut SupervisorState, final_state: &str) {
    if let Some(child) = state.child.take() {
        std::mem::forget(child);
    }
    state.child_identity = None;
    state.instance_nonce = None;
    state.cleanup_unknown = true;
    state.state = SidecarState::Failed;
    if let Some(mut capture) = state.capture.take() {
        capture.stdout_task.abort();
        capture.stderr_task.abort();
        capture.evidence.state = final_state.to_owned();
        let _ = write_process_evidence(&capture.evidence_path, &capture.evidence);
    }
}

fn owned_process_identity_matches(expected: &OwnedProcessIdentity) -> Result<bool, ()> {
    if expected.pid <= 1 || expected.pid > i32::MAX as u32 {
        return Err(());
    }
    let (ppid, start_time_seconds, start_time_microseconds) = process_start_identity(expected.pid)?;
    let binary = process_binary_path(expected.pid)?;
    let binary_sha256 = file_sha256(&expected.binary).map_err(|_| ())?;
    Ok(owned_process_identity_fields_match(
        expected,
        ppid,
        &binary,
        &binary_sha256,
        start_time_seconds,
        start_time_microseconds,
    ))
}

fn capture_owned_process_identity(
    pid: u32,
    expected_binary: &Path,
    expected_binary_sha256: &str,
    instance_nonce: &str,
) -> Result<OwnedProcessIdentity, ()> {
    if pid <= 1 || pid > i32::MAX as u32 {
        return Err(());
    }
    let (ppid, start_time_seconds, start_time_microseconds) = process_start_identity(pid)?;
    let process_binary = process_binary_path(pid)?;
    if ppid != std::process::id()
        || process_binary != expected_binary
        || start_time_seconds == 0
        || !uuid::Uuid::parse_str(instance_nonce).is_ok_and(|nonce| !nonce.is_nil())
    {
        return Err(());
    }
    Ok(OwnedProcessIdentity {
        pid,
        ppid,
        binary: expected_binary.to_path_buf(),
        process_binary,
        binary_sha256: expected_binary_sha256.to_owned(),
        instance_nonce: instance_nonce.to_owned(),
        start_time_seconds,
        start_time_microseconds,
    })
}

async fn observe_spawn_identity(
    child: &mut Child,
    pid: u32,
    expected_binary: &Path,
    expected_binary_sha256: &str,
    instance_nonce: &str,
) -> SpawnIdentityOutcome {
    let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(exit_status)) => return SpawnIdentityOutcome::Exited(exit_status),
            Err(_) => return SpawnIdentityOutcome::Unknown,
            Ok(None) => {}
        }
        if let Ok(identity) = capture_owned_process_identity(
            pid,
            expected_binary,
            expected_binary_sha256,
            instance_nonce,
        ) {
            return SpawnIdentityOutcome::Owned(identity);
        }
        if tokio::time::Instant::now() >= deadline {
            return SpawnIdentityOutcome::Unknown;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn owned_process_identity_fields_match(
    expected: &OwnedProcessIdentity,
    ppid: u32,
    process_binary: &Path,
    binary_sha256: &str,
    start_time_seconds: u64,
    start_time_microseconds: u64,
) -> bool {
    ppid == expected.ppid
        && process_binary == expected.process_binary
        && binary_sha256 == expected.binary_sha256
        && expected.start_time_seconds != 0
        && start_time_seconds == expected.start_time_seconds
        && start_time_microseconds == expected.start_time_microseconds
        && uuid::Uuid::parse_str(&expected.instance_nonce).is_ok_and(|nonce| !nonce.is_nil())
}

#[cfg(target_os = "macos")]
fn process_binary_path(pid: u32) -> Result<PathBuf, ()> {
    const MAX_PATH_BYTES: usize = 4096;
    let mut buffer = vec![0_u8; MAX_PATH_BYTES];
    let length = unsafe {
        libc::proc_pidpath(
            pid as libc::c_int,
            buffer.as_mut_ptr().cast(),
            MAX_PATH_BYTES as u32,
        )
    };
    if length <= 0 || length as usize >= buffer.len() {
        return Err(());
    }
    buffer.truncate(length as usize);
    let path = std::str::from_utf8(&buffer).map_err(|_| ())?;
    fs::canonicalize(path).map_err(|_| ())
}

#[cfg(not(target_os = "macos"))]
fn process_binary_path(pid: u32) -> Result<PathBuf, ()> {
    fs::canonicalize(format!("/proc/{pid}/exe")).map_err(|_| ())
}

#[cfg(target_os = "macos")]
fn process_start_identity(pid: u32) -> Result<(u32, u64, u64), ()> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let expected_size = std::mem::size_of::<libc::proc_bsdinfo>();
    let actual_size = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            expected_size as libc::c_int,
        )
    };
    if actual_size != expected_size as libc::c_int {
        return Err(());
    }
    let info = unsafe { info.assume_init() };
    if info.pbi_pid != pid || info.pbi_ppid == 0 || info.pbi_start_tvsec == 0 {
        return Err(());
    }
    Ok((info.pbi_ppid, info.pbi_start_tvsec, info.pbi_start_tvusec))
}

#[cfg(not(target_os = "macos"))]
fn process_start_identity(pid: u32) -> Result<(u32, u64, u64), ()> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|_| ())?;
    let fields = stat
        .rsplit_once(')')
        .ok_or(())?
        .1
        .split_whitespace()
        .collect::<Vec<_>>();
    let ppid = fields.get(1).ok_or(())?.parse::<u32>().map_err(|_| ())?;
    let start_ticks = fields.get(19).ok_or(())?.parse::<u64>().map_err(|_| ())?;
    if ppid == 0 || start_ticks == 0 {
        return Err(());
    }
    Ok((ppid, start_ticks, 0))
}

fn load_feat126_test_profile() -> Result<Option<FEAT126TestProfile>, ChatError> {
    const MASTER: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
    const RUN_ID: &str = "YIJIE_FEAT126_S10_RUN_ID";
    const BASE_URL: &str = "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL";
    const RUN_ROOT: &str = "YIJIE_FEAT126_S10_RUN_ROOT";
    let master = std::env::var(MASTER).unwrap_or_default();
    let run_id = std::env::var(RUN_ID).unwrap_or_default();
    let base_url = std::env::var(BASE_URL).unwrap_or_default();
    let run_root = std::env::var(RUN_ROOT).unwrap_or_default();
    validate_feat126_test_profile_values(&master, &run_id, &base_url, &run_root)
}

fn validate_feat126_test_profile_values(
    master: &str,
    run_id: &str,
    base_url: &str,
    run_root: &str,
) -> Result<Option<FEAT126TestProfile>, ChatError> {
    if master != "true" {
        if (!master.is_empty() && master != "false")
            || !run_id.is_empty()
            || !base_url.is_empty()
            || !run_root.is_empty()
        {
            return Err(ChatError::InvalidConfiguration);
        }
        return Ok(None);
    }
    let parsed = uuid::Uuid::parse_str(run_id).map_err(|_| ChatError::InvalidConfiguration)?;
    if parsed.is_nil()
        || parsed.to_string() != run_id
        || base_url != FEAT126_FAKE_RESPONSES_BASE_URL
    {
        return Err(ChatError::InvalidConfiguration);
    }
    let run_root = validate_directory(Path::new(run_root))?;
    recover_stale_process_evidence(&run_root, run_id)?;
    Ok(Some(FEAT126TestProfile {
        run_id: run_id.to_owned(),
        fake_responses_base_url: base_url.to_owned(),
        run_root,
    }))
}

fn prepare_capture(
    config: &SidecarConfig,
    instance_nonce: &str,
) -> Result<PreparedCapture, ChatError> {
    let profile = config
        .test_profile
        .as_ref()
        .ok_or(ChatError::InvalidConfiguration)?;
    let host_root = create_private_directory(&profile.run_root.join("host"))?;
    let log_directory = create_private_directory(&host_root.join(instance_nonce))?;
    let stdout_file = create_private_file(&log_directory.join("stdout.log"))?;
    let stderr_file = create_private_file(&log_directory.join("stderr.log"))?;
    let process_manifest = log_directory.join("process.json");
    let evidence = ProcessEvidence {
        schema_version: 1,
        run_id: profile.run_id.clone(),
        role: "agent_host_child".to_owned(),
        pid: None,
        ppid: std::process::id(),
        binary_sha256: file_sha256(&config.binary)?,
        instance_nonce: instance_nonce.to_owned(),
        started_at_unix_ms: now_unix_ms(),
        ended_at_unix_ms: None,
        state: "prepared".to_owned(),
        exit_code: None,
        stdout_bytes: 0,
        stderr_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        log_limit_bytes: MAX_CHILD_LOG_BYTES,
    };
    write_process_evidence(&process_manifest, &evidence)?;
    Ok(PreparedCapture {
        log_directory,
        process_manifest,
        stdout_file,
        stderr_file,
        evidence,
    })
}

fn create_private_directory(path: &Path) -> Result<PathBuf, ChatError> {
    match fs::create_dir(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ChatError::InvalidConfiguration)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(ChatError::InvalidConfiguration),
    }
    validate_directory(path)
}

fn create_private_file(path: &Path) -> Result<File, ChatError> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| ChatError::InvalidConfiguration)
}

fn file_sha256(path: &Path) -> Result<String, ChatError> {
    let mut file = File::open(path).map_err(|_| ChatError::InvalidConfiguration)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 << 10];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| ChatError::InvalidConfiguration)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn capture_bounded_log<R>(mut reader: R, mut file: File) -> LogCaptureResult
where
    R: AsyncRead + Unpin,
{
    let mut result = LogCaptureResult::default();
    let mut buffer = [0_u8; 8 << 10];
    loop {
        let count = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => {
                result.truncated = true;
                break;
            }
        };
        let remaining = MAX_CHILD_LOG_BYTES.saturating_sub(result.bytes) as usize;
        let write_count = count.min(remaining);
        if write_count > 0 {
            if file.write_all(&buffer[..write_count]).is_err() {
                result.truncated = true;
                break;
            }
            result.bytes += write_count as u64;
        }
        if write_count < count {
            result.truncated = true;
        }
    }
    let _ = file.sync_all();
    result
}

async fn finalize_capture(
    state: &mut SupervisorState,
    exit_status: Option<ExitStatus>,
    final_state: &str,
) {
    let Some(mut capture) = state.capture.take() else {
        return;
    };
    let stdout = capture.stdout_task.await.unwrap_or_default();
    let stderr = capture.stderr_task.await.unwrap_or_default();
    capture.evidence.ended_at_unix_ms = Some(now_unix_ms());
    capture.evidence.state = final_state.to_owned();
    capture.evidence.exit_code = exit_status.and_then(|status| status.code());
    capture.evidence.stdout_bytes = stdout.bytes;
    capture.evidence.stderr_bytes = stderr.bytes;
    capture.evidence.stdout_truncated = stdout.truncated;
    capture.evidence.stderr_truncated = stderr.truncated;
    let _ = write_process_evidence(&capture.evidence_path, &capture.evidence);
}

fn write_process_evidence(path: &Path, evidence: &ProcessEvidence) -> Result<(), ChatError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
        {
            return Err(ChatError::InvalidConfiguration);
        }
    }
    let content = serde_json::to_vec(evidence).map_err(|_| ChatError::InvalidConfiguration)?;
    let temporary = path.with_extension(format!("json.tmp.{}", uuid::Uuid::now_v7()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| ChatError::InvalidConfiguration)?;
    if file
        .write_all(&content)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&temporary);
        return Err(ChatError::InvalidConfiguration);
    }
    if fs::rename(&temporary, path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(ChatError::InvalidConfiguration);
    }
    Ok(())
}

fn recover_stale_process_evidence(run_root: &Path, run_id: &str) -> Result<(), ChatError> {
    let host_root = run_root.join("host");
    let Ok(entries) = fs::read_dir(&host_root) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry.map_err(|_| ChatError::InvalidConfiguration)?;
        let directory = validate_directory(&entry.path())?;
        let path = directory.join("process.json");
        let Ok(content) = fs::read(&path) else {
            continue;
        };
        if content.len() > 16 << 10 {
            return Err(ChatError::InvalidConfiguration);
        }
        let mut evidence: ProcessEvidence =
            serde_json::from_slice(&content).map_err(|_| ChatError::InvalidConfiguration)?;
        if evidence.run_id != run_id || evidence.schema_version != 1 {
            return Err(ChatError::InvalidConfiguration);
        }
        if evidence.ended_at_unix_ms.is_some() {
            continue;
        }
        if let Some(pid) = evidence.pid {
            let result = unsafe { libc::kill(pid as i32, 0) };
            if result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                return Err(ChatError::SidecarUnavailable);
            }
        }
        evidence.state = "stale_after_restart".to_owned();
        evidence.ended_at_unix_ms = Some(now_unix_ms());
        write_process_evidence(&path, &evidence)?;
    }
    Ok(())
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn required_absolute_file(name: &str) -> Result<PathBuf, ChatError> {
    let value = std::env::var(name).map_err(|_| ChatError::InvalidConfiguration)?;
    validate_executable(Path::new(&value))
}

fn optional_absolute_file(name: &str) -> Result<Option<PathBuf>, ChatError> {
    match std::env::var(name) {
        Ok(value) if !value.is_empty() => validate_executable(Path::new(&value)).map(Some),
        _ => Ok(None),
    }
}

fn optional_absolute_regular_file(name: &str) -> Result<Option<PathBuf>, ChatError> {
    let value = match std::env::var(name) {
        Ok(value) if !value.is_empty() => value,
        _ => return Ok(None),
    };
    let path = Path::new(&value);
    if !path.is_absolute() {
        return Err(ChatError::InvalidConfiguration);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::InvalidConfiguration)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(ChatError::InvalidConfiguration);
    }
    fs::canonicalize(path)
        .map(Some)
        .map_err(|_| ChatError::InvalidConfiguration)
}

fn validate_executable(path: &Path) -> Result<PathBuf, ChatError> {
    if !path.is_absolute() {
        return Err(ChatError::InvalidConfiguration);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::InvalidConfiguration)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
        || metadata.mode() & 0o100 == 0
    {
        return Err(ChatError::InvalidConfiguration);
    }
    fs::canonicalize(path).map_err(|_| ChatError::InvalidConfiguration)
}

fn required_absolute_directory(name: &str) -> Result<PathBuf, ChatError> {
    let value = std::env::var(name).map_err(|_| ChatError::InvalidConfiguration)?;
    validate_directory(Path::new(&value))
}

fn optional_absolute_directory(name: &str) -> Result<Option<PathBuf>, ChatError> {
    match std::env::var(name) {
        Ok(value) if !value.is_empty() => validate_directory(Path::new(&value)).map(Some),
        _ => Ok(None),
    }
}

fn validate_directory(path: &Path) -> Result<PathBuf, ChatError> {
    if !path.is_absolute() {
        return Err(ChatError::InvalidConfiguration);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::InvalidConfiguration)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        return Err(ChatError::InvalidConfiguration);
    }
    fs::canonicalize(path).map_err(|_| ChatError::InvalidConfiguration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn strict_driver_stop_never_reports_an_unknown_child_outcome_as_complete() {
        assert!(!strict_driver_stop_outcome_known(true, None));
        assert!(strict_driver_stop_outcome_known(false, None));
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn pid_reuse_or_start_identity_drift_is_never_treated_as_owned() {
        let expected = OwnedProcessIdentity {
            pid: 42,
            ppid: 7,
            binary: PathBuf::from("/synthetic/host"),
            process_binary: PathBuf::from("/synthetic/host"),
            binary_sha256: "a".repeat(64),
            instance_nonce: "019fbd88-cbc3-4bf1-934d-7b05cd693f80".to_owned(),
            start_time_seconds: 100,
            start_time_microseconds: 200,
        };
        assert!(owned_process_identity_fields_match(
            &expected,
            7,
            Path::new("/synthetic/host"),
            &"a".repeat(64),
            100,
            200,
        ));
        assert!(!owned_process_identity_fields_match(
            &expected,
            7,
            Path::new("/synthetic/host"),
            &"a".repeat(64),
            100,
            201,
        ));
        assert!(!owned_process_identity_fields_match(
            &expected,
            8,
            Path::new("/synthetic/host"),
            &"a".repeat(64),
            100,
            200,
        ));
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[tokio::test]
    async fn strict_termination_rechecks_live_spawn_identity_before_signalling() {
        let binary = fs::canonicalize("/bin/sleep").unwrap();
        let nonce = generate_instance_nonce(true).unwrap();
        let mut child = Command::new(&binary)
            .arg("30")
            .env_clear()
            .env("YIJIE_AGENT_HOST_INSTANCE_NONCE", &nonce)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let pid = child.id().unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let binary_sha256 = file_sha256(&binary).unwrap();
        let expected =
            capture_owned_process_identity(pid, &binary, &binary_sha256, &nonce).unwrap();
        assert_eq!(process_binary_path(pid).unwrap(), expected.process_binary);
        assert_eq!(file_sha256(&binary).unwrap(), expected.binary_sha256);
        assert!(owned_process_identity_matches(&expected).unwrap());

        let reused = OwnedProcessIdentity {
            start_time_microseconds: expected.start_time_microseconds.saturating_add(1),
            ..expected.clone()
        };
        assert!(terminate_child(&mut child, &reused).await.is_none());
        assert!(child.try_wait().unwrap().is_none());
        assert!(terminate_child(&mut child, &expected).await.is_some());
    }

    #[test]
    fn test_profile_nonce_is_canonical_uuid_v4_and_production_nonce_stays_uuid_v7() {
        for _ in 0..16 {
            let test_nonce = generate_instance_nonce(true).unwrap();
            let parsed_test = uuid::Uuid::parse_str(&test_nonce).unwrap();
            assert_eq!(parsed_test.hyphenated().to_string(), test_nonce);
            assert_eq!(parsed_test.get_version_num(), 4);
            assert_eq!(parsed_test.as_bytes()[8] & 0xc0, 0x80);

            let production_nonce = generate_instance_nonce(false).unwrap();
            let parsed_production = uuid::Uuid::parse_str(&production_nonce).unwrap();
            assert_eq!(parsed_production.hyphenated().to_string(), production_nonce);
            assert_eq!(parsed_production.get_version_num(), 7);
        }
    }

    #[test]
    fn sidecar_environment_is_allowlisted_and_contains_no_provider_secret() {
        let config = SidecarConfig {
            binary: PathBuf::from("/synthetic/host"),
            host_home: PathBuf::from("/synthetic/home"),
            port: 18080,
            codex_binary: None,
            codex_manifest: None,
            codex_home: None,
            test_profile: None,
        };
        let environment = config.environment("019fbd88-cbc3-7bf1-934d-7b05cd693f80", None, None);
        let names = environment
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>();
        assert!(!names.iter().any(|name| name.contains("KEY")));
        assert!(!names.iter().any(|name| name.contains("MINIMAX")));
        assert_eq!(
            config.endpoint("/healthz"),
            "http://127.0.0.1:18080/healthz"
        );
        assert!(environment.iter().any(|(name, value)| {
            *name == "YIJIE_AGENT_HOST_INSTANCE_NONCE"
                && value == "019fbd88-cbc3-7bf1-934d-7b05cd693f80"
        }));
    }

    #[test]
    fn feat126_test_profile_is_exact_closed_and_allowlisted() {
        const RUN_ID: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
        let root = private_test_directory("profile");
        assert!(validate_feat126_test_profile_values(
            "true",
            RUN_ID,
            FEAT126_FAKE_RESPONSES_BASE_URL,
            root.to_str().unwrap(),
        )
        .unwrap()
        .is_some());
        for values in [
            ("TRUE", RUN_ID, FEAT126_FAKE_RESPONSES_BASE_URL),
            ("false", RUN_ID, FEAT126_FAKE_RESPONSES_BASE_URL),
            ("true", "not-a-uuid", FEAT126_FAKE_RESPONSES_BASE_URL),
            ("true", RUN_ID, "http://localhost:18082/v1"),
            ("true", RUN_ID, "https://127.0.0.1:18082/v1"),
        ] {
            assert_eq!(
                validate_feat126_test_profile_values(
                    values.0,
                    values.1,
                    values.2,
                    root.to_str().unwrap(),
                ),
                Err(ChatError::InvalidConfiguration)
            );
        }

        let binary = root.join("agent-host");
        fs::write(&binary, b"synthetic executable").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let profile = FEAT126TestProfile {
            run_id: RUN_ID.to_owned(),
            fake_responses_base_url: FEAT126_FAKE_RESPONSES_BASE_URL.to_owned(),
            run_root: root.clone(),
        };
        let config = SidecarConfig {
            binary,
            host_home: root.join("host-home"),
            port: 18081,
            codex_binary: Some(root.join("codex")),
            codex_manifest: Some(root.join("runtime-manifest.json")),
            codex_home: Some(root.join("codex-home")),
            test_profile: Some(profile),
        };
        let nonce = "019fbd88-cbc3-7bf1-934d-7b05cd693f81";
        let prepared = prepare_capture(&config, nonce).unwrap();
        let prepared_evidence: ProcessEvidence =
            serde_json::from_slice(&fs::read(&prepared.process_manifest).unwrap()).unwrap();
        assert_eq!(prepared_evidence.state, "prepared");
        assert_eq!(prepared_evidence.pid, None);
        let environment = config.environment(
            nonce,
            Some(&prepared.log_directory),
            Some(&prepared.process_manifest),
        );
        let names = environment
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>();
        let expected = vec![
            "YIJIE_ENV",
            "YIJIE_AGENT_HOST_PORT",
            "YIJIE_AGENT_HOST_HOME",
            "YIJIE_AGENT_HOST_V2_RAW_REASONING_ENABLED",
            "YIJIE_AGENT_HOST_V2_TITLE_ENABLED",
            "YIJIE_AGENT_HOST_V2_CLEANUP_ENABLED",
            "YIJIE_AGENT_HOST_INSTANCE_NONCE",
            "PATH",
            "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED",
            "YIJIE_FEAT126_S10_RUN_ID",
            "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL",
            "YIJIE_FEAT126_S10_PARENT_PID",
            "YIJIE_FEAT126_S10_HOST_LOG_DIR",
            "YIJIE_FEAT126_S10_PROCESS_MANIFEST",
            "YIJIE_CODEX_BINARY",
            "YIJIE_CODEX_MANIFEST",
            "YIJIE_CODEX_HOME",
        ];
        assert_eq!(names, expected);
        assert!(environment.iter().any(|(name, value)| {
            *name == "YIJIE_AGENT_HOST_V2_RAW_REASONING_ENABLED" && value == "true"
        }));
        assert!(environment.iter().any(|(name, value)| {
            *name == "YIJIE_AGENT_HOST_V2_CLEANUP_ENABLED" && value == "true"
        }));
        assert!(environment.iter().any(|(name, value)| {
            *name == "YIJIE_AGENT_HOST_V2_TITLE_ENABLED" && value == "false"
        }));
        assert!(!names
            .iter()
            .any(|name| name.contains("KEY") || name.contains("MINIMAX")));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn child_log_capture_is_owner_only_and_bounded() {
        let root = private_test_directory("bounded-log");
        let path = root.join("stdout.log");
        let file = create_private_file(&path).unwrap();
        let (mut writer, reader) = tokio::io::duplex((MAX_CHILD_LOG_BYTES as usize) + 4096);
        let capture = tokio::spawn(capture_bounded_log(reader, file));
        let payload = vec![b'x'; (MAX_CHILD_LOG_BYTES as usize) + 1024];
        writer.write_all(&payload).await.unwrap();
        writer.shutdown().await.unwrap();
        let result = capture.await.unwrap();
        assert_eq!(result.bytes, MAX_CHILD_LOG_BYTES);
        assert!(result.truncated);
        let metadata = fs::symlink_metadata(&path).unwrap();
        assert_eq!(metadata.len(), MAX_CHILD_LOG_BYTES);
        assert_eq!(metadata.mode() & 0o777, 0o600);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn test_profile_child_crash_records_content_free_evidence_and_can_restart() {
        const RUN_ID: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
        let root = private_test_directory("child-crash");
        for name in ["host-home", "codex-home"] {
            create_private_directory(&root.join(name)).unwrap();
        }
        let binary = root.join("agent-host");
        fs::write(
            &binary,
            b"#!/bin/sh\necho host_started\necho host_failed >&2\nexit 7\n",
        )
        .unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let config = SidecarConfig {
            binary,
            host_home: root.join("host-home"),
            port: 18081,
            codex_binary: None,
            codex_manifest: None,
            codex_home: None,
            test_profile: Some(FEAT126TestProfile {
                run_id: RUN_ID.to_owned(),
                fake_responses_base_url: FEAT126_FAKE_RESPONSES_BASE_URL.to_owned(),
                run_root: root.clone(),
            }),
        };
        let supervisor = SidecarSupervisor {
            config: Some(config),
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
            inner: Mutex::new(SupervisorState {
                state: SidecarState::Stopped,
                child: None,
                child_identity: None,
                instance_nonce: None,
                capture: None,
                cleanup_unknown: false,
            }),
        };
        for _ in 0..2 {
            assert_eq!(supervisor.start().await, Err(ChatError::SidecarUnavailable));
            assert_eq!(supervisor.status().await, SidecarState::Failed);
        }
        let entries = fs::read_dir(root.join("host"))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 2);
        for entry in entries {
            let directory = entry.path();
            let evidence_bytes = fs::read(directory.join("process.json")).unwrap();
            let evidence: ProcessEvidence = serde_json::from_slice(&evidence_bytes).unwrap();
            assert_eq!(evidence.run_id, RUN_ID);
            assert_eq!(evidence.state, "exited_during_startup");
            assert_eq!(evidence.exit_code, Some(7));
            assert!(evidence.pid.is_some());
            assert!(evidence.stdout_bytes > 0 && evidence.stderr_bytes > 0);
            let evidence_text = String::from_utf8(evidence_bytes).unwrap();
            assert!(!evidence_text.contains(root.to_str().unwrap()));
            assert!(!evidence_text.contains("host_started"));
            assert!(!evidence_text.contains("host_failed"));
            for name in ["process.json", "stdout.log", "stderr.log"] {
                assert_eq!(
                    fs::symlink_metadata(directory.join(name)).unwrap().mode() & 0o777,
                    0o600
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn fixed_host_child_profile_integration() {
        if std::env::var("YIJIE_RUN_FEAT126_S10P1_DESKTOP_INTEGRATION").as_deref() != Ok("1") {
            return;
        }
        const RUN_ID: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
        let host_binary = PathBuf::from(
            std::env::var("YIJIE_FEAT126_INTEGRATION_HOST_BINARY").expect("Host binary path"),
        );
        let codex_binary = PathBuf::from(
            std::env::var("YIJIE_CODEX_INTEGRATION_BINARY").expect("Runtime binary path"),
        );
        let codex_manifest = PathBuf::from(
            std::env::var("YIJIE_CODEX_INTEGRATION_MANIFEST").expect("Runtime manifest path"),
        );
        let root = private_test_directory("fixed-host");
        let host_home = create_private_directory(&root.join("host-home")).unwrap();
        let codex_home = create_private_directory(&root.join("codex-home")).unwrap();
        let config = SidecarConfig {
            binary: validate_executable(&host_binary).unwrap(),
            host_home,
            port: 18081,
            codex_binary: Some(validate_executable(&codex_binary).unwrap()),
            codex_manifest: Some(optional_absolute_regular_file_value(&codex_manifest).unwrap()),
            codex_home: Some(codex_home),
            test_profile: Some(FEAT126TestProfile {
                run_id: RUN_ID.to_owned(),
                fake_responses_base_url: FEAT126_FAKE_RESPONSES_BASE_URL.to_owned(),
                run_root: root.clone(),
            }),
        };
        let supervisor = SidecarSupervisor {
            config: Some(config),
            client: reqwest::Client::builder()
                .no_proxy()
                .connect_timeout(Duration::from_millis(250))
                .timeout(Duration::from_millis(500))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            inner: Mutex::new(SupervisorState {
                state: SidecarState::Stopped,
                child: None,
                child_identity: None,
                instance_nonce: None,
                capture: None,
                cleanup_unknown: false,
            }),
        };
        assert_eq!(
            supervisor.start().await.unwrap(),
            SidecarState::RuntimeReady
        );
        let connection = supervisor.connection().await.unwrap();
        assert_eq!(connection.port, 18081);
        assert_eq!(supervisor.stop().await.unwrap(), SidecarState::Stopped);
        let entries = fs::read_dir(root.join("host"))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        let directory = entries[0].path();
        let evidence_bytes = fs::read(directory.join("process.json")).unwrap();
        let evidence: ProcessEvidence = serde_json::from_slice(&evidence_bytes).unwrap();
        assert_eq!(evidence.run_id, RUN_ID);
        assert_eq!(evidence.state, "stopped");
        assert!(evidence.pid.is_some() && evidence.ended_at_unix_ms.is_some());
        let evidence_text = String::from_utf8(evidence_bytes).unwrap();
        assert!(!evidence_text.contains(root.to_str().unwrap()));
        for name in ["stdout.log", "stderr.log"] {
            let content = fs::read_to_string(directory.join(name)).unwrap();
            for forbidden in [
                "MINIMAX_API_KEY",
                "synthetic S10P1 input",
                "CODEX_HOME=",
                root.to_str().unwrap(),
                host_binary.to_str().unwrap(),
                codex_binary.to_str().unwrap(),
                codex_manifest.to_str().unwrap(),
            ] {
                assert!(!content.contains(forbidden), "log contained {forbidden}");
            }
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_child_evidence_is_reconciled_without_killing_unknown_processes() {
        const RUN_ID: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
        let root = private_test_directory("stale");
        let host = create_private_directory(&root.join("host")).unwrap();
        let instance =
            create_private_directory(&host.join("019fbd88-cbc3-7bf1-934d-7b05cd693f81")).unwrap();
        let path = instance.join("process.json");
        let evidence = ProcessEvidence {
            schema_version: 1,
            run_id: RUN_ID.to_owned(),
            role: "agent_host_child".to_owned(),
            pid: Some(2_000_000_000),
            ppid: std::process::id(),
            binary_sha256: "0".repeat(64),
            instance_nonce: "019fbd88-cbc3-7bf1-934d-7b05cd693f81".to_owned(),
            started_at_unix_ms: 1,
            ended_at_unix_ms: None,
            state: "ready".to_owned(),
            exit_code: None,
            stdout_bytes: 0,
            stderr_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            log_limit_bytes: MAX_CHILD_LOG_BYTES,
        };
        write_process_evidence(&path, &evidence).unwrap();
        recover_stale_process_evidence(&root, RUN_ID).unwrap();
        let updated: ProcessEvidence = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(updated.state, "stale_after_restart");
        assert!(updated.ended_at_unix_ms.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn arbitrary_or_group_writable_executables_are_rejected() {
        assert_eq!(
            validate_executable(Path::new("relative-host")),
            Err(ChatError::InvalidConfiguration)
        );
        let path = std::env::temp_dir().join(format!("yijie-sidecar-{}", uuid::Uuid::now_v7()));
        fs::write(&path, b"fixture").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o722)).unwrap();
        assert_eq!(
            validate_executable(&path),
            Err(ChatError::InvalidConfiguration)
        );
        fs::remove_file(path).unwrap();
    }

    fn private_test_directory(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("yijie-s10p1-{label}-{}", uuid::Uuid::now_v7()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    fn optional_absolute_regular_file_value(path: &Path) -> Result<PathBuf, ChatError> {
        if !path.is_absolute() {
            return Err(ChatError::InvalidConfiguration);
        }
        let metadata = fs::symlink_metadata(path).map_err(|_| ChatError::InvalidConfiguration)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o022 != 0
        {
            return Err(ChatError::InvalidConfiguration);
        }
        fs::canonicalize(path).map_err(|_| ChatError::InvalidConfiguration)
    }

    async fn one_response(status: &str, nonce: &str, body: &str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = format!(
			"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nX-Yijie-Host-Instance-Nonce: {nonce}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
			body.len()
		);
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        port
    }

    fn probe(port: u16) -> (SidecarConfig, SidecarSupervisor) {
        let config = SidecarConfig {
            binary: PathBuf::from("/synthetic/host"),
            host_home: PathBuf::from("/synthetic/home"),
            port,
            codex_binary: None,
            codex_manifest: None,
            codex_home: None,
            test_profile: None,
        };
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let supervisor = SidecarSupervisor {
            config: None,
            client,
            inner: Mutex::new(SupervisorState {
                state: SidecarState::Stopped,
                child: None,
                child_identity: None,
                instance_nonce: None,
                capture: None,
                cleanup_unknown: false,
            }),
        };
        (config, supervisor)
    }

    #[tokio::test]
    async fn readiness_is_bound_to_spawn_nonce_and_separate_from_liveness() {
        const EXPECTED: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
        let port = one_response(
            "200 OK",
            "019fbd88-cbc3-7bf1-934d-7b05cd693f81",
            r#"{"service":"yijie-agent-host","status":"ok"}"#,
        )
        .await;
        let (config, supervisor) = probe(port);
        assert!(!supervisor.liveness(&config, EXPECTED).await);

        let port = one_response(
            "200 OK",
            EXPECTED,
            r#"{"service":"yijie-agent-host","status":"ok"}"#,
        )
        .await;
        let (config, supervisor) = probe(port);
        assert!(supervisor.liveness(&config, EXPECTED).await);

        let port = one_response(
            "503 Service Unavailable",
            EXPECTED,
            r#"{"status":"not_ready","runtime_state":"starting"}"#,
        )
        .await;
        let (config, supervisor) = probe(port);
        assert!(!supervisor.runtime_ready(&config, EXPECTED).await);

        let port = one_response(
            "200 OK",
            EXPECTED,
            r#"{"status":"ready","runtime_state":"ready"}"#,
        )
        .await;
        let (config, supervisor) = probe(port);
        assert!(supervisor.runtime_ready(&config, EXPECTED).await);
    }
}
