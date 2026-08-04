use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MASTER_ENV: &str = "YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED";
const SECURE_STORAGE_ENV: &str = "YIJIE_FEAT126_S10_SECURE_STORAGE_ENABLED";
const RUN_ID_ENV: &str = "YIJIE_FEAT126_S10_RUN_ID";
const RUN_ROOT_ENV: &str = "YIJIE_FEAT126_S10_RUN_ROOT";
const FAKE_RESPONSES_ENV: &str = "YIJIE_FEAT126_FAKE_RESPONSES_BASE_URL";
const HOST_HOME_ENV: &str = "YIJIE_AGENT_HOST_HOME";
const CODEX_HOME_ENV: &str = "YIJIE_CODEX_HOME";
const FAKE_RESPONSES_BASE_URL: &str = "http://127.0.0.1:18082/v1";
const MANIFEST_SCHEMA_VERSION: u16 = 1;
const MANIFEST_DIRECTORY: &str = "secure-storage";
const MANIFEST_FILE: &str = "manifest.json";
const DESKTOP_APP_DATA_DIRECTORY: &str = "desktop-app-data";
const HOST_HOME_DIRECTORY: &str = "host-home";
const CODEX_HOME_DIRECTORY: &str = "codex-home";
const PROJECT_DIRECTORY: &str = "project";
const KEYCHAIN_ACCOUNT: &str = "default-v1";
const NATIVE_AUTH_ACCOUNT: &str = "refresh-token-family-v2";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SecureStorageError {
    InvalidConfiguration,
    Unavailable,
    ConcurrentRun,
    CleanupRefused,
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
    namespaces: [KeychainNamespace; 3],
    descriptor_sha256: String,
}

impl std::fmt::Debug for Feat126SecureStorageProfile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Feat126SecureStorageProfile")
            .field("run_id", &self.run_id)
            .field("run_root", &"[RUN_SCOPED]")
            .field("namespace_descriptor", &self.descriptor_sha256)
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

impl Feat126SecureStorageProfile {
    pub(crate) fn from_environment() -> Result<Option<Self>, SecureStorageError> {
        let master = std::env::var(MASTER_ENV).unwrap_or_default();
        let secure_storage = std::env::var(SECURE_STORAGE_ENV).unwrap_or_default();
        let run_id = std::env::var(RUN_ID_ENV).unwrap_or_default();
        let run_root = std::env::var(RUN_ROOT_ENV).unwrap_or_default();
        let fake_responses = std::env::var(FAKE_RESPONSES_ENV).unwrap_or_default();

        if !secure_storage_gate(
            &master,
            &secure_storage,
            !run_id.is_empty() || !run_root.is_empty() || !fake_responses.is_empty(),
        )? {
            return Ok(None);
        }
        let parsed =
            uuid::Uuid::parse_str(&run_id).map_err(|_| SecureStorageError::InvalidConfiguration)?;
        if parsed.is_nil()
            || parsed.hyphenated().to_string() != run_id
            || fake_responses != FAKE_RESPONSES_BASE_URL
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        let run_root = validate_run_root(Path::new(&run_root))?;
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
        Ok(Some(Self {
            run_id,
            run_root,
            desktop_app_data,
            host_home,
            codex_home,
            project,
            manifest_path,
            namespaces,
            descriptor_sha256,
        }))
    }

