use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zeroize::{Zeroize, Zeroizing};

const MASTER_ENV: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
const SECURE_STORAGE_ENV: &str = "YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED";
const EPHEMERAL_STORAGE_ENV: &str = "YIJIE_FEAT126_S10_EPHEMERAL_SECRET_BACKEND_ENABLED";
const RUN_ID_ENV: &str = "YIJIE_FEAT126_S10_RUN_ID";
const RUN_ROOT_ENV: &str = "YIJIE_FEAT126_S10_RUN_ROOT";
const FAKE_RESPONSES_ENV: &str = "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL";
const HOST_HOME_ENV: &str = "YIJIE_AGENT_HOST_HOME";
const CODEX_HOME_ENV: &str = "YIJIE_CODEX_HOME";
const FAKE_RESPONSES_BASE_URL: &str = "http://127.0.0.1:18082/v1";
const KEYCHAIN_MANIFEST_SCHEMA_VERSION: u16 = 1;
const EPHEMERAL_MANIFEST_SCHEMA_VERSION: u16 = 2;
const MANIFEST_DIRECTORY: &str = "secure-storage";
const MANIFEST_FILE: &str = "manifest.json";
const EPHEMERAL_SECRET_DIRECTORY: &str = "ephemeral-secrets";
const DESKTOP_APP_DATA_DIRECTORY: &str = "desktop-app-data";
const HOST_HOME_DIRECTORY: &str = "host-home";
const CODEX_HOME_DIRECTORY: &str = "codex-home";
const PROJECT_DIRECTORY: &str = "project";
const KEYCHAIN_ACCOUNT: &str = "default-v1";
const NATIVE_AUTH_ACCOUNT: &str = "refresh-token-family-v2";
const SECRET_FILE_MAGIC: &[u8; 8] = b"YJ126S1\0";
const SECRET_FILE_HEADER_BYTES: usize = 14;
const MAX_NATIVE_AUTH_SECRET_BYTES: usize = 16 << 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SecureStorageError {
    InvalidConfiguration,
    Unavailable,
    ConcurrentRun,
    CleanupRefused,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StorageBackendKind {
    ProtectedDataKeychain,
    EphemeralFile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EphemeralSecretRole {
    ChatSqlcipher,
    ReceiptHmac,
    NativeAuth,
}

impl EphemeralSecretRole {
    const ALL: [Self; 3] = [Self::ChatSqlcipher, Self::ReceiptHmac, Self::NativeAuth];

    const fn name(self) -> &'static str {
        match self {
            Self::ChatSqlcipher => "chat_sqlcipher",
            Self::ReceiptHmac => "receipt_hmac",
            Self::NativeAuth => "native_auth",
        }
    }

    const fn basename(self) -> &'static str {
        match self {
            Self::ChatSqlcipher => "chat-sqlcipher-v1.secret",
            Self::ReceiptHmac => "receipt-hmac-v1.secret",
            Self::NativeAuth => "native-auth-v1.secret",
        }
    }

    const fn tag(self) -> u8 {
        match self {
            Self::ChatSqlcipher => 1,
            Self::ReceiptHmac => 2,
            Self::NativeAuth => 3,
        }
    }

    const fn max_payload_bytes(self) -> usize {
        match self {
            Self::ChatSqlcipher | Self::ReceiptHmac => 32,
            Self::NativeAuth => MAX_NATIVE_AUTH_SECRET_BYTES,
        }
    }

    fn validate_payload(self, payload: &[u8]) -> Result<(), SecureStorageError> {
        let valid = match self {
            Self::ChatSqlcipher | Self::ReceiptHmac => payload.len() == 32,
            Self::NativeAuth => {
                !payload.is_empty() && payload.len() <= MAX_NATIVE_AUTH_SECRET_BYTES
            }
        };
        if valid {
            Ok(())
        } else {
            Err(SecureStorageError::InvalidConfiguration)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ManifestPhase {
    Prepared,
    Active,
    CleanupPending,
    Complete,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct KeychainNamespace {
    role: &'static str,
    service: String,
    account: &'static str,
}

impl KeychainNamespace {
    pub(crate) fn service(&self) -> &str {
        &self.service
    }

    pub(crate) fn account(&self) -> &str {
        self.account
    }
}

#[derive(Clone)]
pub(crate) struct Feat126SecureStorageProfile {
    run_id: String,
    run_root: PathBuf,
    desktop_app_data: PathBuf,
    host_home: PathBuf,
    codex_home: PathBuf,
    project: PathBuf,
    manifest_path: PathBuf,
    secret_directory: PathBuf,
    namespaces: [KeychainNamespace; 3],
    descriptor_sha256: String,
    secret_descriptor_sha256: String,
    backend: StorageBackendKind,
}

impl std::fmt::Debug for Feat126SecureStorageProfile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Feat126SecureStorageProfile")
            .field("run_id", &self.run_id)
            .field("run_root", &"[RUN_SCOPED]")
            .field("backend", &self.backend)
            .field("namespace_descriptor", &self.descriptor_sha256)
            .field("secret_descriptor", &self.secret_descriptor_sha256)
            .finish()
    }
}

#[derive(Clone)]
pub(crate) enum Feat126SecureStorageBootstrap {
    Disabled,
    Invalid,
    Ready(Arc<Feat126SecureStorageProfile>),
}

impl Feat126SecureStorageBootstrap {
    pub(crate) fn from_environment() -> Self {
        match Feat126SecureStorageProfile::from_environment() {
            Ok(None) => Self::Disabled,
            Err(_) => Self::Invalid,
            Ok(Some(profile)) => match profile.prepare() {
                Ok(()) => Self::Ready(Arc::new(profile)),
                Err(_) => Self::Invalid,
            },
        }
    }

    pub(crate) fn profile(&self) -> Option<Arc<Feat126SecureStorageProfile>> {
        match self {
            Self::Ready(profile) => Some(profile.clone()),
            Self::Disabled | Self::Invalid => None,
        }
    }

    pub(crate) fn is_invalid(&self) -> bool {
        matches!(self, Self::Invalid)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct SecureStorageManifest {
    schema_version: u16,
    run_id: String,
    owner_uid: u32,
    namespace_descriptor_sha256: String,
    directory_roles: Vec<String>,
    phase: ManifestPhase,
    desktop_pid: Option<u32>,
    recovery_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    storage_backend: Option<StorageBackendKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret_descriptor_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    secret_roles: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum InventoryState {
    Absent,
    Present,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct InventoryItemEvidence {
    role: &'static str,
    state: InventoryState,
    schema_valid: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageEvidence {
    schema_version: u16,
    run_id: String,
    namespace_descriptor_sha256: String,
    status_digest_sha256: String,
    items: Vec<InventoryItemEvidence>,
    cleanup_complete: bool,
}

#[derive(Clone)]
pub(crate) struct EphemeralSecretFile {
    profile: Arc<Feat126SecureStorageProfile>,
    role: EphemeralSecretRole,
    path: PathBuf,
}

impl std::fmt::Debug for EphemeralSecretFile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("EphemeralSecretFile")
            .field("role", &self.role)
            .field("path", &"[RUN_SCOPED]")
            .finish()
    }
}

impl Feat126SecureStorageProfile {
    pub(crate) fn from_environment() -> Result<Option<Self>, SecureStorageError> {
        let master = std::env::var(MASTER_ENV).unwrap_or_default();
        let secure_storage = std::env::var(SECURE_STORAGE_ENV).unwrap_or_default();
        let ephemeral_storage = std::env::var(EPHEMERAL_STORAGE_ENV).unwrap_or_default();
        let run_id = std::env::var(RUN_ID_ENV).unwrap_or_default();
        let run_root = std::env::var(RUN_ROOT_ENV).unwrap_or_default();
        let fake_responses = std::env::var(FAKE_RESPONSES_ENV).unwrap_or_default();

        let Some(backend) = storage_backend_gate(
            &master,
            &secure_storage,
            &ephemeral_storage,
            !run_id.is_empty() || !run_root.is_empty() || !fake_responses.is_empty(),
        )?
        else {
            return Ok(None);
        };
        let parsed =
            uuid::Uuid::parse_str(&run_id).map_err(|_| SecureStorageError::InvalidConfiguration)?;
        if parsed.is_nil()
            || parsed.hyphenated().to_string() != run_id
            || fake_responses != FAKE_RESPONSES_BASE_URL
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        let run_root = validate_profile_run_root(Path::new(&run_root), backend, &run_id)?;
        let desktop_app_data = run_root.join(DESKTOP_APP_DATA_DIRECTORY);
        let host_home = run_root.join(HOST_HOME_DIRECTORY);
        let codex_home = run_root.join(CODEX_HOME_DIRECTORY);
        let project = run_root.join(PROJECT_DIRECTORY);
        require_exact_environment_path(HOST_HOME_ENV, &host_home)?;
        require_exact_environment_path(CODEX_HOME_ENV, &codex_home)?;

        let prefix = format!("com.yijie.ai.test.feat126.{run_id}");
        let namespaces = [
            KeychainNamespace {
                role: "chat_db",
                service: format!("{prefix}.chat-db"),
                account: KEYCHAIN_ACCOUNT,
            },
            KeychainNamespace {
                role: "chat_receipt",
                service: format!("{prefix}.chat-receipt"),
                account: KEYCHAIN_ACCOUNT,
            },
            KeychainNamespace {
                role: "native_auth",
                service: format!("{prefix}.native-auth"),
                account: NATIVE_AUTH_ACCOUNT,
            },
        ];
        let descriptor_sha256 = namespace_descriptor_sha256(&namespaces);
        let manifest_path = run_root.join(MANIFEST_DIRECTORY).join(MANIFEST_FILE);
        let secret_directory = run_root
            .join(MANIFEST_DIRECTORY)
            .join(EPHEMERAL_SECRET_DIRECTORY);
        let secret_descriptor_sha256 = ephemeral_secret_descriptor_sha256();
        Ok(Some(Self {
            run_id,
            run_root,
            desktop_app_data,
            host_home,
            codex_home,
            project,
            manifest_path,
            secret_directory,
            namespaces,
            descriptor_sha256,
            secret_descriptor_sha256,
            backend,
        }))
    }

    pub(crate) fn desktop_app_data(&self) -> &Path {
        &self.desktop_app_data
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn run_id(&self) -> &str {
        &self.run_id
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn run_root(&self) -> &Path {
        &self.run_root
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn project_path(&self) -> &Path {
        &self.project
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn expected_infra_secrets_path(&self) -> PathBuf {
        self.run_root.join("infra-secrets.env")
    }

    pub(crate) fn database_namespace(&self) -> &KeychainNamespace {
        &self.namespaces[0]
    }

    pub(crate) fn receipt_namespace(&self) -> &KeychainNamespace {
        &self.namespaces[1]
    }

    pub(crate) fn native_auth_namespace(&self) -> &KeychainNamespace {
        &self.namespaces[2]
    }

    pub(crate) fn uses_ephemeral_backend(&self) -> bool {
        self.backend == StorageBackendKind::EphemeralFile
    }

    pub(crate) fn ephemeral_secret_file(
        self: &Arc<Self>,
        role: EphemeralSecretRole,
    ) -> Option<EphemeralSecretFile> {
        self.uses_ephemeral_backend().then(|| EphemeralSecretFile {
            profile: self.clone(),
            role,
            path: self.secret_directory.join(role.basename()),
        })
    }

    pub(crate) fn validate_project_path(&self, path: &Path) -> Result<(), SecureStorageError> {
        let path = validate_private_directory(path)?;
        if path != self.project {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        Ok(())
    }

    #[cfg(feature = "feat126-s10-driver")]
    pub(crate) fn validate_fixed_project(&self) -> Result<(), SecureStorageError> {
        self.validate_project_path(&self.project)
    }

    pub(crate) fn validate_child_homes(
        &self,
        host_home: &Path,
        codex_home: Option<&Path>,
    ) -> Result<(), SecureStorageError> {
        if host_home != self.host_home || codex_home != Some(self.codex_home.as_path()) {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        Ok(())
    }

    fn prepare(&self) -> Result<(), SecureStorageError> {
        let mut paths = vec![
            &self.desktop_app_data,
            &self.host_home,
            &self.codex_home,
            &self.project,
            self.manifest_path
                .parent()
                .ok_or(SecureStorageError::InvalidConfiguration)?,
        ];
        if self.uses_ephemeral_backend() {
            paths.push(&self.secret_directory);
        }
        for path in paths {
            create_or_validate_private_directory(path)?;
        }
        match self.backend {
            StorageBackendKind::ProtectedDataKeychain => {
                let backend = PlatformExactKeychain::new()?;
                self.prepare_with_backend(&backend)
            }
            StorageBackendKind::EphemeralFile => self.prepare_ephemeral(),
        }
    }

    fn prepare_with_backend(&self, backend: &dyn ExactKeychain) -> Result<(), SecureStorageError> {
        let existing = read_manifest(&self.manifest_path)?;
        let mut manifest = match existing {
            None => {
                let evidence = self.inventory_with_backend(backend, false)?;
                if evidence
                    .items
                    .iter()
                    .any(|item| item.state != InventoryState::Absent)
                {
                    return Err(SecureStorageError::InvalidConfiguration);
                }
                SecureStorageManifest {
                    schema_version: KEYCHAIN_MANIFEST_SCHEMA_VERSION,
                    run_id: self.run_id.clone(),
                    owner_uid: effective_uid(),
                    namespace_descriptor_sha256: self.descriptor_sha256.clone(),
                    directory_roles: directory_roles(self.backend),
                    phase: ManifestPhase::Prepared,
                    desktop_pid: None,
                    recovery_count: 0,
                    storage_backend: None,
                    secret_descriptor_sha256: None,
                    secret_roles: Vec::new(),
                }
            }
            Some(manifest) => {
                self.validate_manifest(&manifest)?;
                if manifest.phase == ManifestPhase::Complete {
                    return Err(SecureStorageError::CleanupRefused);
                }
                manifest
            }
        };
        if let Some(pid) = manifest.desktop_pid {
            if pid != std::process::id() && process_is_alive(pid) {
                return Err(SecureStorageError::ConcurrentRun);
            }
            if pid != std::process::id() {
                manifest.recovery_count = manifest.recovery_count.saturating_add(1);
            }
        }
        manifest.phase = ManifestPhase::Active;
        manifest.desktop_pid = Some(std::process::id());
        write_manifest(&self.manifest_path, &manifest)
    }

    fn prepare_ephemeral(&self) -> Result<(), SecureStorageError> {
        if !self.uses_ephemeral_backend() {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        validate_secret_directory_entries(&self.secret_directory)?;
        let existing = read_manifest(&self.manifest_path)?;
        let mut manifest = match existing {
            None => {
                let evidence = self.inventory_ephemeral(false)?;
                if evidence
                    .items
                    .iter()
                    .any(|item| item.state != InventoryState::Absent)
                {
                    return Err(SecureStorageError::InvalidConfiguration);
                }
                SecureStorageManifest {
                    schema_version: EPHEMERAL_MANIFEST_SCHEMA_VERSION,
                    run_id: self.run_id.clone(),
                    owner_uid: effective_uid(),
                    namespace_descriptor_sha256: self.descriptor_sha256.clone(),
                    directory_roles: directory_roles(self.backend),
                    phase: ManifestPhase::Prepared,
                    desktop_pid: None,
                    recovery_count: 0,
                    storage_backend: Some(StorageBackendKind::EphemeralFile),
                    secret_descriptor_sha256: Some(self.secret_descriptor_sha256.clone()),
                    secret_roles: ephemeral_secret_roles(),
                }
            }
            Some(manifest) => {
                self.validate_manifest(&manifest)?;
                if manifest.phase == ManifestPhase::Complete {
                    return Err(SecureStorageError::CleanupRefused);
                }
                manifest
            }
        };
        if self
            .inventory_ephemeral(false)?
            .items
            .iter()
            .any(|item| item.state == InventoryState::Present && !item.schema_valid)
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        if let Some(pid) = manifest.desktop_pid {
            if pid != std::process::id() && process_is_alive(pid) {
                return Err(SecureStorageError::ConcurrentRun);
            }
            if pid != std::process::id() {
                manifest.recovery_count = manifest.recovery_count.saturating_add(1);
            }
        }
        manifest.phase = ManifestPhase::Active;
        manifest.desktop_pid = Some(std::process::id());
        write_manifest(&self.manifest_path, &manifest)
    }

    fn validate_manifest(
        &self,
        manifest: &SecureStorageManifest,
    ) -> Result<(), SecureStorageError> {
        let expected_schema = match self.backend {
            StorageBackendKind::ProtectedDataKeychain => KEYCHAIN_MANIFEST_SCHEMA_VERSION,
            StorageBackendKind::EphemeralFile => EPHEMERAL_MANIFEST_SCHEMA_VERSION,
        };
        let backend_fields_valid = match self.backend {
            StorageBackendKind::ProtectedDataKeychain => {
                manifest.storage_backend.is_none()
                    && manifest.secret_descriptor_sha256.is_none()
                    && manifest.secret_roles.is_empty()
            }
            StorageBackendKind::EphemeralFile => {
                manifest.storage_backend == Some(StorageBackendKind::EphemeralFile)
                    && manifest.secret_descriptor_sha256.as_deref()
                        == Some(self.secret_descriptor_sha256.as_str())
                    && manifest.secret_roles == ephemeral_secret_roles()
            }
        };
        if manifest.schema_version != expected_schema
            || manifest.run_id != self.run_id
            || manifest.owner_uid != effective_uid()
            || manifest.namespace_descriptor_sha256 != self.descriptor_sha256
            || manifest.directory_roles != directory_roles(self.backend)
            || !backend_fields_valid
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        let mut paths = vec![
            &self.run_root,
            &self.desktop_app_data,
            &self.host_home,
            &self.codex_home,
            &self.project,
            self.manifest_path
                .parent()
                .ok_or(SecureStorageError::InvalidConfiguration)?,
        ];
        if self.uses_ephemeral_backend() {
            paths.push(&self.secret_directory);
        }
        for path in paths {
            validate_private_directory(path)?;
        }
        Ok(())
    }

    fn inventory_with_backend(
        &self,
        backend: &dyn ExactKeychain,
        cleanup_complete: bool,
    ) -> Result<SecureStorageEvidence, SecureStorageError> {
        let mut items = Vec::with_capacity(self.namespaces.len());
        for namespace in &self.namespaces {
            items.push(InventoryItemEvidence {
                role: namespace.role,
                state: backend.state(namespace)?,
                schema_valid: true,
            });
        }
        let encoded = serde_json::to_vec(&items).map_err(|_| SecureStorageError::Unavailable)?;
        Ok(SecureStorageEvidence {
            schema_version: KEYCHAIN_MANIFEST_SCHEMA_VERSION,
            run_id: self.run_id.clone(),
            namespace_descriptor_sha256: self.descriptor_sha256.clone(),
            status_digest_sha256: format!("{:x}", Sha256::digest(encoded)),
            items,
            cleanup_complete,
        })
    }

    fn cleanup_with_backend(
        &self,
        backend: &dyn ExactKeychain,
        remove_root: bool,
    ) -> Result<SecureStorageEvidence, SecureStorageError> {
        let mut manifest =
            read_manifest(&self.manifest_path)?.ok_or(SecureStorageError::CleanupRefused)?;
        self.validate_manifest(&manifest)?;
        if let Some(pid) = manifest.desktop_pid {
            if process_is_alive(pid) {
                return Err(SecureStorageError::ConcurrentRun);
            }
        }
        manifest.phase = ManifestPhase::CleanupPending;
        manifest.desktop_pid = None;
        write_manifest(&self.manifest_path, &manifest)?;
        for namespace in &self.namespaces {
            backend.delete(namespace)?;
        }
        let evidence = self.inventory_with_backend(backend, true)?;
        if evidence
            .items
            .iter()
            .any(|item| item.state != InventoryState::Absent)
        {
            return Err(SecureStorageError::CleanupRefused);
        }
        manifest.phase = ManifestPhase::Complete;
        write_manifest(&self.manifest_path, &manifest)?;
        if remove_root {
            validate_profile_run_root(&self.run_root, self.backend, &self.run_id)?;
            fs::remove_dir_all(&self.run_root).map_err(|_| SecureStorageError::CleanupRefused)?;
        }
        Ok(evidence)
    }

    fn inventory_ephemeral(
        &self,
        cleanup_complete: bool,
    ) -> Result<SecureStorageEvidence, SecureStorageError> {
        if !self.uses_ephemeral_backend() {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        validate_private_directory(&self.secret_directory)?;
        validate_secret_directory_entries(&self.secret_directory)?;
        let mut items = Vec::with_capacity(EphemeralSecretRole::ALL.len());
        for role in EphemeralSecretRole::ALL {
            let path = self.secret_directory.join(role.basename());
            let (state, schema_valid) = inspect_secret_file(&path, role)?;
            items.push(InventoryItemEvidence {
                role: role.name(),
                state,
                schema_valid,
            });
        }
        let encoded = serde_json::to_vec(&items).map_err(|_| SecureStorageError::Unavailable)?;
        Ok(SecureStorageEvidence {
            schema_version: EPHEMERAL_MANIFEST_SCHEMA_VERSION,
            run_id: self.run_id.clone(),
            namespace_descriptor_sha256: self.secret_descriptor_sha256.clone(),
            status_digest_sha256: format!("{:x}", Sha256::digest(encoded)),
            items,
            cleanup_complete,
        })
    }

    fn cleanup_ephemeral(
        &self,
        remove_root: bool,
    ) -> Result<SecureStorageEvidence, SecureStorageError> {
        let mut manifest =
            read_manifest(&self.manifest_path)?.ok_or(SecureStorageError::CleanupRefused)?;
        self.validate_manifest(&manifest)?;
        if let Some(pid) = manifest.desktop_pid {
            if process_is_alive(pid) {
                return Err(SecureStorageError::ConcurrentRun);
            }
        }
        validate_run_root_entries(self)?;
        validate_manifest_directory_entries(self)?;
        validate_secret_directory_entries(&self.secret_directory)?;
        for role in EphemeralSecretRole::ALL {
            validate_secret_file_for_delete(&self.secret_directory.join(role.basename()))?;
        }
        manifest.phase = ManifestPhase::CleanupPending;
        manifest.desktop_pid = None;
        write_manifest(&self.manifest_path, &manifest)?;
        for role in EphemeralSecretRole::ALL {
            remove_secret_file_if_present(&self.secret_directory.join(role.basename()))?;
        }
        let evidence = self.inventory_ephemeral(true)?;
        if evidence
            .items
            .iter()
            .any(|item| item.state != InventoryState::Absent)
        {
            return Err(SecureStorageError::CleanupRefused);
        }
        manifest.phase = ManifestPhase::Complete;
        write_manifest(&self.manifest_path, &manifest)?;
        if remove_root {
            remove_verified_empty_run_root(self)?;
        }
        Ok(evidence)
    }
}

fn storage_backend_gate(
    master: &str,
    secure_storage: &str,
    ephemeral_storage: &str,
    test_context_present: bool,
) -> Result<Option<StorageBackendKind>, SecureStorageError> {
    if master != "true" {
        if (!master.is_empty() && master != "false")
            || (!secure_storage.is_empty() && secure_storage != "false")
            || (!ephemeral_storage.is_empty() && ephemeral_storage != "false")
            || test_context_present
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        return Ok(None);
    }
    if !matches!(secure_storage, "" | "false" | "true")
        || !matches!(ephemeral_storage, "" | "false" | "true")
        || (secure_storage == "true" && ephemeral_storage == "true")
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    match (secure_storage == "true", ephemeral_storage == "true") {
        (true, false) => Ok(Some(StorageBackendKind::ProtectedDataKeychain)),
        (false, true) => Ok(Some(StorageBackendKind::EphemeralFile)),
        (false, false) => Ok(None),
        (true, true) => Err(SecureStorageError::InvalidConfiguration),
    }
}

impl EphemeralSecretFile {
    pub(crate) fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, SecureStorageError> {
        self.validate_active_context()?;
        read_secret_payload(&self.path, self.role)
    }

    pub(crate) fn create(&self, payload: &[u8]) -> Result<(), SecureStorageError> {
        self.validate_active_context()?;
        self.role.validate_payload(payload)?;
        write_secret_payload(&self.path, self.role, payload, true)
    }

    pub(crate) fn replace(&self, payload: &[u8]) -> Result<(), SecureStorageError> {
        self.validate_active_context()?;
        self.role.validate_payload(payload)?;
        write_secret_payload(&self.path, self.role, payload, false)
    }

    pub(crate) fn delete(&self) -> Result<(), SecureStorageError> {
        self.validate_active_context()?;
        remove_secret_file_if_present(&self.path)
    }

    fn validate_active_context(&self) -> Result<(), SecureStorageError> {
        if !self.profile.uses_ephemeral_backend()
            || self.path.parent() != Some(self.profile.secret_directory.as_path())
            || self.path.file_name().and_then(|name| name.to_str()) != Some(self.role.basename())
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        validate_private_directory(&self.profile.secret_directory)?;
        let manifest = read_manifest(&self.profile.manifest_path)?
            .ok_or(SecureStorageError::InvalidConfiguration)?;
        self.profile.validate_manifest(&manifest)?;
        if manifest.phase != ManifestPhase::Active
            || manifest.desktop_pid != Some(std::process::id())
        {
            return Err(SecureStorageError::ConcurrentRun);
        }
        validate_secret_directory_entries(&self.profile.secret_directory)
    }
}

fn encode_secret_file(
    role: EphemeralSecretRole,
    payload: &[u8],
) -> Result<Zeroizing<Vec<u8>>, SecureStorageError> {
    role.validate_payload(payload)?;
    let payload_len =
        u32::try_from(payload.len()).map_err(|_| SecureStorageError::InvalidConfiguration)?;
    let mut encoded = Zeroizing::new(Vec::with_capacity(SECRET_FILE_HEADER_BYTES + payload.len()));
    encoded.extend_from_slice(SECRET_FILE_MAGIC);
    encoded.push(role.tag());
    encoded.push(0);
    encoded.extend_from_slice(&payload_len.to_be_bytes());
    encoded.extend_from_slice(payload);
    Ok(encoded)
}

fn decode_secret_file(
    role: EphemeralSecretRole,
    encoded: &[u8],
) -> Result<Zeroizing<Vec<u8>>, SecureStorageError> {
    if encoded.len() < SECRET_FILE_HEADER_BYTES
        || &encoded[..SECRET_FILE_MAGIC.len()] != SECRET_FILE_MAGIC
        || encoded[8] != role.tag()
        || encoded[9] != 0
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    let payload_len = u32::from_be_bytes(
        encoded[10..14]
            .try_into()
            .map_err(|_| SecureStorageError::InvalidConfiguration)?,
    ) as usize;
    if encoded.len() != SECRET_FILE_HEADER_BYTES + payload_len {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    let payload = Zeroizing::new(encoded[SECRET_FILE_HEADER_BYTES..].to_vec());
    role.validate_payload(payload.as_slice())?;
    Ok(payload)
}

fn validate_secret_metadata(
    metadata: &fs::Metadata,
    expected_uid: u32,
) -> Result<(), SecureStorageError> {
    if !metadata.is_file()
        || metadata.uid() != expected_uid
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(())
}

fn open_secret_file_for_read(
    path: &Path,
    role: EphemeralSecretRole,
) -> Result<Option<fs::File>, SecureStorageError> {
    let path_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(SecureStorageError::InvalidConfiguration),
    };
    if path_metadata.file_type().is_symlink() {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    validate_secret_metadata(&path_metadata, effective_uid())?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| SecureStorageError::InvalidConfiguration)?;
    let metadata = file
        .metadata()
        .map_err(|_| SecureStorageError::InvalidConfiguration)?;
    validate_secret_metadata(&metadata, effective_uid())?;
    if metadata.dev() != path_metadata.dev()
        || metadata.ino() != path_metadata.ino()
        || metadata.len() as usize > SECRET_FILE_HEADER_BYTES + role.max_payload_bytes()
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(Some(file))
}

fn read_secret_payload(
    path: &Path,
    role: EphemeralSecretRole,
) -> Result<Option<Zeroizing<Vec<u8>>>, SecureStorageError> {
    let Some(mut file) = open_secret_file_for_read(path, role)? else {
        return Ok(None);
    };
    let mut encoded = Zeroizing::new(Vec::new());
    std::io::Read::by_ref(&mut file)
        .take((SECRET_FILE_HEADER_BYTES + role.max_payload_bytes() + 1) as u64)
        .read_to_end(&mut encoded)
        .map_err(|_| SecureStorageError::Unavailable)?;
    decode_secret_file(role, encoded.as_slice()).map(Some)
}

fn write_secret_payload(
    path: &Path,
    role: EphemeralSecretRole,
    payload: &[u8],
    require_absent: bool,
) -> Result<(), SecureStorageError> {
    let mut encoded = encode_secret_file(role, payload)?;
    let existing = fs::symlink_metadata(path);
    match existing {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)
                .map_err(|_| SecureStorageError::Unavailable)?;
            let result = file
                .write_all(encoded.as_slice())
                .and_then(|_| file.sync_all());
            if result.is_err() {
                encoded.zeroize();
                return Err(SecureStorageError::Unavailable);
            }
            validate_secret_metadata(
                &file
                    .metadata()
                    .map_err(|_| SecureStorageError::Unavailable)?,
                effective_uid(),
            )?;
            Ok(())
        }
        Ok(metadata) if require_absent => {
            validate_secret_metadata(&metadata, effective_uid())?;
            Err(SecureStorageError::ConcurrentRun)
        }
        Ok(path_metadata) => {
            if path_metadata.file_type().is_symlink() {
                return Err(SecureStorageError::InvalidConfiguration);
            }
            validate_secret_metadata(&path_metadata, effective_uid())?;
            if read_secret_payload(path, role)?.is_none() {
                return Err(SecureStorageError::InvalidConfiguration);
            }
            let mut file = OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)
                .map_err(|_| SecureStorageError::Unavailable)?;
            let metadata = file
                .metadata()
                .map_err(|_| SecureStorageError::Unavailable)?;
            validate_secret_metadata(&metadata, effective_uid())?;
            if metadata.dev() != path_metadata.dev() || metadata.ino() != path_metadata.ino() {
                return Err(SecureStorageError::InvalidConfiguration);
            }
            file.seek(SeekFrom::Start(0))
                .and_then(|_| file.write_all(encoded.as_slice()))
                .and_then(|_| file.set_len(encoded.len() as u64))
                .and_then(|_| file.sync_all())
                .map_err(|_| SecureStorageError::Unavailable)?;
            Ok(())
        }
        Err(_) => Err(SecureStorageError::Unavailable),
    }
}

fn inspect_secret_file(
    path: &Path,
    role: EphemeralSecretRole,
) -> Result<(InventoryState, bool), SecureStorageError> {
    match read_secret_payload(path, role) {
        Ok(None) => Ok((InventoryState::Absent, true)),
        Ok(Some(_)) => Ok((InventoryState::Present, true)),
        Err(SecureStorageError::InvalidConfiguration) => {
            validate_secret_file_for_delete(path)?;
            Ok((InventoryState::Present, false))
        }
        Err(error) => Err(error),
    }
}

fn validate_secret_file_for_delete(path: &Path) -> Result<(), SecureStorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(SecureStorageError::CleanupRefused),
    };
    if metadata.file_type().is_symlink() {
        return Err(SecureStorageError::CleanupRefused);
    }
    validate_secret_metadata(&metadata, effective_uid())
        .map_err(|_| SecureStorageError::CleanupRefused)
}

fn remove_secret_file_if_present(path: &Path) -> Result<(), SecureStorageError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(SecureStorageError::CleanupRefused),
        Ok(_) => {
            validate_secret_file_for_delete(path)?;
            fs::remove_file(path).map_err(|_| SecureStorageError::CleanupRefused)
        }
    }
}

fn validate_secret_directory_entries(path: &Path) -> Result<(), SecureStorageError> {
    let allowed: std::collections::HashSet<&'static str> = EphemeralSecretRole::ALL
        .into_iter()
        .map(EphemeralSecretRole::basename)
        .collect();
    for entry in fs::read_dir(path).map_err(|_| SecureStorageError::InvalidConfiguration)? {
        let entry = entry.map_err(|_| SecureStorageError::InvalidConfiguration)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| SecureStorageError::InvalidConfiguration)?;
        if !allowed.contains(name.as_str()) {
            return Err(SecureStorageError::InvalidConfiguration);
        }
    }
    Ok(())
}

fn validate_run_root_entries(
    profile: &Feat126SecureStorageProfile,
) -> Result<(), SecureStorageError> {
    let allowed = std::collections::HashSet::from([
        DESKTOP_APP_DATA_DIRECTORY,
        HOST_HOME_DIRECTORY,
        CODEX_HOME_DIRECTORY,
        PROJECT_DIRECTORY,
        MANIFEST_DIRECTORY,
    ]);
    for entry in fs::read_dir(&profile.run_root).map_err(|_| SecureStorageError::CleanupRefused)? {
        let name = entry
            .map_err(|_| SecureStorageError::CleanupRefused)?
            .file_name()
            .into_string()
            .map_err(|_| SecureStorageError::CleanupRefused)?;
        if !allowed.contains(name.as_str()) {
            return Err(SecureStorageError::CleanupRefused);
        }
    }
    Ok(())
}

fn validate_manifest_directory_entries(
    profile: &Feat126SecureStorageProfile,
) -> Result<(), SecureStorageError> {
    let directory = profile
        .manifest_path
        .parent()
        .ok_or(SecureStorageError::CleanupRefused)?;
    let allowed = std::collections::HashSet::from([MANIFEST_FILE, EPHEMERAL_SECRET_DIRECTORY]);
    for entry in fs::read_dir(directory).map_err(|_| SecureStorageError::CleanupRefused)? {
        let name = entry
            .map_err(|_| SecureStorageError::CleanupRefused)?
            .file_name()
            .into_string()
            .map_err(|_| SecureStorageError::CleanupRefused)?;
        if !allowed.contains(name.as_str()) {
            return Err(SecureStorageError::CleanupRefused);
        }
    }
    Ok(())
}

fn remove_verified_empty_run_root(
    profile: &Feat126SecureStorageProfile,
) -> Result<(), SecureStorageError> {
    validate_profile_run_root(&profile.run_root, profile.backend, &profile.run_id)?;
    validate_run_root_entries(profile)?;
    validate_manifest_directory_entries(profile)?;
    validate_secret_directory_entries(&profile.secret_directory)?;
    if fs::read_dir(&profile.secret_directory)
        .map_err(|_| SecureStorageError::CleanupRefused)?
        .next()
        .is_some()
    {
        return Err(SecureStorageError::CleanupRefused);
    }
    for path in [
        &profile.desktop_app_data,
        &profile.host_home,
        &profile.codex_home,
        &profile.project,
    ] {
        validate_private_directory(path)?;
        if fs::read_dir(path)
            .map_err(|_| SecureStorageError::CleanupRefused)?
            .next()
            .is_some()
        {
            return Err(SecureStorageError::CleanupRefused);
        }
    }
    fs::remove_dir(&profile.secret_directory).map_err(|_| SecureStorageError::CleanupRefused)?;
    for path in [
        &profile.desktop_app_data,
        &profile.host_home,
        &profile.codex_home,
        &profile.project,
    ] {
        fs::remove_dir(path).map_err(|_| SecureStorageError::CleanupRefused)?;
    }
    let manifest_directory = profile
        .manifest_path
        .parent()
        .ok_or(SecureStorageError::CleanupRefused)?;
    let manifest_metadata = fs::symlink_metadata(&profile.manifest_path)
        .map_err(|_| SecureStorageError::CleanupRefused)?;
    if manifest_metadata.file_type().is_symlink()
        || !manifest_metadata.is_file()
        || manifest_metadata.uid() != effective_uid()
        || manifest_metadata.mode() & 0o077 != 0
        || manifest_metadata.nlink() != 1
    {
        return Err(SecureStorageError::CleanupRefused);
    }
    let mut manifest_entry_count = 0;
    for entry in fs::read_dir(manifest_directory).map_err(|_| SecureStorageError::CleanupRefused)? {
        let name = entry
            .map_err(|_| SecureStorageError::CleanupRefused)?
            .file_name()
            .into_string()
            .map_err(|_| SecureStorageError::CleanupRefused)?;
        if name != MANIFEST_FILE {
            return Err(SecureStorageError::CleanupRefused);
        }
        manifest_entry_count += 1;
    }
    if manifest_entry_count != 1 {
        return Err(SecureStorageError::CleanupRefused);
    }
    fs::remove_file(&profile.manifest_path).map_err(|_| SecureStorageError::CleanupRefused)?;
    fs::remove_dir(manifest_directory).map_err(|_| SecureStorageError::CleanupRefused)?;
    fs::remove_dir(&profile.run_root).map_err(|_| SecureStorageError::CleanupRefused)
}

trait ExactKeychain: Send + Sync {
    fn state(&self, namespace: &KeychainNamespace) -> Result<InventoryState, SecureStorageError>;
    fn delete(&self, namespace: &KeychainNamespace) -> Result<(), SecureStorageError>;
}

#[cfg(target_os = "macos")]
struct PlatformExactKeychain {
    store: Arc<apple_native_keyring_store::protected::Store>,
}

#[cfg(target_os = "macos")]
impl PlatformExactKeychain {
    fn new() -> Result<Self, SecureStorageError> {
        Ok(Self {
            store: apple_native_keyring_store::protected::Store::new()
                .map_err(|_| SecureStorageError::Unavailable)?,
        })
    }
}

#[cfg(target_os = "macos")]
impl ExactKeychain for PlatformExactKeychain {
    fn state(&self, namespace: &KeychainNamespace) -> Result<InventoryState, SecureStorageError> {
        use keyring_core::api::CredentialStoreApi;
        let spec = std::collections::HashMap::from([
            ("service", namespace.service()),
            ("account", namespace.account()),
            ("show-authentication-ui", "false"),
        ]);
        let entries = self
            .store
            .search(&spec)
            .map_err(|_| SecureStorageError::Unavailable)?;
        match entries.as_slice() {
            [] => Ok(InventoryState::Absent),
            [entry]
                if entry.get_specifiers()
                    == Some((
                        namespace.service().to_owned(),
                        namespace.account().to_owned(),
                    )) =>
            {
                Ok(InventoryState::Present)
            }
            _ => Err(SecureStorageError::Unavailable),
        }
    }

    fn delete(&self, namespace: &KeychainNamespace) -> Result<(), SecureStorageError> {
        use keyring_core::api::CredentialStoreApi;
        if self.state(namespace)? == InventoryState::Absent {
            return Ok(());
        }
        let modifiers =
            std::collections::HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let entry = self
            .store
            .build(namespace.service(), namespace.account(), Some(&modifiers))
            .map_err(|_| SecureStorageError::Unavailable)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecureStorageError::Unavailable),
        }
    }
}

#[cfg(not(target_os = "macos"))]
struct PlatformExactKeychain;

#[cfg(not(target_os = "macos"))]
impl PlatformExactKeychain {
    fn new() -> Result<Self, SecureStorageError> {
        Err(SecureStorageError::Unavailable)
    }
}

#[cfg(not(target_os = "macos"))]
impl ExactKeychain for PlatformExactKeychain {
    fn state(&self, _namespace: &KeychainNamespace) -> Result<InventoryState, SecureStorageError> {
        Err(SecureStorageError::Unavailable)
    }

    fn delete(&self, _namespace: &KeychainNamespace) -> Result<(), SecureStorageError> {
        Err(SecureStorageError::Unavailable)
    }
}

fn namespace_descriptor_sha256(namespaces: &[KeychainNamespace; 3]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"feat126-secure-storage-v1\0");
    for namespace in namespaces {
        digest.update(namespace.role.as_bytes());
        digest.update(b"\0");
        digest.update(namespace.service.as_bytes());
        digest.update(b"\0");
        digest.update(namespace.account.as_bytes());
        digest.update(b"\0");
    }
    format!("{:x}", digest.finalize())
}

fn ephemeral_secret_descriptor_sha256() -> String {
    let mut digest = Sha256::new();
    digest.update(b"feat126-ephemeral-secret-files-v1\0");
    for role in EphemeralSecretRole::ALL {
        digest.update(role.name().as_bytes());
        digest.update(b"\0");
        digest.update(role.basename().as_bytes());
        digest.update(b"\0");
        digest.update([role.tag()]);
        digest.update(b"\0");
    }
    format!("{:x}", digest.finalize())
}

fn ephemeral_secret_roles() -> Vec<String> {
    EphemeralSecretRole::ALL
        .into_iter()
        .map(|role| role.name().to_owned())
        .collect()
}

fn directory_roles(backend: StorageBackendKind) -> Vec<String> {
    let mut roles = vec![
        DESKTOP_APP_DATA_DIRECTORY,
        HOST_HOME_DIRECTORY,
        CODEX_HOME_DIRECTORY,
        PROJECT_DIRECTORY,
        MANIFEST_DIRECTORY,
    ];
    if backend == StorageBackendKind::EphemeralFile {
        roles.push(EPHEMERAL_SECRET_DIRECTORY);
    }
    roles.into_iter().map(str::to_owned).collect()
}

fn require_exact_environment_path(name: &str, expected: &Path) -> Result<(), SecureStorageError> {
    let value = std::env::var(name).map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if Path::new(&value) != expected {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(())
}

#[cfg(test)]
fn validate_run_root(path: &Path) -> Result<PathBuf, SecureStorageError> {
    let path = validate_private_directory(path)?;
    let temporary_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if path == temporary_root || !path.starts_with(&temporary_root) {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(path)
}

fn validate_profile_run_root(
    path: &Path,
    backend: StorageBackendKind,
    run_id: &str,
) -> Result<PathBuf, SecureStorageError> {
    let path = validate_private_directory(path)?;
    let temporary_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if run_root_location_allowed(&path, &temporary_root, backend, run_id) {
        Ok(path)
    } else {
        Err(SecureStorageError::InvalidConfiguration)
    }
}

fn run_root_location_allowed(
    path: &Path,
    temporary_root: &Path,
    backend: StorageBackendKind,
    run_id: &str,
) -> bool {
    if path != temporary_root && path.starts_with(temporary_root) {
        return true;
    }
    #[cfg(feature = "feat126-s10-driver")]
    {
        let canonical_v4 = uuid::Uuid::parse_str(run_id).is_ok_and(|value| {
            value.get_version_num() == 4 && value.hyphenated().to_string() == run_id
        });
        let suffix = Path::new("yijie-infra")
            .join("environments")
            .join("local")
            .join("generated")
            .join("feat-126-s10")
            .join(run_id);
        backend == StorageBackendKind::EphemeralFile && canonical_v4 && path.ends_with(suffix)
    }
    #[cfg(not(feature = "feat126-s10-driver"))]
    {
        let _ = (backend, run_id);
        false
    }
}

fn validate_private_directory(path: &Path) -> Result<PathBuf, SecureStorageError> {
    if !path.is_absolute() {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != effective_uid()
        || metadata.mode() & 0o077 != 0
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if canonical != path {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(canonical)
}

fn create_or_validate_private_directory(path: &Path) -> Result<PathBuf, SecureStorageError> {
    match fs::create_dir(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| SecureStorageError::InvalidConfiguration)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(SecureStorageError::InvalidConfiguration),
    }
    validate_private_directory(path)
}

fn read_manifest(path: &Path) -> Result<Option<SecureStorageManifest>, SecureStorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(SecureStorageError::InvalidConfiguration),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != effective_uid()
        || metadata.mode() & 0o077 != 0
        || metadata.nlink() != 1
        || metadata.len() > 16 << 10
    {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    let bytes = fs::read(path).map_err(|_| SecureStorageError::InvalidConfiguration)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| SecureStorageError::InvalidConfiguration)
}

fn write_manifest(path: &Path, manifest: &SecureStorageManifest) -> Result<(), SecureStorageError> {
    let bytes = serde_json::to_vec(manifest).map_err(|_| SecureStorageError::Unavailable)?;
    let temporary = path.with_extension(format!("json.tmp.{}", uuid::Uuid::now_v7()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| SecureStorageError::Unavailable)?;
    if file
        .write_all(&bytes)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&temporary);
        return Err(SecureStorageError::Unavailable);
    }
    if fs::rename(&temporary, path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(SecureStorageError::Unavailable);
    }
    Ok(())
}

fn effective_uid() -> u32 {
    unsafe { libc::geteuid() }
}

fn process_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[doc(hidden)]
pub fn feat126_secure_storage_test_control(
    action: &str,
) -> Result<SecureStorageEvidence, &'static str> {
    let profile = Feat126SecureStorageProfile::from_environment()
        .map_err(|_| "secure_storage_invalid")?
        .ok_or("secure_storage_disabled")?;
    match action {
        "prepare" => {
            let mut paths = vec![
                &profile.desktop_app_data,
                &profile.host_home,
                &profile.codex_home,
                &profile.project,
                profile
                    .manifest_path
                    .parent()
                    .ok_or("secure_storage_invalid")?,
            ];
            if profile.uses_ephemeral_backend() {
                paths.push(&profile.secret_directory);
            }
            for path in paths {
                create_or_validate_private_directory(path).map_err(|_| "secure_storage_invalid")?;
            }
            match profile.backend {
                StorageBackendKind::ProtectedDataKeychain => {
                    let backend =
                        PlatformExactKeychain::new().map_err(|_| "secure_storage_unavailable")?;
                    profile
                        .prepare_with_backend(&backend)
                        .map_err(|_| "secure_storage_prepare_failed")?;
                    profile
                        .inventory_with_backend(&backend, false)
                        .map_err(|_| "secure_storage_inventory_failed")
                }
                StorageBackendKind::EphemeralFile => {
                    profile
                        .prepare_ephemeral()
                        .map_err(|_| "secure_storage_prepare_failed")?;
                    profile
                        .inventory_ephemeral(false)
                        .map_err(|_| "secure_storage_inventory_failed")
                }
            }
        }
        "inventory" => {
            let manifest = read_manifest(&profile.manifest_path)
                .map_err(|_| "secure_storage_invalid")?
                .ok_or("secure_storage_invalid")?;
            profile
                .validate_manifest(&manifest)
                .map_err(|_| "secure_storage_invalid")?;
            match profile.backend {
                StorageBackendKind::ProtectedDataKeychain => {
                    let backend =
                        PlatformExactKeychain::new().map_err(|_| "secure_storage_unavailable")?;
                    profile
                        .inventory_with_backend(&backend, false)
                        .map_err(|_| "secure_storage_inventory_failed")
                }
                StorageBackendKind::EphemeralFile => profile
                    .inventory_ephemeral(false)
                    .map_err(|_| "secure_storage_inventory_failed"),
            }
        }
        "cleanup" => match profile.backend {
            StorageBackendKind::ProtectedDataKeychain => {
                let backend =
                    PlatformExactKeychain::new().map_err(|_| "secure_storage_unavailable")?;
                profile
                    .cleanup_with_backend(&backend, true)
                    .map_err(|_| "secure_storage_cleanup_failed")
            }
            StorageBackendKind::EphemeralFile => profile
                .cleanup_ephemeral(true)
                .map_err(|_| "secure_storage_cleanup_failed"),
        },
        #[cfg(feature = "feat126-s10-driver")]
        "cleanup-preserve-run-root" => match profile.backend {
            StorageBackendKind::ProtectedDataKeychain => Err("secure_storage_invalid_action"),
            StorageBackendKind::EphemeralFile => profile
                .cleanup_ephemeral(false)
                .map_err(|_| "secure_storage_cleanup_failed"),
        },
        _ => Err("secure_storage_invalid_action"),
    }
}

#[cfg(test)]
pub(crate) fn ephemeral_test_profile() -> (PathBuf, Arc<Feat126SecureStorageProfile>) {
    let root = std::env::temp_dir().join(format!("feat126-s10p2f-{}", uuid::Uuid::now_v7()));
    fs::create_dir(&root).expect("create test run root");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("protect test run root");
    let root = root.canonicalize().expect("canonical test run root");
    let run_id = uuid::Uuid::now_v7().to_string();
    let prefix = format!("com.yijie.ai.test.feat126.{run_id}");
    let namespaces = [
        KeychainNamespace {
            role: "chat_db",
            service: format!("{prefix}.chat-db"),
            account: KEYCHAIN_ACCOUNT,
        },
        KeychainNamespace {
            role: "chat_receipt",
            service: format!("{prefix}.chat-receipt"),
            account: KEYCHAIN_ACCOUNT,
        },
        KeychainNamespace {
            role: "native_auth",
            service: format!("{prefix}.native-auth"),
            account: NATIVE_AUTH_ACCOUNT,
        },
    ];
    let profile = Arc::new(Feat126SecureStorageProfile {
        run_id,
        desktop_app_data: root.join(DESKTOP_APP_DATA_DIRECTORY),
        host_home: root.join(HOST_HOME_DIRECTORY),
        codex_home: root.join(CODEX_HOME_DIRECTORY),
        project: root.join(PROJECT_DIRECTORY),
        manifest_path: root.join(MANIFEST_DIRECTORY).join(MANIFEST_FILE),
        secret_directory: root
            .join(MANIFEST_DIRECTORY)
            .join(EPHEMERAL_SECRET_DIRECTORY),
        descriptor_sha256: namespace_descriptor_sha256(&namespaces),
        secret_descriptor_sha256: ephemeral_secret_descriptor_sha256(),
        namespaces,
        backend: StorageBackendKind::EphemeralFile,
        run_root: root.clone(),
    });
    profile.prepare().expect("prepare ephemeral test profile");
    (root, profile)
}

#[cfg(test)]
pub(crate) fn cleanup_ephemeral_test_profile(
    profile: &Feat126SecureStorageProfile,
) -> Result<SecureStorageEvidence, SecureStorageError> {
    let mut manifest =
        read_manifest(&profile.manifest_path)?.ok_or(SecureStorageError::InvalidConfiguration)?;
    manifest.desktop_pid = None;
    write_manifest(&profile.manifest_path, &manifest)?;
    profile.cleanup_ephemeral(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::process::Command;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeKeychain {
        present: Mutex<HashSet<(String, String)>>,
        deletes: Mutex<Vec<(String, String)>>,
        fail_delete_role: Mutex<Option<&'static str>>,
    }

    impl FakeKeychain {
        fn with_all(profile: &Feat126SecureStorageProfile) -> Self {
            Self {
                present: Mutex::new(
                    profile
                        .namespaces
                        .iter()
                        .map(|namespace| {
                            (
                                namespace.service().to_owned(),
                                namespace.account().to_owned(),
                            )
                        })
                        .collect(),
                ),
                ..Self::default()
            }
        }
    }

    impl ExactKeychain for FakeKeychain {
        fn state(
            &self,
            namespace: &KeychainNamespace,
        ) -> Result<InventoryState, SecureStorageError> {
            Ok(
                if self.present.lock().unwrap().contains(&(
                    namespace.service().to_owned(),
                    namespace.account().to_owned(),
                )) {
                    InventoryState::Present
                } else {
                    InventoryState::Absent
                },
            )
        }

        fn delete(&self, namespace: &KeychainNamespace) -> Result<(), SecureStorageError> {
            self.deletes.lock().unwrap().push((
                namespace.service().to_owned(),
                namespace.account().to_owned(),
            ));
            if *self.fail_delete_role.lock().unwrap() == Some(namespace.role) {
                return Err(SecureStorageError::Unavailable);
            }
            self.present.lock().unwrap().remove(&(
                namespace.service().to_owned(),
                namespace.account().to_owned(),
            ));
            Ok(())
        }
    }

    fn fixture() -> (PathBuf, Feat126SecureStorageProfile) {
        let root = std::env::temp_dir().join(format!("feat126-s10p2-{}", uuid::Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let root = root.canonicalize().unwrap();
        let run_id = uuid::Uuid::now_v7().to_string();
        let prefix = format!("com.yijie.ai.test.feat126.{run_id}");
        let namespaces = [
            KeychainNamespace {
                role: "chat_db",
                service: format!("{prefix}.chat-db"),
                account: KEYCHAIN_ACCOUNT,
            },
            KeychainNamespace {
                role: "chat_receipt",
                service: format!("{prefix}.chat-receipt"),
                account: KEYCHAIN_ACCOUNT,
            },
            KeychainNamespace {
                role: "native_auth",
                service: format!("{prefix}.native-auth"),
                account: NATIVE_AUTH_ACCOUNT,
            },
        ];
        let profile = Feat126SecureStorageProfile {
            run_id,
            desktop_app_data: root.join(DESKTOP_APP_DATA_DIRECTORY),
            host_home: root.join(HOST_HOME_DIRECTORY),
            codex_home: root.join(CODEX_HOME_DIRECTORY),
            project: root.join(PROJECT_DIRECTORY),
            manifest_path: root.join(MANIFEST_DIRECTORY).join(MANIFEST_FILE),
            secret_directory: root
                .join(MANIFEST_DIRECTORY)
                .join(EPHEMERAL_SECRET_DIRECTORY),
            descriptor_sha256: namespace_descriptor_sha256(&namespaces),
            secret_descriptor_sha256: ephemeral_secret_descriptor_sha256(),
            namespaces,
            backend: StorageBackendKind::ProtectedDataKeychain,
            run_root: root.clone(),
        };
        for path in [
            &profile.desktop_app_data,
            &profile.host_home,
            &profile.codex_home,
            &profile.project,
            profile.manifest_path.parent().unwrap(),
        ] {
            create_or_validate_private_directory(path).unwrap();
        }
        (root, profile)
    }

    #[test]
    fn derives_three_closed_namespaces_without_default_or_legacy_accounts() {
        let (root, profile) = fixture();
        let services: HashSet<_> = profile
            .namespaces
            .iter()
            .map(|namespace| namespace.service())
            .collect();
        assert_eq!(services.len(), 3);
        assert!(services
            .iter()
            .all(|service| service.contains(&profile.run_id)));
        assert!(!services.contains(&"ai.yijie.desktop.auth"));
        assert!(profile
            .namespaces
            .iter()
            .all(|namespace| namespace.account() != "refresh-token-family"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepare_requires_pre_inventory_absent_and_recovers_same_run() {
        let (root, profile) = fixture();
        let backend = FakeKeychain::default();
        profile.prepare_with_backend(&backend).unwrap();
        let first = read_manifest(&profile.manifest_path).unwrap().unwrap();
        assert_eq!(first.phase, ManifestPhase::Active);
        assert_eq!(first.recovery_count, 0);
        profile.prepare_with_backend(&backend).unwrap();
        let second = read_manifest(&profile.manifest_path).unwrap().unwrap();
        assert_eq!(second.run_id, profile.run_id);
        fs::remove_dir_all(root).unwrap();

        let (root, profile) = fixture();
        let backend = FakeKeychain::with_all(&profile);
        assert_eq!(
            profile.prepare_with_backend(&backend),
            Err(SecureStorageError::InvalidConfiguration)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_same_run_pid_is_recovered_without_cross_run_mutation() {
        let (root, profile) = fixture();
        let backend = FakeKeychain::default();
        profile.prepare_with_backend(&backend).unwrap();
        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = Some(i32::MAX as u32);
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        profile.prepare_with_backend(&backend).unwrap();
        let recovered = read_manifest(&profile.manifest_path).unwrap().unwrap();
        assert_eq!(recovered.recovery_count, 1);
        assert_eq!(recovered.desktop_pid, Some(std::process::id()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_is_exact_idempotent_and_retryable_after_interruption() {
        let (root, profile) = fixture();
        let empty = FakeKeychain::default();
        profile.prepare_with_backend(&empty).unwrap();
        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = None;
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        let backend = FakeKeychain::with_all(&profile);
        *backend.fail_delete_role.lock().unwrap() = Some("chat_receipt");
        assert_eq!(
            profile.cleanup_with_backend(&backend, false),
            Err(SecureStorageError::Unavailable)
        );
        assert_eq!(
            read_manifest(&profile.manifest_path)
                .unwrap()
                .unwrap()
                .phase,
            ManifestPhase::CleanupPending
        );
        *backend.fail_delete_role.lock().unwrap() = None;
        let evidence = profile.cleanup_with_backend(&backend, false).unwrap();
        assert!(evidence.cleanup_complete);
        assert!(evidence
            .items
            .iter()
            .all(|item| item.state == InventoryState::Absent));
        let deleted: HashSet<_> = backend.deletes.lock().unwrap().iter().cloned().collect();
        let expected: HashSet<_> = profile
            .namespaces
            .iter()
            .map(|namespace| {
                (
                    namespace.service().to_owned(),
                    namespace.account().to_owned(),
                )
            })
            .collect();
        assert_eq!(deleted, expected);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_mismatch_refuses_every_delete() {
        let (root, profile) = fixture();
        let empty = FakeKeychain::default();
        profile.prepare_with_backend(&empty).unwrap();
        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = None;
        manifest.run_id = uuid::Uuid::now_v7().to_string();
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        let backend = FakeKeychain::with_all(&profile);
        assert_eq!(
            profile.cleanup_with_backend(&backend, false),
            Err(SecureStorageError::InvalidConfiguration)
        );
        assert!(backend.deletes.lock().unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_removes_only_the_validated_run_root_after_exact_items_are_absent() {
        let (root, profile) = fixture();
        let backend = FakeKeychain::default();
        profile.prepare_with_backend(&backend).unwrap();
        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = None;
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        let evidence = profile.cleanup_with_backend(&backend, true).unwrap();
        assert!(evidence.cleanup_complete);
        assert!(!root.exists());
    }

    #[test]
    fn two_runs_have_disjoint_namespaces_and_directories() {
        let (root_a, profile_a) = fixture();
        let (root_b, profile_b) = fixture();
        let services_a: HashSet<_> = profile_a
            .namespaces
            .iter()
            .map(|namespace| namespace.service.clone())
            .collect();
        let services_b: HashSet<_> = profile_b
            .namespaces
            .iter()
            .map(|namespace| namespace.service.clone())
            .collect();
        assert!(services_a.is_disjoint(&services_b));
        assert_ne!(profile_a.desktop_app_data, profile_b.desktop_app_data);
        fs::remove_dir_all(root_a).unwrap();
        fs::remove_dir_all(root_b).unwrap();
    }

    #[test]
    fn evidence_is_content_free_and_never_contains_paths_or_secrets() {
        let (root, profile) = fixture();
        let evidence = profile
            .inventory_with_backend(&FakeKeychain::default(), false)
            .unwrap();
        let encoded = serde_json::to_string(&evidence).unwrap();
        assert!(!encoded.contains(root.to_str().unwrap()));
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("com.yijie.ai.test"));
        assert!(encoded.contains("statusDigestSha256"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn symlink_wrong_mode_and_non_temp_roots_fail_closed() {
        let (root, _profile) = fixture();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            validate_run_root(&root),
            Err(SecureStorageError::InvalidConfiguration)
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let link = root.with_extension("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert_eq!(
            validate_run_root(&link),
            Err(SecureStorageError::InvalidConfiguration)
        );
        fs::remove_file(link).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert_eq!(
            validate_run_root(Path::new("/")),
            Err(SecureStorageError::InvalidConfiguration)
        );
    }

    #[cfg(feature = "feat126-s10-driver")]
    #[test]
    fn driver_accepts_only_the_canonical_infra_ephemeral_run_root_suffix() {
        let run_id = "12600000-0000-4000-8000-000000000071";
        let temporary_root = Path::new("/private/tmp");
        let canonical = Path::new("/workspace/yijie-infra/environments/local/generated")
            .join("feat-126-s10")
            .join(run_id);
        assert!(run_root_location_allowed(
            &canonical,
            temporary_root,
            StorageBackendKind::EphemeralFile,
            run_id,
        ));
        assert!(!run_root_location_allowed(
            &canonical,
            temporary_root,
            StorageBackendKind::ProtectedDataKeychain,
            run_id,
        ));
        for invalid in [
            Path::new("/workspace/yijie-desktop/environments/local/generated")
                .join("feat-126-s10")
                .join(run_id),
            Path::new("/workspace/yijie-infra/environments/local/generated")
                .join("feat-126-s10-other")
                .join(run_id),
            Path::new("/workspace/yijie-infra/environments/local/generated")
                .join("feat-126-s10")
                .join("12600000-0000-4000-8000-000000000072"),
        ] {
            assert!(!run_root_location_allowed(
                &invalid,
                temporary_root,
                StorageBackendKind::EphemeralFile,
                run_id,
            ));
        }
        let version_seven_run_id = "12600000-0000-7000-8000-000000000071";
        let version_seven = Path::new("/workspace/yijie-infra/environments/local/generated")
            .join("feat-126-s10")
            .join(version_seven_run_id);
        assert!(!run_root_location_allowed(
            &version_seven,
            temporary_root,
            StorageBackendKind::EphemeralFile,
            version_seven_run_id,
        ));
    }

    #[test]
    fn directory_roles_are_closed_and_path_free() {
        let expected: HashMap<_, _> = directory_roles(StorageBackendKind::ProtectedDataKeychain)
            .into_iter()
            .enumerate()
            .collect();
        assert_eq!(expected.len(), 5);
        assert_eq!(
            expected.get(&0).map(String::as_str),
            Some("desktop-app-data")
        );
        assert_eq!(expected.get(&4).map(String::as_str), Some("secure-storage"));
    }

    #[test]
    fn secure_storage_requires_two_exact_true_gates_and_defaults_off() {
        assert_eq!(storage_backend_gate("", "", "", false), Ok(None));
        assert_eq!(
            storage_backend_gate("false", "false", "false", false),
            Ok(None)
        );
        assert_eq!(storage_backend_gate("true", "", "", true), Ok(None));
        assert_eq!(
            storage_backend_gate("true", "true", "false", true),
            Ok(Some(StorageBackendKind::ProtectedDataKeychain))
        );
        assert_eq!(
            storage_backend_gate("true", "false", "true", true),
            Ok(Some(StorageBackendKind::EphemeralFile))
        );
        for (master, secure, ephemeral, context) in [
            ("TRUE", "false", "true", true),
            ("false", "false", "true", true),
            ("true", "false", "1", true),
            ("true", "true", "true", true),
            ("", "", "", true),
        ] {
            assert_eq!(
                storage_backend_gate(master, secure, ephemeral, context),
                Err(SecureStorageError::InvalidConfiguration)
            );
        }
    }

    #[test]
    fn child_homes_and_project_must_match_the_derived_run_paths() {
        let (root, profile) = fixture();
        assert_eq!(
            profile.validate_child_homes(&profile.host_home, Some(&profile.codex_home)),
            Ok(())
        );
        assert_eq!(profile.validate_project_path(&profile.project), Ok(()));
        assert_eq!(
            profile.validate_child_homes(&profile.codex_home, Some(&profile.host_home)),
            Err(SecureStorageError::InvalidConfiguration)
        );
        assert_eq!(
            profile.validate_project_path(&profile.desktop_app_data),
            Err(SecureStorageError::InvalidConfiguration)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ephemeral_files_are_closed_versioned_private_and_restart_stable() {
        let (root, profile) = ephemeral_test_profile();
        let chat = profile
            .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
            .unwrap();
        let receipt = profile
            .ephemeral_secret_file(EphemeralSecretRole::ReceiptHmac)
            .unwrap();
        let native = profile
            .ephemeral_secret_file(EphemeralSecretRole::NativeAuth)
            .unwrap();
        let mut chat_secret = [0_u8; 32];
        let mut receipt_secret = [0_u8; 32];
        getrandom::fill(&mut chat_secret).unwrap();
        getrandom::fill(&mut receipt_secret).unwrap();
        let native_secret = format!(
            "{{\"schema_version\":2,\"refresh_token\":\"{}\"}}",
            uuid::Uuid::now_v7()
        );
        chat.create(&chat_secret).unwrap();
        receipt.create(&receipt_secret).unwrap();
        native.create(native_secret.as_bytes()).unwrap();
        assert_eq!(
            chat.create(&chat_secret),
            Err(SecureStorageError::ConcurrentRun)
        );
        assert_ne!(chat_secret, receipt_secret);
        assert_eq!(chat.load().unwrap().unwrap().as_slice(), chat_secret);
        assert_eq!(receipt.load().unwrap().unwrap().as_slice(), receipt_secret);
        assert_eq!(
            native.load().unwrap().unwrap().as_slice(),
            native_secret.as_bytes()
        );

        for role in EphemeralSecretRole::ALL {
            let metadata =
                fs::symlink_metadata(profile.secret_directory.join(role.basename())).unwrap();
            assert_eq!(metadata.mode() & 0o777, 0o600);
            assert_eq!(metadata.nlink(), 1);
        }
        assert_eq!(
            fs::symlink_metadata(&profile.secret_directory)
                .unwrap()
                .mode()
                & 0o777,
            0o700
        );
        let evidence_json =
            serde_json::to_string(&profile.inventory_ephemeral(false).unwrap()).unwrap();
        assert!(!evidence_json.contains(root.to_str().unwrap()));
        assert!(!evidence_json.contains(native_secret.as_str()));
        assert!(!evidence_json.contains(".secret"));
        assert_eq!(
            profile.cleanup_ephemeral(false),
            Err(SecureStorageError::ConcurrentRun)
        );
        assert!(chat.path.exists());

        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = Some(i32::MAX as u32);
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        profile.prepare_ephemeral().unwrap();
        assert_eq!(chat.load().unwrap().unwrap().as_slice(), chat_secret);
        let evidence = cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(evidence.cleanup_complete);
        assert!(!root.exists());
        chat_secret.zeroize();
        receipt_secret.zeroize();
    }

    #[test]
    fn ephemeral_cross_run_and_manifest_authority_fail_closed() {
        let (root_a, profile_a) = ephemeral_test_profile();
        let (root_b, profile_b) = ephemeral_test_profile();
        let file_a = profile_a
            .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
            .unwrap();
        file_a.create(&[7_u8; 32]).unwrap();
        let file_b = profile_b
            .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
            .unwrap();
        assert!(file_b.load().unwrap().is_none());
        let forged = EphemeralSecretFile {
            profile: profile_b.clone(),
            role: EphemeralSecretRole::ChatSqlcipher,
            path: file_a.path.clone(),
        };
        assert_eq!(forged.load(), Err(SecureStorageError::InvalidConfiguration));

        let mut manifest = read_manifest(&profile_a.manifest_path).unwrap().unwrap();
        manifest.run_id = uuid::Uuid::now_v7().to_string();
        manifest.desktop_pid = None;
        write_manifest(&profile_a.manifest_path, &manifest).unwrap();
        assert_eq!(
            profile_a.cleanup_ephemeral(false),
            Err(SecureStorageError::InvalidConfiguration)
        );
        assert!(file_a.path.exists());
        fs::remove_dir_all(root_a).unwrap();
        cleanup_ephemeral_test_profile(&profile_b).unwrap();
        assert!(!root_b.exists());
    }

    #[test]
    fn partial_secret_is_fail_closed_but_exact_cleanup_is_recoverable() {
        let (root, profile) = ephemeral_test_profile();
        let path = profile
            .secret_directory
            .join(EphemeralSecretRole::NativeAuth.basename());
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&path)
            .unwrap();
        file.write_all(b"partial").unwrap();
        file.sync_all().unwrap();
        let secret = profile
            .ephemeral_secret_file(EphemeralSecretRole::NativeAuth)
            .unwrap();
        assert_eq!(secret.load(), Err(SecureStorageError::InvalidConfiguration));
        assert_eq!(
            profile.prepare_ephemeral(),
            Err(SecureStorageError::InvalidConfiguration)
        );
        let evidence = profile.inventory_ephemeral(false).unwrap();
        assert!(evidence.items.iter().any(|item| {
            item.role == "native_auth"
                && item.state == InventoryState::Present
                && !item.schema_valid
        }));
        cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn unknown_symlink_hardlink_and_mode_drift_delete_nothing() {
        for fault in ["unknown", "root_unknown", "symlink", "hardlink", "mode"] {
            let (root, profile) = ephemeral_test_profile();
            let chat = profile
                .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
                .unwrap();
            chat.create(&[9_u8; 32]).unwrap();
            let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
            manifest.desktop_pid = None;
            write_manifest(&profile.manifest_path, &manifest).unwrap();
            let fault_path = match fault {
                "unknown" => {
                    let path = profile.secret_directory.join("foreign.secret");
                    fs::write(&path, b"foreign").unwrap();
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
                    path
                }
                "root_unknown" => {
                    let path = root.join("foreign-artifact");
                    fs::write(&path, b"foreign").unwrap();
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
                    path
                }
                "symlink" => {
                    let path = profile
                        .secret_directory
                        .join(EphemeralSecretRole::ReceiptHmac.basename());
                    std::os::unix::fs::symlink(&chat.path, &path).unwrap();
                    path
                }
                "hardlink" => {
                    let path = profile
                        .secret_directory
                        .join(EphemeralSecretRole::ReceiptHmac.basename());
                    fs::hard_link(&chat.path, &path).unwrap();
                    path
                }
                "mode" => {
                    fs::set_permissions(&chat.path, fs::Permissions::from_mode(0o644)).unwrap();
                    chat.path.clone()
                }
                _ => unreachable!(),
            };
            assert!(profile.cleanup_ephemeral(false).is_err());
            assert!(chat.path.exists());
            match fault {
                "mode" => {
                    fs::set_permissions(&chat.path, fs::Permissions::from_mode(0o600)).unwrap();
                }
                _ => fs::remove_file(fault_path).unwrap(),
            }
            cleanup_ephemeral_test_profile(&profile).unwrap();
            assert!(!root.exists());
        }
    }

    #[test]
    fn metadata_owner_nlink_and_mode_contract_is_exact() {
        let (root, profile) = ephemeral_test_profile();
        let chat = profile
            .ephemeral_secret_file(EphemeralSecretRole::ChatSqlcipher)
            .unwrap();
        chat.create(&[3_u8; 32]).unwrap();
        let metadata = fs::symlink_metadata(&chat.path).unwrap();
        assert_eq!(validate_secret_metadata(&metadata, effective_uid()), Ok(()));
        assert_eq!(
            validate_secret_metadata(&metadata, effective_uid().saturating_add(1)),
            Err(SecureStorageError::InvalidConfiguration)
        );
        cleanup_ephemeral_test_profile(&profile).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn exact_environment_profile_is_validated_in_an_isolated_subprocess() {
        let temporary_parent = std::env::temp_dir().canonicalize().unwrap();
        let root = temporary_parent.join(format!("feat126-s10p2f-env-{}", uuid::Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let run_id = uuid::Uuid::now_v7().to_string();
        let output = Command::new(std::env::current_exe().unwrap())
            .env_clear()
            .env("TMPDIR", &temporary_parent)
            .env("FEAT126_S10P2F_CHILD", "true")
            .env(MASTER_ENV, "true")
            .env(SECURE_STORAGE_ENV, "false")
            .env(EPHEMERAL_STORAGE_ENV, "true")
            .env(RUN_ID_ENV, &run_id)
            .env(RUN_ROOT_ENV, &root)
            .env(FAKE_RESPONSES_ENV, FAKE_RESPONSES_BASE_URL)
            .env(HOST_HOME_ENV, root.join(HOST_HOME_DIRECTORY))
            .env(CODEX_HOME_ENV, root.join(CODEX_HOME_DIRECTORY))
            .arg("--exact")
            .arg("feat126_secure_storage::tests::ephemeral_environment_child")
            .arg("--nocapture")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "isolated environment child failed without emitting configuration values"
        );
        let manifest = read_manifest(&root.join(MANIFEST_DIRECTORY).join(MANIFEST_FILE))
            .unwrap()
            .unwrap();
        assert_eq!(manifest.run_id, run_id);
        assert_eq!(
            manifest.storage_backend,
            Some(StorageBackendKind::EphemeralFile)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ephemeral_environment_child() {
        if std::env::var("FEAT126_S10P2F_CHILD").as_deref() != Ok("true") {
            return;
        }
        let profile = Feat126SecureStorageProfile::from_environment()
            .unwrap()
            .expect("ephemeral profile enabled");
        assert!(profile.uses_ephemeral_backend());
        profile.prepare().expect("prepare isolated profile");
        assert!(profile.secret_directory.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an Apple Development signed bundle with Protected Data Keychain entitlement"]
    fn signed_bundle_exercises_three_run_scoped_items_without_default_namespace_access() {
        use keyring_core::api::CredentialStoreApi;

        let (root, profile) = fixture();
        let backend = PlatformExactKeychain::new().expect("open Protected Data Keychain");
        profile
            .prepare_with_backend(&backend)
            .expect("pre-inventory is absent");
        let store = apple_native_keyring_store::protected::Store::new()
            .expect("create Protected Data Keychain store");
        let modifiers =
            std::collections::HashMap::from([("access-policy", "when-unlocked-this-device-only")]);
        let mut failure = None;
        for (index, namespace) in profile.namespaces.iter().enumerate() {
            let entry =
                match store.build(namespace.service(), namespace.account(), Some(&modifiers)) {
                    Ok(entry) => entry,
                    Err(error) => {
                        failure = Some(format!("build exact item: {error}"));
                        break;
                    }
                };
            let synthetic = if namespace.role == "native_auth" {
                br#"{"schema_version":2,"environment":"local-integration","issuer":"https://localhost:9443/realms/yijie","client_id":"yijie-desktop-local","refresh_token":"synthetic","issued_at_epoch_seconds":1,"last_used_at_epoch_seconds":1,"absolute_expires_at_epoch_seconds":2}"#.to_vec()
            } else {
                vec![(index + 1) as u8; 32]
            };
            if let Err(error) = entry.set_secret(&synthetic) {
                failure = Some(format!("write exact item: {error}"));
                break;
            }
            match entry.get_secret() {
                Ok(loaded) if loaded == synthetic => {}
                Ok(_) => {
                    failure = Some("synthetic item mismatch".to_owned());
                    break;
                }
                Err(error) => {
                    failure = Some(format!("read exact synthetic item: {error}"));
                    break;
                }
            }
        }
        if failure.is_none() {
            let evidence = profile
                .inventory_with_backend(&backend, false)
                .expect("exact inventory");
            assert!(evidence
                .items
                .iter()
                .all(|item| item.state == InventoryState::Present && item.schema_valid));
        }
        let mut manifest = read_manifest(&profile.manifest_path).unwrap().unwrap();
        manifest.desktop_pid = None;
        write_manifest(&profile.manifest_path, &manifest).unwrap();
        let cleanup = profile.cleanup_with_backend(&backend, true);
        assert!(cleanup.is_ok(), "exact cleanup failed");
        assert!(!root.exists());
        assert!(failure.is_none(), "{}", failure.unwrap_or_default());
    }
}
