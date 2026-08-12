use super::oidc::IssuedTokens;
use super::{NativeAuthConfig, NativeAuthError, OidcClient, SecretValue};
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use std::time::Duration;
use subtle::ConstantTimeEq;
use url::Url;
use zeroize::Zeroizing;

const SECRET_PATH_ENV: &str = "YIJIE_FEAT126_S10_INFRA_SECRETS_PATH";
const SYNTHETIC_USERNAME: &str = "feat125-synthetic-user-a";
const SYNTHETIC_PASSWORD_KEY: &str = "FEAT126_S10_SYNTHETIC_USER_A_PASSWORD";
const CALLBACK_URI: &str = "http://127.0.0.1/oauth/callback";
const MAX_SECRET_FILE_BYTES: u64 = 4 * 1024;
const MAX_AUTHORIZATION_BODY_BYTES: usize = 256 * 1024;
const MAX_COOKIE_BYTES: usize = 16 * 1024;
const MAX_CODE_BYTES: usize = 4 * 1024;
const KEYCLOAK_SESSION_STATE_BYTES: usize = 24;
const SECRET_KEYS: [&str; 5] = [
    "FEAT126_S10_API_DB_PASSWORD",
    "FEAT126_S10_KEYCLOAK_DB_PASSWORD",
    "FEAT126_S10_KEYCLOAK_ADMIN_PASSWORD",
    SYNTHETIC_PASSWORD_KEY,
    "FEAT126_S10_SYNTHETIC_USER_B_PASSWORD",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SyntheticLoginFailure {
    SecretAuthority,
    AuthorizationStart,
    AuthorizationRequest,
    AuthorizationPage,
    LoginForm,
    CredentialSubmit,
    CredentialRejected,
    Callback,
    TokenExchange,
}

impl SyntheticLoginFailure {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 9] = [
        Self::SecretAuthority,
        Self::AuthorizationStart,
        Self::AuthorizationRequest,
        Self::AuthorizationPage,
        Self::LoginForm,
        Self::CredentialSubmit,
        Self::CredentialRejected,
        Self::Callback,
        Self::TokenExchange,
    ];

    pub(crate) const fn failure_class(self) -> &'static str {
        match self {
            Self::SecretAuthority => "driver_login_secret_invalid",
            Self::AuthorizationStart => "driver_login_authorization_start_failed",
            Self::AuthorizationRequest => "driver_login_authorization_request_invalid",
            Self::AuthorizationPage => "driver_login_authorization_page_failed",
            Self::LoginForm => "driver_login_form_invalid",
            Self::CredentialSubmit => "driver_login_credential_submit_failed",
            Self::CredentialRejected => "driver_login_credentials_rejected",
            Self::Callback => "driver_login_callback_rejected",
            Self::TokenExchange => "driver_login_token_exchange_failed",
        }
    }
}

pub(crate) async fn synthetic_authorization_code_tokens(
    oidc: &OidcClient,
) -> Result<IssuedTokens, SyntheticLoginFailure> {
    let secret_path =
        std::env::var(SECRET_PATH_ENV).map_err(|_| SyntheticLoginFailure::SecretAuthority)?;
    let password = read_synthetic_password(Path::new(&secret_path))
        .map_err(|_| SyntheticLoginFailure::SecretAuthority)?;
    let attempt = oidc
        .begin_login(CALLBACK_URI.to_owned())
        .await
        .map_err(|_| SyntheticLoginFailure::AuthorizationStart)?;
    validate_authorization_request(
        oidc.feat126_config(),
        &attempt.authorization_url,
        attempt.expected_state.expose(),
        &attempt.expected_issuer,
    )
    .map_err(|_| SyntheticLoginFailure::AuthorizationRequest)?;
    let code = authorization_code(
        oidc.feat126_config(),
        &attempt.authorization_url,
        attempt.expected_state.expose(),
        &attempt.expected_issuer,
        password.as_str(),
    )
    .await?;
    oidc.exchange_code(attempt, code)
        .await
        .map_err(|_| SyntheticLoginFailure::TokenExchange)
}

