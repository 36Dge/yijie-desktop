use super::host_domain::{
    parse_cleanup_reason, parse_cleanup_surface, parse_host_error_code, protocol_error,
    HostBridgeError, HostBridgeErrorKind, HostCleanupOutcome, HostCleanupSurfaces, HostErrorCode,
    HostEvent, HostEventCursor, HostSession, HostSessionFailure, HostSessionState, SseDecoder,
};
use super::sidecar::HostConnection;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::fmt::{Debug, Formatter};
use std::fs::OpenOptions;
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_ERROR_MESSAGE_BYTES: usize = 8 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Default, Serialize)]
pub struct HostTrace {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
}

impl Debug for HostTrace {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostTrace")
            .field("trace_id_present", &self.trace_id.is_some())
            .field("request_id_present", &self.request_id.is_some())
            .field("tenant_id_present", &self.tenant_id.is_some())
            .field("user_id_present", &self.user_id.is_some())
            .finish()
    }
}

pub struct HostBridge {
    origin: Url,
    token_path: PathBuf,
    expected_nonce: String,
    client: Client,
}

impl Debug for HostBridge {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostBridge")
            .field("origin", &self.origin)
            .field("token_path", &"[OWNER_ONLY_TOKEN_PATH]")
            .field("expected_nonce", &"[INSTANCE_NONCE]")
            .finish()
    }
}

pub struct HostEventStream {
    response: Response,
    decoder: SseDecoder,
    finished: bool,
}

impl Debug for HostEventStream {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostEventStream")
            .field("finished", &self.finished)
            .finish()
    }
}

impl HostEventStream {
    pub async fn next_event(&mut self) -> Result<Option<HostEvent>, HostBridgeError> {
        if let Some(event) = self.decoder.next() {
            return Ok(Some(event));
        }
        if self.finished {
            return Ok(None);
        }
        loop {
            match self.response.chunk().await.map_err(|_| transport_error())? {
                Some(chunk) => {
                    self.decoder.push(&chunk)?;
                    if let Some(event) = self.decoder.next() {
                        return Ok(Some(event));
                    }
                }
                None => {
                    self.decoder.finish()?;
                    self.finished = true;
                    return Ok(None);
                }
            }
        }
    }
}

#[derive(Serialize)]
struct StartSessionRequest<'a> {
    #[serde(flatten)]
    trace: &'a HostTrace,
    cwd: &'a str,
}

#[derive(Serialize)]
struct TraceRequest<'a> {
    #[serde(flatten)]
    trace: &'a HostTrace,
}

#[derive(Serialize)]
struct StartTurnRequest<'a> {
    #[serde(flatten)]
    trace: &'a HostTrace,
    input: &'a str,
}

