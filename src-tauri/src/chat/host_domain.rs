use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::fmt::{Debug, Formatter};
use std::path::PathBuf;
use uuid::Uuid;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_SSE_FRAME_BYTES: usize = MAX_EVENT_BYTES + 1024;
const MAX_CONTEXT_BYTES: usize = 256;
const MAX_ITEM_ID_BYTES: usize = 255;
const MAX_REASONING_DELTA_BYTES: usize = 16 * 1024;
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_PARTS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostBridgeErrorKind {
    Disabled,
    InvalidConfiguration,
    TokenUnavailable,
    InstanceMismatch,
    NotReady,
    Transport,
    AcceptedResponseInvalid,
    Protocol,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostErrorCode {
    Unauthorized,
    CapabilityDenied,
    InvalidRequest,
    SkillNotFound,
    SkillNotInstallable,
    SkillOperationConflict,
    SkillBusy,
    BundleMissing,
    BundleManifestInvalid,
    ArchiveChecksumMismatch,
    ArchiveUnsafe,
    ArchiveTooLarge,
    InstallFailed,
    UninstallFailed,
    ScanFailed,
    RuntimeUnavailable,
    RuntimeSyncFailed,
    SessionNotFound,
    TaskSessionExists,
    TurnActive,
    TurnOperationConflict,
    TurnNotActive,
    SessionNotUsable,
    EventStreamChanged,
    EventReplayUnavailable,
    InvalidEventCursor,
    RuntimeRequestFailed,
    StreamingUnsupported,
    CleanupIncomplete,
    CleanupOperationConflict,
    InternalError,
    Unknown,
}

pub struct HostBridgeError {
    kind: HostBridgeErrorKind,
    code: Option<HostErrorCode>,
}

impl HostBridgeError {
    pub fn kind(&self) -> HostBridgeErrorKind {
        self.kind
    }

    pub fn code(&self) -> Option<HostErrorCode> {
        self.code
    }

    pub(super) const fn new(kind: HostBridgeErrorKind) -> Self {
        Self { kind, code: None }
    }

    pub(crate) const fn rejected(code: HostErrorCode) -> Self {
        Self {
            kind: HostBridgeErrorKind::Rejected,
            code: Some(code),
        }
    }
}

impl Debug for HostBridgeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostBridgeError")
            .field("kind", &self.kind)
            .field("code", &self.code)
            .finish()
    }
}

impl std::fmt::Display for HostBridgeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Agent Host bridge operation failed")
    }
}

impl std::error::Error for HostBridgeError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostEventCursor {
    pub stream_id: Uuid,
    pub sequence: u64,
}

