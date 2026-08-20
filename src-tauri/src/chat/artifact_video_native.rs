use super::artifact::{
    ReadyVideoContent, ReadyVideoIdentity, ReadyVideoRangeContent, ReadyVideoRangeRequest,
    ReadyVideoReadError, MAX_ARTIFACT_BYTES,
};
use super::artifact_native::{
    atomic_save_content, ArtifactNativeCode, ArtifactNativeError, ArtifactNativeResponse,
};
use super::authorization::{AuthorizationFailure, ChatAction};
use super::{ChatError, ChatRuntime, ConversationApplication};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{self, header, Method, StatusCode};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

const SCHEMA_VERSION: u8 = 1;
const MAIN_WEBVIEW: &str = "main";
const VIDEO_SCHEME: &str = "yijie-artifact-video";
const VIDEO_HOST: &str = "localhost";
const ABSOLUTE_TTL_SECONDS: i64 = 30 * 60;
const IDLE_TTL_SECONDS: i64 = 5 * 60;
const MAX_HANDLES_PER_WEBVIEW: usize = 2;
const MAX_CONCURRENT_REQUESTS: usize = 2;
const MAX_INFLIGHT_BYTES: usize = 64 * 1024 * 1024;
const NATIVE_IO_TIMEOUT_SECONDS: u64 = 10;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdentityRequest {
    schema_version: u8,
    request_id: Uuid,
    context_id: Uuid,
    payload: ArtifactLocator,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactLocator {
    session_id: Uuid,
    turn_id: Uuid,
    artifact_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVideoPreviewResult {
    status: &'static str,
    preview_url: String,
}

#[derive(Debug, Serialize)]
pub struct ReleaseVideoPreviewResult {
    status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct SaveVideoResult {
    status: &'static str,
    code: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VideoExpectation {
    size: usize,
    sha256: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VideoPreviewBinding {
    process_epoch: Uuid,
    webview_label: String,
    context_id: Uuid,
    identity: ReadyVideoIdentity,
    expectation: VideoExpectation,
    absolute_expires_at: i64,
    idle_expires_at: i64,
    active_requests: u8,
    fully_validated_in_protocol: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VideoRequestBinding {
    handle: String,
    context_id: Uuid,
    identity: ReadyVideoIdentity,
    expectation: VideoExpectation,
    requires_full_validation: bool,
}

struct VideoPreviewRegistry {
    process_epoch: Uuid,
    entries: HashMap<String, VideoPreviewBinding>,
}

impl VideoPreviewRegistry {
    fn new(process_epoch: Uuid) -> Self {
        Self {
            process_epoch,
            entries: HashMap::new(),
        }
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.entries.len()
    }

    fn remove_expired(&mut self, now: i64) {
        self.entries.retain(|_, entry| {
            entry.process_epoch == self.process_epoch
                && entry.absolute_expires_at > now
                && entry.idle_expires_at > now
        });
    }

    fn issue(
        &mut self,
        webview_label: &str,
        context_id: Uuid,
        content: &ReadyVideoContent,
        now: i64,
    ) -> Result<String, ArtifactNativeCode> {
        self.remove_expired(now);
        if webview_label != MAIN_WEBVIEW
            || context_id.is_nil()
            || content.size_bytes == 0
            || content.size_bytes > MAX_ARTIFACT_BYTES
            || self
                .entries
                .values()
                .filter(|entry| entry.webview_label == webview_label)
                .count()
                >= MAX_HANDLES_PER_WEBVIEW
        {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        if self
            .entries
            .values()
            .any(|entry| entry.webview_label == webview_label && entry.identity == content.identity)
        {
            return Err(ArtifactNativeCode::Conflict);
        }
        let absolute_expires_at = now
            .checked_add(ABSOLUTE_TTL_SECONDS)
            .ok_or(ArtifactNativeCode::Unavailable)?;
        let idle_expires_at = now
            .checked_add(IDLE_TTL_SECONDS)
            .ok_or(ArtifactNativeCode::Unavailable)?;
        for _ in 0..16 {
            let mut random = [0_u8; 32];
            getrandom::fill(&mut random).map_err(|_| ArtifactNativeCode::Unavailable)?;
            let handle = URL_SAFE_NO_PAD.encode(random);
            if handle.len() != 43 || self.entries.contains_key(&handle) {
                continue;
            }
            self.entries.insert(
                handle.clone(),
                VideoPreviewBinding {
                    process_epoch: self.process_epoch,
                    webview_label: webview_label.to_owned(),
                    context_id,
                    identity: content.identity,
                    expectation: VideoExpectation {
                        size: content.size_bytes,
                        sha256: content.sha256,
                    },
                    absolute_expires_at,
                    idle_expires_at,
                    active_requests: 0,
                    fully_validated_in_protocol: false,
                },
            );
            return Ok(handle);
        }
        Err(ArtifactNativeCode::Unavailable)
    }

    fn begin_request(
        &mut self,
        handle: &str,
        webview_label: &str,
        now: i64,
    ) -> Result<VideoRequestBinding, ArtifactNativeCode> {
        self.remove_expired(now);
        let Some(entry) = self.entries.get_mut(handle) else {
            return Err(ArtifactNativeCode::NotFound);
        };
        if entry.process_epoch != self.process_epoch || entry.webview_label != webview_label {
            return Err(ArtifactNativeCode::NotFound);
        }
        entry.active_requests = entry
            .active_requests
            .checked_add(1)
            .ok_or(ArtifactNativeCode::LimitExceeded)?;
        Ok(VideoRequestBinding {
            handle: handle.to_owned(),
            context_id: entry.context_id,
            identity: entry.identity,
            expectation: entry.expectation,
            requires_full_validation: !entry.fully_validated_in_protocol,
        })
    }

    fn complete_success(&mut self, request: &VideoRequestBinding, now: i64) {
        if let Some(entry) = self.entries.get_mut(&request.handle) {
            entry.active_requests = entry.active_requests.saturating_sub(1);
            entry.fully_validated_in_protocol = true;
            entry.idle_expires_at = now
                .checked_add(IDLE_TTL_SECONDS)
                .map_or(entry.absolute_expires_at, |idle| {
                    idle.min(entry.absolute_expires_at)
                });
        }
    }

    fn revoke(&mut self, handle: &str) {
        self.entries.remove(handle);
    }

    fn release(
        &mut self,
        webview_label: &str,
        context_id: Uuid,
        locator: ArtifactLocator,
        now: i64,
    ) {
        self.remove_expired(now);
        self.entries.retain(|_, entry| {
            !(entry.webview_label == webview_label
                && entry.context_id == context_id
                && entry.identity.session_id == locator.session_id
                && entry.identity.turn_id == locator.turn_id
                && entry.identity.artifact_id == locator.artifact_id)
        });
    }

    fn invalidate_context(&mut self, context_id: Uuid) {
        self.entries
            .retain(|_, entry| entry.context_id != context_id);
    }

    fn invalidate_webview(&mut self, webview_label: &str) {
        self.entries
            .retain(|_, entry| entry.webview_label != webview_label);
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ReadReservation {
    id: u64,
    bytes: usize,
}

#[derive(Default)]
struct VideoReadLimits {
    next_id: u64,
    reservations: HashMap<u64, usize>,
    total_bytes: usize,
}

impl VideoReadLimits {
    fn reserve(&mut self, bytes: usize) -> Result<ReadReservation, ArtifactNativeCode> {
        let next = self
            .total_bytes
            .checked_add(bytes)
            .ok_or(ArtifactNativeCode::LimitExceeded)?;
        if bytes > MAX_ARTIFACT_BYTES
            || self.reservations.len() >= MAX_CONCURRENT_REQUESTS
            || next > MAX_INFLIGHT_BYTES
        {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let reservation = ReadReservation {
            id: self.next_id,
            bytes,
        };
        self.reservations.insert(reservation.id, bytes);
        self.total_bytes = next;
        Ok(reservation)
    }

    fn release(&mut self, reservation: ReadReservation) {
        if self.reservations.remove(&reservation.id) == Some(reservation.bytes) {
            self.total_bytes = self.total_bytes.saturating_sub(reservation.bytes);
        }
    }
}

pub struct ArtifactVideoNativeRuntime {
    process_epoch: Uuid,
    registry: Mutex<VideoPreviewRegistry>,
    reads: Mutex<VideoReadLimits>,
    active_saves: Mutex<HashSet<ReadyVideoIdentity>>,
    #[cfg(feature = "feat128-s7b-runtime")]
    diagnostics: Mutex<VideoProtocolDiagnostics>,
}

#[cfg(feature = "feat128-s7b-runtime")]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoProtocolDiagnostics {
    pub(crate) requests_total: u64,
    pub(crate) get_requests: u64,
    pub(crate) head_requests: u64,
    pub(crate) other_method_requests: u64,
    pub(crate) range_headers: u64,
    pub(crate) origin_headers: u64,
    pub(crate) cookie_headers: u64,
    pub(crate) content_length_headers: u64,
    pub(crate) transfer_encoding_headers: u64,
    pub(crate) validation_success: u64,
    pub(crate) validation_webview_or_body_rejected: u64,
    pub(crate) validation_method_rejected: u64,
    pub(crate) validation_duplicate_range_rejected: u64,
    pub(crate) validation_origin_rejected: u64,
    pub(crate) validation_cookie_rejected: u64,
    pub(crate) validation_content_length_rejected: u64,
    pub(crate) validation_transfer_encoding_rejected: u64,
    pub(crate) validation_uri_rejected: u64,
    pub(crate) begin_request_failed: u64,
    pub(crate) range_parse_failed: u64,
    pub(crate) parsed_range_requests: u64,
    pub(crate) whole_resource_ranges: u64,
    pub(crate) prefix_ranges: u64,
    pub(crate) suffix_ranges: u64,
    pub(crate) middle_ranges: u64,
    pub(crate) distinct_ranges: u64,
    pub(crate) repeated_ranges: u64,
    #[serde(skip)]
    seen_ranges: HashSet<(usize, usize)>,
    pub(crate) reservation_failed: u64,
    pub(crate) full_authorization_failed: u64,
    pub(crate) full_identity_failed: u64,
    pub(crate) full_media_type_failed: u64,
    pub(crate) full_size_failed: u64,
    pub(crate) full_digest_failed: u64,
    pub(crate) mp4_validation_failed: u64,
    pub(crate) full_validation_success: u64,
    pub(crate) range_authorization_failed: u64,
    pub(crate) range_validation_failed: u64,
    pub(crate) range_validation_success: u64,
    pub(crate) body_length_failed: u64,
    pub(crate) responses_ok: u64,
    pub(crate) responses_partial: u64,
    pub(crate) responses_head: u64,
    pub(crate) responses_not_found: u64,
    pub(crate) responses_range_not_satisfiable: u64,
}

impl ArtifactVideoNativeRuntime {
    pub fn new() -> Self {
        let process_epoch = Uuid::now_v7();
        Self {
            process_epoch,
            registry: Mutex::new(VideoPreviewRegistry::new(process_epoch)),
            reads: Mutex::new(VideoReadLimits::default()),
            active_saves: Mutex::new(HashSet::new()),
            #[cfg(feature = "feat128-s7b-runtime")]
            diagnostics: Mutex::new(VideoProtocolDiagnostics::default()),
        }
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    fn diagnose(&self, update: impl FnOnce(&mut VideoProtocolDiagnostics)) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            update(&mut diagnostics);
        }
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    fn diagnose_request(&self, method: &str, headers: &[(String, String)]) {
        self.diagnose(|diagnostics| {
            diagnostics.requests_total = diagnostics.requests_total.saturating_add(1);
            match method {
                "GET" => diagnostics.get_requests = diagnostics.get_requests.saturating_add(1),
                "HEAD" => diagnostics.head_requests = diagnostics.head_requests.saturating_add(1),
                _ => {
                    diagnostics.other_method_requests =
                        diagnostics.other_method_requests.saturating_add(1)
                }
            }
            for (name, _) in headers {
                match name.to_ascii_lowercase().as_str() {
                    "range" => {
                        diagnostics.range_headers = diagnostics.range_headers.saturating_add(1)
                    }
                    "origin" => {
                        diagnostics.origin_headers = diagnostics.origin_headers.saturating_add(1)
                    }
                    "cookie" => {
                        diagnostics.cookie_headers = diagnostics.cookie_headers.saturating_add(1)
                    }
                    "content-length" => {
                        diagnostics.content_length_headers =
                            diagnostics.content_length_headers.saturating_add(1)
                    }
                    "transfer-encoding" => {
                        diagnostics.transfer_encoding_headers =
                            diagnostics.transfer_encoding_headers.saturating_add(1)
                    }
                    _ => {}
                }
            }
        });
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    fn diagnose_validation_error(&self, error: ProtocolValidationError) {
        self.diagnose(|diagnostics| match error {
            ProtocolValidationError::WebviewOrBody => {
                diagnostics.validation_webview_or_body_rejected = diagnostics
                    .validation_webview_or_body_rejected
                    .saturating_add(1)
            }
            ProtocolValidationError::Method => {
                diagnostics.validation_method_rejected =
                    diagnostics.validation_method_rejected.saturating_add(1)
            }
            ProtocolValidationError::DuplicateRange => {
                diagnostics.validation_duplicate_range_rejected = diagnostics
                    .validation_duplicate_range_rejected
                    .saturating_add(1)
            }
            ProtocolValidationError::Origin => {
                diagnostics.validation_origin_rejected =
                    diagnostics.validation_origin_rejected.saturating_add(1)
            }
            ProtocolValidationError::Cookie => {
                diagnostics.validation_cookie_rejected =
                    diagnostics.validation_cookie_rejected.saturating_add(1)
            }
            ProtocolValidationError::ContentLength => {
                diagnostics.validation_content_length_rejected = diagnostics
                    .validation_content_length_rejected
                    .saturating_add(1)
            }
            ProtocolValidationError::TransferEncoding => {
                diagnostics.validation_transfer_encoding_rejected = diagnostics
                    .validation_transfer_encoding_rejected
                    .saturating_add(1)
            }
            ProtocolValidationError::Uri => {
                diagnostics.validation_uri_rejected =
                    diagnostics.validation_uri_rejected.saturating_add(1)
            }
        });
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    fn diagnose_requested_range(&self, requested: RequestedRange, total: usize) {
        self.diagnose(|diagnostics| {
            diagnostics.parsed_range_requests = diagnostics.parsed_range_requests.saturating_add(1);
            let (start, end) = match requested {
                RequestedRange::Full => (0, total.saturating_sub(1)),
                RequestedRange::Slice { start, end } => (start, end),
            };
            if start == 0 && end.saturating_add(1) == total {
                diagnostics.whole_resource_ranges =
                    diagnostics.whole_resource_ranges.saturating_add(1);
            } else if start == 0 {
                diagnostics.prefix_ranges = diagnostics.prefix_ranges.saturating_add(1);
            } else if end.saturating_add(1) == total {
                diagnostics.suffix_ranges = diagnostics.suffix_ranges.saturating_add(1);
            } else {
                diagnostics.middle_ranges = diagnostics.middle_ranges.saturating_add(1);
            }
            if diagnostics.seen_ranges.insert((start, end)) {
                diagnostics.distinct_ranges = diagnostics.distinct_ranges.saturating_add(1);
            } else {
                diagnostics.repeated_ranges = diagnostics.repeated_ranges.saturating_add(1);
            }
        });
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    pub(crate) fn diagnostics_snapshot(&self) -> VideoProtocolDiagnostics {
        self.diagnostics
            .lock()
            .map(|diagnostics| diagnostics.clone())
            .unwrap_or_default()
    }

    pub fn invalidate_all(&self) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.clear();
        }
    }

    pub fn invalidate_context(&self, context_id: Uuid) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.invalidate_context(context_id);
        }
    }

    pub fn invalidate_webview(&self, webview_label: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.invalidate_webview(webview_label);
        }
    }

    fn expire_handles(&self, now: i64) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.remove_expired(now);
        }
    }

    fn issue(
        &self,
        webview_label: &str,
        context_id: Uuid,
        content: &ReadyVideoContent,
        now: i64,
    ) -> Result<String, ArtifactNativeCode> {
        self.registry
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .issue(webview_label, context_id, content, now)
    }

    fn begin_request(
        &self,
        handle: &str,
        webview_label: &str,
        now: i64,
    ) -> Result<VideoRequestBinding, ArtifactNativeCode> {
        self.registry
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .begin_request(handle, webview_label, now)
    }

    fn complete_success(&self, request: &VideoRequestBinding, now: i64) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.complete_success(request, now);
        }
    }

    fn revoke(&self, handle: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.revoke(handle);
        }
    }

    fn release(
        &self,
        webview_label: &str,
        context_id: Uuid,
        locator: ArtifactLocator,
        now: i64,
    ) -> Result<(), ArtifactNativeCode> {
        self.registry
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .release(webview_label, context_id, locator, now);
        Ok(())
    }

    fn reserve(&self, bytes: usize) -> Result<ReadReservation, ArtifactNativeCode> {
        self.reads
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .reserve(bytes)
    }

    fn release_reservation(&self, reservation: ReadReservation) {
        if let Ok(mut reads) = self.reads.lock() {
            reads.release(reservation);
        }
    }

    fn begin_save(
        &self,
        identity: ReadyVideoIdentity,
    ) -> Result<VideoSaveLease<'_>, ArtifactNativeCode> {
        let mut active = self
            .active_saves
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?;
        if !active.insert(identity) {
            return Err(ArtifactNativeCode::Conflict);
        }
        Ok(VideoSaveLease {
            runtime: self,
            identity,
        })
    }
}

impl Default for ArtifactVideoNativeRuntime {
    fn default() -> Self {
        Self::new()
    }
}

struct VideoSaveLease<'a> {
    runtime: &'a ArtifactVideoNativeRuntime,
    identity: ReadyVideoIdentity,
}

