use super::artifact::{
    ReadyImageContent, ReadyImageIdentity, ReadyImageReadError, MAX_ARTIFACT_BYTES, MAX_IMAGE_BYTES,
};
use super::authorization::{AuthorizationFailure, ChatAction};
use super::{ChatError, ChatRuntime, ConversationApplication};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{self, header, Method, StatusCode};
use tauri::{Manager, State, WebviewWindow};
use uuid::Uuid;

const SCHEMA_VERSION: u8 = 1;
const MAIN_WEBVIEW: &str = "main";
const PREVIEW_SCHEME: &str = "yijie-artifact-preview";
const PREVIEW_HOST: &str = "localhost";
const PREVIEW_TTL_SECONDS: i64 = 30;
const MAX_HANDLES_PER_WEBVIEW: usize = 4;
const MAX_INFLIGHT_READS: usize = 2;
const MAX_INFLIGHT_BYTES: usize = 40 * 1024 * 1024;
const SAVE_CHUNK_BYTES: usize = 64 * 1024;
const NATIVE_IO_TIMEOUT_SECONDS: u64 = 10;
const TEMP_PREFIX: &str = ".yijie-artifact-save-";

type PreviewIdentity = ReadyImageIdentity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ArtifactNativeCode {
    InvalidRequest,
    Unauthenticated,
    Forbidden,
    NotFound,
    NotReady,
    Expired,
    Unsupported,
    IntegrityFailed,
    LimitExceeded,
    Conflict,
    ExtensionMismatch,
    DialogUnavailable,
    PermissionDenied,
    StorageFull,
    IoFailed,
    Unavailable,
}

impl ArtifactNativeCode {
    const ALL: [Self; 16] = [
        Self::InvalidRequest,
        Self::Unauthenticated,
        Self::Forbidden,
        Self::NotFound,
        Self::NotReady,
        Self::Expired,
        Self::Unsupported,
        Self::IntegrityFailed,
        Self::LimitExceeded,
        Self::Conflict,
        Self::ExtensionMismatch,
        Self::DialogUnavailable,
        Self::PermissionDenied,
        Self::StorageFull,
        Self::IoFailed,
        Self::Unavailable,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "artifact_native_invalid_request",
            Self::Unauthenticated => "artifact_native_unauthenticated",
            Self::Forbidden => "artifact_native_forbidden",
            Self::NotFound => "artifact_native_not_found",
            Self::NotReady => "artifact_native_not_ready",
            Self::Expired => "artifact_native_expired",
            Self::Unsupported => "artifact_native_unsupported",
            Self::IntegrityFailed => "artifact_native_integrity_failed",
            Self::LimitExceeded => "artifact_native_limit_exceeded",
            Self::Conflict => "artifact_native_conflict",
            Self::ExtensionMismatch => "artifact_native_extension_mismatch",
            Self::DialogUnavailable => "artifact_native_dialog_unavailable",
            Self::PermissionDenied => "artifact_native_permission_denied",
            Self::StorageFull => "artifact_native_storage_full",
            Self::IoFailed => "artifact_native_io_failed",
            Self::Unavailable => "artifact_native_unavailable",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactNativeError {
    schema_version: u8,
    request_id: Option<String>,
    code: &'static str,
    retryable: bool,
}

impl ArtifactNativeError {
    pub(crate) fn new(request_id: Option<Uuid>, code: ArtifactNativeCode) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            request_id: request_id.map(|value| value.to_string()),
            code: code.as_str(),
            retryable: false,
        }
    }
}

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
pub struct ArtifactNativeResponse<T> {
    schema_version: u8,
    request_id: String,
    data: T,
}

