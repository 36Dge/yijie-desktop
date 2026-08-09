use super::{NativeAuthConfig, NativeAuthError, SecretValue};
use openidconnect::core::{
    CoreClient, CoreJsonWebKeySet, CoreJwsSigningAlgorithm, CoreResponseType, CoreRevocableToken,
    CoreTokenType,
};
use openidconnect::{
    AccessTokenHash, AuthUrl, AuthenticationFlow, AuthorizationCode, ClientId, CsrfToken,
    EndpointNotSet, EndpointSet, IssuerUrl, JsonWebKeySetUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, RefreshToken, RevocationUrl, TokenResponse,
    TokenUrl,
};
use reqwest::redirect::Policy;
use sha2::Digest;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tokio::sync::RwLock;
use url::Url;

const MAX_JWKS_BYTES: usize = 256 * 1024;
const MAX_ACCESS_TOKEN_LIFETIME: Duration = Duration::from_secs(10 * 60);
const MIN_USABLE_ACCESS_TOKEN_LIFETIME: Duration = Duration::from_secs(2 * 60);

type ConfiguredClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointSet,
    EndpointSet,
    EndpointNotSet,
>;

pub struct OidcClient {
    config: NativeAuthConfig,
    http: reqwest::Client,
    jwks: RwLock<Option<CoreJsonWebKeySet>>,
}

pub struct LoginAttempt {
    pub authorization_url: Url,
    pub expected_state: SecretValue,
    pub expected_issuer: String,
    nonce: Nonce,
    pkce_verifier: PkceCodeVerifier,
    client: ConfiguredClient,
    jwks: CoreJsonWebKeySet,
}

#[derive(Debug)]
pub struct IssuedTokens {
    pub access_token: SecretValue,
    pub refresh_token: SecretValue,
    pub expires_in: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshFailure {
    InvalidGrant,
    Failed,
}

impl OidcClient {
    pub fn new(config: NativeAuthConfig) -> Result<Self, NativeAuthError> {
        let http = config
            .harden_http_client(
                reqwest::Client::builder()
                    .https_only(true)
                    .redirect(Policy::none())
                    .connect_timeout(Duration::from_secs(5))
                    .timeout(Duration::from_secs(10))
                    .user_agent("YijieDesktop/0.1 native-auth"),
            )
            .build()
            .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        Ok(Self {
            config,
            http,
            jwks: RwLock::new(None),
        })
    }

    #[cfg(any(test, feature = "feat126-s10-driver"))]
    pub(crate) fn feat126_config(&self) -> &NativeAuthConfig {
        &self.config
    }

    pub async fn begin_login(&self, redirect_uri: String) -> Result<LoginAttempt, NativeAuthError> {
        let jwks = self.fetch_jwks().await?;
        let client = self.build_client(jwks.clone(), Some(redirect_uri))?;
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
        let (authorization_url, state, nonce) = client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .set_pkce_challenge(pkce_challenge)
            .url();

        Ok(LoginAttempt {
            authorization_url,
            expected_state: SecretValue::new(state.secret().to_owned()),
            expected_issuer: self.config.issuer.to_string(),
            nonce,
            pkce_verifier,
            client,
            jwks,
        })
    }

    pub async fn exchange_code(
        &self,
        attempt: LoginAttempt,
        code: SecretValue,
    ) -> Result<IssuedTokens, NativeAuthError> {
        let response = attempt
            .client
            .exchange_code(AuthorizationCode::new(code.expose().to_owned()))
            .set_pkce_verifier(attempt.pkce_verifier)
            .request_async(&self.http)
            .await
            .map_err(|_| NativeAuthError::AuthenticationFailed)?;

        let id_token = response
            .id_token()
            .ok_or(NativeAuthError::AuthenticationFailed)?;
        if id_token
            .signing_alg()
            .map_err(|_| NativeAuthError::AuthenticationFailed)?
            != &CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256
        {
            return Err(NativeAuthError::AuthenticationFailed);
        }
        let verifier = attempt
            .client
            .id_token_verifier()
            .set_allowed_algs(vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256]);
        let claims = id_token
            .claims(&verifier, &attempt.nonce)
            .map_err(|_| NativeAuthError::AuthenticationFailed)?;
        if let Some(expected_hash) = claims.access_token_hash() {
            let actual_hash = AccessTokenHash::from_token(
                response.access_token(),
                id_token
                    .signing_alg()
                    .map_err(|_| NativeAuthError::AuthenticationFailed)?,
                id_token
                    .signing_key(&verifier)
                    .map_err(|_| NativeAuthError::AuthenticationFailed)?,
            )
            .map_err(|_| NativeAuthError::AuthenticationFailed)?;
            if actual_hash != *expected_hash {
                return Err(NativeAuthError::AuthenticationFailed);
            }
        }

