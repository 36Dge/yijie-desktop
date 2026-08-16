use super::config::AuthEnvironment;
use super::NativeAuthError;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
#[cfg(unix)]
use std::fs::File;
#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

const ENABLED_ENV: &str = "YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED";
const LOCAL_ENV: &str = "YIJIE_ENV";
const SECRET_PATH_ENV: &str = "YIJIE_DESKTOP_LOCAL_WHITELIST_IDP_SECRETS_PATH";
const USERNAME_SHA256: &str = "1f90523fe69f2bb4105e793f9734fc51ae98090cf36cb7163666fb1a40c08d54";
const PASSWORD_SHA256: &str = "2eb56663362194dd92689628b8a9c186d9dca52e38a5defe7d066b76cd800989";
const BACKEND_PASSWORD_KEY: &str = "FEAT125_SYNTHETIC_USER_A_PASSWORD";
const SECRET_KEYS: [&str; 4] = [
    "FEAT125_KEYCLOAK_DB_PASSWORD",
    "FEAT125_KEYCLOAK_ADMIN_PASSWORD",
    BACKEND_PASSWORD_KEY,
    "FEAT125_SYNTHETIC_USER_B_PASSWORD",
];
const MAX_USERNAME_BYTES: usize = 64;
const MAX_PASSWORD_BYTES: usize = 256;
const MAX_SECRET_FILE_BYTES: u64 = 4 * 1024;

#[derive(Clone)]
pub(crate) struct LocalWhitelistConfig {
    idp_secrets_path: PathBuf,
}

impl std::fmt::Debug for LocalWhitelistConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LocalWhitelistConfig")
            .field("idp_secrets_path", &"[LOCAL_SECRET_AUTHORITY]")
            .finish()
    }
}

impl LocalWhitelistConfig {
    pub(crate) fn from_environment(
        auth_environment: AuthEnvironment,
    ) -> Result<Option<Self>, NativeAuthError> {
        Self::from_lookup(auth_environment, |name| std::env::var(name).ok())
    }

    fn from_lookup(
        auth_environment: AuthEnvironment,
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, NativeAuthError> {
        let enabled = lookup(ENABLED_ENV);
        let secret_path = lookup(SECRET_PATH_ENV);
        match enabled.as_deref() {
            None | Some("") | Some("false") => {
                if secret_path.is_some() {
                    return Err(NativeAuthError::InvalidConfiguration);
                }
                Ok(None)
            }
            Some("true") => {
                if auth_environment != AuthEnvironment::LocalIntegration
                    || lookup(LOCAL_ENV).as_deref() != Some("local")
                {
                    return Err(NativeAuthError::InvalidConfiguration);
                }
                let idp_secrets_path = secret_path
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from)
                    .ok_or(NativeAuthError::InvalidConfiguration)?;
                if !idp_secrets_path.is_absolute() {
                    return Err(NativeAuthError::InvalidConfiguration);
                }
                Ok(Some(Self { idp_secrets_path }))
            }
            Some(_) => Err(NativeAuthError::InvalidConfiguration),
        }
    }

    pub(crate) fn backend_password(
        &self,
        username: &str,
        password: &str,
    ) -> Result<Zeroizing<String>, NativeAuthError> {
        if !credentials_match(username, password) {
            return Err(NativeAuthError::AuthenticationFailed);
        }
        read_backend_password(&self.idp_secrets_path)
    }
}

fn credentials_match(username: &str, password: &str) -> bool {
    if username.is_empty()
        || username.len() > MAX_USERNAME_BYTES
        || password.is_empty()
        || password.len() > MAX_PASSWORD_BYTES
    {
        return false;
    }
    // Evaluate both fingerprints before combining them so the fixed account
    // does not create an avoidable username-dependent timing branch.
    let username_matches = fingerprint_matches(username, USERNAME_SHA256);
    let password_matches = fingerprint_matches(password, PASSWORD_SHA256);
    username_matches & password_matches
}

fn fingerprint_matches(value: &str, expected_sha256: &str) -> bool {
    let actual = format!("{:x}", Sha256::digest(value.as_bytes()));
    actual
        .as_bytes()
        .ct_eq(expected_sha256.as_bytes())
        .unwrap_u8()
        == 1
}

#[cfg(not(unix))]
fn read_backend_password(_path: &Path) -> Result<Zeroizing<String>, NativeAuthError> {
    Err(NativeAuthError::InvalidConfiguration)
}

