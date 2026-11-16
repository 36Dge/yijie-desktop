use super::error;
use super::generated::{ErrorCode, ErrorResponse};
use crate::local_profile::LocalRuntimeProfile;
use crate::native_auth::SecretValue;
use std::path::{Path, PathBuf};

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

fn read_credentials(path: &Path) -> Result<Credentials, ErrorResponse> {
    let value = crate::native_auth::local_service::read_credentials(path)
        .map_err(|_| error(ErrorCode::ServiceUnavailable))?;
    Ok(Credentials {
        epoch: value.epoch,
        token: value.token,
    })
}

#[cfg(test)]
fn parse_credentials(bytes: &[u8]) -> Result<Credentials, ErrorResponse> {
    let v = crate::native_auth::local_service::parse_credentials(bytes)
        .map_err(|_| error(ErrorCode::ServiceUnavailable))?;
    Ok(Credentials {
        epoch: v.epoch,
        token: v.token,
    })
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