impl<T> ArtifactNativeResponse<T> {
    pub(crate) fn new(request_id: Uuid, data: T) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            request_id: request_id.to_string(),
            data,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPreviewResult {
    status: &'static str,
    preview_url: String,
}

#[derive(Debug, Serialize)]
pub struct ReleasePreviewResult {
    status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct SaveImageResult {
    status: &'static str,
    code: Option<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PreviewBinding {
    process_epoch: Uuid,
    webview_label: String,
    context_id: Uuid,
    identity: PreviewIdentity,
    expected_media_type: &'static str,
    expected_size: usize,
    expected_sha256: [u8; 32],
    expires_at: i64,
}

#[derive(Clone, Copy)]
struct PreviewExpectation {
    media_type: &'static str,
    size: usize,
    sha256: [u8; 32],
}

struct PreviewRegistry {
    process_epoch: Uuid,
    entries: HashMap<String, PreviewBinding>,
}

impl PreviewRegistry {
    fn new(process_epoch: Uuid) -> Self {
        Self {
            process_epoch,
            entries: HashMap::new(),
        }
    }

    #[cfg(test)]
    fn issue(
        &mut self,
        webview_label: &str,
        context_id: Uuid,
        identity: PreviewIdentity,
        expected_size: usize,
        now: i64,
    ) -> Result<String, ArtifactNativeCode> {
        self.issue_validated(
            webview_label,
            context_id,
            identity,
            PreviewExpectation {
                media_type: "image/png",
                size: expected_size,
                sha256: [0_u8; 32],
            },
            now,
        )
    }

    fn issue_validated(
        &mut self,
        webview_label: &str,
        context_id: Uuid,
        identity: PreviewIdentity,
        expectation: PreviewExpectation,
        now: i64,
    ) -> Result<String, ArtifactNativeCode> {
        self.remove_expired(now);
        if self
            .entries
            .values()
            .any(|entry| entry.webview_label == webview_label && entry.identity == identity)
        {
            return Err(ArtifactNativeCode::Conflict);
        }
        if self
            .entries
            .values()
            .filter(|entry| entry.webview_label == webview_label)
            .count()
            >= MAX_HANDLES_PER_WEBVIEW
        {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        let expires_at = now
            .checked_add(PREVIEW_TTL_SECONDS)
            .ok_or(ArtifactNativeCode::InvalidRequest)?;
        for _ in 0..8 {
            let mut random = [0_u8; 32];
            getrandom::fill(&mut random).map_err(|_| ArtifactNativeCode::Unavailable)?;
            let handle = URL_SAFE_NO_PAD.encode(random);
            if self.entries.contains_key(&handle) {
                continue;
            }
            self.entries.insert(
                handle.clone(),
                PreviewBinding {
                    process_epoch: self.process_epoch,
                    webview_label: webview_label.to_owned(),
                    context_id,
                    identity,
                    expected_media_type: expectation.media_type,
                    expected_size: expectation.size,
                    expected_sha256: expectation.sha256,
                    expires_at,
                },
            );
            return Ok(handle);
        }
        Err(ArtifactNativeCode::Unavailable)
    }

    fn consume(
        &mut self,
        handle: &str,
        webview_label: &str,
        now: i64,
    ) -> Result<PreviewBinding, ArtifactNativeCode> {
        self.remove_expired(now);
        let Some(binding) = self.entries.get(handle) else {
            return Err(ArtifactNativeCode::NotFound);
        };
        if binding.process_epoch != self.process_epoch || binding.webview_label != webview_label {
            return Err(ArtifactNativeCode::NotFound);
        }
        self.entries
            .remove(handle)
            .ok_or(ArtifactNativeCode::NotFound)
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

    fn remove_expired(&mut self, now: i64) {
        self.entries.retain(|_, entry| entry.expires_at > now);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ReadReservation {
    id: u64,
    bytes: usize,
}

#[derive(Default)]
struct InflightReadLimits {
    next_id: u64,
    reservations: HashMap<u64, usize>,
    total_bytes: usize,
}

impl InflightReadLimits {
    fn reserve(&mut self, bytes: usize) -> Result<ReadReservation, ArtifactNativeCode> {
        let next_bytes = self
            .total_bytes
            .checked_add(bytes)
            .ok_or(ArtifactNativeCode::LimitExceeded)?;
        if bytes == 0
            || bytes > MAX_IMAGE_BYTES
            || self.reservations.len() >= MAX_INFLIGHT_READS
            || next_bytes > MAX_INFLIGHT_BYTES
        {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let reservation = ReadReservation {
            id: self.next_id,
            bytes,
        };
        self.reservations.insert(reservation.id, bytes);
        self.total_bytes = next_bytes;
        Ok(reservation)
    }

    fn release(&mut self, reservation: ReadReservation) {
        if self.reservations.remove(&reservation.id) == Some(reservation.bytes) {
            self.total_bytes = self.total_bytes.saturating_sub(reservation.bytes);
        }
    }
}

pub struct ArtifactNativeRuntime {
    process_epoch: Uuid,
    registry: Mutex<PreviewRegistry>,
    reads: Mutex<InflightReadLimits>,
    active_saves: Mutex<HashSet<PreviewIdentity>>,
}

impl ArtifactNativeRuntime {
    pub fn new() -> Self {
        debug_assert_eq!(ArtifactNativeCode::ALL.len(), 16);
        let process_epoch = Uuid::now_v7();
        Self {
            process_epoch,
            registry: Mutex::new(PreviewRegistry::new(process_epoch)),
            reads: Mutex::new(InflightReadLimits::default()),
            active_saves: Mutex::new(HashSet::new()),
        }
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
        content: &ReadyImageContent,
        now: i64,
    ) -> Result<String, ArtifactNativeCode> {
        self.registry
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .issue_validated(
                webview_label,
                context_id,
                content.identity,
                PreviewExpectation {
                    media_type: content.media_type,
                    size: content.size_bytes,
                    sha256: content.sha256,
                },
                now,
            )
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

    fn consume(
        &self,
        handle: &str,
        webview_label: &str,
        now: i64,
    ) -> Result<PreviewBinding, ArtifactNativeCode> {
        self.registry
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?
            .consume(handle, webview_label, now)
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

    fn begin_save(&self, identity: PreviewIdentity) -> Result<SaveLease<'_>, ArtifactNativeCode> {
        let mut active_saves = self
            .active_saves
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?;
        if !active_saves.insert(identity) {
            return Err(ArtifactNativeCode::Conflict);
        }
        Ok(SaveLease {
            runtime: self,
            identity,
        })
    }
}

struct SaveLease<'a> {
    runtime: &'a ArtifactNativeRuntime,
    identity: PreviewIdentity,
}

impl Drop for SaveLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut active_saves) = self.runtime.active_saves.lock() {
            active_saves.remove(&self.identity);
        }
    }
}

impl Default for ArtifactNativeRuntime {
    fn default() -> Self {
        Self::new()
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
        ChatError::ProjectionLimitExceeded => ArtifactNativeCode::LimitExceeded,
        ChatError::NotFound => ArtifactNativeCode::NotFound,
        ChatError::ConversationConflict | ChatError::ProjectionReconciliationFailed => {
            ArtifactNativeCode::Conflict
        }
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

fn map_read_error(error: ReadyImageReadError) -> ArtifactNativeCode {
    match error {
        ReadyImageReadError::NotFound => ArtifactNativeCode::NotFound,
        ReadyImageReadError::NotReady => ArtifactNativeCode::NotReady,
        ReadyImageReadError::Expired => ArtifactNativeCode::Expired,
        ReadyImageReadError::Unsupported => ArtifactNativeCode::Unsupported,
        ReadyImageReadError::Integrity => ArtifactNativeCode::IntegrityFailed,
    }
}

async fn authorized_image(
    chat_runtime: &ChatRuntime,
    context_id: Uuid,
    locator: ArtifactLocator,
    now: i64,
) -> Result<ReadyImageContent, ArtifactNativeCode> {
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
        application.read_ready_image(
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

#[tauri::command]
pub async fn chat_open_artifact_image_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    artifact_runtime: State<'_, ArtifactNativeRuntime>,
) -> Result<ArtifactNativeResponse<OpenPreviewResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let content = authorized_image(&chat_runtime, request.context_id, request.payload, now)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let handle = artifact_runtime
        .issue(webview.label(), request.context_id, &content, now)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let expiry_app = webview.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(
            u64::try_from(PREVIEW_TTL_SECONDS).unwrap_or(30),
        ))
        .await;
        if let Ok(now) = unix_seconds() {
            expiry_app
                .state::<ArtifactNativeRuntime>()
                .expire_handles(now);
        }
    });
    Ok(ArtifactNativeResponse::new(
        request.request_id,
        OpenPreviewResult {
            status: "opened",
            preview_url: format!("{PREVIEW_SCHEME}://{PREVIEW_HOST}/v1/{handle}"),
        },
    ))
}

#[tauri::command]
pub async fn chat_release_artifact_image_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    artifact_runtime: State<'_, ArtifactNativeRuntime>,
) -> Result<ArtifactNativeResponse<ReleasePreviewResult>, ArtifactNativeError> {
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
            ))
        }
        Err(AuthorizationFailure::CapabilityDenied) => {
            return Err(ArtifactNativeError::new(
                Some(request.request_id),
                ArtifactNativeCode::Forbidden,
            ))
        }
    }
    artifact_runtime
        .release(webview.label(), request.context_id, request.payload, now)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    Ok(ArtifactNativeResponse::new(
        request.request_id,
        ReleasePreviewResult { status: "released" },
    ))
}

