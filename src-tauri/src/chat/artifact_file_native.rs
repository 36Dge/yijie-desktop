use super::artifact::{
    ReadyFileContent, ReadyFileIdentity, ReadyFileReadError, MAX_ARTIFACT_BYTES,
};
use super::artifact_native::{ArtifactNativeCode, ArtifactNativeError, ArtifactNativeResponse};
use super::attachment::{validate_pdf_artifact_content, validate_xlsx_artifact_content};
use super::authorization::{AuthorizationFailure, ChatAction};
use super::{ChatError, ChatRuntime, ConversationApplication};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::{Debug, Formatter};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

const SCHEMA_VERSION: u8 = 1;
const MAIN_WEBVIEW: &str = "main";
const NATIVE_IO_TIMEOUT_SECONDS: u64 = 10;
const MAX_PREVIEW_SOURCE_BYTES: usize = 1_048_576;
const MAX_PROJECTION_BYTES: usize = 262_144;
const MAX_RESPONSE_BYTES: usize = 524_288;
const MAX_TEXT_LINES: usize = 2_000;
const MAX_TEXT_LINE_BYTES: usize = 8_192;
const MAX_CSV_ROWS: usize = 200;
const MAX_CSV_COLUMNS: usize = 50;
const MAX_CSV_CELL_BYTES: usize = 4_096;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 20_000;
const MAX_PREVIEW_OPERATIONS_PER_WEBVIEW: usize = 2;
const MAX_PREVIEW_SOURCE_BYTES_IN_FLIGHT: usize = 2_097_152;
const SAVE_CHUNK_BYTES: usize = 64 * 1024;
const FILE_TEMP_PREFIX: &str = ".yijie-artifact-file-save-v1-";

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

#[derive(Clone, PartialEq, Eq)]
enum FilePreviewProjection {
    Text {
        media_type: &'static str,
        text: String,
        truncated: bool,
    },
    Csv {
        rows: Vec<Vec<String>>,
        truncated: bool,
    },
}

impl Debug for FilePreviewProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Text {
                media_type,
                text,
                truncated,
            } => formatter
                .debug_struct("FilePreviewProjection::Text")
                .field("media_type", media_type)
                .field("text", &format_args!("[REDACTED; {} bytes]", text.len()))
                .field("truncated", truncated)
                .finish(),
            Self::Csv { rows, truncated } => formatter
                .debug_struct("FilePreviewProjection::Csv")
                .field("rows", &format_args!("[REDACTED; {} rows]", rows.len()))
                .field("truncated", truncated)
                .finish(),
        }
    }
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum FilePreviewResult {
    Text {
        status: &'static str,
        #[serde(rename = "mediaType")]
        media_type: &'static str,
        text: String,
        truncated: bool,
    },
    Csv {
        status: &'static str,
        #[serde(rename = "mediaType")]
        media_type: &'static str,
        rows: Vec<Vec<String>>,
        truncated: bool,
    },
}

impl From<FilePreviewProjection> for FilePreviewResult {
    fn from(value: FilePreviewProjection) -> Self {
        match value {
            FilePreviewProjection::Text {
                media_type,
                text,
                truncated,
            } => Self::Text {
                status: "previewed",
                media_type,
                text,
                truncated,
            },
            FilePreviewProjection::Csv { rows, truncated } => Self::Csv {
                status: "previewed",
                media_type: "text/csv",
                rows,
                truncated,
            },
        }
    }
}

#[derive(Serialize)]
pub struct SaveFileResult {
    status: &'static str,
    code: Option<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileRevision {
    identity: ReadyFileIdentity,
    media_type: &'static str,
    size_bytes: usize,
    sha256: [u8; 32],
    committed_at: i64,
}

impl From<&ReadyFileContent> for FileRevision {
    fn from(content: &ReadyFileContent) -> Self {
        Self {
            identity: content.identity,
            media_type: content.media_type,
            size_bytes: content.size_bytes,
            sha256: content.sha256,
            committed_at: content.revision,
        }
    }
}

#[derive(Default)]
struct FileOperationState {
    generation: u64,
    active_previews: HashMap<(String, ReadyFileIdentity), (usize, u64)>,
    active_saves: HashMap<(String, ReadyFileIdentity), u64>,
}

pub struct ArtifactFileNativeRuntime {
    process_epoch: Uuid,
    state: Mutex<FileOperationState>,
}

impl ArtifactFileNativeRuntime {
    pub fn new() -> Self {
        Self {
            process_epoch: Uuid::now_v7(),
            state: Mutex::new(FileOperationState::default()),
        }
    }

    pub fn invalidate_all(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.generation = state.generation.wrapping_add(1);
            state.active_previews.clear();
            state.active_saves.clear();
        }
    }

