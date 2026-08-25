use super::host::{reconcile_background, SkillRuntime};
use crate::chat::ChatRuntime;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const BUNDLE_DIRECTORY: &str = "skill-packages";
const BUNDLE_MANIFEST: &str = "bundle-manifest.json";
const SKILLS_DIRECTORY: &str = "skills";
const INSTALLED_DIRECTORY: &str = "installed";
pub(crate) const SKILLS_DIRECTORY_CHANGED_EVENT: &str = "skills-directory-changed-v1";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsDirectoryChangedEvent {
    schema_version: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillRoots {
    pub bundle_root: PathBuf,
    pub install_root: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkillRootsError {
    PathNotAbsolute,
    ResourceDirectoryMissing,
    AppDataDirectoryMissing,
    BundleManifestMissing,
    PathIsSymlink,
    PathNotDirectory,
    PathNotRegularFile,
    PathOwnerMismatch,
    PathPermissionsUnsafe,
    RootsOverlap,
    PathUnavailable,
}

impl SkillRootsError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::PathNotAbsolute => "skill_path_not_absolute",
            Self::ResourceDirectoryMissing => "skill_resource_directory_missing",
            Self::AppDataDirectoryMissing => "skill_app_data_directory_missing",
            Self::BundleManifestMissing => "skill_bundle_manifest_missing",
            Self::PathIsSymlink => "skill_path_is_symlink",
            Self::PathNotDirectory => "skill_path_not_directory",
            Self::PathNotRegularFile => "skill_path_not_regular_file",
            Self::PathOwnerMismatch => "skill_path_owner_mismatch",
            Self::PathPermissionsUnsafe => "skill_path_permissions_unsafe",
            Self::RootsOverlap => "skill_roots_overlap",
            Self::PathUnavailable => "skill_path_unavailable",
        }
    }
}

impl Display for SkillRootsError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for SkillRootsError {}

/// Resolves the immutable bundled catalog and prepares the private managed root.
///
/// Both base paths must come from the native application path resolver. This
/// function never accepts an archive or destination supplied by the renderer and
/// never installs, extracts, moves, or deletes a Skill.
pub fn resolve_skill_roots(
    resource_dir: &Path,
    app_data_dir: &Path,
) -> Result<SkillRoots, SkillRootsError> {
    require_absolute(resource_dir)?;
    require_absolute(app_data_dir)?;

    let resource_dir =
        canonical_existing_directory(resource_dir, SkillRootsError::ResourceDirectoryMissing)?;
    let bundle_root = canonical_existing_directory(
        &resource_dir.join(BUNDLE_DIRECTORY),
        SkillRootsError::ResourceDirectoryMissing,
    )?;
    validate_bundle_authority(&bundle_root)?;
    validate_manifest(&bundle_root.join(BUNDLE_MANIFEST))?;

    let app_data_dir = canonical_app_data_directory(app_data_dir)?;

    let intended_install_root = app_data_dir
        .join(SKILLS_DIRECTORY)
        .join(INSTALLED_DIRECTORY);
    if paths_overlap(&bundle_root, &intended_install_root) {
        return Err(SkillRootsError::RootsOverlap);
    }

    let skills_root = ensure_private_child_directory(&app_data_dir, SKILLS_DIRECTORY)?;
    let install_root = ensure_private_child_directory(&skills_root, INSTALLED_DIRECTORY)?;
    if paths_overlap(&bundle_root, &install_root) {
        return Err(SkillRootsError::RootsOverlap);
    }

    Ok(SkillRoots {
        bundle_root,
        install_root,
    })
}