#[tauri::command]
pub async fn chat_save_artifact_image_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    artifact_runtime: State<'_, ArtifactNativeRuntime>,
) -> Result<ArtifactNativeResponse<SaveImageResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_image(&chat_runtime, request.context_id, request.payload, now)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let _save_lease = artifact_runtime
        .begin_save(first.identity)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;

    let default_name = canonical_save_name(first.display_name.as_deref(), first.media_type)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let selected = pick_native_save_target(&default_name, first.media_type)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let Some(selected) = selected else {
        return Ok(ArtifactNativeResponse::new(
            request.request_id,
            SaveImageResult {
                status: "cancelled",
                code: None,
            },
        ));
    };
    let target = match normalized_target(&selected, first.media_type) {
        Ok(target) => target,
        Err(code) => {
            return Ok(ArtifactNativeResponse::new(
                request.request_id,
                SaveImageResult {
                    status: "failed",
                    code: Some(code.as_str()),
                },
            ))
        }
    };
    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_image(
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
            let process_epoch = artifact_runtime.process_epoch;
            move || atomic_save(&target, &second, process_epoch)
        }),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)
    .and_then(|joined| joined.map_err(|_| ArtifactNativeCode::Unavailable))
    .and_then(|result| result);
    let outcome = match save {
        Ok(()) => SaveImageResult {
            status: "saved",
            code: None,
        },
        Err(code) => SaveImageResult {
            status: "failed",
            code: Some(code.as_str()),
        },
    };
    Ok(ArtifactNativeResponse::new(request.request_id, outcome))
}

