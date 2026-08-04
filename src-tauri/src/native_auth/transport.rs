use super::{NativeAuthConfig, NativeAuthError, SecretValue};
use reqwest::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE, RETRY_AFTER, WWW_AUTHENTICATE};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const TENANTS_PATH: &str = "/v1/me/tenants";
const CAPABILITIES_PATH: &str = "/v1/me/capabilities";
const TASKS_V2_PATH: &str = "/v2/tasks";
const TENANT_HEADER: &str = "X-Yijie-Tenant-ID";
const IDEMPOTENCY_HEADER: &str = "Idempotency-Key";

pub struct OperationTransport {
    api_origin: Url,
    http: reqwest::Client,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PublicTaskErrorCode {
    InvalidRequest,
    InvalidTenantContext,
    Unauthenticated,
    AccessDenied,
    IdempotencyConflict,
    AuthorizationUnavailable,
    InternalError,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct PublicTaskV2 {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub created_by_user_id: Uuid,
    pub client_reference_id: Uuid,
}

impl std::fmt::Debug for PublicTaskV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PublicTaskV2")
            .field("id", &"[CONTROL_PLANE_ID]")
            .field("tenant_id", &"[RUST_BOUND]")
            .field("created_by_user_id", &"[RUST_BOUND]")
            .field("client_reference_id", &"[OPAQUE]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PublicTaskTransportOutcome {
    Created(PublicTaskV2),
    Rejected {
        status: u16,
        code: PublicTaskErrorCode,
    },
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct CreateTaskV2Request<'a> {
    task_type: &'a str,
    input: TaskContentReferenceV2<'a>,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct TaskContentReferenceV2<'a> {
    schema_version: u8,
    content_mode: &'a str,
    client_reference_id: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskV2Response {
    id: Uuid,
    tenant_id: Uuid,
    created_by_user_id: Uuid,
    task_type: String,
    status: String,
    input: TaskContentReferenceV2Response,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskContentReferenceV2Response {
    schema_version: u8,
    content_mode: String,
    client_reference_id: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskV2ErrorResponse {
    code: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    pub status: u16,
    pub cache_control: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub www_authenticate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<String>,
    pub body: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Operation {
    ListMyTenants,
    GetMyCapabilities(Uuid),
}

impl OperationTransport {
    pub fn new(config: &NativeAuthConfig) -> Result<Self, NativeAuthError> {
        let http = config
            .harden_http_client(
                reqwest::Client::builder()
                    .https_only(true)
                    .redirect(Policy::none())
                    .connect_timeout(Duration::from_secs(5))
                    .timeout(Duration::from_secs(10))
                    .user_agent("YijieDesktop/0.1 permission-transport"),
            )
            .build()
            .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        Ok(Self {
            api_origin: config.api_origin.clone(),
            http,
        })
    }

    pub async fn list_my_tenants(
        &self,
        access_token: &SecretValue,
    ) -> Result<OperationResponse, NativeAuthError> {
        self.execute(Operation::ListMyTenants, access_token).await
    }

    pub async fn get_my_capabilities(
        &self,
        tenant_id: &str,
        access_token: &SecretValue,
    ) -> Result<OperationResponse, NativeAuthError> {
        let tenant_id = parse_canonical_tenant_id(tenant_id)?;
        self.execute(Operation::GetMyCapabilities(tenant_id), access_token)
            .await
    }

    pub(crate) async fn create_task_v2(
        &self,
        tenant_id: Uuid,
        idempotency_key: Uuid,
        client_reference_id: Uuid,
        access_token: &SecretValue,
    ) -> Result<PublicTaskTransportOutcome, NativeAuthError> {
        if tenant_id.is_nil() || idempotency_key.is_nil() || client_reference_id.is_nil() {
            return Err(NativeAuthError::InvalidConfiguration);
        }
        let url = self
            .api_origin
            .join(TASKS_V2_PATH.trim_start_matches('/'))
            .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        if url.scheme() != "https"
            || url.origin() != self.api_origin.origin()
            || url.path() != TASKS_V2_PATH
            || url.query().is_some()
        {
            return Err(NativeAuthError::InvalidConfiguration);
        }
        let body = serde_json::to_vec(&CreateTaskV2Request {
            task_type: "conversation",
            input: TaskContentReferenceV2 {
                schema_version: 1,
                content_mode: "local_only",
                client_reference_id,
            },
        })
        .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        let mut response = self
            .http
            .post(url)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header(TENANT_HEADER, tenant_id.hyphenated().to_string())
            .header(IDEMPOTENCY_HEADER, idempotency_key.hyphenated().to_string())
            .bearer_auth(access_token.expose())
            .body(body)
            .send()
            .await
            .map_err(|_| NativeAuthError::TransportFailed)?;
        let status = response.status().as_u16();
        if !matches!(status, 201 | 400 | 401 | 403 | 409 | 500 | 503) {
            return Err(NativeAuthError::ResponseRejected);
        }
        validate_response_headers(&response, status)?;
        if response
            .content_length()
            .is_some_and(|size| size as usize > MAX_RESPONSE_BYTES)
        {
            return Err(NativeAuthError::ResponseRejected);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| NativeAuthError::TransportFailed)?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(NativeAuthError::ResponseRejected);
            }
            bytes.extend_from_slice(&chunk);
        }
        if status == 201 {
            let task: TaskV2Response =
                serde_json::from_slice(&bytes).map_err(|_| NativeAuthError::ResponseRejected)?;
            if task.id.is_nil()
                || task.tenant_id.is_nil()
                || task.created_by_user_id.is_nil()
                || task.task_type != "conversation"
                || !matches!(
                    task.status.as_str(),
                    "draft" | "running" | "waiting_approval" | "completed" | "failed"
                )
                || task.input.schema_version != 1
                || task.input.content_mode != "local_only"
                || task.input.client_reference_id.is_nil()
                || !valid_contract_timestamp(&task.created_at)
                || !valid_contract_timestamp(&task.updated_at)
            {
                return Err(NativeAuthError::ResponseRejected);
            }
            return Ok(PublicTaskTransportOutcome::Created(PublicTaskV2 {
                id: task.id,
                tenant_id: task.tenant_id,
                created_by_user_id: task.created_by_user_id,
                client_reference_id: task.input.client_reference_id,
            }));
        }
        let error: TaskV2ErrorResponse =
            serde_json::from_slice(&bytes).map_err(|_| NativeAuthError::ResponseRejected)?;
        let code = match error.code.as_str() {
            "invalid_request" => PublicTaskErrorCode::InvalidRequest,
            "invalid_tenant_context" => PublicTaskErrorCode::InvalidTenantContext,
            "unauthenticated" => PublicTaskErrorCode::Unauthenticated,
            "access_denied" => PublicTaskErrorCode::AccessDenied,
            "idempotency_conflict" => PublicTaskErrorCode::IdempotencyConflict,
            "authorization_unavailable" => PublicTaskErrorCode::AuthorizationUnavailable,
            "internal_error" => PublicTaskErrorCode::InternalError,
            _ => return Err(NativeAuthError::ResponseRejected),
        };
        if !error_code_matches_status(status, code) {
            return Err(NativeAuthError::ResponseRejected);
        }
        Ok(PublicTaskTransportOutcome::Rejected { status, code })
    }

    async fn execute(
        &self,
        operation: Operation,
        access_token: &SecretValue,
    ) -> Result<OperationResponse, NativeAuthError> {
        let (path, tenant_id) = operation.request_parts();
        let url = self
            .api_origin
            .join(path.trim_start_matches('/'))
            .map_err(|_| NativeAuthError::InvalidConfiguration)?;
        if url.scheme() != "https"
            || url.origin() != self.api_origin.origin()
            || url.path() != path
            || url.query().is_some()
        {
            return Err(NativeAuthError::InvalidConfiguration);
        }

        let mut request = self
            .http
            .get(url)
            .header(ACCEPT, "application/json")
            .bearer_auth(access_token.expose());
        if let Some(tenant_id) = tenant_id {
            request = request.header(TENANT_HEADER, tenant_id);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| NativeAuthError::TransportFailed)?;
        let status = response.status().as_u16();
        validate_response_headers(&response, status)?;
        if !operation.accepts_status(status) {
            return Err(NativeAuthError::ResponseRejected);
        }
        if response
            .content_length()
            .is_some_and(|size| size as usize > MAX_RESPONSE_BYTES)
        {
            return Err(NativeAuthError::ResponseRejected);
        }

        let cache_control =
            header_value(&response, CACHE_CONTROL)?.ok_or(NativeAuthError::ResponseRejected)?;
        let www_authenticate = header_value(&response, WWW_AUTHENTICATE)?;
        let retry_after = header_value(&response, RETRY_AFTER)?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| NativeAuthError::TransportFailed)?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(NativeAuthError::ResponseRejected);
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: Value =
            serde_json::from_slice(&bytes).map_err(|_| NativeAuthError::ResponseRejected)?;
        if !body.is_object() || contains_forbidden_secret_key(&body) {
            return Err(NativeAuthError::ResponseRejected);
        }
        Ok(OperationResponse {
            status,
            cache_control,
            www_authenticate,
            retry_after,
            body,
        })
    }
}

fn error_code_matches_status(status: u16, code: PublicTaskErrorCode) -> bool {
    match status {
        400 => matches!(
            code,
            PublicTaskErrorCode::InvalidRequest | PublicTaskErrorCode::InvalidTenantContext
        ),
        401 => code == PublicTaskErrorCode::Unauthenticated,
        403 => code == PublicTaskErrorCode::AccessDenied,
        409 => code == PublicTaskErrorCode::IdempotencyConflict,
        500 => code == PublicTaskErrorCode::InternalError,
        503 => code == PublicTaskErrorCode::AuthorizationUnavailable,
        _ => false,
    }
}

fn valid_contract_timestamp(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 64
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && (value.ends_with('Z')
            || value
                .get(value.len().saturating_sub(6)..)
                .is_some_and(|suffix| {
                    matches!(suffix.as_bytes().first(), Some(b'+') | Some(b'-'))
                        && suffix.as_bytes().get(3) == Some(&b':')
                }))
}

fn contains_forbidden_secret_key(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "access_token" | "refresh_token" | "id_token" | "authorization" | "set-cookie"
            ) || contains_forbidden_secret_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_secret_key),
        _ => false,
    }
}

impl Operation {
    fn request_parts(&self) -> (&'static str, Option<String>) {
        match self {
            Self::ListMyTenants => (TENANTS_PATH, None),
            Self::GetMyCapabilities(tenant_id) => {
                (CAPABILITIES_PATH, Some(tenant_id.hyphenated().to_string()))
            }
        }
    }