/// Emits only a content-free invalidation signal. The renderer must request a
/// fresh Host scan; filesystem paths and Skill identifiers never cross IPC.
pub(crate) fn watch_skill_install_root(app: AppHandle, install_root: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let initial_root = install_root.clone();
        let mut previous =
            tokio::task::spawn_blocking(move || install_root_fingerprint(&initial_root))
                .await
                .unwrap_or(None);
        let mut interval = tokio::time::interval(Duration::from_millis(750));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            interval.tick().await;
            let watched_root = install_root.clone();
            let current =
                tokio::task::spawn_blocking(move || install_root_fingerprint(&watched_root))
                    .await
                    .unwrap_or(None);
            if current == previous {
                continue;
            }
            previous = current;
            let runtime = app.state::<SkillRuntime>();
            let chat = app.state::<ChatRuntime>();
            reconcile_background(&runtime, &chat, "directory_changed").await;
            let _ = app.emit(
                SKILLS_DIRECTORY_CHANGED_EVENT,
                SkillsDirectoryChangedEvent { schema_version: 1 },
            );
        }
    });
}

fn install_root_fingerprint(path: &Path) -> Option<[u8; 32]> {
    const MAX_WATCHED_ENTRIES: usize = 8_192;
    let mut pending = vec![path.to_path_buf()];
    let mut records = Vec::new();
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory)
            .ok()?
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        for entry in entries {
            if records.len() >= MAX_WATCHED_ENTRIES {
                return None;
            }
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).ok()?;
            let relative = entry_path.strip_prefix(path).ok()?.to_path_buf();
            let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
            records.push((
                relative,
                metadata.len(),
                metadata.file_type().is_file(),
                metadata.file_type().is_dir(),
                metadata.file_type().is_symlink(),
                modified,
            ));
            if metadata.file_type().is_dir() {
                pending.push(entry_path);
            }
        }
    }
    records.sort_by(|first, second| first.0.cmp(&second.0));
    let mut digest = Sha256::new();
    for (relative, length, is_file, is_directory, is_symlink, modified) in records {
        digest.update(relative.as_os_str().as_encoded_bytes());
        digest.update([0]);
        digest.update(length.to_le_bytes());
        digest.update([is_file as u8, is_directory as u8, is_symlink as u8]);
        digest.update(modified.as_secs().to_le_bytes());
        digest.update(modified.subsec_nanos().to_le_bytes());
    }
    Some(digest.finalize().into())
}

fn require_absolute(path: &Path) -> Result<(), SkillRootsError> {
    if !path.is_absolute() {
        return Err(SkillRootsError::PathNotAbsolute);
    }
    Ok(())
}

fn canonical_existing_directory(
    path: &Path,
    missing: SkillRootsError,
) -> Result<PathBuf, SkillRootsError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(missing),
        Err(_) => return Err(SkillRootsError::PathUnavailable),
    };
    if metadata.file_type().is_symlink() {
        return Err(SkillRootsError::PathIsSymlink);
    }
    if !metadata.is_dir() {
        return Err(SkillRootsError::PathNotDirectory);
    }
    fs::canonicalize(path).map_err(|_| SkillRootsError::PathUnavailable)
}

fn canonical_app_data_directory(path: &Path) -> Result<PathBuf, SkillRootsError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(SkillRootsError::PathIsSymlink);
            }
            if !metadata.is_dir() {
                return Err(SkillRootsError::PathNotDirectory);
            }
            validate_app_data_authority(path)?;
            fs::canonicalize(path).map_err(|_| SkillRootsError::PathUnavailable)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_app_data_directory(path)
        }
        Err(_) => Err(SkillRootsError::PathUnavailable),
    }
}

fn create_app_data_directory(path: &Path) -> Result<PathBuf, SkillRootsError> {
    let parent = path
        .parent()
        .ok_or(SkillRootsError::AppDataDirectoryMissing)?;
    let name = path
        .file_name()
        .ok_or(SkillRootsError::AppDataDirectoryMissing)?;
    let canonical_parent =
        canonical_existing_directory(parent, SkillRootsError::AppDataDirectoryMissing)?;
    validate_app_data_authority(&canonical_parent)?;
    if canonical_parent.join(name) != path {
        return Err(SkillRootsError::PathUnavailable);
    }

    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(SkillRootsError::PathUnavailable),
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(SkillRootsError::PathIsSymlink);
    }
    if !metadata.is_dir() {
        return Err(SkillRootsError::PathNotDirectory);
    }
    make_owner_only(path, &metadata)?;
    let canonical = fs::canonicalize(path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if canonical.parent() != Some(canonical_parent.as_path()) {
        return Err(SkillRootsError::PathIsSymlink);
    }
    Ok(canonical)
}