fn canonical_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
async fn pick_native_save_target(
    default_name: &str,
    media_type: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    let extension = canonical_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    Ok(rfd::AsyncFileDialog::new()
        .set_file_name(default_name)
        .add_filter("Image", &[extension])
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf()))
}

#[cfg(not(target_os = "macos"))]
async fn pick_native_save_target(
    _default_name: &str,
    _media_type: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    Err(ArtifactNativeCode::DialogUnavailable)
}

fn canonical_save_name(
    display_name: Option<&str>,
    media_type: &str,
) -> Result<String, ArtifactNativeCode> {
    let extension = canonical_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    let name = display_name.unwrap_or("artifact");
    if name.is_empty()
        || name.len() > 255
        || name
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | '\0'))
    {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    let path = Path::new(name);
    let existing = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if existing.as_deref() == Some(extension) {
        return Ok(name.to_owned());
    }
    if media_type == "image/jpeg" && existing.as_deref() == Some("jpeg") {
        return Ok(path.with_extension("jpg").to_string_lossy().into_owned());
    }
    Ok(format!("{name}.{extension}"))
}

fn validate_target_extension(target: &Path, media_type: &str) -> Result<(), ArtifactNativeCode> {
    let expected = canonical_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    match target
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
    {
        Some(actual) if actual == expected => Ok(()),
        Some(_) => Err(ArtifactNativeCode::ExtensionMismatch),
        None => Ok(()),
    }
}

fn normalized_target(target: &Path, media_type: &str) -> Result<PathBuf, ArtifactNativeCode> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err(ArtifactNativeCode::InvalidRequest);
    }
    validate_target_extension(target, media_type)?;
    if target.extension().is_none() {
        Ok(target.with_extension(
            canonical_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?,
        ))
    } else {
        Ok(target.to_path_buf())
    }
}