#[derive(Serialize)]
struct CleanupRequest<'a> {
    operation_id: Uuid,
    #[serde(flatten)]
    trace: &'a HostTrace,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadyResponse {
    status: String,
    runtime_state: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionEnvelope {
    session: WireSession,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSession {
    task_id: String,
    agent_session_id: String,
    codex_thread_id: String,
    active_turn_id: String,
    state: String,
    cwd: String,
    model: String,
    model_provider: String,
    failure_code: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StartTurnResponse {
    turn_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ErrorEnvelope {
    error: WireError,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireError {
    code: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CleanupCompleteResponse {
    operation_id: String,
    outcome: String,
    surfaces: WireCleanupSurfaces,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CleanupIncompleteResponse {
    operation_id: String,
    outcome: String,
    surfaces: WireCleanupSurfaces,
    error: CleanupIncompleteError,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireCleanupSurfaces {
    runtime_thread_tree: String,
    host_mapping: String,
    host_replay: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CleanupIncompleteError {
    code: String,
    reason_code: String,
    message: String,
}

struct HostToken(Zeroizing<String>);

impl HostToken {
    fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl Debug for HostToken {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("HostToken([REDACTED])")
    }
}

impl HostBridge {
    pub(super) fn from_connection(connection: HostConnection) -> Result<Self, HostBridgeError> {
        if connection.port == 0
            || !connection.token_path.is_absolute()
            || parse_required_uuid(&connection.instance_nonce).is_err()
        {
            return Err(configuration_error());
        }
        let origin = Url::parse(&format!("http://127.0.0.1:{}/", connection.port))
            .map_err(|_| configuration_error())?;
        if origin.scheme() != "http"
            || origin.host_str() != Some("127.0.0.1")
            || origin.port() != Some(connection.port)
            || origin.username() != ""
            || origin.password().is_some()
        {
            return Err(configuration_error());
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .tcp_nodelay(true)
            .build()
            .map_err(|_| configuration_error())?;
        Ok(Self {
            origin,
            token_path: connection.token_path,
            expected_nonce: connection.instance_nonce,
            client,
        })
    }

    pub async fn start_session(
        &self,
        task_id: Uuid,
        cwd: &Path,
        trace: &HostTrace,
    ) -> Result<HostSession, HostBridgeError> {
        require_non_nil(task_id)?;
        validate_trace(trace)?;
        if !cwd.is_absolute() {
            return Err(configuration_error());
        }
        let cwd = cwd.to_str().ok_or_else(configuration_error)?;
        if cwd.is_empty() || cwd.contains('\0') {
            return Err(configuration_error());
        }
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/tasks/{task_id}/agent-sessions"),
                &StartSessionRequest { trace, cwd },
            )
            .await?;
        parse_session_response(response, StatusCode::CREATED).await
    }

    pub async fn resume_session(
        &self,
        session_id: Uuid,
        trace: &HostTrace,
    ) -> Result<HostSession, HostBridgeError> {
        require_non_nil(session_id)?;
        validate_trace(trace)?;
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/agent-sessions/{session_id}/resume"),
                &TraceRequest { trace },
            )
            .await?;
        parse_session_response(response, StatusCode::OK).await
    }

    pub async fn get_session(&self, session_id: Uuid) -> Result<HostSession, HostBridgeError> {
        require_non_nil(session_id)?;
        let response = self
            .authorized_request(Method::GET, &format!("/v1/agent-sessions/{session_id}"))
            .await?
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        parse_session_response(response, StatusCode::OK).await
    }

    pub async fn start_turn(
        &self,
        session_id: Uuid,
        input: &str,
        trace: &HostTrace,
    ) -> Result<Uuid, HostBridgeError> {
        require_non_nil(session_id)?;
        validate_trace(trace)?;
        if input.trim().is_empty() || input.len() > MAX_JSON_BYTES || input.contains('\0') {
            return Err(protocol_error());
        }
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/agent-sessions/{session_id}/turns"),
                &StartTurnRequest { trace, input },
            )
            .await?;
        let response = expect_json_status(response, StatusCode::ACCEPTED).await?;
        let wire: StartTurnResponse =
            serde_json::from_slice(&response).map_err(|_| protocol_error())?;
        parse_required_uuid(&wire.turn_id)
    }

    pub async fn interrupt_turn(
        &self,
        session_id: Uuid,
        turn_id: Uuid,
        trace: &HostTrace,
    ) -> Result<(), HostBridgeError> {
        require_non_nil(session_id)?;
        require_non_nil(turn_id)?;
        validate_trace(trace)?;
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/agent-sessions/{session_id}/turns/{turn_id}/interrupt"),
                &TraceRequest { trace },
            )
            .await?;
        if response.status() != StatusCode::NO_CONTENT {
            return Err(parse_rejection(response).await);
        }
        validate_no_store(response.headers())?;
        let body = read_limited(response, 1).await?;
        if !body.is_empty() {
            return Err(protocol_error());
        }
        Ok(())
    }

    pub async fn cleanup_session(
        &self,
        session_id: Uuid,
        operation_id: Uuid,
        trace: &HostTrace,
    ) -> Result<HostCleanupOutcome, HostBridgeError> {
        require_non_nil(session_id)?;
        require_non_nil(operation_id)?;
        validate_trace(trace)?;
        let response = self
            .send_json(
                Method::POST,
                &format!("/v2/agent-sessions/{session_id}/cleanup-operations"),
                &CleanupRequest {
                    operation_id,
                    trace,
                },
            )
            .await?;
        match response.status() {
            StatusCode::OK => {
                let body = read_json_body(response).await?;
                let wire: CleanupCompleteResponse =
                    serde_json::from_slice(&body).map_err(|_| protocol_error())?;
                let response_operation = parse_required_uuid(&wire.operation_id)?;
                if response_operation != operation_id
                    || wire.outcome != "complete"
                    || parse_cleanup_surface(&wire.surfaces.runtime_thread_tree)?
                        != super::host_domain::HostCleanupSurfaceStatus::Complete
                    || parse_cleanup_surface(&wire.surfaces.host_mapping)?
                        != super::host_domain::HostCleanupSurfaceStatus::Complete
                    || parse_cleanup_surface(&wire.surfaces.host_replay)?
                        != super::host_domain::HostCleanupSurfaceStatus::Complete
                {
                    return Err(protocol_error());
                }
                Ok(HostCleanupOutcome::Complete { operation_id })
            }
            StatusCode::CONFLICT => {
                let body = read_json_body(response).await?;
                if let Ok(wire) = serde_json::from_slice::<CleanupIncompleteResponse>(&body) {
                    let response_operation = parse_required_uuid(&wire.operation_id)?;
                    validate_error_message(&wire.error.message)?;
                    if response_operation != operation_id
                        || wire.outcome != "incomplete"
                        || wire.error.code != "cleanup_incomplete"
                    {
                        return Err(protocol_error());
                    }
                    return Ok(HostCleanupOutcome::Incomplete {
                        operation_id,
                        surfaces: HostCleanupSurfaces {
                            runtime_thread_tree: parse_cleanup_surface(
                                &wire.surfaces.runtime_thread_tree,
                            )?,
                            host_mapping: parse_cleanup_surface(&wire.surfaces.host_mapping)?,
                            host_replay: parse_cleanup_surface(&wire.surfaces.host_replay)?,
                        },
                        reason: parse_cleanup_reason(&wire.error.reason_code)?,
                    });
                }
                Err(parse_rejection_body(StatusCode::CONFLICT, &body))
            }
            _ => Err(parse_rejection(response).await),
        }
    }

    pub async fn open_event_stream_v2(
        &self,
        session_id: Uuid,
        cursor: Option<HostEventCursor>,
    ) -> Result<HostEventStream, HostBridgeError> {
        require_non_nil(session_id)?;
        let mut request = self
            .authorized_request(
                Method::GET,
                &format!("/v2/agent-sessions/{session_id}/events?event_schema_version=2"),
            )
            .await?;
        if let Some(cursor) = cursor {
            let value = HeaderValue::from_str(&format!("{}:{}", cursor.stream_id, cursor.sequence))
                .map_err(|_| protocol_error())?;
            request = request.header("Last-Event-ID", value);
        }
        let response = request.send().await.map_err(|_| transport_error())?;
        if response.status() != StatusCode::OK {
            return Err(parse_rejection(response).await);
        }
        validate_no_store(response.headers())?;
        if header_text(response.headers(), CONTENT_TYPE)? != "text/event-stream"
            || header_text_name(response.headers(), "X-Accel-Buffering")? != "no"
            || header_text_name(response.headers(), "X-Yijie-Event-Schema-Version")? != "2"
        {
            return Err(protocol_error());
        }
        let stream_id = parse_required_uuid(header_text_name(
            response.headers(),
            "X-Yijie-Event-Stream-ID",
        )?)?;
        let last_sequence = match cursor {
            Some(cursor) if cursor.stream_id == stream_id => cursor.sequence,
            Some(_) => return Err(protocol_error()),
            None => 0,
        };
        Ok(HostEventStream {
            response,
            decoder: SseDecoder::new(stream_id, last_sequence),
            finished: false,
        })
    }

    async fn send_json<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path_and_query: &str,
        payload: &T,
    ) -> Result<Response, HostBridgeError> {
        let body = serde_json::to_vec(payload).map_err(|_| protocol_error())?;
        if body.len() > MAX_JSON_BYTES {
            return Err(protocol_error());
        }
        self.authorized_request(method, path_and_query)
            .await?
            .header(CONTENT_TYPE, "application/json")
            .timeout(REQUEST_TIMEOUT)
            .body(body)
            .send()
            .await
            .map_err(|_| transport_error())
    }

    async fn authorized_request(
        &self,
        method: Method,
        path_and_query: &str,
    ) -> Result<reqwest::RequestBuilder, HostBridgeError> {
        self.ensure_ready().await?;
        let token_path = self.token_path.clone();
        let token = tokio::task::spawn_blocking(move || load_owner_token(&token_path))
            .await
            .map_err(|_| token_error())??;
        let mut authorization = Zeroizing::new(String::with_capacity(7 + token.expose().len()));
        authorization.push_str("Bearer ");
        authorization.push_str(token.expose());
        let authorization =
            HeaderValue::from_str(authorization.as_str()).map_err(|_| token_error())?;
        Ok(self
            .client
            .request(method, self.exact_url(path_and_query)?)
            .header(AUTHORIZATION, authorization))
    }

    async fn ensure_ready(&self) -> Result<(), HostBridgeError> {
        let response = self
            .client
            .get(self.exact_url("/readyz")?)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        let nonce = header_text_name(response.headers(), "X-Yijie-Host-Instance-Nonce")
            .map_err(|_| instance_error())?;
        if nonce != self.expected_nonce {
            return Err(instance_error());
        }
        validate_no_store(response.headers())?;
        if header_text(response.headers(), CONTENT_TYPE)? != "application/json" {
            return Err(protocol_error());
        }
        if response.status() != StatusCode::OK {
            let _ = read_limited(response, MAX_JSON_BYTES).await?;
            return Err(HostBridgeError::new(HostBridgeErrorKind::NotReady));
        }
        let body = read_limited(response, 1024).await?;
        let ready: ReadyResponse = serde_json::from_slice(&body).map_err(|_| protocol_error())?;
        if ready.status != "ready" || ready.runtime_state != "ready" {
            return Err(HostBridgeError::new(HostBridgeErrorKind::NotReady));
        }
        Ok(())
    }

    fn exact_url(&self, path_and_query: &str) -> Result<Url, HostBridgeError> {
        if !path_and_query.starts_with('/')
            || path_and_query.starts_with("//")
            || path_and_query.contains('#')
            || path_and_query.contains('\r')
            || path_and_query.contains('\n')
        {
            return Err(configuration_error());
        }
        let mut url = self.origin.clone();
        let (path, query) = match path_and_query.split_once('?') {
            Some((path, query)) if !query.is_empty() && !query.contains('?') => (path, Some(query)),
            Some(_) => return Err(configuration_error()),
            None => (path_and_query, None),
        };
        url.set_path(path);
        url.set_query(query);
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return Err(configuration_error());
        }
        Ok(url)
    }
}

async fn parse_session_response(
    response: Response,
    expected_status: StatusCode,
) -> Result<HostSession, HostBridgeError> {
    let body = expect_json_status(response, expected_status).await?;
    let wire: SessionEnvelope = serde_json::from_slice(&body).map_err(|_| protocol_error())?;
    wire.session.try_into()
}

impl TryFrom<WireSession> for HostSession {
    type Error = HostBridgeError;

    fn try_from(wire: WireSession) -> Result<Self, Self::Error> {
        if wire.cwd.is_empty()
            || !Path::new(&wire.cwd).is_absolute()
            || wire.cwd.contains('\0')
            || wire.created_at.is_empty()
            || wire.created_at.len() > 64
            || wire.updated_at.is_empty()
            || wire.updated_at.len() > 64
        {
            return Err(protocol_error());
        }
        let model_ready = match (wire.model.as_str(), wire.model_provider.as_str()) {
            ("", "") => false,
            ("MiniMax-M3", "minimax") => true,
            _ => return Err(protocol_error()),
        };
        let failure_code = match wire.failure_code.as_str() {
            "" => None,
            "thread_start_failed" => Some(HostSessionFailure::ThreadStartFailed),
            "thread_start_response_invalid" => Some(HostSessionFailure::ThreadStartResponseInvalid),
            "provider_identity_mismatch" => Some(HostSessionFailure::ProviderIdentityMismatch),
            "thread_resume_failed" => Some(HostSessionFailure::ThreadResumeFailed),
            "thread_resume_response_invalid" => {
                Some(HostSessionFailure::ThreadResumeResponseInvalid)
            }
            "turn_start_failed" => Some(HostSessionFailure::TurnStartFailed),
            "turn_start_response_invalid" => Some(HostSessionFailure::TurnStartResponseInvalid),
            _ => return Err(protocol_error()),
        };
        let state = match wire.state.as_str() {
            "starting" => HostSessionState::Starting,
            "idle" => HostSessionState::Idle,
            "active" => HostSessionState::Active,
            "failed" => HostSessionState::Failed,
            _ => return Err(protocol_error()),
        };
        Ok(HostSession {
            task_id: parse_required_uuid(&wire.task_id)?,
            agent_session_id: parse_required_uuid(&wire.agent_session_id)?,
            codex_thread_id: parse_optional_uuid(&wire.codex_thread_id)?,
            active_turn_id: parse_optional_uuid(&wire.active_turn_id)?,
            state,
            cwd: PathBuf::from(wire.cwd),
            model_ready,
            failure_code,
            created_at: wire.created_at,
            updated_at: wire.updated_at,
        })
    }
}

async fn expect_json_status(
    response: Response,
    expected_status: StatusCode,
) -> Result<Vec<u8>, HostBridgeError> {
    if response.status() != expected_status {
        return Err(parse_rejection(response).await);
    }
    read_json_body(response).await
}

async fn read_json_body(response: Response) -> Result<Vec<u8>, HostBridgeError> {
    validate_no_store(response.headers())?;
    if header_text(response.headers(), CONTENT_TYPE)? != "application/json" {
        return Err(protocol_error());
    }
    let body = read_limited(response, MAX_JSON_BYTES).await?;
    if body.is_empty() {
        return Err(protocol_error());
    }
    Ok(body)
}

async fn parse_rejection(response: Response) -> HostBridgeError {
    let status = response.status();
    let body = match read_json_body(response).await {
        Ok(body) => body,
        Err(error) => return error,
    };
    parse_rejection_body(status, &body)
}

fn parse_rejection_body(status: StatusCode, body: &[u8]) -> HostBridgeError {
    let Ok(wire) = serde_json::from_slice::<ErrorEnvelope>(body) else {
        return protocol_error();
    };
    if validate_error_message(&wire.error.message).is_err() {
        return protocol_error();
    }
    let code = parse_host_error_code(&wire.error.code);
    let status_matches = match status {
        StatusCode::BAD_REQUEST => {
            matches!(
                code,
                HostErrorCode::InvalidRequest | HostErrorCode::InvalidEventCursor
            )
        }
        StatusCode::UNAUTHORIZED => code == HostErrorCode::Unauthorized,
        StatusCode::NOT_FOUND => code == HostErrorCode::SessionNotFound,
        StatusCode::CONFLICT => matches!(
            code,
            HostErrorCode::TaskSessionExists
                | HostErrorCode::TurnActive
                | HostErrorCode::TurnNotActive
                | HostErrorCode::SessionNotUsable
                | HostErrorCode::EventStreamChanged
                | HostErrorCode::EventReplayUnavailable
                | HostErrorCode::CleanupOperationConflict
        ),
        StatusCode::INTERNAL_SERVER_ERROR => {
            matches!(
                code,
                HostErrorCode::InternalError | HostErrorCode::StreamingUnsupported
            )
        }
        StatusCode::BAD_GATEWAY => code == HostErrorCode::RuntimeRequestFailed,
        _ => false,
    };
    if status_matches {
        HostBridgeError::rejected(code)
    } else {
        protocol_error()
    }
}

async fn read_limited(mut response: Response, limit: usize) -> Result<Vec<u8>, HostBridgeError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(protocol_error());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| transport_error())? {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(protocol_error());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validate_no_store(headers: &HeaderMap) -> Result<(), HostBridgeError> {
    if header_text(headers, CACHE_CONTROL)? != "no-store" {
        return Err(protocol_error());
    }
    Ok(())
}

fn header_text(
    headers: &HeaderMap,
    name: reqwest::header::HeaderName,
) -> Result<&str, HostBridgeError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(protocol_error)
}

fn header_text_name<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, HostBridgeError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(protocol_error)
}

fn validate_trace(trace: &HostTrace) -> Result<(), HostBridgeError> {
    for value in [
        trace.trace_id,
        trace.request_id,
        trace.tenant_id,
        trace.user_id,
    ]
    .into_iter()
    .flatten()
    {
        require_non_nil(value)?;
    }
    Ok(())
}

fn validate_error_message(value: &str) -> Result<(), HostBridgeError> {
    if value.is_empty()
        || value.len() > MAX_ERROR_MESSAGE_BYTES
        || value.contains('\r')
        || value.contains('\0')
    {
        return Err(protocol_error());
    }
    Ok(())
}

fn parse_optional_uuid(value: &str) -> Result<Option<Uuid>, HostBridgeError> {
    if value.is_empty() {
        return Ok(None);
    }
    parse_required_uuid(value).map(Some)
}

fn parse_required_uuid(value: &str) -> Result<Uuid, HostBridgeError> {
    let value = Uuid::parse_str(value).map_err(|_| protocol_error())?;
    require_non_nil(value)?;
    Ok(value)
}

fn require_non_nil(value: Uuid) -> Result<(), HostBridgeError> {
    if value.is_nil() {
        return Err(protocol_error());
    }
    Ok(())
}

fn load_owner_token(path: &Path) -> Result<HostToken, HostBridgeError> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| token_error())?;
    let metadata = file.metadata().map_err(|_| token_error())?;
    let expected_owner = unsafe { libc::geteuid() };
    if !metadata.file_type().is_file()
        || metadata.uid() != expected_owner
        || metadata.nlink() != 1
        || metadata.mode() & 0o077 != 0
        || metadata.len() > 1024
    {
        return Err(token_error());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(metadata.len() as usize));
    file.by_ref()
        .take(1025)
        .read_to_end(&mut bytes)
        .map_err(|_| token_error())?;
    if bytes.len() > 1024 {
        return Err(token_error());
    }
    let token_bytes = match bytes.as_slice() {
        value if value.len() == 43 => value,
        value if value.len() == 44 && value.last() == Some(&b'\n') => &value[..43],
        _ => return Err(token_error()),
    };
    if !token_bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-' || *byte == b'_')
    {
        return Err(token_error());
    }
    let token = std::str::from_utf8(token_bytes).map_err(|_| token_error())?;
    Ok(HostToken(Zeroizing::new(token.to_owned())))
}

