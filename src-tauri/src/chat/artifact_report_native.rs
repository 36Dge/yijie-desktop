use super::artifact::{
    validate_report_document, ReadyReportContent, ReadyReportIdentity, ReadyReportReadError,
    MAX_ARTIFACT_BYTES,
};
use super::artifact_native::{ArtifactNativeCode, ArtifactNativeError, ArtifactNativeResponse};
use super::authorization::{AuthorizationFailure, ChatAction};
use super::{ChatError, ChatRuntime, ConversationApplication};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

const SCHEMA_VERSION: u8 = 1;
const MAIN_WEBVIEW: &str = "main";
const REPORT_MEDIA_TYPE: &str = "application/vnd.yijie.report+json;version=1";
const NATIVE_IO_TIMEOUT_SECONDS: u64 = 10;
const MAX_PREVIEW_SOURCE_BYTES: usize = 4_194_304;
const MAX_PROJECTION_BYTES: usize = 524_288;
const MAX_RESPONSE_BYTES: usize = 1_048_576;
const MAX_DOCUMENT_DEPTH: usize = 12;
const MAX_DOCUMENT_NODES: usize = 100_000;
const MAX_PREVIEW_OPERATIONS_PER_WEBVIEW: usize = 2;
const MAX_PREVIEW_SOURCE_BYTES_IN_FLIGHT: usize = 8_388_608;
const MAX_BODY_SCALARS: usize = 8_192;
const MAX_HEADING_SCALARS: usize = 1_024;
const MAX_TABLE_ROWS: usize = 200;
const MAX_TABLE_CELL_SCALARS: usize = 1_024;
const SAVE_CHUNK_BYTES: usize = 64 * 1024;
const REPORT_TEMP_PREFIX: &str = ".yijie-artifact-report-save-v1-json-";

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPreviewResult {
    schema_version: u8,
    title: String,
    generated_at: String,
    source_time: Option<String>,
    truncated: bool,
    sections: Vec<ReportSectionProjection>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
enum ReportSectionProjection {
    #[serde(rename = "summary")]
    Summary {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        heading: Option<String>,
        text: String,
    },
    #[serde(rename = "paragraph")]
    Paragraph {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        heading: Option<String>,
        text: String,
    },
    #[serde(rename = "metrics")]
    Metrics {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        items: Vec<MetricProjection>,
    },
    #[serde(rename = "table")]
    Table {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        caption: Option<String>,
        columns: Vec<TableColumnProjection>,
        rows: Vec<Vec<Value>>,
    },
    #[serde(rename = "chart")]
    Chart {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        title: Option<String>,
        #[serde(rename = "chartType")]
        chart_type: String,
        labels: Vec<String>,
        series: Vec<ChartSeriesProjection>,
        aligned: bool,
    },
    #[serde(rename = "callout")]
    Callout {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
        tone: String,
        title: Option<String>,
        text: String,
    },
    #[serde(rename = "unsupported")]
    Unsupported {
        ordinal: usize,
        id: String,
        required: bool,
        truncated: bool,
    },
}

#[derive(Clone, Serialize)]
struct MetricProjection {
    label: String,
    value: Value,
    unit: Option<String>,
}

#[derive(Clone, Serialize)]
struct TableColumnProjection {
    ordinal: usize,
    key: String,
    label: String,
}

#[derive(Clone, Serialize)]
struct ChartSeriesProjection {
    ordinal: usize,
    name: String,
    values: Vec<Value>,
}

#[derive(Serialize)]
pub struct SaveReportResult {
    status: &'static str,
    code: Option<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct ReportRevision {
    identity: ReadyReportIdentity,
    media_type: &'static str,
    size_bytes: usize,
    sha256: [u8; 32],
    committed_at: i64,
}

impl From<&ReadyReportContent> for ReportRevision {
    fn from(content: &ReadyReportContent) -> Self {
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
struct ReportOperationState {
    generation: u64,
    active_previews: HashMap<(String, ReadyReportIdentity), (usize, u64)>,
    active_saves: HashMap<(String, ReadyReportIdentity), u64>,
}

pub struct ArtifactReportNativeRuntime {
    process_epoch: Uuid,
    state: Mutex<ReportOperationState>,
}

impl ArtifactReportNativeRuntime {
    pub fn new() -> Self {
        Self {
            process_epoch: Uuid::now_v7(),
            state: Mutex::new(ReportOperationState::default()),
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
        identity: ReadyReportIdentity,
        source_bytes: usize,
    ) -> Result<ReportOperationLease<'_>, ArtifactNativeCode> {
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
        Ok(ReportOperationLease {
            runtime: self,
            generation,
            webview_label: webview_label.to_owned(),
            identity,
            kind: ReportOperationKind::Preview,
        })
    }

    fn begin_save(
        &self,
        webview_label: &str,
        identity: ReadyReportIdentity,
    ) -> Result<ReportOperationLease<'_>, ArtifactNativeCode> {
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
        Ok(ReportOperationLease {
            runtime: self,
            generation,
            webview_label: webview_label.to_owned(),
            identity,
            kind: ReportOperationKind::Save,
        })
    }

    fn generation_is_current(&self, generation: u64) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.generation == generation)
    }
}

impl Default for ArtifactReportNativeRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
enum ReportOperationKind {
    Preview,
    Save,
}

struct ReportOperationLease<'a> {
    runtime: &'a ArtifactReportNativeRuntime,
    generation: u64,
    webview_label: String,
    identity: ReadyReportIdentity,
    kind: ReportOperationKind,
}