impl Drop for VideoSaveLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.runtime.active_saves.lock() {
            active.remove(&self.identity);
        }
    }
}

fn extract_request_id(value: &Value) -> Option<Uuid> {
    value
        .as_object()
        .and_then(|object| object.get("requestId"))
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|value| !value.is_nil())
}

fn decode_request(value: Value) -> Result<IdentityRequest, ArtifactNativeError> {
    let request_id = extract_request_id(&value);
    if serde_json::to_vec(&value).map_or(true, |encoded| encoded.len() > 4096) {
        return Err(ArtifactNativeError::new(
            request_id,
            ArtifactNativeCode::InvalidRequest,
        ));
    }
    let request: IdentityRequest = serde_json::from_value(value)
        .map_err(|_| ArtifactNativeError::new(request_id, ArtifactNativeCode::InvalidRequest))?;
    if request.schema_version != SCHEMA_VERSION
        || request.request_id.is_nil()
        || request.context_id.is_nil()
        || request.payload.session_id.is_nil()
        || request.payload.turn_id.is_nil()
        || request.payload.artifact_id.is_nil()
    {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::InvalidRequest,
        ));
    }
    Ok(request)
}

fn unix_seconds() -> Result<i64, ArtifactNativeCode> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .ok_or(ArtifactNativeCode::Unavailable)
}