const fn configuration_error() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::InvalidConfiguration)
}

const fn token_error() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::TokenUnavailable)
}

const fn instance_error() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::InstanceMismatch)
}

const fn transport_error() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::Transport)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const NONCE: &str = "019fbd88-cbc3-7bf1-934d-7b05cd693f80";
    const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    struct TestToken {
        directory: PathBuf,
        path: PathBuf,
    }

    impl TestToken {
        fn new(mode: u32) -> Self {
            let directory =
                std::env::temp_dir().join(format!("yijie-host-bridge-test-{}", Uuid::now_v7()));
            fs::create_dir(&directory).unwrap();
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
            let path = directory.join("api-token");
            fs::write(&path, format!("{TOKEN}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
            Self { directory, path }
        }
    }

    impl Drop for TestToken {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    fn response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        for (name, value) in headers {
            response.push_str(name);
            response.push_str(": ");
            response.push_str(value);
            response.push_str("\r\n");
        }
        response.push_str("\r\n");
        response.push_str(body);
        response
    }

    fn ready_response(nonce: &str) -> String {
        response(
            "200 OK",
            &[
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
                ("X-Yijie-Host-Instance-Nonce", nonce),
            ],
            r#"{"status":"ready","runtime_state":"ready"}"#,
        )
    }

    fn json_response(status: &str, body: &str) -> String {
        response(
            status,
            &[
                ("Content-Type", "application/json"),
                ("Cache-Control", "no-store"),
            ],
            body,
        )
    }

    async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        loop {
            let count = stream.read(&mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            let Some(headers_end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") else {
                continue;
            };
            let header_text = std::str::from_utf8(&bytes[..headers_end]).unwrap();
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|value| value.parse::<usize>().ok())
                })
                .unwrap_or(0);
            if bytes.len() >= headers_end + 4 + content_length {
                break;
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    async fn serve(responses: Vec<String>) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                requests.push(read_request(&mut stream).await);
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            requests
        });
        (port, task)
    }

    fn bridge(port: u16, token_path: PathBuf, nonce: &str) -> HostBridge {
        HostBridge::from_connection(HostConnection {
            port,
            token_path,
            instance_nonce: nonce.to_owned(),
        })
        .unwrap()
    }

    fn session_body() -> String {
        serde_json::json!({
            "session": {
                "task_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f21",
                "agent_session_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f22",
                "codex_thread_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f23",
                "active_turn_id": "",
                "state": "idle",
                "cwd": "/private/tmp/project-secret",
                "model": "MiniMax-M3",
                "model_provider": "minimax",
                "failure_code": "",
                "created_at": "2026-08-02T10:00:00Z",
                "updated_at": "2026-08-02T10:00:01Z"
            }
        })
        .to_string()
    }

    #[tokio::test]
    async fn exact_loopback_preflight_and_owner_token_guard_session_calls() {
        let token = TestToken::new(0o600);
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response("200 OK", &session_body()),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        let session = bridge.get_session(session_id).await.unwrap();
        assert_eq!(session.agent_session_id, session_id);
        assert!(session.model_ready);
        let debug = format!("{session:?}");
        assert!(!debug.contains("project-secret"));

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /readyz HTTP/1.1"));
        assert!(!requests[0].contains("Authorization:"));
        assert!(requests[1].starts_with(&format!("GET /v1/agent-sessions/{session_id} HTTP/1.1")));
        assert!(requests[1].to_ascii_lowercase().contains(&format!(
            "authorization: bearer {}",
            TOKEN.to_ascii_lowercase()
        )));
        assert!(!format!("{bridge:?}").contains(TOKEN));
    }

    #[tokio::test]
    async fn lifecycle_requests_are_text_only_and_offer_no_model_or_effort_selector() {
        let token = TestToken::new(0o600);
        let turn_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f24").unwrap();
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response("201 Created", &session_body()),
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": turn_id}).to_string(),
            ),
            ready_response(NONCE),
            response("204 No Content", &[("Cache-Control", "no-store")], ""),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let task_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f21").unwrap();
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        bridge
            .start_session(
                task_id,
                Path::new("/private/tmp/project-secret"),
                &HostTrace::default(),
            )
            .await
            .unwrap();
        assert_eq!(
            bridge
                .start_turn(session_id, "PROMPT_CANARY_126", &HostTrace::default())
                .await
                .unwrap(),
            turn_id
        );
        bridge
            .interrupt_turn(session_id, turn_id, &HostTrace::default())
            .await
            .unwrap();

        let requests = server.await.unwrap();
        assert!(
            requests[1].starts_with(&format!("POST /v1/tasks/{task_id}/agent-sessions HTTP/1.1"))
        );
        assert!(requests[1].contains(r#"{"cwd":"/private/tmp/project-secret"}"#));
        assert!(requests[3].contains(r#"{"input":"PROMPT_CANARY_126"}"#));
        assert!(!requests[3].contains("reasoning_effort"));
        assert!(!requests[3].contains("model"));
        assert!(requests[5].ends_with("\r\n\r\n{}"));
    }

    #[tokio::test]
    async fn nonce_mismatch_fails_before_token_read_or_protected_request() {
        let token = TestToken::new(0o644);
        let (port, server) =
            serve(vec![ready_response("019fbd88-cbc3-7bf1-934d-7b05cd693f81")]).await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let session_id = Uuid::now_v7();
        let error = bridge.get_session(session_id).await.unwrap_err();
        assert_eq!(error.kind(), HostBridgeErrorKind::InstanceMismatch);
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(!requests[0].contains("Authorization:"));
    }

    #[test]
    fn token_reader_rejects_open_permissions_and_symlinks() {
        let open_token = TestToken::new(0o644);
        assert_eq!(
            load_owner_token(&open_token.path).unwrap_err().kind(),
            HostBridgeErrorKind::TokenUnavailable
        );

        let protected = TestToken::new(0o600);
        let link = protected.directory.join("api-token-link");
        symlink(&protected.path, &link).unwrap();
        assert_eq!(
            load_owner_token(&link).unwrap_err().kind(),
            HostBridgeErrorKind::TokenUnavailable
        );
    }

    #[tokio::test]
    async fn v2_stream_requires_schema_headers_cursor_and_redacts_reasoning() {
        let token = TestToken::new(0o600);
        let stream_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f41").unwrap();
        let data = serde_json::json!({
            "schema_version": 2,
            "event_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f42",
            "stream_id": stream_id,
            "sequence": 5,
            "occurred_at": "2026-08-02T10:00:04Z",
            "task_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f21",
            "agent_session_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f22",
            "codex_thread_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f23",
            "turn_id": "019fbd88-cbc3-7bf1-934d-7b05cd693f24",
            "item_id": "reasoning-item",
            "event_type": "item.reasoning_text.delta",
            "terminal": false,
            "payload": {"content_index": 0, "delta": "RAW_REASONING_CANARY_126"}
        });
        let sse_body =
            format!("id: {stream_id}:5\nevent: item.reasoning_text.delta\ndata: {data}\n\n");
        let stream_response = response(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Accel-Buffering", "no"),
                ("X-Yijie-Event-Schema-Version", "2"),
                ("X-Yijie-Event-Stream-ID", stream_id.to_string().as_str()),
            ],
            &sse_body,
        );
        let (port, server) = serve(vec![ready_response(NONCE), stream_response]).await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        let cursor = HostEventCursor::new(stream_id, 4).unwrap();
        let mut stream = bridge
            .open_event_stream_v2(session_id, Some(cursor))
            .await
            .unwrap();
        let event = stream.next_event().await.unwrap().unwrap();
        assert_eq!(event.cursor.sequence, 5);
        assert!(!format!("{event:?}").contains("RAW_REASONING_CANARY_126"));
        assert!(stream.next_event().await.unwrap().is_none());

        let requests = server.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "GET /v2/agent-sessions/{session_id}/events?event_schema_version=2 HTTP/1.1"
        )));
        assert!(requests[1].contains(&format!("last-event-id: {stream_id}:4")));
    }

    #[tokio::test]
    async fn host_error_messages_are_discarded_from_the_domain_error() {
        let token = TestToken::new(0o600);
        let body = r#"{"error":{"code":"session_not_found","message":"RAW_ERROR_CANARY_126"}}"#;
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response("404 Not Found", body),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let error = bridge.get_session(Uuid::now_v7()).await.unwrap_err();
        assert_eq!(error.kind(), HostBridgeErrorKind::Rejected);
        assert_eq!(error.code(), Some(HostErrorCode::SessionNotFound));
        assert!(!format!("{error:?}").contains("RAW_ERROR_CANARY_126"));
        assert!(!error.to_string().contains("RAW_ERROR_CANARY_126"));
        let _ = server.await.unwrap();
    }

    #[tokio::test]
    async fn cleanup_complete_and_incomplete_are_content_free_typed_outcomes() {
        let token = TestToken::new(0o600);
        let complete_operation = Uuid::now_v7();
        let incomplete_operation = Uuid::now_v7();
        let complete = serde_json::json!({
            "operation_id": complete_operation,
            "outcome": "complete",
            "surfaces": {
                "runtime_thread_tree": "complete",
                "host_mapping": "complete",
                "host_replay": "complete"
            }
        })
        .to_string();
        let incomplete = serde_json::json!({
            "operation_id": incomplete_operation,
            "outcome": "incomplete",
            "surfaces": {
                "runtime_thread_tree": "complete",
                "host_mapping": "incomplete",
                "host_replay": "not_attempted"
            },
            "error": {
                "code": "cleanup_incomplete",
                "reason_code": "host_mapping_cleanup_failed",
                "message": "content-free cleanup result"
            }
        })
        .to_string();
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response("200 OK", &complete),
            ready_response(NONCE),
            json_response("409 Conflict", &incomplete),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let session_id = Uuid::now_v7();
        let complete_result = bridge
            .cleanup_session(session_id, complete_operation, &HostTrace::default())
            .await
            .unwrap();
        assert!(matches!(
            complete_result,
            HostCleanupOutcome::Complete { operation_id } if operation_id == complete_operation
        ));
        let incomplete_result = bridge
            .cleanup_session(session_id, incomplete_operation, &HostTrace::default())
            .await
            .unwrap();
        assert!(matches!(
            incomplete_result,
            HostCleanupOutcome::Incomplete {
                operation_id,
                reason: super::super::host_domain::HostCleanupReason::HostMappingCleanupFailed,
                ..
            } if operation_id == incomplete_operation
        ));
        let _ = server.await.unwrap();
    }
}