impl ReportOperationLease<'_> {
    fn ensure_current(&self) -> Result<(), ArtifactNativeCode> {
        if self.runtime.generation_is_current(self.generation) {
            Ok(())
        } else {
            Err(ArtifactNativeCode::Unauthenticated)
        }
    }
}

impl Drop for ReportOperationLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.runtime.state.lock() {
            let key = (self.webview_label.clone(), self.identity);
            match self.kind {
                ReportOperationKind::Preview => {
                    if state
                        .active_previews
                        .get(&key)
                        .is_some_and(|(_, generation)| *generation == self.generation)
                    {
                        state.active_previews.remove(&key);
                    }
                }
                ReportOperationKind::Save => {
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

fn map_read_error(error: ReadyReportReadError) -> ArtifactNativeCode {
    match error {
        ReadyReportReadError::NotFound => ArtifactNativeCode::NotFound,
        ReadyReportReadError::NotReady => ArtifactNativeCode::NotReady,
        ReadyReportReadError::Expired => ArtifactNativeCode::Expired,
        ReadyReportReadError::Unsupported => ArtifactNativeCode::Unsupported,
        ReadyReportReadError::Integrity => ArtifactNativeCode::IntegrityFailed,
        ReadyReportReadError::LimitExceeded => ArtifactNativeCode::LimitExceeded,
    }
}

async fn authorized_report(
    chat_runtime: &ChatRuntime,
    context_id: Uuid,
    locator: ArtifactLocator,
    now: i64,
    max_bytes: usize,
) -> Result<ReadyReportContent, ArtifactNativeCode> {
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
        application.read_ready_report(
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

async fn project_bounded_report(bytes: Vec<u8>) -> Result<ReportPreviewResult, ArtifactNativeCode> {
    tokio::time::timeout(
        std::time::Duration::from_secs(NATIVE_IO_TIMEOUT_SECONDS),
        tokio::task::spawn_blocking(move || project_report_preview(&bytes)),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)?
    .map_err(|_| ArtifactNativeCode::Unavailable)?
}

#[tauri::command]
pub async fn chat_read_artifact_report_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    report_runtime: State<'_, ArtifactReportNativeRuntime>,
) -> Result<ArtifactNativeResponse<ReportPreviewResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_report(
        &chat_runtime,
        request.context_id,
        request.payload,
        now,
        MAX_PREVIEW_SOURCE_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let lease = report_runtime
        .begin_preview(webview.label(), first.identity, first.size_bytes)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let revision = ReportRevision::from(&first);
    project_bounded_report(first.bytes)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_report(
        &chat_runtime,
        request.context_id,
        request.payload,
        second_now,
        MAX_PREVIEW_SOURCE_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if ReportRevision::from(&second) != revision {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::IntegrityFailed,
        ));
    }
    let projection = project_bounded_report(second.bytes)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    lease
        .ensure_current()
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let response = ArtifactNativeResponse::new(request.request_id, projection);
    if serde_json::to_vec(&response).map_or(true, |encoded| encoded.len() > MAX_RESPONSE_BYTES) {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::LimitExceeded,
        ));
    }
    Ok(response)
}

#[tauri::command]
pub async fn chat_save_artifact_report_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    report_runtime: State<'_, ArtifactReportNativeRuntime>,
) -> Result<ArtifactNativeResponse<SaveReportResult>, ArtifactNativeError> {
    let request = decode_request(request)?;
    require_main(&webview, request.request_id)?;
    let now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let first = authorized_report(
        &chat_runtime,
        request.context_id,
        request.payload,
        now,
        MAX_ARTIFACT_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let lease = report_runtime
        .begin_save(webview.label(), first.identity)
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let default_name = canonical_report_save_name(first.display_name.as_deref())
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let revision = ReportRevision::from(&first);
    drop(first);
    let selected = pick_native_report_save_target(&default_name)
        .await
        .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let Some(selected) = selected else {
        return Ok(ArtifactNativeResponse::new(
            request.request_id,
            SaveReportResult {
                status: "cancelled",
                code: None,
            },
        ));
    };
    let target = match normalized_report_target(&selected) {
        Ok(target) => target,
        Err(code) => {
            return Ok(ArtifactNativeResponse::new(
                request.request_id,
                SaveReportResult {
                    status: "failed",
                    code: Some(code.as_str()),
                },
            ));
        }
    };
    let second_now =
        unix_seconds().map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    let second = authorized_report(
        &chat_runtime,
        request.context_id,
        request.payload,
        second_now,
        MAX_ARTIFACT_BYTES,
    )
    .await
    .map_err(|code| ArtifactNativeError::new(Some(request.request_id), code))?;
    if ReportRevision::from(&second) != revision {
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
            let epoch = report_runtime.process_epoch;
            move || atomic_save_report_content(&target, &second, epoch)
        }),
    )
    .await
    .map_err(|_| ArtifactNativeCode::Unavailable)
    .and_then(|joined| joined.map_err(|_| ArtifactNativeCode::Unavailable))
    .and_then(|result| result);
    let outcome = match save {
        Ok(()) => SaveReportResult {
            status: "saved",
            code: None,
        },
        Err(code) => SaveReportResult {
            status: "failed",
            code: Some(code.as_str()),
        },
    };
    Ok(ArtifactNativeResponse::new(request.request_id, outcome))
}