    pub fn invalidate_webview(&self, webview_label: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.generation = state.generation.wrapping_add(1);
            state
                .active_previews
                .retain(|(label, _), _| label != webview_label);
            state
                .active_saves
                .retain(|(label, _), _| label != webview_label);
        }
    }

    fn begin_preview(
        &self,
        webview_label: &str,
        identity: ReadyFileIdentity,
        source_bytes: usize,
    ) -> Result<FileOperationLease<'_>, ArtifactNativeCode> {
        if !(1..=MAX_PREVIEW_SOURCE_BYTES).contains(&source_bytes) {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?;
        let key = (webview_label.to_owned(), identity);
        if state.active_previews.contains_key(&key) {
            return Err(ArtifactNativeCode::Conflict);
        }
        let (operations, bytes) = state
            .active_previews
            .iter()
            .filter(|((label, _), _)| label == webview_label)
            .try_fold((0_usize, 0_usize), |(count, bytes), (_, (size, _))| {
                Some((count.checked_add(1)?, bytes.checked_add(*size)?))
            })
            .ok_or(ArtifactNativeCode::LimitExceeded)?;
        if operations >= MAX_PREVIEW_OPERATIONS_PER_WEBVIEW
            || bytes
                .checked_add(source_bytes)
                .is_none_or(|value| value > MAX_PREVIEW_SOURCE_BYTES_IN_FLIGHT)
        {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        let generation = state.generation;
        state
            .active_previews
            .insert(key, (source_bytes, generation));
        Ok(FileOperationLease {
            runtime: self,
            generation,
            webview_label: webview_label.to_owned(),
            identity,
            kind: FileOperationKind::Preview,
        })
    }

    fn begin_save(
        &self,
        webview_label: &str,
        identity: ReadyFileIdentity,
    ) -> Result<FileOperationLease<'_>, ArtifactNativeCode> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| ArtifactNativeCode::Unavailable)?;
        let key = (webview_label.to_owned(), identity);
        if state.active_saves.contains_key(&key) {
            return Err(ArtifactNativeCode::Conflict);
        }
        let generation = state.generation;
        state.active_saves.insert(key, generation);
        Ok(FileOperationLease {
            runtime: self,
            generation,
            webview_label: webview_label.to_owned(),
            identity,
            kind: FileOperationKind::Save,
        })
    }

    fn generation_is_current(&self, generation: u64) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.generation == generation)
    }
}

impl Default for ArtifactFileNativeRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
enum FileOperationKind {
    Preview,
    Save,
}

struct FileOperationLease<'a> {
    runtime: &'a ArtifactFileNativeRuntime,
    generation: u64,
    webview_label: String,
    identity: ReadyFileIdentity,
    kind: FileOperationKind,
}

impl FileOperationLease<'_> {
    fn ensure_current(&self) -> Result<(), ArtifactNativeCode> {
        if self.runtime.generation_is_current(self.generation) {
            Ok(())
        } else {
            Err(ArtifactNativeCode::Unauthenticated)
        }
    }
}