fn validate_authorization_request(
    config: &NativeAuthConfig,
    authorization_url: &Url,
    expected_state: &str,
    expected_issuer: &str,
) -> Result<(), NativeAuthError> {
    if authorization_url.scheme() != "https"
        || authorization_url.origin() != config.authorization_endpoint.origin()
        || authorization_url.path() != config.authorization_endpoint.path()
        || !authorization_url.username().is_empty()
        || authorization_url.password().is_some()
        || authorization_url.fragment().is_some()
        || expected_issuer != config.issuer.as_str()
    {
        return Err(NativeAuthError::AuthenticationFailed);
    }
    let mut query = BTreeMap::new();
    for (key, value) in authorization_url.query_pairs() {
        if query.insert(key, value).is_some() {
            return Err(NativeAuthError::AuthenticationFailed);
        }
    }
    const KEYS: [&str; 8] = [
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "nonce",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
    ];
    if query.len() != KEYS.len()
        || query.keys().any(|key| !KEYS.contains(&key.as_ref()))
        || query.get("client_id").map(|value| value.as_ref()) != Some(config.client_id.as_str())
        || query.get("redirect_uri").map(|value| value.as_ref()) != Some(CALLBACK_URI)
        || query.get("response_type").map(|value| value.as_ref()) != Some("code")
        || query.get("scope").map(|value| value.as_ref()) != Some("openid")
        || query
            .get("code_challenge_method")
            .map(|value| value.as_ref())
            != Some("S256")
        || query.get("state").is_none_or(|value| {
            value
                .as_bytes()
                .ct_eq(expected_state.as_bytes())
                .unwrap_u8()
                != 1
        })
        || query.get("nonce").is_none_or(|value| {
            value.is_empty()
                || value.len() > 256
                || !value.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~')
                })
        })
        || query.get("code_challenge").is_none_or(|value| {
            value.len() != 43
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    {
        return Err(NativeAuthError::AuthenticationFailed);
    }
    Ok(())
}

fn read_synthetic_password(path: &Path) -> Result<Zeroizing<String>, NativeAuthError> {
    if !path.is_absolute() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    let path_metadata =
        std::fs::symlink_metadata(path).map_err(|_| NativeAuthError::InvalidConfiguration)?;
    if path_metadata.file_type().is_symlink() || !path_metadata.file_type().is_file() {
        return Err(NativeAuthError::InvalidConfiguration);
    }
    #[cfg(unix)]
    if path_metadata.uid() != unsafe { libc::geteuid() }
        || path_metadata.permissions().mode() & 0o077 != 0
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
    #[cfg(unix)]
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
    parse_synthetic_password(&contents)
}

fn parse_synthetic_password(contents: &str) -> Result<Zeroizing<String>, NativeAuthError> {
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
        .get(SYNTHETIC_PASSWORD_KEY)
        .map(|value| Zeroizing::new((*value).to_owned()))
        .ok_or(NativeAuthError::InvalidConfiguration)
}

async fn authorization_code(
    config: &NativeAuthConfig,
    authorization_url: &Url,
    expected_state: &str,
    expected_issuer: &str,
    password: &str,
) -> Result<SecretValue, SyntheticLoginFailure> {
    let client = config
        .harden_http_client(
            reqwest::Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10)),
        )
        .build()
        .map_err(|_| SyntheticLoginFailure::AuthorizationPage)?;
    let response = client
        .get(authorization_url.clone())
        .send()
        .await
        .map_err(|_| SyntheticLoginFailure::AuthorizationPage)?;
    if response.status() != reqwest::StatusCode::OK
        || response
            .content_length()
            .is_some_and(|length| length > MAX_AUTHORIZATION_BODY_BYTES as u64)
    {
        return Err(SyntheticLoginFailure::AuthorizationPage);
    }
    let cookies = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|value| {
            value
                .to_str()
                .ok()
                .and_then(|value| value.split(';').next())
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        })
        .collect::<Option<Vec<_>>>()
        .ok_or(SyntheticLoginFailure::AuthorizationPage)?
        .join("; ");
    if cookies.is_empty() || cookies.len() > MAX_COOKIE_BYTES {
        return Err(SyntheticLoginFailure::AuthorizationPage);
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| SyntheticLoginFailure::AuthorizationPage)?;
    if body.is_empty() || body.len() > MAX_AUTHORIZATION_BODY_BYTES {
        return Err(SyntheticLoginFailure::AuthorizationPage);
    }
    let action = login_action(
        std::str::from_utf8(&body).map_err(|_| SyntheticLoginFailure::LoginForm)?,
        config,
    )
    .map_err(|_| SyntheticLoginFailure::LoginForm)?;

    let response = client
        .post(action)
        .header(COOKIE, cookies)
        .form(&[
            ("username", SYNTHETIC_USERNAME),
            ("password", password),
            ("credentialId", ""),
        ])
        .send()
        .await
        .map_err(|_| SyntheticLoginFailure::CredentialSubmit)?;
    if !response.status().is_redirection() {
        return Err(SyntheticLoginFailure::CredentialRejected);
    }
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(SyntheticLoginFailure::Callback)?;
    callback_code(location, expected_state, expected_issuer)
        .map_err(|_| SyntheticLoginFailure::Callback)
}

