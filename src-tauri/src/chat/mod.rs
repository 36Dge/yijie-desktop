mod application;
mod authorization;
mod database;
mod error;
mod host_bridge;
mod host_domain;
pub(crate) mod ipc;
mod keychain;
mod migrations;
mod native_project;
mod sidecar;
mod worker;

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
    PendingConversation, ProjectSummary, ReasoningItem, ReasoningPart, ReasoningStatus,
    RecoverySnapshot, SessionPage, SessionPageCursor, SessionSummary, SessionTitleSource,
    StartTurnDispatch, StoredEventCursor, TerminalTurnCommit, TurnProgress,
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
use serde::Serialize;
use sidecar::{SidecarState, SidecarSupervisor};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use worker::DatabaseWorker;

const CONTRACT_COMMIT: &str = "29317b6426578749dc698fc2ad32b986ee5c8e9f";

#[derive(Clone)]
struct LocalChatConfig {
    chat_directory: PathBuf,
    scope: database::ChatScope,
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

impl ChatRuntime {
    pub fn from_environment(app_data_directory: PathBuf) -> Self {
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
        let mut mode = if std::env::var("YIJIE_ENV").as_deref() != Ok("local") {
            RuntimeMode::Invalid
        } else {
            match (
                std::env::var("YIJIE_CHAT_LOCAL_OWNER_USER_ID"),
                std::env::var("YIJIE_CHAT_LOCAL_TENANT_ID"),
            ) {
                (Ok(owner), Ok(tenant)) => match database::ChatScope::new(owner, tenant) {
                    Ok(scope) => RuntimeMode::Local(LocalChatConfig {
                        chat_directory: app_data_directory.join("chat"),
                        scope,
                    }),
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
            let key_store = ProtectedDatabaseKeyStore::new()?;
            let receipt_key_store = ProtectedReceiptKeyStore::new()?;
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

    async fn pick_project(&self) -> Result<Option<database::ProjectSummary>, ChatError> {
        let worker = self.database().await?;
        let Some(selection) = native_project::pick_project().await? else {
            return Ok(None);
        };
        worker
            .register_project(selection.canonical_path, selection.bookmark)
            .await
            .map(Some)
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
        Ok(ConversationApplication::new(database, host))
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
}
