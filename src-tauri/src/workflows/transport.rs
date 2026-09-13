use super::config::{Credentials, API_ORIGIN};
use super::generated::{EditorSessionSecret, ErrorCode, ErrorResponse};
use super::{error, validation};
use crate::native_auth::SecretValue;
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use std::time::Duration;
use zeroize::Zeroizing;

pub(super) struct Transport {
    client: Client,
    origin: url::Url,
}

impl Transport {
    pub fn new() -> Result<Self, ErrorResponse> {
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .user_agent("YijieDesktop/0.1 workflow-local-v1")
            .build()
            .map_err(|_| error(ErrorCode::ServiceUnavailable))?;
        Ok(Self {
            client,
            origin: url::Url::parse(API_ORIGIN)
                .map_err(|_| error(ErrorCode::ServiceUnavailable))?,
        })
    }

    #[cfg(test)]
    pub(super) fn for_normal_loopback_provider(port: u16) -> Self {
        let mut transport = Self::new().expect("test HTTP client");
        transport
            .origin
            .set_port(Some(port))
            .expect("loopback test port");
        transport
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn request<T: DeserializeOwned>(
        &self,
        credentials: &Credentials,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        session: Option<&SecretValue>,
        expected_status: u16,
        schema_name: &str,
        operation_id: Option<&str>,
    ) -> Result<T, ErrorResponse> {
        let body = self
            .request_bytes(
                credentials,
                method,
                path,
                body,
                session,
                expected_status,
                operation_id,
            )
            .await?;
        let invalid = || {
            let mut failure = error(if operation_id.is_some() {
                ErrorCode::OperationUnknown
            } else {
                ErrorCode::ProtocolMismatch
            });
            failure.operation_id = operation_id.map(str::to_owned);
            failure
        };
        let value: serde_json::Value = serde_json::from_slice(&body).map_err(|_| invalid())?;
        validation::value(schema_name, &value).map_err(|_| invalid())?;
        serde_json::from_value(value).map_err(|_| invalid())
    }

    pub async fn open_session(
        &self,
        credentials: &Credentials,
        body: Vec<u8>,
    ) -> Result<(EditorSessionSecret, SecretValue), ErrorResponse> {
        let bytes = self
            .request_bytes(
                credentials,
                Method::POST,
                "/v1/workflow-local/editor-sessions",
                Some(body),
                None,
                201,
                None,
            )
            .await?;
        // Decode the generated DTO directly. Never create a serde_json::Value copy of E.
        let mut session: EditorSessionSecret =
            serde_json::from_slice(&bytes).map_err(|_| error(ErrorCode::ProtocolMismatch))?;
        let secret = SecretValue::new(std::mem::take(&mut session.secret));
        if validation::typed("Identifier", &session.session_id).is_err()
            || validation::typed("Identifier", &session.workflow_id).is_err()
            || validation::typed("RunEpoch", &session.run_epoch).is_err()
            || validation::field_text("EditorSessionSecret", "secret", secret.expose()).is_err()
            || session.expires_at_ms < 0
        {
            return Err(error(ErrorCode::ProtocolMismatch));
        }
        Ok((session, secret))
    }

    #[allow(clippy::too_many_arguments)]
    async fn request_bytes(
        &self,
        credentials: &Credentials,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        session: Option<&SecretValue>,
        expected_status: u16,
        operation_id: Option<&str>,
    ) -> Result<Zeroizing<Vec<u8>>, ErrorResponse> {
        let uncertain = || {
            let mut result = error(if operation_id.is_some() {
                ErrorCode::OperationUnknown
            } else {
                ErrorCode::ServiceUnavailable
            });
            result.operation_id = operation_id.map(str::to_owned);
            result
        };
        let protocol_error = || {
            if operation_id.is_some() {
                uncertain()
            } else {
                error(ErrorCode::ProtocolMismatch)
            }
        };
        if body
            .as_ref()
            .is_some_and(|body| body.len() > validation::MAX_MESSAGE_BYTES)
            || !path.starts_with("/v1/")
            || path.starts_with("//")
            || path.contains('#')
        {
            return Err(error(ErrorCode::InvalidRequest));
        }
        // No renderer-controlled destination, redirects, proxy, Cookie store, or arbitrary headers.
        let mut url = self.origin.clone();
        let (path_part, query) = path
            .split_once('?')
            .map_or((path, None), |(p, q)| (p, Some(q)));
        url.set_path(path_part);
        url.set_query(query);
        let mut authorization =
            HeaderValue::from_str(&format!("Bearer {}", credentials.token.expose()))
                .map_err(|_| error(ErrorCode::ServiceUnavailable))?;
        authorization.set_sensitive(true);
        let mut request = self
            .client
            .request(method.clone(), url)
            .header(AUTHORIZATION, authorization)
            .header("X-Yijie-Run-Epoch", &credentials.epoch)
            .header(ACCEPT, "application/json");
        if let Some(session) = session {
            let mut header = HeaderValue::from_str(session.expose())
                .map_err(|_| error(ErrorCode::SessionExpired))?;
            header.set_sensitive(true);
            request = request.header("X-Yijie-Editor-Session", header);
        }
        if let Some(body) = body {
            request = request.header(CONTENT_TYPE, "application/json").body(body);
        }
        if method == Method::DELETE {
            request = request.timeout(Duration::from_secs(2));
        }
        let mut response = request.send().await.map_err(|_| uncertain())?;
        let status = response.status().as_u16();
        if response
            .content_length()
            .is_some_and(|size| size > validation::MAX_MESSAGE_BYTES as u64)
        {
            return Err(protocol_error());
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if content_type.split(';').next().map(str::trim) != Some("application/json") {
            return Err(protocol_error());
        }
        let mut body = Zeroizing::new(Vec::new());
        while let Some(chunk) = response.chunk().await.map_err(|_| uncertain())? {
            if body.len().saturating_add(chunk.len()) > validation::MAX_MESSAGE_BYTES {
                return Err(protocol_error());
            }
            body.extend_from_slice(&chunk);
        }
        if status != expected_status {
            let value: serde_json::Value =
                serde_json::from_slice(&body).map_err(|_| protocol_error())?;
            if !matches!(status, 400 | 401 | 404 | 409 | 413 | 503)
                || validation::value("ErrorResponse", &value).is_err()
            {
                return Err(protocol_error());
            }
            let remote: ErrorResponse =
                serde_json::from_value(value).map_err(|_| protocol_error())?;
            if operation_id.is_some_and(|expected| {
                remote
                    .operation_id
                    .as_deref()
                    .is_some_and(|id| id != expected)
            }) {
                return Err(protocol_error());
            }
            let mut safe = error(remote.code);
            safe.operation_id = operation_id.map(str::to_owned).or(remote.operation_id);
            return Err(safe);
        }
        Ok(body)
    }
}
