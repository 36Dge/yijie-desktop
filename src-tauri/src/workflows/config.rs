use super::generated::{ErrorCode, ErrorResponse};
use super::{error, validation};
use crate::local_profile::LocalRuntimeProfile;
use crate::native_auth::SecretValue;
use std::io::Read;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub(super) const API_ORIGIN: &str = "http://127.0.0.1:18888";
pub(super) const CREDENTIAL_ENV: &str = "YIJIE_WORKFLOW_CREDENTIAL_FILE";

pub(super) enum Configuration {
    Disabled,
    Unavailable,
    Enabled { credential_path: PathBuf },
}

pub(super) struct Credentials {
    pub epoch: String,
    pub token: SecretValue,
}

impl Configuration {
    pub fn from_environment(profile: LocalRuntimeProfile) -> Self {
        Self::from_lookup(profile, |key| std::env::var(key).ok())
    }

    fn from_lookup(profile: LocalRuntimeProfile, lookup: impl Fn(&str) -> Option<String>) -> Self {
        if !profile.is_demo_fast()
            || lookup("YIJIE_ENV").as_deref() != Some("local")
            || lookup("YIJIE_LOCAL_PROFILE").as_deref() != Some("demo_fast")
            || lookup("YIJIE_WORKFLOW_ENABLED").as_deref() != Some("true")
        {
            return Self::Disabled;
        }
        match lookup(CREDENTIAL_ENV).map(PathBuf::from) {
            Some(credential_path) if credential_path.is_absolute() => {
                Self::Enabled { credential_path }
            }
            _ => Self::Unavailable,
        }
    }

    pub fn credentials(&self) -> Result<Credentials, ErrorResponse> {
        match self {
            Self::Disabled => Err(error(ErrorCode::ProfileDisabled)),
            Self::Unavailable => Err(error(ErrorCode::ServiceUnavailable)),
            Self::Enabled { credential_path } => read_credentials(credential_path),
        }
    }
}

#[cfg(unix)]
fn read_credentials(path: &Path) -> Result<Credentials, ErrorResponse> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let fail = || error(ErrorCode::ServiceUnavailable);
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
fn read_credentials(_path: &Path) -> Result<Credentials, ErrorResponse> {
    Err(error(ErrorCode::ServiceUnavailable))
}

fn parse_credentials(bytes: &[u8]) -> Result<Credentials, ErrorResponse> {
    let fail = || error(ErrorCode::ServiceUnavailable);
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
    if validation::typed("RunEpoch", &epoch).is_err()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn credential_bytes() -> Vec<u8> {
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes).unwrap();
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "run_epoch": "15300000-0000-4000-8000-000000000001",
            "token": token,
        }))
        .unwrap()
    }

    #[test]
    fn profile_is_opt_in_and_never_needs_credentials_when_disabled() {
        assert!(matches!(
            Configuration::from_lookup(LocalRuntimeProfile::Standard, |_| None),
            Configuration::Disabled
        ));
        assert!(matches!(
            Configuration::from_lookup(LocalRuntimeProfile::DemoFast, |key| match key {
                "YIJIE_ENV" => Some("local".into()),
                "YIJIE_LOCAL_PROFILE" => Some("demo_fast".into()),
                _ => None,
            }),
            Configuration::Disabled
        ));
    }

    #[test]
    fn ordinary_deployment_credential_decodes_without_exposing_token_in_debug() {
        let credentials = parse_credentials(&credential_bytes()).unwrap();
        assert_eq!(credentials.epoch, "15300000-0000-4000-8000-000000000001");
        assert_eq!(
            format!("{:?}", credentials.token),
            "SecretValue([REDACTED])"
        );
    }

    #[cfg(unix)]
    #[test]
    fn normally_created_owner_only_credential_file_is_readable() {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let path = std::env::temp_dir().join(format!(
            "yijie-workflow-credential-{}.json",
            uuid::Uuid::now_v7()
        ));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        file.write_all(&credential_bytes()).unwrap();
        drop(file);
        let result = read_credentials(&path);
        std::fs::remove_file(path).unwrap();
        assert!(result.is_ok());
    }
}
