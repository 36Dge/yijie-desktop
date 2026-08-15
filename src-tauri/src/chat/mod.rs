mod application;
mod authorization;
mod database;
mod error;
#[cfg(test)]
mod feat126_eval_tests;
mod host_bridge;
mod host_domain;
pub(crate) mod ipc;
mod keychain;
mod migrations;
mod native_project;
mod public_tasks;
mod sidecar;
mod worker;

use crate::feat126_secure_storage::Feat126SecureStorageProfile;
use crate::native_auth::NativeAuthRuntime;
pub use application::{
    AuthorizedConversationApplication, ConversationApplication, ConversationCoordinator,
    ConversationResyncProjection, CoordinatorOutcome, DispatchOutcome, LiveReasoningProjection,
    LiveTurnProjection, ReducerOutcome, ReducerOutcomeKind, TurnEventReducer, TurnProjectionSink,
};
pub use authorization::{
    AuthoritativeChatProjection, ChatAction, ChatAuthorizationContext, ChatAuthorizationManager,
};
pub use database::{
    ActiveTurnContext, ChatRepository, ChatScope, ClaimedDeletion, ClaimedOutbox,
    CleanupSurfaceState, CreateSessionDispatch, DeletionStatus, HistoryMessage, HistoryPage,
    HistoryReasoningMetadata, HistoryTurn, InterruptTurnDispatch, OutboxKind, OutboxState,
    PendingConversation, ProjectSummary, PublicTaskBindingState, PublicTaskControlPlaneStatus,
    ReasoningItem, ReasoningPart, ReasoningStatus, RecoverySnapshot, SessionPage,
    SessionPageCursor, SessionSummary, SessionTitleSource, StartTurnDispatch, StoredEventCursor,
    TerminalTurnCommit, TurnProgress,
};
pub use error::{ChatCommandError, ChatError};
pub use host_bridge::{HostBridge, HostEventStream, HostTrace};
pub use host_domain::{
    HostBridgeError, HostBridgeErrorKind, HostCleanupOutcome, HostCleanupReason,
    HostCleanupSurfaceStatus, HostCleanupSurfaces, HostErrorCode, HostEvent, HostEventCursor,
    HostEventKind, HostReasoningPart, HostReasoningReason, HostReasoningStatus, HostSession,
    HostSessionFailure, HostSessionState, HostTurnStatus,
};
pub use ipc::{ChatIpcRuntime, CHAT_EVENT_CHANNEL, CHAT_IPC_SCHEMA_VERSION};
pub use keychain::{
    DatabaseKey, DatabaseKeyStore, ReceiptKey, ReceiptKeyStore, DATABASE_KEYCHAIN_ACCOUNT,
    DATABASE_KEYCHAIN_SERVICE, RECEIPT_KEYCHAIN_ACCOUNT, RECEIPT_KEYCHAIN_SERVICE,
};
use keychain::{ProtectedDatabaseKeyStore, ProtectedReceiptKeyStore};
pub use migrations::{catalog_digests, validate_embedded_migrations, LATEST_SCHEMA_VERSION};
pub use public_tasks::{
    NativePublicTaskControlPlane, PublicTaskControlPlane, PublicTaskCreateIntent,
    PublicTaskCreateOutcome, PublicTaskIssueCode,
};
use serde::Serialize;
use sidecar::{SidecarState, SidecarSupervisor};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use worker::DatabaseWorker;