impl Drop for FileOperationLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.runtime.state.lock() {
            let key = (self.webview_label.clone(), self.identity);
            match self.kind {
                FileOperationKind::Preview => {
                    if state
                        .active_previews
                        .get(&key)
                        .is_some_and(|(_, generation)| *generation == self.generation)
                    {
                        state.active_previews.remove(&key);
                    }
                }
                FileOperationKind::Save => {
                    if state
                        .active_saves
                        .get(&key)
                        .is_some_and(|generation| *generation == self.generation)
                    {
                        state.active_saves.remove(&key);
                    }
                }
            }
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
    if serde_json::to_vec(&value).map_or(true, |encoded| encoded.len() > 4_096) {
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

fn map_read_error(error: ReadyFileReadError) -> ArtifactNativeCode {
    match error {
        ReadyFileReadError::NotFound => ArtifactNativeCode::NotFound,
        ReadyFileReadError::NotReady => ArtifactNativeCode::NotReady,
        ReadyFileReadError::Expired => ArtifactNativeCode::Expired,
        ReadyFileReadError::Unsupported => ArtifactNativeCode::Unsupported,
        ReadyFileReadError::Integrity => ArtifactNativeCode::IntegrityFailed,
        ReadyFileReadError::LimitExceeded => ArtifactNativeCode::LimitExceeded,
    }
}

async fn authorized_file(
    chat_runtime: &ChatRuntime,
    context_id: Uuid,
    locator: ArtifactLocator,
    now: i64,
    max_bytes: usize,
) -> Result<ReadyFileContent, ArtifactNativeCode> {
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
    let content = tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        application.read_ready_file(
            locator.session_id,
            locator.turn_id,
            locator.artifact_id,
            now,
            max_bytes,
        ),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)?
    .map_err(map_chat_error)?
    .map_err(map_read_error)?;
    validate_file_for_save(content.media_type, &content.bytes)?;
    Ok(content)
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

async fn project_bounded_file(
    media_type: &'static str,
    bytes: Vec<u8>,
) -> Result<FilePreviewProjection, ArtifactNativeCode> {
    tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        tokio::task::spawn_blocking(move || project_file_preview(media_type, &bytes)),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)?
    .map_err(|_| ArtifactNativeCode::Unavailable)?
}

#[tauri::command]
pub async fn chat_read_artifact_file_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    file_runtime: State<'_, ArtifactFileNativeRuntime>,
) -> Result<ArtifactNativeResponse<FilePreviewResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_file(
        &chat_runtime,
        request.context_id,
        request.payload,
        now,
        MAX_PREVIEW_SOURCE_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if !matches!(
        first.media_type,
        "text/plain" | "text/csv" | "application/json"
    ) {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::Unsupported,
        ));
    }
    let lease = file_runtime
        .begin_preview(webview.label(), first.identity, first.size_bytes)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first_revision = FileRevision::from(&first);
    project_bounded_file(first.media_type, first.bytes)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;

    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_file(
        &chat_runtime,
        request.context_id,
        request.payload,
        second_now,
        MAX_PREVIEW_SOURCE_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if FileRevision::from(&second) != first_revision {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::IntegrityFailed,
        ));
    }
    let projection = project_bounded_file(second.media_type, second.bytes)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    lease
        .ensure_current()
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let result = FilePreviewResult::from(projection);
    let response = ArtifactNativeResponse::new(request.request_id, result);
    if serde_json::to_vec(&response).map_or(true, |encoded| encoded.len() > MAX_RESPONSE_BYTES) {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::LimitExceeded,
        ));
    }
    Ok(response)
}

#[tauri::command]
pub async fn chat_save_artifact_file_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    file_runtime: State<'_, ArtifactFileNativeRuntime>,
) -> Result<ArtifactNativeResponse<SaveFileResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_file(
        &chat_runtime,
        request.context_id,
        request.payload,
        now,
        MAX_ARTIFACT_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let lease = file_runtime
        .begin_save(webview.label(), first.identity)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let default_name = canonical_file_save_name(first.display_name.as_deref(), first.media_type)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first_revision = FileRevision::from(&first);
    let first_media_type = first.media_type;
    drop(first);

    let selected = pick_native_file_save_target(&default_name, first_media_type)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let Some(selected) = selected else {
        return Ok(ArtifactNativeResponse::new(
            request.request_id,
            SaveFileResult {
                status: "cancelled",
                code: None,
            },
        ));
    };
    let target = match normalized_file_target(&selected, first_media_type) {
        Ok(target) => target,
        Err(code) => {
            return Ok(ArtifactNativeResponse::new(
                request.request_id,
                SaveFileResult {
                    status: "failed",
                    code: Some(code.as_str()),
                },
            ));
        }
    };
    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_file(
        &chat_runtime,
        request.context_id,
        request.payload,
        second_now,
        MAX_ARTIFACT_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if FileRevision::from(&second) != first_revision {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::IntegrityFailed,
        ));
    }
    lease
        .ensure_current()
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let save = tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        tokio::task::spawn_blocking({
            let epoch = file_runtime.process_epoch;
            move || atomic_save_file_content(&target, &second, epoch)
        }),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)
    .and_then(|joined| joined.map_err(|_| ArtifactNativeCode::Unavailable))
    .and_then(|result| result);
    let outcome = match save {
        Ok(()) => SaveFileResult {
            status: "saved",
            code: None,
        },
        Err(code) => SaveFileResult {
            status: "failed",
            code: Some(code.as_str()),
        },
    };
    Ok(ArtifactNativeResponse::new(request.request_id, outcome))
}

