use crate::chat::artifact_video_native::VideoProtocolDiagnostics;
use crate::chat::{
    ArtifactIdentity, ArtifactKind, ArtifactManifest, ArtifactProvenance,
    ArtifactVideoNativeRuntime, AuthoritativeChatProjection, ChatError, ChatRepository,
    ChatRuntime, ChatScope, DatabaseKey, DownloadedArtifact, DownloadedResource, ReceiptKey,
};
use crate::feat126_secure_storage::{EphemeralSecretRole, Feat126SecureStorageProfile};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

const OWNER: &str = "12800000-0000-4000-8000-000000000001";
const TENANT: &str = "12800000-0000-4000-8000-100000000001";
const FIXTURE_NAME: &str = "synthetic-video-16x16.mp4.base64";
const FIXTURE_SHA256: &str = "96ea070cac612d17927939c22f3c0c593fb26b171f62c4e9cee43fb596177dd5";
const FIXTURE_BYTES: usize = 1_642;
const RESULT_BASENAME: &str = "s7b-runtime-result.json";
const WATCHDOG_SECONDS: u64 = 45;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSeedProjection {
    schema_version: u8,
    context_id: Uuid,
    session_id: Uuid,
    turn_id: Uuid,
    artifact_id: Uuid,
    display_name: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeObservation {
    schema_version: u8,
    status: String,
    metadata_ready: bool,
    playback_started: bool,
    seeked: bool,
    failure_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEvidence<'a> {
    schema_version: u8,
    status: &'a str,
    metadata_ready: bool,
    playback_started: bool,
    seeked: bool,
    failure_code: Option<&'a str>,
    fixture_sha256: &'static str,
    fixture_bytes: usize,
    protocol_diagnostics: &'a VideoProtocolDiagnostics,
}

pub struct Feat128S7bRuntimeHarness {
    profile: Arc<Feat126SecureStorageProfile>,
    fixture_path: PathBuf,
    result_path: PathBuf,
    completed: Mutex<bool>,
}

impl Feat128S7bRuntimeHarness {
    pub fn from_environment(
        profile: Option<Arc<Feat126SecureStorageProfile>>,
    ) -> Result<Self, &'static str> {
        if std::env::var("VITE_FEAT128_S7B_RUNTIME").as_deref() != Ok("true")
            || std::env::var("YIJIE_CHAT_LOCAL_ENABLED").as_deref() != Ok("true")
            || std::env::var("YIJIE_ENV").as_deref() != Ok("local")
            || std::env::var("YIJIE_CHAT_LOCAL_OWNER_USER_ID").as_deref() != Ok(OWNER)
            || std::env::var("YIJIE_CHAT_LOCAL_TENANT_ID").as_deref() != Ok(TENANT)
        {
            return Err("runtime_environment_invalid");
        }
        let profile = profile.ok_or("runtime_storage_profile_invalid")?;
        if !profile.uses_ephemeral_backend() {
            return Err("runtime_storage_profile_invalid");
        }
        let fixture_path = canonical_fixture_path(
            &std::env::var("YIJIE_FEAT128_S7B_FIXTURE_PATH")
                .map_err(|_| "runtime_fixture_invalid")?,
        )?;
        let run_root = profile
            .desktop_app_data()
            .parent()
            .ok_or("runtime_result_path_invalid")?;
        let result_path = PathBuf::from(
            std::env::var("YIJIE_FEAT128_S7B_RESULT_PATH")
                .map_err(|_| "runtime_result_path_invalid")?,
        );
        if result_path != run_root.join(RESULT_BASENAME) {
            return Err("runtime_result_path_invalid");
        }
        Ok(Self {
            profile,
            fixture_path,
            result_path,
            completed: Mutex::new(false),
        })
    }

    pub fn start_watchdog(app: AppHandle) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(WATCHDOG_SECONDS)).await;
            let runtime = app.state::<Feat128S7bRuntimeHarness>();
            let diagnostics = app
                .state::<ArtifactVideoNativeRuntime>()
                .diagnostics_snapshot();
            if runtime
                .record(
                    &RuntimeObservation {
                        schema_version: 1,
                        status: "failed".to_owned(),
                        metadata_ready: false,
                        playback_started: false,
                        seeked: false,
                        failure_code: Some("runtime_watchdog_timeout".to_owned()),
                    },
                    &diagnostics,
                )
                .is_ok()
            {
                app.exit(1);
            }
        });
    }

    fn load_fixture(&self) -> Result<Vec<u8>, &'static str> {
        let encoded =
            fs::read_to_string(&self.fixture_path).map_err(|_| "runtime_fixture_invalid")?;
        if encoded.len() > 4_096 {
            return Err("runtime_fixture_invalid");
        }
        let bytes = STANDARD
            .decode(encoded.trim())
            .map_err(|_| "runtime_fixture_invalid")?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if bytes.len() != FIXTURE_BYTES || digest != FIXTURE_SHA256 {
            return Err("runtime_fixture_invalid");
        }
        Ok(bytes)
    }

    fn keys(&self) -> Result<(DatabaseKey, ReceiptKey), &'static str> {
        let database = self
            .profile
            .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
            .ok_or("runtime_storage_profile_invalid")?
            .load()
            .map_err(|_| "runtime_storage_profile_invalid")?
            .ok_or("runtime_storage_profile_invalid")?;
        let receipt = self
            .profile
            .ephemeral_secret_file(EphemeralSecretRole::ReceiptHmac)
            .ok_or("runtime_storage_profile_invalid")?
            .load()
            .map_err(|_| "runtime_storage_profile_invalid")?
            .ok_or("runtime_storage_profile_invalid")?;
        let database: [u8; 32] = database
            .as_slice()
            .try_into()
            .map_err(|_| "runtime_storage_profile_invalid")?;
        let receipt: [u8; 32] = receipt
            .as_slice()
            .try_into()
            .map_err(|_| "runtime_storage_profile_invalid")?;
        Ok((
            DatabaseKey::from_bytes(database),
            ReceiptKey::from_bytes(receipt),
        ))
    }

    fn record(
        &self,
        observation: &RuntimeObservation,
        diagnostics: &VideoProtocolDiagnostics,
    ) -> Result<(), &'static str> {
        validate_observation(observation)?;
        let mut completed = self.completed.lock().map_err(|_| "runtime_result_failed")?;
        if *completed {
            return Err("runtime_result_duplicate");
        }
        let evidence = RuntimeEvidence {
            schema_version: 1,
            status: &observation.status,
            metadata_ready: observation.metadata_ready,
            playback_started: observation.playback_started,
            seeked: observation.seeked,
            failure_code: observation.failure_code.as_deref(),
            fixture_sha256: FIXTURE_SHA256,
            fixture_bytes: FIXTURE_BYTES,
            protocol_diagnostics: diagnostics,
        };
        let encoded = serde_json::to_vec_pretty(&evidence).map_err(|_| "runtime_result_failed")?;
        let temporary = self.result_path.with_extension("json.tmp");
        fs::write(&temporary, encoded).map_err(|_| "runtime_result_failed")?;
        fs::rename(&temporary, &self.result_path).map_err(|_| "runtime_result_failed")?;
        *completed = true;
        Ok(())
    }
}