fn map_chat_error(error: ChatError) -> ArtifactNativeCode {
    match error {
        ChatError::DatabaseReadOnly => ArtifactNativeCode::PermissionDenied,
        ChatError::DatabaseFull => ArtifactNativeCode::StorageFull,
        ChatError::ScopeDenied => ArtifactNativeCode::Unauthenticated,
        ChatError::InvalidInput => ArtifactNativeCode::InvalidRequest,
        ChatError::NotFound => ArtifactNativeCode::NotFound,
        ChatError::ConversationConflict => ArtifactNativeCode::Conflict,
        ChatError::Disabled
        | ChatError::InvalidConfiguration
        | ChatError::SecureStorageUnavailable
        | ChatError::DatabaseKeyMissing
        | ChatError::DatabaseUnsafe
        | ChatError::DatabaseBusy
        | ChatError::DatabaseUnavailable
        | ChatError::DatabaseCorrupt
        | ChatError::MigrationFailed
        | ChatError::ProjectUnavailable
        | ChatError::NativePickerUnavailable
        | ChatError::SidecarUnavailable
        | ChatError::OrchestrationUnavailable
        | ChatError::CleanupIncomplete => ArtifactNativeCode::Unavailable,
    }
}

fn map_read_error(error: ReadyVideoReadError) -> ArtifactNativeCode {
    match error {
        ReadyVideoReadError::NotFound => ArtifactNativeCode::NotFound,
        ReadyVideoReadError::NotReady => ArtifactNativeCode::NotReady,
        ReadyVideoReadError::Expired => ArtifactNativeCode::Expired,
        ReadyVideoReadError::Unsupported => ArtifactNativeCode::Unsupported,
        ReadyVideoReadError::Integrity => ArtifactNativeCode::IntegrityFailed,
    }
}

async fn authorized_video(
    chat_runtime: &ChatRuntime,
    context_id: Uuid,
    locator: ArtifactLocator,
    now: i64,
) -> Result<ReadyVideoContent, ArtifactNativeCode> {
    let manager = chat_runtime
        .authorization_manager()
        .map_err(map_chat_error)?;
    match manager.authorize_detailed(context_id, ChatAction::ReadSessions, now) {
        Ok(()) => {}
        Err(AuthorizationFailure::ContextInvalid) => {
            return Err(ArtifactNativeCode::Unauthenticated)
        }
        Err(AuthorizationFailure::CapabilityDenied) => return Err(ArtifactNativeCode::Forbidden),
    }
    let application: ConversationApplication = chat_runtime
        .local_offline_conversation_application()
        .await
        .map_err(map_chat_error)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        application.read_ready_video(
            locator.session_id,
            locator.turn_id,
            locator.artifact_id,
            now,
        ),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)?
    .map_err(map_chat_error)?
    .map_err(map_read_error)
}

async fn authorized_video_range(
    chat_runtime: &ChatRuntime,
    context_id: Uuid,
    locator: ArtifactLocator,
    now: i64,
    expectation: VideoExpectation,
    start: usize,
    length: usize,
) -> Result<ReadyVideoRangeContent, ArtifactNativeCode> {
    let manager = chat_runtime
        .authorization_manager()
        .map_err(map_chat_error)?;
    match manager.authorize_detailed(context_id, ChatAction::ReadSessions, now) {
        Ok(()) => {}
        Err(AuthorizationFailure::ContextInvalid) => {
            return Err(ArtifactNativeCode::Unauthenticated)
        }
        Err(AuthorizationFailure::CapabilityDenied) => return Err(ArtifactNativeCode::Forbidden),
    }
    let application: ConversationApplication = chat_runtime
        .local_offline_conversation_application()
        .await
        .map_err(map_chat_error)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        application.read_ready_video_range(ReadyVideoRangeRequest {
            session_id: locator.session_id,
            turn_id: locator.turn_id,
            artifact_id: locator.artifact_id,
            now,
            expected_size: expectation.size,
            expected_sha256: expectation.sha256,
            start,
            length,
        }),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)?
    .map_err(map_chat_error)?
    .map_err(map_read_error)
}

fn require_main(webview: &WebviewWindow, request_id: Uuid) -> Result<(), ArtifactNativeError> {
    if webview.label() == MAIN_WEBVIEW {
        Ok(())
    } else {
        Err(ArtifactNativeError::new(
            Some(request_id),
            ArtifactNativeCode::Forbidden,
        ))
    }
}

fn schedule_expiry(webview: &WebviewWindow, delay_seconds: u64) {
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay_seconds)).await;
        if let Ok(now) = unix_seconds() {
            app.state::<ArtifactVideoNativeRuntime>()
                .expire_handles(now);
        }
    });
}

#[tauri::command]
pub async fn chat_open_artifact_video_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    video_runtime: State<'_, ArtifactVideoNativeRuntime>,
) -> Result<ArtifactNativeResponse<OpenVideoPreviewResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let content = authorized_video(&chat_runtime, request.context_id, request.payload, now)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let handle = video_runtime
        .issue(webview.label(), request.context_id, &content, now)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    schedule_expiry(&webview, u64::try_from(IDLE_TTL_SECONDS).unwrap_or(300));
    schedule_expiry(
        &webview,
        u64::try_from(ABSOLUTE_TTL_SECONDS).unwrap_or(1_800),
    );
    Ok(ArtifactNativeResponse::new(
        request.request_id,
        OpenVideoPreviewResult {
            status: "opened",
            preview_url: format!("{VIDEO_SCHEME}://{VIDEO_HOST}/v1/{handle}"),
        },
    ))
}

