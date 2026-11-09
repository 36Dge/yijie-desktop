//! Application-owned document assembly, immutable input copies and layout
//! projection. No user supplied executable paths or new IPC command surface.
use super::artifact_native::ArtifactNativeCode as Code;
use super::document_runtime_generated::{BundleManifest, InputReceipt};
use super::error::ChatError;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

pub(super) fn enabled() -> bool {
    super::artifact_media::enabled()
        && std::env::var("YIJIE_FEAT171_DOCUMENT_RUNTIME").as_deref() == Ok("true")
}
pub(super) fn state_root() -> Result<PathBuf, ChatError> {
    let root = PathBuf::from(
        std::env::var("YIJIE_DOCUMENT_STATE_ROOT").map_err(|_| ChatError::InvalidConfiguration)?,
    );
    if !root.is_absolute()
        || root.is_symlink()
        || fs::canonicalize(&root).ok().as_ref() != Some(&root)
        || !root.is_dir()
    {
        return Err(ChatError::InvalidConfiguration);
    }
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata = fs::metadata(&root).map_err(|_| ChatError::InvalidConfiguration)?;
    if metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err(ChatError::InvalidConfiguration);
    }
    Ok(root)
}
fn seconds() -> Result<u64, ChatError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| ChatError::DatabaseUnavailable)
}
fn regular_tree_bytes(dir: &Path) -> Result<u64, ChatError> {
    let mut total = 0_u64;
    for item in fs::read_dir(dir).map_err(|_| ChatError::DatabaseUnavailable)? {
        let item = item.map_err(|_| ChatError::DatabaseUnavailable)?;
        let metadata =
            fs::symlink_metadata(item.path()).map_err(|_| ChatError::DatabaseUnavailable)?;
        if metadata.is_symlink() {
            return Err(ChatError::DatabaseUnavailable);
        }
        total = total.saturating_add(if metadata.is_dir() {
            regular_tree_bytes(&item.path())?
        } else {
            metadata.len()
        });
        if total > 2 * 1024 * 1024 * 1024 {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    Ok(total)
}
fn cleanup_inputs(inputs: &Path, now: u64) -> Result<(), ChatError> {
    for directory in fs::read_dir(inputs).map_err(|_| ChatError::DatabaseUnavailable)? {
        let directory = directory.map_err(|_| ChatError::DatabaseUnavailable)?;
        let operation = directory.file_name().to_string_lossy().into_owned();
        if Uuid::parse_str(&operation).is_err()
            || directory.path().is_symlink()
            || !directory.path().is_dir()
        {
            continue;
        }
        for item in fs::read_dir(directory.path()).map_err(|_| ChatError::DatabaseUnavailable)? {
            let path = item.map_err(|_| ChatError::DatabaseUnavailable)?.path();
            if !path
                .file_name()
                .and_then(|x| x.to_str())
                .is_some_and(|n| n.ends_with(".receipt.json"))
                || path.is_symlink()
            {
                continue;
            }
            let stat = fs::metadata(&path).map_err(|_| ChatError::DatabaseUnavailable)?;
            if !stat.is_file() || stat.len() > 4096 {
                continue;
            }
            let Ok(receipt) = serde_json::from_slice::<InputReceipt>(
                &fs::read(&path).map_err(|_| ChatError::DatabaseUnavailable)?,
            ) else {
                continue;
            };
            if receipt.schema_version != 1
                || receipt.operation_id != operation
                || Uuid::parse_str(&receipt.attachment_id).is_err()
                || path
                    .file_name()
                    .and_then(|x| x.to_str())
                    .and_then(|n| n.strip_suffix(".receipt.json"))
                    != Some(receipt.attachment_id.as_str())
                || receipt.expires_at > now
                || ![
                    "txt", "md", "html", "csv", "json", "docx", "pptx", "xlsx", "pdf",
                ]
                .contains(&receipt.format.as_str())
            {
                continue;
            }
            let original = directory
                .path()
                .join(format!("{}.{}", receipt.attachment_id, receipt.format));
            if original.is_symlink() {
                continue;
            }
            if original.is_file() {
                let bytes = fs::read(&original).map_err(|_| ChatError::DatabaseUnavailable)?;
                if bytes.len() as u64 != receipt.size_bytes || digest(&bytes) != receipt.sha256 {
                    continue;
                }
                fs::remove_file(original).map_err(|_| ChatError::DatabaseUnavailable)?;
            }
            fs::remove_file(path).map_err(|_| ChatError::DatabaseUnavailable)?;
        }
        // Removes only an empty, owned cache directory; unknown files survive.
        let _ = fs::remove_dir(directory.path());
    }
    Ok(())
}
fn local(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

// The first preview verifies almost 1 GiB. Use the platform SHA-256 primitive
// rather than debug-build software compression, retaining every manifest check.
// ABI: macOS SDK CommonCrypto/CommonDigest.h, available since macOS 10.4.
#[cfg(target_os = "macos")]
pub(crate) fn file_digest(path: &Path) -> Result<String, Code> {
    use std::io::Read;
    #[repr(C)]
    struct Context {
        count: [u32; 2],
        hash: [u32; 8],
        wbuf: [u32; 16],
    }
    #[link(name = "System")]
    unsafe extern "C" {
        fn CC_SHA256_Init(context: *mut Context) -> i32;
        fn CC_SHA256_Update(
            context: *mut Context,
            data: *const std::ffi::c_void,
            length: u32,
        ) -> i32;
        fn CC_SHA256_Final(output: *mut u8, context: *mut Context) -> i32;
    }
    let mut context = Context {
        count: [0; 2],
        hash: [0; 8],
        wbuf: [0; 16],
    };
    let mut file = fs::File::open(path).map_err(|_| Code::IntegrityFailed)?;
    let mut buffer = [0_u8; 65536];
    let mut output = [0_u8; 32];
    if unsafe { CC_SHA256_Init(&mut context) } != 1 {
        return Err(Code::IntegrityFailed);
    }
    loop {
        let count = file.read(&mut buffer).map_err(|_| Code::IntegrityFailed)?;
        if count == 0 {
            break;
        }
        // buffer lives across the synchronous call and its length fits CC_LONG.
        if unsafe { CC_SHA256_Update(&mut context, buffer.as_ptr().cast(), count as u32) } != 1 {
            return Err(Code::IntegrityFailed);
        }
    }
    if unsafe { CC_SHA256_Final(output.as_mut_ptr(), &mut context) } != 1 {
        return Err(Code::IntegrityFailed);
    }
    Ok(output.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn file_digest(path: &Path) -> Result<String, Code> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|_| Code::IntegrityFailed)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(|_| Code::IntegrityFailed)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn bundle() -> Result<(PathBuf, BundleManifest), Code> {
    let root =
        PathBuf::from(std::env::var("YIJIE_DOCUMENT_BUNDLE_DIR").map_err(|_| Code::Unavailable)?);
    let expected = std::env::var("YIJIE_DOCUMENT_BUNDLE_SHA256").map_err(|_| Code::Unavailable)?;
    if !root.is_absolute() || root.is_symlink() || root.canonicalize().ok().as_ref() != Some(&root)
    {
        return Err(Code::Unavailable);
    }
    let manifest_path = root.join("manifest.json");
    if fs::symlink_metadata(&manifest_path)
        .map_err(|_| Code::Unavailable)?
        .len()
        > 8 * 1024 * 1024
    {
        return Err(Code::LimitExceeded);
    }
    let raw = fs::read(&manifest_path).map_err(|_| Code::Unavailable)?;
    if digest(&raw) != expected {
        return Err(Code::IntegrityFailed);
    }
    let manifest: BundleManifest =
        serde_json::from_slice(&raw).map_err(|_| Code::IntegrityFailed)?;
    if manifest.schema_version != 1
        || manifest.platform != "macos-arm64"
        || manifest.minimum_macos != "14.0"
        || manifest.python_version != "3.12.16"
        || manifest.libreoffice_version != "26.8.2"
        || manifest.files.is_empty()
        || manifest.files.len() > 30000
        || manifest.guides.len() != 9
    {
        return Err(Code::Unsupported);
    }
    // Verification cache includes each file's inode/ctime, so a changed source
    // invalidates the cached hash. Never caches only the untrusted manifest ID.
    use std::os::unix::fs::MetadataExt;
    static CACHE: OnceLock<Mutex<std::collections::HashMap<PathBuf, (u64, i64, i64, String)>>> =
        OnceLock::new();
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| Code::Unavailable)?;
    let mut listed = BTreeSet::new();
    for entry in &manifest.files {
        if !local(&entry.path) || !listed.insert(entry.path.clone()) {
            return Err(Code::IntegrityFailed);
        }
        let path = root.join(&entry.path);
        let stat = fs::symlink_metadata(&path).map_err(|_| Code::IntegrityFailed)?;
        let stamp = (
            stat.ino(),
            stat.ctime(),
            stat.ctime_nsec(),
            entry.sha256.clone(),
        );
        if cache.get(&path) == Some(&stamp) {
            continue;
        }
        let actual = if entry.kind == "symlink" && stat.is_symlink() {
            let target = fs::read_link(&path).map_err(|_| Code::IntegrityFailed)?;
            if target.is_absolute()
                || target.to_str() != Some(&entry.link_target)
                || !path
                    .canonicalize()
                    .map_err(|_| Code::IntegrityFailed)?
                    .starts_with(&root)
            {
                return Err(Code::IntegrityFailed);
            }
            digest(entry.link_target.as_bytes())
        } else if entry.kind == "file" && stat.is_file() && stat.len() == entry.size_bytes {
            file_digest(&path)?
        } else {
            return Err(Code::IntegrityFailed);
        };
        if actual != entry.sha256 {
            return Err(Code::IntegrityFailed);
        }
        cache.insert(path, stamp);
    }
    fn walk(root: &Path, dir: &Path, listed: &BTreeSet<String>) -> Result<(), Code> {
        for entry in fs::read_dir(dir).map_err(|_| Code::IntegrityFailed)? {
            let entry = entry.map_err(|_| Code::IntegrityFailed)?;
            let path = entry.path();
            if entry
                .file_type()
                .map_err(|_| Code::IntegrityFailed)?
                .is_dir()
            {
                walk(root, &path, listed)?;
            } else {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| Code::IntegrityFailed)?
                    .to_str()
                    .ok_or(Code::IntegrityFailed)?;
                if relative != "manifest.json" && !listed.contains(relative) {
                    return Err(Code::IntegrityFailed);
                }
            }
        }
        Ok(())
    }
    walk(&root, &root, &listed)?;
    for path in [
        &manifest.python,
        &manifest.helper,
        &manifest.renderer,
        &manifest.libreoffice,
    ] {
        if !local(path) || !listed.contains(path) {
            return Err(Code::IntegrityFailed);
        }
    }
    Ok((root, manifest))
}

pub(super) fn extension(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "text/plain" => "txt",
        "text/markdown" => "md",
        "text/html" => "html",
        "text/csv" => "csv",
        "application/json" => "json",
        "application/pdf" => "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        _ => return None,
    })
}

