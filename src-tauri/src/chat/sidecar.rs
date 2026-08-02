use super::error::ChatError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct SidecarConfig {
    binary: PathBuf,
    host_home: PathBuf,
    port: u16,
    codex_binary: Option<PathBuf>,
    codex_manifest: Option<PathBuf>,
    codex_home: Option<PathBuf>,
}

impl SidecarConfig {
    pub fn from_environment() -> Result<Option<Self>, ChatError> {
        if std::env::var("YIJIE_CHAT_LOCAL_HOST_ENABLED").as_deref() != Ok("true") {
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
        Ok(Some(Self {
            binary,
            host_home,
            port,
            codex_binary,
            codex_manifest,
            codex_home,
        }))
    }

    fn endpoint(&self) -> String {
        format!("http://127.0.0.1:{}/healthz", self.port)
    }

    fn environment(&self) -> Vec<(&'static str, String)> {
        let mut values = vec![
            ("YIJIE_ENV", "local".to_owned()),
            ("YIJIE_AGENT_HOST_PORT", self.port.to_string()),
            (
                "YIJIE_AGENT_HOST_HOME",
                self.host_home.to_string_lossy().into_owned(),
            ),
            (
                "YIJIE_AGENT_HOST_V2_RAW_REASONING_ENABLED",
                "false".to_owned(),
            ),
            ("YIJIE_AGENT_HOST_V2_TITLE_ENABLED", "false".to_owned()),
            ("YIJIE_AGENT_HOST_V2_CLEANUP_ENABLED", "false".to_owned()),
            ("PATH", "/usr/bin:/bin".to_owned()),
        ];
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
    Healthy,
    Failed,
}

struct SupervisorState {
    state: SidecarState,
    child: Option<Child>,
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
            .connect_timeout(Duration::from_millis(250))
            .timeout(Duration::from_millis(500))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ChatError::InvalidConfiguration)?;
        Ok(Self {
            config,
            client,
            inner: Mutex::new(SupervisorState { state, child: None }),
        })
    }

    pub async fn status(&self) -> SidecarState {
        self.inner.lock().await.state
    }

    pub async fn start(&self) -> Result<SidecarState, ChatError> {
        let config = self.config.as_ref().ok_or(ChatError::Disabled)?;
        let mut state = self.inner.lock().await;
        if state.state == SidecarState::Healthy {
            return Ok(state.state);
        }
        if state.child.is_some() {
            return Err(ChatError::SidecarUnavailable);
        }
        state.state = SidecarState::Starting;
        let mut command = Command::new(&config.binary);
        command
            .env_clear()
            .envs(config.environment())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let child = command.spawn().map_err(|_| ChatError::SidecarUnavailable)?;
        state.child = Some(child);
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
        loop {
            if state
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .flatten()
                .is_some()
            {
                state.child = None;
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
            if self.health(config).await {
                state.state = SidecarState::Healthy;
                return Ok(state.state);
            }
            if tokio::time::Instant::now() >= deadline {
                if let Some(child) = state.child.as_mut() {
                    terminate_child(child).await;
                }
                state.child = None;
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    pub async fn stop(&self) -> Result<SidecarState, ChatError> {
        let mut state = self.inner.lock().await;
        if let Some(child) = state.child.as_mut() {
            terminate_child(child).await;
        }
        state.child = None;
        state.state = if self.config.is_some() {
            SidecarState::Stopped
        } else {
            SidecarState::Disabled
        };
        Ok(state.state)
    }

    async fn health(&self, config: &SidecarConfig) -> bool {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct HealthResponse {
            service: String,
            status: String,
        }

        let Ok(response) = self.client.get(config.endpoint()).send().await else {
            return false;
        };
        if !response.status().is_success()
            || response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_none_or(|value| !value.starts_with("application/json"))
            || response.content_length().is_none_or(|length| length > 1024)
        {
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
}

async fn terminate_child(child: &mut Child) {
    if let Some(process_id) = child.id() {
        unsafe {
            libc::kill(process_id as i32, libc::SIGTERM);
        }
    }
    if tokio::time::timeout(Duration::from_secs(3), child.wait())
        .await
        .is_err()
    {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
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

    #[test]
    fn sidecar_environment_is_allowlisted_and_contains_no_provider_secret() {
        let config = SidecarConfig {
            binary: PathBuf::from("/synthetic/host"),
            host_home: PathBuf::from("/synthetic/home"),
            port: 18080,
            codex_binary: None,
            codex_manifest: None,
            codex_home: None,
        };
        let environment = config.environment();
        let names = environment
            .iter()
            .map(|(name, _)| *name)
            .collect::<Vec<_>>();
        assert!(!names.iter().any(|name| name.contains("KEY")));
        assert!(!names.iter().any(|name| name.contains("MINIMAX")));
        assert_eq!(config.endpoint(), "http://127.0.0.1:18080/healthz");
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
}