#[tauri::command]
pub async fn chat_release_artifact_video_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    video_runtime: State<'_, ArtifactVideoNativeRuntime>,
) -> Result<ArtifactNativeResponse<ReleaseVideoPreviewResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let manager = chat_runtime.authorization_manager().map_err(|error| {
        ArtifactNativeError::new(Some(request.request_id), map_chat_error(error))
    })?;
    match manager.authorize_detailed(request.context_id, ChatAction::ReadSessions, now) {
        Ok(()) => {}
        Err(AuthorizationFailure::ContextInvalid) => {
            return Err(ArtifactNativeError::new(
                Some(request.request_id),
                ArtifactNativeCode::Unauthenticated,
            ));
        }
        Err(AuthorizationFailure::CapabilityDenied) => {
            return Err(ArtifactNativeError::new(
                Some(request.request_id),
                ArtifactNativeCode::Forbidden,
            ));
        }
    }
    video_runtime
        .release(webview.label(), request.context_id, request.payload, now)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    Ok(ArtifactNativeResponse::new(
        request.request_id,
        ReleaseVideoPreviewResult { status: "released" },
    ))
}

#[tauri::command]
pub async fn chat_save_artifact_video_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    video_runtime: State<'_, ArtifactVideoNativeRuntime>,
) -> Result<ArtifactNativeResponse<SaveVideoResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_video(&chat_runtime, request.context_id, request.payload, now)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let _save = video_runtime
        .begin_save(first.identity)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let default_name = canonical_video_save_name(first.display_name.as_deref())
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let selected = pick_native_video_save_target(&default_name)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let Some(selected) = selected else {
        return Ok(ArtifactNativeResponse::new(
            request.request_id,
            SaveVideoResult {
                status: "cancelled",
                code: None,
            },
        ));
    };
    let target = match normalized_video_target(&selected) {
        Ok(target) => target,
        Err(code) => {
            return Ok(ArtifactNativeResponse::new(
                request.request_id,
                SaveVideoResult {
                    status: "failed",
                    code: Some(code.as_str()),
                },
            ));
        }
    };
    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_video(
        &chat_runtime,
        request.context_id,
        request.payload,
        second_now,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if first.identity != second.identity
        || first.media_type != second.media_type
        || first.size_bytes != second.size_bytes
        || first.sha256 != second.sha256
    {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::IntegrityFailed,
        ));
    }
    let save = tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        tokio::task::spawn_blocking({
            let epoch = video_runtime.process_epoch;
            move || {
                atomic_save_content(
                    &target,
                    &second.bytes,
                    second.size_bytes,
                    second.sha256,
                    epoch,
                )
            }
        }),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)
    .and_then(|joined| joined.map_err(|_| ArtifactNativeCode::Unavailable))
    .and_then(|result| result);
    let outcome = match save {
        Ok(()) => SaveVideoResult {
            status: "saved",
            code: None,
        },
        Err(code) => SaveVideoResult {
            status: "failed",
            code: Some(code.as_str()),
        },
    };
    Ok(ArtifactNativeResponse::new(request.request_id, outcome))
}

fn canonical_video_save_name(display_name: Option<&str>) -> Result<String, ArtifactNativeCode> {
    let name = display_name.unwrap_or("artifact");
    if name.is_empty()
        || name.len() > 255
        || name
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | '\0'))
    {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    if Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("mp4"))
    {
        Ok(name.to_owned())
    } else {
        Ok(format!("{name}.mp4"))
    }
}

fn normalized_video_target(target: &Path) -> Result<PathBuf, ArtifactNativeCode> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err(ArtifactNativeCode::InvalidRequest);
    }
    match target.extension().and_then(|value| value.to_str()) {
        Some(value) if value.eq_ignore_ascii_case("mp4") => Ok(target.to_path_buf()),
        Some(_) => Err(ArtifactNativeCode::ExtensionMismatch),
        None => Ok(target.with_extension("mp4")),
    }
}

#[cfg(target_os = "macos")]
async fn pick_native_video_save_target(
    default_name: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    Ok(rfd::AsyncFileDialog::new()
        .set_file_name(default_name)
        .add_filter("Video", &["mp4"])
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf()))
}

#[cfg(not(target_os = "macos"))]
async fn pick_native_video_save_target(
    _default_name: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    Err(ArtifactNativeCode::DialogUnavailable)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestedRange {
    Full,
    Slice { start: usize, end: usize },
}

impl RequestedRange {
    fn length(self, total: usize) -> usize {
        match self {
            Self::Full => total,
            Self::Slice { start, end } => end - start + 1,
        }
    }
}

fn parse_single_range(value: Option<&str>, total: usize) -> Result<RequestedRange, ()> {
    if total == 0 {
        return Err(());
    }
    let Some(value) = value else {
        return Ok(RequestedRange::Full);
    };
    if value.contains(',') || value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return Err(());
    }
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    let (left, right) = spec.split_once('-').ok_or(())?;
    if left.is_empty() {
        let suffix = right.parse::<usize>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let length = suffix.min(total);
        return Ok(RequestedRange::Slice {
            start: total - length,
            end: total - 1,
        });
    }
    let start = left.parse::<usize>().map_err(|_| ())?;
    if start >= total {
        return Err(());
    }
    let end = if right.is_empty() {
        total - 1
    } else {
        right.parse::<usize>().map_err(|_| ())?.min(total - 1)
    };
    if end < start {
        return Err(());
    }
    Ok(RequestedRange::Slice { start, end })
}

#[derive(Debug)]
struct ProtocolRequest {
    handle: String,
    head: bool,
    range: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtocolValidationError {
    WebviewOrBody,
    Method,
    DuplicateRange,
    Origin,
    Cookie,
    ContentLength,
    TransferEncoding,
    Uri,
}

fn validate_protocol_request(
    webview_label: &str,
    method: &str,
    uri: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<ProtocolRequest, ProtocolValidationError> {
    if webview_label != MAIN_WEBVIEW || !body.is_empty() {
        return Err(ProtocolValidationError::WebviewOrBody);
    }
    let head = match method {
        value if value == Method::GET.as_str() => false,
        value if value == Method::HEAD.as_str() => true,
        _ => return Err(ProtocolValidationError::Method),
    };
    let mut range = None;
    for (name, value) in headers {
        match name.to_ascii_lowercase().as_str() {
            "range" if range.is_none() => range = Some(value.clone()),
            "range" => return Err(ProtocolValidationError::DuplicateRange),
            "origin" => return Err(ProtocolValidationError::Origin),
            "cookie" => return Err(ProtocolValidationError::Cookie),
            "content-length" => return Err(ProtocolValidationError::ContentLength),
            "transfer-encoding" => return Err(ProtocolValidationError::TransferEncoding),
            _ => {}
        }
    }
    let parsed = url::Url::parse(uri).map_err(|_| ProtocolValidationError::Uri)?;
    if parsed.scheme() != VIDEO_SCHEME
        || parsed.host_str() != Some(VIDEO_HOST)
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ProtocolValidationError::Uri);
    }
    let handle = parsed
        .path()
        .strip_prefix("/v1/")
        .ok_or(ProtocolValidationError::Uri)?;
    if handle.len() != 43
        || handle
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'-' | b'_'))
    {
        return Err(ProtocolValidationError::Uri);
    }
    Ok(ProtocolRequest {
        handle: handle.to_owned(),
        head,
        range,
    })
}

fn handle_for_failure_cleanup(uri: &str) -> Option<String> {
    let parsed = url::Url::parse(uri).ok()?;
    if parsed.scheme() != VIDEO_SCHEME || parsed.host_str() != Some(VIDEO_HOST) {
        return None;
    }
    let handle = parsed.path().strip_prefix("/v1/")?;
    (handle.len() == 43
        && handle
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    .then(|| handle.to_owned())
}

fn protocol_not_found() -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn protocol_range_not_satisfiable(total: usize) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{total}"))
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_else(|_| protocol_not_found())
}

fn protocol_success(
    body: Vec<u8>,
    total: usize,
    requested: RequestedRange,
    head: bool,
) -> http::Response<Vec<u8>> {
    let length = requested.length(total);
    let status = if matches!(requested, RequestedRange::Full) {
        StatusCode::OK
    } else {
        StatusCode::PARTIAL_CONTENT
    };
    let mut builder = http::Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::PRAGMA, "no-cache")
        .header("X-Content-Type-Options", "nosniff");
    if let RequestedRange::Slice { start, end } = requested {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}"),
        );
    }
    builder
        .body(if head { Vec::new() } else { body })
        .unwrap_or_else(|_| protocol_not_found())
}