    pub(crate) fn desktop_app_data(&self) -> &Path {
        &self.desktop_app_data
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

    pub(crate) fn validate_project_path(&self, path: &Path) -> Result<(), SecureStorageError> {
        let path = validate_private_directory(path)?;
        if path != self.project {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        Ok(())
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
        for path in [
            &self.desktop_app_data,
            &self.host_home,
            &self.codex_home,
            &self.project,
            self.manifest_path
                .parent()
                .ok_or(SecureStorageError::InvalidConfiguration)?,
        ] {
            create_or_validate_private_directory(path)?;
        }
        let backend = PlatformExactKeychain::new()?;
        self.prepare_with_backend(&backend)
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
                    schema_version: MANIFEST_SCHEMA_VERSION,
                    run_id: self.run_id.clone(),
                    owner_uid: effective_uid(),
                    namespace_descriptor_sha256: self.descriptor_sha256.clone(),
                    directory_roles: directory_roles(),
                    phase: ManifestPhase::Prepared,
                    desktop_pid: None,
                    recovery_count: 0,
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

    fn validate_manifest(
        &self,
        manifest: &SecureStorageManifest,
    ) -> Result<(), SecureStorageError> {
        if manifest.schema_version != MANIFEST_SCHEMA_VERSION
            || manifest.run_id != self.run_id
            || manifest.owner_uid != effective_uid()
            || manifest.namespace_descriptor_sha256 != self.descriptor_sha256
            || manifest.directory_roles != directory_roles()
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        for path in [
            &self.run_root,
            &self.desktop_app_data,
            &self.host_home,
            &self.codex_home,
            &self.project,
            self.manifest_path
                .parent()
                .ok_or(SecureStorageError::InvalidConfiguration)?,
        ] {
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
            schema_version: MANIFEST_SCHEMA_VERSION,
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
            validate_run_root(&self.run_root)?;
            fs::remove_dir_all(&self.run_root).map_err(|_| SecureStorageError::CleanupRefused)?;
        }
        Ok(evidence)
    }
}

fn secure_storage_gate(
    master: &str,
    secure_storage: &str,
    test_context_present: bool,
) -> Result<bool, SecureStorageError> {
    if master != "true" {
        if (!master.is_empty() && master != "false")
            || (!secure_storage.is_empty() && secure_storage != "false")
            || test_context_present
        {
            return Err(SecureStorageError::InvalidConfiguration);
        }
        return Ok(false);
    }
    match secure_storage {
        "true" => Ok(true),
        "" | "false" => Ok(false),
        _ => Err(SecureStorageError::InvalidConfiguration),
    }
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

fn directory_roles() -> Vec<String> {
    [
        DESKTOP_APP_DATA_DIRECTORY,
        HOST_HOME_DIRECTORY,
        CODEX_HOME_DIRECTORY,
        PROJECT_DIRECTORY,
        MANIFEST_DIRECTORY,
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn require_exact_environment_path(name: &str, expected: &Path) -> Result<(), SecureStorageError> {
    let value = std::env::var(name).map_err(|_| SecureStorageError::InvalidConfiguration)?;
    if Path::new(&value) != expected {
        return Err(SecureStorageError::InvalidConfiguration);
    }
    Ok(())
}

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
    let backend = PlatformExactKeychain::new().map_err(|_| "secure_storage_unavailable")?;
    match action {
        "prepare" => {
            for path in [
                &profile.desktop_app_data,
                &profile.host_home,
                &profile.codex_home,
                &profile.project,
                profile
                    .manifest_path
                    .parent()
                    .ok_or("secure_storage_invalid")?,
            ] {
                create_or_validate_private_directory(path).map_err(|_| "secure_storage_invalid")?;
            }
            profile
                .prepare_with_backend(&backend)
                .map_err(|_| "secure_storage_prepare_failed")?;
            profile
                .inventory_with_backend(&backend, false)
                .map_err(|_| "secure_storage_inventory_failed")
        }
        "inventory" => {
            let manifest = read_manifest(&profile.manifest_path)
                .map_err(|_| "secure_storage_invalid")?
                .ok_or("secure_storage_invalid")?;
            profile
                .validate_manifest(&manifest)
                .map_err(|_| "secure_storage_invalid")?;
            profile
                .inventory_with_backend(&backend, false)
                .map_err(|_| "secure_storage_inventory_failed")
        }
        "cleanup" => profile
            .cleanup_with_backend(&backend, true)
            .map_err(|_| "secure_storage_cleanup_failed"),
        _ => Err("secure_storage_invalid_action"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
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
            descriptor_sha256: namespace_descriptor_sha256(&namespaces),
            namespaces,
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

    #[test]
    fn directory_roles_are_closed_and_path_free() {
        let expected: HashMap<_, _> = directory_roles().into_iter().enumerate().collect();
        assert_eq!(expected.len(), 5);
        assert_eq!(
            expected.get(&0).map(String::as_str),
            Some("desktop-app-data")
        );
        assert_eq!(expected.get(&4).map(String::as_str), Some("secure-storage"));
    }

    #[test]
    fn secure_storage_requires_two_exact_true_gates_and_defaults_off() {
        assert_eq!(secure_storage_gate("", "", false), Ok(false));
        assert_eq!(secure_storage_gate("false", "false", false), Ok(false));
        assert_eq!(secure_storage_gate("true", "", true), Ok(false));
        assert_eq!(secure_storage_gate("true", "false", true), Ok(false));
        assert_eq!(secure_storage_gate("true", "true", true), Ok(true));
        for (master, secure, context) in [
            ("TRUE", "true", true),
            ("false", "true", true),
            ("true", "1", true),
            ("", "", true),
        ] {
            assert_eq!(
                secure_storage_gate(master, secure, context),
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