        let issued = validate_token_response(
            response.access_token().secret(),
            response.token_type(),
            response.expires_in(),
            response
                .refresh_token()
                .map(|token| token.secret().as_str()),
        )?;
        *self.jwks.write().await = Some(attempt.jwks);
        Ok(issued)
    }

    pub async fn refresh(
        &self,
        current_refresh_token: &SecretValue,
    ) -> Result<IssuedTokens, RefreshFailure> {
        let jwks = self.jwks.read().await.clone().unwrap_or_default();
        let client = self
            .build_client(jwks, None)
            .map_err(|_| RefreshFailure::Failed)?;
        let refresh_token = RefreshToken::new(current_refresh_token.expose().to_owned());
        let response = match client
            .exchange_refresh_token(&refresh_token)
            .request_async(&self.http)
            .await
        {
            Ok(response) => response,
            Err(openidconnect::RequestTokenError::ServerResponse(response))
                if response.error()
                    == &openidconnect::core::CoreErrorResponseType::InvalidGrant =>
            {
                return Err(RefreshFailure::InvalidGrant);
            }
            Err(_) => return Err(RefreshFailure::Failed),
        };

        let issued = validate_token_response(
            response.access_token().secret(),
            response.token_type(),
            response.expires_in(),
            response
                .refresh_token()
                .map(|token| token.secret().as_str()),
        )
        .map_err(|_| RefreshFailure::InvalidGrant)?;
        if same_secret(
            issued.refresh_token.expose(),
            current_refresh_token.expose(),
        ) {
            self.revoke(current_refresh_token).await;
            return Err(RefreshFailure::InvalidGrant);
        }
        Ok(issued)
    }

    pub async fn revoke(&self, refresh_token: &SecretValue) {
        let jwks = self.jwks.read().await.clone().unwrap_or_default();
        let Ok(client) = self.build_client(jwks, None) else {
            return;
        };
        let token = RefreshToken::new(refresh_token.expose().to_owned());
        let revocable: CoreRevocableToken = (&token).into();
        let Ok(request) = client.revoke_token(revocable) else {
            return;
        };
        let _ = request.request_async(&self.http).await;
    }

    fn build_client(
        &self,
        jwks: CoreJsonWebKeySet,
        redirect_uri: Option<String>,
    ) -> Result<ConfiguredClient, NativeAuthError> {
        let client = CoreClient::new(
            ClientId::new(self.config.client_id.clone()),
            IssuerUrl::new(self.config.issuer.to_string())
                .map_err(|_| NativeAuthError::InvalidConfiguration)?,
            jwks,
        )
        .set_auth_uri(
            AuthUrl::new(self.config.authorization_endpoint.to_string())
                .map_err(|_| NativeAuthError::InvalidConfiguration)?,
        )
        .set_token_uri(
            TokenUrl::new(self.config.token_endpoint.to_string())
                .map_err(|_| NativeAuthError::InvalidConfiguration)?,
        )
        .set_revocation_url(
            RevocationUrl::new(self.config.revocation_endpoint.to_string())
                .map_err(|_| NativeAuthError::InvalidConfiguration)?,
        );
        match redirect_uri {
            Some(redirect_uri) => Ok(client.set_redirect_uri(
                RedirectUrl::new(redirect_uri)
                    .map_err(|_| NativeAuthError::InvalidConfiguration)?,
            )),
            None => Ok(client),
        }
    }

    async fn fetch_jwks(&self) -> Result<CoreJsonWebKeySet, NativeAuthError> {
        let jwks_url = JsonWebKeySetUrl::new(self.config.jwks_uri.to_string())
            .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        let mut response = self
            .http
            .get(jwks_url.as_str())
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| NativeAuthError::AuthenticationFailed)?;
        if response.status() != reqwest::StatusCode::OK
            || response
                .content_length()
                .is_some_and(|size| size as usize > MAX_JWKS_BYTES)
        {
            return Err(NativeAuthError::AuthenticationFailed);
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok());
        if !content_type.is_some_and(is_jwks_content_type) {
            return Err(NativeAuthError::AuthenticationFailed);
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| NativeAuthError::AuthenticationFailed)?
        {
            if bytes.len() + chunk.len() > MAX_JWKS_BYTES {
                return Err(NativeAuthError::AuthenticationFailed);
            }
            bytes.extend_from_slice(&chunk);
        }
        let jwks: CoreJsonWebKeySet =
            serde_json::from_slice(&bytes).map_err(|_| NativeAuthError::AuthenticationFailed)?;
        if jwks.keys().is_empty() {
            return Err(NativeAuthError::AuthenticationFailed);
        }
        Ok(jwks)
    }
}

fn is_jwks_content_type(value: &str) -> bool {
    matches!(
        value.split(';').next().map(str::trim),
        Some("application/json" | "application/jwk-set+json")
    )
}