pub fn handle_video_protocol(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let webview_label = context.webview_label().to_owned();
    let uri = request.uri().to_string();
    let headers = request
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_owned(),
                value.to_str().unwrap_or("").to_owned(),
            )
        })
        .collect::<Vec<_>>();
    #[cfg(feature = "feat128-s7b-runtime")]
    app.state::<ArtifactVideoNativeRuntime>()
        .diagnose_request(request.method().as_str(), &headers);
    let protocol = match validate_protocol_request(
        &webview_label,
        request.method().as_str(),
        &uri,
        &headers,
        request.body(),
    ) {
        Ok(protocol) => {
            #[cfg(feature = "feat128-s7b-runtime")]
            app.state::<ArtifactVideoNativeRuntime>()
                .diagnose(|diagnostics| {
                    diagnostics.validation_success =
                        diagnostics.validation_success.saturating_add(1)
                });
            protocol
        }
        Err(_validation_error) => {
            #[cfg(feature = "feat128-s7b-runtime")]
            app.state::<ArtifactVideoNativeRuntime>()
                .diagnose_validation_error(_validation_error);
            if let Some(handle) = handle_for_failure_cleanup(&uri) {
                app.state::<ArtifactVideoNativeRuntime>().revoke(&handle);
            }
            #[cfg(feature = "feat128-s7b-runtime")]
            app.state::<ArtifactVideoNativeRuntime>()
                .diagnose(|diagnostics| {
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1)
                });
            responder.respond(protocol_not_found());
            return;
        }
    };
    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<ArtifactVideoNativeRuntime>();
        let now = match unix_seconds() {
            Ok(now) => now,
            Err(_) => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1)
                });
                responder.respond(protocol_not_found());
                return;
            }
        };
        let binding = match runtime.begin_request(&protocol.handle, &webview_label, now) {
            Ok(binding) => binding,
            Err(_) => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    diagnostics.begin_request_failed =
                        diagnostics.begin_request_failed.saturating_add(1);
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1);
                });
                responder.respond(protocol_not_found());
                return;
            }
        };
        let requested =
            match parse_single_range(protocol.range.as_deref(), binding.expectation.size) {
                Ok(range) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose_requested_range(range, binding.expectation.size);
                    range
                }
                Err(()) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.range_parse_failed =
                            diagnostics.range_parse_failed.saturating_add(1);
                        diagnostics.responses_range_not_satisfiable = diagnostics
                            .responses_range_not_satisfiable
                            .saturating_add(1);
                    });
                    runtime.revoke(&protocol.handle);
                    responder.respond(protocol_range_not_satisfiable(binding.expectation.size));
                    return;
                }
            };
        let (range_start, range_length) = match requested {
            RequestedRange::Full => (0, binding.expectation.size),
            RequestedRange::Slice { start, end } => (start, end - start + 1),
        };
        let body_length = if protocol.head { 0 } else { range_length };
        let reservation_bytes = if binding.requires_full_validation {
            binding.expectation.size
        } else {
            body_length
        };
        let reservation = match runtime.reserve(reservation_bytes) {
            Ok(reservation) => reservation,
            Err(_) => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    diagnostics.reservation_failed =
                        diagnostics.reservation_failed.saturating_add(1);
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1);
                });
                runtime.revoke(&protocol.handle);
                responder.respond(protocol_not_found());
                return;
            }
        };
        let locator = ArtifactLocator {
            session_id: binding.identity.session_id,
            turn_id: binding.identity.turn_id,
            artifact_id: binding.identity.artifact_id,
        };
        let body = if binding.requires_full_validation {
            match authorized_video(
                app.state::<ChatRuntime>().inner(),
                binding.context_id,
                locator,
                now,
            )
            .await
            {
                Err(_) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_authorization_failed =
                            diagnostics.full_authorization_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(content) if content.identity != binding.identity => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_identity_failed =
                            diagnostics.full_identity_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(content) if content.media_type != "video/mp4" => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_media_type_failed =
                            diagnostics.full_media_type_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(content) if content.size_bytes != binding.expectation.size => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_size_failed =
                            diagnostics.full_size_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(content) if content.sha256 != binding.expectation.sha256 => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_digest_failed =
                            diagnostics.full_digest_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(content) if validate_mp4(&content.bytes).is_err() => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.mp4_validation_failed =
                            diagnostics.mp4_validation_failed.saturating_add(1)
                    });
                    Err(())
                }
                Ok(mut content) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.full_validation_success =
                            diagnostics.full_validation_success.saturating_add(1)
                    });
                    if protocol.head {
                        content.bytes.clear();
                    } else {
                        content.bytes.truncate(range_start + range_length);
                        content.bytes.drain(..range_start);
                    }
                    Ok(content.bytes)
                }
            }
        } else {
            match authorized_video_range(
                app.state::<ChatRuntime>().inner(),
                binding.context_id,
                locator,
                now,
                binding.expectation,
                range_start,
                body_length,
            )
            .await
            {
                Ok(content)
                    if content.identity == binding.identity
                        && content.size_bytes == binding.expectation.size
                        && content.sha256 == binding.expectation.sha256 =>
                {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.range_validation_success =
                            diagnostics.range_validation_success.saturating_add(1)
                    });
                    Ok(content.bytes)
                }
                Ok(_) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.range_validation_failed =
                            diagnostics.range_validation_failed.saturating_add(1)
                    });
                    Err(())
                }
                Err(_) => {
                    #[cfg(feature = "feat128-s7b-runtime")]
                    runtime.diagnose(|diagnostics| {
                        diagnostics.range_authorization_failed =
                            diagnostics.range_authorization_failed.saturating_add(1)
                    });
                    Err(())
                }
            }
        };
        let response = match body {
            Ok(body) if body.len() == body_length => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    if protocol.head {
                        diagnostics.responses_head = diagnostics.responses_head.saturating_add(1);
                    }
                    match requested {
                        RequestedRange::Full => {
                            diagnostics.responses_ok = diagnostics.responses_ok.saturating_add(1)
                        }
                        RequestedRange::Slice { .. } => {
                            diagnostics.responses_partial =
                                diagnostics.responses_partial.saturating_add(1)
                        }
                    }
                });
                runtime.complete_success(&binding, now);
                schedule_idle_expiry(&app);
                protocol_success(body, binding.expectation.size, requested, protocol.head)
            }
            Ok(_) => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    diagnostics.body_length_failed =
                        diagnostics.body_length_failed.saturating_add(1);
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1);
                });
                runtime.revoke(&protocol.handle);
                protocol_not_found()
            }
            Err(()) => {
                #[cfg(feature = "feat128-s7b-runtime")]
                runtime.diagnose(|diagnostics| {
                    diagnostics.responses_not_found =
                        diagnostics.responses_not_found.saturating_add(1)
                });
                runtime.revoke(&protocol.handle);
                protocol_not_found()
            }
        };
        responder.respond(response);
        runtime.release_reservation(reservation);
    });
}

fn schedule_idle_expiry(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(
            u64::try_from(IDLE_TTL_SECONDS).unwrap_or(300),
        ))
        .await;
        if let Ok(now) = unix_seconds() {
            app.state::<ArtifactVideoNativeRuntime>()
                .expire_handles(now);
        }
    });
}

#[derive(Clone, Copy, Debug)]
struct Mp4BoxView {
    kind: [u8; 4],
    start: usize,
    content_start: usize,
    end: usize,
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ()> {
    let value: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or(())?
        .try_into()
        .map_err(|_| ())?;
    Ok(u32::from_be_bytes(value))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ()> {
    let value: [u8; 8] = bytes
        .get(offset..offset + 8)
        .ok_or(())?
        .try_into()
        .map_err(|_| ())?;
    Ok(u64::from_be_bytes(value))
}

fn parse_boxes(bytes: &[u8], start: usize, end: usize) -> Result<Vec<Mp4BoxView>, ()> {
    if start > end || end > bytes.len() {
        return Err(());
    }
    let mut cursor = start;
    let mut boxes = Vec::new();
    while cursor < end {
        if end - cursor < 8 || boxes.len() >= 4096 {
            return Err(());
        }
        let short = usize::try_from(read_u32(bytes, cursor)?).map_err(|_| ())?;
        let kind: [u8; 4] = bytes[cursor + 4..cursor + 8].try_into().map_err(|_| ())?;
        let (size, header) = if short == 1 {
            (
                usize::try_from(read_u64(bytes, cursor + 8)?).map_err(|_| ())?,
                16,
            )
        } else if short == 0 {
            (end - cursor, 8)
        } else {
            (short, 8)
        };
        if size < header || cursor.checked_add(size).ok_or(())? > end {
            return Err(());
        }
        boxes.push(Mp4BoxView {
            kind,
            start: cursor,
            content_start: cursor + header,
            end: cursor + size,
        });
        cursor += size;
    }
    Ok(boxes)
}

fn child<'a>(boxes: &'a [Mp4BoxView], kind: &[u8; 4]) -> Result<&'a Mp4BoxView, ()> {
    let mut matching = boxes.iter().filter(|item| &item.kind == kind);
    let value = matching.next().ok_or(())?;
    if matching.next().is_some() {
        return Err(());
    }
    Ok(value)
}