fn audit_json(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), ArtifactNativeCode> {
    if depth > MAX_DOCUMENT_DEPTH {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    *nodes = nodes
        .checked_add(1)
        .ok_or(ArtifactNativeCode::LimitExceeded)?;
    if *nodes > MAX_DOCUMENT_NODES {
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

fn visible_text(value: &str, maximum: usize) -> (String, bool) {
    let mut output = String::new();
    let mut count = 0_usize;
    let mut truncated = false;
    let mut characters = value.chars().peekable();
    while let Some(mut character) = characters.next() {
        if count >= maximum {
            truncated = true;
            break;
        }
        if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            character = '\n';
        }
        count += 1;
        if visible_escape_required(character) {
            use std::fmt::Write as _;
            let _ = write!(output, "\\u{:04X}", u32::from(character));
        } else {
            output.push(character);
        }
    }
    (output, truncated)
}

fn visible_escape_required(character: char) -> bool {
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

fn optional_visible_text(value: Option<&Value>, maximum: usize) -> (Option<String>, bool) {
    value
        .and_then(Value::as_str)
        .map(|value| {
            let (text, truncated) = visible_text(value, maximum);
            (Some(text), truncated)
        })
        .unwrap_or((None, false))
}

fn required_object<'a>(
    value: &'a Value,
    key: &str,
) -> Result<&'a Map<String, Value>, ArtifactNativeCode> {
    value
        .get(key)
        .and_then(Value::as_object)
        .ok_or(ArtifactNativeCode::IntegrityFailed)
}

fn project_report_section(
    section: &Value,
    ordinal: usize,
) -> Result<ReportSectionProjection, ArtifactNativeCode> {
    let envelope = section
        .as_object()
        .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    let id = envelope
        .get("id")
        .and_then(Value::as_str)
        .ok_or(ArtifactNativeCode::IntegrityFailed)?
        .to_owned();
    let section_type = envelope
        .get("type")
        .and_then(Value::as_str)
        .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    let required = envelope
        .get("required")
        .and_then(Value::as_bool)
        .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    match section_type {
        "summary" | "paragraph" => {
            let payload = required_object(section, "payload")?;
            let (heading, heading_truncated) =
                optional_visible_text(payload.get("heading"), MAX_HEADING_SCALARS);
            let (text, text_truncated) = visible_text(
                payload
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?,
                MAX_BODY_SCALARS,
            );
            let fields = (
                ordinal,
                id,
                required,
                heading_truncated || text_truncated,
                heading,
                text,
            );
            if section_type == "summary" {
                Ok(ReportSectionProjection::Summary {
                    ordinal: fields.0,
                    id: fields.1,
                    required: fields.2,
                    truncated: fields.3,
                    heading: fields.4,
                    text: fields.5,
                })
            } else {
                Ok(ReportSectionProjection::Paragraph {
                    ordinal: fields.0,
                    id: fields.1,
                    required: fields.2,
                    truncated: fields.3,
                    heading: fields.4,
                    text: fields.5,
                })
            }
        }
        "metrics" => {
            let payload = required_object(section, "payload")?;
            let source = payload
                .get("items")
                .and_then(Value::as_array)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?;
            let mut truncated = false;
            let mut items = Vec::with_capacity(source.len());
            for item in source {
                let item = item
                    .as_object()
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?;
                let (label, label_truncated) = visible_text(
                    item.get("label")
                        .and_then(Value::as_str)
                        .ok_or(ArtifactNativeCode::IntegrityFailed)?,
                    80,
                );
                let mut value = item
                    .get("value")
                    .cloned()
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?;
                if let Some(text) = value.as_str() {
                    let (projected, value_truncated) = visible_text(text, 128);
                    value = Value::String(projected);
                    truncated |= value_truncated;
                }
                let (unit, unit_truncated) = optional_visible_text(item.get("unit"), 32);
                truncated |= label_truncated || unit_truncated;
                items.push(MetricProjection { label, value, unit });
            }
            Ok(ReportSectionProjection::Metrics {
                ordinal,
                id,
                required,
                truncated,
                items,
            })
        }
        "table" => {
            let payload = required_object(section, "payload")?;
            let source_columns = payload
                .get("columns")
                .and_then(Value::as_array)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?;
            let mut truncated = false;
            let mut columns = Vec::with_capacity(source_columns.len());
            let mut keys = Vec::with_capacity(source_columns.len());
            for (column_ordinal, column) in source_columns.iter().enumerate() {
                let column = column
                    .as_object()
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?;
                let key = column
                    .get("key")
                    .and_then(Value::as_str)
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?
                    .to_owned();
                let (label, label_truncated) = visible_text(
                    column
                        .get("label")
                        .and_then(Value::as_str)
                        .ok_or(ArtifactNativeCode::IntegrityFailed)?,
                    80,
                );
                truncated |= label_truncated;
                keys.push(key.clone());
                columns.push(TableColumnProjection {
                    ordinal: column_ordinal,
                    key,
                    label,
                });
            }
            let source_rows = payload
                .get("rows")
                .and_then(Value::as_array)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?;
            truncated |= source_rows.len() > MAX_TABLE_ROWS;
            let key_set: HashSet<&str> = keys.iter().map(String::as_str).collect();
            let mut rows = Vec::new();
            for row in source_rows.iter().take(MAX_TABLE_ROWS) {
                let row = row.as_object().ok_or(ArtifactNativeCode::IntegrityFailed)?;
                truncated |= row.keys().any(|key| !key_set.contains(key.as_str()));
                let mut positional = Vec::with_capacity(keys.len());
                for key in &keys {
                    let mut cell = row.get(key).cloned().unwrap_or(Value::Null);
                    if let Some(text) = cell.as_str() {
                        let (projected, cell_truncated) =
                            visible_text(text, MAX_TABLE_CELL_SCALARS);
                        truncated |= cell_truncated;
                        cell = Value::String(projected);
                    }
                    positional.push(cell);
                }
                rows.push(positional);
            }
            let (caption, caption_truncated) =
                optional_visible_text(payload.get("caption"), MAX_HEADING_SCALARS);
            Ok(ReportSectionProjection::Table {
                ordinal,
                id,
                required,
                truncated: truncated || caption_truncated,
                caption,
                columns,
                rows,
            })
        }
        "chart" => {
            let payload = required_object(section, "payload")?;
            let (title, title_truncated) =
                optional_visible_text(payload.get("title"), MAX_HEADING_SCALARS);
            let chart_type = payload
                .get("chart_type")
                .and_then(Value::as_str)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?
                .to_owned();
            let labels = payload
                .get("labels")
                .and_then(Value::as_array)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?;
            let mut projected_labels = Vec::with_capacity(labels.len());
            let mut truncated = title_truncated;
            for label in labels {
                let (label, label_truncated) = visible_text(
                    label.as_str().ok_or(ArtifactNativeCode::IntegrityFailed)?,
                    128,
                );
                truncated |= label_truncated;
                projected_labels.push(label);
            }
            let source_series = payload
                .get("series")
                .and_then(Value::as_array)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?;
            let mut series = Vec::with_capacity(source_series.len());
            let mut total_points = 0_usize;
            let mut aligned = true;
            for (series_ordinal, item) in source_series.iter().enumerate() {
                let item = item
                    .as_object()
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?;
                let (name, name_truncated) = visible_text(
                    item.get("name")
                        .and_then(Value::as_str)
                        .ok_or(ArtifactNativeCode::IntegrityFailed)?,
                    80,
                );
                truncated |= name_truncated;
                let values = item
                    .get("values")
                    .and_then(Value::as_array)
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?
                    .clone();
                total_points = total_points
                    .checked_add(values.len())
                    .ok_or(ArtifactNativeCode::LimitExceeded)?;
                if total_points > 2_048 || values.iter().any(|value| !value.is_number()) {
                    return Err(ArtifactNativeCode::LimitExceeded);
                }
                aligned &= values.len() == projected_labels.len();
                series.push(ChartSeriesProjection {
                    ordinal: series_ordinal,
                    name,
                    values,
                });
            }
            Ok(ReportSectionProjection::Chart {
                ordinal,
                id,
                required,
                truncated,
                title,
                chart_type,
                labels: projected_labels,
                series,
                aligned,
            })
        }
        "callout" => {
            let payload = required_object(section, "payload")?;
            let tone = payload
                .get("tone")
                .and_then(Value::as_str)
                .ok_or(ArtifactNativeCode::IntegrityFailed)?
                .to_owned();
            let (title, title_truncated) =
                optional_visible_text(payload.get("title"), MAX_HEADING_SCALARS);
            let (text, text_truncated) = visible_text(
                payload
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or(ArtifactNativeCode::IntegrityFailed)?,
                MAX_BODY_SCALARS,
            );
            Ok(ReportSectionProjection::Callout {
                ordinal,
                id,
                required,
                truncated: title_truncated || text_truncated,
                tone,
                title,
                text,
            })
        }
        _ if !required => Ok(ReportSectionProjection::Unsupported {
            ordinal,
            id,
            required: false,
            truncated: false,
        }),
        _ => Err(ArtifactNativeCode::Unsupported),
    }
}

fn pop_projection_boundary(projection: &mut ReportPreviewResult) -> bool {
    let Some(last) = projection.sections.last_mut() else {
        return false;
    };
    if let ReportSectionProjection::Table {
        rows, truncated, ..
    } = last
    {
        if !rows.is_empty() {
            rows.pop();
            *truncated = true;
            projection.truncated = true;
            return true;
        }
    }
    projection.sections.pop();
    projection.truncated = true;
    true
}

fn project_report_preview(bytes: &[u8]) -> Result<ReportPreviewResult, ArtifactNativeCode> {
    if !(1..=MAX_PREVIEW_SOURCE_BYTES).contains(&bytes.len()) {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    validate_report_document(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
    let document: Value =
        serde_json::from_slice(bytes).map_err(|_| ArtifactNativeCode::IntegrityFailed)?;
    let mut nodes = 0_usize;
    audit_json(&document, 1, &mut nodes)?;
    let root = document
        .as_object()
        .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    let (title, title_truncated) = visible_text(
        root.get("title")
            .and_then(Value::as_str)
            .ok_or(ArtifactNativeCode::IntegrityFailed)?,
        200,
    );
    let sections = root
        .get("sections")
        .and_then(Value::as_array)
        .ok_or(ArtifactNativeCode::IntegrityFailed)?;
    let mut projection = ReportPreviewResult {
        schema_version: 1,
        title,
        generated_at: root
            .get("generated_at")
            .and_then(Value::as_str)
            .ok_or(ArtifactNativeCode::IntegrityFailed)?
            .to_owned(),
        source_time: root
            .get("source_time")
            .and_then(Value::as_str)
            .map(str::to_owned),
        truncated: title_truncated,
        sections: sections
            .iter()
            .enumerate()
            .map(|(ordinal, section)| project_report_section(section, ordinal))
            .collect::<Result<Vec<_>, _>>()?,
    };
    projection.truncated |= projection.sections.iter().any(section_is_truncated);
    while serde_json::to_vec(&projection)
        .map_or(true, |encoded| encoded.len() > MAX_PROJECTION_BYTES)
    {
        if !pop_projection_boundary(&mut projection) {
            return Err(ArtifactNativeCode::LimitExceeded);
        }
    }
    Ok(projection)
}

fn section_is_truncated(section: &ReportSectionProjection) -> bool {
    match section {
        ReportSectionProjection::Summary { truncated, .. }
        | ReportSectionProjection::Paragraph { truncated, .. }
        | ReportSectionProjection::Metrics { truncated, .. }
        | ReportSectionProjection::Table { truncated, .. }
        | ReportSectionProjection::Chart { truncated, .. }
        | ReportSectionProjection::Callout { truncated, .. }
        | ReportSectionProjection::Unsupported { truncated, .. } => *truncated,
    }
}

fn canonical_report_save_name(display_name: Option<&str>) -> Result<String, ArtifactNativeCode> {
    let name = display_name.unwrap_or("report");
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
        .is_some_and(|value| value.eq_ignore_ascii_case("json"))
    {
        Ok(name.to_owned())
    } else {
        Ok(format!("{name}.json"))
    }
}

fn normalized_report_target(target: &Path) -> Result<PathBuf, ArtifactNativeCode> {
    if !target.is_absolute() || target.file_name().is_none() {
        return Err(ArtifactNativeCode::InvalidRequest);
    }
    match target.extension().and_then(|value| value.to_str()) {
        Some(value) if value.eq_ignore_ascii_case("json") => Ok(target.to_path_buf()),
        Some(_) => Err(ArtifactNativeCode::ExtensionMismatch),
        None => Ok(target.with_extension("json")),
    }
}

#[cfg(target_os = "macos")]
async fn pick_native_report_save_target(
    default_name: &str,
) -> Result<Option<PathBuf>, ArtifactNativeCode> {
    Ok(rfd::AsyncFileDialog::new()
        .set_file_name(default_name)
        .add_filter("Report JSON", &["json"])
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf()))
}

#[cfg(not(target_os = "macos"))]
async fn pick_native_report_save_target(
    _default_name: &str,
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

fn atomic_save_report_content(
    target: &Path,
    content: &ReadyReportContent,
    process_epoch: Uuid,
) -> Result<(), ArtifactNativeCode> {
    if content.media_type != REPORT_MEDIA_TYPE
        || !(1..=MAX_ARTIFACT_BYTES).contains(&content.bytes.len())
        || content.bytes.len() != content.size_bytes
        || validate_report_document(&content.bytes).is_err()
    {
        return Err(ArtifactNativeCode::IntegrityFailed);
    }
    let parent = target.parent().ok_or(ArtifactNativeCode::InvalidRequest)?;
    let parent_metadata = fs::metadata(parent).map_err(|error| map_io_error(&error))?;
    if !parent_metadata.is_dir() {
        return Err(ArtifactNativeCode::PermissionDenied);
    }
    cleanup_verified_stale_report_temp_files(parent, process_epoch);
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ArtifactNativeCode::PermissionDenied)
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(map_io_error(&error)),
    }
    let (temp_path, mut temp_file) = create_report_temp(parent, process_epoch)?;
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

fn create_report_temp(
    parent: &Path,
    process_epoch: Uuid,
) -> Result<(PathBuf, File), ArtifactNativeCode> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    for _ in 0..16 {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| ArtifactNativeCode::Unavailable)?;
        let path = parent.join(format!(
            "{REPORT_TEMP_PREFIX}{process_epoch}-{}.tmp",
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

fn cleanup_verified_stale_report_temp_files(parent: &Path, process_epoch: Uuid) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if verified_stale_report_temp(&path, process_epoch) {
            let _ = fs::remove_file(path);
        }
    }
}

fn verified_stale_report_temp(path: &Path, process_epoch: Uuid) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(identity) = name
        .strip_prefix(REPORT_TEMP_PREFIX)
        .and_then(|value| value.strip_suffix(".tmp"))
    else {
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
        .is_some_and(|bytes| validate_report_document(&bytes).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical_report() -> Vec<u8> {
        br#"{
          "schema_version":1,
          "title":"Synthetic quarterly report",
          "generated_at":"2026-08-20T10:00:00+08:00",
          "sections":[
            {"id":"overview","type":"summary","required":true,"payload":{"heading":"Overview","text":"Safe\r\ntext"}},
            {"id":"metrics","type":"metrics","required":false,"payload":{"items":[{"label":"Orders","value":42,"unit":"count"}]}},
            {"id":"table","type":"table","required":false,"payload":{"columns":[{"key":"value","label":"First"},{"key":"value","label":"Second"}],"rows":[{"value":"cell"}]}},
            {"id":"chart","type":"chart","required":false,"payload":{"chart_type":"line","labels":["Q1","Q2"],"series":[{"name":"Total","values":[42]}]}},
            {"id":"future","type":"future-v2","required":false,"payload":["must-not-cross"]}
          ]
        }"#.to_vec()
    }

    #[test]
    fn projection_is_closed_positional_bounded_and_omits_unknown_payload() {
        let projection = project_report_preview(&canonical_report()).unwrap();
        assert_eq!(projection.sections.len(), 5);
        let encoded = serde_json::to_string(&projection).unwrap();
        assert!(!encoded.contains("future-v2"));
        assert!(!encoded.contains("must-not-cross"));
        assert!(encoded.contains("unsupported"));
        assert!(encoded.contains("\\ntext"));
        assert!(encoded.len() <= MAX_PROJECTION_BYTES);
        let ReportSectionProjection::Table { columns, rows, .. } = &projection.sections[2] else {
            panic!("table projection");
        };
        assert_eq!(columns[0].ordinal, 0);
        assert_eq!(rows[0], vec![Value::String("cell".to_owned()); 2]);
        let ReportSectionProjection::Chart { aligned, .. } = &projection.sections[3] else {
            panic!("chart projection");
        };
        assert!(!aligned);
    }

    #[test]
    fn projection_escapes_controls_and_truncates_at_safe_boundaries() {
        let text = format!("{}\u{202e}\0", "界".repeat(MAX_BODY_SCALARS + 1));
        let report = serde_json::json!({
            "schema_version": 1,
            "title": "Safe",
            "generated_at": "2026-08-20T02:00:00Z",
            "sections": [{"id":"body","type":"paragraph","required":true,"payload":{"text":text}}]
        });
        let projection = project_report_preview(&serde_json::to_vec(&report).unwrap()).unwrap();
        let ReportSectionProjection::Paragraph {
            text, truncated, ..
        } = &projection.sections[0]
        else {
            panic!("paragraph projection");
        };
        assert!(*truncated);
        assert_eq!(text.chars().count(), MAX_BODY_SCALARS);

        let controls = serde_json::json!({
            "schema_version": 1,
            "title": "Safe",
            "generated_at": "2026-08-20T02:00:00Z",
            "sections": [{"id":"body","type":"paragraph","required":true,"payload":{"text":"a\u{202e}b\0c"}}]
        });
        let encoded = serde_json::to_string(
            &project_report_preview(&serde_json::to_vec(&controls).unwrap()).unwrap(),
        )
        .unwrap();
        assert!(encoded.contains("\\\\u202E"));
        assert!(encoded.contains("\\\\u0000"));
        assert!(!encoded.contains('\u{202e}'));
        assert!(!encoded.contains('\0'));
    }

    #[test]
    fn source_depth_node_and_required_unknown_fail_closed() {
        assert!(matches!(
            project_report_preview(&vec![b' '; MAX_PREVIEW_SOURCE_BYTES + 1]),
            Err(ArtifactNativeCode::LimitExceeded)
        ));
        let required = br#"{"schema_version":1,"title":"Safe","generated_at":"2026-08-20T02:00:00Z","sections":[{"id":"future","type":"future-v2","required":true,"payload":{}}]}"#;
        assert!(matches!(
            project_report_preview(required),
            Err(ArtifactNativeCode::IntegrityFailed)
        ));

        let many_nodes = serde_json::json!({
            "schema_version": 1,
            "title": "Safe",
            "generated_at": "2026-08-20T02:00:00Z",
            "sections": [
                {"id":"future_a","type":"future-v2","required":false,"payload":vec![0; 60_000]},
                {"id":"future_b","type":"future-v2","required":false,"payload":vec![0; 60_000]}
            ]
        });
        assert!(matches!(
            project_report_preview(&serde_json::to_vec(&many_nodes).unwrap()),
            Err(ArtifactNativeCode::LimitExceeded)
        ));
    }

    #[test]
    fn projection_byte_cap_truncates_whole_table_rows() {
        let columns: Vec<Value> = (0..32)
            .map(|index| serde_json::json!({"key": format!("c{index}"), "label": format!("C{index}")}))
            .collect();
        let rows: Vec<Value> = (0..300)
            .map(|_| {
                Value::Object(
                    (0..32)
                        .map(|index| (format!("c{index}"), Value::String("x".repeat(100))))
                        .collect(),
                )
            })
            .collect();
        let report = serde_json::json!({
            "schema_version": 1,
            "title": "Safe",
            "generated_at": "2026-08-20T02:00:00Z",
            "sections": [{
                "id":"table","type":"table","required":true,
                "payload":{"columns":columns,"rows":rows}
            }]
        });
        let projection = project_report_preview(&serde_json::to_vec(&report).unwrap()).unwrap();
        assert!(projection.truncated);
        assert!(serde_json::to_vec(&projection).unwrap().len() <= MAX_PROJECTION_BYTES);
        let ReportSectionProjection::Table {
            rows, truncated, ..
        } = &projection.sections[0]
        else {
            panic!("table projection");
        };
        assert!(*truncated);
        assert!(rows.len() < MAX_TABLE_ROWS);
    }

    #[test]
    fn runtime_enforces_identity_concurrency_bytes_and_generation() {
        let runtime = ArtifactReportNativeRuntime::new();
        let identity = ReadyReportIdentity {
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
        let second_identity = ReadyReportIdentity {
            artifact_id: Uuid::now_v7(),
            ..identity
        };
        let second = runtime
            .begin_preview("main", second_identity, MAX_PREVIEW_SOURCE_BYTES)
            .unwrap();
        let third_identity = ReadyReportIdentity {
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
        drop(first);
        drop(second);
    }

    fn ready_report(bytes: Vec<u8>) -> ReadyReportContent {
        ReadyReportContent {
            identity: ReadyReportIdentity {
                owner_user_id: Uuid::now_v7(),
                tenant_id: Uuid::now_v7(),
                session_id: Uuid::now_v7(),
                turn_id: Uuid::now_v7(),
                artifact_id: Uuid::now_v7(),
            },
            display_name: Some("report.json".to_owned()),
            media_type: REPORT_MEDIA_TYPE,
            size_bytes: bytes.len(),
            sha256: Sha256::digest(&bytes).into(),
            revision: 1,
            bytes,
        }
    }

    #[test]
    fn canonical_save_is_atomic_and_cleanup_is_report_only() {
        let root = std::env::temp_dir().join(format!("yijie-report-native-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let process_epoch = Uuid::now_v7();
        let content = ready_report(canonical_report());
        let target = root.join("report.json");
        atomic_save_report_content(&target, &content, process_epoch).unwrap();
        assert_eq!(fs::read(&target).unwrap(), content.bytes);

        let prior_epoch = Uuid::now_v7();
        let stale = root.join(format!(
            "{REPORT_TEMP_PREFIX}{prior_epoch}-{}.tmp",
            "A".repeat(22)
        ));
        fs::write(&stale, canonical_report()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&stale, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let invalid = root.join(format!(
            "{REPORT_TEMP_PREFIX}{prior_epoch}-{}.tmp",
            "B".repeat(22)
        ));
        fs::write(&invalid, b"not report JSON").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&invalid, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let current = root.join(format!(
            "{REPORT_TEMP_PREFIX}{process_epoch}-{}.tmp",
            "C".repeat(22)
        ));
        fs::write(&current, canonical_report()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&current, fs::Permissions::from_mode(0o600)).unwrap();
        }
        cleanup_verified_stale_report_temp_files(&root, process_epoch);
        assert!(!stale.exists());
        assert!(invalid.exists());
        assert!(current.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = root.join("link.json");
            symlink(&target, &link).unwrap();
            assert_eq!(
                atomic_save_report_content(&link, &content, process_epoch),
                Err(ArtifactNativeCode::PermissionDenied)
            );
        }
        let directory_target = root.join("directory.json");
        fs::create_dir(&directory_target).unwrap();
        assert_eq!(
            atomic_save_report_content(&directory_target, &content, process_epoch),
            Err(ArtifactNativeCode::PermissionDenied)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn request_and_extension_are_closed() {
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
        leaked["payload"]["path"] = Value::String("/private/report".to_owned());
        assert!(decode_request(leaked).is_err());
        assert_eq!(
            normalized_report_target(Path::new("/tmp/report")).unwrap(),
            PathBuf::from("/tmp/report.json")
        );
        assert_eq!(
            normalized_report_target(Path::new("/tmp/report.pdf")),
            Err(ArtifactNativeCode::ExtensionMismatch)
        );
    }
}