// The feature handler deliberately omits these production commands. Referencing the function
// items keeps their normal compile coverage without making them invokable from the WebView.
#[cfg(feature = "feat126-s10-driver")]
pub(crate) fn feat126_s10_driver_unregistered_command_guard() {
    let _ = ipc::chat_pick_project_v1;
    let _ = ipc::chat_set_project_pinned_v1;
    let _ = ipc::chat_remove_project_v1;
    let _ = ipc::chat_create_session_v1;
    let _ = ipc::chat_submit_turn_v1;
    let _ = ipc::chat_list_sessions_v1;
    let _ = ipc::chat_load_history_v1;
    let _ = ipc::chat_load_reasoning_v1;
    let _ = ipc::chat_rename_session_v1;
    let _ = ipc::chat_set_session_pinned_v1;
    let _ = ipc::chat_interrupt_turn_v1;
    let _ = ipc::chat_delete_session_v1;
    let _ = ipc::chat_get_cleanup_status_v1;
    let _ = ipc::chat_get_session_control_plane_v1;
    let _ = ipc::chat_resync_session_v1;
    let _ = ipc::chat_subscribe_session_v1;
    let _ = ipc::chat_unsubscribe_session_v1;
    let _ = ipc::chat_cancel_request_v1;
}

const CONTRACT_COMMIT: &str = "98e89d8cccfe15256f09e9329d4bc1980d6da578";

#[derive(Clone)]
struct LocalChatConfig {
    chat_directory: PathBuf,
    scope: database::ChatScope,
    secure_storage: Option<Arc<Feat126SecureStorageProfile>>,
    public_tasks: Arc<dyn PublicTaskControlPlane>,
}

enum RuntimeMode {
    Disabled,
    Invalid,
    Local(LocalChatConfig),
}

pub struct ChatRuntime {
    mode: RuntimeMode,
    authorization: Option<ChatAuthorizationManager>,
    worker: Mutex<Option<DatabaseWorker>>,
    initialization: Mutex<()>,
    sidecar: Option<Arc<SidecarSupervisor>>,
    host_bridge: Mutex<Option<Arc<HostBridge>>>,
}

