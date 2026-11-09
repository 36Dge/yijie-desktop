//! Relocatable, full offline local candidate entry. Executed once, before any
//! threads are created. The compiled manifest digest binds the packaged files.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    path: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema_version: u8,
    release: bool,
    document_bundle: String,
    document_manifest_sha256: String,
    files: Vec<File>,
}
fn hash(path: &Path) -> Result<String, String> {
    crate::chat::document_runtime::file_digest(path)
        .map_err(|_| "packaged resource unreadable".to_owned())
}
fn relative(p: &str) -> bool {
    !p.is_empty()
        && Path::new(p)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}
pub(crate) fn bootstrap() -> Result<(), String> {
    let Some(expected) = option_env!("YIJIE_FEAT171_PACKAGE_MANIFEST_SHA256") else {
        return Ok(());
    };
    let exe = std::env::current_exe().map_err(|_| "application path unavailable")?;
    let root = exe
        .parent()
        .and_then(Path::parent)
        .ok_or("application resource root unavailable")?
        .join("Resources/document-application")
        .canonicalize()
        .map_err(|_| "document application is incomplete")?;
    let manifest = root.join("application.json");
    if hash(&manifest)? != expected {
        return Err("document application identity mismatch".into());
    }
    let m: Manifest = serde_json::from_slice(
        &fs::read(manifest).map_err(|_| "application manifest unavailable")?,
    )
    .map_err(|_| "application manifest invalid")?;
    if m.schema_version != 1 || m.release || !relative(&m.document_bundle) || m.files.len() > 16 {
        return Err("unsupported document application".into());
    }
    for entry in m.files {
        if !relative(&entry.path) {
            return Err("invalid resource name".into());
        }
        let path = root.join(entry.path);
        if path.is_symlink()
            || !path
                .canonicalize()
                .map_err(|_| "missing application file")?
                .starts_with(&root)
            || hash(&path)? != entry.sha256
        {
            return Err("application resource mismatch".into());
        }
    }
    let user = PathBuf::from(std::env::var("HOME").map_err(|_| "user home unavailable")?);
    if !user.is_absolute() {
        return Err("user home unavailable".into());
    }
    let data = user.join("Library/Application Support/com.yijie.ai/demo-fast-v1");
    // The source-development client historically keeps Host/Runtime Homes in
    // its repository. Do not pair that Native history with fresh empty Homes.
    // Existing installed candidates keep the same application-owned directories.
    if data.join("chat/conversations.db").is_file()
        && (!data.join("host-home").is_dir() || !data.join("codex-home").is_dir())
    {
        return Err("existing daily history requires its original paired service homes; use the canonical development entry".into());
    }
    use std::os::unix::fs::DirBuilderExt;
    for path in [
        &data,
        &data.join("host-home"),
        &data.join("codex-home"),
        &data.join("secrets"),
    ] {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|_| "private application directory unavailable")?;
        if path.is_symlink() || path.canonicalize().ok().as_ref() != Some(path) {
            return Err("private application path unavailable".into());
        }
    }
    // Native workspace-write already permits the platform /tmp area. Keep
    // transient document work there, with a private application-owned root;
    // do not add permission roots outside the existing native sandbox policy.
    let state_id = format!("{:x}", Sha256::digest(data.to_string_lossy().as_bytes()));
    let document_state = PathBuf::from("/private/tmp").join(format!(
        "yijie-documents-{}-{}",
        unsafe { libc::geteuid() },
        &state_id[..16]
    ));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&document_state)
        .or_else(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(e)
            }
        })
        .map_err(|_| "private document cache unavailable")?;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata =
        fs::symlink_metadata(&document_state).map_err(|_| "document cache unavailable")?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err("document cache authority unavailable".into());
    }
    // Bundle activation is a reviewed native deployment descriptor, not a shell
    // launcher requiring source trees, Node, Docker, a connector or a market skill.
    for key in std::env::vars_os()
        .map(|(k, _)| k)
        .filter(|k| k.to_string_lossy().starts_with("YIJIE_"))
        .collect::<Vec<_>>()
    {
        std::env::remove_var(key);
    }
    for (key, value) in [
        ("YIJIE_ENV", "local"),
        ("YIJIE_LOCAL_PROFILE", "demo_fast"),
        ("YIJIE_CHAT_LOCAL_ENABLED", "true"),
        ("YIJIE_CHAT_LOCAL_HOST_ENABLED", "true"),
        (
            "YIJIE_CHAT_LOCAL_OWNER_USER_ID",
            crate::local_profile::DEMO_FAST_OWNER_USER_ID,
        ),
        (
            "YIJIE_CHAT_LOCAL_TENANT_ID",
            crate::local_profile::DEMO_FAST_TENANT_ID,
        ),
        ("YIJIE_FEAT164_DAILY", "true"),
        ("YIJIE_FEAT155_SCHEDULED_DAILY", "true"),
        ("YIJIE_FEAT155_SCHEDULED_CANDIDATE", "false"),
        ("YIJIE_CHAT_MODELS_ENABLED", "true"),
        ("YIJIE_KIMI_K31_PRO_CANDIDATE", "true"),
        ("YIJIE_KIMI_K31_CALL_SURFACES", "documents"),
        ("YIJIE_RUNTIME_PERMISSIONS_ENABLED", "true"),
        ("YIJIE_FEAT169_NATIVE_TOOLS", "true"),
        ("YIJIE_FEAT169_INTERACTION_TOOLS", "true"),
        ("YIJIE_FEAT170_TOOL_SEARCH", "true"),
        ("YIJIE_FEAT171_DOCUMENT_RUNTIME", "true"),
        ("YIJIE_CHAT_ARTIFACTS_V3_ENABLED", "true"),
        ("YIJIE_ARTIFACT_MEDIA_ENABLED", "true"),
        ("YIJIE_MARKET_CONNECTORS_ENABLED", "false"),
        ("YIJIE_EXPERTS_ENABLED", "false"),
        ("YIJIE_AGENT_HOST_PORT", "18081"),
    ] {
        std::env::set_var(key, value);
    }
    for (key, path) in [
        ("YIJIE_AGENT_HOST_BINARY", root.join("bin/yijie-agent-host")),
        ("YIJIE_AGENT_HOST_HOME", data.join("host-home")),
        ("YIJIE_CODEX_BINARY", root.join("runtime/codex")),
        (
            "YIJIE_CODEX_MANIFEST",
            root.join("runtime/runtime-manifest.json"),
        ),
        ("YIJIE_CODEX_HOME", data.join("codex-home")),
        ("YIJIE_DOCUMENT_BUNDLE_DIR", root.join(m.document_bundle)),
        ("YIJIE_DOCUMENT_STATE_ROOT", document_state),
    ] {
        std::env::set_var(key, path);
    }
    std::env::set_var("YIJIE_DOCUMENT_BUNDLE_SHA256", m.document_manifest_sha256);
    // Existing provider-file mechanism only. No credentials shipped or copied.
    for (key, name) in [
        ("YIJIE_MINIMAX_API_KEY_FILE", "minimax-api-key"),
        ("YIJIE_KIMI_API_KEY_FILE", "kimi-api-key"),
    ] {
        let file = data.join("secrets").join(name);
        if file.is_file() {
            std::env::set_var(key, &file);
            if name == "minimax-api-key" {
                std::env::set_var("YIJIE_MODEL_PROVIDER", "minimax");
            }
        }
    }
    Ok(())
}