fn login_action(body: &str, config: &NativeAuthConfig) -> Result<Url, NativeAuthError> {
    let form = body
        .find("id=\"kc-form-login\"")
        .ok_or(NativeAuthError::AuthenticationFailed)?;
    let action = body[form..]
        .find("action=\"")
        .map(|offset| form + offset + "action=\"".len())
        .ok_or(NativeAuthError::AuthenticationFailed)?;
    let end = body[action..]
        .find('"')
        .map(|offset| action + offset)
        .ok_or(NativeAuthError::AuthenticationFailed)?;
    let encoded = &body[action..end];
    if encoded.replace("&amp;", "").contains('&') {
        return Err(NativeAuthError::AuthenticationFailed);
    }
    let action = Url::parse(&encoded.replace("&amp;", "&"))
        .map_err(|_| NativeAuthError::AuthenticationFailed)?;
    let expected_path = format!(
        "{}/login-actions/authenticate",
        config.issuer.path().trim_end_matches('/')
    );
    if action.scheme() != "https"
        || action.origin() != config.issuer.origin()
        || action.path() != expected_path
        || !action.username().is_empty()
        || action.password().is_some()
        || action.fragment().is_some()
    {
        return Err(NativeAuthError::AuthenticationFailed);
    }
    Ok(action)
}