pub(crate) fn validate_mp4(bytes: &[u8]) -> Result<(), ()> {
    if !(32..=MAX_ARTIFACT_BYTES).contains(&bytes.len()) {
        return Err(());
    }
    let top = parse_boxes(bytes, 0, bytes.len())?;
    if top.first().map(|item| item.kind) != Some(*b"ftyp") {
        return Err(());
    }
    let ftyp = child(&top, b"ftyp")?;
    if ftyp.end - ftyp.content_start < 8
        || !bytes[ftyp.content_start..ftyp.end]
            .chunks_exact(4)
            .any(|brand| brand == b"avc1")
    {
        return Err(());
    }
    let moov = child(&top, b"moov")?;
    let mdat = child(&top, b"mdat")?;
    if moov.start >= mdat.start || mdat.content_start >= mdat.end {
        return Err(());
    }
    let moov_children = parse_boxes(bytes, moov.content_start, moov.end)?;
    let mvhd = child(&moov_children, b"mvhd")?;
    validate_duration_box(bytes, mvhd)?;
    let tracks = moov_children
        .iter()
        .filter(|item| item.kind == *b"trak")
        .collect::<Vec<_>>();
    if tracks.len() != 1 {
        return Err(());
    }
    validate_video_track(bytes, tracks[0], mdat)
}

fn validate_duration_box(bytes: &[u8], value: &Mp4BoxView) -> Result<(), ()> {
    let payload = &bytes[value.content_start..value.end];
    let version = *payload.first().ok_or(())?;
    let (timescale_offset, duration_offset, wide) = if version == 0 {
        (12, 16, false)
    } else if version == 1 {
        (20, 24, true)
    } else {
        return Err(());
    };
    let timescale = u64::from(read_u32(payload, timescale_offset)?);
    let duration = if wide {
        read_u64(payload, duration_offset)?
    } else {
        u64::from(read_u32(payload, duration_offset)?)
    };
    if timescale == 0 || duration == 0 || duration > timescale.saturating_mul(24 * 60 * 60) {
        return Err(());
    }
    Ok(())
}

fn validate_video_track(bytes: &[u8], trak: &Mp4BoxView, mdat: &Mp4BoxView) -> Result<(), ()> {
    let trak_children = parse_boxes(bytes, trak.content_start, trak.end)?;
    let tkhd = child(&trak_children, b"tkhd")?;
    let tkhd_payload = &bytes[tkhd.content_start..tkhd.end];
    if tkhd_payload.len() < 8 {
        return Err(());
    }
    let width = read_u32(tkhd_payload, tkhd_payload.len() - 8)? >> 16;
    let height = read_u32(tkhd_payload, tkhd_payload.len() - 4)? >> 16;
    if width == 0 || height == 0 || width > 8192 || height > 8192 {
        return Err(());
    }
    let mdia = child(&trak_children, b"mdia")?;
    let mdia_children = parse_boxes(bytes, mdia.content_start, mdia.end)?;
    let hdlr = child(&mdia_children, b"hdlr")?;
    if bytes.get(hdlr.content_start + 8..hdlr.content_start + 12) != Some(b"vide") {
        return Err(());
    }
    let minf = child(&mdia_children, b"minf")?;
    let minf_children = parse_boxes(bytes, minf.content_start, minf.end)?;
    let stbl = child(&minf_children, b"stbl")?;
    validate_sample_table(bytes, stbl, mdat, width, height)
}

fn validate_sample_table(
    bytes: &[u8],
    stbl: &Mp4BoxView,
    mdat: &Mp4BoxView,
    width: u32,
    height: u32,
) -> Result<(), ()> {
    let boxes = parse_boxes(bytes, stbl.content_start, stbl.end)?;
    let stsd = child(&boxes, b"stsd")?;
    let stts = child(&boxes, b"stts")?;
    let stsc = child(&boxes, b"stsc")?;
    let stsz = child(&boxes, b"stsz")?;
    let stss = child(&boxes, b"stss")?;
    let offsets = boxes
        .iter()
        .find(|item| matches!(&item.kind, b"stco" | b"co64"))
        .ok_or(())?;
    validate_stsd(bytes, stsd, width, height)?;
    validate_table_count(bytes, stts, 8)?;
    validate_table_count(bytes, stsc, 12)?;
    let stsz_payload = &bytes[stsz.content_start..stsz.end];
    if stsz_payload.len() < 12 {
        return Err(());
    }
    let sample_size = usize::try_from(read_u32(stsz_payload, 4)?).map_err(|_| ())?;
    let sample_count = usize::try_from(read_u32(stsz_payload, 8)?).map_err(|_| ())?;
    if sample_count == 0 || sample_count > 100_000 {
        return Err(());
    }
    let total_samples = if sample_size == 0 {
        if stsz_payload.len() != 12 + sample_count.checked_mul(4).ok_or(())? {
            return Err(());
        }
        (0..sample_count).try_fold(0_usize, |total, index| {
            let size = usize::try_from(read_u32(stsz_payload, 12 + index * 4)?).map_err(|_| ())?;
            if size == 0 {
                return Err(());
            }
            total.checked_add(size).ok_or(())
        })?
    } else {
        sample_size.checked_mul(sample_count).ok_or(())?
    };
    if total_samples == 0 || total_samples > mdat.end - mdat.content_start {
        return Err(());
    }
    let stss_payload = &bytes[stss.content_start..stss.end];
    if stss_payload.len() < 12 || read_u32(stss_payload, 4)? == 0 || read_u32(stss_payload, 8)? != 1
    {
        return Err(());
    }
    validate_chunk_offsets(bytes, offsets, mdat)
}

fn validate_table_count(bytes: &[u8], value: &Mp4BoxView, entry_bytes: usize) -> Result<(), ()> {
    let payload = &bytes[value.content_start..value.end];
    if payload.len() < 8 {
        return Err(());
    }
    let count = usize::try_from(read_u32(payload, 4)?).map_err(|_| ())?;
    if count == 0
        || count > 100_000
        || payload.len() < 8 + count.checked_mul(entry_bytes).ok_or(())?
    {
        return Err(());
    }
    Ok(())
}

fn validate_stsd(bytes: &[u8], stsd: &Mp4BoxView, width: u32, height: u32) -> Result<(), ()> {
    let payload = &bytes[stsd.content_start..stsd.end];
    if payload.len() < 16 || read_u32(payload, 4)? != 1 {
        return Err(());
    }
    let entries = parse_boxes(payload, 8, payload.len())?;
    let avc1 = child(&entries, b"avc1")?;
    let sample = &payload[avc1.content_start..avc1.end];
    if sample.len() < 78
        || u32::from(u16::from_be_bytes(
            sample[24..26].try_into().map_err(|_| ())?,
        )) != width
        || u32::from(u16::from_be_bytes(
            sample[26..28].try_into().map_err(|_| ())?,
        )) != height
    {
        return Err(());
    }
    let children = parse_boxes(payload, avc1.content_start + 78, avc1.end)?;
    let avcc = child(&children, b"avcC")?;
    if avcc.end - avcc.content_start < 7 || payload[avcc.content_start] != 1 {
        return Err(());
    }
    Ok(())
}