fn normalized_text(bytes: &[u8]) -> Result<String, ArtifactNativeCode> {
    let raw = std::str::from_utf8(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    if raw.is_empty() {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    let mut normalized = String::with_capacity(raw.len());
    let mut characters = raw.chars().peekable();
    while let Some(character) = characters.next() {
        let character = if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            '\n'
        } else {
            character
        };
        if disallowed_text_character(character) {
            return Err(ArtifactNativeCode::IntegrityFailed);
        }
        normalized.push(character);
    }
    Ok(normalized)
}

fn disallowed_text_character(character: char) -> bool {
    (character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
        || matches!(
            character,
            '\u{061c}'
                | '\u{200e}'
                | '\u{200f}'
                | '\u{202a}'
                | '\u{202b}'
                | '\u{202c}'
                | '\u{202d}'
                | '\u{202e}'
                | '\u{2066}'
                | '\u{2067}'
                | '\u{2068}'
                | '\u{2069}'
        )
}

fn truncate_utf8(value: &str, limit: usize) -> (&str, bool) {
    if value.len() <= limit {
        return (value, false);
    }
    let mut boundary = limit;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    (&value[..boundary], true)
}

fn json_encoded_character_bytes(character: char) -> usize {
    match character {
        '"' | '\\' | '\t' | '\n' | '\r' => 2,
        value if value <= '\u{001f}' => 6,
        value => value.len_utf8(),
    }
}

fn truncate_json_encoded(value: &str, budget: usize) -> (String, bool) {
    let mut encoded = 0_usize;
    let mut output = String::new();
    for character in value.chars() {
        let cost = json_encoded_character_bytes(character);
        if encoded.checked_add(cost).is_none_or(|total| total > budget) {
            return (output, true);
        }
        encoded += cost;
        output.push(character);
    }
    (output, false)
}

fn bounded_text_projection(
    media_type: &'static str,
    normalized: &str,
) -> Result<FilePreviewProjection, ArtifactNativeCode> {
    let mut output = String::new();
    let mut truncated = false;
    for (index, line) in normalized.split('\n').enumerate() {
        if index >= MAX_TEXT_LINES {
            truncated = true;
            break;
        }
        if index > 0 {
            output.push('\n');
        }
        let (line, line_truncated) = truncate_utf8(line, MAX_TEXT_LINE_BYTES);
        output.push_str(line);
        truncated |= line_truncated;
    }
    let empty = FilePreviewResult::Text {
        status: "previewed",
        media_type,
        text: String::new(),
        truncated: true,
    };
    let empty_bytes = serde_json::to_vec(&empty)
        .map_err(|_| ArtifactNativeCode::Unavailable)?
        .len();
    let budget = MAX_PROJECTION_BYTES
        .checked_sub(empty_bytes.saturating_sub(2))
        .ok_or(ArtifactNativeCode::LimitExceeded)?;
    let (output, encoded_truncated) = truncate_json_encoded(&output, budget);
    truncated |= encoded_truncated;
    let projection = FilePreviewProjection::Text {
        media_type,
        text: output,
        truncated,
    };
    if serde_json::to_vec(&FilePreviewResult::from(projection.clone()))
        .map_or(true, |encoded| encoded.len() > MAX_PROJECTION_BYTES)
    {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    Ok(projection)
}

fn audit_json(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), ArtifactNativeCode> {
    if depth > MAX_JSON_DEPTH {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    *nodes = nodes
        .checked_add(1)
        .ok_or(ArtifactNativeCode::LimitExceeded)?;
    if *nodes > MAX_JSON_NODES {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    match value {
        Value::Array(values) => {
            for value in values {
                audit_json(value, depth + 1, nodes)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                audit_json(value, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CsvState {
    Start,
    Unquoted,
    Quoted,
    AfterQuote,
}

fn parse_csv(normalized: &str) -> Result<Vec<Vec<String>>, ArtifactNativeCode> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut state = CsvState::Start;
    let mut ended_record = false;
    for character in normalized.chars() {
        ended_record = false;
        match state {
            CsvState::Start => match character {
                '"' => state = CsvState::Quoted,
                ',' => row.push(String::new()),
                '\n' => {
                    row.push(String::new());
                    rows.push(std::mem::take(&mut row));
                    ended_record = true;
                }
                value => {
                    field.push(value);
                    state = CsvState::Unquoted;
                }
            },
            CsvState::Unquoted => match character {
                '"' => return Err(ArtifactNativeCode::IntegrityFailed),
                ',' => {
                    row.push(std::mem::take(&mut field));
                    state = CsvState::Start;
                }
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    state = CsvState::Start;
                    ended_record = true;
                }
                value => field.push(value),
            },
            CsvState::Quoted => match character {
                '"' => state = CsvState::AfterQuote,
                value => field.push(value),
            },
            CsvState::AfterQuote => match character {
                '"' => {
                    field.push('"');
                    state = CsvState::Quoted;
                }
                ',' => {
                    row.push(std::mem::take(&mut field));
                    state = CsvState::Start;
                }
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    state = CsvState::Start;
                    ended_record = true;
                }
                _ => return Err(ArtifactNativeCode::IntegrityFailed),
            },
        }
    }
    if state == CsvState::Quoted {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    if !ended_record || !row.is_empty() || !field.is_empty() {
        row.push(field);
        rows.push(row);
    }
    if rows.is_empty() {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    Ok(rows)
}

fn bounded_csv_projection(
    all_rows: Vec<Vec<String>>,
) -> Result<FilePreviewProjection, ArtifactNativeCode> {
    let mut truncated = all_rows.len() > MAX_CSV_ROWS;
    let mut rows = Vec::new();
    for row in all_rows.into_iter().take(MAX_CSV_ROWS) {
        truncated |= row.len() > MAX_CSV_COLUMNS;
        let mut projected = Vec::new();
        for cell in row.into_iter().take(MAX_CSV_COLUMNS) {
            let (cell, cell_truncated) = truncate_utf8(&cell, MAX_CSV_CELL_BYTES);
            projected.push(cell.to_owned());
            truncated |= cell_truncated;
        }
        rows.push(projected);
    }
    loop {
        let candidate = FilePreviewProjection::Csv {
            rows: rows.clone(),
            truncated,
        };
        if serde_json::to_vec(&FilePreviewResult::from(candidate.clone()))
            .is_ok_and(|encoded| encoded.len() <= MAX_PROJECTION_BYTES)
        {
            return Ok(candidate);
        }
        truncated = true;
        if rows.len() > 1 {
            rows.pop();
            continue;
        }
        let Some(row) = rows.first_mut() else {
            return Err(ArtifactNativeCode::LimitExceeded);
        };
        if row.len() > 1 {
            row.pop();
            continue;
        }
        let Some(cell) = row.first_mut() else {
            return Err(ArtifactNativeCode::LimitExceeded);
        };
        if cell.is_empty() {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
        let (value, _) = truncate_utf8(cell, cell.len() / 2);
        *cell = value.to_owned();
    }
}

fn project_file_preview(
    media_type: &'static str,
    bytes: &[u8],
) -> Result<FilePreviewProjection, ArtifactNativeCode> {
    if !(1..=MAX_PREVIEW_SOURCE_BYTES).contains(&bytes.len()) {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    if !matches!(media_type, "text/plain" | "text/csv" | "application/json") {
        return Err(ArtifactNativeCode::Unsupported);
    }
    let normalized = normalized_text(bytes)?;
    match media_type {
        "text/plain" => bounded_text_projection("text/plain", &normalized),
        "application/json" => {
            let value: Value = serde_json::from_str(&normalized)
                .map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
            let mut nodes = 0_usize;
            audit_json(&value, 1, &mut nodes)?;
            bounded_text_projection("application/json", &normalized)
        }
        "text/csv" => bounded_csv_projection(parse_csv(&normalized)?),
        _ => Err(ArtifactNativeCode::Unsupported),
    }
}

fn canonical_file_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "text/plain" => Some("txt"),
        "text/csv" => Some("csv"),
        "application/json" => Some("json"),
        "application/pdf" => Some("pdf"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        _ => None,
    }
}

fn validate_file_for_save(media_type: &str, bytes: &[u8]) -> Result<(), ArtifactNativeCode> {
    if !(1..=MAX_ARTIFACT_BYTES).contains(&bytes.len()) {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    match media_type {
        "text/plain" | "text/csv" => {
            std::str::from_utf8(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
            if bytes.contains(&0) {
                return Err(ArtifactNativeCode::IntegrityFailed);
            }
            Ok(())
        }
        "application/json" => {
            serde_json::from_slice::<Value>(bytes)
                .map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
            Ok(())
        }
        "application/pdf" => {
            validate_pdf_artifact_content(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            validate_xlsx_artifact_content(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)
        }
        _ => Err(ArtifactNativeCode::Unsupported),
    }
}

fn canonical_file_save_name(
    display_name: Option<&str>,
    media_type: &str,
) -> Result<String, ArtifactNativeCode> {
    let extension = canonical_file_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
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
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        Ok(name.to_owned())
    } else {
        Ok(format!("{name}.{extension}"))
    }
}

fn normalized_file_target(target: &Path, media_type: &str) -> Result<PathBuf, ArtifactNativeCode> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err(ArtifactNativeCode::InvalidRequest);
    }
    let extension = canonical_file_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    match target.extension().and_then(|value| value.to_str()) {
        Some(value) if value.eq_ignore_ascii_case(extension) => Ok(target.to_path_buf()),
        Some(_) => Err(ArtifactNativeCode::ExtensionMismatch),
        None => Ok(target.with_extension(extension)),
    }
}

#[cfg(target_os = "macos")]
async fn pick_native_file_save_target(
    default_name: &str,
    media_type: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    let extension = canonical_file_extension(media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    Ok(rfd::AsyncFileDialog::new()
        .set_file_name(default_name)
        .add_filter("File", &[extension])
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf()))
}

#[cfg(not(target_os = "macos"))]
async fn pick_native_file_save_target(
    _default_name: &str,
    _media_type: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    Err(ArtifactNativeCode::DialogUnavailable)
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

fn media_marker(media_type: &str) -> Option<&'static str> {
    canonical_file_extension(media_type)
}

fn marker_media_type(marker: &str) -> Option<&'static str> {
    match marker {
        "txt" => Some("text/plain"),
        "csv" => Some("text/csv"),
        "json" => Some("application/json"),
        "pdf" => Some("application/pdf"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        _ => None,
    }
}

fn atomic_save_file_content(
    target: &Path,
    content: &ReadyFileContent,
    process_epoch: Uuid,
) -> Result<(), ArtifactNativeCode> {
    validate_file_for_save(content.media_type, &content.bytes)?;
    if content.bytes.len() != content.size_bytes {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    let parent = target.parent().ok_or(ArtifactNativeCode::InvalidRequest)?;
    let parent_metadata = fs::metadata(parent).map_err(|error| map_io_error(&error))?;
    if !parent_metadata.is_dir() {
        return Err(ArtifactNativeCode::PermissionDenied);
    }
    cleanup_verified_stale_file_temp_files(parent, process_epoch);
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ArtifactNativeCode::PermissionDenied)
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io_error(&error)),
    }
    let marker = media_marker(content.media_type).ok_or(ArtifactNativeCode::Unsupported)?;
    let (temp_path, mut temp_file) = create_file_temp(parent, marker, process_epoch)?;
    let mut guard = TempFileGuard {
        path: temp_path.clone(),
        armed: true,
    };
    let mut digest = Sha256::new();
    let mut written = 0_usize;
    for chunk in content.bytes.chunks(SAVE_CHUNK_BYTES) {
        temp_file
            .write_all(chunk)
            .map_err(|error| map_io_error(&error))?;
        digest.update(chunk);
        written = written
            .checked_add(chunk.len())
            .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    }
    let actual_sha256: [u8; 32] = digest.finalize().into();
    if written != content.size_bytes
        || !bool::from(subtle::ConstantTimeEq::ct_eq(
            actual_sha256.as_slice(),
            content.sha256.as_slice(),
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

fn create_file_temp(
    parent: &Path,
    marker: &str,
    process_epoch: Uuid,
) -> Result<(PathBuf, File), ArtifactNativeCode> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    if marker_media_type(marker).is_none() {
        return Err(ArtifactNativeCode::Unsupported);
    }
    for _ in 0..16 {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| ArtifactNativeCode::Unavailable)?;
        let path = parent.join(format!(
            "{FILE_TEMP_PREFIX}{marker}-{process_epoch}-{}.tmp",
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

fn cleanup_verified_stale_file_temp_files(parent: &Path, process_epoch: Uuid) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if verified_stale_file_temp(&path, process_epoch) {
            let _ = fs::remove_file(path);
        }
    }
}

fn verified_stale_file_temp(path: &Path, process_epoch: Uuid) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(remainder) = name
        .strip_prefix(FILE_TEMP_PREFIX)
        .and_then(|value| value.strip_suffix(".tmp"))
    else {
        return false;
    };
    let Some((marker, identity)) = remainder.split_once('-') else {
        return false;
    };
    let Some(media_type) = marker_media_type(marker) else {
        return false;
    };
    if identity.len() != 59 || identity.as_bytes().get(36) != Some(&b'-') {
        return false;
    }
    let Ok(epoch) = Uuid::parse_str(&identity[..36]) else {
        return false;
    };
    let random = &identity[37..];
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
    fs::read(path)
        .ok()
        .is_some_and(|bytes| validate_file_for_save(media_type, &bytes).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn text_json_and_csv_projection_is_bounded_and_inert() {
        assert_eq!(
            project_file_preview("text/plain", b"\xef\xbb\xbfalpha\r\nbeta\rgamma").unwrap(),
            FilePreviewProjection::Text {
                media_type: "text/plain",
                text: "alpha\nbeta\ngamma".to_owned(),
                truncated: false,
            }
        );
        assert!(matches!(
            project_file_preview("application/json", br#"{"nested":[1,true,null]}"#).unwrap(),
            FilePreviewProjection::Text {
                media_type: "application/json",
                truncated: false,
                ..
            }
        ));
        assert_eq!(
            project_file_preview(
                "text/csv",
                b"name,note\r\nalpha,\"x,y\"\r\nformula,=SUM(A1:A2)\r\n"
            )
            .unwrap(),
            FilePreviewProjection::Csv {
                rows: vec![
                    vec!["name".to_owned(), "note".to_owned()],
                    vec!["alpha".to_owned(), "x,y".to_owned()],
                    vec!["formula".to_owned(), "=SUM(A1:A2)".to_owned()],
                ],
                truncated: false,
            }
        );
    }

    #[test]
    fn preview_rejects_unauthorized_formats_controls_bidi_and_invalid_documents() {
        for (media_type, bytes) in [
            ("text/markdown", b"# title".as_slice()),
            ("text/plain", b"alpha\0beta".as_slice()),
            ("text/plain", "alpha\u{202e}beta".as_bytes()),
            ("application/json", b"{broken".as_slice()),
            ("text/csv", b"a,\"unterminated".as_slice()),
        ] {
            assert!(project_file_preview(media_type, bytes).is_err());
        }
    }

    #[test]
    fn exact_preview_caps_truncate_without_splitting_utf8() {
        let long_line = "\u{754c}".repeat(4_000);
        let projection = project_file_preview("text/plain", long_line.as_bytes()).unwrap();
        let FilePreviewProjection::Text {
            ref text,
            truncated,
            ..
        } = projection
        else {
            panic!("text projection");
        };
        assert!(truncated);
        assert!(text.len() <= MAX_TEXT_LINE_BYTES);
        assert!(text.is_char_boundary(text.len()));
        assert!(
            serde_json::to_vec(&FilePreviewResult::from(projection))
                .unwrap()
                .len()
                <= MAX_PROJECTION_BYTES
        );
    }

    #[test]
    fn source_line_csv_shape_and_projection_caps_are_exact() {
        assert_eq!(
            project_file_preview("text/plain", &vec![b'a'; MAX_PREVIEW_SOURCE_BYTES + 1]),
            Err(ArtifactNativeCode::LimitExceeded)
        );
        let lines = vec!["x"; MAX_TEXT_LINES + 1].join("\n");
        let FilePreviewProjection::Text {
            text, truncated, ..
        } = project_file_preview("text/plain", lines.as_bytes()).unwrap()
        else {
            panic!("text projection");
        };
        assert!(truncated);
        assert_eq!(text.split('\n').count(), MAX_TEXT_LINES);

        let row = vec!["value"; MAX_CSV_COLUMNS + 1].join(",");
        let csv = vec![row; MAX_CSV_ROWS + 1].join("\n");
        let FilePreviewProjection::Csv { rows, truncated } =
            project_file_preview("text/csv", csv.as_bytes()).unwrap()
        else {
            panic!("CSV projection");
        };
        assert!(truncated);
        assert!(rows.len() <= MAX_CSV_ROWS);
        assert!(rows.iter().all(|row| row.len() <= MAX_CSV_COLUMNS));
        assert!(
            serde_json::to_vec(&FilePreviewResult::from(FilePreviewProjection::Csv {
                rows,
                truncated,
            }))
            .unwrap()
            .len()
                <= MAX_PROJECTION_BYTES
        );
    }

    #[test]
    fn json_depth_and_node_limits_fail_closed() {
        let too_deep = format!(
            "{}0{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        assert_eq!(
            project_file_preview("application/json", too_deep.as_bytes()),
            Err(ArtifactNativeCode::LimitExceeded)
        );
        let too_many = format!("[{}]", vec!["0"; MAX_JSON_NODES + 1].join(","));
        assert_eq!(
            project_file_preview("application/json", too_many.as_bytes()),
            Err(ArtifactNativeCode::LimitExceeded)
        );
    }

    #[test]
    fn save_allowlist_and_extensions_are_exact() {
        for (media_type, extension, bytes) in [
            ("text/plain", "txt", b"alpha".as_slice()),
            ("text/csv", "csv", b"a,b\n1,2\n".as_slice()),
            ("application/json", "json", br#"{"a":1}"#.as_slice()),
        ] {
            validate_file_for_save(media_type, bytes).unwrap();
            assert_eq!(canonical_file_extension(media_type), Some(extension));
        }
        assert_eq!(canonical_file_extension("text/markdown"), None);
        assert!(validate_file_for_save("application/json", b"invalid").is_err());
        assert_eq!(
            normalized_file_target(Path::new("/tmp/report"), "application/json").unwrap(),
            PathBuf::from("/tmp/report.json")
        );
        assert_eq!(
            normalized_file_target(Path::new("/tmp/report.txt"), "application/json"),
            Err(ArtifactNativeCode::ExtensionMismatch)
        );
    }

    #[test]
    fn preview_runtime_enforces_identity_concurrency_bytes_and_generation() {
        let runtime = ArtifactFileNativeRuntime::new();
        let identity = ReadyFileIdentity {
            owner_user_id: Uuid::now_v7(),
            tenant_id: Uuid::now_v7(),
            session_id: Uuid::now_v7(),
            turn_id: Uuid::now_v7(),
            artifact_id: Uuid::now_v7(),
        };
        let first = runtime.begin_preview("main", identity, 10).unwrap();
        assert!(matches!(
            runtime.begin_preview("main", identity, 10),
            Err(ArtifactNativeCode::Conflict)
        ));
        let second_identity = ReadyFileIdentity {
            artifact_id: Uuid::now_v7(),
            ..identity
        };
        let second = runtime
            .begin_preview("main", second_identity, MAX_PREVIEW_SOURCE_BYTES)
            .unwrap();
        let third_identity = ReadyFileIdentity {
            artifact_id: Uuid::now_v7(),
            ..identity
        };
        assert!(matches!(
            runtime.begin_preview("main", third_identity, 1),
            Err(ArtifactNativeCode::LimitExceeded)
        ));
        runtime.invalidate_all();
        assert!(matches!(
            first.ensure_current(),
            Err(ArtifactNativeCode::Unauthenticated)
        ));
        let replacement = runtime.begin_preview("main", identity, 10).unwrap();
        drop(first);
        assert!(matches!(
            runtime.begin_preview("main", identity, 10),
            Err(ArtifactNativeCode::Conflict)
        ));
        drop(replacement);
        drop(second);
    }

    #[test]
    fn revision_comparison_includes_identity_media_size_digest_and_commit_revision() {
        let content = ready_text(b"revision bound".to_vec());
        let expected = FileRevision::from(&content);
        let mut drifted = content.clone();
        drifted.revision += 1;
        assert!(FileRevision::from(&drifted) != expected);
        drifted = content.clone();
        drifted.sha256 = [0; 32];
        assert!(FileRevision::from(&drifted) != expected);
    }

    fn ready_text(bytes: Vec<u8>) -> ReadyFileContent {
        ReadyFileContent {
            identity: ReadyFileIdentity {
                owner_user_id: Uuid::now_v7(),
                tenant_id: Uuid::now_v7(),
                session_id: Uuid::now_v7(),
                turn_id: Uuid::now_v7(),
                artifact_id: Uuid::now_v7(),
            },
            display_name: Some("notes.txt".to_owned()),
            media_type: "text/plain",
            size_bytes: bytes.len(),
            sha256: Sha256::digest(&bytes).into(),
            revision: 1,
            bytes,
        }
    }

    #[test]
    fn file_save_is_atomic_and_cleanup_accepts_only_verified_prior_epoch_files() {
        let root = std::env::temp_dir().join(format!("yijie-file-native-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let process_epoch = Uuid::now_v7();
        let content = ready_text(b"safe file\n".to_vec());
        let target = root.join("notes.txt");
        atomic_save_file_content(&target, &content, process_epoch).unwrap();
        assert_eq!(fs::read(&target).unwrap(), content.bytes);

        let prior_epoch = Uuid::now_v7();
        let stale = root.join(format!(
            "{FILE_TEMP_PREFIX}txt-{prior_epoch}-{}.tmp",
            "A".repeat(22)
        ));
        fs::write(&stale, b"verified residue").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&stale, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let current = root.join(format!(
            "{FILE_TEMP_PREFIX}txt-{process_epoch}-{}.tmp",
            "B".repeat(22)
        ));
        fs::write(&current, b"current residue").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&current, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let unverified = root.join(format!(
            "{FILE_TEMP_PREFIX}pdf-{prior_epoch}-{}.tmp",
            "C".repeat(22)
        ));
        fs::write(&unverified, b"not a PDF").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&unverified, fs::Permissions::from_mode(0o600)).unwrap();
        }
        cleanup_verified_stale_file_temp_files(&root, process_epoch);
        assert!(!stale.exists());
        assert!(current.exists());
        assert!(unverified.exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = root.join("link.txt");
            symlink(&target, &link).unwrap();
            assert_eq!(
                atomic_save_file_content(&link, &content, process_epoch),
                Err(ArtifactNativeCode::PermissionDenied)
            );
        }
        let directory_target = root.join("directory.txt");
        fs::create_dir(&directory_target).unwrap();
        assert_eq!(
            atomic_save_file_content(&directory_target, &content, process_epoch),
            Err(ArtifactNativeCode::PermissionDenied)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn request_decoder_is_closed_and_bounded() {
        let request_id = Uuid::now_v7();
        let valid = serde_json::json!({
            "schemaVersion": 1,
            "requestId": request_id,
            "contextId": Uuid::now_v7(),
            "payload": {
                "sessionId": Uuid::now_v7(),
                "turnId": Uuid::now_v7(),
                "artifactId": Uuid::now_v7()
            }
        });
        assert_eq!(
            decode_request(valid.clone()).unwrap().request_id,
            request_id
        );
        let mut leaked = valid;
        leaked["payload"]["path"] = Value::String("/private/file".to_owned());
        assert!(decode_request(leaked).is_err());
    }
}
