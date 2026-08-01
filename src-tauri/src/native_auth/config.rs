use super::error::NativeAuthError;
use url::Url;

const ENABLED: &str = "YIJIE_DESKTOP_NATIVE_AUTH_ENABLED";
const ISSUER: &str = "YIJIE_DESKTOP_OIDC_ISSUER";
const AUTHORIZATION_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_AUTHORIZATION_ENDPOINT";
const TOKEN_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_TOKEN_ENDPOINT";
const JWKS_URI: &str = "YIJIE_DESKTOP_OIDC_JWKS_URI";
const REVOCATION_ENDPOINT: &str = "YIJIE_DESKTOP_OIDC_REVOCATION_ENDPOINT";
const CLIENT_ID: &str = "YIJIE_DESKTOP_OIDC_CLIENT_ID";
const API_ORIGIN: &str = "YIJIE_DESKTOP_API_ORIGIN";

#[derive(Clone, Debug)]
pub struct NativeAuthConfig {
    pub issuer: Url,
    pub authorization_endpoint: Url,
    pub token_endpoint: Url,
    pub jwks_uri: Url,
    pub revocation_endpoint: Url,
    pub client_id: String,
    pub api_origin: Url,
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

        Ok(Some(Self {
            issuer,
            authorization_endpoint,
            token_endpoint,
            jwks_uri,
            revocation_endpoint,
            client_id,
            api_origin,
        }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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

    #[test]
    fn feature_is_disabled_by_default() {
        assert!(load(HashMap::new()).expect("disabled config").is_none());
    }

    #[test]
    fn enabled_configuration_is_exact_and_public_client_only() {
        let config = load(valid()).expect("valid config").expect("enabled");

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
}