fn validate_chunk_offsets(bytes: &[u8], value: &Mp4BoxView, mdat: &Mp4BoxView) -> Result<(), ()> {
    let payload = &bytes[value.content_start..value.end];
    if payload.len() < 8 {
        return Err(());
    }
    let count = usize::try_from(read_u32(payload, 4)?).map_err(|_| ())?;
    let width = if value.kind == *b"stco" { 4 } else { 8 };
    if count == 0 || count > 100_000 || payload.len() != 8 + count.checked_mul(width).ok_or(())? {
        return Err(());
    }
    for index in 0..count {
        let offset = if width == 4 {
            u64::from(read_u32(payload, 8 + index * width)?)
        } else {
            read_u64(payload, 8 + index * width)?
        };
        let offset = usize::try_from(offset).map_err(|_| ())?;
        if offset < mdat.content_start || offset >= mdat.end {
            return Err(());
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_mp4_bytes() -> Vec<u8> {
    fn boxed(kind: &[u8; 4], payload: Vec<u8>) -> Vec<u8> {
        let size = u32::try_from(payload.len() + 8).unwrap();
        let mut result = Vec::with_capacity(payload.len() + 8);
        result.extend_from_slice(&size.to_be_bytes());
        result.extend_from_slice(kind);
        result.extend_from_slice(&payload);
        result
    }
    fn full_table(entries: &[[u32; 2]]) -> Vec<u8> {
        let mut payload = vec![0; 4];
        payload.extend_from_slice(&u32::try_from(entries.len()).unwrap().to_be_bytes());
        for entry in entries {
            payload.extend_from_slice(&entry[0].to_be_bytes());
            payload.extend_from_slice(&entry[1].to_be_bytes());
        }
        payload
    }
    fn build_moov(chunk_offset: u32) -> Vec<u8> {
        let mut mvhd = vec![0; 12];
        mvhd.extend_from_slice(&1_000_u32.to_be_bytes());
        mvhd.extend_from_slice(&120_u32.to_be_bytes());

        let mut tkhd = vec![0; 12];
        tkhd.extend_from_slice(&(16_u32 << 16).to_be_bytes());
        tkhd.extend_from_slice(&(16_u32 << 16).to_be_bytes());

        let mut hdlr = vec![0; 8];
        hdlr.extend_from_slice(b"vide");

        let mut avc1_payload = vec![0; 78];
        avc1_payload[24..26].copy_from_slice(&16_u16.to_be_bytes());
        avc1_payload[26..28].copy_from_slice(&16_u16.to_be_bytes());
        avc1_payload.extend_from_slice(&boxed(b"avcC", vec![1, 100, 0, 10, 0xff, 0xe1, 0]));
        let avc1 = boxed(b"avc1", avc1_payload);
        let mut stsd_payload = vec![0; 4];
        stsd_payload.extend_from_slice(&1_u32.to_be_bytes());
        stsd_payload.extend_from_slice(&avc1);

        let stts = boxed(b"stts", full_table(&[[1, 120]]));
        let mut stsc_payload = vec![0; 4];
        stsc_payload.extend_from_slice(&1_u32.to_be_bytes());
        stsc_payload.extend_from_slice(&1_u32.to_be_bytes());
        stsc_payload.extend_from_slice(&1_u32.to_be_bytes());
        stsc_payload.extend_from_slice(&1_u32.to_be_bytes());
        let mut stsz_payload = vec![0; 4];
        stsz_payload.extend_from_slice(&4_u32.to_be_bytes());
        stsz_payload.extend_from_slice(&1_u32.to_be_bytes());
        let mut stss_payload = vec![0; 4];
        stss_payload.extend_from_slice(&1_u32.to_be_bytes());
        stss_payload.extend_from_slice(&1_u32.to_be_bytes());
        let mut stco_payload = vec![0; 4];
        stco_payload.extend_from_slice(&1_u32.to_be_bytes());
        stco_payload.extend_from_slice(&chunk_offset.to_be_bytes());

        let mut stbl_payload = Vec::new();
        stbl_payload.extend_from_slice(&boxed(b"stsd", stsd_payload));
        stbl_payload.extend_from_slice(&stts);
        stbl_payload.extend_from_slice(&boxed(b"stsc", stsc_payload));
        stbl_payload.extend_from_slice(&boxed(b"stsz", stsz_payload));
        stbl_payload.extend_from_slice(&boxed(b"stss", stss_payload));
        stbl_payload.extend_from_slice(&boxed(b"stco", stco_payload));
        let minf = boxed(b"minf", boxed(b"stbl", stbl_payload));
        let mut mdia_payload = boxed(b"hdlr", hdlr);
        mdia_payload.extend_from_slice(&minf);
        let mut trak_payload = boxed(b"tkhd", tkhd);
        trak_payload.extend_from_slice(&boxed(b"mdia", mdia_payload));
        let mut moov_payload = boxed(b"mvhd", mvhd);
        moov_payload.extend_from_slice(&boxed(b"trak", trak_payload));
        boxed(b"moov", moov_payload)
    }

    let ftyp = boxed(b"ftyp", b"isom\0\0\0\0avc1".to_vec());
    let placeholder = build_moov(0);
    let chunk_offset = u32::try_from(ftyp.len() + placeholder.len() + 8).unwrap();
    let moov = build_moov(chunk_offset);
    let mut bytes = ftyp;
    bytes.extend_from_slice(&moov);
    bytes.extend_from_slice(&boxed(b"mdat", vec![1, 2, 3, 4]));
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;

    fn identity(artifact_id: Uuid) -> ReadyVideoIdentity {
        ReadyVideoIdentity {
            owner_user_id: Uuid::now_v7(),
            tenant_id: Uuid::now_v7(),
            session_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
            artifact_id,
        }
    }

    fn content(artifact_id: Uuid, size: usize) -> ReadyVideoContent {
        ReadyVideoContent {
            identity: identity(artifact_id),
            display_name: Some("synthetic.mp4".to_owned()),
            media_type: "video/mp4",
            size_bytes: size,
            sha256: [7; 32],
            bytes: vec![0; size],
        }
    }

    #[test]
    fn parses_full_closed_open_suffix_and_rejects_invalid_ranges() {
        assert_eq!(parse_single_range(None, 1_642), Ok(RequestedRange::Full));
        assert_eq!(
            parse_single_range(Some("bytes=10-19"), 100),
            Ok(RequestedRange::Slice { start: 10, end: 19 })
        );
        assert_eq!(
            parse_single_range(Some("bytes=90-"), 100),
            Ok(RequestedRange::Slice { start: 90, end: 99 })
        );
        assert_eq!(
            parse_single_range(Some("bytes=-8"), 100),
            Ok(RequestedRange::Slice { start: 92, end: 99 })
        );
        for invalid in [
            "bytes=",
            "bytes=1-2,4-5",
            "bytes=100-",
            "bytes=-0",
            "items=0-1",
            "bytes=4-2",
        ] {
            assert_eq!(parse_single_range(Some(invalid), 100), Err(()), "{invalid}");
        }
    }

    #[test]
    fn registry_is_independent_multi_request_bounded_and_expiring() {
        let epoch = Uuid::now_v7();
        let mut registry = VideoPreviewRegistry::new(epoch);
        let first = content(Uuid::now_v7(), 1_642);
        let handle = registry
            .issue(MAIN_WEBVIEW, Uuid::now_v7(), &first, 1_000)
            .unwrap();
        assert_eq!(handle.len(), 43);
        let request = registry
            .begin_request(&handle, MAIN_WEBVIEW, 1_001)
            .unwrap();
        assert!(request.requires_full_validation);
        registry.complete_success(&request, 1_001);
        let next = registry
            .begin_request(&handle, MAIN_WEBVIEW, 1_002)
            .unwrap();
        assert!(!next.requires_full_validation);
        registry.complete_success(&next, 1_002);
        assert_eq!(registry.active_count(), 1);
        registry.remove_expired(1_302);
        assert_eq!(registry.active_count(), 0);
    }

    #[test]
    fn registry_enforces_one_per_artifact_two_per_webview_and_restart_binding() {
        let epoch = Uuid::now_v7();
        let mut registry = VideoPreviewRegistry::new(epoch);
        let context_id = Uuid::now_v7();
        let first = content(Uuid::now_v7(), 10);
        registry
            .issue(MAIN_WEBVIEW, context_id, &first, 10)
            .unwrap();
        assert_eq!(
            registry.issue(MAIN_WEBVIEW, context_id, &first, 10),
            Err(ArtifactNativeCode::Conflict)
        );
        let second = content(Uuid::now_v7(), 10);
        registry
            .issue(MAIN_WEBVIEW, context_id, &second, 10)
            .unwrap();
        assert_eq!(
            registry.issue(MAIN_WEBVIEW, context_id, &content(Uuid::now_v7(), 10), 10,),
            Err(ArtifactNativeCode::LimitExceeded)
        );
        let restarted = VideoPreviewRegistry::new(Uuid::now_v7());
        assert_eq!(restarted.active_count(), 0);
    }

    #[test]
    fn registry_supports_playback_range_volume_until_lifecycle_revocation() {
        let epoch = Uuid::now_v7();
        let mut registry = VideoPreviewRegistry::new(epoch);
        let context_id = Uuid::now_v7();
        let video = content(Uuid::now_v7(), 10);
        let handle = registry
            .issue(MAIN_WEBVIEW, context_id, &video, 10)
            .unwrap();
        for now in 11..139 {
            let request = registry.begin_request(&handle, MAIN_WEBVIEW, now).unwrap();
            registry.complete_success(&request, now);
        }
        assert_eq!(registry.active_count(), 1);
        assert_eq!(
            registry.begin_request(&handle, "secondary", 139),
            Err(ArtifactNativeCode::NotFound)
        );
        assert_eq!(registry.active_count(), 1);

        registry.release(
            MAIN_WEBVIEW,
            context_id,
            ArtifactLocator {
                session_id: video.identity.session_id,
                turn_id: video.identity.turn_id,
                artifact_id: video.identity.artifact_id,
            },
            140,
        );
        assert_eq!(registry.active_count(), 0);
        assert_eq!(
            registry.begin_request(&handle, MAIN_WEBVIEW, 140),
            Err(ArtifactNativeCode::NotFound)
        );

        let idle_handle = registry
            .issue(MAIN_WEBVIEW, context_id, &video, 1_000)
            .unwrap();
        assert_eq!(registry.active_count(), 1);
        registry.remove_expired(1_300);
        assert_eq!(registry.active_count(), 0);
        assert_eq!(
            registry.begin_request(&idle_handle, MAIN_WEBVIEW, 1_300),
            Err(ArtifactNativeCode::NotFound)
        );

        let absolute_handle = registry
            .issue(MAIN_WEBVIEW, context_id, &video, 2_000)
            .unwrap();
        for now in [2_299, 2_598, 2_897, 3_196, 3_495, 3_794] {
            let request = registry
                .begin_request(&absolute_handle, MAIN_WEBVIEW, now)
                .unwrap();
            registry.complete_success(&request, now);
        }
        registry.remove_expired(3_800);
        assert_eq!(registry.active_count(), 0);

        registry
            .issue(MAIN_WEBVIEW, context_id, &video, 4_000)
            .unwrap();
        registry.invalidate_context(context_id);
        assert_eq!(registry.active_count(), 0);

        registry
            .issue(MAIN_WEBVIEW, context_id, &video, 5_000)
            .unwrap();
        registry.invalidate_webview(MAIN_WEBVIEW);
        assert_eq!(registry.active_count(), 0);

        registry
            .issue(MAIN_WEBVIEW, context_id, &video, 6_000)
            .unwrap();
        let restarted = VideoPreviewRegistry::new(Uuid::now_v7());
        assert_ne!(restarted.process_epoch, epoch);
        assert_eq!(restarted.active_count(), 0);
    }

    #[test]
    fn limits_two_reads_and_sixty_four_mebibytes() {
        let mut limits = VideoReadLimits::default();
        let first = limits.reserve(32 * 1024 * 1024).unwrap();
        let second = limits.reserve(32 * 1024 * 1024).unwrap();
        assert_eq!(limits.reserve(1), Err(ArtifactNativeCode::LimitExceeded));
        limits.release(first);
        limits.release(second);
        assert_eq!(limits.total_bytes, 0);
    }

    #[test]
    fn protocol_responses_are_content_bounded_and_never_cors_enabled() {
        let response = protocol_success(
            vec![0; 10],
            100,
            RequestedRange::Slice { start: 10, end: 19 },
            false,
        );
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len(), 10);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 10-19/100"
        );
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert!(response.headers().get(header::ETAG).is_none());
        let head = protocol_success(Vec::new(), 100, RequestedRange::Full, true);
        assert_eq!(head.status(), StatusCode::OK);
        assert!(head.body().is_empty());
        assert_eq!(head.headers().get(header::CONTENT_LENGTH).unwrap(), "100");
        let invalid = protocol_range_not_satisfiable(100);
        assert_eq!(invalid.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert!(invalid.body().is_empty());
    }

    #[test]
    fn protocol_request_rejects_query_body_origin_and_unapproved_methods() {
        let handle = "A".repeat(43);
        let base = format!("{VIDEO_SCHEME}://{VIDEO_HOST}/v1/{handle}");
        assert!(validate_protocol_request(MAIN_WEBVIEW, "GET", &base, &[], &[]).is_ok());
        assert!(validate_protocol_request(MAIN_WEBVIEW, "HEAD", &base, &[], &[]).is_ok());
        assert!(validate_protocol_request(MAIN_WEBVIEW, "POST", &base, &[], &[]).is_err());
        assert!(
            validate_protocol_request(MAIN_WEBVIEW, "GET", &(base.clone() + "?x=1"), &[], &[])
                .is_err()
        );
        assert!(validate_protocol_request(MAIN_WEBVIEW, "GET", &base, &[], &[1]).is_err());
        assert!(validate_protocol_request(
            MAIN_WEBVIEW,
            "GET",
            &base,
            &[("Origin".to_owned(), "https://evil.example".to_owned())],
            &[],
        )
        .is_err());
    }

    #[test]
    fn rejects_malformed_or_transport_only_mp4() {
        assert!(validate_mp4(&[0_u8; 12]).is_err());
        let mut transport = Vec::new();
        transport.extend_from_slice(&16_u32.to_be_bytes());
        transport.extend_from_slice(b"ftyp");
        transport.extend_from_slice(b"isomavc1");
        transport.extend_from_slice(&9_u32.to_be_bytes());
        transport.extend_from_slice(b"mdatx");
        assert!(validate_mp4(&transport).is_err());
    }

    #[test]
    fn accepts_a_bounded_avc_sample_table() {
        assert!(validate_mp4(&test_mp4_bytes()).is_ok());
    }

    #[cfg(feature = "feat128-s7b-runtime")]
    #[test]
    fn runtime_diagnostics_are_content_free_monotonic_stage_counts() {
        let runtime = ArtifactVideoNativeRuntime::new();
        runtime.diagnose_request(
            "GET",
            &[
                ("Range".to_owned(), "bytes=0-1".to_owned()),
                ("Origin".to_owned(), "redacted".to_owned()),
            ],
        );
        runtime.diagnose_validation_error(ProtocolValidationError::Origin);
        runtime.diagnose_requested_range(RequestedRange::Slice { start: 0, end: 1 }, 100);
        runtime.diagnose_requested_range(RequestedRange::Slice { start: 0, end: 1 }, 100);
        let snapshot = runtime.diagnostics_snapshot();
        assert_eq!(snapshot.requests_total, 1);
        assert_eq!(snapshot.get_requests, 1);
        assert_eq!(snapshot.range_headers, 1);
        assert_eq!(snapshot.origin_headers, 1);
        assert_eq!(snapshot.validation_origin_rejected, 1);
        assert_eq!(snapshot.prefix_ranges, 2);
        assert_eq!(snapshot.distinct_ranges, 1);
        assert_eq!(snapshot.repeated_ranges, 1);
        let encoded = serde_json::to_string(&snapshot).unwrap();
        assert!(!encoded.contains("bytes=0-1"));
        assert!(!encoded.contains("redacted"));
        assert!(!encoded.contains("\"seenRanges\""));
    }

    #[test]
    fn save_names_and_targets_are_mp4_only() {
        assert_eq!(canonical_video_save_name(Some("clip")).unwrap(), "clip.mp4");
        assert_eq!(
            canonical_video_save_name(Some("clip.MP4")).unwrap(),
            "clip.MP4"
        );
        assert_eq!(
            normalized_video_target(Path::new("/tmp/clip.mov")),
            Err(ArtifactNativeCode::ExtensionMismatch)
        );
        assert_eq!(
            normalized_video_target(Path::new("/tmp/clip")).unwrap(),
            PathBuf::from("/tmp/clip.mp4")
        );
    }

    #[test]
    fn video_save_reuses_atomic_private_temp_and_cleans_normal_failures() {
        let root = std::env::temp_dir().join(format!("yijie-video-save-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let bytes = test_mp4_bytes();
        let sha256: [u8; 32] = Sha256::digest(&bytes).into();
        let epoch = Uuid::now_v7();
        let target = root.join("clip.mp4");
        atomic_save_content(&target, &bytes, bytes.len(), sha256, epoch).unwrap();
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(
            atomic_save_content(&root.join("bad.mp4"), &bytes, bytes.len(), [0; 32], epoch),
            Err(ArtifactNativeCode::IntegrityFailed)
        );
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o600
            );
            let link = root.join("link.mp4");
            symlink(&target, &link).unwrap();
            assert_eq!(
                atomic_save_content(&link, &bytes, bytes.len(), sha256, epoch),
                Err(ArtifactNativeCode::PermissionDenied)
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
