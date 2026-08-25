use super::catalog::{load_catalog, CatalogError, SkillCatalog, SkillCatalogEntry};
use super::SkillRoots;
use crate::chat::{
    ChatError, ChatRuntime, HostBridge, HostBridgeError, HostBridgeErrorKind, HostErrorCode,
    HostManagedSkill, HostSkillSnapshot,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

const IPC_SCHEMA_VERSION: u8 = 1;

enum SkillRuntimeMode {
    Disabled,
    Unavailable,
    Ready {
        roots: SkillRoots,
        catalog: SkillCatalog,
    },
}

pub struct SkillRuntime {
    mode: SkillRuntimeMode,
}

impl SkillRuntime {
    pub(crate) const fn disabled() -> Self {
        Self {
            mode: SkillRuntimeMode::Disabled,
        }
    }

    pub(crate) const fn unavailable() -> Self {
        Self {
            mode: SkillRuntimeMode::Unavailable,
        }
    }

    pub(crate) fn from_roots(roots: SkillRoots) -> Self {
        let mode = match load_catalog(&roots) {
            Ok(catalog) => SkillRuntimeMode::Ready { roots, catalog },
            Err(CatalogError::Unavailable | CatalogError::Invalid) => SkillRuntimeMode::Unavailable,
        };
        Self { mode }
    }

    pub(crate) fn roots(&self) -> Option<SkillRoots> {
        match &self.mode {
            SkillRuntimeMode::Ready { roots, .. } => Some(roots.clone()),
            SkillRuntimeMode::Disabled | SkillRuntimeMode::Unavailable => None,
        }
    }

    fn catalog(&self) -> Result<&SkillCatalog, SkillCommandError> {
        match &self.mode {
            SkillRuntimeMode::Ready { catalog, .. } => Ok(catalog),
            SkillRuntimeMode::Disabled => Err(SkillCommandError::disabled()),
            SkillRuntimeMode::Unavailable => Err(SkillCommandError::resource_unavailable()),
        }
    }

    async fn host(
        &self,
        chat: &ChatRuntime,
    ) -> Result<std::sync::Arc<HostBridge>, SkillCommandError> {
        self.catalog()?;
        chat.ensure_demo_fast_sidecar()
            .await
            .map_err(SkillCommandError::from_chat)?;
        chat.local_host_bridge()
            .await
            .map_err(SkillCommandError::from_chat)
    }

    async fn list(&self, chat: &ChatRuntime) -> Result<SkillSnapshotDto, SkillCommandError> {
        let catalog = self.catalog()?;
        let host = self.host(chat).await?;
        let snapshot = host
            .list_managed_skills()
            .await
            .map_err(SkillCommandError::from_host)?;
        merge_snapshot(catalog, snapshot)
    }

    async fn scan(
        &self,
        chat: &ChatRuntime,
        reason: &str,
    ) -> Result<SkillSnapshotDto, SkillCommandError> {
        if !matches!(
            reason,
            "startup"
                | "page_open"
                | "app_upgrade"
                | "window_resume"
                | "directory_changed"
                | "user_retry"
        ) {
            return Err(SkillCommandError::invalid_request());
        }
        let catalog = self.catalog()?;
        let host = self.host(chat).await?;
        let snapshot = host
            .scan_managed_skills(Uuid::now_v7(), reason)
            .await
            .map_err(SkillCommandError::from_host)?;
        merge_snapshot(catalog, snapshot)
    }

    async fn install(
        &self,
        chat: &ChatRuntime,
        skill_id: &str,
    ) -> Result<SkillSnapshotDto, SkillCommandError> {
        let catalog = self.catalog()?;
        let entry = catalog
            .entries
            .iter()
            .find(|entry| entry.id == skill_id)
            .ok_or_else(SkillCommandError::not_found)?;
        let host = self.host(chat).await?;
        let before = host
            .list_managed_skills()
            .await
            .map_err(SkillCommandError::from_host)?;
        validate_host_snapshot(catalog, &before)?;
        host.install_managed_skill(
            skill_id,
            Uuid::now_v7(),
            &entry.version,
            &entry.archive_sha256,
            &before.catalog_revision,
        )
        .await
        .map_err(SkillCommandError::from_host)?;
        self.list(chat).await
    }

    async fn set_enabled(
        &self,
        chat: &ChatRuntime,
        skill_id: &str,
        enabled: bool,
    ) -> Result<SkillSnapshotDto, SkillCommandError> {
        self.require_catalog_entry(skill_id)?;
        let host = self.host(chat).await?;
        host.set_managed_skill_enabled(skill_id, Uuid::now_v7(), enabled)
            .await
            .map_err(SkillCommandError::from_host)?;
        self.list(chat).await
    }

    async fn uninstall(
        &self,
        chat: &ChatRuntime,
        skill_id: &str,
    ) -> Result<SkillSnapshotDto, SkillCommandError> {
        self.require_catalog_entry(skill_id)?;
        let host = self.host(chat).await?;
        host.uninstall_managed_skill(skill_id, Uuid::now_v7())
            .await
            .map_err(SkillCommandError::from_host)?;
        self.list(chat).await
    }

    fn require_catalog_entry(&self, skill_id: &str) -> Result<(), SkillCommandError> {
        if self
            .catalog()?
            .entries
            .iter()
            .any(|entry| entry.id == skill_id)
        {
            Ok(())
        } else {
            Err(SkillCommandError::not_found())
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSnapshotDto {
    schema_version: u8,
    scanned_at: String,
    skills: Vec<SkillDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SkillDto {
    id: String,
    runtime_name: String,
    category: String,
    order: u16,
    display_name: String,
    description: String,
    version: String,
    icon_key: String,
    risk_level: String,
    risk_reasons: Vec<String>,
    source_type: String,
    license_expression: String,
    execution_mode: String,
    network_access: String,
    filesystem_access: String,
    required_tools: Vec<String>,
    catalog_status: String,
    maintenance_status: String,
    capability_readiness: String,
    installation_status: String,
    enabled: bool,
    runtime_visible: bool,
    failure_code: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillCommandError {
    code: &'static str,
    retryable: bool,
    recovery: &'static str,
}

impl SkillCommandError {
    const fn new(code: &'static str, retryable: bool, recovery: &'static str) -> Self {
        Self {
            code,
            retryable,
            recovery,
        }
    }

    const fn disabled() -> Self {
        Self::new("skill_marketplace_disabled", false, "use_local_demo_fast")
    }

    const fn resource_unavailable() -> Self {
        Self::new(
            "skill_resource_unavailable",
            false,
            "reinstall_or_restart_app",
        )
    }

    const fn invalid_request() -> Self {
        Self::new("invalid_request", false, "correct_request")
    }

    const fn not_found() -> Self {
        Self::new("skill_not_found", false, "refresh_catalog")
    }

    fn from_chat(error: ChatError) -> Self {
        match error {
            ChatError::Disabled => Self::disabled(),
            ChatError::InvalidConfiguration => {
                Self::new("skill_host_configuration_invalid", false, "restart_app")
            }
            ChatError::SecureStorageUnavailable => {
                Self::new("skill_owner_credential_unavailable", true, "restart_app")
            }
            ChatError::SidecarUnavailable => Self::new("skill_host_unavailable", true, "retry"),
            _ => Self::new("skill_host_unavailable", true, "retry"),
        }
    }

    fn from_host(error: HostBridgeError) -> Self {
        match error.kind() {
            HostBridgeErrorKind::TokenUnavailable => {
                Self::new("skill_owner_credential_unavailable", true, "restart_app")
            }
            HostBridgeErrorKind::NotReady | HostBridgeErrorKind::Transport => {
                Self::new("skill_host_unavailable", true, "retry")
            }
            HostBridgeErrorKind::Rejected => match error.code() {
                Some(HostErrorCode::Unauthorized) => Self::new("unauthorized", true, "restart_app"),
                Some(HostErrorCode::CapabilityDenied) => {
                    Self::new("capability_denied", false, "refresh_permissions")
                }
                Some(HostErrorCode::InvalidRequest) => Self::invalid_request(),
                Some(HostErrorCode::SkillNotFound) => Self::not_found(),
                Some(HostErrorCode::SkillBusy) => Self::new("skill_busy", true, "retry"),
                Some(HostErrorCode::SkillOperationConflict) => {
                    Self::new("skill_operation_conflict", true, "refresh_catalog")
                }
                Some(HostErrorCode::SkillNotInstallable) => {
                    Self::new("skill_not_installable", false, "refresh_catalog")
                }
                Some(HostErrorCode::BundleMissing) => {
                    Self::new("bundle_missing", false, "reinstall_or_restart_app")
                }
                Some(HostErrorCode::BundleManifestInvalid) => {
                    Self::new("bundle_manifest_invalid", false, "reinstall_or_restart_app")
                }
                Some(HostErrorCode::ArchiveChecksumMismatch) => Self::new(
                    "archive_checksum_mismatch",
                    false,
                    "reinstall_or_restart_app",
                ),
                Some(HostErrorCode::ArchiveUnsafe) => {
                    Self::new("archive_unsafe", false, "reinstall_or_restart_app")
                }
                Some(HostErrorCode::ArchiveTooLarge) => {
                    Self::new("archive_too_large", false, "reinstall_or_restart_app")
                }
                Some(HostErrorCode::RuntimeUnavailable) => {
                    Self::new("runtime_unavailable", true, "retry")
                }
                Some(HostErrorCode::RuntimeSyncFailed) => {
                    Self::new("runtime_sync_failed", true, "retry")
                }
                Some(HostErrorCode::InstallFailed) => Self::new("install_failed", true, "retry"),
                Some(HostErrorCode::UninstallFailed) => {
                    Self::new("uninstall_failed", true, "retry")
                }
                Some(HostErrorCode::ScanFailed) => Self::new("scan_failed", true, "retry"),
                _ => Self::new("skill_contract_mismatch", false, "update_app"),
            },
            HostBridgeErrorKind::Disabled => Self::disabled(),
            HostBridgeErrorKind::InvalidConfiguration
            | HostBridgeErrorKind::InstanceMismatch
            | HostBridgeErrorKind::AcceptedResponseInvalid
            | HostBridgeErrorKind::Protocol => {
                Self::new("skill_contract_mismatch", false, "update_app")
            }
        }
    }
}

fn merge_snapshot(
    catalog: &SkillCatalog,
    snapshot: HostSkillSnapshot,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    validate_host_snapshot(catalog, &snapshot)?;
    let state_by_id = snapshot
        .skills
        .into_iter()
        .map(|skill| (skill.id.clone(), skill))
        .collect::<HashMap<_, _>>();
    let mut skills = Vec::with_capacity(catalog.entries.len());
    for entry in &catalog.entries {
        let state = state_by_id.get(&entry.id).ok_or_else(contract_mismatch)?;
        skills.push(merge_skill(entry, state));
    }
    skills.sort_by(|first, second| {
        first
            .category
            .cmp(&second.category)
            .then(first.order.cmp(&second.order))
            .then(first.id.cmp(&second.id))
    });
    Ok(SkillSnapshotDto {
        schema_version: IPC_SCHEMA_VERSION,
        scanned_at: snapshot.scanned_at,
        skills,
    })
}

fn validate_host_snapshot(
    catalog: &SkillCatalog,
    snapshot: &HostSkillSnapshot,
) -> Result<(), SkillCommandError> {
    if snapshot.catalog_revision != catalog.revision
        || snapshot.skills.len() != catalog.entries.len()
    {
        return Err(contract_mismatch());
    }
    let catalog_by_id = catalog
        .entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect::<HashMap<_, _>>();
    let mut ids = HashSet::with_capacity(snapshot.skills.len());
    for state in &snapshot.skills {
        let entry = catalog_by_id
            .get(state.id.as_str())
            .ok_or_else(contract_mismatch)?;
        if !ids.insert(state.id.as_str())
            || state.runtime_name != entry.runtime_name
            || state.version != entry.version
            || state.catalog_status != entry.catalog_status
            || state.maintenance_status != entry.maintenance_status
        {
            return Err(contract_mismatch());
        }
    }
    Ok(())
}

fn merge_skill(entry: &SkillCatalogEntry, state: &HostManagedSkill) -> SkillDto {
    SkillDto {
        id: entry.id.clone(),
        runtime_name: entry.runtime_name.clone(),
        category: entry.category.clone(),
        order: entry.order,
        display_name: entry.display_name.clone(),
        description: entry.description.clone(),
        version: entry.version.clone(),
        icon_key: entry.icon_key.clone(),
        risk_level: entry.risk_level.clone(),
        risk_reasons: entry.risk_reasons.clone(),
        source_type: entry.source_type.clone(),
        license_expression: entry.license_expression.clone(),
        execution_mode: entry.execution_mode.clone(),
        network_access: entry.network_access.clone(),
        filesystem_access: entry.filesystem_access.clone(),
        required_tools: entry.required_tools.clone(),
        catalog_status: state.catalog_status.clone(),
        maintenance_status: state.maintenance_status.clone(),
        capability_readiness: state.capability_readiness.clone(),
        installation_status: state.installation_status.clone(),
        enabled: state.enabled,
        runtime_visible: state.runtime_visible,
        failure_code: state.failure_code.clone(),
    }
}

fn contract_mismatch() -> SkillCommandError {
    SkillCommandError::new("skill_contract_mismatch", false, "update_app")
}

#[tauri::command]
pub async fn skills_list_v1(
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    runtime.list(&chat).await
}

#[tauri::command]
pub async fn skills_scan_v1(
    reason: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    runtime.scan(&chat, &reason).await
}

#[tauri::command]
pub async fn skills_install_v1(
    skill_id: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    runtime.install(&chat, &skill_id).await
}

#[tauri::command]
pub async fn skills_set_enabled_v1(
    skill_id: String,
    enabled: bool,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    runtime.set_enabled(&chat, &skill_id, enabled).await
}

#[tauri::command]
pub async fn skills_uninstall_v1(
    skill_id: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<SkillSnapshotDto, SkillCommandError> {
    runtime.uninstall(&chat, &skill_id).await
}

pub(crate) async fn reconcile_background(
    runtime: &SkillRuntime,
    chat: &ChatRuntime,
    reason: &'static str,
) {
    let _ = runtime.scan(chat, reason).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_content_free_and_renderer_safe() {
        assert_eq!(
            serde_json::to_string(&SkillCommandError::resource_unavailable()).unwrap(),
            r#"{"code":"skill_resource_unavailable","retryable":false,"recovery":"reinstall_or_restart_app"}"#
        );
        let fields = serde_json::to_string(&SkillCommandError::from_host(
            HostBridgeError::rejected(HostErrorCode::CapabilityDenied),
        ))
        .unwrap();
        assert!(!fields.contains("path"));
        assert!(!fields.contains("token"));
        assert!(!fields.contains("bearer"));
    }
}