fn validate_token_response(
    access_token: &str,
    token_type: &CoreTokenType,
    expires_in: Option<Duration>,
    refresh_token: Option<&str>,
) -> Result<IssuedTokens, NativeAuthError> {
    let expires_in = expires_in.ok_or(NativeAuthError::AuthenticationFailed)?;
    if token_type != &CoreTokenType::Bearer
        || expires_in <= MIN_USABLE_ACCESS_TOKEN_LIFETIME
        || expires_in > MAX_ACCESS_TOKEN_LIFETIME
        || access_token.is_empty()
        || access_token.len() > 16 * 1024
    {
        return Err(NativeAuthError::AuthenticationFailed);
    }
    let refresh_token = refresh_token
        .filter(|value| !value.is_empty() && value.len() <= 16 * 1024)
        .ok_or(NativeAuthError::AuthenticationFailed)?;
    Ok(IssuedTokens {
        access_token: SecretValue::new(access_token.to_owned()),
        refresh_token: SecretValue::new(refresh_token.to_owned()),
        expires_in,
    })
}

fn same_secret(left: &str, right: &str) -> bool {
    let left_hash = sha2::Sha256::digest(left.as_bytes());
    let right_hash = sha2::Sha256::digest(right.as_bytes());
    left_hash.ct_eq(&right_hash).unwrap_u8() == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config() -> NativeAuthConfig {
        let values = HashMap::from([
            ("YIJIE_DESKTOP_NATIVE_AUTH_ENABLED", "true"),
            ("YIJIE_DESKTOP_OIDC_ISSUER", "https://identity.example/"),
            (
                "YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT",
                "https://identity.example/oauth/authorize",
            ),
            (
                "YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT",
                "https://identity.example/oauth/token",
            ),
            (
                "YIJIE_DESKTOP_OIDC_JWKS_URI",
                "https://identity.example/.well-known/jwks.json",
            ),
            (
                "YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT",
                "https://identity.example/oauth/revoke",
            ),
            ("YIJIE_DESKTOP_OIDC_CLIENT_ID", "desktop-client"),
            ("YIJIE_DESKTOP_API_ORIGIN", "https://api.example/"),
        ]);
        NativeAuthConfig::from_test_lookup(|name| values.get(name).map(|value| value.to_string()))
            .expect("valid config")
            .expect("enabled")
    }

    #[tokio::test]
    async fn authorization_request_has_exact_redirect_pkce_state_nonce_and_no_secret() {
        let client = OidcClient::new(config()).expect("OIDC client");
        let jwks = CoreJsonWebKeySet::default();
        let configured = client
            .build_client(
                jwks,
                Some("http://127.0.0.1:43123/oauth/callback".to_owned()),
            )
            .expect("configured client");
        let (challenge, _) = PkceCodeChallenge::new_random_sha256();
        let (url, state, nonce) = configured
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .set_pkce_challenge(challenge)
            .url();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();

        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:43123/oauth/callback")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(query.get("scope").map(String::as_str), Some("openid"));
        assert_eq!(
            query.get("state").map(String::as_str),
            Some(state.secret().as_str())
        );
        assert_eq!(
            query.get("nonce").map(String::as_str),
            Some(nonce.secret().as_str())
        );
        assert!(!query.contains_key("client_secret"));
    }

    #[test]
    fn rejects_long_lived_short_lived_non_bearer_or_missing_refresh_tokens() {
        assert!(validate_token_response(
            "access",
            &CoreTokenType::Bearer,
            Some(Duration::from_secs(600)),
            Some("refresh")
        )
        .is_ok());
        for expires in [119, 601] {
            assert!(validate_token_response(
                "access",
                &CoreTokenType::Bearer,
                Some(Duration::from_secs(expires)),
                Some("refresh")
            )
            .is_err());
        }
        assert!(validate_token_response(
            "access",
            &CoreTokenType::Mac,
            Some(Duration::from_secs(600)),
            Some("refresh")
        )
        .is_err());
        assert!(validate_token_response(
            "access",
            &CoreTokenType::Bearer,
            Some(Duration::from_secs(600)),
            None
        )
        .is_err());
    }

    #[test]
    fn refresh_rotation_comparison_is_secret_safe() {
        assert!(same_secret("same", "same"));
        assert!(!same_secret("old", "new"));
    }

    #[test]
    fn jwks_content_type_accepts_only_json_media_types() {
        assert!(is_jwks_content_type("application/json"));
        assert!(is_jwks_content_type("application/json; charset=utf-8"));
        assert!(is_jwks_content_type("application/jwk-set+json"));
        assert!(!is_jwks_content_type("text/json"));
        assert!(!is_jwks_content_type("text/html"));
    }
}
