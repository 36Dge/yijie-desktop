use super::error::NativeAuthError;
use sha2::{Digest, Sha256};
use std::fmt::{Debug, Formatter};
#[cfg(unix)]
use std::fs::File;
#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use subtle::ConstantTimeEq;
use url::Url;

const ENABLED: &str = "YIJIE_DESKTOP_NATIVE_AUTH_ENABLED";
const ENVIRONMENT: &str = "YIJIE_DESKTOP_AUTH_ENVIRONMENT";
const ISSUER: &str = "YIJIE_DESKTOP_OIDC_ISSUER";
const AUTHORIZATION_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT";
const TOKEN_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT";
const JWKS_URI: &str = "YIJIE_DESKTOP_OIDC_JWKS_URI";
const REVOCATION_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT";
const CLIENT_ID: &str = "YIJIE_DESKTOP_OIDC_CLIENT_ID";
const API_ORIGIN: &str = "YIJIE_DESKTOP_API_ORIGIN";
const LOCAL_CA_PEM_PATH: &str = "YIJIE_DESKTOP_LOCAL_CA_PEM_PATH";
const LOCAL_CA_SHA256: &str = "YIJIE_DESKTOP_LOCAL_CA_SHA256";
const MAX_URL_BYTES: usize = 2 * 1024;
const MAX_LOCAL_CA_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthEnvironment {
    Production,
    LocalIntegration,
}

impl AuthEnvironment {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::LocalIntegration => "local-integration",
        }
    }

    fn parse(value: Option<String>) -> Result<Self, NativeAuthError> {
        match value.as_deref() {
            None | Some("production") => Ok(Self::Production),
            Some("local-integration") => Ok(Self::LocalIntegration),
            Some(_) => Err(NativeAuthError::InvalidConfiguration),
        }
    }
}

#[derive(Clone)]
struct LocalCaCertificate {
    root: reqwest::Certificate,
}

impl Debug for LocalCaCertificate {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LocalCaCertificate([PINNED])")
    }
}

#[derive(Clone, Debug)]
pub struct NativeAuthConfig {
    pub environment: AuthEnvironment,
    pub issuer: Url,
    pub authorization_endpoint: Url,
    pub token_endpoint: Url,
    pub jwks_uri: Url,
    pub revocation_endpoint: Url,
    pub client_id: String,
    pub api_origin: Url,
    local_ca: Option<LocalCaCertificate>,
}