    fn accepts_status(&self, status: u16) -> bool {
        match self {
            Self::ListMyTenants => matches!(status, 200 | 401 | 403 | 500 | 503),
            Self::GetMyCapabilities(_) => matches!(status, 200 | 400 | 401 | 403 | 500 | 503),
        }
    }
}

fn parse_canonical_tenant_id(value: &str) -> Result<Uuid, NativeAuthError> {
    let tenant_id = Uuid::parse_str(value).map_err(|_| NativeAuthError::InvalidTenant)?;
    if tenant_id.is_nil() || tenant_id.hyphenated().to_string() != value {
        return Err(NativeAuthError::InvalidTenant);
    }
    Ok(tenant_id)
}

fn validate_response_headers(
    response: &reqwest::Response,
    status: u16,
) -> Result<(), NativeAuthError> {
    let content_type =
        header_value(response, CONTENT_TYPE)?.ok_or(NativeAuthError::ResponseRejected)?;
    if content_type != "application/json" {
        return Err(NativeAuthError::ResponseRejected);
    }
    if header_value(response, CACHE_CONTROL)?.as_deref() != Some("no-store") {
        return Err(NativeAuthError::ResponseRejected);
    }
    match (status, header_value(response, WWW_AUTHENTICATE)?) {
        (401, Some(value)) if value == "Bearer" => {}
        (401, _) | (_, Some(_)) => return Err(NativeAuthError::ResponseRejected),
        _ => {}
    }
    match (status, header_value(response, RETRY_AFTER)?) {
        (503, Some(value)) if value == "1" => {}
        (503, _) | (_, Some(_)) => return Err(NativeAuthError::ResponseRejected),
        _ => {}
    }
    Ok(())
}

fn header_value(
    response: &reqwest::Response,
    name: reqwest::header::HeaderName,
) -> Result<Option<String>, NativeAuthError> {
    let values: Vec<_> = response.headers().get_all(name).iter().collect();
    if values.len() > 1 {
        return Err(NativeAuthError::ResponseRejected);
    }
    values
        .first()
        .map(|value| {
            let value = value
                .to_str()
                .map_err(|_| NativeAuthError::ResponseRejected)?;
            if value.len() > 256 {
                return Err(NativeAuthError::ResponseRejected);
            }
            Ok(value.to_owned())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_scope_is_fixed_to_two_get_paths() {
        assert_eq!(
            Operation::ListMyTenants.request_parts(),
            (TENANTS_PATH, None)
        );
        let tenant = Uuid::parse_str("3f4a7dd2-6afb-4db3-a012-d490862c90b0").unwrap();
        assert_eq!(
            Operation::GetMyCapabilities(tenant).request_parts(),
            (
                CAPABILITIES_PATH,
                Some("3f4a7dd2-6afb-4db3-a012-d490862c90b0".to_owned())
            )
        );
    }

    #[test]
    fn tenant_header_requires_non_nil_lowercase_canonical_uuid() {
        assert!(parse_canonical_tenant_id("3f4a7dd2-6afb-4db3-a012-d490862c90b0").is_ok());
        for invalid in [
            "3F4A7DD2-6AFB-4DB3-A012-D490862C90B0",
            "00000000-0000-0000-0000-000000000000",
            "not-a-uuid",
            "3f4a7dd26afb4db3a012d490862c90b0",
        ] {
            assert_eq!(
                parse_canonical_tenant_id(invalid),
                Err(NativeAuthError::InvalidTenant)
            );
        }
    }

    #[test]
    fn status_allowlist_matches_authoritative_contract() {
        let tenant = Uuid::parse_str("3f4a7dd2-6afb-4db3-a012-d490862c90b0").unwrap();
        for status in [200, 401, 403, 500, 503] {
            assert!(Operation::ListMyTenants.accepts_status(status));
        }
        assert!(!Operation::ListMyTenants.accepts_status(400));
        assert!(Operation::GetMyCapabilities(tenant).accepts_status(400));
        for rejected in [201, 204, 301, 302, 404, 429, 502] {
            assert!(!Operation::ListMyTenants.accepts_status(rejected));
            assert!(!Operation::GetMyCapabilities(tenant).accepts_status(rejected));
        }
    }

    #[test]
    fn response_body_rejects_token_bearing_keys_at_any_depth() {
        assert!(!contains_forbidden_secret_key(&serde_json::json!({
            "tenant_id": "3f4a7dd2-6afb-4db3-a012-d490862c90b0",
            "capabilities": ["settings.read"]
        })));
        assert!(contains_forbidden_secret_key(&serde_json::json!({
            "nested": [{"refresh_token": "must-not-cross-ipc"}]
        })));
    }

    #[test]
    fn public_task_request_is_closed_and_content_free() {
        let client_reference_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f99").unwrap();
        let value = serde_json::to_value(CreateTaskV2Request {
            task_type: "conversation",
            input: TaskContentReferenceV2 {
                schema_version: 1,
                content_mode: "local_only",
                client_reference_id,
            },
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "task_type": "conversation",
                "input": {
                    "schema_version": 1,
                    "content_mode": "local_only",
                    "client_reference_id": client_reference_id,
                }
            })
        );
        let serialized = value.to_string().to_ascii_lowercase();
        for forbidden in [
            "prompt",
            "message",
            "assistant",
            "reasoning",
            "title",
            "project",
            "path",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn public_task_error_matrix_and_timestamps_fail_closed() {
        for (status, code) in [
            (400, PublicTaskErrorCode::InvalidRequest),
            (400, PublicTaskErrorCode::InvalidTenantContext),
            (401, PublicTaskErrorCode::Unauthenticated),
            (403, PublicTaskErrorCode::AccessDenied),
            (409, PublicTaskErrorCode::IdempotencyConflict),
            (500, PublicTaskErrorCode::InternalError),
            (503, PublicTaskErrorCode::AuthorizationUnavailable),
        ] {
            assert!(error_code_matches_status(status, code));
        }
        assert!(!error_code_matches_status(
            401,
            PublicTaskErrorCode::AccessDenied
        ));
        assert!(!error_code_matches_status(
            429,
            PublicTaskErrorCode::AuthorizationUnavailable
        ));
        assert!(valid_contract_timestamp("2026-08-04T12:30:45Z"));
        assert!(valid_contract_timestamp("2026-08-04T12:30:45+08:00"));
        for invalid in [
            "",
            "2026-08-04",
            "2026-08-04 12:30:45Z",
            "2026-08-04T12:30:45+0800",
        ] {
            assert!(!valid_contract_timestamp(invalid));
        }
    }
}