#[cfg(unix)]
fn read_backend_password(path: &Path) -> Result<Zeroizing<String>, NativeAuthError> {
    if !path.is_absolute() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let path_metadata =
        std::fs::symlink_metadata(path).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.file_type().is_file() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    if path_metadata.uid() != unsafe { libc::geteuid() }
        || !matches!(path_metadata.permissions().mode() & 0o777, 0o400 | 0o600)
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    if path_metadata.len() == 0 || path_metadata.len() > MAX_SECRET_FILE_BYTES {
        return Err(NativeAuthError::InvalidConfiguration);
    }

    let file = File::open(path).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    let metadata = file
        .metadata()
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if metadata.dev() != path_metadata.dev() || metadata.ino() != path_metadata.ino() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    if !metadata.file_type().is_file() || metadata.len() != path_metadata.len() {
        return Err(NativeAuthError::InvalidConfiguration);
    }

    let mut contents = Zeroizing::new(String::with_capacity(metadata.len() as usize));
    file.take(MAX_SECRET_FILE_BYTES + 1)
        .read_to_string(&mut contents)
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if contents.len() as u64 != metadata.len() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    parse_backend_password(&contents)
}

fn parse_backend_password(contents: &str) -> Result<Zeroizing<String>, NativeAuthError> {
    let expected = SECRET_KEYS.into_iter().collect::<BTreeSet<_>>();
    let mut entries = BTreeMap::new();
    let lines = contents.split('\n').collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        if line.is_empty() && index + 1 == lines.len() {
            continue;
        }
        if line.is_empty() || line.trim() != *line {
            return Err(NativeAuthError::InvalidConfiguration);
        }
        let (name, value) = line
            .split_once('=')
            .ok_or(NativeAuthError::InvalidConfiguration)?;
        if !expected.contains(name)
            || entries.contains_key(name)
            || value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(NativeAuthError::InvalidConfiguration);
        }
        entries.insert(name, value);
    }
    if entries.len() != expected.len()
        || entries.keys().copied().collect::<BTreeSet<_>>() != expected
        || entries.values().copied().collect::<BTreeSet<_>>().len() != expected.len()
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    entries
        .get(BACKEND_PASSWORD_KEY)
        .map(|value| Zeroizing::new((*value).to_owned()))
        .ok_or(NativeAuthError::InvalidConfiguration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(
        auth_environment: AuthEnvironment,
        values: &[(&str, &str)],
    ) -> Result<Option<LocalWhitelistConfig>, NativeAuthError> {
        let values = values.iter().copied().collect::<HashMap<_, _>>();
        LocalWhitelistConfig::from_lookup(auth_environment, |name| {
            values.get(name).map(|value| (*value).to_owned())
        })
    }

    #[test]
    fn local_whitelist_requires_every_local_gate() {
        assert!(config(AuthEnvironment::LocalIntegration, &[])
            .expect("disabled")
            .is_none());
        assert_eq!(
            config(
                AuthEnvironment::LocalIntegration,
                &[(SECRET_PATH_ENV, "/private/local-secrets.env")],
            )
            .expect_err("partial config rejected"),
            NativeAuthError::InvalidConfiguration
        );
        assert_eq!(
            config(
                AuthEnvironment::Production,
                &[
                    (ENABLED_ENV, "true"),
                    (LOCAL_ENV, "local"),
                    (SECRET_PATH_ENV, "/private/local-secrets.env"),
                ],
            )
            .expect_err("production rejected"),
            NativeAuthError::InvalidConfiguration
        );
        assert!(config(
            AuthEnvironment::LocalIntegration,
            &[
                (ENABLED_ENV, "true"),
                (LOCAL_ENV, "local"),
                (SECRET_PATH_ENV, "/private/local-secrets.env"),
            ],
        )
        .expect("local config")
        .is_some());
    }

    #[test]
    fn fingerprint_matching_is_exact_without_storing_plaintext_credentials() {
        let expected = format!("{:x}", Sha256::digest(b"local-test-value"));
        assert!(fingerprint_matches("local-test-value", &expected));
        assert!(!fingerprint_matches("local-test-value-changed", &expected));
        assert!(!credentials_match(
            "not-the-whitelisted-user",
            "not-the-password"
        ));
    }

    #[test]
    fn secret_authority_requires_the_exact_feat125_inventory() {
        let contents = format!(
            "FEAT125_KEYCLOAK_DB_PASSWORD={}\nFEAT125_KEYCLOAK_ADMIN_PASSWORD={}\nFEAT125_SYNTHETIC_USER_A_PASSWORD={}\nFEAT125_SYNTHETIC_USER_B_PASSWORD={}\n",
            "1".repeat(64),
            "2".repeat(64),
            "3".repeat(64),
            "4".repeat(64),
        );
        assert_eq!(
            parse_backend_password(&contents)
                .expect("exact inventory")
                .as_str(),
            "3".repeat(64)
        );
        assert!(parse_backend_password(
            &contents.replace("FEAT125_SYNTHETIC_USER_B_PASSWORD", "UNREVIEWED_SECRET",)
        )
        .is_err());
    }
}