fn canonical_fixture_path(value: &str) -> Result<PathBuf, &'static str> {
    let path = Path::new(value);
    let metadata = fs::symlink_metadata(path).map_err(|_| "runtime_fixture_invalid")?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || path.file_name().and_then(|name| name.to_str()) != Some(FIXTURE_NAME)
    {
        return Err("runtime_fixture_invalid");
    }
    path.canonicalize().map_err(|_| "runtime_fixture_invalid")
}

fn unix_seconds() -> Result<i64, &'static str> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "runtime_clock_invalid")?
        .as_secs();
    i64::try_from(seconds).map_err(|_| "runtime_clock_invalid")
}

fn database_initialization_error(error: ChatError) -> &'static str {
    match error {
        ChatError::Disabled => "runtime_database_disabled",
        ChatError::InvalidConfiguration => "runtime_database_configuration_invalid",
        ChatError::SecureStorageUnavailable => "runtime_database_storage_unavailable",
        ChatError::DatabaseKeyMissing => "runtime_database_key_missing",
        ChatError::DatabaseUnsafe => "runtime_database_unsafe",
        ChatError::MigrationFailed => "runtime_database_migration_failed",
        _ => "runtime_database_initialization_invalid",
    }
}

fn validate_observation(value: &RuntimeObservation) -> Result<(), &'static str> {
    let passed = value.schema_version == 1
        && value.status == "passed"
        && value.metadata_ready
        && value.playback_started
        && value.seeked
        && value.failure_code.is_none();
    let failed = value.schema_version == 1
        && value.status == "failed"
        && !value.metadata_ready
        && !value.playback_started
        && !value.seeked
        && value
            .failure_code
            .as_deref()
            .is_some_and(|code| code.starts_with("runtime_") && code.len() <= 64);
    if passed || failed {
        Ok(())
    } else {
        Err("runtime_observation_invalid")
    }
}