fn validate_manifest(path: &Path) -> Result<(), SkillRootsError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(SkillRootsError::BundleManifestMissing);
        }
        Err(_) => return Err(SkillRootsError::PathUnavailable),
    };
    if metadata.file_type().is_symlink() {
        return Err(SkillRootsError::PathIsSymlink);
    }
    if !metadata.is_file() {
        return Err(SkillRootsError::PathNotRegularFile);
    }
    Ok(())
}

fn ensure_private_child_directory(parent: &Path, name: &str) -> Result<PathBuf, SkillRootsError> {
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(SkillRootsError::PathUnavailable),
    }

    let metadata = fs::symlink_metadata(&path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(SkillRootsError::PathIsSymlink);
    }
    if !metadata.is_dir() {
        return Err(SkillRootsError::PathNotDirectory);
    }
    make_owner_only(&path, &metadata)?;

    let canonical = fs::canonicalize(&path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if canonical.parent() != Some(parent) {
        return Err(SkillRootsError::PathIsSymlink);
    }
    Ok(canonical)
}

fn paths_overlap(first: &Path, second: &Path) -> bool {
    first == second || first.starts_with(second) || second.starts_with(first)
}

#[cfg(unix)]
fn validate_bundle_authority(path: &Path) -> Result<(), SkillRootsError> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::symlink_metadata(path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err(SkillRootsError::PathPermissionsUnsafe);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_bundle_authority(_path: &Path) -> Result<(), SkillRootsError> {
    Ok(())
}

#[cfg(unix)]
fn validate_app_data_authority(path: &Path) -> Result<(), SkillRootsError> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let metadata = fs::symlink_metadata(path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(SkillRootsError::PathOwnerMismatch);
    }
    if metadata.permissions().mode() & 0o022 != 0 {
        return Err(SkillRootsError::PathPermissionsUnsafe);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_app_data_authority(_path: &Path) -> Result<(), SkillRootsError> {
    Ok(())
}

#[cfg(unix)]
fn make_owner_only(path: &Path, metadata: &fs::Metadata) -> Result<(), SkillRootsError> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(SkillRootsError::PathOwnerMismatch);
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| SkillRootsError::PathUnavailable)?;
    let secured = fs::symlink_metadata(path).map_err(|_| SkillRootsError::PathUnavailable)?;
    if secured.file_type().is_symlink() || !secured.is_dir() {
        return Err(SkillRootsError::PathIsSymlink);
    }
    if secured.uid() != unsafe { libc::geteuid() } {
        return Err(SkillRootsError::PathOwnerMismatch);
    }
    if secured.permissions().mode() & 0o077 != 0 {
        return Err(SkillRootsError::PathPermissionsUnsafe);
    }
    Ok(())
}

