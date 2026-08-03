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

    fn endpoint(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    fn environment(&self, instance_nonce: &str) -> Vec<(&'static str, String)> {
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
            ("YIJIE_AGENT_HOST_INSTANCE_NONCE", instance_nonce.to_owned()),
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
    HostLive,
    RuntimeReady,
    Failed,
}

struct SupervisorState {
    state: SidecarState,
    child: Option<Child>,
    instance_nonce: Option<String>,
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
                instance_nonce: None,
            }),
        })
    }

    pub async fn status(&self) -> SidecarState {
        self.inner.lock().await.state
    }

    pub async fn start(&self) -> Result<SidecarState, ChatError> {
        let config = self.config.as_ref().ok_or(ChatError::Disabled)?;
        let mut state = self.inner.lock().await;
        if state.state == SidecarState::RuntimeReady {
            return Ok(state.state);
        }
        if state.child.is_some() {
            return Err(ChatError::SidecarUnavailable);
        }
        state.state = SidecarState::Starting;
        let instance_nonce = uuid::Uuid::now_v7().to_string();
        let mut command = Command::new(&config.binary);
        command
            .env_clear()
            .envs(config.environment(&instance_nonce))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let child = command.spawn().map_err(|_| ChatError::SidecarUnavailable)?;
        state.child = Some(child);
        state.instance_nonce = Some(instance_nonce.clone());
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
                state.instance_nonce = None;
                state.state = SidecarState::Failed;
                return Err(ChatError::SidecarUnavailable);
            }
            if self.liveness(config, &instance_nonce).await {
                state.state = SidecarState::HostLive;
                if self.runtime_ready(config, &instance_nonce).await {
                    state.state = SidecarState::RuntimeReady;
                    return Ok(state.state);
                }
            }
            if tokio::time::Instant::now() >= deadline {
                if let Some(child) = state.child.as_mut() {
                    terminate_child(child).await;
                }
                state.child = None;
                state.instance_nonce = None;
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
        state.instance_nonce = None;
        state.state = if self.config.is_some() {
            SidecarState::Stopped
        } else {
            SidecarState::Disabled
        };
        Ok(state.state)
    }

    pub(super) async fn connection(&self) -> Result<HostConnection, ChatError> {
        let config = self.config.as_ref().ok_or(ChatError::Disabled)?;
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
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

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
        let environment = config.environment("019fbd88-cbc3-7bf1-934d-7b05cd693f80");
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
                instance_nonce: None,
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
