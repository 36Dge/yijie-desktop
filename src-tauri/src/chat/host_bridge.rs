use super::artifact::{
    ArtifactCommit, ArtifactKind, ArtifactManifest, DownloadedArtifact, DownloadedResource,
    MAX_ARTIFACT_BYTES, MAX_IMAGE_BYTES,
};
use super::attachment::validate_image_content;
use super::database::HostTurnInputBlock;
use super::host_domain::{
    parse_cleanup_reason, parse_cleanup_surface, parse_host_error_code, protocol_error,
    HostBridgeError, HostBridgeErrorKind, HostCleanupOutcome, HostCleanupSurfaces, HostErrorCode,
    HostEvent, HostEventCursor, HostSession, HostSessionFailure, HostSessionState, HostStreamEvent,
    SseDecoder,
};
use super::sidecar::HostConnection;
use base64::Engine;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT_RANGES, AUTHORIZATION, CACHE_CONTROL, CONTENT_DISPOSITION,
    CONTENT_LENGTH, CONTENT_TYPE, ETAG,
};
use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::{Debug, Formatter};
use std::fs::OpenOptions;
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_TURN_V2_JSON_BYTES: usize = 16 * 1024 * 1024;
const MAX_TURN_V2_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_TURN_V2_FILE_CONTEXT_BYTES: usize = 256 * 1024;
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
        match self.next_stream_event().await? {
            Some(HostStreamEvent::Ordinary(event)) => Ok(Some(event)),
            Some(HostStreamEvent::Artifact(_)) => Err(protocol_error()),
            None => Ok(None),
        }
    }

    pub async fn next_stream_event(&mut self) -> Result<Option<HostStreamEvent>, HostBridgeError> {
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
struct StartTurnV2Request<'a> {
    operation_id: Uuid,
    #[serde(flatten)]
    trace: &'a HostTrace,
    content_blocks: &'a [HostTurnInputBlock],
}

#[derive(Serialize)]
struct CleanupRequest<'a> {
    operation_id: Uuid,
    #[serde(flatten)]
    trace: &'a HostTrace,
}