impl HostEventCursor {
    pub fn new(stream_id: Uuid, sequence: u64) -> Result<Self, HostBridgeError> {
        if stream_id.is_nil() || sequence == 0 {
            return Err(protocol_error());
        }
        Ok(Self {
            stream_id,
            sequence,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostSessionState {
    Starting,
    Idle,
    Active,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostSessionFailure {
    ThreadStartFailed,
    ThreadStartResponseInvalid,
    ProviderIdentityMismatch,
    ThreadResumeFailed,
    ThreadResumeResponseInvalid,
    TurnStartFailed,
    TurnStartResponseInvalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostTurnStatus {
    Completed,
    Interrupted,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostAgentMessagePhase {
    Commentary,
    FinalAnswer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostPlanStepStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostPlanStep {
    pub step: String,
    pub status: HostPlanStepStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostReasoningStatus {
    Complete,
    Incomplete,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostReasoningReason {
    ReasoningNotEmitted,
    TurnInterrupted,
    StreamGap,
    RuntimeError,
    LimitExceeded,
    ProtocolError,
    HostShutdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCleanupSurfaceStatus {
    Complete,
    Incomplete,
    NotAttempted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCleanupReason {
    ActiveTurn,
    TerminalUnconfirmed,
    SharedThreadMapping,
    RuntimeDeleteFailed,
    RuntimeDeleteUnconfirmed,
    HostMappingCleanupFailed,
    HostReplayCleanupFailed,
    OperationStateUnavailable,
    InternalError,
}

pub struct HostSession {
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Option<Uuid>,
    pub active_turn_id: Option<Uuid>,
    pub state: HostSessionState,
    pub cwd: PathBuf,
    pub model_ready: bool,
    pub failure_code: Option<HostSessionFailure>,
    pub created_at: String,
    pub updated_at: String,
}

impl Debug for HostSession {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostSession")
            .field("task_id", &self.task_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("codex_thread_id", &self.codex_thread_id)
            .field("active_turn_id", &self.active_turn_id)
            .field("state", &self.state)
            .field("cwd", &"[LOCAL_PATH]")
            .field("model_ready", &self.model_ready)
            .field("failure_code", &self.failure_code)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostReasoningPart {
    pub content_index: usize,
    pub text: String,
}

impl Debug for HostReasoningPart {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostReasoningPart")
            .field("content_index", &self.content_index)
            .field("utf8_bytes", &self.text.len())
            .finish()
    }
}

pub enum HostEventKind {
    ThreadStarted {
        model: String,
        model_provider: String,
    },
    TurnStarted,
    TurnPlanUpdated {
        explanation: Option<String>,
        steps: Vec<HostPlanStep>,
    },
    ItemStarted {
        item_type: String,
        text: Option<String>,
        phase: Option<HostAgentMessagePhase>,
    },
    AgentMessageDelta {
        delta: String,
    },
    ReasoningTextDelta {
        content_index: usize,
        delta: String,
    },
    ReasoningTextFinalized {
        status: HostReasoningStatus,
        contents: Vec<HostReasoningPart>,
        reason: Option<HostReasoningReason>,
    },
    ItemCompleted {
        item_type: String,
        text: Option<String>,
        phase: Option<HostAgentMessagePhase>,
    },
    TurnCompleted {
        status: HostTurnStatus,
        code: Option<String>,
        message: Option<String>,
    },
    Error {
        code: Option<String>,
        message: String,
        will_retry: bool,
    },
    Warning {
        code: Option<String>,
        message: String,
    },
    Unknown,
}

impl HostEventKind {
    fn label(&self) -> &'static str {
        match self {
            Self::ThreadStarted { .. } => "thread.started",
            Self::TurnStarted => "turn.started",
            Self::TurnPlanUpdated { .. } => "turn.plan.updated",
            Self::ItemStarted { .. } => "item.started",
            Self::AgentMessageDelta { .. } => "item.agent_message.delta",
            Self::ReasoningTextDelta { .. } => "item.reasoning_text.delta",
            Self::ReasoningTextFinalized { .. } => "item.reasoning_text.finalized",
            Self::ItemCompleted { .. } => "item.completed",
            Self::TurnCompleted { .. } => "turn.completed",
            Self::Error { .. } => "error",
            Self::Warning { .. } => "warning",
            Self::Unknown => "unknown",
        }
    }
}

impl Debug for HostEventKind {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostEventKind")
            .field("event_type", &self.label())
            .finish()
    }
}

pub struct HostEvent {
    pub cursor: HostEventCursor,
    pub event_type: String,
    pub event_id: Uuid,
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
    pub turn_id: Option<Uuid>,
    pub item_id: Option<String>,
    pub occurred_at: String,
    /// Exact UTF-8 bytes of the validated wire event JSON. This is content-free accounting used
    /// to bound cumulative per-Turn projection work across restarts and stream changes.
    pub encoded_bytes: usize,
    pub kind: HostEventKind,
}

pub struct HostArtifactEventV3 {
    pub cursor: HostEventCursor,
    pub event_type: String,
    pub event_id: Uuid,
    pub task_id: Uuid,
    pub agent_session_id: Uuid,
    pub codex_thread_id: Uuid,
    pub turn_id: Uuid,
    pub occurred_at: String,
    pub payload: Value,
}

impl Debug for HostArtifactEventV3 {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostArtifactEventV3")
            .field("cursor", &self.cursor)
            .field("event_type", &self.event_type)
            .field("event_id", &self.event_id)
            .field("task_id", &self.task_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("codex_thread_id", &self.codex_thread_id)
            .field("turn_id", &self.turn_id)
            .field("occurred_at", &self.occurred_at)
            .field("payload", &"[ARTIFACT_METADATA]")
            .finish()
    }
}

pub enum HostStreamEvent {
    Ordinary(HostEvent),
    Artifact(HostArtifactEventV3),
}

impl Debug for HostStreamEvent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ordinary(event) => event.fmt(formatter),
            Self::Artifact(event) => event.fmt(formatter),
        }
    }
}

impl Debug for HostEvent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostEvent")
            .field("cursor", &self.cursor)
            .field("event_type", &self.event_type)
            .field("event_id", &self.event_id)
            .field("task_id", &self.task_id)
            .field("agent_session_id", &self.agent_session_id)
            .field("codex_thread_id", &self.codex_thread_id)
            .field("turn_id", &self.turn_id)
            .field("item_id", &self.item_id)
            .field("occurred_at", &self.occurred_at)
            .field("encoded_bytes", &self.encoded_bytes)
            .field("kind", &self.kind)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostCleanupSurfaces {
    pub runtime_thread_tree: HostCleanupSurfaceStatus,
    pub host_mapping: HostCleanupSurfaceStatus,
    pub host_replay: HostCleanupSurfaceStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCleanupOutcome {
    Complete {
        operation_id: Uuid,
    },
    Incomplete {
        operation_id: Uuid,
        surfaces: HostCleanupSurfaces,
        reason: HostCleanupReason,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireEvent {
    schema_version: u8,
    event_id: String,
    stream_id: String,
    sequence: u64,
    occurred_at: String,
    trace_id: Option<String>,
    request_id: Option<String>,
    tenant_id: Option<String>,
    user_id: Option<String>,
    task_id: String,
    agent_session_id: String,
    codex_thread_id: String,
    turn_id: Option<String>,
    item_id: Option<String>,
    event_type: String,
    terminal: bool,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ThreadStartedPayload {
    model: String,
    model_provider: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TurnStartedPayload {
    status: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemLifecyclePayload {
    item_type: String,
    text: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TurnPlanUpdatedPayload {
    explanation: Option<String>,
    plan: Vec<WirePlanStep>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePlanStep {
    step: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeltaPayload {
    delta: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReasoningDeltaPayload {
    content_index: usize,
    delta: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReasoningFinalizedPayload {
    status: String,
    contents: Vec<WireReasoningPart>,
    reason_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireReasoningPart {
    content_index: usize,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TurnCompletedPayload {
    status: String,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProblemPayload {
    code: Option<String>,
    message: String,
    will_retry: bool,
}

pub(super) struct SseDecoder {
    schema_version: u8,
    expected_stream: Uuid,
    last_sequence: u64,
    buffer: Vec<u8>,
    ready: VecDeque<HostStreamEvent>,
}

impl SseDecoder {
    pub(super) fn new(expected_stream: Uuid, last_sequence: u64, schema_version: u8) -> Self {
        Self {
            schema_version,
            expected_stream,
            last_sequence,
            buffer: Vec::new(),
            ready: VecDeque::new(),
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) -> Result<(), HostBridgeError> {
        let mut offset = 0_usize;
        while offset < bytes.len() {
            let available = (MAX_SSE_FRAME_BYTES + 4)
                .checked_sub(self.buffer.len())
                .ok_or_else(protocol_error)?;
            if available == 0 {
                return Err(protocol_error());
            }
            let take = available.min(bytes.len() - offset);
            self.buffer.extend_from_slice(&bytes[offset..offset + take]);
            offset += take;
            self.parse_complete_frames()?;
            if self.buffer.len() == MAX_SSE_FRAME_BYTES + 4 {
                return Err(protocol_error());
            }
        }
        Ok(())
    }

    fn parse_complete_frames(&mut self) -> Result<(), HostBridgeError> {
        let mut consumed = 0_usize;
        while let Some((frame_end, delimiter_len)) = frame_boundary(&self.buffer[consumed..]) {
            let frame_end = consumed + frame_end;
            if let Some(event) = parse_sse_frame(
                &self.buffer[consumed..frame_end],
                self.expected_stream,
                self.schema_version,
                &mut self.last_sequence,
            )? {
                self.ready.push_back(event);
            }
            consumed = frame_end + delimiter_len;
        }
        if consumed > 0 {
            self.buffer.drain(..consumed);
        }
        Ok(())
    }

    pub(super) fn next(&mut self) -> Option<HostStreamEvent> {
        self.ready.pop_front()
    }

    pub(super) fn finish(&mut self) -> Result<(), HostBridgeError> {
        if self.buffer.iter().all(|byte| byte.is_ascii_whitespace()) {
            self.buffer.clear();
            Ok(())
        } else {
            Err(protocol_error())
        }
    }
}

fn frame_boundary(bytes: &[u8]) -> Option<(usize, usize)> {
    let mut index = 0_usize;
    while index + 1 < bytes.len() {
        if bytes[index] == b'\n' && bytes[index + 1] == b'\n' {
            return Some((index, 2));
        }
        if index + 3 < bytes.len() && &bytes[index..index + 4] == b"\r\n\r\n" {
            return Some((index, 4));
        }
        index += 1;
    }
    None
}

fn parse_sse_frame(
    frame: &[u8],
    expected_stream: Uuid,
    schema_version: u8,
    last_sequence: &mut u64,
) -> Result<Option<HostStreamEvent>, HostBridgeError> {
    if frame.len() > MAX_SSE_FRAME_BYTES {
        return Err(protocol_error());
    }
    let text = std::str::from_utf8(frame).map_err(|_| protocol_error())?;
    if text
        .lines()
        .all(|line| line.starts_with(':') || line.is_empty())
    {
        return Ok(None);
    }
    let mut id = None;
    let mut event_type = None;
    let mut data = None;
    for raw_line in text.lines() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line.starts_with(':') {
            continue;
        }
        if let Some(value) = line.strip_prefix("id: ") {
            assign_once(&mut id, value)?;
        } else if let Some(value) = line.strip_prefix("event: ") {
            assign_once(&mut event_type, value)?;
        } else if let Some(value) = line.strip_prefix("data: ") {
            assign_once(&mut data, value)?;
        } else {
            return Err(protocol_error());
        }
    }
    let id = id.ok_or_else(protocol_error)?;
    let event_type = event_type.ok_or_else(protocol_error)?;
    let data = data.ok_or_else(protocol_error)?;
    if id.contains(|character: char| character.is_ascii_whitespace())
        || event_type.is_empty()
        || event_type.len() > 128
    {
        return Err(protocol_error());
    }
    let (id_stream, id_sequence) = parse_cursor_text(id)?;
    if id_stream != expected_stream
        || id_sequence < *last_sequence
        || schema_version == 2 && id_sequence == *last_sequence
    {
        return Err(protocol_error());
    }
    let parsed = parse_event_json(data, expected_stream, schema_version)?;
    let (parsed_cursor, parsed_event_type) = match &parsed {
        HostStreamEvent::Ordinary(event) => (event.cursor, event.event_type.as_str()),
        HostStreamEvent::Artifact(event) => (event.cursor, event.event_type.as_str()),
    };
    if parsed_cursor.sequence != id_sequence || parsed_event_type != event_type {
        return Err(protocol_error());
    }
    *last_sequence = id_sequence;
    Ok(Some(parsed))
}

fn assign_once<'a>(slot: &mut Option<&'a str>, value: &'a str) -> Result<(), HostBridgeError> {
    if slot.replace(value).is_some() {
        return Err(protocol_error());
    }
    Ok(())
}

fn parse_cursor_text(value: &str) -> Result<(Uuid, u64), HostBridgeError> {
    let (stream, sequence_text) = value.split_once(':').ok_or_else(protocol_error)?;
    let stream = parse_uuid(stream)?;
    let sequence = sequence_text.parse::<u64>().map_err(|_| protocol_error())?;
    if sequence == 0 || sequence.to_string() != sequence_text {
        return Err(protocol_error());
    }
    Ok((stream, sequence))
}

fn parse_event_json(
    data: &str,
    expected_stream: Uuid,
    schema_version: u8,
) -> Result<HostStreamEvent, HostBridgeError> {
    if data.is_empty() || data.len() > MAX_EVENT_BYTES || data.contains('\r') || data.contains('\n')
    {
        return Err(protocol_error());
    }
    let wire: WireEvent = serde_json::from_str(data).map_err(|_| protocol_error())?;
    if !matches!(schema_version, 2..=4)
        || wire.schema_version != schema_version
        || wire.sequence == 0
        || wire.occurred_at.len() > 64
        || !valid_rfc3339(&wire.occurred_at)
    {
        return Err(protocol_error());
    }
    for value in [
        wire.trace_id.as_deref(),
        wire.request_id.as_deref(),
        wire.tenant_id.as_deref(),
        wire.user_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.is_empty()
            || value.len() > MAX_CONTEXT_BYTES
            || value.contains('\r')
            || value.contains('\n')
            || value.contains('\0')
        {
            return Err(protocol_error());
        }
    }
    let stream_id = parse_uuid(&wire.stream_id)?;
    if stream_id != expected_stream {
        return Err(protocol_error());
    }
    let turn_id = wire.turn_id.as_deref().map(parse_uuid).transpose()?;
    let maximum_item_id_bytes = if schema_version >= 3 {
        MAX_CONTEXT_BYTES
    } else {
        MAX_ITEM_ID_BYTES
    };
    let item_id = wire
        .item_id
        .map(|value| {
            if value.is_empty()
                || value.len() > maximum_item_id_bytes
                || value.contains('\r')
                || value.contains('\n')
                || value.contains('\0')
            {
                Err(protocol_error())
            } else {
                Ok(value)
            }
        })
        .transpose()?;
    let event_type = wire.event_type;
    if schema_version >= 3 && is_artifact_event_type(&event_type) {
        let turn_id = turn_id.ok_or_else(protocol_error)?;
        if wire.terminal {
            return Err(protocol_error());
        }
        return Ok(HostStreamEvent::Artifact(HostArtifactEventV3 {
            cursor: HostEventCursor {
                stream_id,
                sequence: wire.sequence,
            },
            event_type,
            event_id: parse_uuid(&wire.event_id)?,
            task_id: parse_uuid(&wire.task_id)?,
            agent_session_id: parse_uuid(&wire.agent_session_id)?,
            codex_thread_id: parse_uuid(&wire.codex_thread_id)?,
            turn_id,
            occurred_at: wire.occurred_at,
            payload: wire.payload,
        }));
    }
    if schema_version == 3 && !is_v3_ordinary_event_type(&event_type) {
        return Err(protocol_error());
    }
    if schema_version == 4 && !is_v4_ordinary_event_type(&event_type) {
        return Err(protocol_error());
    }
    let kind = parse_event_kind(
        schema_version,
        &event_type,
        wire.terminal,
        turn_id,
        item_id.as_deref(),
        wire.payload,
    )?;
    Ok(HostStreamEvent::Ordinary(HostEvent {
        cursor: HostEventCursor {
            stream_id,
            sequence: wire.sequence,
        },
        event_type,
        event_id: parse_uuid(&wire.event_id)?,
        task_id: parse_uuid(&wire.task_id)?,
        agent_session_id: parse_uuid(&wire.agent_session_id)?,
        codex_thread_id: parse_uuid(&wire.codex_thread_id)?,
        turn_id,
        item_id,
        occurred_at: wire.occurred_at,
        encoded_bytes: data.len(),
        kind,
    }))
}

fn is_artifact_event_type(value: &str) -> bool {
    matches!(
        value,
        "item.artifact.started"
            | "item.artifact.progress"
            | "item.artifact.completed"
            | "item.artifact.failed"
    )
}

fn is_v3_ordinary_event_type(value: &str) -> bool {
    matches!(
        value,
        "thread.started"
            | "turn.started"
            | "item.started"
            | "item.agent_message.delta"
            | "item.reasoning_text.delta"
            | "item.reasoning_text.finalized"
            | "item.completed"
            | "turn.completed"
            | "error"
            | "warning"
    )
}

fn is_v4_ordinary_event_type(value: &str) -> bool {
    is_v3_ordinary_event_type(value) || value == "turn.plan.updated"
}

fn parse_event_kind(
    schema_version: u8,
    event_type: &str,
    terminal: bool,
    turn_id: Option<Uuid>,
    item_id: Option<&str>,
    payload: Value,
) -> Result<HostEventKind, HostBridgeError> {
    match event_type {
        "thread.started" if !terminal && turn_id.is_none() && item_id.is_none() => {
            let payload: ThreadStartedPayload = parse_payload(payload)?;
            validate_text(&payload.model, 256, false)?;
            validate_text(&payload.model_provider, 256, false)?;
            Ok(HostEventKind::ThreadStarted {
                model: payload.model,
                model_provider: payload.model_provider,
            })
        }
        "turn.started" if !terminal && turn_id.is_some() && item_id.is_none() => {
            let payload: TurnStartedPayload = parse_payload(payload)?;
            if payload.status != "in_progress" {
                return Err(protocol_error());
            }
            Ok(HostEventKind::TurnStarted)
        }
        "turn.plan.updated"
            if schema_version == 4 && !terminal && turn_id.is_some() && item_id.is_none() =>
        {
            let payload: TurnPlanUpdatedPayload = parse_payload(payload)?;
            if payload.plan.len() > 128 {
                return Err(protocol_error());
            }
            validate_optional_text(payload.explanation.as_deref(), 64 * 1024)?;
            let steps = payload
                .plan
                .into_iter()
                .map(|step| {
                    validate_text(&step.step, 64 * 1024, true)?;
                    let status = match step.status.as_str() {
                        "pending" => HostPlanStepStatus::Pending,
                        "in_progress" => HostPlanStepStatus::InProgress,
                        "completed" => HostPlanStepStatus::Completed,
                        _ => return Err(protocol_error()),
                    };
                    Ok(HostPlanStep {
                        step: step.step,
                        status,
                    })
                })
                .collect::<Result<Vec<_>, HostBridgeError>>()?;
            Ok(HostEventKind::TurnPlanUpdated {
                explanation: payload.explanation,
                steps,
            })
        }
        "item.started" if !terminal && turn_id.is_some() && item_id.is_some() => {
            let (payload, phase) = parse_item_payload(payload, schema_version)?;
            Ok(HostEventKind::ItemStarted {
                item_type: payload.item_type,
                text: payload.text,
                phase,
            })
        }
        "item.agent_message.delta" if !terminal && turn_id.is_some() && item_id.is_some() => {
            let payload: DeltaPayload = parse_payload(payload)?;
            validate_text(&payload.delta, MAX_EVENT_BYTES, true)?;
            Ok(HostEventKind::AgentMessageDelta {
                delta: payload.delta,
            })
        }
        "item.reasoning_text.delta" if !terminal && turn_id.is_some() && item_id.is_some() => {
            let payload: ReasoningDeltaPayload = parse_payload(payload)?;
            if payload.content_index >= MAX_REASONING_PARTS {
                return Err(protocol_error());
            }
            validate_text(&payload.delta, MAX_REASONING_DELTA_BYTES, false)?;
            Ok(HostEventKind::ReasoningTextDelta {
                content_index: payload.content_index,
                delta: payload.delta,
            })
        }
        "item.reasoning_text.finalized" if !terminal && turn_id.is_some() && item_id.is_some() => {
            parse_reasoning_finalized(payload)
        }
        "item.completed" if !terminal && turn_id.is_some() && item_id.is_some() => {
            let (payload, phase) = parse_item_payload(payload, schema_version)?;
            Ok(HostEventKind::ItemCompleted {
                item_type: payload.item_type,
                text: payload.text,
                phase,
            })
        }
        "turn.completed" if terminal && turn_id.is_some() && item_id.is_none() => {
            let payload: TurnCompletedPayload = parse_payload(payload)?;
            let status = match payload.status.as_str() {
                "completed" => HostTurnStatus::Completed,
                "interrupted" => HostTurnStatus::Interrupted,
                "failed" => HostTurnStatus::Failed,
                _ => return Err(protocol_error()),
            };
            validate_optional_text(payload.code.as_deref(), 256)?;
            validate_optional_text(payload.message.as_deref(), 8 * 1024)?;
            Ok(HostEventKind::TurnCompleted {
                status,
                code: payload.code,
                message: payload.message,
            })
        }
        "error" if !terminal && turn_id.is_some() && item_id.is_none() => {
            let payload: ProblemPayload = parse_payload(payload)?;
            validate_optional_text(payload.code.as_deref(), 256)?;
            validate_text(&payload.message, 8 * 1024, false)?;
            Ok(HostEventKind::Error {
                code: payload.code,
                message: payload.message,
                will_retry: payload.will_retry,
            })
        }
        "warning" if !terminal && turn_id.is_none() && item_id.is_none() => {
            let payload: ProblemPayload = parse_payload(payload)?;
            if payload.will_retry {
                return Err(protocol_error());
            }
            validate_optional_text(payload.code.as_deref(), 256)?;
            validate_text(&payload.message, 8 * 1024, false)?;
            Ok(HostEventKind::Warning {
                code: payload.code,
                message: payload.message,
            })
        }
        _ if schema_version >= 3 => Err(protocol_error()),
        _ if !terminal && !event_type.is_empty() && event_type.len() <= 128 => {
            Ok(HostEventKind::Unknown)
        }
        _ => Err(protocol_error()),
    }
}

fn valid_rfc3339(value: &str) -> bool {
    if value.len() < 20
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || value.as_bytes().get(10) != Some(&b'T')
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
    {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| {
        value
            .as_bytes()
            .get(range)
            .is_some_and(|part| part.iter().all(u8::is_ascii_digit))
    };
    if !digits(0..4)
        || !digits(5..7)
        || !digits(8..10)
        || !digits(11..13)
        || !digits(14..16)
        || !digits(17..19)
    {
        return false;
    }
    let number =
        |range: std::ops::Range<usize>| value.get(range).and_then(|part| part.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    if year == 0 || day == 0 || day > maximum_day || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let zone_start = if value.as_bytes().last() == Some(&b'Z') {
        value.len() - 1
    } else {
        let start = value.len().saturating_sub(6);
        if !matches!(value.as_bytes().get(start), Some(b'+' | b'-'))
            || value.as_bytes().get(start + 3) != Some(&b':')
            || !digits(start + 1..start + 3)
            || !digits(start + 4..start + 6)
            || number(start + 1..start + 3).is_none_or(|offset_hour| offset_hour > 23)
            || number(start + 4..start + 6).is_none_or(|offset_minute| offset_minute > 59)
        {
            return false;
        }
        start
    };
    if zone_start == 19 {
        return true;
    }
    value.as_bytes().get(19) == Some(&b'.')
        && value
            .as_bytes()
            .get(20..zone_start)
            .is_some_and(|fraction| !fraction.is_empty() && fraction.iter().all(u8::is_ascii_digit))
}

fn parse_item_payload(
    value: Value,
    schema_version: u8,
) -> Result<(ItemLifecyclePayload, Option<HostAgentMessagePhase>), HostBridgeError> {
    let phase_present = value
        .as_object()
        .is_some_and(|object| object.contains_key("phase"));
    let phase_value = value.get("phase").cloned();
    let mut projection = value;
    if let Some(object) = projection.as_object_mut() {
        object.remove("phase");
    }
    let payload: ItemLifecyclePayload = parse_payload(projection)?;
    validate_text(&payload.item_type, 256, false)?;
    if let Some(text) = payload.text.as_deref() {
        // Lifecycle text is an authoritative snapshot, and the v3/v4 Contracts explicitly
        // allow an empty snapshot at item.started before deltas arrive.
        validate_text(text, MAX_EVENT_BYTES, true)?;
    }
    if schema_version != 4 {
        if phase_present {
            return Err(protocol_error());
        }
        return Ok((payload, None));
    }
    let phase = if payload.item_type == "agentMessage" {
        if payload.text.is_none() || !phase_present {
            return Err(protocol_error());
        }
        match phase_value {
            Some(Value::String(value)) if value == "commentary" => {
                Some(HostAgentMessagePhase::Commentary)
            }
            Some(Value::String(value)) if value == "final_answer" => {
                Some(HostAgentMessagePhase::FinalAnswer)
            }
            Some(Value::Null) => None,
            _ => return Err(protocol_error()),
        }
    } else {
        if phase_present {
            return Err(protocol_error());
        }
        None
    };
    Ok((payload, phase))
}

fn parse_reasoning_finalized(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: ReasoningFinalizedPayload = parse_payload(payload)?;
    if payload.contents.len() > MAX_REASONING_PARTS {
        return Err(protocol_error());
    }
    let mut total = 0_usize;
    let mut contents = Vec::with_capacity(payload.contents.len());
    for (expected, part) in payload.contents.into_iter().enumerate() {
        if part.content_index != expected {
            return Err(protocol_error());
        }
        validate_text(&part.text, MAX_REASONING_PART_BYTES, false)?;
        total = total
            .checked_add(part.text.len())
            .ok_or_else(protocol_error)?;
        contents.push(HostReasoningPart {
            content_index: part.content_index,
            text: part.text,
        });
    }
    if total > MAX_REASONING_ITEM_BYTES {
        return Err(protocol_error());
    }
    let reason = payload
        .reason_code
        .as_deref()
        .map(parse_reasoning_reason)
        .transpose()?;
    let status = match payload.status.as_str() {
        "complete" if !contents.is_empty() && reason.is_none() => HostReasoningStatus::Complete,
        "incomplete" if !contents.is_empty() && reason.is_some() => HostReasoningStatus::Incomplete,
        "unavailable" if contents.is_empty() && reason.is_some() => {
            HostReasoningStatus::Unavailable
        }
        _ => return Err(protocol_error()),
    };
    Ok(HostEventKind::ReasoningTextFinalized {
        status,
        contents,
        reason,
    })
}

fn parse_reasoning_reason(value: &str) -> Result<HostReasoningReason, HostBridgeError> {
    match value {
        "reasoning_not_emitted" => Ok(HostReasoningReason::ReasoningNotEmitted),
        "turn_interrupted" => Ok(HostReasoningReason::TurnInterrupted),
        "stream_gap" => Ok(HostReasoningReason::StreamGap),
        "runtime_error" => Ok(HostReasoningReason::RuntimeError),
        "limit_exceeded" => Ok(HostReasoningReason::LimitExceeded),
        "protocol_error" => Ok(HostReasoningReason::ProtocolError),
        "host_shutdown" => Ok(HostReasoningReason::HostShutdown),
        _ => Err(protocol_error()),
    }
}

fn parse_payload<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, HostBridgeError> {
    serde_json::from_value(value).map_err(|_| protocol_error())
}

fn parse_uuid(value: &str) -> Result<Uuid, HostBridgeError> {
    let value = Uuid::parse_str(value).map_err(|_| protocol_error())?;
    if value.is_nil() {
        return Err(protocol_error());
    }
    Ok(value)
}

fn validate_text(value: &str, max_bytes: usize, allow_empty: bool) -> Result<(), HostBridgeError> {
    if (!allow_empty && value.is_empty())
        || value.len() > max_bytes
        || value.contains('\r')
        || value.contains('\0')
    {
        return Err(protocol_error());
    }
    Ok(())
}

fn validate_optional_text(value: Option<&str>, max_bytes: usize) -> Result<(), HostBridgeError> {
    if let Some(value) = value {
        validate_text(value, max_bytes, false)?;
    }
    Ok(())
}

pub(super) const fn protocol_error() -> HostBridgeError {
    HostBridgeError::new(HostBridgeErrorKind::Protocol)
}

pub(super) fn parse_host_error_code(value: &str) -> HostErrorCode {
    match value {
        "unauthorized" => HostErrorCode::Unauthorized,
        "capability_denied" => HostErrorCode::CapabilityDenied,
        "invalid_request" => HostErrorCode::InvalidRequest,
        "skill_not_found" => HostErrorCode::SkillNotFound,
        "skill_not_installable" => HostErrorCode::SkillNotInstallable,
        "skill_operation_conflict" => HostErrorCode::SkillOperationConflict,
        "skill_busy" => HostErrorCode::SkillBusy,
        "bundle_missing" => HostErrorCode::BundleMissing,
        "bundle_manifest_invalid" => HostErrorCode::BundleManifestInvalid,
        "archive_checksum_mismatch" => HostErrorCode::ArchiveChecksumMismatch,
        "archive_unsafe" => HostErrorCode::ArchiveUnsafe,
        "archive_too_large" => HostErrorCode::ArchiveTooLarge,
        "install_failed" => HostErrorCode::InstallFailed,
        "uninstall_failed" => HostErrorCode::UninstallFailed,
        "scan_failed" => HostErrorCode::ScanFailed,
        "runtime_unavailable" => HostErrorCode::RuntimeUnavailable,
        "runtime_sync_failed" => HostErrorCode::RuntimeSyncFailed,
        "session_not_found" => HostErrorCode::SessionNotFound,
        "task_session_exists" => HostErrorCode::TaskSessionExists,
        "turn_active" => HostErrorCode::TurnActive,
        "turn_operation_conflict" => HostErrorCode::TurnOperationConflict,
        "turn_not_active" => HostErrorCode::TurnNotActive,
        "session_not_usable" => HostErrorCode::SessionNotUsable,
        "event_stream_changed" => HostErrorCode::EventStreamChanged,
        "event_replay_unavailable" => HostErrorCode::EventReplayUnavailable,
        "invalid_event_cursor" => HostErrorCode::InvalidEventCursor,
        "runtime_request_failed" => HostErrorCode::RuntimeRequestFailed,
        "streaming_unsupported" => HostErrorCode::StreamingUnsupported,
        "cleanup_incomplete" => HostErrorCode::CleanupIncomplete,
        "cleanup_operation_conflict" => HostErrorCode::CleanupOperationConflict,
        "internal_error" => HostErrorCode::InternalError,
        _ => HostErrorCode::Unknown,
    }
}

pub(super) fn parse_cleanup_reason(value: &str) -> Result<HostCleanupReason, HostBridgeError> {
    match value {
        "active_turn" => Ok(HostCleanupReason::ActiveTurn),
        "terminal_unconfirmed" => Ok(HostCleanupReason::TerminalUnconfirmed),
        "shared_thread_mapping" => Ok(HostCleanupReason::SharedThreadMapping),
        "runtime_delete_failed" => Ok(HostCleanupReason::RuntimeDeleteFailed),
        "runtime_delete_unconfirmed" => Ok(HostCleanupReason::RuntimeDeleteUnconfirmed),
        "host_mapping_cleanup_failed" => Ok(HostCleanupReason::HostMappingCleanupFailed),
        "host_replay_cleanup_failed" => Ok(HostCleanupReason::HostReplayCleanupFailed),
        "operation_state_unavailable" => Ok(HostCleanupReason::OperationStateUnavailable),
        "internal_error" => Ok(HostCleanupReason::InternalError),
        _ => Err(protocol_error()),
    }
}

pub(super) fn parse_cleanup_surface(
    value: &str,
) -> Result<HostCleanupSurfaceStatus, HostBridgeError> {
    match value {
        "complete" => Ok(HostCleanupSurfaceStatus::Complete),
        "incomplete" => Ok(HostCleanupSurfaceStatus::Incomplete),
        "not_attempted" => Ok(HostCleanupSurfaceStatus::NotAttempted),
        _ => Err(protocol_error()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../yijie-contracts/tests/fixtures/agent/session-event-v2")
            .join(name);
        fs::read_to_string(path).expect("read canonical contracts fixture")
    }

    #[test]
    fn canonical_reasoning_fixtures_map_to_typed_redacted_domain() {
        let stream = Uuid::parse_str("019fbd88-cbc3-7bf1-934d-7b05cd693f41").unwrap();
        for (name, event_name, sequence) in [
            ("reasoning-delta.json", "item.reasoning_text.delta", 4),
            (
                "reasoning-finalized-complete.json",
                "item.reasoning_text.finalized",
                5,
            ),
            (
                "reasoning-finalized-incomplete.json",
                "item.reasoning_text.finalized",
                6,
            ),
            (
                "reasoning-finalized-unavailable.json",
                "item.reasoning_text.finalized",
                7,
            ),
        ] {
            let data = fixture(name).replace(['\r', '\n'], "");
            let frame = format!("id: {stream}:{sequence}\nevent: {event_name}\ndata: {data}\n\n");
            let mut decoder = SseDecoder::new(stream, sequence - 1, 2);
            decoder.push(frame.as_bytes()).unwrap();
            let HostStreamEvent::Ordinary(event) = decoder.next().expect("typed canonical event")
            else {
                panic!("ordinary event expected");
            };
            assert_eq!(event.cursor.sequence, sequence);
            let debug = format!("{event:?}");
            assert!(!debug.contains("先比较合成约束"));
            assert!(!debug.contains("已验证的合成前缀"));
        }
    }

    #[test]
    fn unknown_events_advance_only_the_delivery_cursor_and_drop_payload() {
        let stream = Uuid::now_v7();
        let data = serde_json::json!({
            "schema_version": 2,
            "event_id": Uuid::now_v7(),
            "stream_id": stream,
            "sequence": 8,
            "occurred_at": "2026-08-02T10:00:04Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": Uuid::now_v7(),
            "codex_thread_id": Uuid::now_v7(),
            "event_type": "future.content.variant",
            "terminal": false,
            "payload": {"secret_future_body": "must-be-dropped"}
        });
        let frame = format!(
            "id: {stream}:8\nevent: future.content.variant\ndata: {}\n\n",
            serde_json::to_string(&data).unwrap()
        );
        let mut decoder = SseDecoder::new(stream, 7, 2);
        decoder.push(frame.as_bytes()).unwrap();
        let HostStreamEvent::Ordinary(event) = decoder.next().unwrap() else {
            panic!("ordinary event expected");
        };
        assert!(matches!(event.kind, HostEventKind::Unknown));
        assert!(!format!("{event:?}").contains("must-be-dropped"));
    }

    #[test]
    fn malformed_cursor_duplicate_sequence_and_reasoning_caps_fail_closed() {
        let stream = Uuid::now_v7();
        let base = serde_json::json!({
            "schema_version": 2,
            "event_id": Uuid::now_v7(),
            "stream_id": stream,
            "sequence": 2,
            "occurred_at": "2026-08-02T10:00:04Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": Uuid::now_v7(),
            "codex_thread_id": Uuid::now_v7(),
            "turn_id": Uuid::now_v7(),
            "item_id": "reasoning-item",
            "event_type": "item.reasoning_text.delta",
            "terminal": false,
            "payload": {"content_index": 8, "delta": "invalid"}
        });
        let frame = format!(
            "id: {stream}:2\nevent: item.reasoning_text.delta\ndata: {}\n\n",
            serde_json::to_string(&base).unwrap()
        );
        let mut decoder = SseDecoder::new(stream, 1, 2);
        assert!(decoder.push(frame.as_bytes()).is_err());

        let malformed = format!("id: {stream}:01\nevent: warning\ndata: {{}}\n\n");
        let mut decoder = SseDecoder::new(stream, 0, 2);
        assert!(decoder.push(malformed.as_bytes()).is_err());
    }

    #[test]
    fn one_network_chunk_may_contain_many_individually_bounded_frames() {
        let stream = Uuid::now_v7();
        let heartbeat = ": heartbeat\n\n";
        let chunk = heartbeat.repeat((MAX_EVENT_BYTES / heartbeat.len()) + 2);
        assert!(chunk.len() > MAX_EVENT_BYTES);
        let mut decoder = SseDecoder::new(stream, 0, 2);
        decoder.push(chunk.as_bytes()).unwrap();
        decoder.finish().unwrap();
        assert!(decoder.next().is_none());
    }

    #[test]
    fn v3_decoder_allows_exact_replay_for_reducer_but_rejects_unknown_required_shapes() {
        let stream = Uuid::now_v7();
        let event_id = Uuid::now_v7();
        let body = serde_json::json!({
            "schema_version": 3,
            "event_id": event_id,
            "stream_id": stream,
            "sequence": 1,
            "occurred_at": "2026-08-20T00:00:00Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": Uuid::now_v7(),
            "codex_thread_id": Uuid::now_v7(),
            "turn_id": Uuid::now_v7(),
            "event_type": "item.artifact.started",
            "terminal": false,
            "payload": {}
        });
        let frame = format!("id: {stream}:1\nevent: item.artifact.started\ndata: {body}\n\n");
        let mut decoder = SseDecoder::new(stream, 0, 3);
        decoder.push(frame.as_bytes()).unwrap();
        decoder.push(frame.as_bytes()).unwrap();
        assert!(matches!(decoder.next(), Some(HostStreamEvent::Artifact(_))));
        assert!(matches!(decoder.next(), Some(HostStreamEvent::Artifact(_))));

        let mut unknown = body;
        unknown["event_type"] = serde_json::json!("future.required.variant");
        let frame = format!("id: {stream}:2\nevent: future.required.variant\ndata: {unknown}\n\n");
        assert!(decoder.push(frame.as_bytes()).is_err());
    }

    #[test]
    fn lifecycle_decoder_accepts_contract_authorized_empty_start_snapshots() {
        let stream = Uuid::now_v7();
        let task_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let codex_thread_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        for (schema_version, sequence, payload) in [
            (
                3,
                1,
                serde_json::json!({"item_type":"agentMessage","text":""}),
            ),
            (
                4,
                2,
                serde_json::json!({"item_type":"agentMessage","text":"","phase":null}),
            ),
        ] {
            let body = serde_json::json!({
                "schema_version": schema_version,
                "event_id": Uuid::now_v7(),
                "stream_id": stream,
                "sequence": sequence,
                "occurred_at": "2026-08-28T06:00:00Z",
                "task_id": task_id,
                "agent_session_id": agent_session_id,
                "codex_thread_id": codex_thread_id,
                "turn_id": turn_id,
                "item_id": "assistant-1",
                "event_type": "item.started",
                "terminal": false,
                "payload": payload,
            });
            let frame = format!("id: {stream}:{sequence}\nevent: item.started\ndata: {body}\n\n");
            let mut decoder = SseDecoder::new(stream, sequence - 1, schema_version);
            decoder.push(frame.as_bytes()).unwrap();
            let HostStreamEvent::Ordinary(event) = decoder.next().expect("lifecycle event") else {
                panic!("ordinary lifecycle expected");
            };
            assert!(matches!(
                event.kind,
                HostEventKind::ItemStarted {
                    item_type,
                    text: Some(text),
                    phase: None,
                } if item_type == "agentMessage" && text.is_empty()
            ));
        }
    }

    #[test]
    fn v4_replay_chunk_with_empty_agent_start_reaches_terminal() {
        let stream = Uuid::now_v7();
        let task_id = Uuid::now_v7();
        let agent_session_id = Uuid::now_v7();
        let codex_thread_id = Uuid::now_v7();
        let turn_id = Uuid::now_v7();
        let mut chunk = String::new();
        for (sequence, event_type, terminal, item_id, payload) in [
            (
                1,
                "item.started",
                false,
                Some("assistant-1"),
                serde_json::json!({"item_type":"agentMessage","text":"","phase":null}),
            ),
            (
                2,
                "item.agent_message.delta",
                false,
                Some("assistant-1"),
                serde_json::json!({"delta":"ok"}),
            ),
            (
                3,
                "item.completed",
                false,
                Some("assistant-1"),
                serde_json::json!({"item_type":"agentMessage","text":"ok","phase":null}),
            ),
            (
                4,
                "turn.completed",
                true,
                None,
                serde_json::json!({"status":"completed"}),
            ),
        ] {
            let body = serde_json::json!({
                "schema_version": 4,
                "event_id": Uuid::now_v7(),
                "stream_id": stream,
                "sequence": sequence,
                "occurred_at": "2026-08-28T06:00:00Z",
                "task_id": task_id,
                "agent_session_id": agent_session_id,
                "codex_thread_id": codex_thread_id,
                "turn_id": turn_id,
                "item_id": item_id,
                "event_type": event_type,
                "terminal": terminal,
                "payload": payload,
            });
            chunk.push_str(&format!(
                "id: {stream}:{sequence}\nevent: {event_type}\ndata: {body}\n\n"
            ));
        }

        let mut decoder = SseDecoder::new(stream, 0, 4);
        decoder.push(chunk.as_bytes()).unwrap();
        let events = std::iter::from_fn(|| decoder.next()).collect::<Vec<_>>();
        assert_eq!(events.len(), 4);
        assert!(matches!(
            events.last(),
            Some(HostStreamEvent::Ordinary(HostEvent {
                kind: HostEventKind::TurnCompleted {
                    status: HostTurnStatus::Completed,
                    ..
                },
                ..
            }))
        ));
    }

    #[test]
    fn v4_known_shape_and_rfc3339_failures_do_not_advance_delivery_cursor() {
        let stream = Uuid::now_v7();
        let mut body = serde_json::json!({
            "schema_version": 4,
            "event_id": Uuid::now_v7(),
            "stream_id": stream,
            "sequence": 1,
            "occurred_at": "2026-08-28T06:00:00Z",
            "task_id": Uuid::now_v7(),
            "agent_session_id": Uuid::now_v7(),
            "codex_thread_id": Uuid::now_v7(),
            "turn_id": Uuid::now_v7(),
            "event_type": "item.agent_message.delta",
            "terminal": false,
            "payload": {"delta": "bounded"}
        });
        let frame =
            |body: &Value| format!("id: {stream}:1\nevent: item.agent_message.delta\ndata: {body}");
        let mut last_sequence = 0;
        assert!(parse_sse_frame(frame(&body).as_bytes(), stream, 4, &mut last_sequence).is_err());
        assert_eq!(
            last_sequence, 0,
            "known v4 shape failure consumed the cursor"
        );

        body["item_id"] = serde_json::json!("assistant-1");
        body["occurred_at"] = serde_json::json!("2026-99-99T06:00:00Z");
        assert!(parse_sse_frame(frame(&body).as_bytes(), stream, 4, &mut last_sequence).is_err());
        assert_eq!(last_sequence, 0, "invalid RFC3339 consumed the cursor");

        body["occurred_at"] = serde_json::json!("2026-08-28T06:00:00.123+08:00");
        let parsed = parse_sse_frame(frame(&body).as_bytes(), stream, 4, &mut last_sequence)
            .unwrap()
            .unwrap();
        assert!(matches!(parsed, HostStreamEvent::Ordinary(_)));
        assert_eq!(last_sequence, 1);
    }
}