struct TempFileGuard {
    path: PathBuf,
    armed: bool,
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn map_io_error(error: &io::Error) -> ArtifactNativeCode {
    if error.kind() == io::ErrorKind::PermissionDenied {
        ArtifactNativeCode::PermissionDenied
    } else if error.raw_os_error() == Some(libc::ENOSPC) {
        ArtifactNativeCode::StorageFull
    } else {
        ArtifactNativeCode::IoFailed
    }
}

fn atomic_save(
    target: &Path,
    content: &ReadyImageContent,
    process_epoch: Uuid,
) -> Result<(), ArtifactNativeCode> {
    atomic_save_content(
        target,
        &content.bytes,
        content.size_bytes,
        content.sha256,
        process_epoch,
    )
}

pub(crate) fn atomic_save_content(
    target: &Path,
    bytes: &[u8],
    size_bytes: usize,
    sha256: [u8; 32],
    process_epoch: Uuid,
) -> Result<(), ArtifactNativeCode> {
    let parent = target.parent().ok_or(ArtifactNativeCode::InvalidRequest)?;
    let parent_metadata = fs::metadata(parent).map_err(|error| map_io_error(&error))?;
    if !parent_metadata.is_dir() {
        return Err(ArtifactNativeCode::PermissionDenied);
    }
    cleanup_verified_stale_temp_files(parent, process_epoch);
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ArtifactNativeCode::PermissionDenied)
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io_error(&error)),
    }
    let (temp_path, mut temp_file) = create_temp_file(parent, process_epoch)?;
    let mut guard = TempFileGuard {
        path: temp_path.clone(),
        armed: true,
    };
    let mut digest = Sha256::new();
    let mut written = 0_usize;
    for chunk in bytes.chunks(SAVE_CHUNK_BYTES) {
        temp_file
            .write_all(chunk)
            .map_err(|error| map_io_error(&error))?;
        digest.update(chunk);
        written = written
            .checked_add(chunk.len())
            .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    }
    let actual_sha256: [u8; 32] = digest.finalize().into();
    if written != size_bytes
        || !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            sha256.as_slice(),
        ))
    {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    temp_file.sync_all().map_err(|error| map_io_error(&error))?;
    drop(temp_file);
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ArtifactNativeCode::PermissionDenied)
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io_error(&error)),
    }
    fs::rename(&temp_path, target).map_err(|error| map_io_error(&error))?;
    guard.armed = false;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| map_io_error(&error))?;
    Ok(())
}

fn create_temp_file(
    parent: &Path,
    process_epoch: Uuid,
) -> Result<(PathBuf, File), ArtifactNativeCode> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    for _ in 0..16 {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| ArtifactNativeCode::Unavailable)?;
        let path = parent.join(format!(
            "{TEMP_PREFIX}{process_epoch}-{}.tmp",
            URL_SAFE_NO_PAD.encode(random)
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(map_io_error(&error)),
        }
    }
    Err(ArtifactNativeCode::Conflict)
}

fn cleanup_verified_stale_temp_files(parent: &Path, process_epoch: Uuid) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !verified_stale_temp_file(&path, process_epoch) {
            continue;
        }
        let _ = fs::remove_file(path);
    }
}

fn verified_stale_temp_file(path: &Path, process_epoch: Uuid) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(remainder) = name
        .strip_prefix(TEMP_PREFIX)
        .and_then(|value| value.strip_suffix(".tmp"))
    else {
        return false;
    };
    if remainder.len() != 59 || remainder.as_bytes().get(36) != Some(&b'-') {
        return false;
    }
    let Ok(epoch) = Uuid::parse_str(&remainder[..36]) else {
        return false;
    };
    let random = &remainder[37..];
    if epoch == process_epoch
        || random.len() != 22
        || random
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'-' | b'_'))
    {
        return false;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES as u64 {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: `geteuid` has no pointer arguments or caller preconditions.
        let effective_user = unsafe { libc::geteuid() };
        if metadata.mode() & 0o777 != 0o600
            || metadata.nlink() != 1
            || metadata.uid() != effective_user
        {
            return false;
        }
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    let Some(media_type) = infer::get(&bytes).map(|kind| kind.mime_type()) else {
        return false;
    };
    if matches!(media_type, "image/png" | "image/jpeg" | "image/webp") {
        super::attachment::validate_image_content(media_type, &bytes).is_ok()
    } else {
        media_type == "video/mp4" && super::artifact_video_native::validate_mp4(&bytes).is_ok()
    }
}

fn validate_protocol_request(
    webview_label: &str,
    method: &str,
    uri: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<String, ArtifactNativeCode> {
    if webview_label != MAIN_WEBVIEW || method != Method::GET.as_str() || !body.is_empty() {
        return Err(ArtifactNativeCode::NotFound);
    }
    if headers.iter().any(|(name, _)| {
        matches!(
            name.to_ascii_lowercase().as_str(),
            "range" | "origin" | "content-length" | "transfer-encoding"
        )
    }) {
        return Err(ArtifactNativeCode::NotFound);
    }
    let parsed = url::Url::parse(uri).map_err(|_| ArtifactNativeCode::NotFound)?;
    if parsed.scheme() != PREVIEW_SCHEME
        || parsed.host_str() != Some(PREVIEW_HOST)
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ArtifactNativeCode::NotFound);
    }
    let Some(handle) = parsed.path().strip_prefix("/v1/") else {
        return Err(ArtifactNativeCode::NotFound);
    };
    if handle.len() != 43
        || handle
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'-' | b'_'))
    {
        return Err(ArtifactNativeCode::NotFound);
    }
    Ok(handle.to_owned())
}