fn callback_code(
    location: &str,
    expected_state: &str,
    expected_issuer: &str,
) -> Result<SecretValue, NativeAuthError> {
    let callback = Url::parse(location).map_err(|_| NativeAuthError::CallbackRejected)?;
    if callback.scheme() != "http"
        || callback.host_str() != Some("127.0.0.1")
        || callback.port().is_some()
        || callback.path() != "/oauth/callback"
        || callback.fragment().is_some()
    {
        return Err(NativeAuthError::CallbackRejected);
    }
    let mut query = BTreeMap::new();
    for (key, value) in callback.query_pairs() {
        if query.insert(key, value).is_some() {
            return Err(NativeAuthError::CallbackRejected);
        }
    }
    if !(query.len() == 3 || query.len() == 4)
        || query
            .keys()
            .any(|key| !matches!(key.as_ref(), "code" | "state" | "iss" | "session_state"))
        || query.get("state").is_none_or(|value| {
            value
                .as_bytes()
                .ct_eq(expected_state.as_bytes())
                .unwrap_u8()
                != 1
        })
        || query
            .get("iss")
            .is_none_or(|value| value.as_ref() != expected_issuer)
    {
        return Err(NativeAuthError::CallbackRejected);
    }
    if let Some(session_state) = query.get("session_state") {
        if session_state.len() != KEYCLOAK_SESSION_STATE_BYTES
            || !session_state
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(NativeAuthError::CallbackRejected);
        }
    }
    let code = query
        .get("code")
        .filter(|value| !value.is_empty() && value.len() <= MAX_CODE_BYTES)
        .ok_or(NativeAuthError::CallbackRejected)?;
    Ok(SecretValue::new(code.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config() -> NativeAuthConfig {
        let values = HashMap::from([
            ("YIJIE_DESKTOP_NATIVE_AUTH_ENABLED", "true"),
            (
                "YIJIE_DESKTOP_OIDC_ISSUER",
                "https://identity.example/realms/local",
            ),
            (
                "YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT",
                "https://identity.example/realms/local/protocol/openid-connect/auth",
            ),
            (
                "YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT",
                "https://identity.example/realms/local/protocol/openid-connect/token",
            ),
            (
                "YIJIE_DESKTOP_OIDC_JWKS_URI",
                "https://identity.example/realms/local/protocol/openid-connect/certs",
            ),
            (
                "YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT",
                "https://identity.example/realms/local/protocol/openid-connect/revoke",
            ),
            ("YIJIE_DESKTOP_OIDC_CLIENT_ID", "desktop-client"),
            ("YIJIE_DESKTOP_API_ORIGIN", "https://api.example/"),
        ]);
        NativeAuthConfig::from_test_lookup(|name| values.get(name).map(|value| value.to_string()))
            .unwrap()
            .unwrap()
    }

    fn secrets() -> String {
        SECRET_KEYS
            .iter()
            .enumerate()
            .map(|(index, key)| format!("{key}={}\n", format!("{index:x}").repeat(64)))
            .collect()
    }

    #[test]
    fn synthetic_login_failures_are_closed_stage_only_classes() {
        let classes = SyntheticLoginFailure::ALL.map(SyntheticLoginFailure::failure_class);
        assert_eq!(
            classes.len(),
            classes.into_iter().collect::<BTreeSet<_>>().len()
        );
        assert!(classes.into_iter().all(|class| {
            class.starts_with("driver_login_")
                && class
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        }));
    }

    #[test]
    fn parses_only_the_closed_owner_secret_inventory() {
        assert_eq!(parse_synthetic_password(&secrets()).unwrap().len(), 64);
        assert!(parse_synthetic_password(
            &secrets().replace("FEAT126_S10_API_DB_PASSWORD=", "UNREVIEWED_SECRET=",)
        )
        .is_err());
        assert!(parse_synthetic_password(&secrets().replace(
            "FEAT126_S10_SYNTHETIC_USER_B_PASSWORD=",
            "FEAT126_S10_SYNTHETIC_USER_A_PASSWORD=",
        ))
        .is_err());
    }

    #[test]
    fn accepts_only_the_reviewed_keycloak_login_action() {
        let config = config();
        let body = r#"<form id="kc-form-login" action="https://identity.example/realms/local/login-actions/authenticate?session=x&amp;execution=y">"#;
        assert!(login_action(body, &config).is_ok());
        assert!(login_action(
            r#"<form id="kc-form-login" action="https://other.example/login-actions/authenticate">"#,
            &config,
        )
        .is_err());
        assert!(login_action("<form></form>", &config).is_err());
    }

    #[test]
    fn callback_is_bound_to_redirect_state_and_issuer() {
        let issuer = "https://identity.example/realms/local";
        let valid = format!(
            "http://127.0.0.1/oauth/callback?code=abc&state=state-value&iss={}",
            url::form_urlencoded::byte_serialize(issuer.as_bytes()).collect::<String>()
        );
        assert_eq!(
            callback_code(&valid, "state-value", issuer)
                .unwrap()
                .expose(),
            "abc"
        );
        assert!(callback_code(&valid, "wrong-state", issuer).is_err());
        assert!(callback_code(&valid, "state-value", "https://other.example").is_err());
        let with_uuid_session = valid.replace(
            "&iss=",
            "&session_state=019fbd88-cbc3-4bf1-934d-7b05cd693f80&iss=",
        );
        assert!(callback_code(&with_uuid_session, "state-value", issuer).is_err());
        let with_opaque_session =
            valid.replace("&iss=", "&session_state=AbCdEfGhIjKlMnOpQrStUvWx&iss=");
        assert!(callback_code(&with_opaque_session, "state-value", issuer).is_ok());
        assert!(callback_code(
            &valid.replace("&iss=", "&session_state=&iss="),
            "state-value",
            issuer,
        )
        .is_err());
        assert!(callback_code(
            &valid.replace("&iss=", &format!("&session_state={}&iss=", "a".repeat(25))),
            "state-value",
            issuer,
        )
        .is_err());
        assert!(callback_code(
            &valid.replace("&iss=", "&session_state=invalid%20session&iss="),
            "state-value",
            issuer,
        )
        .is_err());
        assert!(
            callback_code(&format!("{valid}&state=state-value"), "state-value", issuer,).is_err()
        );
        assert!(callback_code(
            "http://localhost/oauth/callback?code=abc&state=state-value&iss=x",
            "state-value",
            "x",
        )
        .is_err());
    }

    #[test]
    fn real_authorization_url_requires_actual_s256_challenge() {
        let config = config();
        let state = "state-value";
        let issuer = config.issuer.to_string();
        let mut url = config.authorization_endpoint.clone();
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &config.client_id)
            .append_pair("state", state)
            .append_pair(
                "code_challenge",
                "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
            )
            .append_pair("code_challenge_method", "S256")
            .append_pair("redirect_uri", CALLBACK_URI)
            .append_pair("scope", "openid")
            .append_pair("nonce", "nonce-value");
        assert!(validate_authorization_request(&config, &url, state, &issuer).is_ok());
        assert!(validate_authorization_request(
            &config,
            &Url::parse(&url.as_str().replace("S256", "plain")).unwrap(),
            state,
            &issuer,
        )
        .is_err());
        assert!(validate_authorization_request(
            &config,
            &Url::parse(
                &url.as_str()
                    .replace("abcdefghijklmnopqrstuvwxyzABCDEFGH123456789", "hardcoded",)
            )
            .unwrap(),
            state,
            &issuer,
        )
        .is_err());
    }
}
