use serde::Deserialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::fmt::{Debug, Formatter};
use std::path::PathBuf;
use uuid::Uuid;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_SSE_FRAME_BYTES: usize = MAX_EVENT_BYTES + 1024;
const MAX_CONTEXT_BYTES: usize = 256;
const MAX_V5_CONTEXT_UTF8_BYTES: usize = 1024;
const MAX_ITEM_ID_BYTES: usize = 255;
const MAX_REASONING_DELTA_BYTES: usize = 16 * 1024;
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_PARTS: usize = 8;
const MAX_COMMAND_SUMMARY_BYTES: usize = 4 * 1024;
const MAX_COMMAND_DELTA_BYTES: usize = 16 * 1024;
const MAX_COMMAND_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_COMMAND_OUTPUT_PART_BYTES: usize = 128 * 1024;
const MAX_COMMAND_CWD_BYTES: usize = 1024;
const MAX_TOOL_ARGUMENTS_BYTES: usize = 8 * 1024;
const MAX_TOOL_PROGRESS_BYTES: usize = 4 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 64 * 1024;
const MAX_EXECUTION_ERROR_BYTES: usize = 4 * 1024;
const APPROVAL_TTL_SECONDS: i128 = 120;

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
    InvalidApprovalRequest,
    ApprovalVersionMismatch,
    ApprovalNotFound,
    ApprovalStale,
    ApprovalExpired,
    ApprovalAlreadyResolved,
    ApprovalDecisionConflict,
    ApprovalUnavailable,
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
pub enum HostTruncationReason {
    Utf8ByteLimit,
    UpstreamTruncated,
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostSafeText {
    pub text: String,
    pub truncated: bool,
    pub truncation_reason: Option<HostTruncationReason>,
}

impl Debug for HostSafeText {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostSafeText")
            .field("utf8_bytes", &self.text.len())
            .field("truncated", &self.truncated)
            .field("truncation_reason", &self.truncation_reason)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum HostCommandCwd {
    WorkspaceRoot,
    WorkspaceRelative(Vec<String>),
    Redacted,
}

impl Debug for HostCommandCwd {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WorkspaceRoot => formatter.write_str("WorkspaceRoot"),
            Self::WorkspaceRelative(segments) => formatter
                .debug_struct("WorkspaceRelative")
                .field("segment_count", &segments.len())
                .finish(),
            Self::Redacted => formatter.write_str("Redacted"),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum HostCommandOutput {
    Complete {
        text: String,
    },
    HeadTail {
        head: String,
        tail: String,
        reason: HostTruncationReason,
    },
    Unavailable,
}

impl Debug for HostCommandOutput {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Complete { text } => formatter
                .debug_struct("Complete")
                .field("utf8_bytes", &text.len())
                .finish(),
            Self::HeadTail { head, tail, reason } => formatter
                .debug_struct("HeadTail")
                .field("head_utf8_bytes", &head.len())
                .field("tail_utf8_bytes", &tail.len())
                .field("reason", reason)
                .finish(),
            Self::Unavailable => formatter.write_str("Unavailable"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCommandStatus {
    Completed,
    Failed,
    Declined,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCommandErrorCode {
    CommandFailed,
    CommandDeclined,
    ProjectionLimitExceeded,
    ProjectionRedactionFailed,
    ProtocolError,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostToolErrorCode {
    ToolFailed,
    ToolDeclined,
    UnknownTool,
    ProjectionLimitExceeded,
    ProjectionRedactionFailed,
    ProtocolError,
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostProjectionError<C> {
    pub code: C,
    pub summary: String,
}

impl<C: Debug> Debug for HostProjectionError<C> {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostProjectionError")
            .field("code", &self.code)
            .field("summary_utf8_bytes", &self.summary.len())
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum HostToolIdentity {
    Known {
        server_name: String,
        tool_name: String,
    },
    Unknown,
}

impl Debug for HostToolIdentity {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Known {
                server_name,
                tool_name,
            } => formatter
                .debug_struct("Known")
                .field("server_name_utf8_bytes", &server_name.len())
                .field("tool_name_utf8_bytes", &tool_name.len())
                .finish(),
            Self::Unknown => formatter.write_str("Unknown"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostToolStatus {
    Completed,
    Failed,
    Declined,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostApprovalDecision {
    AcceptOnce,
    CancelCurrentTurn,
}

impl HostApprovalDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AcceptOnce => "accept_once",
            Self::CancelCurrentTurn => "cancel_current_turn",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostApprovalOutcome {
    AcceptedOnce,
    CancelledCurrentTurn,
    Expired,
    ResolvedElsewhere,
}

impl HostApprovalOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AcceptedOnce => "accepted_once",
            Self::CancelledCurrentTurn => "cancelled_current_turn",
            Self::Expired => "expired",
            Self::ResolvedElsewhere => "resolved_elsewhere",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostApprovalRequested {
    pub approval_request_id: Uuid,
    pub requested_at: String,
    pub expires_at: String,
}

impl Debug for HostApprovalRequested {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostApprovalRequested")
            .field("revision", &1)
            .field("action_id", &"git_repository_check")
            .field("workspace_scope", &"current_workspace")
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct HostApprovalResolved {
    pub approval_request_id: Uuid,
    pub outcome: HostApprovalOutcome,
    pub decision_id: Option<Uuid>,
    pub decision: Option<HostApprovalDecision>,
    pub requested_at: String,
    pub expires_at: String,
    pub resolved_at: String,
}

impl Debug for HostApprovalResolved {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostApprovalResolved")
            .field("revision", &2)
            .field("outcome", &self.outcome)
            .field("decision_present", &self.decision.is_some())
            .finish()
    }
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

#[derive(Clone)]
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
    CommandStarted {
        command_summary: HostSafeText,
        cwd: HostCommandCwd,
    },
    CommandOutputDelta {
        delta: HostSafeText,
    },
    CommandCompleted {
        status: HostCommandStatus,
        command_summary: HostSafeText,
        cwd: HostCommandCwd,
        duration_ms: Option<u64>,
        exit_code: Option<i32>,
        output: HostCommandOutput,
        error: Option<HostProjectionError<HostCommandErrorCode>>,
    },
    ToolStarted {
        identity: HostToolIdentity,
        arguments_summary: HostSafeText,
    },
    ToolProgress {
        identity: HostToolIdentity,
        progress_index: usize,
        summary: HostSafeText,
    },
    ToolCompleted {
        status: HostToolStatus,
        identity: HostToolIdentity,
        arguments_summary: HostSafeText,
        duration_ms: Option<u64>,
        result_summary: Option<HostSafeText>,
        error: Option<HostProjectionError<HostToolErrorCode>>,
    },
    ApprovalRequested(HostApprovalRequested),
    ApprovalResolved(HostApprovalResolved),
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
            Self::CommandStarted { .. } => "item.started/commandExecution",
            Self::CommandOutputDelta { .. } => "item.command_output.delta",
            Self::CommandCompleted { .. } => "item.completed/commandExecution",
            Self::ToolStarted { .. } => "item.started/mcpToolCall",
            Self::ToolProgress { .. } => "item.tool.progress",
            Self::ToolCompleted { .. } => "item.completed/mcpToolCall",
            Self::ApprovalRequested(_) => "approval.requested",
            Self::ApprovalResolved(_) => "approval.resolved",
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

#[derive(Clone)]
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
    pub schema_version: u8,
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
            .field("schema_version", &self.schema_version)
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
    Native(Box<super::native_conversation_generated::NativeEvent>),
    Ordinary(HostEvent),
    Artifact(HostArtifactEventV3),
}

impl Debug for HostStreamEvent {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Native(event) => event.fmt(formatter),
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSafeText {
    text: String,
    truncated: bool,
    truncation_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireCommandCwd {
    kind: String,
    segments: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandStartedPayloadV5 {
    item_type: String,
    status: String,
    command_summary: WireSafeText,
    cwd: WireCommandCwd,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandOutputDeltaPayloadV5 {
    delta: String,
    truncated: bool,
    truncation_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireCommandOutput {
    retention: String,
    text: Option<String>,
    head: Option<String>,
    tail: Option<String>,
    reason: Option<String>,
    truncated: bool,
    truncation_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireProjectionError {
    code: String,
    summary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandCompletedPayloadV5 {
    item_type: String,
    status: String,
    command_summary: WireSafeText,
    cwd: WireCommandCwd,
    duration_ms: Option<u64>,
    exit_code: Option<i32>,
    output: WireCommandOutput,
    error: Option<WireProjectionError>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireToolIdentity {
    resolution: String,
    server_name: String,
    tool_name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolStartedPayloadV5 {
    item_type: String,
    status: String,
    identity: WireToolIdentity,
    arguments_summary: WireSafeText,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolProgressPayloadV5 {
    item_type: String,
    status: String,
    identity: WireToolIdentity,
    progress_index: usize,
    summary: WireSafeText,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolCompletedPayloadV5 {
    item_type: String,
    status: String,
    identity: WireToolIdentity,
    arguments_summary: WireSafeText,
    duration_ms: Option<u64>,
    result_summary: Option<WireSafeText>,
    error: Option<WireProjectionError>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireApprovalDecisionSetV6 {
    primary: String,
    secondary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApprovalRequestedPayloadV6 {
    item_type: String,
    approval_request_id: String,
    revision: u8,
    action_id: String,
    workspace_scope: String,
    decisions: WireApprovalDecisionSetV6,
    requested_at: String,
    expires_at: String,
    ttl_seconds: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApprovalResolvedPayloadV6 {
    item_type: String,
    approval_request_id: String,
    revision: u8,
    action_id: String,
    workspace_scope: String,
    outcome: String,
    decision_id: Option<String>,
    decision: Option<String>,
    requested_at: String,
    expires_at: String,
    resolved_at: String,
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
        || (schema_version < 5 && id_sequence < *last_sequence)
        || schema_version == 2 && id_sequence == *last_sequence
    {
        return Err(protocol_error());
    }
    let parsed = parse_event_json(data, expected_stream, schema_version)?;
    let (parsed_cursor, parsed_event_type) = match &parsed {
        HostStreamEvent::Native(event) => (
            HostEventCursor::new(
                parse_uuid(&event.stream_id)?,
                u64::try_from(event.sequence).map_err(|_| protocol_error())?,
            )?,
            event.event_type.as_str(),
        ),
        HostStreamEvent::Ordinary(event) => (event.cursor, event.event_type.as_str()),
        HostStreamEvent::Artifact(event) => (event.cursor, event.event_type.as_str()),
    };
    if parsed_cursor.sequence != id_sequence || parsed_event_type != event_type {
        return Err(protocol_error());
    }
    *last_sequence = (*last_sequence).max(id_sequence);
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
    let raw: Value = serde_json::from_str(data).map_err(|_| protocol_error())?;
    if schema_version == 7 {
        let event: super::native_conversation_generated::NativeEvent =
            serde_json::from_value(raw).map_err(|_| protocol_error())?;
        if event.schema_version != 7
            || event.event_type != "native.notification"
            || parse_uuid(&event.stream_id)? != expected_stream
            || event.sequence <= 0
            || !valid_rfc3339(&event.occurred_at)
        {
            return Err(protocol_error());
        }
        for id in [
            &event.event_id,
            &event.task_id,
            &event.agent_session_id,
            &event.codex_thread_id,
        ] {
            parse_uuid(id)?;
        }
        return Ok(HostStreamEvent::Native(Box::new(event)));
    }
    if schema_version >= 5 {
        validate_v5_explicit_nulls(&raw)?;
    }
    let wire: WireEvent = serde_json::from_value(raw).map_err(|_| protocol_error())?;
    if !matches!(schema_version, 2..=6)
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
        let over_limit = if schema_version >= 5 {
            value.chars().count() > MAX_CONTEXT_BYTES || value.len() > MAX_V5_CONTEXT_UTF8_BYTES
        } else {
            value.len() > MAX_CONTEXT_BYTES
        };
        if value.is_empty()
            || over_limit
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
            let over_limit = if schema_version >= 5 {
                value.chars().count() > MAX_CONTEXT_BYTES || value.len() > MAX_V5_CONTEXT_UTF8_BYTES
            } else {
                value.len() > maximum_item_id_bytes
            };
            if value.is_empty()
                || over_limit
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
            schema_version,
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
    if schema_version == 5 && !is_v5_ordinary_event_type(&event_type) {
        return Err(protocol_error());
    }
    if schema_version == 6 && !is_v6_ordinary_event_type(&event_type) {
        return Err(protocol_error());
    }
    if schema_version == 6
        && matches!(
            event_type.as_str(),
            "approval.requested" | "approval.resolved"
        )
        && wire.request_id.is_some()
    {
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

fn validate_v5_explicit_nulls(value: &Value) -> Result<(), HostBridgeError> {
    let event = value.as_object().ok_or_else(protocol_error)?;
    let event_type = event
        .get("event_type")
        .and_then(Value::as_str)
        .ok_or_else(protocol_error)?;
    for (key, value) in event {
        if value.is_null() || (key != "payload" && contains_json_null(value)) {
            return Err(protocol_error());
        }
    }
    let payload = event
        .get("payload")
        .and_then(Value::as_object)
        .ok_or_else(protocol_error)?;
    let allows_explanation_null = event_type == "turn.plan.updated";
    let allows_phase_null = matches!(event_type, "item.started" | "item.completed")
        && payload.get("item_type").and_then(Value::as_str) == Some("agentMessage");
    for (key, value) in payload {
        if value.is_null()
            && !((allows_explanation_null && key == "explanation")
                || (allows_phase_null && key == "phase"))
        {
            return Err(protocol_error());
        }
        if !value.is_null() && contains_json_null(value) {
            return Err(protocol_error());
        }
    }
    Ok(())
}

fn contains_json_null(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(values) => values.iter().any(contains_json_null),
        Value::Object(values) => values.values().any(contains_json_null),
        _ => false,
    }
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

fn is_v5_ordinary_event_type(value: &str) -> bool {
    is_v4_ordinary_event_type(value)
        || matches!(value, "item.command_output.delta" | "item.tool.progress")
}

fn is_v6_ordinary_event_type(value: &str) -> bool {
    is_v5_ordinary_event_type(value) || matches!(value, "approval.requested" | "approval.resolved")
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
            if schema_version >= 5 {
                validate_text_chars_bytes(&payload.model, 256, 1024, false)?;
                validate_text_chars_bytes(&payload.model_provider, 256, 1024, false)?;
            } else {
                validate_text(&payload.model, 256, false)?;
                validate_text(&payload.model_provider, 256, false)?;
            }
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
            if schema_version >= 4 && !terminal && turn_id.is_some() && item_id.is_none() =>
        {
            let payload: TurnPlanUpdatedPayload = parse_payload(payload)?;
            if payload.plan.len() > 128 {
                return Err(protocol_error());
            }
            if schema_version >= 5 {
                validate_optional_text_chars_bytes(
                    payload.explanation.as_deref(),
                    16_384,
                    64 * 1024,
                )?;
            } else {
                validate_optional_text(payload.explanation.as_deref(), 64 * 1024)?;
            }
            let steps = payload
                .plan
                .into_iter()
                .map(|step| {
                    if schema_version >= 5 {
                        validate_text_chars_bytes(&step.step, 16_384, 64 * 1024, true)?;
                    } else {
                        validate_text(&step.step, 64 * 1024, true)?;
                    }
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
            if schema_version >= 5 {
                return parse_item_started_v5(payload);
            }
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
        "item.command_output.delta"
            if schema_version >= 5 && !terminal && turn_id.is_some() && item_id.is_some() =>
        {
            parse_command_output_delta_v5(payload)
        }
        "item.tool.progress"
            if schema_version >= 5 && !terminal && turn_id.is_some() && item_id.is_some() =>
        {
            parse_tool_progress_v5(payload)
        }
        "approval.requested"
            if schema_version == 6 && !terminal && turn_id.is_some() && item_id.is_some() =>
        {
            parse_approval_requested_v6(payload)
        }
        "approval.resolved"
            if schema_version == 6 && !terminal && turn_id.is_some() && item_id.is_some() =>
        {
            parse_approval_resolved_v6(payload)
        }
        "item.completed" if !terminal && turn_id.is_some() && item_id.is_some() => {
            if schema_version >= 5 {
                return parse_item_completed_v5(payload);
            }
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
            if schema_version >= 5 {
                validate_optional_text_allow_empty(payload.code.as_deref(), MAX_EVENT_BYTES)?;
                validate_optional_text_allow_empty(payload.message.as_deref(), MAX_EVENT_BYTES)?;
            } else {
                validate_optional_text(payload.code.as_deref(), 256)?;
                validate_optional_text(payload.message.as_deref(), 8 * 1024)?;
            }
            Ok(HostEventKind::TurnCompleted {
                status,
                code: payload.code,
                message: payload.message,
            })
        }
        "error" if !terminal && turn_id.is_some() && item_id.is_none() => {
            let payload: ProblemPayload = parse_payload(payload)?;
            if schema_version >= 5 {
                validate_optional_text_allow_empty(payload.code.as_deref(), MAX_EVENT_BYTES)?;
                validate_text(&payload.message, MAX_EVENT_BYTES, true)?;
            } else {
                validate_optional_text(payload.code.as_deref(), 256)?;
                validate_text(&payload.message, 8 * 1024, false)?;
            }
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
            if schema_version >= 5 {
                validate_optional_text_chars_bytes(
                    payload.code.as_deref(),
                    256,
                    MAX_V5_CONTEXT_UTF8_BYTES,
                )?;
                validate_text_chars_bytes(&payload.message, 16_384, 64 * 1024, true)?;
            } else {
                validate_optional_text(payload.code.as_deref(), 256)?;
                validate_text(&payload.message, 8 * 1024, false)?;
            }
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

fn parse_approval_requested_v6(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: ApprovalRequestedPayloadV6 = parse_payload(payload)?;
    if payload.item_type != "commandExecution"
        || payload.revision != 1
        || payload.action_id != "git_repository_check"
        || payload.workspace_scope != "current_workspace"
        || payload.decisions.primary != "accept_once"
        || payload.decisions.secondary != "cancel_current_turn"
        || payload.ttl_seconds != APPROVAL_TTL_SECONDS as u16
        || !valid_approval_window(&payload.requested_at, &payload.expires_at)
    {
        return Err(protocol_error());
    }
    Ok(HostEventKind::ApprovalRequested(HostApprovalRequested {
        approval_request_id: parse_uuid(&payload.approval_request_id)?,
        requested_at: payload.requested_at,
        expires_at: payload.expires_at,
    }))
}

fn parse_approval_resolved_v6(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: ApprovalResolvedPayloadV6 = parse_payload(payload)?;
    if payload.item_type != "commandExecution"
        || payload.revision != 2
        || payload.action_id != "git_repository_check"
        || payload.workspace_scope != "current_workspace"
        || !valid_approval_window(&payload.requested_at, &payload.expires_at)
    {
        return Err(protocol_error());
    }
    let requested_at =
        parse_rfc3339_epoch_nanos(&payload.requested_at).ok_or_else(protocol_error)?;
    let expires_at = parse_rfc3339_epoch_nanos(&payload.expires_at).ok_or_else(protocol_error)?;
    let resolved_at = parse_rfc3339_epoch_nanos(&payload.resolved_at).ok_or_else(protocol_error)?;
    let (outcome, decision_id, decision) = match payload.outcome.as_str() {
        "accepted_once"
            if payload.decision.as_deref() == Some("accept_once")
                && payload.decision_id.is_some()
                && resolved_at >= requested_at
                && resolved_at < expires_at =>
        {
            (
                HostApprovalOutcome::AcceptedOnce,
                payload.decision_id.as_deref().map(parse_uuid).transpose()?,
                Some(HostApprovalDecision::AcceptOnce),
            )
        }
        "cancelled_current_turn"
            if payload.decision.as_deref() == Some("cancel_current_turn")
                && payload.decision_id.is_some()
                && resolved_at >= requested_at
                && resolved_at < expires_at =>
        {
            (
                HostApprovalOutcome::CancelledCurrentTurn,
                payload.decision_id.as_deref().map(parse_uuid).transpose()?,
                Some(HostApprovalDecision::CancelCurrentTurn),
            )
        }
        "expired"
            if payload.decision_id.is_none()
                && payload.decision.is_none()
                && resolved_at >= expires_at =>
        {
            (HostApprovalOutcome::Expired, None, None)
        }
        "resolved_elsewhere"
            if payload.decision_id.is_none()
                && payload.decision.is_none()
                && resolved_at >= requested_at
                && resolved_at < expires_at =>
        {
            (HostApprovalOutcome::ResolvedElsewhere, None, None)
        }
        _ => return Err(protocol_error()),
    };
    Ok(HostEventKind::ApprovalResolved(HostApprovalResolved {
        approval_request_id: parse_uuid(&payload.approval_request_id)?,
        outcome,
        decision_id,
        decision,
        requested_at: payload.requested_at,
        expires_at: payload.expires_at,
        resolved_at: payload.resolved_at,
    }))
}

fn valid_approval_window(requested_at: &str, expires_at: &str) -> bool {
    let Some(requested_at) = parse_rfc3339_epoch_nanos(requested_at) else {
        return false;
    };
    let Some(expires_at) = parse_rfc3339_epoch_nanos(expires_at) else {
        return false;
    };
    expires_at.checked_sub(requested_at) == Some(APPROVAL_TTL_SECONDS * 1_000_000_000)
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

fn parse_rfc3339_epoch_nanos(value: &str) -> Option<i128> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = parse_decimal(bytes.get(0..4)?)?;
    let month = parse_decimal(bytes.get(5..7)?)?;
    let day = parse_decimal(bytes.get(8..10)?)?;
    let hour = parse_decimal(bytes.get(11..13)?)?;
    let minute = parse_decimal(bytes.get(14..16)?)?;
    let second = parse_decimal(bytes.get(17..19)?)?;
    if year == 0
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let mut index = 19_usize;
    let mut fraction_nanos = 0_i128;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) && index - start < 9 {
            fraction_nanos = fraction_nanos
                .checked_mul(10)?
                .checked_add(i128::from(bytes[index] - b'0'))?;
            index += 1;
        }
        if index == start || bytes.get(index).is_some_and(u8::is_ascii_digit) {
            return None;
        }
        for _ in index - start..9 {
            fraction_nanos = fraction_nanos.checked_mul(10)?;
        }
    }
    let offset_seconds = if bytes.get(index) == Some(&b'Z') && index + 1 == bytes.len() {
        0_i64
    } else {
        let sign = match bytes.get(index) {
            Some(b'+') => 1_i64,
            Some(b'-') => -1_i64,
            _ => return None,
        };
        if index + 6 != bytes.len() || bytes.get(index + 3) != Some(&b':') {
            return None;
        }
        let offset_hour = parse_decimal(bytes.get(index + 1..index + 3)?)?;
        let offset_minute = parse_decimal(bytes.get(index + 4..index + 6)?)?;
        if offset_hour > 23 || offset_minute > 59 {
            return None;
        }
        sign * i64::from(offset_hour * 3600 + offset_minute * 60)
    };
    let days = days_from_civil(year, month, day)?;
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(i64::from(hour * 3600 + minute * 60 + second))?
        .checked_sub(offset_seconds)?;
    i128::from(seconds)
        .checked_mul(1_000_000_000)?
        .checked_add(fraction_nanos)
}

fn parse_decimal(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bytes.iter().try_fold(0_u32, |value, digit| {
        value.checked_mul(10)?.checked_add(u32::from(*digit - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: u32, month: u32, day: u32) -> Option<i64> {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era.checked_mul(146_097)?
        .checked_add(day_of_era)?
        .checked_sub(719_468)
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
    if schema_version < 4 {
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

fn parse_item_started_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    match payload.get("item_type").and_then(Value::as_str) {
        Some("agentMessage") => {
            let (payload, phase) = parse_item_payload(payload, 5)?;
            Ok(HostEventKind::ItemStarted {
                item_type: payload.item_type,
                text: payload.text,
                phase,
            })
        }
        Some("commandExecution") => {
            let payload: CommandStartedPayloadV5 = parse_payload(payload)?;
            if payload.item_type != "commandExecution" || payload.status != "running" {
                return Err(protocol_error());
            }
            Ok(HostEventKind::CommandStarted {
                command_summary: parse_safe_text(
                    payload.command_summary,
                    MAX_COMMAND_SUMMARY_BYTES,
                )?,
                cwd: parse_command_cwd(payload.cwd)?,
            })
        }
        Some("mcpToolCall") => {
            let payload: ToolStartedPayloadV5 = parse_payload(payload)?;
            if payload.item_type != "mcpToolCall" || payload.status != "in_progress" {
                return Err(protocol_error());
            }
            Ok(HostEventKind::ToolStarted {
                identity: parse_tool_identity(payload.identity)?,
                arguments_summary: parse_safe_text(
                    payload.arguments_summary,
                    MAX_TOOL_ARGUMENTS_BYTES,
                )?,
            })
        }
        Some(item_type) if is_v5_generic_item_type(item_type) => {
            let payload: ItemLifecyclePayload = parse_payload(payload)?;
            if payload.text.is_some() {
                return Err(protocol_error());
            }
            Ok(HostEventKind::ItemStarted {
                item_type: payload.item_type,
                text: None,
                phase: None,
            })
        }
        _ => Err(protocol_error()),
    }
}

fn parse_item_completed_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    match payload.get("item_type").and_then(Value::as_str) {
        Some("agentMessage") => {
            let (payload, phase) = parse_item_payload(payload, 5)?;
            Ok(HostEventKind::ItemCompleted {
                item_type: payload.item_type,
                text: payload.text,
                phase,
            })
        }
        Some("commandExecution") => parse_command_completed_v5(payload),
        Some("mcpToolCall") => parse_tool_completed_v5(payload),
        Some(item_type) if is_v5_generic_item_type(item_type) => {
            let payload: ItemLifecyclePayload = parse_payload(payload)?;
            if payload.text.is_some() {
                return Err(protocol_error());
            }
            Ok(HostEventKind::ItemCompleted {
                item_type: payload.item_type,
                text: None,
                phase: None,
            })
        }
        _ => Err(protocol_error()),
    }
}

fn is_v5_generic_item_type(item_type: &str) -> bool {
    matches!(
        item_type,
        "userMessage"
            | "hookPrompt"
            | "reasoning"
            | "collabAgentToolCall"
            | "subAgentActivity"
            | "webSearch"
            | "imageView"
            | "sleep"
            | "imageGeneration"
            | "enteredReviewMode"
            | "exitedReviewMode"
            | "contextCompaction"
    )
}

fn parse_command_output_delta_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: CommandOutputDeltaPayloadV5 = parse_payload(payload)?;
    validate_bounded_text(&payload.delta, MAX_COMMAND_DELTA_BYTES, false)?;
    let reason = parse_truncation(payload.truncated, payload.truncation_reason.as_deref())?;
    Ok(HostEventKind::CommandOutputDelta {
        delta: HostSafeText {
            text: payload.delta,
            truncated: payload.truncated,
            truncation_reason: reason,
        },
    })
}

fn parse_tool_progress_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: ToolProgressPayloadV5 = parse_payload(payload)?;
    if payload.item_type != "mcpToolCall"
        || payload.status != "in_progress"
        || payload.progress_index >= 32
    {
        return Err(protocol_error());
    }
    Ok(HostEventKind::ToolProgress {
        identity: parse_tool_identity(payload.identity)?,
        progress_index: payload.progress_index,
        summary: parse_safe_text(payload.summary, MAX_TOOL_PROGRESS_BYTES)?,
    })
}

fn parse_command_completed_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: CommandCompletedPayloadV5 = parse_payload(payload)?;
    if payload.item_type != "commandExecution"
        || payload
            .duration_ms
            .is_some_and(|value| value > 9_007_199_254_740_991)
    {
        return Err(protocol_error());
    }
    let status = match payload.status.as_str() {
        "completed" => HostCommandStatus::Completed,
        "failed" => HostCommandStatus::Failed,
        "declined" => HostCommandStatus::Declined,
        _ => return Err(protocol_error()),
    };
    let error = payload.error.map(parse_command_error).transpose()?;
    match (status, error.as_ref().map(|value| value.code)) {
        (HostCommandStatus::Completed, None) => {}
        (HostCommandStatus::Failed, Some(HostCommandErrorCode::CommandFailed))
        | (HostCommandStatus::Failed, Some(HostCommandErrorCode::ProjectionLimitExceeded))
        | (HostCommandStatus::Failed, Some(HostCommandErrorCode::ProjectionRedactionFailed))
        | (HostCommandStatus::Failed, Some(HostCommandErrorCode::ProtocolError)) => {}
        (HostCommandStatus::Declined, Some(HostCommandErrorCode::CommandDeclined)) => {}
        _ => return Err(protocol_error()),
    }
    Ok(HostEventKind::CommandCompleted {
        status,
        command_summary: parse_safe_text(payload.command_summary, MAX_COMMAND_SUMMARY_BYTES)?,
        cwd: parse_command_cwd(payload.cwd)?,
        duration_ms: payload.duration_ms,
        exit_code: payload.exit_code,
        output: parse_command_output(payload.output)?,
        error,
    })
}

fn parse_tool_completed_v5(payload: Value) -> Result<HostEventKind, HostBridgeError> {
    let payload: ToolCompletedPayloadV5 = parse_payload(payload)?;
    if payload.item_type != "mcpToolCall"
        || payload
            .duration_ms
            .is_some_and(|value| value > 9_007_199_254_740_991)
    {
        return Err(protocol_error());
    }
    let status = match payload.status.as_str() {
        "completed" => HostToolStatus::Completed,
        "failed" => HostToolStatus::Failed,
        "declined" => HostToolStatus::Declined,
        _ => return Err(protocol_error()),
    };
    let result_summary = payload
        .result_summary
        .map(|value| parse_safe_text(value, MAX_TOOL_RESULT_BYTES))
        .transpose()?;
    let error = payload.error.map(parse_tool_error).transpose()?;
    match (
        status,
        result_summary.is_some(),
        error.as_ref().map(|value| value.code),
    ) {
        (HostToolStatus::Completed, true, None) => {}
        (HostToolStatus::Failed, _, Some(HostToolErrorCode::ToolFailed))
        | (HostToolStatus::Failed, _, Some(HostToolErrorCode::UnknownTool))
        | (HostToolStatus::Failed, _, Some(HostToolErrorCode::ProjectionLimitExceeded))
        | (HostToolStatus::Failed, _, Some(HostToolErrorCode::ProjectionRedactionFailed))
        | (HostToolStatus::Failed, _, Some(HostToolErrorCode::ProtocolError)) => {}
        (HostToolStatus::Declined, false, Some(HostToolErrorCode::ToolDeclined)) => {}
        _ => return Err(protocol_error()),
    }
    Ok(HostEventKind::ToolCompleted {
        status,
        identity: parse_tool_identity(payload.identity)?,
        arguments_summary: parse_safe_text(payload.arguments_summary, MAX_TOOL_ARGUMENTS_BYTES)?,
        duration_ms: payload.duration_ms,
        result_summary,
        error,
    })
}

fn parse_safe_text(value: WireSafeText, max_bytes: usize) -> Result<HostSafeText, HostBridgeError> {
    validate_bounded_text(&value.text, max_bytes, true)?;
    let truncation_reason = parse_truncation(value.truncated, value.truncation_reason.as_deref())?;
    Ok(HostSafeText {
        text: value.text,
        truncated: value.truncated,
        truncation_reason,
    })
}

fn parse_truncation(
    truncated: bool,
    value: Option<&str>,
) -> Result<Option<HostTruncationReason>, HostBridgeError> {
    match (truncated, value) {
        (false, None) => Ok(None),
        (true, Some("utf8_byte_limit")) => Ok(Some(HostTruncationReason::Utf8ByteLimit)),
        (true, Some("upstream_truncated")) => Ok(Some(HostTruncationReason::UpstreamTruncated)),
        _ => Err(protocol_error()),
    }
}

fn parse_command_cwd(value: WireCommandCwd) -> Result<HostCommandCwd, HostBridgeError> {
    match (value.kind.as_str(), value.segments) {
        ("workspace_root", None) => Ok(HostCommandCwd::WorkspaceRoot),
        ("redacted", None) => Ok(HostCommandCwd::Redacted),
        ("workspace_relative", Some(segments)) if (1..=128).contains(&segments.len()) => {
            let mut total = segments.len() - 1;
            for segment in &segments {
                validate_cwd_segment(segment)?;
                total = total
                    .checked_add(segment.len())
                    .ok_or_else(protocol_error)?;
            }
            if total > MAX_COMMAND_CWD_BYTES {
                return Err(protocol_error());
            }
            Ok(HostCommandCwd::WorkspaceRelative(segments))
        }
        _ => Err(protocol_error()),
    }
}

fn validate_cwd_segment(value: &str) -> Result<(), HostBridgeError> {
    if value.is_empty()
        || value.chars().count() > 255
        || value.len() > 255
        || matches!(value, "." | "..")
        || value.ends_with([' ', '.'])
        || value.contains(['/', '\\', ':'])
        || value.chars().any(|character| {
            character == '\0'
                || character.is_control()
                || matches!(
                    character,
                    '\u{061c}'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                )
        })
        || is_windows_reserved_segment(value)
    {
        return Err(protocol_error());
    }
    Ok(())
}

fn is_windows_reserved_segment(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || stem
            .strip_prefix("com")
            .or_else(|| stem.strip_prefix("lpt"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

fn parse_command_output(value: WireCommandOutput) -> Result<HostCommandOutput, HostBridgeError> {
    match (
        value.retention.as_str(),
        value.text,
        value.head,
        value.tail,
        value.reason.as_deref(),
        value.truncated,
        value.truncation_reason.as_deref(),
    ) {
        ("complete", Some(text), None, None, None, false, None) => {
            validate_bounded_text(&text, MAX_COMMAND_OUTPUT_BYTES, true)?;
            Ok(HostCommandOutput::Complete { text })
        }
        ("head_tail", None, Some(head), Some(tail), None, true, reason) => {
            validate_bounded_text(&head, MAX_COMMAND_OUTPUT_PART_BYTES, true)?;
            validate_bounded_text(&tail, MAX_COMMAND_OUTPUT_PART_BYTES, true)?;
            if head.len().saturating_add(tail.len()) > MAX_COMMAND_OUTPUT_BYTES {
                return Err(protocol_error());
            }
            let Some(reason) = parse_truncation(true, reason)? else {
                return Err(protocol_error());
            };
            Ok(HostCommandOutput::HeadTail { head, tail, reason })
        }
        ("unavailable", None, None, None, Some("not_available"), false, None) => {
            Ok(HostCommandOutput::Unavailable)
        }
        _ => Err(protocol_error()),
    }
}

fn parse_tool_identity(value: WireToolIdentity) -> Result<HostToolIdentity, HostBridgeError> {
    match value.resolution.as_str() {
        "known" => {
            validate_bounded_text(&value.server_name, 256, false)?;
            validate_bounded_text(&value.tool_name, 256, false)?;
            Ok(HostToolIdentity::Known {
                server_name: value.server_name,
                tool_name: value.tool_name,
            })
        }
        "unknown" if value.server_name == "unknown" && value.tool_name == "unknown" => {
            Ok(HostToolIdentity::Unknown)
        }
        _ => Err(protocol_error()),
    }
}

fn parse_command_error(
    value: WireProjectionError,
) -> Result<HostProjectionError<HostCommandErrorCode>, HostBridgeError> {
    validate_bounded_text(&value.summary, MAX_EXECUTION_ERROR_BYTES, true)?;
    let code = match value.code.as_str() {
        "command_failed" => HostCommandErrorCode::CommandFailed,
        "command_declined" => HostCommandErrorCode::CommandDeclined,
        "projection_limit_exceeded" => HostCommandErrorCode::ProjectionLimitExceeded,
        "projection_redaction_failed" => HostCommandErrorCode::ProjectionRedactionFailed,
        "protocol_error" => HostCommandErrorCode::ProtocolError,
        _ => return Err(protocol_error()),
    };
    Ok(HostProjectionError {
        code,
        summary: value.summary,
    })
}

fn parse_tool_error(
    value: WireProjectionError,
) -> Result<HostProjectionError<HostToolErrorCode>, HostBridgeError> {
    validate_bounded_text(&value.summary, MAX_EXECUTION_ERROR_BYTES, true)?;
    let code = match value.code.as_str() {
        "tool_failed" => HostToolErrorCode::ToolFailed,
        "tool_declined" => HostToolErrorCode::ToolDeclined,
        "unknown_tool" => HostToolErrorCode::UnknownTool,
        "projection_limit_exceeded" => HostToolErrorCode::ProjectionLimitExceeded,
        "projection_redaction_failed" => HostToolErrorCode::ProjectionRedactionFailed,
        "protocol_error" => HostToolErrorCode::ProtocolError,
        _ => return Err(protocol_error()),
    };
    Ok(HostProjectionError {
        code,
        summary: value.summary,
    })
}

fn validate_bounded_text(
    value: &str,
    max_bytes: usize,
    allow_empty: bool,
) -> Result<(), HostBridgeError> {
    if (!allow_empty && value.is_empty())
        || value.len() > max_bytes
        || value.chars().count() > max_bytes
        || value.contains('\0')
    {
        return Err(protocol_error());
    }
    Ok(())
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

fn validate_optional_text_allow_empty(
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), HostBridgeError> {
    if let Some(value) = value {
        validate_text(value, max_bytes, true)?;
    }
    Ok(())
}

fn validate_text_chars_bytes(
    value: &str,
    max_chars: usize,
    max_bytes: usize,
    allow_empty: bool,
) -> Result<(), HostBridgeError> {
    if value.chars().count() > max_chars {
        return Err(protocol_error());
    }
    validate_text(value, max_bytes, allow_empty)
}

fn validate_optional_text_chars_bytes(
    value: Option<&str>,
    max_chars: usize,
    max_bytes: usize,
) -> Result<(), HostBridgeError> {
    if let Some(value) = value {
        validate_text_chars_bytes(value, max_chars, max_bytes, true)?;
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
        "invalid_approval_request" => HostErrorCode::InvalidApprovalRequest,
        "approval_version_mismatch" => HostErrorCode::ApprovalVersionMismatch,
        "approval_not_found" => HostErrorCode::ApprovalNotFound,
        "approval_stale" => HostErrorCode::ApprovalStale,
        "approval_expired" => HostErrorCode::ApprovalExpired,
        "approval_already_resolved" => HostErrorCode::ApprovalAlreadyResolved,
        "approval_decision_conflict" => HostErrorCode::ApprovalDecisionConflict,
        "approval_unavailable" => HostErrorCode::ApprovalUnavailable,
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
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../yijie-contracts/tests/fixtures/agent/session-event-v2")
            .join(name);
        fs::read_to_string(path).expect("read canonical contracts fixture")
    }

    fn feat136_fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("contracts/fixtures/session-event-v5")
            .join(name);
        serde_json::from_str(&fs::read_to_string(path).expect("read vendored v5 fixture"))
            .expect("parse vendored v5 fixture")
    }

    fn feat136_decode(value: &Value) -> Result<HostStreamEvent, HostBridgeError> {
        decode_for_schema(value, 5)
    }

    fn feat137_fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../yijie-contracts/tests/fixtures/agent/session-event-v6")
            .join(name);
        serde_json::from_str(&fs::read_to_string(path).expect("read frozen v6 fixture"))
            .expect("parse frozen v6 fixture")
    }

    fn feat137_decode(value: &Value) -> Result<HostStreamEvent, HostBridgeError> {
        decode_for_schema(value, 6)
    }

    fn decode_for_schema(
        value: &Value,
        schema_version: u8,
    ) -> Result<HostStreamEvent, HostBridgeError> {
        let stream = Uuid::parse_str(value["stream_id"].as_str().expect("fixture stream"))
            .expect("fixture stream UUID");
        let sequence = value["sequence"].as_u64().expect("fixture sequence");
        let event_type = value["event_type"].as_str().expect("fixture event type");
        let data = serde_json::to_string(value).expect("encode fixture");
        let frame = format!("id: {stream}:{sequence}\nevent: {event_type}\ndata: {data}\n\n");
        let mut decoder = SseDecoder::new(stream, sequence.saturating_sub(1), schema_version);
        decoder.push(frame.as_bytes())?;
        decoder.next().ok_or_else(protocol_error)
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

    #[test]
    fn feat136_v5_contract_fixtures_decode_to_closed_command_tool_variants() {
        for name in [
            "command-completed.json",
            "command-declined.json",
            "command-failed-head-tail.json",
            "command-output-delta.json",
            "command-started.json",
            "tool-completed-known.json",
            "tool-declined-reserved-fixture-only.json",
            "tool-failed-result.json",
            "tool-progress.json",
            "tool-started-known.json",
            "tool-unknown-failed.json",
        ] {
            assert!(
                matches!(
                    feat136_decode(&feat136_fixture(name)),
                    Ok(HostStreamEvent::Ordinary(_))
                ),
                "v5 fixture did not decode: {name}"
            );
        }
        let HostStreamEvent::Ordinary(unknown_tool) =
            feat136_decode(&feat136_fixture("tool-unknown-failed.json")).unwrap()
        else {
            panic!("ordinary unknown-tool fixture expected");
        };
        assert!(matches!(
            unknown_tool.kind,
            HostEventKind::ToolCompleted {
                identity: HostToolIdentity::Unknown,
                status: HostToolStatus::Failed,
                ..
            }
        ));
    }

    #[test]
    fn feat137_v6_contract_fixtures_decode_to_closed_approval_variants() {
        for name in [
            "approval-requested.json",
            "approval-resolved-accepted.json",
            "approval-resolved-cancelled.json",
            "approval-resolved-elsewhere.json",
            "approval-resolved-expired.json",
        ] {
            assert!(
                matches!(
                    feat137_decode(&feat137_fixture(name)),
                    Ok(HostStreamEvent::Ordinary(_))
                ),
                "v6 fixture did not decode: {name}"
            );
        }
        let HostStreamEvent::Ordinary(requested) =
            feat137_decode(&feat137_fixture("approval-requested.json")).unwrap()
        else {
            panic!("ordinary approval request expected");
        };
        assert_eq!(requested.item_id.as_deref(), Some("cmd-feat-137-1"));
        let HostEventKind::ApprovalRequested(approval) = requested.kind else {
            panic!("typed approval request expected");
        };
        assert_eq!(
            approval.approval_request_id,
            Uuid::parse_str("66666666-6666-4666-8666-666666666666").unwrap()
        );
        assert_eq!(approval.requested_at, "2026-08-30T12:00:00Z");
        assert_eq!(approval.expires_at, "2026-08-30T12:02:00Z");

        let HostStreamEvent::Ordinary(accepted) =
            feat137_decode(&feat137_fixture("approval-resolved-accepted.json")).unwrap()
        else {
            panic!("ordinary approval resolution expected");
        };
        assert!(matches!(
            accepted.kind,
            HostEventKind::ApprovalResolved(HostApprovalResolved {
                outcome: HostApprovalOutcome::AcceptedOnce,
                decision: Some(HostApprovalDecision::AcceptOnce),
                ..
            })
        ));
    }

    #[test]
    fn feat137_v6_approval_decoder_rejects_unknown_fields_and_accepts_inherited_v5() {
        let base = feat137_fixture("approval-requested.json");
        for invalid in [
            {
                let mut value = base.clone();
                value["raw_command"] = serde_json::json!("PRIVATE_COMMAND_CANARY");
                value
            },
            {
                let mut value = base.clone();
                value["payload"]["reason"] = serde_json::json!("PRIVATE_REASON_CANARY");
                value
            },
            {
                let mut value = base.clone();
                value["event_type"] = serde_json::json!("approval.future_required");
                value
            },
            {
                let mut value = base.clone();
                value["payload"]["expires_at"] = serde_json::json!("2026-08-30T12:01:59Z");
                value
            },
        ] {
            assert!(feat137_decode(&invalid).is_err());
        }

        let mut inherited_command = feat136_fixture("command-started.json");
        inherited_command["schema_version"] = serde_json::json!(6);
        assert!(matches!(
            feat137_decode(&inherited_command),
            Ok(HostStreamEvent::Ordinary(HostEvent {
                kind: HostEventKind::CommandStarted { .. },
                ..
            }))
        ));
    }

    #[test]
    fn feat136_v5_failed_command_fixture_preserves_nonzero_terminal_fields() {
        let HostStreamEvent::Ordinary(event) =
            feat136_decode(&feat136_fixture("command-failed-head-tail.json")).unwrap()
        else {
            panic!("ordinary failed Command fixture expected");
        };
        assert_eq!(event.item_id.as_deref(), Some("command-failed-1"));
        let HostEventKind::CommandCompleted {
            status,
            command_summary,
            cwd,
            duration_ms,
            exit_code,
            output,
            error,
        } = event.kind
        else {
            panic!("failed Command completion expected");
        };
        assert_eq!(status, HostCommandStatus::Failed);
        assert_eq!(command_summary.text, "Run local JavaScript validation");
        assert_eq!(
            cwd,
            HostCommandCwd::WorkspaceRelative(vec!["examples".to_owned()])
        );
        assert_eq!(duration_ms, Some(14));
        assert_eq!(exit_code, Some(9));
        assert_eq!(
            output,
            HostCommandOutput::HeadTail {
                head: "unknown option\n".to_owned(),
                tail: "usage information omitted\n".to_owned(),
                reason: HostTruncationReason::Utf8ByteLimit,
            }
        );
        assert_eq!(
            error,
            Some(HostProjectionError {
                code: HostCommandErrorCode::CommandFailed,
                summary: "command exited with a non-zero status".to_owned(),
            })
        );
    }

    #[test]
    fn feat136_contract_pin_schema_and_ordinary_fixture_set_are_exact() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("contracts");
        let lock: Value = serde_json::from_str(
            &fs::read_to_string(root.join("feat136.lock.json")).expect("read v5 contract lock"),
        )
        .expect("parse v5 contract lock");
        assert_eq!(
            lock,
            serde_json::json!({
                "contractCommit": "87f94c9aa6d4848cb67aa8a1265bd21474edb0bb",
                "contractVersion": "v0.7.0",
                "schemaVersion": 5,
                "schemaSha256": "2f773dd6dc60bc7dc01bcdb434447e945e0a98317534498f54325fcdabb27008",
                "ordinaryFixtureCount": 11,
                "ordinaryFixtureTreeObjectId": "b69a2d9d1f7a8b175c818282ae0c6c9c5ace1bec",
                "ordinaryFixtureSnapshotSha256": "9ffb4ae88c8a585d6de33b6f93342f0f95f83f9cec9852a212e0b8b47d13804d"
            })
        );

        let schema_bytes = fs::read(root.join("agent/session-event-v5.schema.json"))
            .expect("read vendored v5 schema");
        assert_eq!(
            format!("{:x}", Sha256::digest(&schema_bytes)),
            lock["schemaSha256"].as_str().unwrap()
        );
        let schema: Value =
            serde_json::from_slice(&schema_bytes).expect("parse vendored v5 schema");
        assert_eq!(schema["properties"]["schema_version"]["const"], 5);
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["oneOf"].as_array().map(Vec::len), Some(17));

        let fixture_root = root.join("fixtures/session-event-v5");
        let mut names = fs::read_dir(&fixture_root)
            .expect("read ordinary fixture directory")
            .map(|entry| {
                entry
                    .expect("read ordinary fixture entry")
                    .file_name()
                    .into_string()
                    .expect("fixture name is UTF-8")
            })
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            [
                "command-completed.json",
                "command-declined.json",
                "command-failed-head-tail.json",
                "command-output-delta.json",
                "command-started.json",
                "tool-completed-known.json",
                "tool-declined-reserved-fixture-only.json",
                "tool-failed-result.json",
                "tool-progress.json",
                "tool-started-known.json",
                "tool-unknown-failed.json",
            ]
        );
        let mut snapshot = Sha256::new();
        for name in &names {
            let fixture_digest = format!(
                "{:x}",
                Sha256::digest(fs::read(fixture_root.join(name)).expect("read ordinary fixture"))
            );
            snapshot.update(name.as_bytes());
            snapshot.update([0]);
            snapshot.update(fixture_digest.as_bytes());
            snapshot.update(b"\n");
        }
        assert_eq!(
            format!("{:x}", snapshot.finalize()),
            lock["ordinaryFixtureSnapshotSha256"].as_str().unwrap()
        );
    }

    #[test]
    fn feat136_v5_unknown_event_and_explicit_nulls_fail_closed() {
        let base = feat136_fixture("command-completed.json");
        let mut unknown = base.clone();
        unknown["event_type"] = serde_json::json!("future.required.variant");
        assert!(feat136_decode(&unknown).is_err());

        for key in [
            "trace_id",
            "request_id",
            "tenant_id",
            "user_id",
            "turn_id",
            "item_id",
        ] {
            let mut invalid = base.clone();
            invalid[key] = Value::Null;
            assert!(feat136_decode(&invalid).is_err());
        }

        let mut null_duration = feat136_fixture("command-completed.json");
        null_duration["payload"]["duration_ms"] = Value::Null;
        assert!(feat136_decode(&null_duration).is_err());

        let mut null_reason = feat136_fixture("command-started.json");
        null_reason["payload"]["command_summary"]["truncation_reason"] = Value::Null;
        assert!(feat136_decode(&null_reason).is_err());
    }

    #[test]
    fn feat136_v5_allows_only_contract_nullable_phase_and_explanation() {
        let mut agent = feat136_fixture("command-started.json");
        agent["payload"] = serde_json::json!({
            "item_type": "agentMessage",
            "text": "",
            "phase": null
        });
        assert!(feat136_decode(&agent).is_ok());

        let mut plan = agent;
        plan["event_type"] = serde_json::json!("turn.plan.updated");
        plan["item_id"] = serde_json::json!(null);
        plan.as_object_mut().unwrap().remove("item_id");
        plan["payload"] = serde_json::json!({"explanation": null, "plan": []});
        assert!(feat136_decode(&plan).is_ok());
    }

    #[test]
    fn feat136_command_cwd_limit_counts_path_separators() {
        let segments = vec![
            "a".repeat(255),
            "b".repeat(255),
            "c".repeat(255),
            "d".repeat(255),
            "tail".to_owned(),
        ];
        assert_eq!(segments.iter().map(String::len).sum::<usize>(), 1024);
        assert!(parse_command_cwd(WireCommandCwd {
            kind: "workspace_relative".to_owned(),
            segments: Some(segments),
        })
        .is_err());
    }

    #[test]
    fn feat136_v5_inherited_text_limits_count_chars_and_utf8_bytes() {
        let mut common = feat136_fixture("command-started.json");
        common["trace_id"] = serde_json::json!("界".repeat(256));
        common["request_id"] = serde_json::json!("请".repeat(256));
        common["tenant_id"] = serde_json::json!("租".repeat(256));
        common["user_id"] = serde_json::json!("户".repeat(256));
        common["item_id"] = serde_json::json!("项".repeat(256));
        assert!(feat136_decode(&common).is_ok());
        common["item_id"] = serde_json::json!("项".repeat(257));
        assert!(feat136_decode(&common).is_err());

        let mut thread = feat136_fixture("command-started.json");
        thread.as_object_mut().unwrap().remove("turn_id");
        thread.as_object_mut().unwrap().remove("item_id");
        thread["event_type"] = serde_json::json!("thread.started");
        thread["payload"] = serde_json::json!({
            "model": "模".repeat(256),
            "model_provider": "供".repeat(256)
        });
        assert!(feat136_decode(&thread).is_ok());
        thread["payload"]["model"] = serde_json::json!("m".repeat(257));
        assert!(feat136_decode(&thread).is_err());

        let mut plan = feat136_fixture("command-started.json");
        plan.as_object_mut().unwrap().remove("item_id");
        plan["event_type"] = serde_json::json!("turn.plan.updated");
        plan["payload"] = serde_json::json!({
            "explanation": "e".repeat(16_384),
            "plan": [{"step": "s".repeat(16_384), "status": "pending"}]
        });
        assert!(feat136_decode(&plan).is_ok());
        plan["payload"]["plan"][0]["step"] = serde_json::json!("s".repeat(16_385));
        assert!(feat136_decode(&plan).is_err());

        let mut warning = feat136_fixture("command-started.json");
        warning.as_object_mut().unwrap().remove("turn_id");
        warning.as_object_mut().unwrap().remove("item_id");
        warning["event_type"] = serde_json::json!("warning");
        warning["payload"] = serde_json::json!({
            "code": "警".repeat(256),
            "message": "w".repeat(16_384),
            "will_retry": false
        });
        assert!(feat136_decode(&warning).is_ok());
        warning["payload"]["code"] = serde_json::json!("警".repeat(257));
        assert!(feat136_decode(&warning).is_err());
        warning["payload"]["code"] = serde_json::json!("警".repeat(256));
        warning["payload"]["message"] = serde_json::json!("w".repeat(16_385));
        assert!(feat136_decode(&warning).is_err());
    }

    #[test]
    fn feat136_v5_unbounded_problem_text_uses_event_cap_while_v4_stays_bounded() {
        let mut completed = feat136_fixture("command-started.json");
        completed.as_object_mut().unwrap().remove("item_id");
        completed["event_type"] = serde_json::json!("turn.completed");
        completed["terminal"] = serde_json::json!(true);
        completed["payload"] = serde_json::json!({
            "status": "failed",
            "code": "c".repeat(9 * 1024),
            "message": "m".repeat(9 * 1024)
        });
        assert!(feat136_decode(&completed).is_ok());

        let mut completed_v4 = completed;
        completed_v4["schema_version"] = serde_json::json!(4);
        assert!(decode_for_schema(&completed_v4, 4).is_err());

        let mut problem = feat136_fixture("command-started.json");
        problem.as_object_mut().unwrap().remove("item_id");
        problem["event_type"] = serde_json::json!("error");
        problem["payload"] = serde_json::json!({
            "code": "",
            "message": "e".repeat(9 * 1024),
            "will_retry": false
        });
        assert!(feat136_decode(&problem).is_ok());

        let mut problem_v4 = problem;
        problem_v4["schema_version"] = serde_json::json!(4);
        assert!(decode_for_schema(&problem_v4, 4).is_err());
    }

    #[test]
    fn feat136_v5_accepts_contract_optional_empty_plan_and_warning_text() {
        let mut plan = feat136_fixture("command-started.json");
        plan.as_object_mut().unwrap().remove("item_id");
        plan["event_type"] = serde_json::json!("turn.plan.updated");
        plan["payload"] = serde_json::json!({"explanation": "", "plan": []});
        assert!(feat136_decode(&plan).is_ok());

        let mut warning = feat136_fixture("command-started.json");
        warning.as_object_mut().unwrap().remove("turn_id");
        warning.as_object_mut().unwrap().remove("item_id");
        warning["event_type"] = serde_json::json!("warning");
        warning["payload"] = serde_json::json!({"code": "", "message": "", "will_retry": false});
        assert!(feat136_decode(&warning).is_ok());
    }
}