#[tauri::command]
pub async fn feat128_s7b_runtime_seed(
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    harness: State<'_, Feat128S7bRuntimeHarness>,
) -> Result<RuntimeSeedProjection, &'static str> {
    if webview.label() != "main" {
        return Err("runtime_webview_invalid");
    }
    // Initialize the exact ChatRuntime SQLCipher authority and its ephemeral keys first.
    drop(
        chat_runtime
            .local_offline_conversation_application()
            .await
            .map_err(database_initialization_error)?,
    );
    let content = harness.load_fixture()?;
    let digest = format!("{:x}", Sha256::digest(&content));
    let (database_key, receipt_key) = harness.keys()?;
    let scope =
        ChatScope::new(OWNER.to_owned(), TENANT.to_owned()).map_err(|_| "runtime_scope_invalid")?;
    let mut repository = ChatRepository::open(
        &harness.profile.desktop_app_data().join("chat"),
        &database_key,
        receipt_key,
        scope,
    )
    .map_err(|_| "runtime_database_open_invalid")?;
    let project = repository
        .register_project(
            harness
                .profile
                .desktop_app_data()
                .parent()
                .ok_or("runtime_project_invalid")?
                .join("project")
                .as_path(),
            &[1],
        )
        .map_err(|_| "runtime_project_invalid")?;
    let project_id = Uuid::parse_str(&project.id).map_err(|_| "runtime_project_invalid")?;
    let pending = repository
        .create_session_and_enqueue(project_id, "S7B runtime smoke", Uuid::now_v7())
        .map_err(|_| "runtime_seed_failed")?;
    let artifact_id = Uuid::now_v7();
    let agent_session_id = Uuid::now_v7();
    let display_name = "synthetic-video-16x16.mp4";
    let identity = ArtifactIdentity {
        artifact_id,
        local_session_id: pending.session_id,
        local_turn_id: pending.turn_id,
        kind: ArtifactKind::Video,
        provenance: ArtifactProvenance::Synthetic,
        ordinal: 0,
        display_name: Some(display_name.to_owned()),
    };
    let manifest = ArtifactManifest {
        artifact_id,
        agent_session_id,
        local_session_id: pending.session_id,
        local_turn_id: pending.turn_id,
        kind: ArtifactKind::Video,
        provenance: ArtifactProvenance::Synthetic,
        ordinal: 0,
        display_name: Some(display_name.to_owned()),
        media_type: "video/mp4".to_owned(),
        size_bytes: content.len(),
        sha256: digest.clone(),
        content_href: format!(
            "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
        ),
        poster_href: None,
    };
    repository
        .record_artifact_started(&identity)
        .and_then(|_| repository.begin_artifact_transfer(&manifest).map(|_| ()))
        .and_then(|_| {
            repository.commit_artifact(
                &manifest,
                &DownloadedArtifact {
                    content: DownloadedResource {
                        media_type: "video/mp4".to_owned(),
                        size_bytes: content.len(),
                        sha256: digest,
                        bytes: content,
                    },
                    poster: None,
                },
                unix_seconds().map_err(|_| crate::chat::ChatError::DatabaseUnavailable)?,
                Uuid::now_v7(),
            )
        })
        .map_err(|_| "runtime_seed_failed")?;
    drop(repository);

    let now = unix_seconds()?;
    let projection = AuthoritativeChatProjection::from_trusted_native_projection(
        Uuid::parse_str(TENANT).map_err(|_| "runtime_scope_invalid")?,
        1,
        now.checked_add(300).ok_or("runtime_clock_invalid")?,
        ["task.read".to_owned()],
    )
    .map_err(|_| "runtime_context_invalid")?;
    let context = chat_runtime
        .authorization_manager()
        .and_then(|manager| manager.bind(projection, now))
        .map_err(|_| "runtime_context_invalid")?;
    Ok(RuntimeSeedProjection {
        schema_version: 1,
        context_id: context.context_id,
        session_id: pending.session_id,
        turn_id: pending.turn_id,
        artifact_id,
        display_name,
    })
}

#[tauri::command]
pub fn feat128_s7b_runtime_result(
    observation: RuntimeObservation,
    webview: WebviewWindow,
    app: AppHandle,
    harness: State<'_, Feat128S7bRuntimeHarness>,
    video_runtime: State<'_, ArtifactVideoNativeRuntime>,
) -> Result<(), &'static str> {
    if webview.label() != "main" {
        return Err("runtime_webview_invalid");
    }
    let diagnostics = video_runtime.diagnostics_snapshot();
    harness.record(&observation, &diagnostics)?;
    app.exit(if observation.status == "passed" { 0 } else { 1 });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_is_closed_and_requires_all_runtime_proofs() {
        assert!(validate_observation(&RuntimeObservation {
            schema_version: 1,
            status: "passed".to_owned(),
            metadata_ready: true,
            playback_started: true,
            seeked: true,
            failure_code: None,
        })
        .is_ok());
        assert!(validate_observation(&RuntimeObservation {
            schema_version: 1,
            status: "passed".to_owned(),
            metadata_ready: true,
            playback_started: true,
            seeked: false,
            failure_code: None,
        })
        .is_err());
    }
}
