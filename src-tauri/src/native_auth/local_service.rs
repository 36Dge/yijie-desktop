//! Shared Native-owned local service credential reader; never a renderer IPC.
use super::SecretValue;
use std::{io::Read, path::Path};
use zeroize::Zeroizing;
pub(crate) struct Credentials {
    pub epoch: String,
    pub token: SecretValue,
}
#[cfg(unix)]
pub(crate) fn read_credentials(path: &Path) -> Result<Credentials, ()> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let fail = || ();
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| fail())?;
    let before = file.metadata().map_err(|_| fail())?;
    if !before.is_file()
        || before.uid() != unsafe { libc::geteuid() }
        || before.nlink() != 1
        || !matches!(before.mode() & 0o7777, 0o400 | 0o600)
        || before.len() == 0
        || before.len() > 1024
    {
        return Err(fail());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(before.len() as usize));
    file.by_ref()
        .take(1025)
        .read_to_end(&mut bytes)
        .map_err(|_| fail())?;
    let after = file.metadata().map_err(|_| fail())?;
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(fail());
    }
    parse_credentials(&bytes)
}

#[cfg(not(unix))]
pub(crate) fn read_credentials(_path: &Path) -> Result<Credentials, ()> {
    Err(error(ErrorCode::ServiceUnavailable))
}

pub(crate) fn parse_credentials(bytes: &[u8]) -> Result<Credentials, ()> {
    let fail = || ();
    let mut object = serde_json::from_slice::<serde_json::Map<String, serde_json::Value>>(bytes)
        .map_err(|_| fail())?;
    // Move the known secret into zeroizing storage before any metadata validation branch.
    let token = match object.remove("token") {
        Some(serde_json::Value::String(value)) => SecretValue::new(value),
        _ => return Err(fail()),
    };
    // Deployment authority: yijie-api/config/workflow-local-runtime.schema.json.
    if object.len() != 2 || object.remove("schema_version").and_then(|v| v.as_i64()) != Some(1) {
        return Err(fail());
    }
    let epoch = match object.remove("run_epoch") {
        Some(serde_json::Value::String(value)) => value,
        _ => return Err(fail()),
    };
    if uuid::Uuid::parse_str(&epoch).map_or(true, |id| id.hyphenated().to_string() != epoch)
        || uuid::Uuid::parse_str(&epoch).map_or(true, |id| id.is_nil())
        || token.expose().len() != 64
        || !token
            .expose()
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(fail());
    }
    Ok(Credentials { epoch, token })
}