// Called only after the existing scoped outbox/message digest was validated.
// Cache files are bounded projections; encrypted attachment bytes stay primary.
pub(super) fn stage_input(
    operation: Uuid,
    attachment: Uuid,
    mime: &str,
    bytes: &[u8],
    hash: &str,
    expires: i64,
    now: i64,
) -> Result<(), ChatError> {
    if !enabled() {
        return Ok(());
    }
    let Some(ext) = extension(mime) else {
        return Ok(());
    };
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 || digest(bytes) != hash || expires <= now
    {
        return Err(ChatError::DatabaseUnavailable);
    }
    let inputs = state_root()?.join("inputs");
    let _guard = INPUT_LOCK
        .lock()
        .map_err(|_| ChatError::DatabaseUnavailable)?;
    fs::create_dir_all(&inputs).map_err(|_| ChatError::DatabaseUnavailable)?;
    cleanup_inputs(&inputs, now as u64)?;
    let folder = inputs.join(operation.to_string());
    fs::create_dir_all(&folder).map_err(|_| ChatError::DatabaseUnavailable)?;
    if folder.is_symlink() || folder.canonicalize().ok().as_ref() != Some(&folder) {
        return Err(ChatError::DatabaseUnavailable);
    }
    let name = format!("{attachment}.{ext}");
    let path = folder.join(&name);
    let existing = path.exists();
    if existing {
        if path.is_symlink()
            || digest(&fs::read(&path).map_err(|_| ChatError::DatabaseUnavailable)?) != hash
        {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    let receipt = InputReceipt {
        schema_version: 1,
        operation_id: operation.to_string(),
        attachment_id: attachment.to_string(),
        sha256: hash.to_owned(),
        size_bytes: bytes.len() as u64,
        format: ext.into(),
        expires_at: expires.min(now.saturating_add(86400)) as u64,
    };
    let metadata = folder.join(format!("{attachment}.receipt.json"));
    let previous_size = if metadata.exists() {
        if metadata.is_symlink() || !metadata.is_file() {
            return Err(ChatError::DatabaseUnavailable);
        }
        fs::metadata(&metadata)
            .map_err(|_| ChatError::DatabaseUnavailable)?
            .len()
    } else {
        0
    };
    let encoded = serde_json::to_vec(&receipt).map_err(|_| ChatError::DatabaseUnavailable)?;
    if !input_quota_allows(
        regular_tree_bytes(&inputs)?,
        if existing { 0 } else { bytes.len() as u64 },
        previous_size,
        encoded.len() as u64,
    ) {
        return Err(ChatError::DatabaseUnavailable);
    }
    if !existing {
        atomic_cache_file(&path, bytes, false).map_err(|_| ChatError::DatabaseUnavailable)?;
    }
    atomic_metadata(&metadata, &encoded).map_err(|_| ChatError::DatabaseUnavailable)?;
    Ok(())
}
static INPUT_LOCK: Mutex<()> = Mutex::new(());
fn input_quota_allows(used: u64, added: u64, previous_metadata: u64, next_metadata: u64) -> bool {
    used.saturating_sub(previous_metadata)
        .saturating_add(added)
        .saturating_add(next_metadata)
        <= 512 * 1024 * 1024
}
fn atomic_metadata(path: &Path, bytes: &[u8]) -> Result<(), Code> {
    atomic_cache_file(path, bytes, true)
}
fn atomic_cache_file(path: &Path, bytes: &[u8], replace: bool) -> Result<(), Code> {
    use std::os::unix::fs::OpenOptionsExt;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::now_v7()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if replace {
            fs::rename(&temporary, path)
        } else {
            // A partially written input must not occupy the stable reference.
            // Linking a fully synced owned file never replaces an existing one.
            fs::hard_link(&temporary, path)?;
            fs::remove_file(&temporary)
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| Code::Unavailable)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PreviewMarker {
    schema_version: u32,
    source_sha256: String,
    bundle_id: String,
    expires_at: u64,
    #[serde(default)]
    attempt_id: Option<Uuid>,
    #[serde(default)]
    finished: bool,
}
impl PreviewMarker {
    fn folder_name(&self) -> String {
        let base = format!("{}-{}", self.bundle_id, self.source_sha256);
        match self.attempt_id {
            Some(id) => format!("{base}-{id}"),
            None => base,
        }
    }
    fn persist(&self, folder: &Path) -> Result<(), Code> {
        atomic_metadata(
            &folder.join("native-cache.json"),
            &serde_json::to_vec(self).map_err(|_| Code::Unavailable)?,
        )
    }
}
fn preview_marker(folder: &Path) -> Option<PreviewMarker> {
    if folder.is_symlink() || !folder.is_dir() {
        return None;
    }
    let path = folder.join("native-cache.json");
    if path.is_symlink() || !path.is_file() || fs::metadata(&path).ok()?.len() > 4096 {
        return None;
    }
    let marker: PreviewMarker = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let hash = |s: &str| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit());
    if !hash(&marker.bundle_id)
        || !hash(&marker.source_sha256)
        || !matches!(
            (marker.schema_version, marker.attempt_id),
            (1, None) | (2, Some(_))
        )
        || folder.file_name()?.to_str()? != marker.folder_name()
    {
        return None;
    }
    Some(marker)
}
fn cached_projection(
    cache_root: &Path,
    bundle_id: &str,
    revision: &str,
    bytes: &[u8],
) -> Result<Option<Vec<u8>>, Code> {
    let prefix = format!("{bundle_id}-{revision}");
    for entry in fs::read_dir(cache_root).map_err(|_| Code::Unavailable)? {
        let entry = entry.map_err(|_| Code::Unavailable)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name != prefix && !name.starts_with(&format!("{prefix}-")) {
            continue;
        }
        let path = entry.path();
        let marker = preview_marker(&path).ok_or(Code::Unavailable)?;
        if marker.schema_version == 1 || marker.finished {
            if let Ok(pdf) = verified_projection(&path, bytes) {
                return Ok(Some(pdf));
            }
        }
        // A legacy incomplete cache has no ownership receipt. Preserve it and
        // do not presume the previous converter stopped on app exit.
        if marker.schema_version == 1 || !marker.finished {
            return Err(Code::Unavailable);
        }
    }
    Ok(None)
}

pub(super) fn layout_pdf(bytes: &[u8], mime: &str, revision: &str) -> Result<Vec<u8>, Code> {
    if !enabled() {
        return Err(Code::Unavailable);
    }
    let ext = extension(mime).ok_or(Code::Unsupported)?;
    if digest(bytes) != revision {
        return Err(Code::IntegrityFailed);
    }
    let (root, manifest) = bundle()?;
    let state = state_root().map_err(|_| Code::Unavailable)?;
    let cache_root = state.join("previews");
    fs::create_dir_all(&cache_root).map_err(|_| Code::Unavailable)?;
    // Bundle identity prevents reusing an older converter's cached projection.
    let _guard = PREVIEW_LOCK.lock().map_err(|_| Code::Unavailable)?;
    cleanup_previews(&cache_root)?;
    if regular_tree_bytes(&cache_root).map_err(|_| Code::LimitExceeded)? > 384 * 1024 * 1024 {
        return Err(Code::LimitExceeded);
    }
    if let Some(pdf) = cached_projection(&cache_root, &manifest.bundle_id, revision, bytes)? {
        return Ok(pdf);
    }
    let now = seconds().map_err(|_| Code::Unavailable)?;
    let mut marker = PreviewMarker {
        schema_version: 2,
        source_sha256: revision.into(),
        bundle_id: manifest.bundle_id.clone(),
        expires_at: now + 86400,
        attempt_id: Some(Uuid::now_v7()),
        finished: true,
    };
    let folder = cache_root.join(marker.folder_name());
    fs::create_dir(&folder).map_err(|_| Code::Unavailable)?;
    marker.persist(&folder)?;
    let input = folder.join(format!("source.{ext}"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&input)
        .map_err(|_| Code::Unavailable)?;
    file.write_all(bytes).map_err(|_| Code::Unavailable)?;
    let log = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join("conversion.log"))
        .map_err(|_| Code::Unavailable)?;
    // std::process::Child does not kill on drop. This blocking owner waits for
    // normal completion; the read lease/lifecycle holds the request meanwhile.
    let stdout = log.try_clone().map_err(|_| Code::Unavailable)?;
    marker.finished = false;
    marker.persist(&folder)?;
    let child = std::process::Command::new(root.join(manifest.python))
        .args(["-I", "-B"])
        .arg(root.join(manifest.helper))
        .arg("render")
        .arg(&input)
        .arg("--pdf-only")
        .arg("--output")
        .arg(folder.join("layout"))
        .current_dir(&folder)
        .env_clear()
        .env("YIJIE_DOCUMENT_STATE_ROOT", &state)
        .stdin(std::process::Stdio::null())
        .stdout(stdout)
        .stderr(log)
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(_) => {
            marker.finished = true; // No child was created.
            marker.persist(&folder)?;
            return Err(Code::Unavailable);
        }
    };
    let status = child.wait().map_err(|_| Code::Unavailable)?;
    marker.finished = true;
    marker.persist(&folder)?;
    if !status.success() {
        return Err(Code::Unsupported);
    }
    verified_projection(&folder, bytes)
}
fn verified_projection(folder: &Path, source: &[u8]) -> Result<Vec<u8>, Code> {
    let receipt: serde_json::Value = serde_json::from_slice(
        &fs::read(folder.join("layout/receipt.json")).map_err(|_| Code::Unavailable)?,
    )
    .map_err(|_| Code::IntegrityFailed)?;
    let path = folder.join("layout/layout.pdf");
    let stat = fs::symlink_metadata(&path).map_err(|_| Code::Unavailable)?;
    if !stat.is_file() || stat.len() > 10 * 1024 * 1024 {
        return Err(Code::IntegrityFailed);
    }
    let bytes = fs::read(path).map_err(|_| Code::Unavailable)?;
    if receipt["source_sha256"].as_str() != Some(&digest(source))
        || receipt["pdf_sha256"].as_str() != Some(&digest(&bytes))
    {
        return Err(Code::IntegrityFailed);
    }
    super::attachment::validate_pdf_artifact_content(&bytes).map_err(|_| Code::IntegrityFailed)?;
    Ok(bytes)
}
pub(super) fn style_sheet(
    presentation: &mut super::document_preview_content::Presentation,
) -> Result<(), Code> {
    let (root, manifest) = bundle()?;
    let mut fonts = Vec::new();
    for (index, name) in ["regular", "bold"].into_iter().enumerate() {
        let path = manifest.fonts.get(index).ok_or(Code::IntegrityFailed)?;
        if !local(path) {
            return Err(Code::IntegrityFailed);
        }
        let font = fs::read(root.join(path)).map_err(|_| Code::Unavailable)?;
        if font.len() > 32 * 1024 * 1024 {
            return Err(Code::LimitExceeded);
        }
        fonts.push((format!("font/{name}.ttf"), font));
    }
    presentation.assets.extend(fonts);
    presentation.html=presentation.html.replacen("</style>", "@font-face{font-family:'YiJie Document Sans';src:url('yijie-document://preview/font/regular.ttf');font-weight:400}@font-face{font-family:'YiJie Document Sans';src:url('yijie-document://preview/font/bold.ttf');font-weight:700}body{font-family:'YiJie Document Sans',system-ui}</style>",1);
    Ok(())
}
static PREVIEW_LOCK: Mutex<()> = Mutex::new(());
fn cleanup_previews(root: &Path) -> Result<(), Code> {
    let now = seconds().map_err(|_| Code::Unavailable)?;
    for item in fs::read_dir(root).map_err(|_| Code::Unavailable)? {
        let path = item.map_err(|_| Code::Unavailable)?.path();
        if !path.is_dir() || path.is_symlink() {
            continue;
        }
        let Some(marker) = preview_marker(&path) else {
            continue;
        };
        // Only confirmed completed attempts can be removed, even after TTL.
        if marker.schema_version != 2 || !marker.finished || marker.expires_at > now {
            continue;
        }
        let allowed = [
            "native-cache.json",
            "source.docx",
            "source.pptx",
            "source.xlsx",
            "conversion.log",
            "layout",
        ];
        let entries = fs::read_dir(&path)
            .map_err(|_| Code::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| Code::Unavailable)?;
        if entries.iter().any(|e| {
            e.path().is_symlink()
                || !allowed.contains(&e.file_name().to_string_lossy().as_ref())
                || (e.file_name() == "layout" && !e.path().is_dir())
                || (e.file_name() != "layout" && !e.path().is_file())
        }) {
            continue;
        }
        let sources = entries
            .iter()
            .filter(|e| e.file_name().to_string_lossy().starts_with("source."))
            .collect::<Vec<_>>();
        if sources.len() > 1
            || sources
                .iter()
                .any(|e| file_digest(&e.path()).ok().as_deref() != Some(&marker.source_sha256))
        {
            continue;
        }
        let layout = path.join("layout");
        if layout.exists() {
            let entries = fs::read_dir(&layout)
                .map_err(|_| Code::Unavailable)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| Code::Unavailable)?;
            if entries.iter().any(|e| {
                !e.path().is_file()
                    || e.path().is_symlink()
                    || !["layout.pdf", "receipt.json", ".yijie-qa-owner.json"]
                        .contains(&e.file_name().to_string_lossy().as_ref())
            }) {
                continue;
            }
        }
        fs::remove_dir_all(path).map_err(|_| Code::Unavailable)?;
    }
    Ok(())
}
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
pub(super) struct WorkLease;
pub(super) fn begin_work() -> WorkLease {
    ACTIVE.fetch_add(1, Ordering::SeqCst);
    WorkLease
}
impl Drop for WorkLease {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::SeqCst);
    }
}
pub(super) fn work_pending() -> bool {
    ACTIVE.load(Ordering::SeqCst) != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn managed_input_quota_counts_only_new_bytes() {
        let limit = 512 * 1024 * 1024;
        assert!(input_quota_allows(limit, 0, 300, 300));
        assert!(!input_quota_allows(limit, 1, 300, 300));
        assert!(input_quota_allows(limit - 2048, 1024, 0, 300));
    }

    #[test]
    fn managed_preview_attempt_lifecycle_retains_pending_and_retries_finished() {
        // Metadata transitions only, with no converter/process failure injected.
        let root = std::env::temp_dir().join(format!("yijie-preview-lifecycle-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let bytes = b"ordinary preview source";
        let mut marker = PreviewMarker {
            schema_version: 2,
            source_sha256: digest(bytes),
            bundle_id: "a".repeat(64),
            expires_at: 1,
            attempt_id: Some(Uuid::now_v7()),
            finished: false,
        };
        let folder = root.join(marker.folder_name());
        fs::create_dir(&folder).unwrap();
        marker.persist(&folder).unwrap();
        assert!(cached_projection(&root, &marker.bundle_id, &marker.source_sha256, bytes).is_err());
        cleanup_previews(&root).unwrap();
        assert!(folder.exists(), "expiry cannot remove an unconfirmed owner");
        marker.finished = true;
        marker.persist(&folder).unwrap();
        assert!(
            cached_projection(&root, &marker.bundle_id, &marker.source_sha256, bytes)
                .unwrap()
                .is_none()
        );
        assert!(
            folder.exists(),
            "retry retains previous diagnostics until TTL"
        );
        cleanup_previews(&root).unwrap();
        assert!(!folder.exists());
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn managed_document_stream_hash_matches_sha256() {
        let folder = std::env::temp_dir().join(format!("yijie-document-hash-{}", Uuid::now_v7()));
        fs::create_dir(&folder).unwrap();
        for data in [
            Vec::new(),
            "正常中文文档".as_bytes().to_vec(),
            vec![b'x'; 131073],
        ] {
            let path = folder.join("normal-data.txt");
            fs::write(&path, &data).unwrap();
            assert_eq!(file_digest(&path).unwrap(), digest(&data));
        }
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    #[ignore = "requires an explicitly selected sealed document bundle"]
    fn managed_document_bundle_cold_warm_verification() {
        let start = std::time::Instant::now();
        let first = bundle().unwrap();
        let cold = start.elapsed();
        let start = std::time::Instant::now();
        let second = bundle().unwrap();
        assert_eq!(first.0, second.0);
        assert_eq!(first.1.bundle_id, second.1.bundle_id);
        eprintln!("managed bundle cold={cold:?}, warm={:?}", start.elapsed());
    }

    #[test]
    #[ignore = "requires an explicitly selected sealed bundle and normal document samples"]
    fn managed_bundle_layout_cache_and_optional_sheet_fonts() {
        use std::os::unix::fs::DirBuilderExt;
        let samples = PathBuf::from(std::env::var_os("YIJIE_DOCUMENT_TEST_WORK").unwrap());
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("yijie-preview-normal-{}", Uuid::now_v7()));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let vars = [
            ("YIJIE_ENV", "local"),
            ("YIJIE_LOCAL_PROFILE", "demo_fast"),
            ("YIJIE_ARTIFACT_MEDIA_ENABLED", "true"),
            ("YIJIE_FEAT171_DOCUMENT_RUNTIME", "true"),
            ("YIJIE_DOCUMENT_STATE_ROOT", root.to_str().unwrap()),
        ];
        let prior = vars
            .iter()
            .map(|(key, _)| (*key, std::env::var_os(key)))
            .collect::<Vec<_>>();
        for (key, value) in vars {
            std::env::set_var(key, value);
        }
        let docx = fs::read(samples.join("sample.docx")).unwrap();
        let mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        let pdf = layout_pdf(&docx, mime, &digest(&docx)).unwrap();
        assert_eq!(layout_pdf(&docx, mime, &digest(&docx)).unwrap(), pdf);
        assert_eq!(fs::read_dir(root.join("previews")).unwrap().count(), 1);
        let over_pages = fs::read(samples.join("over-page-budget.docx")).unwrap();
        let original_hash = digest(&over_pages);
        // A real, ordinary 51-page document is outside the supported limit.
        // Both attempts finish normally and fail the page check; the second
        // must actually retry instead of returning a permanent cache error.
        for _ in 0..2 {
            assert!(matches!(
                layout_pdf(&over_pages, mime, &original_hash),
                Err(Code::Unsupported)
            ));
        }
        assert_eq!(fs::read_dir(root.join("previews")).unwrap().count(), 3);
        assert_eq!(
            digest(&fs::read(samples.join("over-page-budget.docx")).unwrap()),
            original_hash
        );
        let bytes = fs::read(samples.join("formula-values.xlsx")).unwrap();
        let mut presentation = super::super::document_preview_content::render(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            &bytes,
            1,
            0,
            false,
            1.0,
        )
        .unwrap();
        assert!(!presentation.html.contains("无已保存计算结果"));
        let original = presentation.html.clone();
        let bundle = std::env::var_os("YIJIE_DOCUMENT_BUNDLE_DIR");
        std::env::remove_var("YIJIE_DOCUMENT_BUNDLE_DIR");
        assert!(style_sheet(&mut presentation).is_err());
        assert_eq!(presentation.html, original);
        assert!(presentation.assets.is_empty());
        if let Some(bundle) = bundle {
            std::env::set_var("YIJIE_DOCUMENT_BUNDLE_DIR", bundle);
        }
        style_sheet(&mut presentation).unwrap();
        assert_eq!(presentation.assets.len(), 2);
        assert!(presentation.html.contains("font/regular.ttf"));
        for (key, value) in prior {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
        // Retain the real conversion receipts for the feature audit.
        eprintln!("normal native layout evidence: {}", root.display());
    }

    #[test]
    fn normal_document_input_json_and_empty_container_keep_original_bytes() {
        use std::os::unix::fs::DirBuilderExt;
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("yijie-document-normal-{}", Uuid::now_v7()));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let vars = [
            ("YIJIE_ENV", "local"),
            ("YIJIE_LOCAL_PROFILE", "demo_fast"),
            ("YIJIE_ARTIFACT_MEDIA_ENABLED", "true"),
            ("YIJIE_FEAT171_DOCUMENT_RUNTIME", "true"),
            ("YIJIE_DOCUMENT_STATE_ROOT", root.to_str().unwrap()),
        ];
        let prior = vars
            .iter()
            .map(|(key, _)| (*key, std::env::var_os(key)))
            .collect::<Vec<_>>();
        for (key, value) in vars {
            std::env::set_var(key, value);
        }
        let operation = Uuid::now_v7();
        let attachment = Uuid::now_v7();
        let bytes = br#"{"count":42,"identifier":"00017"}"#;
        let now = seconds().unwrap() as i64;
        stage_input(
            operation,
            attachment,
            "application/json",
            bytes,
            &digest(bytes),
            now + 90000,
            now,
        )
        .unwrap();
        let folder = root.join("inputs").join(operation.to_string());
        assert_eq!(
            fs::read(folder.join(format!("{attachment}.json"))).unwrap(),
            bytes
        );
        let receipt: InputReceipt = serde_json::from_slice(
            &fs::read(folder.join(format!("{attachment}.receipt.json"))).unwrap(),
        )
        .unwrap();
        assert_eq!(receipt.sha256, digest(bytes));
        assert_eq!(receipt.expires_at, (now + 86400) as u64);
        stage_input(
            operation,
            attachment,
            "application/json",
            bytes,
            &digest(bytes),
            now + 90000,
            now + 3600,
        )
        .unwrap();
        let renewed: InputReceipt = serde_json::from_slice(
            &fs::read(folder.join(format!("{attachment}.receipt.json"))).unwrap(),
        )
        .unwrap();
        assert_eq!(
            renewed.expires_at,
            (now + 90000) as u64,
            "reuse renews the cache only up to the original expiry"
        );
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
        if let Some(path) = std::env::var_os("YIJIE_DOCUMENT_TEST_EMPTY_DOCX") {
            let bytes = fs::read(path).unwrap();
            let parsed =
                super::super::attachment::prepare_bytes("empty.docx".into(), bytes.clone(), now)
                    .unwrap();
            assert_eq!(parsed.content, bytes);
            assert!(parsed
                .chunks
                .iter()
                .any(|text| text.contains("没有可提取的文本")));
        }
        cleanup_inputs(&root.join("inputs"), (now + 90001) as u64).unwrap();
        assert!(!folder.exists());
        for (key, value) in prior {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
}