#[cfg(not(unix))]
fn make_owner_only(_path: &Path, _metadata: &fs::Metadata) -> Result<(), SkillRootsError> {
    // Windows ACL hardening is performed by the Tauri App Data bootstrap. This
    // module still rejects reparse-point projections exposed as symlinks and
    // returns only canonical paths.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "yijie-skill-roots-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create test root");
            #[cfg(unix)]
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                .expect("protect test root");
            Self(fs::canonicalize(path).expect("canonical test root"))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(label: &str) -> (TestRoot, PathBuf, PathBuf) {
        let root = TestRoot::new(label);
        let resource = root.path().join("resource");
        let bundle = resource.join(BUNDLE_DIRECTORY);
        let app_data = root.path().join("app-data");
        fs::create_dir(&resource).unwrap();
        fs::create_dir(&bundle).unwrap();
        fs::write(bundle.join(BUNDLE_MANIFEST), b"{}\n").unwrap();
        fs::create_dir(&app_data).unwrap();
        #[cfg(unix)]
        {
            fs::set_permissions(&resource, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&bundle, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&app_data, fs::Permissions::from_mode(0o700)).unwrap();
        }
        (root, resource, app_data)
    }

    #[test]
    fn resolves_bundle_and_creates_only_private_managed_directories() {
        let (_root, resource, app_data) = fixture("ready");
        let roots = resolve_skill_roots(&resource, &app_data).unwrap();

        assert_eq!(roots.bundle_root, resource.join(BUNDLE_DIRECTORY));
        assert_eq!(
            roots.install_root,
            app_data.join(SKILLS_DIRECTORY).join(INSTALLED_DIRECTORY)
        );
        assert!(roots.bundle_root.is_absolute());
        assert!(roots.install_root.is_absolute());

        #[cfg(unix)]
        for directory in [app_data.join(SKILLS_DIRECTORY), roots.install_root] {
            let mode = fs::symlink_metadata(directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[test]
    fn first_start_creates_one_private_app_data_layer_and_managed_roots() {
        let root = TestRoot::new("first-start");
        let resource = root.path().join("resource");
        let bundle = resource.join(BUNDLE_DIRECTORY);
        let app_data = root.path().join("new-app-data");
        fs::create_dir(&resource).unwrap();
        fs::create_dir(&bundle).unwrap();
        fs::write(bundle.join(BUNDLE_MANIFEST), b"{}\n").unwrap();
        #[cfg(unix)]
        {
            fs::set_permissions(&resource, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&bundle, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let roots = resolve_skill_roots(&resource, &app_data).unwrap();
        assert_eq!(
            roots.install_root,
            app_data.join(SKILLS_DIRECTORY).join(INSTALLED_DIRECTORY)
        );

        #[cfg(unix)]
        for directory in [
            app_data.clone(),
            app_data.join(SKILLS_DIRECTORY),
            roots.install_root,
        ] {
            let mode = fs::symlink_metadata(directory)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[test]
    fn first_start_does_not_recursively_create_a_missing_app_data_parent() {
        let (root, resource, _existing_app_data) = fixture("missing-app-data-parent");
        let missing_parent = root.path().join("missing-parent");
        let app_data = missing_parent.join("app-data");
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::AppDataDirectoryMissing)
        );
        assert!(!missing_parent.exists());
    }

    #[test]
    fn missing_resource_directory_and_manifest_have_stable_errors() {
        let root = TestRoot::new("missing");
        let app_data = root.path().join("app-data");
        fs::create_dir(&app_data).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&app_data, fs::Permissions::from_mode(0o700)).unwrap();

        let missing_resource = root.path().join("missing-resource");
        assert_eq!(
            resolve_skill_roots(&missing_resource, &app_data),
            Err(SkillRootsError::ResourceDirectoryMissing)
        );

        let resource = root.path().join("resource");
        fs::create_dir(&resource).unwrap();
        fs::create_dir(resource.join(BUNDLE_DIRECTORY)).unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::BundleManifestMissing)
        );
        assert_eq!(
            SkillRootsError::ResourceDirectoryMissing.code(),
            "skill_resource_directory_missing"
        );
        assert_eq!(
            SkillRootsError::BundleManifestMissing.code(),
            "skill_bundle_manifest_missing"
        );
    }

    #[test]
    fn rejects_non_directory_managed_projection_and_overlapping_roots() {
        let (_root, resource, app_data) = fixture("invalid");
        fs::create_dir(app_data.join(SKILLS_DIRECTORY)).unwrap();
        fs::write(
            app_data.join(SKILLS_DIRECTORY).join(INSTALLED_DIRECTORY),
            b"not a directory",
        )
        .unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathNotDirectory)
        );

        let root = TestRoot::new("overlap");
        let resource = root.path().join("resource");
        let bundle = resource.join(BUNDLE_DIRECTORY);
        let app_data = bundle.join("app-data");
        fs::create_dir(&resource).unwrap();
        fs::create_dir(&bundle).unwrap();
        fs::write(bundle.join(BUNDLE_MANIFEST), b"{}\n").unwrap();
        fs::create_dir(&app_data).unwrap();
        #[cfg(unix)]
        {
            fs::set_permissions(&bundle, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&app_data, fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::RootsOverlap)
        );
        assert!(!app_data.join(SKILLS_DIRECTORY).exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_bundle_manifest_and_managed_directory() {
        let (root, resource, app_data) = fixture("symlink");
        let bundle = resource.join(BUNDLE_DIRECTORY);

        let bundle_target = root.path().join("bundle-target");
        fs::create_dir(&bundle_target).unwrap();
        fs::write(bundle_target.join(BUNDLE_MANIFEST), b"{}\n").unwrap();
        fs::remove_dir_all(&bundle).unwrap();
        symlink(&bundle_target, &bundle).unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathIsSymlink)
        );

        fs::remove_file(&bundle).unwrap();
        fs::create_dir(&bundle).unwrap();
        fs::set_permissions(&bundle, fs::Permissions::from_mode(0o755)).unwrap();
        let manifest_target = root.path().join("manifest-target");
        fs::write(&manifest_target, b"{}\n").unwrap();
        symlink(&manifest_target, bundle.join(BUNDLE_MANIFEST)).unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathIsSymlink)
        );

        fs::remove_file(bundle.join(BUNDLE_MANIFEST)).unwrap();
        fs::write(bundle.join(BUNDLE_MANIFEST), b"{}\n").unwrap();
        let target = root.path().join("managed-target");
        fs::create_dir(&target).unwrap();
        fs::create_dir(app_data.join(SKILLS_DIRECTORY)).unwrap();
        symlink(
            &target,
            app_data.join(SKILLS_DIRECTORY).join(INSTALLED_DIRECTORY),
        )
        .unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathIsSymlink)
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_writable_bundle_or_app_data_authority_before_creating_managed_state() {
        let (_root, resource, app_data) = fixture("permissions");
        let bundle = resource.join(BUNDLE_DIRECTORY);
        fs::set_permissions(&bundle, fs::Permissions::from_mode(0o777)).unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathPermissionsUnsafe)
        );
        assert!(!app_data.join(SKILLS_DIRECTORY).exists());

        fs::set_permissions(&bundle, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&app_data, fs::Permissions::from_mode(0o777)).unwrap();
        assert_eq!(
            resolve_skill_roots(&resource, &app_data),
            Err(SkillRootsError::PathPermissionsUnsafe)
        );
        assert!(!app_data.join(SKILLS_DIRECTORY).exists());
    }

    #[test]
    fn rejects_relative_base_paths_without_touching_the_filesystem() {
        assert_eq!(
            resolve_skill_roots(Path::new("resource"), Path::new("app-data")),
            Err(SkillRootsError::PathNotAbsolute)
        );
    }

    #[test]
    fn install_root_fingerprint_changes_when_a_skill_directory_is_moved() {
        let root = TestRoot::new("fingerprint");
        let installed = root.path().join("installed");
        fs::create_dir(&installed).unwrap();
        let skill = installed.join("yijie.content-marketing.copywriting");
        fs::create_dir(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), b"fixture").unwrap();

        let before = install_root_fingerprint(&installed).unwrap();
        fs::rename(
            &skill,
            root.path()
                .join("yijie.content-marketing.copywriting.moved"),
        )
        .unwrap();
        let after = install_root_fingerprint(&installed).unwrap();

        assert_ne!(before, after);

        let nested_skill = installed.join("yijie.market-research.company-research");
        let references = nested_skill.join("references");
        fs::create_dir_all(&references).unwrap();
        let nested_source = references.join("method.md");
        fs::write(&nested_source, b"fixture").unwrap();
        let before_nested_delete = install_root_fingerprint(&installed).unwrap();
        fs::remove_file(nested_source).unwrap();
        let after_nested_delete = install_root_fingerprint(&installed).unwrap();
        assert_ne!(before_nested_delete, after_nested_delete);
    }
}