impl NativeAuthConfig {
    pub fn from_environment() -> Result<Option<Self>, NativeAuthError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    #[cfg(test)]
    pub(crate) fn from_test_lookup(
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, NativeAuthError> {
        Self::from_lookup(lookup)
    }

    fn from_lookup(
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, NativeAuthError> {
        match lookup(ENABLED).as_deref() {
            None | Some("") | Some("false") => return Ok(None),
            Some("true") => {}
            Some(_) => return Err(NativeAuthError::InvalidConfiguration),
        }

        let environment = AuthEnvironment::parse(lookup(ENVIRONMENT))?;
        let issuer = parse_https_url(required(&lookup, ISSUER)?, true)?;
        let authorization_endpoint =
            parse_https_url(required(&lookup, AUTHORIZATION_ENDPOINT)?, true)?;
        let token_endpoint = parse_https_url(required(&lookup, TOKEN_ENDPOINT)?, true)?;
        let jwks_uri = parse_https_url(required(&lookup, JWKS_URI)?, true)?;
        let revocation_endpoint = parse_https_url(required(&lookup, REVOCATION_ENDPOINT)?, true)?;
        let api_origin = parse_https_url(required(&lookup, API_ORIGIN)?, false)?;

        for endpoint in [
            &authorization_endpoint,
            &token_endpoint,
            &jwks_uri,
            &revocation_endpoint,
        ] {
            if !same_origin(&issuer, endpoint) {
                return Err(NativeAuthError::InvalidConfiguration);
            }
        }

        if api_origin.path() != "/" || api_origin.query().is_some() {
            return Err(NativeAuthError::InvalidConfiguration);
        }

        let client_id = required(&lookup, CLIENT_ID)?;
        if client_id.len() > 256 || client_id.chars().any(char::is_whitespace) {
            return Err(NativeAuthError::InvalidConfiguration);
        }

        let local_ca = match environment {
            AuthEnvironment::Production => {
                if lookup(LOCAL_CA_PEM_PATH).is_some() || lookup(LOCAL_CA_SHA256).is_some() {
                    return Err(NativeAuthError::InvalidConfiguration);
                }
                None
            }
            AuthEnvironment::LocalIntegration => {
                if !is_exact_localhost_origin(&issuer) || !is_exact_localhost_origin(&api_origin) {
                    return Err(NativeAuthError::InvalidConfiguration);
                }
                let path = required(&lookup, LOCAL_CA_PEM_PATH)?;
                let pin = required(&lookup, LOCAL_CA_SHA256)?;
                Some(load_local_ca(Path::new(&path), &pin)?)
            }
        };

        Ok(Some(Self {
            environment,
            issuer,
            authorization_endpoint,
            token_endpoint,
            jwks_uri,
            revocation_endpoint,
            client_id,
            api_origin,
            local_ca,
        }))
    }

    pub fn harden_http_client(&self, builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
        match &self.local_ca {
            Some(local_ca) => builder
                .tls_built_in_root_certs(false)
                .add_root_certificate(local_ca.root.clone()),
            None => builder,
        }
    }
}

fn required(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &str,
) -> Result<String, NativeAuthError> {
    lookup(name)
        .filter(|value| !value.is_empty())
        .ok_or(NativeAuthError::InvalidConfiguration)
}

fn parse_https_url(value: String, allow_path: bool) -> Result<Url, NativeAuthError> {
    if value.len() > MAX_URL_BYTES {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let url = Url::parse(&value).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || (!allow_path && url.path() != "/")
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    Ok(url)
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn is_exact_localhost_origin(url: &Url) -> bool {
    url.host_str() == Some("localhost")
}

#[cfg(unix)]
fn load_local_ca(
    path: &Path,
    expected_sha256: &str,
) -> Result<LocalCaCertificate, NativeAuthError> {
    if !path.is_absolute() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let path_metadata =
        std::fs::symlink_metadata(path).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.file_type().is_file() {
        return Err(NativeAuthError::InvalidConfiguration);
    }

    let file = File::open(path).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    let metadata = file
        .metadata()
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if !metadata.file_type().is_file()
        || metadata.dev() != path_metadata.dev()
        || metadata.ino() != path_metadata.ino()
        || metadata.len() == 0
        || metadata.len() > MAX_LOCAL_CA_BYTES
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let mode = metadata.permissions().mode() & 0o777;
    if !matches!(mode, 0o400 | 0o600) {
        return Err(NativeAuthError::InvalidConfiguration);
    }

    let mut pem = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_LOCAL_CA_BYTES + 1)
        .read_to_end(&mut pem)
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if pem.len() as u64 != metadata.len() || pem.len() as u64 > MAX_LOCAL_CA_BYTES {
        return Err(NativeAuthError::InvalidConfiguration);
    }

    let expected = parse_sha256(expected_sha256)?;
    let actual = Sha256::digest(&pem);
    if actual.as_slice().ct_eq(&expected).unwrap_u8() != 1 {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    if count_bytes(&pem, b"-----BEGIN CERTIFICATE-----") != 1
        || count_bytes(&pem, b"-----END CERTIFICATE-----") != 1
        || contains_bytes(&pem, b"PRIVATE KEY")
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let mut certificates = reqwest::Certificate::from_pem_bundle(&pem)
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if certificates.len() != 1 {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    Ok(LocalCaCertificate {
        root: certificates.remove(0),
    })
}

#[cfg(not(unix))]
fn load_local_ca(
    _path: &Path,
    _expected_sha256: &str,
) -> Result<LocalCaCertificate, NativeAuthError> {
    Err(NativeAuthError::InvalidConfiguration)
}

fn parse_sha256(value: &str) -> Result<[u8; 32], NativeAuthError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let mut digest = [0_u8; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = (hex_nibble(value.as_bytes()[offset])? << 4)
            | hex_nibble(value.as_bytes()[offset + 1])?;
    }
    Ok(digest)
}

fn hex_nibble(value: u8) -> Result<u8, NativeAuthError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(NativeAuthError::InvalidConfiguration),
    }
}

fn count_bytes(haystack: &[u8], needle: &[u8]) -> usize {
    haystack
        .windows(needle.len())
        .filter(|window| *window == needle)
        .count()
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[cfg(unix)]
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};
    #[cfg(unix)]
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::sync::atomic::{AtomicU64, Ordering};

    const TEST_CA: &[u8] = include_bytes!("../../tests/fixtures/feat-125-local-test-ca.pem");

    fn valid() -> HashMap<String, String> {
        HashMap::from([
            (ENABLED.to_owned(), "true".to_owned()),
            (ISSUER.to_owned(), "https://identity.example/".to_owned()),
            (
                AUTHORIZATION_ENDPOINT.to_owned(),
                "https://identity.example/oauth/authorize".to_owned(),
            ),
            (
                TOKEN_ENDPOINT.to_owned(),
                "https://identity.example/oauth/token".to_owned(),
            ),
            (
                JWKS_URI.to_owned(),
                "https://identity.example/.well-known/jwks.json".to_owned(),
            ),
            (
                REVOCATION_ENDPOINT.to_owned(),
                "https://identity.example/oauth/revoke".to_owned(),
            ),
            (CLIENT_ID.to_owned(), "desktop-public-client".to_owned()),
            (API_ORIGIN.to_owned(), "https://api.example/".to_owned()),
        ])
    }

    fn load(values: HashMap<String, String>) -> Result<Option<NativeAuthConfig>, NativeAuthError> {
        NativeAuthConfig::from_lookup(|name| values.get(name).cloned())
    }

    #[cfg(unix)]
    struct TestFile {
        path: PathBuf,
    }

    #[cfg(unix)]
    impl TestFile {
        fn new(bytes: &[u8], mode: u32) -> Self {
            let path = unique_temp_path("local-ca", "pem");
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .expect("create test CA");
            file.write_all(bytes).expect("write test CA");
            file.set_permissions(std::fs::Permissions::from_mode(mode))
                .expect("set test CA permissions");
            Self { path }
        }

        fn pin(&self) -> String {
            let bytes = std::fs::read(&self.path).expect("read test CA");
            Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect()
        }
    }

    #[cfg(unix)]
    impl Drop for TestFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[cfg(unix)]
    fn local_values(file: &TestFile) -> HashMap<String, String> {
        let mut values = valid();
        values.insert(ENVIRONMENT.to_owned(), "local-integration".to_owned());
        values.insert(
            ISSUER.to_owned(),
            "https://localhost:8443/realms/yijie".to_owned(),
        );
        values.insert(
            AUTHORIZATION_ENDPOINT.to_owned(),
            "https://localhost:8443/realms/yijie/protocol/openid-connect/auth".to_owned(),
        );
        values.insert(
            TOKEN_ENDPOINT.to_owned(),
            "https://localhost:8443/realms/yijie/protocol/openid-connect/token".to_owned(),
        );
        values.insert(
            JWKS_URI.to_owned(),
            "https://localhost:8443/realms/yijie/protocol/openid-connect/certs".to_owned(),
        );
        values.insert(
            REVOCATION_ENDPOINT.to_owned(),
            "https://localhost:8443/realms/yijie/protocol/openid-connect/revoke".to_owned(),
        );
        values.insert(API_ORIGIN.to_owned(), "https://localhost:9443/".to_owned());
        values.insert(
            LOCAL_CA_PEM_PATH.to_owned(),
            file.path.to_string_lossy().into_owned(),
        );
        values.insert(LOCAL_CA_SHA256.to_owned(), file.pin());
        values
    }

    #[cfg(unix)]
    fn unique_temp_path(label: &str, extension: &str) -> PathBuf {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "yijie-feat-125-{label}-{}-{}.{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed),
            extension
        ))
    }

    #[test]
    fn feature_is_disabled_by_default() {
        assert!(load(HashMap::new()).expect("disabled config").is_none());
    }

    #[test]
    fn enabled_configuration_is_exact_and_public_client_only() {
        let config = load(valid()).expect("valid config").expect("enabled");

        assert_eq!(config.environment, AuthEnvironment::Production);
        assert_eq!(config.client_id, "desktop-public-client");
        assert_eq!(config.api_origin.as_str(), "https://api.example/");
    }

    #[test]
    fn issuer_may_use_an_exact_path_but_not_a_query() {
        let mut path_issuer = valid();
        path_issuer.insert(
            ISSUER.to_owned(),
            "https://identity.example/oidc/tenant".to_owned(),
        );
        assert!(load(path_issuer).is_ok());

        let mut query_issuer = valid();
        query_issuer.insert(
            ISSUER.to_owned(),
            "https://identity.example/?tenant=one".to_owned(),
        );
        assert_eq!(
            load(query_issuer).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[test]
    fn rejects_non_https_or_cross_origin_oidc_endpoints() {
        let mut insecure = valid();
        insecure.insert(
            TOKEN_ENDPOINT.to_owned(),
            "http://identity.example/token".to_owned(),
        );
        assert_eq!(
            load(insecure).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut cross_origin = valid();
        cross_origin.insert(
            JWKS_URI.to_owned(),
            "https://attacker.example/jwks".to_owned(),
        );
        assert_eq!(
            load(cross_origin).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[test]
    fn rejects_api_paths_queries_and_credentials() {
        for invalid in [
            "https://api.example/v1",
            "https://api.example/?next=evil",
            "https://user:password@api.example/",
        ] {
            let mut values = valid();
            values.insert(API_ORIGIN.to_owned(), invalid.to_owned());
            assert_eq!(
                load(values).unwrap_err(),
                NativeAuthError::InvalidConfiguration
            );
        }
    }

    #[test]
    fn rejects_partial_enablement_and_non_boolean_flag() {
        assert_eq!(
            load(HashMap::from([(ENABLED.to_owned(), "yes".to_owned())])).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
        assert_eq!(
            load(HashMap::from([(ENABLED.to_owned(), "true".to_owned())])).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_integration_requires_exact_localhost_and_a_pinned_single_ca() {
        let file = TestFile::new(TEST_CA, 0o600);
        let config = load(local_values(&file))
            .expect("local config")
            .expect("enabled");
        assert_eq!(config.environment, AuthEnvironment::LocalIntegration);
        config
            .harden_http_client(reqwest::Client::builder().https_only(true))
            .build()
            .expect("pinned local client");

        let mut public_origin = local_values(&file);
        public_origin.insert(
            API_ORIGIN.to_owned(),
            "https://api.yijie.test:9443/".to_owned(),
        );
        assert_eq!(
            load(public_origin).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut literal_loopback = local_values(&file);
        literal_loopback.insert(API_ORIGIN.to_owned(), "https://127.0.0.1:9443/".to_owned());
        assert_eq!(
            load(literal_loopback).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_ca_is_rejected_outside_local_integration() {
        let file = TestFile::new(TEST_CA, 0o600);
        let mut values = valid();
        values.insert(
            LOCAL_CA_PEM_PATH.to_owned(),
            file.path.to_string_lossy().into_owned(),
        );
        values.insert(LOCAL_CA_SHA256.to_owned(), file.pin());
        assert_eq!(
            load(values).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_ca_rejects_missing_or_noncanonical_pin_and_unsafe_permissions() {
        let file = TestFile::new(TEST_CA, 0o600);
        let mut missing = local_values(&file);
        missing.remove(LOCAL_CA_SHA256);
        assert_eq!(
            load(missing).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut uppercase = local_values(&file);
        uppercase.insert(LOCAL_CA_SHA256.to_owned(), file.pin().to_ascii_uppercase());
        assert_eq!(
            load(uppercase).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut wrong = local_values(&file);
        wrong.insert(LOCAL_CA_SHA256.to_owned(), "00".repeat(32));
        assert_eq!(
            load(wrong).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut relative = local_values(&file);
        relative.insert(
            LOCAL_CA_PEM_PATH.to_owned(),
            "feat-125.local-ca.pem".to_owned(),
        );
        assert_eq!(
            load(relative).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let unsafe_file = TestFile::new(TEST_CA, 0o644);
        assert_eq!(
            load(local_values(&unsafe_file)).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let oversized_file = TestFile::new(&vec![b'a'; MAX_LOCAL_CA_BYTES as usize + 1], 0o600);
        assert_eq!(
            load(local_values(&oversized_file)).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_ca_rejects_symlinks_bundles_and_private_keys() {
        let file = TestFile::new(TEST_CA, 0o600);
        let link_path = unique_temp_path("local-ca-link", "pem");
        symlink(&file.path, &link_path).expect("create CA symlink");
        let mut linked = local_values(&file);
        linked.insert(
            LOCAL_CA_PEM_PATH.to_owned(),
            link_path.to_string_lossy().into_owned(),
        );
        assert_eq!(
            load(linked).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
        std::fs::remove_file(link_path).expect("remove CA symlink");

        let mut bundle = TEST_CA.to_vec();
        bundle.extend_from_slice(TEST_CA);
        let bundle_file = TestFile::new(&bundle, 0o600);
        assert_eq!(
            load(local_values(&bundle_file)).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );

        let mut with_key = TEST_CA.to_vec();
        with_key.extend_from_slice(
            b"\n-----BEGIN PRIVATE KEY-----\nforbidden\n-----END PRIVATE KEY-----\n",
        );
        let key_file = TestFile::new(&with_key, 0o600);
        assert_eq!(
            load(local_values(&key_file)).unwrap_err(),
            NativeAuthError::InvalidConfiguration
        );
    }
}