#[derive(Debug, Serialize)]
pub struct ChatFoundationStatus {
    pub state: &'static str,
    pub schema_version: Option<i64>,
    pub contract_commit: &'static str,
    pub sidecar: SidecarState,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatReadinessLifecycle {
    Starting,
    Ready,
    Blocked,
    Recovering,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatHostReadiness {
    Starting,
    Ready,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatRuntimeReadiness {
    Starting,
    Ready,
    Unavailable,
    VersionMismatch,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatStorageReadiness {
    Ready,
    ReadOnly,
    Full,
    Corrupt,
    MigrationFailed,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatLocalReadiness {
    pub lifecycle: ChatReadinessLifecycle,
    pub host: ChatHostReadiness,
    pub runtime: ChatRuntimeReadiness,
    pub storage: ChatStorageReadiness,
    pub can_send: bool,
    pub issue_code: Option<&'static str>,
    pub retryable: bool,
    pub recovery: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl ChatRuntime {
    pub(crate) fn from_environment(
        app_data_directory: PathBuf,
        secure_storage: Option<Arc<Feat126SecureStorageProfile>>,
        secure_storage_invalid: bool,
        native_auth: NativeAuthRuntime,
    ) -> Self {
        if std::env::var("YIJIE_CHAT_LOCAL_ENABLED").as_deref() != Ok("true") {
            return Self {
                mode: RuntimeMode::Disabled,
                authorization: None,
                worker: Mutex::new(None),
                initialization: Mutex::new(()),
                sidecar: None,
                host_bridge: Mutex::new(None),
            };
        }
        let mut mode = if secure_storage_invalid
            || std::env::var("YIJIE_ENV").as_deref() != Ok("local")
        {
            RuntimeMode::Invalid
        } else {
            match (
                std::env::var("YIJIE_CHAT_LOCAL_OWNER_USER_ID"),
                std::env::var("YIJIE_CHAT_LOCAL_TENANT_ID"),
            ) {
                (Ok(owner), Ok(tenant)) => match database::ChatScope::new(owner, tenant) {
                    Ok(scope) => match (scope.owner_uuid(), scope.tenant_uuid()) {
                        (Ok(owner_user_id), Ok(tenant_id)) => RuntimeMode::Local(LocalChatConfig {
                            chat_directory: secure_storage
                                .as_ref()
                                .map(|profile| profile.desktop_app_data().join("chat"))
                                .unwrap_or_else(|| app_data_directory.join("chat")),
                            public_tasks: Arc::new(NativePublicTaskControlPlane::new(
                                native_auth.clone(),
                                owner_user_id,
                                tenant_id,
                            )),
                            scope,
                            secure_storage: secure_storage.clone(),
                        }),
                        _ => RuntimeMode::Invalid,
                    },
                    Err(_) => RuntimeMode::Invalid,
                },
                _ => RuntimeMode::Invalid,
            }
        };
        let sidecar = match SidecarSupervisor::from_environment() {
            Ok(supervisor) => Some(Arc::new(supervisor)),
            Err(_) => {
                mode = RuntimeMode::Invalid;
                None
            }
        };
        let authorization = match &mode {
            RuntimeMode::Local(config) => ChatAuthorizationManager::new(&config.scope).ok(),
            RuntimeMode::Disabled | RuntimeMode::Invalid => None,
        };
        Self {
            mode,
            authorization,
            worker: Mutex::new(None),
            initialization: Mutex::new(()),
            sidecar,
            host_bridge: Mutex::new(None),
        }
    }

    async fn database(&self) -> Result<DatabaseWorker, ChatError> {
        let config = match &self.mode {
            RuntimeMode::Disabled => return Err(ChatError::Disabled),
            RuntimeMode::Invalid => return Err(ChatError::InvalidConfiguration),
            RuntimeMode::Local(config) => config.clone(),
        };
        if let Some(worker) = self.worker.lock().await.clone() {
            return Ok(worker);
        }
        let _initialization = self.initialization.lock().await;
        if let Some(worker) = self.worker.lock().await.clone() {
            return Ok(worker);
        }
        let worker = tokio::task::spawn_blocking(move || {
            let key_store = ProtectedDatabaseKeyStore::new(config.secure_storage.clone())?;
            let receipt_key_store = ProtectedReceiptKeyStore::new(config.secure_storage.clone())?;
            DatabaseWorker::start(
                config.chat_directory,
                config.scope,
                Box::new(key_store),
                Box::new(receipt_key_store),
            )
        })
        .await
        .map_err(|_| ChatError::DatabaseUnavailable)??;
        *self.worker.lock().await = Some(worker.clone());
        Ok(worker)
    }

    async fn foundation_status(&self) -> Result<ChatFoundationStatus, ChatError> {
        let sidecar = match &self.sidecar {
            Some(supervisor) => supervisor.status().await,
            None => SidecarState::Disabled,
        };
        match self.mode {
            RuntimeMode::Disabled => Ok(ChatFoundationStatus {
                state: "disabled",
                schema_version: None,
                contract_commit: CONTRACT_COMMIT,
                sidecar,
            }),
            RuntimeMode::Invalid => Err(ChatError::InvalidConfiguration),
            RuntimeMode::Local(_) => {
                let version = self.database().await?.schema_version().await?;
                Ok(ChatFoundationStatus {
                    state: "ready",
                    schema_version: Some(version),
                    contract_commit: CONTRACT_COMMIT,
                    sidecar,
                })
            }
        }
    }

    async fn storage_readiness(&self) -> ChatStorageReadiness {
        match self.database().await {
            Ok(worker) => match worker.probe_storage().await {
                Ok(_) => ChatStorageReadiness::Ready,
                Err(error) => storage_readiness_for_error(error),
            },
            Err(error) => storage_readiness_for_error(error),
        }
    }

    pub async fn local_readiness(&self, recovering: bool) -> ChatLocalReadiness {
        let storage = self.storage_readiness().await;
        let sidecar = match &self.sidecar {
            Some(supervisor) => supervisor.status().await,
            None => SidecarState::Disabled,
        };
        let bridge_ready = self.host_bridge.lock().await.is_some();
        let (host, runtime) = match sidecar {
            SidecarState::Starting => (ChatHostReadiness::Starting, ChatRuntimeReadiness::Starting),
            SidecarState::HostLive => (ChatHostReadiness::Ready, ChatRuntimeReadiness::Starting),
            SidecarState::RuntimeReady if bridge_ready => {
                (ChatHostReadiness::Ready, ChatRuntimeReadiness::Ready)
            }
            SidecarState::RuntimeReady => {
                (ChatHostReadiness::Unavailable, ChatRuntimeReadiness::Ready)
            }
            SidecarState::Disabled | SidecarState::Stopped | SidecarState::Failed => (
                ChatHostReadiness::Unavailable,
                ChatRuntimeReadiness::Unavailable,
            ),
        };

        let issue = match storage {
            ChatStorageReadiness::ReadOnly => {
                Some(("chat_storage_read_only", false, "repair_or_restore", None))
            }
            ChatStorageReadiness::Full => Some(("chat_storage_full", true, "free_space", None)),
            ChatStorageReadiness::Corrupt => {
                Some(("chat_storage_corrupt", false, "repair_or_restore", None))
            }
            ChatStorageReadiness::MigrationFailed => {
                Some(("chat_storage_migration_failed", false, "restart_app", None))
            }
            ChatStorageReadiness::Unavailable => {
                Some(("chat_storage_unavailable", true, "retry", Some(1000)))
            }
            ChatStorageReadiness::Ready => match (host, runtime) {
                (ChatHostReadiness::Starting, _) => {
                    Some(("chat_host_starting", true, "start_or_retry", Some(250)))
                }
                (ChatHostReadiness::Unavailable, _) => {
                    Some(("chat_host_unavailable", true, "start_or_retry", Some(1000)))
                }
                (_, ChatRuntimeReadiness::Starting) => {
                    Some(("chat_runtime_starting", true, "start_or_retry", Some(250)))
                }
                (_, ChatRuntimeReadiness::Unavailable) => Some((
                    "chat_runtime_unavailable",
                    true,
                    "start_or_retry",
                    Some(1000),
                )),
                (_, ChatRuntimeReadiness::VersionMismatch) => {
                    Some(("chat_runtime_version_mismatch", false, "restart_app", None))
                }
                (ChatHostReadiness::Ready, ChatRuntimeReadiness::Ready) => None,
            },
        };
        let can_send = issue.is_none();
        let (issue_code, retryable, recovery, retry_after_ms) = issue
            .map(|(code, retryable, recovery, delay)| (Some(code), retryable, recovery, delay))
            .unwrap_or((None, false, "none", None));
        ChatLocalReadiness {
            lifecycle: if can_send {
                ChatReadinessLifecycle::Ready
            } else if recovering {
                ChatReadinessLifecycle::Recovering
            } else if host == ChatHostReadiness::Starting
                || runtime == ChatRuntimeReadiness::Starting
            {
                ChatReadinessLifecycle::Starting
            } else {
                ChatReadinessLifecycle::Blocked
            },
            host,
            runtime,
            storage,
            can_send,
            issue_code,
            retryable,
            recovery,
            retry_after_ms,
        }
    }

    pub async fn request_local_recovery(&self) -> ChatLocalReadiness {
        let before = self.local_readiness(true).await;
        if before.storage != ChatStorageReadiness::Ready {
            return before;
        }
        if self.start_sidecar().await.is_err() {
            return self.local_readiness(false).await;
        }
        #[cfg(feature = "feat126-s10-driver")]
        if self.feat126_resume_bound_sessions().await.is_err() {
            *self.host_bridge.lock().await = None;
        }
        self.local_readiness(false).await
    }

    #[cfg(feature = "feat126-s10-driver")]
    async fn feat126_resume_bound_sessions(&self) -> Result<(), ChatError> {
        let candidates = self.database().await?.feat126_resume_candidates().await?;
        let host = self.local_host_bridge().await?;
        for candidate in candidates {
            let resumed = host
                .resume_session(candidate.agent_session_id, &HostTrace::default())
                .await
                .map_err(|_| ChatError::SidecarUnavailable)?;
            validate_feat126_resumed_session(&candidate, &resumed)?;
        }
        Ok(())
    }

    async fn pick_project(&self) -> Result<Option<database::ProjectSummary>, ChatError> {
        let worker = self.database().await?;
        let Some(selection) = native_project::pick_project().await? else {
            return Ok(None);
        };
        if let RuntimeMode::Local(config) = &self.mode {
            if let Some(profile) = &config.secure_storage {
                profile
                    .validate_project_path(&selection.canonical_path)
                    .map_err(|_| ChatError::ProjectUnavailable)?;
            }
        }
        worker
            .register_project(selection.canonical_path, selection.bookmark)
            .await
            .map(Some)
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_register_project(
        &self,
    ) -> Result<database::ProjectSummary, ChatError> {
        let profile = match &self.mode {
            RuntimeMode::Local(config) => config
                .secure_storage
                .clone()
                .ok_or(ChatError::InvalidConfiguration)?,
            RuntimeMode::Disabled => return Err(ChatError::Disabled),
            RuntimeMode::Invalid => return Err(ChatError::InvalidConfiguration),
        };
        let project_path = profile.project_path().to_path_buf();
        profile
            .validate_project_path(&project_path)
            .map_err(|_| ChatError::ProjectUnavailable)?;
        let selection = tokio::task::spawn_blocking(move || {
            native_project::create_selection(&project_path)?.ok_or(ChatError::ProjectUnavailable)
        })
        .await
        .map_err(|_| ChatError::ProjectUnavailable)??;
        self.database()
            .await?
            .register_project(selection.canonical_path, selection.bookmark)
            .await
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_verify_project_and_readiness(
        &self,
        project_id: &str,
    ) -> Result<(), ChatError> {
        let parsed = uuid::Uuid::parse_str(project_id).map_err(|_| ChatError::InvalidInput)?;
        if parsed.is_nil() || parsed.hyphenated().to_string() != project_id {
            return Err(ChatError::InvalidInput);
        }
        let project = self.revalidate_project(project_id.to_owned()).await?;
        if project.id != project_id || !project.available {
            return Err(ChatError::ProjectUnavailable);
        }
        let readiness = self.local_readiness(false).await;
        if readiness.lifecycle != ChatReadinessLifecycle::Ready
            || readiness.host != ChatHostReadiness::Ready
            || readiness.runtime != ChatRuntimeReadiness::Ready
            || readiness.storage != ChatStorageReadiness::Ready
            || !readiness.can_send
        {
            return Err(ChatError::SidecarUnavailable);
        }
        Ok(())
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_stop_owned_host(&self) -> Result<(), ChatError> {
        match self.mode {
            RuntimeMode::Local(_) => {
                *self.host_bridge.lock().await = None;
                self.sidecar
                    .as_ref()
                    .ok_or(ChatError::InvalidConfiguration)?
                    .stop_strict_for_driver()
                    .await
                    .map(|_| ())
            }
            RuntimeMode::Disabled => Err(ChatError::Disabled),
            RuntimeMode::Invalid => Err(ChatError::InvalidConfiguration),
        }
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_close_owned_runtime(&self) -> Result<(), ChatError> {
        self.feat126_s10_stop_owned_host().await?;
        self.worker.lock().await.take();
        Ok(())
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) async fn feat126_s10_run_r8_probe(
        &self,
    ) -> Result<database::R8ProbeProjection, ChatError> {
        let (profile, scope) = match &self.mode {
            RuntimeMode::Local(config) => (
                config
                    .secure_storage
                    .clone()
                    .ok_or(ChatError::InvalidConfiguration)?,
                config.scope.clone(),
            ),
            RuntimeMode::Disabled => return Err(ChatError::Disabled),
            RuntimeMode::Invalid => return Err(ChatError::InvalidConfiguration),
        };
        let probe_root = profile.run_root().join("r8-probe");
        tokio::task::spawn_blocking(move || {
            database::ChatRepository::run_r8_probe_at(&probe_root, scope)
        })
        .await
        .map_err(|_| ChatError::DatabaseUnavailable)?
    }

    async fn revalidate_project(
        &self,
        project_id: String,
    ) -> Result<database::ProjectSummary, ChatError> {
        let worker = self.database().await?;
        let bookmark = worker.project_bookmark(project_id.clone()).await?;
        let selection =
            tokio::task::spawn_blocking(move || native_project::resolve_bookmark(&bookmark))
                .await
                .map_err(|_| ChatError::ProjectUnavailable)??;
        if let RuntimeMode::Local(config) = &self.mode {
            if let Some(profile) = &config.secure_storage {
                profile
                    .validate_project_path(&selection.canonical_path)
                    .map_err(|_| ChatError::ProjectUnavailable)?;
            }
        }
        worker
            .refresh_project(project_id, selection.canonical_path, selection.bookmark)
            .await
    }

    async fn list_projects(&self) -> Result<Vec<database::ProjectSummary>, ChatError> {
        self.database().await?.list_projects().await
    }

    async fn remove_project(&self, project_id: String) -> Result<(), ChatError> {
        self.database().await?.remove_project(project_id).await
    }

    async fn start_sidecar(&self) -> Result<SidecarState, ChatError> {
        match self.mode {
            RuntimeMode::Local(_) => {
                let supervisor = self
                    .sidecar
                    .as_ref()
                    .ok_or(ChatError::InvalidConfiguration)?;
                let state = supervisor.start().await?;
                let connection = supervisor.connection().await?;
                let bridge = HostBridge::from_connection(connection)
                    .map_err(|_| ChatError::SidecarUnavailable)?;
                *self.host_bridge.lock().await = Some(Arc::new(bridge));
                Ok(state)
            }
            RuntimeMode::Disabled => Err(ChatError::Disabled),
            RuntimeMode::Invalid => Err(ChatError::InvalidConfiguration),
        }
    }

    async fn stop_sidecar(&self) -> Result<SidecarState, ChatError> {
        match self.mode {
            RuntimeMode::Local(_) => {
                *self.host_bridge.lock().await = None;
                self.sidecar
                    .as_ref()
                    .ok_or(ChatError::InvalidConfiguration)?
                    .stop()
                    .await
            }
            RuntimeMode::Disabled => Err(ChatError::Disabled),
            RuntimeMode::Invalid => Err(ChatError::InvalidConfiguration),
        }
    }

    pub async fn local_host_bridge(&self) -> Result<Arc<HostBridge>, ChatError> {
        match self.mode {
            RuntimeMode::Disabled => Err(ChatError::Disabled),
            RuntimeMode::Invalid => Err(ChatError::InvalidConfiguration),
            RuntimeMode::Local(_) => self
                .host_bridge
                .lock()
                .await
                .clone()
                .ok_or(ChatError::SidecarUnavailable),
        }
    }

    /// Rust-owned authorization state for the future private IPC adapter. This is not a
    /// Tauri command and does not expose the bound owner or tenant to the WebView.
    pub fn authorization_manager(&self) -> Result<ChatAuthorizationManager, ChatError> {
        self.authorization.clone().ok_or(match self.mode {
            RuntimeMode::Disabled => ChatError::Disabled,
            RuntimeMode::Invalid | RuntimeMode::Local(_) => ChatError::InvalidConfiguration,
        })
    }

    pub async fn local_conversation_application(
        &self,
    ) -> Result<ConversationApplication, ChatError> {
        let database = self.database().await?;
        let host = self.local_host_bridge().await?;
        let public_tasks = match &self.mode {
            RuntimeMode::Local(config) => config.public_tasks.clone(),
            RuntimeMode::Disabled => return Err(ChatError::Disabled),
            RuntimeMode::Invalid => return Err(ChatError::InvalidConfiguration),
        };
        Ok(ConversationApplication::new(database, host, public_tasks))
    }

    pub async fn local_offline_conversation_application(
        &self,
    ) -> Result<ConversationApplication, ChatError> {
        Ok(ConversationApplication::new_offline(self.database().await?))
    }

    pub async fn local_authorized_conversation_application(
        &self,
    ) -> Result<AuthorizedConversationApplication, ChatError> {
        Ok(AuthorizedConversationApplication::new(
            self.local_conversation_application().await?,
            self.authorization_manager()?,
        ))
    }
}

#[cfg(feature = "feat126-s10-driver")]
fn validate_feat126_resumed_session(
    candidate: &database::Feat126ResumeCandidate,
    resumed: &HostSession,
) -> Result<(), ChatError> {
    if resumed.task_id != candidate.task_id
        || resumed.agent_session_id != candidate.agent_session_id
        || resumed.codex_thread_id != Some(candidate.codex_thread_id)
        || resumed.active_turn_id.is_some()
        || resumed.state != HostSessionState::Idle
        || !resumed.model_ready
        || resumed.failure_code.is_some()
    {
        return Err(ChatError::SidecarUnavailable);
    }
    Ok(())
}

fn storage_readiness_for_error(error: ChatError) -> ChatStorageReadiness {
    match error {
        ChatError::DatabaseReadOnly => ChatStorageReadiness::ReadOnly,
        ChatError::DatabaseFull => ChatStorageReadiness::Full,
        ChatError::DatabaseCorrupt | ChatError::DatabaseUnsafe => ChatStorageReadiness::Corrupt,
        ChatError::MigrationFailed => ChatStorageReadiness::MigrationFailed,
        ChatError::DatabaseBusy
        | ChatError::DatabaseUnavailable
        | ChatError::DatabaseKeyMissing
        | ChatError::SecureStorageUnavailable
        | ChatError::Disabled
        | ChatError::InvalidConfiguration
        | ChatError::InvalidInput
        | ChatError::NotFound
        | ChatError::ScopeDenied
        | ChatError::ProjectUnavailable
        | ChatError::NativePickerUnavailable
        | ChatError::SidecarUnavailable
        | ChatError::ConversationConflict
        | ChatError::OrchestrationUnavailable
        | ChatError::CleanupIncomplete => ChatStorageReadiness::Unavailable,
    }
}

#[tauri::command]
pub async fn chat_foundation_status(
    runtime: State<'_, ChatRuntime>,
) -> Result<ChatFoundationStatus, ChatCommandError> {
    runtime.foundation_status().await.map_err(Into::into)
}

#[tauri::command]
pub async fn chat_pick_project(
    runtime: State<'_, ChatRuntime>,
) -> Result<Option<database::ProjectSummary>, ChatCommandError> {
    runtime.pick_project().await.map_err(Into::into)
}

#[tauri::command]
pub async fn chat_revalidate_project(
    project_id: String,
    runtime: State<'_, ChatRuntime>,
) -> Result<database::ProjectSummary, ChatCommandError> {
    runtime
        .revalidate_project(project_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn chat_list_projects(
    runtime: State<'_, ChatRuntime>,
) -> Result<Vec<database::ProjectSummary>, ChatCommandError> {
    runtime.list_projects().await.map_err(Into::into)
}

#[tauri::command]
pub async fn chat_remove_project(
    project_id: String,
    runtime: State<'_, ChatRuntime>,
) -> Result<(), ChatCommandError> {
    runtime.remove_project(project_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn chat_start_local_host(
    runtime: State<'_, ChatRuntime>,
) -> Result<SidecarState, ChatCommandError> {
    runtime.start_sidecar().await.map_err(Into::into)
}

#[tauri::command]
pub async fn chat_stop_local_host(
    runtime: State<'_, ChatRuntime>,
) -> Result<SidecarState, ChatCommandError> {
    runtime.stop_sidecar().await.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "feat126-s10-driver")]
    use uuid::Uuid;

    #[cfg(feature = "feat126-s10-driver")]
    fn resumed_session(candidate: &database::Feat126ResumeCandidate) -> HostSession {
        HostSession {
            task_id: candidate.task_id,
            agent_session_id: candidate.agent_session_id,
            codex_thread_id: Some(candidate.codex_thread_id),
            active_turn_id: None,
            state: HostSessionState::Idle,
            cwd: PathBuf::from("/private/tmp/feat126-synthetic-project"),
            model_ready: true,
            failure_code: None,
            created_at: "2026-08-15T00:00:00Z".to_owned(),
            updated_at: "2026-08-15T00:00:01Z".to_owned(),
        }
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn r8_resume_projection_accepts_only_exact_idle_terminal_identity() {
        let candidate = database::Feat126ResumeCandidate {
            task_id: Uuid::now_v7(),
            agent_session_id: Uuid::now_v7(),
            codex_thread_id: Uuid::now_v7(),
        };
        let valid = resumed_session(&candidate);
        assert_eq!(validate_feat126_resumed_session(&candidate, &valid), Ok(()));

        let mut mismatched = resumed_session(&candidate);
        mismatched.codex_thread_id = Some(Uuid::now_v7());
        assert_eq!(
            validate_feat126_resumed_session(&candidate, &mismatched),
            Err(ChatError::SidecarUnavailable)
        );
        let mut active = resumed_session(&candidate);
        active.active_turn_id = Some(Uuid::now_v7());
        active.state = HostSessionState::Active;
        assert_eq!(
            validate_feat126_resumed_session(&candidate, &active),
            Err(ChatError::SidecarUnavailable)
        );
    }

    #[tokio::test]
    async fn disabled_foundation_does_not_open_database_or_sidecar() {
        let runtime = ChatRuntime {
            mode: RuntimeMode::Disabled,
            authorization: None,
            worker: Mutex::new(None),
            initialization: Mutex::new(()),
            sidecar: None,
            host_bridge: Mutex::new(None),
        };
        let status = runtime.foundation_status().await.unwrap();
        assert_eq!(status.state, "disabled");
        assert_eq!(status.schema_version, None);
        assert_eq!(status.contract_commit, CONTRACT_COMMIT);
        assert_eq!(status.sidecar, SidecarState::Disabled);
    }

    #[tokio::test]
    async fn disabled_runtime_projects_one_closed_non_sendable_readiness_state() {
        let runtime = ChatRuntime {
            mode: RuntimeMode::Disabled,
            authorization: None,
            worker: Mutex::new(None),
            initialization: Mutex::new(()),
            sidecar: None,
            host_bridge: Mutex::new(None),
        };
        let readiness = runtime.local_readiness(false).await;
        assert_eq!(readiness.lifecycle, ChatReadinessLifecycle::Blocked);
        assert_eq!(readiness.host, ChatHostReadiness::Unavailable);
        assert_eq!(readiness.runtime, ChatRuntimeReadiness::Unavailable);
        assert_eq!(readiness.storage, ChatStorageReadiness::Unavailable);
        assert!(!readiness.can_send);
        assert_eq!(readiness.issue_code, Some("chat_storage_unavailable"));
        let encoded = serde_json::to_string(&readiness).unwrap();
        for forbidden in ["bearer", "sqlcipher", "projectPath", "binary", "token"] {
            assert!(!encoded.contains(forbidden));
        }
    }
}