fn protocol_not_found() -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn protocol_success(content: ReadyImageContent) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content.media_type)
        .header(header::CONTENT_LENGTH, content.size_bytes.to_string())
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(content.bytes)
        .unwrap_or_else(|_| protocol_not_found())
}

pub fn handle_preview_protocol(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let webview_label = context.webview_label().to_owned();
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
    let handle = match validate_protocol_request(
        &webview_label,
        request.method().as_str(),
        &request.uri().to_string(),
        &headers,
        request.body(),
    ) {
        Ok(handle) => handle,
        Err(_) => {
            responder.respond(protocol_not_found());
            return;
        }
    };
    let app = context.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let artifact_runtime = app.state::<ArtifactNativeRuntime>();
        let now = match unix_seconds() {
            Ok(now) => now,
            Err(_) => {
                responder.respond(protocol_not_found());
                return;
            }
        };
        let binding = match artifact_runtime.consume(&handle, &webview_label, now) {
            Ok(binding) => binding,
            Err(_) => {
                responder.respond(protocol_not_found());
                return;
            }
        };
        let reservation = match artifact_runtime.reserve(binding.expected_size) {
            Ok(reservation) => reservation,
            Err(_) => {
                responder.respond(protocol_not_found());
                return;
            }
        };
        let locator = ArtifactLocator {
            session_id: binding.identity.session_id,
            turn_id: binding.identity.turn_id,
            artifact_id: binding.identity.artifact_id,
        };
        let content = authorized_image(
            app.state::<ChatRuntime>().inner(),
            binding.context_id,
            locator,
            now,
        )
        .await;
        artifact_runtime.release_reservation(reservation);
        let response = match content {
            Ok(content)
                if content.identity == binding.identity
                    && content.media_type == binding.expected_media_type
                    && content.size_bytes == binding.expected_size
                    && content.sha256 == binding.expected_sha256 =>
            {
                protocol_success(content)
            }
            _ => protocol_not_found(),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};
    use uuid::Uuid;

    fn identity(artifact_id: Uuid) -> PreviewIdentity {
        PreviewIdentity {
            owner_user_id: Uuid::now_v7(),
            tenant_id: Uuid::now_v7(),
            session_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
            artifact_id,
        }
    }

    fn ready_content() -> ReadyImageContent {
        let bytes = crate::chat::attachment::test_image_bytes("png");
        let sha256 = Sha256::digest(&bytes).into();
        ReadyImageContent {
            identity: identity(Uuid::now_v7()),
            display_name: Some("synthetic.png".to_owned()),
            media_type: "image/png",
            size_bytes: bytes.len(),
            sha256,
            bytes,
        }
    }

    #[test]
    fn handle_registry_is_256_bit_one_shot_scope_bound_and_bounded() {
        let mut registry = PreviewRegistry::new(Uuid::now_v7());
        let context_id = Uuid::now_v7();
        let first_identity = identity(Uuid::now_v7());
        let handle = registry
            .issue("main", context_id, first_identity, 1024, 100)
            .unwrap();
        assert_eq!(handle.len(), 43);
        assert!(handle
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')));
        assert_eq!(
            registry.consume(&handle, "foreign", 101).unwrap_err(),
            ArtifactNativeCode::NotFound
        );
        assert!(registry.consume(&handle, "main", 101).is_ok());
        assert_eq!(
            registry.consume(&handle, "main", 101).unwrap_err(),
            ArtifactNativeCode::NotFound
        );

        for _ in 0..4 {
            registry
                .issue("main", context_id, identity(Uuid::now_v7()), 1024, 200)
                .unwrap();
        }
        assert_eq!(
            registry
                .issue("main", context_id, identity(Uuid::now_v7()), 1024, 200)
                .unwrap_err(),
            ArtifactNativeCode::LimitExceeded
        );
    }

    #[test]
    fn registry_rejects_duplicate_artifact_ttl_context_and_restart_replay() {
        let process_epoch = Uuid::now_v7();
        let context_id = Uuid::now_v7();
        let artifact = identity(Uuid::now_v7());
        let mut registry = PreviewRegistry::new(process_epoch);
        let handle = registry
            .issue("main", context_id, artifact, 2048, 1_000)
            .unwrap();
        assert_eq!(
            registry.issue("main", Uuid::now_v7(), artifact, 2048, 1_001),
            Err(ArtifactNativeCode::Conflict)
        );
        assert_eq!(
            registry.consume(&handle, "main", 1_030),
            Err(ArtifactNativeCode::NotFound)
        );

        let handle = registry
            .issue("main", context_id, artifact, 2048, 2_000)
            .unwrap();
        registry.release(
            "main",
            context_id,
            ArtifactLocator {
                session_id: artifact.session_id,
                turn_id: artifact.turn_id,
                artifact_id: artifact.artifact_id,
            },
            2_001,
        );
        assert_eq!(
            registry.consume(&handle, "main", 2_001),
            Err(ArtifactNativeCode::NotFound)
        );

        let handle = registry
            .issue("main", context_id, artifact, 2048, 2_010)
            .unwrap();
        registry.invalidate_context(context_id);
        assert_eq!(
            registry.consume(&handle, "main", 2_011),
            Err(ArtifactNativeCode::NotFound)
        );

        let handle = registry
            .issue("main", context_id, artifact, 2048, 3_000)
            .unwrap();
        let mut restarted = PreviewRegistry::new(Uuid::now_v7());
        assert_eq!(
            restarted.consume(&handle, "main", 3_001),
            Err(ArtifactNativeCode::NotFound)
        );
    }

    #[test]
    fn read_limits_enforce_two_reads_and_forty_mib_without_eviction() {
        let mut limits = InflightReadLimits::default();
        let twenty_mib = 20 * 1024 * 1024;
        let first = limits.reserve(twenty_mib).unwrap();
        let second = limits.reserve(twenty_mib).unwrap();
        assert_eq!(limits.reserve(1), Err(ArtifactNativeCode::LimitExceeded));
        limits.release(first);
        limits.release(second);
        assert!(limits.reserve(1).is_ok());
    }

    #[test]
    fn protocol_validation_is_exact_and_oracle_free() {
        let handle = "A".repeat(43);
        let valid = format!("yijie-artifact-preview://localhost/v1/{handle}");
        assert_eq!(
            validate_protocol_request("main", "GET", &valid, &[], &[]),
            Ok(handle)
        );
        for (webview, method, uri, headers, body) in [
            ("foreign", "GET", valid.clone(), vec![], vec![]),
            ("main", "HEAD", valid.clone(), vec![], vec![]),
            ("main", "GET", format!("{valid}?x=1"), vec![], vec![]),
            (
                "main",
                "GET",
                valid.clone(),
                vec![("range".to_owned(), "bytes=0-1".to_owned())],
                vec![],
            ),
            ("main", "GET", valid.clone(), vec![], vec![1]),
        ] {
            assert!(validate_protocol_request(webview, method, &uri, &headers, &body).is_err());
        }
        let response = protocol_not_found();
        assert_eq!(response.status(), 404);
        assert!(response.body().is_empty());
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
        assert!(response.headers().get("location").is_none());

        let success = protocol_success(ready_content());
        assert_eq!(success.status(), 200);
        assert_eq!(
            success.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        assert_eq!(
            success.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        assert!(success
            .headers()
            .get("access-control-allow-origin")
            .is_none());
        assert!(success.headers().get("content-disposition").is_none());
    }

    #[test]
    fn native_errors_are_closed_and_content_free() {
        assert_eq!(ArtifactNativeCode::ALL.len(), 16);
        for code in ArtifactNativeCode::ALL {
            let encoded = serde_json::to_string(&ArtifactNativeError::new(None, code)).unwrap();
            assert_eq!(
                encoded,
                format!(
                    "{{\"schemaVersion\":1,\"requestId\":null,\"code\":\"{}\",\"retryable\":false}}",
                    code.as_str()
                )
            );
            assert!(!encoded.contains("path"));
            assert!(!encoded.contains("bytes"));
            assert!(!encoded.contains("digest"));
        }
    }

    #[test]
    fn save_name_and_atomic_target_fail_closed() {
        assert_eq!(
            canonical_save_name(Some("safe"), "image/png").unwrap(),
            "safe.png"
        );
        assert_eq!(
            canonical_save_name(Some("safe.jpeg"), "image/jpeg").unwrap(),
            "safe.jpg"
        );
        assert_eq!(
            validate_target_extension(std::path::Path::new("safe.webp"), "image/png"),
            Err(ArtifactNativeCode::ExtensionMismatch)
        );
    }

    #[test]
    fn native_save_is_atomic_overwrites_regular_file_and_keeps_authority() {
        let root = std::env::temp_dir().join(format!("yijie-native-save-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("result.png");
        fs::write(&target, b"old").unwrap();
        let content = ready_content();
        let authority_copy = content.bytes.clone();

        atomic_save(&target, &content, Uuid::now_v7()).unwrap();

        assert_eq!(fs::read(&target).unwrap(), authority_copy);
        assert_eq!(content.bytes, authority_copy);
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(fs::read_dir(&root).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(TEMP_PREFIX)
        }));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn native_save_rejects_symlink_and_nonregular_targets() {
        let root = std::env::temp_dir().join(format!("yijie-native-save-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let content = ready_content();
        let outside = root.join("outside.png");
        fs::write(&outside, b"outside").unwrap();
        let link = root.join("link.png");
        symlink(&outside, &link).unwrap();
        assert_eq!(
            atomic_save(&link, &content, Uuid::now_v7()),
            Err(ArtifactNativeCode::PermissionDenied)
        );
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        let directory_target = root.join("directory.png");
        fs::create_dir(&directory_target).unwrap();
        assert_eq!(
            atomic_save(&directory_target, &content, Uuid::now_v7()),
            Err(ArtifactNativeCode::PermissionDenied)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_save_integrity_and_io_failures_are_content_free_and_cleanup_temp() {
        let root = std::env::temp_dir().join(format!("yijie-native-save-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("result.png");
        let mut content = ready_content();
        let authority_copy = content.bytes.clone();
        content.sha256 = [0_u8; 32];
        assert_eq!(
            atomic_save(&target, &content, Uuid::now_v7()),
            Err(ArtifactNativeCode::IntegrityFailed)
        );
        assert_eq!(content.bytes, authority_copy);
        assert!(!target.exists());
        assert!(fs::read_dir(&root).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(TEMP_PREFIX)
        }));
        assert_eq!(
            map_io_error(&io::Error::from(io::ErrorKind::PermissionDenied)),
            ArtifactNativeCode::PermissionDenied
        );
        assert_eq!(
            map_io_error(&io::Error::from_raw_os_error(libc::ENOSPC)),
            ArtifactNativeCode::StorageFull
        );
        assert_eq!(
            map_io_error(&io::Error::from(io::ErrorKind::WriteZero)),
            ArtifactNativeCode::IoFailed
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn native_save_cleans_only_verified_prior_process_temp_files() {
        let root = std::env::temp_dir().join(format!("yijie-native-save-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let process_epoch = Uuid::now_v7();
        let prior_epoch = Uuid::now_v7();
        let prior = root.join(format!("{TEMP_PREFIX}{prior_epoch}-{}.tmp", "A".repeat(22)));
        let current = root.join(format!(
            "{TEMP_PREFIX}{process_epoch}-{}.tmp",
            "B".repeat(22)
        ));
        let image = crate::chat::attachment::test_image_bytes("png");
        fs::write(&prior, &image).unwrap();
        fs::write(&current, &image).unwrap();
        fs::set_permissions(&prior, fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&current, fs::Permissions::from_mode(0o600)).unwrap();

        atomic_save(&root.join("result.png"), &ready_content(), process_epoch).unwrap();

        assert!(!prior.exists());
        assert!(current.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_intent_is_single_flight_per_artifact() {
        let runtime = ArtifactNativeRuntime::new();
        let identity = identity(Uuid::now_v7());
        let lease = runtime.begin_save(identity).unwrap();
        assert!(matches!(
            runtime.begin_save(identity),
            Err(ArtifactNativeCode::Conflict)
        ));
        drop(lease);
        assert!(runtime.begin_save(identity).is_ok());
    }
}