#[derive(Serialize)]
struct ArtifactAcknowledgementRequest<'a> {
    ack_id: Uuid,
    size_bytes: usize,
    sha256: &'a str,
    local_committed_at: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactAcknowledgementResponse {
    artifact_id: Uuid,
    ack_id: Uuid,
    status: String,
    cleanup_status: String,
    acknowledged_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactAcknowledgement {
    pub artifact_id: Uuid,
    pub ack_id: Uuid,
    pub acknowledged_at: String,
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

    pub async fn start_turn_v2(
        &self,
        session_id: Uuid,
        operation_id: Uuid,
        content_blocks: &[HostTurnInputBlock],
        trace: &HostTrace,
    ) -> Result<Uuid, HostBridgeError> {
        require_non_nil(session_id)?;
        require_non_nil(operation_id)?;
        validate_trace(trace)?;
        validate_turn_v2_blocks(content_blocks)?;
        let response = self
            .send_json_with_limit(
                Method::POST,
                &format!("/v2/agent-sessions/{session_id}/turns"),
                &StartTurnV2Request {
                    operation_id,
                    trace,
                    content_blocks,
                },
                MAX_TURN_V2_JSON_BYTES,
            )
            .await?;
        if response.status() != StatusCode::ACCEPTED {
            return Err(parse_rejection(response).await);
        }
        let response = read_json_body(response)
            .await
            .map_err(|_| accepted_response_invalid())?;
        let wire: StartTurnResponse =
            serde_json::from_slice(&response).map_err(|_| accepted_response_invalid())?;
        parse_required_uuid(&wire.turn_id).map_err(|_| accepted_response_invalid())
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

    async fn open_event_stream(
        &self,
        session_id: Uuid,
        cursor: Option<HostEventCursor>,
        schema_version: u8,
    ) -> Result<HostEventStream, HostBridgeError> {
        require_non_nil(session_id)?;
        if !matches!(schema_version, 2 | 3) {
            return Err(protocol_error());
        }
        let mut request = self
            .authorized_request(
                Method::GET,
                &format!(
                    "/v{schema_version}/agent-sessions/{session_id}/events?event_schema_version={schema_version}"
                ),
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
            || header_text_name(response.headers(), "X-Yijie-Event-Schema-Version")?
                != schema_version.to_string()
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
            decoder: SseDecoder::new(stream_id, last_sequence, schema_version),
            finished: false,
        })
    }

    pub async fn open_event_stream_v2(
        &self,
        session_id: Uuid,
        cursor: Option<HostEventCursor>,
    ) -> Result<HostEventStream, HostBridgeError> {
        self.open_event_stream(session_id, cursor, 2).await
    }

    pub async fn open_event_stream_v3(
        &self,
        session_id: Uuid,
        cursor: Option<HostEventCursor>,
    ) -> Result<HostEventStream, HostBridgeError> {
        self.open_event_stream(session_id, cursor, 3).await
    }

    pub async fn download_artifact(
        &self,
        manifest: &ArtifactManifest,
    ) -> Result<DownloadedArtifact, HostBridgeError> {
        manifest.validate().map_err(|_| protocol_error())?;
        let content = self
            .download_artifact_resource(
                &manifest.content_href,
                Some((&manifest.media_type, manifest.size_bytes, &manifest.sha256)),
                MAX_ARTIFACT_BYTES.min(match manifest.kind {
                    ArtifactKind::Image => MAX_IMAGE_BYTES,
                    ArtifactKind::Video | ArtifactKind::File | ArtifactKind::Report => {
                        MAX_ARTIFACT_BYTES
                    }
                }),
            )
            .await?;
        let poster = match manifest.poster_href.as_deref() {
            Some(href) => Some(
                self.download_artifact_resource(href, None, MAX_IMAGE_BYTES)
                    .await?,
            ),
            None => None,
        };
        Ok(DownloadedArtifact { content, poster })
    }

    pub async fn acknowledge_artifact(
        &self,
        manifest: &ArtifactManifest,
        commit: &ArtifactCommit,
        local_committed_at: &str,
    ) -> Result<ArtifactAcknowledgement, HostBridgeError> {
        manifest.validate().map_err(|_| protocol_error())?;
        if commit.artifact_id != manifest.artifact_id
            || commit.ack_id.is_nil()
            || !valid_rfc3339_utc(local_committed_at)
        {
            return Err(protocol_error());
        }
        let response = self
            .send_json(
                Method::POST,
                &format!(
                    "/v3/agent-sessions/{}/artifacts/{}/ack",
                    manifest.agent_session_id, manifest.artifact_id
                ),
                &ArtifactAcknowledgementRequest {
                    ack_id: commit.ack_id,
                    size_bytes: manifest.size_bytes,
                    sha256: &manifest.sha256,
                    local_committed_at,
                },
            )
            .await?;
        let body = expect_json_status(response, StatusCode::OK).await?;
        let wire: ArtifactAcknowledgementResponse =
            serde_json::from_slice(&body).map_err(|_| protocol_error())?;
        if wire.artifact_id != manifest.artifact_id
            || wire.ack_id != commit.ack_id
            || wire.status != "acknowledged"
            || !matches!(wire.cleanup_status.as_str(), "pending" | "completed")
            || !valid_rfc3339_utc(&wire.acknowledged_at)
        {
            return Err(protocol_error());
        }
        Ok(ArtifactAcknowledgement {
            artifact_id: wire.artifact_id,
            ack_id: wire.ack_id,
            acknowledged_at: wire.acknowledged_at,
        })
    }

    async fn download_artifact_resource(
        &self,
        href: &str,
        expected: Option<(&str, usize, &str)>,
        maximum: usize,
    ) -> Result<DownloadedResource, HostBridgeError> {
        if !href.starts_with("/v3/agent-sessions/") || href.contains('?') {
            return Err(protocol_error());
        }
        let response = self
            .authorized_request(Method::GET, href)
            .await?
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        if response.status() != StatusCode::OK {
            return Err(parse_rejection(response).await);
        }
        validate_no_store(response.headers())?;
        let media_type = header_text(response.headers(), CONTENT_TYPE)?.to_owned();
        let size_bytes = header_text(response.headers(), CONTENT_LENGTH)?
            .parse::<usize>()
            .ok()
            .filter(|value| (1..=maximum).contains(value))
            .ok_or_else(protocol_error)?;
        let etag = header_text(response.headers(), ETAG)?;
        let sha256 = etag
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .filter(|value| valid_sha256(value))
            .ok_or_else(protocol_error)?
            .to_owned();
        let disposition = header_text(response.headers(), CONTENT_DISPOSITION)?;
        if disposition.is_empty()
            || disposition.len() > 512
            || disposition.contains('/')
            || disposition.contains('\\')
            || header_text(response.headers(), ACCEPT_RANGES)? != "bytes"
            || header_text_name(response.headers(), "X-Content-Type-Options")? != "nosniff"
        {
            return Err(protocol_error());
        }
        if let Some((expected_media_type, expected_size, expected_sha256)) = expected {
            if media_type != expected_media_type
                || size_bytes != expected_size
                || sha256 != expected_sha256
            {
                return Err(protocol_error());
            }
        } else if !matches!(
            media_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp"
        ) {
            return Err(protocol_error());
        }
        let bytes = read_limited(response, maximum).await?;
        if bytes.len() != size_bytes || format!("{:x}", Sha256::digest(&bytes)) != sha256 {
            return Err(protocol_error());
        }
        if expected.is_none() && validate_image_content(&media_type, &bytes).is_err() {
            return Err(protocol_error());
        }
        Ok(DownloadedResource {
            media_type,
            size_bytes,
            sha256,
            bytes,
        })
    }

    async fn send_json<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path_and_query: &str,
        payload: &T,
    ) -> Result<Response, HostBridgeError> {
        self.send_json_with_limit(method, path_and_query, payload, MAX_JSON_BYTES)
            .await
    }

    async fn send_json_with_limit<T: Serialize + ?Sized>(
        &self,
        method: Method,
        path_and_query: &str,
        payload: &T,
        limit: usize,
    ) -> Result<Response, HostBridgeError> {
        let body = serde_json::to_vec(payload).map_err(|_| protocol_error())?;
        if body.len() > limit {
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
                | HostErrorCode::TurnOperationConflict
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

fn validate_turn_v2_blocks(blocks: &[HostTurnInputBlock]) -> Result<(), HostBridgeError> {
    if blocks.is_empty() || blocks.len() > 16 {
        return Err(protocol_error());
    }
    let mut attachment_count = 0_usize;
    let mut image_bytes = 0_usize;
    let mut file_context_bytes = 0_usize;
    for block in blocks {
        match block {
            HostTurnInputBlock::Text { text } => {
                if text.trim().is_empty() || text.len() > MAX_JSON_BYTES || text.contains('\0') {
                    return Err(protocol_error());
                }
            }
            HostTurnInputBlock::File {
                attachment_id,
                safe_name,
                media_type,
                size_bytes,
                sha256,
                context_chunks,
            } => {
                attachment_count += 1;
                require_non_nil(*attachment_id)?;
                if !valid_safe_attachment_name(safe_name)
                    || !matches!(
                        media_type.as_str(),
                        "application/pdf"
                            | "text/plain"
                            | "text/markdown"
                            | "text/csv"
                            | "application/json"
                            | "application/yaml"
                            | "application/xml"
                            | "text/html"
                            | "application/rtf"
                            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    )
                    || !(1..=MAX_TURN_V2_ATTACHMENT_BYTES).contains(size_bytes)
                    || !valid_sha256(sha256)
                    || context_chunks.is_empty()
                    || context_chunks.len() > 32
                {
                    return Err(protocol_error());
                }
                for chunk in context_chunks {
                    if chunk.trim().is_empty() || chunk.len() > 16 * 1024 || chunk.contains('\0') {
                        return Err(protocol_error());
                    }
                    file_context_bytes = file_context_bytes
                        .checked_add(chunk.len())
                        .ok_or_else(protocol_error)?;
                }
            }
            HostTurnInputBlock::Image {
                attachment_id,
                media_type,
                size_bytes,
                sha256,
                data_url,
            } => {
                attachment_count += 1;
                require_non_nil(*attachment_id)?;
                if !matches!(
                    media_type.as_str(),
                    "image/jpeg" | "image/png" | "image/webp" | "image/gif"
                ) || !(1..=MAX_TURN_V2_ATTACHMENT_BYTES).contains(size_bytes)
                    || !valid_sha256(sha256)
                {
                    return Err(protocol_error());
                }
                let prefix = format!("data:{media_type};base64,");
                let encoded = data_url.strip_prefix(&prefix).ok_or_else(protocol_error)?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|_| protocol_error())?;
                if bytes.len() != *size_bytes
                    || base64::engine::general_purpose::STANDARD.encode(&bytes) != encoded
                    || format!("{:x}", Sha256::digest(&bytes)) != *sha256
                    || validate_image_content(media_type, &bytes).is_err()
                {
                    return Err(protocol_error());
                }
                image_bytes = image_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(protocol_error)?;
            }
        }
    }
    if attachment_count > 10
        || image_bytes > MAX_TURN_V2_ATTACHMENT_BYTES
        || file_context_bytes > MAX_TURN_V2_FILE_CONTEXT_BYTES
    {
        return Err(protocol_error());
    }
    Ok(())
}

fn valid_safe_attachment_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.trim() == value
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\'))
        && value.nfc().collect::<String>() == value
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_rfc3339_utc(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 35
        && value.ends_with('Z')
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && value.as_bytes().get(13) == Some(&b':')
        && value.as_bytes().get(16) == Some(&b':')
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

const fn accepted_response_invalid() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::AcceptedResponseInvalid)
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

    #[tokio::test]
    async fn artifact_download_and_post_commit_ack_use_exact_owner_only_v3_resources() {
        let token = TestToken::new(0o600);
        let agent_session_id = Uuid::now_v7();
        let artifact_id = Uuid::now_v7();
        let content = "name,value\nalpha,1\n";
        let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
        let manifest = ArtifactManifest {
            artifact_id,
            agent_session_id,
            local_session_id: Uuid::now_v7(),
            local_turn_id: Uuid::now_v7(),
            kind: ArtifactKind::File,
            provenance: super::super::artifact::ArtifactProvenance::Synthetic,
            ordinal: 0,
            display_name: Some("synthetic.csv".to_owned()),
            media_type: "text/csv".to_owned(),
            size_bytes: content.len(),
            sha256: digest.clone(),
            content_href: format!(
                "/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content"
            ),
            poster_href: None,
        };
        let commit = ArtifactCommit {
            artifact_id,
            ack_id: Uuid::now_v7(),
            local_committed_at: 1_785_000_004,
            expires_at: 1_785_604_804,
        };
        let ack_body = serde_json::json!({
            "artifact_id": artifact_id,
            "ack_id": commit.ack_id,
            "status": "acknowledged",
            "cleanup_status": "completed",
            "acknowledged_at": "2026-08-20T04:00:05Z"
        })
        .to_string();
        let artifact_response = response(
            "200 OK",
            &[
                ("Content-Type", "text/csv"),
                ("Cache-Control", "no-store"),
                ("ETag", &format!("\"{digest}\"")),
                ("Accept-Ranges", "bytes"),
                ("Content-Disposition", "attachment; filename=synthetic.csv"),
                ("X-Content-Type-Options", "nosniff"),
            ],
            content,
        );
        let (port, server) = serve(vec![
            ready_response(NONCE),
            artifact_response,
            ready_response(NONCE),
            json_response("200 OK", &ack_body),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let downloaded = bridge.download_artifact(&manifest).await.unwrap();
        assert_eq!(downloaded.content.bytes, content.as_bytes());
        assert!(downloaded.poster.is_none());
        let acknowledgement = bridge
            .acknowledge_artifact(&manifest, &commit, "2026-07-25T00:00:04Z")
            .await
            .unwrap();
        assert_eq!(acknowledgement.ack_id, commit.ack_id);

        let requests = server.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "GET /v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/content HTTP/1.1"
        )));
        assert!(requests[3].starts_with(&format!(
            "POST /v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/ack HTTP/1.1"
        )));
        let ack_request: serde_json::Value =
            serde_json::from_str(requests[3].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(ack_request["ack_id"], commit.ack_id.to_string());
        assert_eq!(ack_request["size_bytes"], content.len());
        assert_eq!(ack_request["sha256"], digest);
        assert_eq!(ack_request["local_committed_at"], "2026-07-25T00:00:04Z");
        assert!(!requests[3].contains("content_href"));
        assert!(!requests[3].contains("path"));
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
    async fn multimodal_turn_uses_exact_v2_wire_shape_and_revalidates_image_integrity() {
        let token = TestToken::new(0o600);
        let turn_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f24").unwrap();
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        let operation_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f60").unwrap();
        let file_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f61").unwrap();
        let image_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f62").unwrap();
        let image = crate::chat::attachment::test_image_bytes("png");
        let encoded = base64::engine::general_purpose::STANDARD.encode(&image);
        let blocks = vec![
            HostTurnInputBlock::Text {
                text: "Compare the attachment".to_owned(),
            },
            HostTurnInputBlock::File {
                attachment_id: file_id,
                safe_name: "quarterly-total.csv".to_owned(),
                media_type: "text/csv".to_owned(),
                size_bytes: 19,
                sha256: format!("{:x}", Sha256::digest(b"quarter,total\nQ1,42")),
                context_chunks: vec!["quarter,total Q1,42".to_owned()],
            },
            HostTurnInputBlock::Image {
                attachment_id: image_id,
                media_type: "image/png".to_owned(),
                size_bytes: image.len(),
                sha256: format!("{:x}", Sha256::digest(&image)),
                data_url: format!("data:image/png;base64,{encoded}"),
            },
        ];
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response(
                "202 Accepted",
                &serde_json::json!({"turn_id": turn_id}).to_string(),
            ),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        assert!(bridge
            .start_turn_v2(session_id, Uuid::nil(), &blocks, &HostTrace::default())
            .await
            .is_err());
        assert_eq!(
            bridge
                .start_turn_v2(session_id, operation_id, &blocks, &HostTrace::default(),)
                .await
                .unwrap(),
            turn_id
        );
        let requests = server.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "POST /v2/agent-sessions/{session_id}/turns HTTP/1.1"
        )));
        let body = requests[1].split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(value["operation_id"], operation_id.to_string());
        assert_eq!(
            value["content_blocks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|block| block["type"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["text", "file", "image"]
        );
        assert_eq!(value["content_blocks"][1]["name"], "quarterly-total.csv");
        assert_eq!(value["content_blocks"][2]["size_bytes"], image.len());
        assert!(value.get("reasoning_effort").is_none());

        let mut invalid = blocks;
        if let HostTurnInputBlock::Image { sha256, .. } = &mut invalid[2] {
            *sha256 = "0".repeat(64);
        }
        assert!(validate_turn_v2_blocks(&invalid).is_err());
    }

    #[test]
    fn start_turn_v2_adapter_serializes_canonical_contract_projection() {
        let mut expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../fixtures/agent-host-v2/turn-request.json"
        ))
        .unwrap();
        let expected_object = expected.as_object_mut().unwrap();
        for optional_field in [
            "trace_id",
            "request_id",
            "tenant_id",
            "user_id",
            "reasoning_effort",
        ] {
            expected_object.remove(optional_field);
        }

        let blocks = vec![
            HostTurnInputBlock::Text {
                text: "Compare the attached quarterly total with the image.".to_owned(),
            },
            HostTurnInputBlock::File {
                attachment_id: Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f61")
                    .unwrap(),
                safe_name: "quarterly-total.csv".to_owned(),
                media_type: "text/csv".to_owned(),
                size_bytes: 20,
                sha256: "7c7c58d54de2f1f1e5d95d22656ef4ce9cd239f7d7aa7bf62194d1d999a571fd"
                    .to_owned(),
                context_chunks: vec!["quarter,total\nQ1,42".to_owned()],
            },
            HostTurnInputBlock::Image {
                attachment_id: Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f62")
                    .unwrap(),
                media_type: "image/png".to_owned(),
                size_bytes: 68,
                sha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"
                    .to_owned(),
                data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
                    .to_owned(),
            },
        ];
        validate_turn_v2_blocks(&blocks).unwrap();
        let trace = HostTrace::default();
        let request = StartTurnV2Request {
            operation_id: Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f60").unwrap(),
            trace: &trace,
            content_blocks: &blocks,
        };

        assert_eq!(serde_json::to_value(request).unwrap(), expected);
    }

    #[tokio::test]
    async fn accepted_v2_turn_with_invalid_response_is_retryable_but_conflict_stays_typed() {
        let token = TestToken::new(0o600);
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        let operation_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f60").unwrap();
        let blocks = vec![HostTurnInputBlock::Text {
            text: "retry the identical canonical input".to_owned(),
        }];
        let invalid_responses = [
            response(
                "202 Accepted",
                &[("Content-Type", "application/json")],
                r#"{"turn_id":"019fbd88-cbc3-7bf1-934d-7b05cd693f24"}"#,
            ),
            response(
                "202 Accepted",
                &[("Cache-Control", "no-store")],
                r#"{"turn_id":"019fbd88-cbc3-7bf1-934d-7b05cd693f24"}"#,
            ),
            json_response("202 Accepted", r#"{"turn_id":"#),
            json_response("202 Accepted", r#"{}"#),
            json_response(
                "202 Accepted",
                r#"{"turn_id":"00000000-0000-0000-0000-000000000000"}"#,
            ),
        ];
        let mut responses = Vec::new();
        for invalid in invalid_responses {
            responses.push(ready_response(NONCE));
            responses.push(invalid);
        }
        responses.push(ready_response(NONCE));
        responses.push(json_response(
            "409 Conflict",
            r#"{"error":{"code":"turn_operation_conflict","message":"canonical input changed"}}"#,
        ));
        let (port, server) = serve(responses).await;
        let bridge = bridge(port, token.path.clone(), NONCE);

        for _ in 0..5 {
            let error = bridge
                .start_turn_v2(session_id, operation_id, &blocks, &HostTrace::default())
                .await
                .unwrap_err();
            assert_eq!(error.kind(), HostBridgeErrorKind::AcceptedResponseInvalid);
            assert_eq!(error.code(), None);
        }
        let conflict = bridge
            .start_turn_v2(session_id, operation_id, &blocks, &HostTrace::default())
            .await
            .unwrap_err();
        assert_eq!(conflict.kind(), HostBridgeErrorKind::Rejected);
        assert_eq!(conflict.code(), Some(HostErrorCode::TurnOperationConflict));

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 12);
    }

    #[tokio::test]
    async fn resume_posts_exact_session_identity_and_requires_idle_model_ready_projection() {
        let token = TestToken::new(0o600);
        let (port, server) = serve(vec![
            ready_response(NONCE),
            json_response("200 OK", &session_body()),
        ])
        .await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let session_id = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f22").unwrap();
        let resumed = bridge
            .resume_session(session_id, &HostTrace::default())
            .await
            .unwrap();
        assert_eq!(resumed.agent_session_id, session_id);
        assert_eq!(resumed.state, HostSessionState::Idle);
        assert!(resumed.model_ready);
        assert!(resumed.active_turn_id.is_none());
        assert!(resumed.failure_code.is_none());

        let requests = server.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "POST /v1/agent-sessions/{session_id}/resume HTTP/1.1"
        )));
        assert!(requests[1].ends_with("\r\n\r\n{}"));
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
    async fn v3_stream_uses_only_exact_negotiated_route_and_returns_common_artifact_envelope() {
        let token = TestToken::new(0o600);
        let stream_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let event_id = Uuid::now_v7();
        let data = serde_json::json!({
            "schema_version": 3,
            "event_id": event_id,
            "stream_id": stream_id,
            "sequence": 1,
            "occurred_at": "2026-08-20T00:00:00Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": agent_session_id,
            "codex_thread_id": Uuid::now_v7(),
            "turn_id": Uuid::now_v7(),
            "event_type": "item.artifact.started",
            "terminal": false,
            "payload": {
                "artifact_id": Uuid::now_v7(),
                "kind": "image",
                "provenance": "synthetic",
                "status": "in_progress",
                "ordinal": 0
            }
        });
        let body = format!("id: {stream_id}:1\nevent: item.artifact.started\ndata: {data}\n\n");
        let stream_response = response(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Accel-Buffering", "no"),
                ("X-Yijie-Event-Schema-Version", "3"),
                ("X-Yijie-Event-Stream-ID", stream_id.to_string().as_str()),
            ],
            &body,
        );
        let (port, server) = serve(vec![ready_response(NONCE), stream_response]).await;
        let bridge = bridge(port, token.path.clone(), NONCE);
        let mut stream = bridge
            .open_event_stream_v3(agent_session_id, None)
            .await
            .unwrap();
        let Some(HostStreamEvent::Artifact(event)) = stream.next_stream_event().await.unwrap()
        else {
            panic!("Artifact envelope expected");
        };
        assert_eq!(event.event_id, event_id);
        assert_eq!(event.cursor.sequence, 1);
        let requests = server.await.unwrap();
        assert!(requests[1].starts_with(&format!(
            "GET /v3/agent-sessions/{agent_session_id}/events?event_schema_version=3 HTTP/1.1"
        )));
        assert!(!requests[1].contains("/v2/"));
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

    #[test]
    fn turn_operation_conflict_is_typed_only_for_http_conflict() {
        let body =
            br#"{"error":{"code":"turn_operation_conflict","message":"canonical input changed"}}"#;
        let conflict = parse_rejection_body(StatusCode::CONFLICT, body);
        assert_eq!(conflict.kind(), HostBridgeErrorKind::Rejected);
        assert_eq!(conflict.code(), Some(HostErrorCode::TurnOperationConflict));

        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::NOT_FOUND,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::BAD_GATEWAY,
        ] {
            let rejected = parse_rejection_body(status, body);
            assert_eq!(rejected.kind(), HostBridgeErrorKind::Protocol);
            assert_eq!(rejected.code(), None);
        }
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
