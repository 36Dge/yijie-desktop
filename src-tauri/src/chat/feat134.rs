use super::database::StoredEventCursor;
use super::error::ChatError;
use super::feat136::{ExecutionProjection, SafeTextProjection, ToolProgressProjection};
use super::host_domain::HostAgentMessagePhase;
use std::fmt::{Debug, Formatter};
use uuid::Uuid;

pub const FEAT134_FLAG: &str = "YIJIE_FEAT134_STREAMING_ENABLED";

pub fn exact_local_enabled(
    flag: Option<&str>,
    environment: Option<&str>,
    profile: Option<&str>,
) -> Result<bool, ChatError> {
    match flag {
        None | Some("") | Some("false") => Ok(false),
        Some("true") if environment == Some("local") && profile == Some("demo_fast") => Ok(true),
        Some("true") => Err(ChatError::InvalidConfiguration),
        Some(_) => Err(ChatError::InvalidConfiguration),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelinePhase {
    Commentary,
    FinalAnswer,
}

impl TimelinePhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Commentary => "commentary",
            Self::FinalAnswer => "final_answer",
        }
    }
}

impl From<HostAgentMessagePhase> for TimelinePhase {
    fn from(value: HostAgentMessagePhase) -> Self {
        match value {
            HostAgentMessagePhase::Commentary => Self::Commentary,
            HostAgentMessagePhase::FinalAnswer => Self::FinalAnswer,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineItemStatus {
    InProgress,
    Completed,
    Incomplete,
}

impl TimelineItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Incomplete => "incomplete",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineReasoningStatus {
    Complete,
    Incomplete,
    Unavailable,
}

impl TimelineReasoningStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Incomplete => "incomplete",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct TimelineReasoningPart {
    pub content_index: usize,
    pub text: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct TimelineItem {
    pub item_id: String,
    pub item_ordinal: usize,
    pub item_type: String,
    pub phase: Option<TimelinePhase>,
    pub status: TimelineItemStatus,
    pub text: String,
    pub reasoning_status: Option<TimelineReasoningStatus>,
    pub reasoning_reason_code: Option<String>,
    pub reasoning_parts: Vec<TimelineReasoningPart>,
    /// Native-only durable fact. WebView v4 deliberately exposes lifecycle completion and
    /// reasoning finalization as separate events, so this is not serialized as completedAtMs.
    pub reasoning_finalized_at_ms: Option<i64>,
    pub execution: Option<ExecutionProjection>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub source_event_id: Uuid,
    pub source_sequence: u64,
    pub source_occurred_at: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct TimelinePlanStep {
    pub ordinal: usize,
    pub step: String,
    pub status: &'static str,
}

#[derive(Clone, PartialEq, Eq)]
pub struct TimelinePlan {
    pub source_event_id: Uuid,
    pub source_sequence: u64,
    pub source_occurred_at: String,
    pub explanation: Option<String>,
    pub steps: Vec<TimelinePlanStep>,
    pub observed_at_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineNoticeScope {
    Session,
    Turn,
}

impl TimelineNoticeScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Turn => "turn",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineNoticeSeverity {
    Warning,
    Error,
}

impl TimelineNoticeSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineNotice {
    pub source_event_id: Uuid,
    pub source_sequence: u64,
    pub source_occurred_at: String,
    pub scope: TimelineNoticeScope,
    pub severity: TimelineNoticeSeverity,
    pub code: Option<String>,
    pub will_retry: bool,
    pub observed_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimelineTerminal {
    pub source_event_id: Uuid,
    pub source_sequence: u64,
    pub source_occurred_at: String,
    pub status: &'static str,
    pub code: Option<String>,
    pub unfinished_reasoning_reason_code: Option<String>,
    pub observed_at_ms: i64,
}

#[derive(Clone, PartialEq, Eq)]
pub enum TimelineDelta {
    TurnStarted(SourceIdentity),
    PlanUpdated(TimelinePlan),
    ItemStarted(TimelineItem),
    AgentMessageAppend {
        source: SourceIdentity,
        item_id: String,
        item_ordinal: usize,
        phase: Option<TimelinePhase>,
        text: String,
    },
    ReasoningAppend {
        source: SourceIdentity,
        item_id: String,
        item_ordinal: usize,
        content_index: usize,
        text: String,
    },
    ReasoningFinalized {
        source: SourceIdentity,
        item_id: String,
        item_ordinal: usize,
        status: TimelineReasoningStatus,
        reason_code: Option<String>,
        parts: Vec<TimelineReasoningPart>,
    },
    ItemCompleted(TimelineItem),
    CommandStarted(TimelineItem),
    CommandOutputAppend {
        source: SourceIdentity,
        item_id: String,
        item_ordinal: usize,
        delta: SafeTextProjection,
    },
    CommandCompleted(TimelineItem),
    ToolStarted(TimelineItem),
    ToolProgress {
        item_id: String,
        item_ordinal: usize,
        progress: ToolProgressProjection,
    },
    ToolCompleted(TimelineItem),
    Notice(TimelineNotice),
    TurnTerminal(TimelineTerminal),
    Ignored,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceIdentity {
    pub event_id: Uuid,
    pub sequence: u64,
    pub occurred_at: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Feat134Projection {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub cursor: StoredEventCursor,
    pub source_event_type: String,
    pub source_turn_id: Option<Uuid>,
    pub source_occurred_at: String,
    pub source_event_bytes: usize,
    pub observed_at_ms: i64,
    /// Assigned by SQLCipher in the same transaction that records this projection.
    /// It is absent while reducing Host input and required before private IPC publish.
    pub durable_sequence: Option<u64>,
    pub assistant_text: String,
    pub items: Vec<TimelineItem>,
    pub plan: Option<TimelinePlan>,
    pub turn_notices: Vec<TimelineNotice>,
    pub session_notice: Option<TimelineNotice>,
    pub terminal: Option<TimelineTerminal>,
    pub delta: TimelineDelta,
}

/// Content-free provenance for a Host event that crossed a Desktop projection boundary.
/// The offending payload is deliberately absent so SQLCipher can consume the cursor without ever
/// storing or republishing text that the Desktop cannot durably represent.
impl Debug for TimelineReasoningPart {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TimelineReasoningPart")
            .field("content_index", &self.content_index)
            .field("utf8_bytes", &self.text.len())
            .finish()
    }
}

impl Debug for TimelineItem {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TimelineItem")
            .field("item_id", &self.item_id)
            .field("item_ordinal", &self.item_ordinal)
            .field("item_type", &self.item_type)
            .field("phase", &self.phase)
            .field("status", &self.status)
            .field("text_utf8_bytes", &self.text.len())
            .field("reasoning_status", &self.reasoning_status)
            .field("reasoning_reason_code", &self.reasoning_reason_code)
            .field("reasoning_part_count", &self.reasoning_parts.len())
            .field(
                "reasoning_utf8_bytes",
                &self
                    .reasoning_parts
                    .iter()
                    .map(|part| part.text.len())
                    .sum::<usize>(),
            )
            .field("source_event_id", &self.source_event_id)
            .field("source_sequence", &self.source_sequence)
            .finish()
    }
}

impl Debug for TimelinePlanStep {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TimelinePlanStep")
            .field("ordinal", &self.ordinal)
            .field("status", &self.status)
            .field("step_utf8_bytes", &self.step.len())
            .finish()
    }
}

impl Debug for TimelinePlan {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TimelinePlan")
            .field("source_event_id", &self.source_event_id)
            .field("source_sequence", &self.source_sequence)
            .field(
                "explanation_utf8_bytes",
                &self.explanation.as_ref().map_or(0, String::len),
            )
            .field("step_count", &self.steps.len())
            .field(
                "step_utf8_bytes",
                &self.steps.iter().map(|step| step.step.len()).sum::<usize>(),
            )
            .finish()
    }
}

impl Debug for TimelineDelta {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let kind = match self {
            Self::TurnStarted(_) => "turn_started",
            Self::PlanUpdated(_) => "plan_updated",
            Self::ItemStarted(_) => "item_started",
            Self::AgentMessageAppend { .. } => "agent_message_append",
            Self::ReasoningAppend { .. } => "reasoning_append",
            Self::ReasoningFinalized { .. } => "reasoning_finalized",
            Self::ItemCompleted(_) => "item_completed",
            Self::CommandStarted(_) => "command_started",
            Self::CommandOutputAppend { .. } => "command_output_append",
            Self::CommandCompleted(_) => "command_completed",
            Self::ToolStarted(_) => "tool_started",
            Self::ToolProgress { .. } => "tool_progress",
            Self::ToolCompleted(_) => "tool_completed",
            Self::Notice(_) => "notice",
            Self::TurnTerminal(_) => "turn_terminal",
            Self::Ignored => "ignored",
        };
        formatter
            .debug_struct("TimelineDelta")
            .field("kind", &kind)
            .finish()
    }
}

impl Debug for Feat134Projection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Feat134Projection")
            .field("session_id", &self.session_id)
            .field("turn_id", &self.turn_id)
            .field("source_event_type", &self.source_event_type)
            .field("source_event_bytes", &self.source_event_bytes)
            .field("durable_sequence", &self.durable_sequence)
            .field("assistant_utf8_bytes", &self.assistant_text.len())
            .field("item_count", &self.items.len())
            .field("has_plan", &self.plan.is_some())
            .field("turn_notice_count", &self.turn_notices.len())
            .field("has_session_notice", &self.session_notice.is_some())
            .field("has_terminal", &self.terminal.is_some())
            .field("delta", &self.delta)
            .finish()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Feat134Hydration {
    pub items: Vec<TimelineItem>,
    pub plan: Option<TimelinePlan>,
    pub turn_notices: Vec<TimelineNotice>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Feat134HistoryTurn {
    pub turn_id: Uuid,
    pub v4_authority: bool,
    pub source_schema_version: Option<u8>,
    pub terminal_code: Option<String>,
    pub items: Vec<TimelineItem>,
    pub plan: Option<TimelinePlan>,
    pub notices: Vec<TimelineNotice>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Feat134HistoryProjection {
    pub turns: Vec<Feat134HistoryTurn>,
    pub session_notices: Vec<TimelineNotice>,
    pub durable_sequence_cut: u64,
}
