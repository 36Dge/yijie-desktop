use super::database::{
    ActiveTurnContext, ReasoningItem, ReasoningPart, ReasoningStatus, StoredEventCursor,
    TurnProgress,
};
use super::error::ChatError;
use super::host_domain::{
    HostAgentMessagePhase, HostArtifactEventV3, HostEvent, HostEventCursor, HostEventKind,
    HostPlanStep, HostPlanStepStatus, HostReasoningPart, HostReasoningReason, HostReasoningStatus,
    HostTurnStatus,
};
use std::fmt::{Debug, Formatter};
use uuid::Uuid;

pub const FEAT134_FLAG: &str = "YIJIE_FEAT134_STREAMING_ENABLED";
pub const PROJECTION_LIMIT_EXCEEDED_CODE: &str = "projection_limit_exceeded";
pub const PROJECTION_CONFLICT_CODE: &str = "projection_conflict";
const MAX_TIMELINE_ITEMS: usize = 512;
const MAX_TURN_NOTICES: usize = 512;
const MAX_ITEM_TEXT_BYTES: usize = 1024 * 1024;
const MAX_REASONING_ITEMS: usize = 8;
const MAX_REASONING_PARTS: usize = 8;
const MAX_REASONING_PART_BYTES: usize = 64 * 1024;
const MAX_REASONING_ITEM_BYTES: usize = 128 * 1024;
const MAX_REASONING_TURN_BYTES: usize = 256 * 1024;

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

    fn legacy(self) -> ReasoningStatus {
        match self {
            Self::Complete => ReasoningStatus::Complete,
            Self::Incomplete => ReasoningStatus::Incomplete,
            Self::Unavailable => ReasoningStatus::Unavailable,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feat134ProjectionFailureKind {
    LimitExceeded,
    ProtocolConflict,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Feat134ProjectionFailure {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub cursor: StoredEventCursor,
    pub source_event_type: String,
    pub source_turn_id: Option<Uuid>,
    pub source_occurred_at: String,
    pub source_event_bytes: usize,
    pub observed_at_ms: i64,
    pub kind: Feat134ProjectionFailureKind,
}

impl Feat134ProjectionFailure {
    pub fn from_projection(projection: &Feat134Projection) -> Self {
        Self {
            session_id: projection.session_id,
            turn_id: projection.turn_id,
            cursor: projection.cursor.clone(),
            source_event_type: projection.source_event_type.clone(),
            source_turn_id: projection.source_turn_id,
            source_occurred_at: projection.source_occurred_at.clone(),
            source_event_bytes: projection.source_event_bytes,
            observed_at_ms: projection.observed_at_ms,
            kind: Feat134ProjectionFailureKind::LimitExceeded,
        }
    }
}

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

impl Feat134Projection {
    pub fn legacy_reasoning(&self) -> Vec<ReasoningItem> {
        self.items
            .iter()
            .filter_map(|item| {
                Some(ReasoningItem {
                    item_id: item.item_id.clone(),
                    item_ordinal: 0,
                    status: item.reasoning_status?.legacy(),
                    reason_code: item.reasoning_reason_code.clone(),
                    finalized_at_ms: item.reasoning_finalized_at_ms?,
                    parts: item
                        .reasoning_parts
                        .iter()
                        .map(|part| ReasoningPart {
                            content_index: part.content_index,
                            text: part.text.clone(),
                        })
                        .collect(),
                })
            })
            .enumerate()
            .map(|(ordinal, mut item)| {
                item.item_ordinal = ordinal;
                item
            })
            .collect()
    }
}

pub struct Feat134TurnReducer {
    context: ActiveTurnContext,
    expected_stream: Option<Uuid>,
    last_sequence: u64,
    last_event_id: Option<Uuid>,
    items: Vec<TimelineItem>,
    plan: Option<TimelinePlan>,
    turn_notices: Vec<TimelineNotice>,
    terminal: Option<TimelineTerminal>,
}

impl Debug for Feat134TurnReducer {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Feat134TurnReducer")
            .field("session_id", &self.context.session_id)
            .field("turn_id", &self.context.turn_id)
            .field("last_sequence", &self.last_sequence)
            .field("item_count", &self.items.len())
            .field("turn_notice_count", &self.turn_notices.len())
            .field("terminal", &self.terminal.is_some())
            .finish()
    }
}

impl Feat134TurnReducer {
    pub fn new(
        context: ActiveTurnContext,
        hydration: Option<Feat134Hydration>,
    ) -> Result<Self, ChatError> {
        let (expected_stream, last_sequence, last_event_id) = match &context.cursor {
            Some(cursor) => (
                Some(cursor.stream_id),
                cursor.sequence,
                Some(cursor.event_id),
            ),
            None => (None, 0, None),
        };
        let hydration = hydration.unwrap_or_default();
        validate_hydration(&hydration)?;
        if final_answer_text(&hydration.items)? != context.assistant_text {
            return Err(ChatError::DatabaseUnavailable);
        }
        Ok(Self {
            context,
            expected_stream,
            last_sequence,
            last_event_id,
            items: hydration.items,
            plan: hydration.plan,
            turn_notices: hydration.turn_notices,
            terminal: None,
        })
    }

    pub fn apply(
        &mut self,
        event: HostEvent,
        observed_at_ms: i64,
    ) -> Result<Option<Feat134Projection>, ChatError> {
        if observed_at_ms < 0 || self.terminal.is_some() {
            return Err(ChatError::ConversationConflict);
        }
        if event.task_id != self.context.task_id
            || event.agent_session_id != self.context.agent_session_id
            || event.codex_thread_id != self.context.codex_thread_id
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if event.cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event.event_id)
            && self.expected_stream == Some(event.cursor.stream_id)
        {
            return Ok(None);
        }
        if event.cursor.sequence
            != self
                .last_sequence
                .checked_add(1)
                .ok_or(ChatError::OrchestrationUnavailable)?
            || self
                .expected_stream
                .is_some_and(|stream| stream != event.cursor.stream_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let turn_scoped = !matches!(
            event.kind,
            HostEventKind::ThreadStarted { .. } | HostEventKind::Warning { .. }
        );
        if turn_scoped && event.turn_id != Some(self.context.runtime_turn_id) {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if !turn_scoped && event.turn_id.is_some() {
            return Err(ChatError::OrchestrationUnavailable);
        }

        let source = SourceIdentity {
            event_id: event.event_id,
            sequence: event.cursor.sequence,
            occurred_at: event.occurred_at.clone(),
        };
        let mut session_notice = None;
        let delta = match event.kind {
            HostEventKind::ThreadStarted { .. } => TimelineDelta::Ignored,
            HostEventKind::Unknown => TimelineDelta::Ignored,
            HostEventKind::TurnStarted => TimelineDelta::TurnStarted(source.clone()),
            HostEventKind::TurnPlanUpdated { explanation, steps } => {
                let plan = TimelinePlan {
                    source_event_id: source.event_id,
                    source_sequence: source.sequence,
                    source_occurred_at: source.occurred_at.clone(),
                    explanation,
                    steps: map_plan_steps(steps),
                    observed_at_ms,
                };
                self.plan = (!plan.steps.is_empty()).then(|| plan.clone());
                TimelineDelta::PlanUpdated(plan)
            }
            HostEventKind::ItemStarted {
                item_type,
                text,
                phase,
            } => {
                if excluded_lifecycle_item(&item_type) {
                    TimelineDelta::Ignored
                } else {
                    let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                    let text = (item_type == "agentMessage").then_some(text).flatten();
                    let (ordinal, suppress_live_delta) = self.upsert_lifecycle_item(
                        item_id,
                        item_type,
                        phase.map(Into::into),
                        text,
                        false,
                        &source,
                        observed_at_ms,
                    )?;
                    if suppress_live_delta {
                        TimelineDelta::Ignored
                    } else {
                        TimelineDelta::ItemStarted(self.items[ordinal].clone())
                    }
                }
            }
            HostEventKind::AgentMessageDelta { delta } => {
                let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                let item = self
                    .items
                    .iter_mut()
                    .find(|item| item.item_id == item_id && item.item_type == "agentMessage")
                    .ok_or(ChatError::OrchestrationUnavailable)?;
                if item.status != TimelineItemStatus::InProgress || delta.contains('\0') {
                    return Err(ChatError::OrchestrationUnavailable);
                }
                // Contracts v4 permits an empty delta. It remains an observed durable Host fact,
                // but carries no semantic change and must not cross the private IPC boundary whose
                // append payload intentionally requires non-empty text.
                if delta.is_empty() {
                    TimelineDelta::Ignored
                } else {
                    let next = item
                        .text
                        .len()
                        .checked_add(delta.len())
                        .ok_or(ChatError::ProjectionLimitExceeded)?;
                    if next > MAX_ITEM_TEXT_BYTES {
                        return Err(ChatError::ProjectionLimitExceeded);
                    }
                    item.text.push_str(&delta);
                    item.source_event_id = source.event_id;
                    item.source_sequence = source.sequence;
                    item.source_occurred_at.clone_from(&source.occurred_at);
                    TimelineDelta::AgentMessageAppend {
                        source: source.clone(),
                        item_id,
                        item_ordinal: item.item_ordinal,
                        phase: item.phase,
                        text: delta,
                    }
                }
            }
            HostEventKind::ReasoningTextDelta {
                content_index,
                delta,
            } => {
                let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                let ordinal = self.reasoning_item(&item_id, &source, observed_at_ms)?;
                append_reasoning(&mut self.items[ordinal], content_index, &delta)?;
                self.items[ordinal].source_event_id = source.event_id;
                self.items[ordinal].source_sequence = source.sequence;
                self.items[ordinal]
                    .source_occurred_at
                    .clone_from(&source.occurred_at);
                TimelineDelta::ReasoningAppend {
                    source: source.clone(),
                    item_id,
                    item_ordinal: self.items[ordinal].item_ordinal,
                    content_index,
                    text: delta,
                }
            }
            HostEventKind::ReasoningTextFinalized {
                status,
                contents,
                reason,
            } => {
                let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                let ordinal = self.reasoning_item(&item_id, &source, observed_at_ms)?;
                let (status, reason_code, parts) = finalize_reasoning(status, contents, reason)?;
                let item = &mut self.items[ordinal];
                item.reasoning_status = Some(status);
                item.reasoning_reason_code = reason_code.clone();
                item.reasoning_parts.clone_from(&parts);
                item.reasoning_finalized_at_ms = Some(observed_at_ms);
                item.source_event_id = source.event_id;
                item.source_sequence = source.sequence;
                item.source_occurred_at.clone_from(&source.occurred_at);
                TimelineDelta::ReasoningFinalized {
                    source: source.clone(),
                    item_id,
                    item_ordinal: self.items[ordinal].item_ordinal,
                    status,
                    reason_code,
                    parts,
                }
            }
            HostEventKind::ItemCompleted {
                item_type,
                text,
                phase,
            } => {
                if excluded_lifecycle_item(&item_type) {
                    TimelineDelta::Ignored
                } else {
                    let item_id = event.item_id.ok_or(ChatError::OrchestrationUnavailable)?;
                    let text = (item_type == "agentMessage").then_some(text).flatten();
                    let (ordinal, suppress_live_delta) = self.upsert_lifecycle_item(
                        item_id,
                        item_type,
                        phase.map(Into::into),
                        text,
                        true,
                        &source,
                        observed_at_ms,
                    )?;
                    if suppress_live_delta {
                        TimelineDelta::Ignored
                    } else {
                        TimelineDelta::ItemCompleted(self.items[ordinal].clone())
                    }
                }
            }
            HostEventKind::Error {
                code,
                message: _,
                will_retry,
            } => {
                if self.turn_notices.len() >= MAX_TURN_NOTICES {
                    return Err(ChatError::ProjectionLimitExceeded);
                }
                let notice = TimelineNotice {
                    source_event_id: source.event_id,
                    source_sequence: source.sequence,
                    source_occurred_at: source.occurred_at.clone(),
                    scope: TimelineNoticeScope::Turn,
                    severity: TimelineNoticeSeverity::Error,
                    code: safe_code(code),
                    will_retry,
                    observed_at_ms,
                };
                self.turn_notices.push(notice.clone());
                TimelineDelta::Notice(notice)
            }
            HostEventKind::Warning { code, message: _ } => {
                let notice = TimelineNotice {
                    source_event_id: source.event_id,
                    source_sequence: source.sequence,
                    source_occurred_at: source.occurred_at.clone(),
                    scope: TimelineNoticeScope::Session,
                    severity: TimelineNoticeSeverity::Warning,
                    code: safe_code(code),
                    will_retry: false,
                    observed_at_ms,
                };
                session_notice = Some(notice.clone());
                TimelineDelta::Notice(notice)
            }
            HostEventKind::TurnCompleted {
                status,
                code,
                message: _,
            } => {
                let incomplete_reason = match status {
                    HostTurnStatus::Completed => "protocol_error",
                    HostTurnStatus::Interrupted => "turn_interrupted",
                    HostTurnStatus::Failed => "runtime_error",
                };
                let has_unfinished_reasoning = self.items.iter().any(|item| {
                    item.item_type == "reasoning"
                        && item.reasoning_status.is_none()
                        && !item.reasoning_parts.is_empty()
                });
                let terminal = TimelineTerminal {
                    source_event_id: source.event_id,
                    source_sequence: source.sequence,
                    source_occurred_at: source.occurred_at.clone(),
                    status: turn_status(status),
                    code: safe_code(code),
                    unfinished_reasoning_reason_code: has_unfinished_reasoning
                        .then(|| incomplete_reason.to_owned()),
                    observed_at_ms,
                };
                for item in &mut self.items {
                    if item.status == TimelineItemStatus::InProgress {
                        item.status = TimelineItemStatus::Incomplete;
                        item.completed_at_ms = Some(observed_at_ms);
                    }
                    if item.item_type == "reasoning"
                        && item.reasoning_status.is_none()
                        && !item.reasoning_parts.is_empty()
                    {
                        item.reasoning_status = Some(TimelineReasoningStatus::Incomplete);
                        item.reasoning_reason_code = Some(incomplete_reason.to_owned());
                        item.reasoning_finalized_at_ms = Some(observed_at_ms);
                    }
                }
                self.terminal = Some(terminal.clone());
                TimelineDelta::TurnTerminal(terminal)
            }
        };

        self.expected_stream = Some(event.cursor.stream_id);
        self.last_sequence = event.cursor.sequence;
        self.last_event_id = Some(event.event_id);
        let assistant_text = final_answer_text(&self.items)?;
        Ok(Some(Feat134Projection {
            session_id: self.context.session_id,
            turn_id: self.context.turn_id,
            cursor: StoredEventCursor {
                stream_id: event.cursor.stream_id,
                sequence: event.cursor.sequence,
                event_id: event.event_id,
            },
            source_event_type: event.event_type,
            source_turn_id: event.turn_id,
            source_occurred_at: event.occurred_at,
            source_event_bytes: event.encoded_bytes,
            observed_at_ms,
            durable_sequence: None,
            assistant_text,
            items: self.items.clone(),
            plan: self.plan.clone(),
            turn_notices: self.turn_notices.clone(),
            session_notice,
            terminal: self.terminal.clone(),
            delta,
        }))
    }

    pub fn observe_artifact(&mut self, event: &HostArtifactEventV3) -> Result<bool, ChatError> {
        if self.terminal.is_some()
            || event.task_id != self.context.task_id
            || event.agent_session_id != self.context.agent_session_id
            || event.codex_thread_id != self.context.codex_thread_id
            || event.turn_id != self.context.runtime_turn_id
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if event.cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event.event_id)
            && self.expected_stream == Some(event.cursor.stream_id)
        {
            return Ok(false);
        }
        self.validate_next(event.cursor)?;
        self.expected_stream = Some(event.cursor.stream_id);
        self.last_sequence = event.cursor.sequence;
        self.last_event_id = Some(event.event_id);
        Ok(true)
    }

    pub fn progress(&self) -> Result<TurnProgress, ChatError> {
        Ok(TurnProgress {
            local_turn_id: self.context.turn_id,
            assistant_text: final_answer_text(&self.items)?,
            cursor: StoredEventCursor {
                stream_id: self
                    .expected_stream
                    .ok_or(ChatError::ConversationConflict)?,
                sequence: self.last_sequence,
                event_id: self.last_event_id.ok_or(ChatError::ConversationConflict)?,
            },
        })
    }

    pub fn resync_reason(
        &self,
        cursor: HostEventCursor,
        event_id: Uuid,
    ) -> super::application::ArtifactResyncReason {
        if cursor.sequence == self.last_sequence
            && self.last_event_id == Some(event_id)
            && self.expected_stream == Some(cursor.stream_id)
        {
            return super::application::ArtifactResyncReason::ProtocolError;
        }
        if self.validate_next(cursor).is_err() {
            super::application::ArtifactResyncReason::SequenceGap
        } else {
            super::application::ArtifactResyncReason::ProtocolError
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.context.session_id
    }

    pub fn local_turn_id(&self) -> Uuid {
        self.context.turn_id
    }

    pub fn agent_session_id(&self) -> Uuid {
        self.context.agent_session_id
    }

    pub fn runtime_turn_id(&self) -> Uuid {
        self.context.runtime_turn_id
    }

    fn validate_next(&self, cursor: HostEventCursor) -> Result<(), ChatError> {
        if cursor.sequence
            != self
                .last_sequence
                .checked_add(1)
                .ok_or(ChatError::OrchestrationUnavailable)?
            || self
                .expected_stream
                .is_some_and(|stream| stream != cursor.stream_id)
        {
            return Err(ChatError::OrchestrationUnavailable);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn upsert_lifecycle_item(
        &mut self,
        item_id: String,
        item_type: String,
        phase: Option<TimelinePhase>,
        text: Option<String>,
        completed: bool,
        source: &SourceIdentity,
        observed_at_ms: i64,
    ) -> Result<(usize, bool), ChatError> {
        validate_item_identity(&item_id, &item_type)?;
        if item_type == "agentMessage" && text.is_none() {
            return Err(ChatError::OrchestrationUnavailable);
        }
        let text = text.unwrap_or_default();
        if text.len() > MAX_ITEM_TEXT_BYTES {
            return Err(ChatError::ProjectionLimitExceeded);
        }
        if text.contains('\0') {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if let Some(index) = self.items.iter().position(|item| item.item_id == item_id) {
            let item = &mut self.items[index];
            if item.item_type != item_type {
                return Err(ChatError::OrchestrationUnavailable);
            }
            if item.phase != phase {
                return Err(ChatError::OrchestrationUnavailable);
            }
            // The Runtime may reuse one reasoning identity across more than one lifecycle
            // notification cycle. Keep the original Timeline identity and confirmed reasoning
            // snapshot while accepting only that closed, content-free lifecycle. A finalized
            // snapshot stays completed so later reasoning content still fails closed. Other
            // completed Item identities remain immutable and fail closed.
            let repeated_reasoning_lifecycle = item.item_type == "reasoning"
                && item.status == TimelineItemStatus::Completed
                && phase.is_none()
                && text.is_empty();
            let repeated_finalized_reasoning_lifecycle =
                repeated_reasoning_lifecycle && item.reasoning_status.is_some();
            if item.status != TimelineItemStatus::InProgress && !repeated_reasoning_lifecycle {
                return Err(ChatError::OrchestrationUnavailable);
            }
            if item.item_type == "agentMessage" {
                if item.text.is_empty() {
                    item.text = text;
                } else if item.text != text && completed && text.starts_with(&item.text) {
                    // item.completed is the authoritative snapshot. It may legally extend the
                    // already confirmed streamed prefix, but can never shorten or fork it.
                    item.text = text;
                } else if item.text != text {
                    return Err(ChatError::ProjectionReconciliationFailed);
                }
            } else if !text.is_empty() {
                return Err(ChatError::OrchestrationUnavailable);
            }
            item.source_event_id = source.event_id;
            item.source_sequence = source.sequence;
            item.source_occurred_at.clone_from(&source.occurred_at);
            if completed {
                item.status = TimelineItemStatus::Completed;
                item.completed_at_ms = Some(observed_at_ms);
            } else if repeated_reasoning_lifecycle && !repeated_finalized_reasoning_lifecycle {
                item.status = TimelineItemStatus::InProgress;
                item.completed_at_ms = None;
            }
            return Ok((index, repeated_finalized_reasoning_lifecycle));
        }
        if self.items.len() >= MAX_TIMELINE_ITEMS {
            return Err(ChatError::ProjectionLimitExceeded);
        }
        let item_ordinal = self
            .items
            .len()
            .checked_add(1)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        self.items.push(TimelineItem {
            item_id,
            item_ordinal,
            item_type,
            phase,
            status: if completed {
                TimelineItemStatus::Completed
            } else {
                TimelineItemStatus::InProgress
            },
            text,
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: Vec::new(),
            reasoning_finalized_at_ms: None,
            started_at_ms: observed_at_ms,
            completed_at_ms: completed.then_some(observed_at_ms),
            source_event_id: source.event_id,
            source_sequence: source.sequence,
            source_occurred_at: source.occurred_at.clone(),
        });
        Ok((item_ordinal - 1, false))
    }

    fn reasoning_item(
        &mut self,
        item_id: &str,
        source: &SourceIdentity,
        observed_at_ms: i64,
    ) -> Result<usize, ChatError> {
        if let Some(index) = self.items.iter().position(|item| item.item_id == item_id) {
            if self.items[index].item_type != "reasoning"
                || self.items[index].status != TimelineItemStatus::InProgress
            {
                return Err(ChatError::OrchestrationUnavailable);
            }
            return Ok(index);
        }
        if self.items.len() >= MAX_TIMELINE_ITEMS
            || self
                .items
                .iter()
                .filter(|item| item.item_type == "reasoning")
                .count()
                >= MAX_REASONING_ITEMS
        {
            return Err(ChatError::ProjectionLimitExceeded);
        }
        validate_item_identity(item_id, "reasoning")?;
        let ordinal = self.items.len();
        let item_ordinal = ordinal
            .checked_add(1)
            .ok_or(ChatError::OrchestrationUnavailable)?;
        self.items.push(TimelineItem {
            item_id: item_id.to_owned(),
            item_ordinal,
            item_type: "reasoning".to_owned(),
            phase: None,
            status: TimelineItemStatus::InProgress,
            text: String::new(),
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: Vec::new(),
            reasoning_finalized_at_ms: None,
            started_at_ms: observed_at_ms,
            completed_at_ms: None,
            source_event_id: source.event_id,
            source_sequence: source.sequence,
            source_occurred_at: source.occurred_at.clone(),
        });
        Ok(ordinal)
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

fn validate_hydration(hydration: &Feat134Hydration) -> Result<(), ChatError> {
    if hydration.items.len() > MAX_TIMELINE_ITEMS {
        return Err(ChatError::DatabaseUnavailable);
    }
    for (index, item) in hydration.items.iter().enumerate() {
        if item.item_ordinal != index + 1 {
            return Err(ChatError::DatabaseUnavailable);
        }
        validate_item_identity(&item.item_id, &item.item_type)
            .map_err(|_| ChatError::DatabaseUnavailable)?;
        if item
            .reasoning_finalized_at_ms
            .is_some_and(|value| value < item.started_at_ms)
        {
            return Err(ChatError::DatabaseUnavailable);
        }
    }
    Ok(())
}

fn final_answer_text(items: &[TimelineItem]) -> Result<String, ChatError> {
    let mut text = String::new();
    for part in items
        .iter()
        .filter(|item| {
            item.item_type == "agentMessage" && item.phase == Some(TimelinePhase::FinalAnswer)
        })
        .map(|item| item.text.as_str())
        .filter(|part| !part.is_empty())
    {
        let separator_bytes = usize::from(!text.is_empty()) * 2;
        let next = text
            .len()
            .checked_add(separator_bytes)
            .and_then(|bytes| bytes.checked_add(part.len()))
            .ok_or(ChatError::ProjectionLimitExceeded)?;
        if next > MAX_ITEM_TEXT_BYTES {
            return Err(ChatError::ProjectionLimitExceeded);
        }
        if part.contains('\0') {
            return Err(ChatError::OrchestrationUnavailable);
        }
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(part);
    }
    Ok(text)
}

fn validate_item_identity(item_id: &str, item_type: &str) -> Result<(), ChatError> {
    if item_id.is_empty()
        || item_id.chars().count() > 256
        || item_id.len() > 1024
        || item_type.is_empty()
        || item_type.chars().count() > 256
        || item_type.len() > 1024
        || [item_id, item_type]
            .iter()
            .any(|value| value.contains('\0') || value.contains('\r') || value.contains('\n'))
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    Ok(())
}

fn map_plan_steps(steps: Vec<HostPlanStep>) -> Vec<TimelinePlanStep> {
    steps
        .into_iter()
        .enumerate()
        .map(|(ordinal, step)| TimelinePlanStep {
            ordinal,
            step: step.step,
            status: match step.status {
                HostPlanStepStatus::Pending => "pending",
                HostPlanStepStatus::InProgress => "in_progress",
                HostPlanStepStatus::Completed => "completed",
            },
        })
        .collect()
}

fn append_reasoning(
    item: &mut TimelineItem,
    content_index: usize,
    delta: &str,
) -> Result<(), ChatError> {
    if content_index >= MAX_REASONING_PARTS || delta.is_empty() || delta.contains('\0') {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if content_index > item.reasoning_parts.len() {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if content_index == item.reasoning_parts.len() {
        item.reasoning_parts.push(TimelineReasoningPart {
            content_index,
            text: String::new(),
        });
    }
    let part = &mut item.reasoning_parts[content_index];
    let next = part
        .text
        .len()
        .checked_add(delta.len())
        .ok_or(ChatError::ProjectionLimitExceeded)?;
    if next > MAX_REASONING_PART_BYTES {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    part.text.push_str(delta);
    validate_reasoning_totals(&item.reasoning_parts)
}

fn finalize_reasoning(
    status: HostReasoningStatus,
    contents: Vec<HostReasoningPart>,
    reason: Option<HostReasoningReason>,
) -> Result<
    (
        TimelineReasoningStatus,
        Option<String>,
        Vec<TimelineReasoningPart>,
    ),
    ChatError,
> {
    let status = match status {
        HostReasoningStatus::Complete => TimelineReasoningStatus::Complete,
        HostReasoningStatus::Incomplete => TimelineReasoningStatus::Incomplete,
        HostReasoningStatus::Unavailable => TimelineReasoningStatus::Unavailable,
    };
    let reason_code = reason.map(reason_code).map(str::to_owned);
    let parts = contents
        .into_iter()
        .map(|part| TimelineReasoningPart {
            content_index: part.content_index,
            text: part.text,
        })
        .collect::<Vec<_>>();
    validate_reasoning_totals(&parts)?;
    match status {
        TimelineReasoningStatus::Complete if !parts.is_empty() && reason_code.is_none() => {}
        TimelineReasoningStatus::Incomplete if !parts.is_empty() && reason_code.is_some() => {}
        TimelineReasoningStatus::Unavailable if parts.is_empty() && reason_code.is_some() => {}
        _ => return Err(ChatError::OrchestrationUnavailable),
    }
    Ok((status, reason_code, parts))
}

fn validate_reasoning_totals(parts: &[TimelineReasoningPart]) -> Result<(), ChatError> {
    if parts.len() > MAX_REASONING_PARTS {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    if parts.iter().enumerate().any(|(index, part)| {
        part.content_index != index || part.text.is_empty() || part.text.contains('\0')
    }) {
        return Err(ChatError::OrchestrationUnavailable);
    }
    if parts
        .iter()
        .any(|part| part.text.len() > MAX_REASONING_PART_BYTES)
        || parts
            .iter()
            .try_fold(0_usize, |total, part| total.checked_add(part.text.len()))
            .is_none_or(|total| total > MAX_REASONING_ITEM_BYTES)
    {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    Ok(())
}

pub fn validate_reasoning_turn(items: &[TimelineItem]) -> Result<(), ChatError> {
    let total = items
        .iter()
        .flat_map(|item| &item.reasoning_parts)
        .try_fold(0_usize, |total, part| total.checked_add(part.text.len()))
        .ok_or(ChatError::ProjectionLimitExceeded)?;
    if total > MAX_REASONING_TURN_BYTES {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    Ok(())
}

fn reason_code(reason: HostReasoningReason) -> &'static str {
    match reason {
        HostReasoningReason::ReasoningNotEmitted => "reasoning_not_emitted",
        HostReasoningReason::TurnInterrupted => "turn_interrupted",
        HostReasoningReason::StreamGap => "stream_gap",
        HostReasoningReason::RuntimeError => "runtime_error",
        HostReasoningReason::LimitExceeded => "limit_exceeded",
        HostReasoningReason::ProtocolError => "protocol_error",
        HostReasoningReason::HostShutdown => "host_shutdown",
    }
}

fn turn_status(status: HostTurnStatus) -> &'static str {
    match status {
        HostTurnStatus::Completed => "completed",
        HostTurnStatus::Interrupted => "interrupted",
        HostTurnStatus::Failed => "failed",
    }
}

fn excluded_lifecycle_item(item_type: &str) -> bool {
    matches!(
        item_type,
        "userMessage" | "fileChange" | "artifact" | "imageArtifact" | "videoArtifact"
    )
}

fn safe_code(code: Option<String>) -> Option<String> {
    code.filter(|value| {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    })
}

#[cfg(test)]
mod tests {
    use super::super::host_domain::{HostEventCursor, HostPlanStep};
    use super::*;

    fn context() -> ActiveTurnContext {
        ActiveTurnContext {
            session_id: Uuid::from_u128(1),
            task_id: Uuid::from_u128(2),
            turn_id: Uuid::from_u128(3),
            turn_operation_id: Uuid::from_u128(4),
            agent_session_id: Uuid::from_u128(5),
            codex_thread_id: Uuid::from_u128(6),
            runtime_turn_id: Uuid::from_u128(7),
            assistant_text: String::new(),
            cursor: None,
        }
    }

    fn event(sequence: u64, item_id: Option<&str>, kind: HostEventKind) -> HostEvent {
        HostEvent {
            cursor: HostEventCursor::new(Uuid::from_u128(8), sequence).unwrap(),
            event_type: "synthetic".to_owned(),
            event_id: Uuid::from_u128(100 + u128::from(sequence)),
            task_id: Uuid::from_u128(2),
            agent_session_id: Uuid::from_u128(5),
            codex_thread_id: Uuid::from_u128(6),
            turn_id: Some(Uuid::from_u128(7)),
            item_id: item_id.map(str::to_owned),
            occurred_at: "2026-08-28T00:00:00Z".to_owned(),
            encoded_bytes: 1,
            kind,
        }
    }

    #[test]
    fn multiple_agent_items_keep_identity_phase_and_reconcile_authoritative_snapshot() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        let first = reducer
            .apply(
                event(
                    1,
                    Some("commentary"),
                    HostEventKind::ItemStarted {
                        item_type: "agentMessage".to_owned(),
                        text: Some(String::new()),
                        phase: Some(HostAgentMessagePhase::Commentary),
                    },
                ),
                1,
            )
            .unwrap()
            .unwrap();
        assert!(matches!(first.delta, TimelineDelta::ItemStarted(_)));
        reducer
            .apply(
                event(
                    2,
                    Some("commentary"),
                    HostEventKind::AgentMessageDelta {
                        delta: "working".to_owned(),
                    },
                ),
                2,
            )
            .unwrap();
        let completed = reducer
            .apply(
                event(
                    3,
                    Some("commentary"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("working".to_owned()),
                        phase: Some(HostAgentMessagePhase::Commentary),
                    },
                ),
                3,
            )
            .unwrap()
            .unwrap();
        assert_eq!(completed.items[0].item_ordinal, 1);
        assert_eq!(completed.items[0].text, "working");
        assert!(completed.assistant_text.is_empty());

        let final_item = reducer
            .apply(
                event(
                    4,
                    Some("final"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("authoritative".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                4,
            )
            .unwrap()
            .unwrap();
        assert_eq!(final_item.items[1].item_ordinal, 2);
        assert_eq!(final_item.assistant_text, "authoritative");
    }

    #[test]
    fn agent_snapshot_accepts_equal_or_extension_and_rejects_shorter_or_divergent() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        reducer
            .apply(
                event(
                    1,
                    Some("assistant"),
                    HostEventKind::ItemStarted {
                        item_type: "agentMessage".to_owned(),
                        text: Some(String::new()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                1,
            )
            .unwrap();
        reducer
            .apply(
                event(
                    2,
                    Some("assistant"),
                    HostEventKind::AgentMessageDelta {
                        delta: "hello".to_owned(),
                    },
                ),
                2,
            )
            .unwrap();
        for rejected in ["hell", "hullo world"] {
            assert_eq!(
                reducer.apply(
                    event(
                        3,
                        Some("assistant"),
                        HostEventKind::ItemCompleted {
                            item_type: "agentMessage".to_owned(),
                            text: Some(rejected.to_owned()),
                            phase: Some(HostAgentMessagePhase::FinalAnswer),
                        },
                    ),
                    3,
                ),
                Err(ChatError::ProjectionReconciliationFailed)
            );
            assert_eq!(reducer.progress().unwrap().cursor.sequence, 2);
            assert_eq!(reducer.progress().unwrap().assistant_text, "hello");
        }
        let extended = reducer
            .apply(
                event(
                    3,
                    Some("assistant"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("hello world".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                3,
            )
            .unwrap()
            .unwrap();
        assert_eq!(extended.assistant_text, "hello world");
        assert_eq!(extended.items[0].text, "hello world");
        assert_eq!(extended.cursor.sequence, 3);
    }

    #[test]
    fn repeated_reasoning_lifecycle_keeps_one_identity_through_final_terminal() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        reducer
            .apply(
                event(
                    1,
                    Some("reasoning-reused"),
                    HostEventKind::ItemStarted {
                        item_type: "reasoning".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                1,
            )
            .unwrap();
        reducer
            .apply(
                event(
                    2,
                    Some("reasoning-reused"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "confirmed".to_owned(),
                    },
                ),
                2,
            )
            .unwrap();
        reducer
            .apply(
                event(
                    3,
                    Some("reasoning-reused"),
                    HostEventKind::ReasoningTextFinalized {
                        status: HostReasoningStatus::Complete,
                        contents: vec![HostReasoningPart {
                            content_index: 0,
                            text: "confirmed".to_owned(),
                        }],
                        reason: None,
                    },
                ),
                3,
            )
            .unwrap();
        reducer
            .apply(
                event(
                    4,
                    Some("reasoning-reused"),
                    HostEventKind::ItemCompleted {
                        item_type: "reasoning".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                4,
            )
            .unwrap();

        let mut sequence = 5_u64;
        for _ in 0..128 {
            let reopened = reducer
                .apply(
                    event(
                        sequence,
                        Some("reasoning-reused"),
                        HostEventKind::ItemStarted {
                            item_type: "reasoning".to_owned(),
                            text: None,
                            phase: None,
                        },
                    ),
                    sequence as i64,
                )
                .unwrap()
                .unwrap();
            assert_eq!(reopened.items.len(), 1);
            assert_eq!(reopened.items[0].item_ordinal, 1);
            assert_eq!(reopened.items[0].status, TimelineItemStatus::Completed);
            assert_eq!(reopened.items[0].reasoning_parts[0].text, "confirmed");
            assert!(matches!(reopened.delta, TimelineDelta::Ignored));
            sequence += 1;

            let completed = reducer
                .apply(
                    event(
                        sequence,
                        Some("reasoning-reused"),
                        HostEventKind::ItemCompleted {
                            item_type: "reasoning".to_owned(),
                            text: None,
                            phase: None,
                        },
                    ),
                    sequence as i64,
                )
                .unwrap()
                .unwrap();
            assert_eq!(completed.items.len(), 1);
            assert_eq!(completed.items[0].item_ordinal, 1);
            assert_eq!(completed.items[0].status, TimelineItemStatus::Completed);
            assert!(matches!(completed.delta, TimelineDelta::Ignored));
            sequence += 1;
        }

        reducer
            .apply(
                event(
                    sequence,
                    Some("final"),
                    HostEventKind::ItemStarted {
                        item_type: "agentMessage".to_owned(),
                        text: Some(String::new()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                sequence as i64,
            )
            .unwrap();
        sequence += 1;
        reducer
            .apply(
                event(
                    sequence,
                    Some("final"),
                    HostEventKind::AgentMessageDelta {
                        delta: "done".to_owned(),
                    },
                ),
                sequence as i64,
            )
            .unwrap();
        sequence += 1;
        reducer
            .apply(
                event(
                    sequence,
                    Some("final"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("done".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                sequence as i64,
            )
            .unwrap();
        sequence += 1;
        let terminal = reducer
            .apply(
                event(
                    sequence,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                sequence as i64,
            )
            .unwrap()
            .unwrap();

        assert_eq!(terminal.items.len(), 2);
        assert_eq!(terminal.items[0].item_id, "reasoning-reused");
        assert_eq!(terminal.items[0].item_ordinal, 1);
        assert_eq!(terminal.items[0].status, TimelineItemStatus::Completed);
        assert_eq!(terminal.items[1].item_ordinal, 2);
        assert_eq!(terminal.assistant_text, "done");
        assert_eq!(terminal.legacy_reasoning().len(), 1);
        assert_eq!(terminal.terminal.unwrap().status, "completed");
    }

    #[test]
    fn hydrated_finalized_reasoning_accepts_content_free_replay_and_rejects_new_content() {
        let mut context = context();
        context.cursor = Some(StoredEventCursor {
            stream_id: Uuid::from_u128(8),
            sequence: 7,
            event_id: Uuid::from_u128(107),
        });
        let source_occurred_at = "2026-08-28T00:00:00Z".to_owned();
        let hydration = Feat134Hydration {
            items: vec![TimelineItem {
                item_id: "reasoning-reused".to_owned(),
                item_ordinal: 1,
                item_type: "reasoning".to_owned(),
                phase: None,
                status: TimelineItemStatus::Completed,
                text: String::new(),
                reasoning_status: Some(TimelineReasoningStatus::Complete),
                reasoning_reason_code: None,
                reasoning_parts: vec![TimelineReasoningPart {
                    content_index: 0,
                    text: "confirmed".to_owned(),
                }],
                reasoning_finalized_at_ms: Some(6),
                started_at_ms: 1,
                completed_at_ms: Some(7),
                source_event_id: Uuid::from_u128(107),
                source_sequence: 7,
                source_occurred_at,
            }],
            plan: None,
            turn_notices: Vec::new(),
        };
        let mut reducer = Feat134TurnReducer::new(context, Some(hydration)).unwrap();

        let reopened = reducer
            .apply(
                event(
                    8,
                    Some("reasoning-reused"),
                    HostEventKind::ItemStarted {
                        item_type: "reasoning".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                8,
            )
            .unwrap()
            .unwrap();
        assert_eq!(reopened.cursor.sequence, 8);
        assert_eq!(reopened.items.len(), 1);
        assert_eq!(reopened.items[0].item_ordinal, 1);
        assert_eq!(reopened.items[0].status, TimelineItemStatus::Completed);
        assert_eq!(reopened.items[0].completed_at_ms, Some(7));
        assert_eq!(reopened.items[0].reasoning_parts[0].text, "confirmed");
        assert!(matches!(reopened.delta, TimelineDelta::Ignored));

        assert_eq!(
            reducer.apply(
                event(
                    9,
                    Some("reasoning-reused"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "must-not-append".to_owned(),
                    },
                ),
                9,
            ),
            Err(ChatError::OrchestrationUnavailable)
        );
        assert_eq!(reducer.progress().unwrap().cursor.sequence, 8);
        assert_eq!(reducer.items[0].reasoning_parts[0].text, "confirmed");

        let replay_completed = reducer
            .apply(
                event(
                    9,
                    Some("reasoning-reused"),
                    HostEventKind::ItemCompleted {
                        item_type: "reasoning".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                9,
            )
            .unwrap()
            .unwrap();
        assert!(matches!(replay_completed.delta, TimelineDelta::Ignored));
        let final_item = reducer
            .apply(
                event(
                    10,
                    Some("final"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("done".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                10,
            )
            .unwrap()
            .unwrap();
        assert_eq!(final_item.assistant_text, "done");
        let terminal = reducer
            .apply(
                event(
                    11,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                11,
            )
            .unwrap()
            .unwrap();
        assert_eq!(terminal.cursor.sequence, 11);
        assert_eq!(terminal.items.len(), 2);
        assert_eq!(terminal.items[0].item_ordinal, 1);
        assert_eq!(terminal.assistant_text, "done");
        assert_eq!(terminal.terminal.unwrap().status, "completed");
    }

    #[test]
    fn completed_non_reasoning_identity_remains_fail_closed() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        reducer
            .apply(
                event(
                    1,
                    Some("assistant"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("done".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                1,
            )
            .unwrap();
        assert_eq!(
            reducer.apply(
                event(
                    2,
                    Some("assistant"),
                    HostEventKind::ItemStarted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("done".to_owned()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                2,
            ),
            Err(ChatError::OrchestrationUnavailable)
        );
        assert_eq!(reducer.progress().unwrap().cursor.sequence, 1);

        let mut type_conflict = Feat134TurnReducer::new(context(), None).unwrap();
        type_conflict
            .apply(
                event(
                    1,
                    Some("shared"),
                    HostEventKind::ItemCompleted {
                        item_type: "reasoning".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                1,
            )
            .unwrap();
        assert_eq!(
            type_conflict.apply(
                event(
                    2,
                    Some("shared"),
                    HostEventKind::ItemStarted {
                        item_type: "custom".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                2,
            ),
            Err(ChatError::OrchestrationUnavailable)
        );
        assert_eq!(type_conflict.progress().unwrap().cursor.sequence, 1);
    }

    #[test]
    fn empty_agent_delta_is_durable_ignored_semantics() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        reducer
            .apply(
                event(
                    1,
                    Some("assistant"),
                    HostEventKind::ItemStarted {
                        item_type: "agentMessage".to_owned(),
                        text: Some(String::new()),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                1,
            )
            .unwrap();
        let empty = reducer
            .apply(
                event(
                    2,
                    Some("assistant"),
                    HostEventKind::AgentMessageDelta {
                        delta: String::new(),
                    },
                ),
                2,
            )
            .unwrap()
            .unwrap();
        assert!(matches!(empty.delta, TimelineDelta::Ignored));
        assert_eq!(empty.cursor.sequence, 2);
        assert_eq!(empty.items[0].source_sequence, 1);
        assert!(empty.assistant_text.is_empty());
    }

    #[test]
    fn legal_multi_final_item_and_notice_aggregates_report_typed_projection_limits() {
        let mut multi_final = Feat134TurnReducer::new(context(), None).unwrap();
        multi_final
            .apply(
                event(
                    1,
                    Some("final-1"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("a".repeat(600 * 1024)),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                1,
            )
            .unwrap();
        assert_eq!(
            multi_final.apply(
                event(
                    2,
                    Some("final-2"),
                    HostEventKind::ItemCompleted {
                        item_type: "agentMessage".to_owned(),
                        text: Some("b".repeat(600 * 1024)),
                        phase: Some(HostAgentMessagePhase::FinalAnswer),
                    },
                ),
                2,
            ),
            Err(ChatError::ProjectionLimitExceeded)
        );

        let source_event_id = Uuid::from_u128(900);
        let source_occurred_at = "2026-08-28T00:00:00Z".to_owned();
        let full_items = (1..=MAX_TIMELINE_ITEMS)
            .map(|item_ordinal| TimelineItem {
                item_id: format!("item-{item_ordinal}"),
                item_ordinal,
                item_type: "custom".to_owned(),
                phase: None,
                status: TimelineItemStatus::Completed,
                text: String::new(),
                reasoning_status: None,
                reasoning_reason_code: None,
                reasoning_parts: Vec::new(),
                reasoning_finalized_at_ms: None,
                started_at_ms: 1,
                completed_at_ms: Some(1),
                source_event_id,
                source_sequence: 1,
                source_occurred_at: source_occurred_at.clone(),
            })
            .collect();
        let mut item_limit = Feat134TurnReducer::new(
            context(),
            Some(Feat134Hydration {
                items: full_items,
                plan: None,
                turn_notices: Vec::new(),
            }),
        )
        .unwrap();
        assert_eq!(
            item_limit.apply(
                event(
                    1,
                    Some("item-513"),
                    HostEventKind::ItemCompleted {
                        item_type: "custom".to_owned(),
                        text: None,
                        phase: None,
                    },
                ),
                2,
            ),
            Err(ChatError::ProjectionLimitExceeded)
        );

        let full_notices = (1..=MAX_TURN_NOTICES)
            .map(|source_sequence| TimelineNotice {
                source_event_id: Uuid::from_u128(1_000 + source_sequence as u128),
                source_sequence: source_sequence as u64,
                source_occurred_at: source_occurred_at.clone(),
                scope: TimelineNoticeScope::Turn,
                severity: TimelineNoticeSeverity::Error,
                code: Some("provider_error".to_owned()),
                will_retry: false,
                observed_at_ms: source_sequence as i64,
            })
            .collect();
        let mut notice_limit = Feat134TurnReducer::new(
            context(),
            Some(Feat134Hydration {
                items: Vec::new(),
                plan: None,
                turn_notices: full_notices,
            }),
        )
        .unwrap();
        assert_eq!(
            notice_limit.apply(
                event(
                    1,
                    None,
                    HostEventKind::Error {
                        code: Some("provider_error".to_owned()),
                        message: "redacted by native projection".to_owned(),
                        will_retry: false,
                    },
                ),
                2,
            ),
            Err(ChatError::ProjectionLimitExceeded)
        );
    }

    #[test]
    fn text_bearing_projection_debug_is_content_free() {
        let source = SourceIdentity {
            event_id: Uuid::from_u128(4_001),
            sequence: 1,
            occurred_at: "2026-08-28T00:00:00Z".to_owned(),
        };
        let part = TimelineReasoningPart {
            content_index: 0,
            text: "REASONING_CANARY".to_owned(),
        };
        let item = TimelineItem {
            item_id: "assistant".to_owned(),
            item_ordinal: 1,
            item_type: "agentMessage".to_owned(),
            phase: Some(TimelinePhase::FinalAnswer),
            status: TimelineItemStatus::Completed,
            text: "FINAL_CANARY".to_owned(),
            reasoning_status: None,
            reasoning_reason_code: None,
            reasoning_parts: vec![part.clone()],
            reasoning_finalized_at_ms: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
            source_event_id: source.event_id,
            source_sequence: source.sequence,
            source_occurred_at: source.occurred_at.clone(),
        };
        let step = TimelinePlanStep {
            ordinal: 0,
            step: "PLAN_STEP_CANARY".to_owned(),
            status: "in_progress",
        };
        let plan = TimelinePlan {
            source_event_id: source.event_id,
            source_sequence: source.sequence,
            source_occurred_at: source.occurred_at.clone(),
            explanation: Some("PLAN_EXPLANATION_CANARY".to_owned()),
            steps: vec![step.clone()],
            observed_at_ms: 1,
        };
        let delta = TimelineDelta::AgentMessageAppend {
            source: source.clone(),
            item_id: "assistant".to_owned(),
            item_ordinal: 1,
            phase: Some(TimelinePhase::FinalAnswer),
            text: "DELTA_CANARY".to_owned(),
        };
        let projection = Feat134Projection {
            session_id: Uuid::from_u128(4_002),
            turn_id: Uuid::from_u128(4_003),
            cursor: StoredEventCursor {
                stream_id: Uuid::from_u128(4_004),
                sequence: 1,
                event_id: source.event_id,
            },
            source_event_type: "item.agent_message.delta".to_owned(),
            source_turn_id: Some(Uuid::from_u128(4_005)),
            source_occurred_at: source.occurred_at,
            source_event_bytes: 1,
            observed_at_ms: 1,
            durable_sequence: None,
            assistant_text: "ASSISTANT_CANARY".to_owned(),
            items: vec![item.clone()],
            plan: Some(plan.clone()),
            turn_notices: Vec::new(),
            session_notice: None,
            terminal: None,
            delta: delta.clone(),
        };
        let debug = [
            format!("{part:?}"),
            format!("{item:?}"),
            format!("{step:?}"),
            format!("{plan:?}"),
            format!("{delta:?}"),
            format!("{projection:?}"),
        ]
        .join("\n");
        for canary in [
            "REASONING_CANARY",
            "FINAL_CANARY",
            "PLAN_STEP_CANARY",
            "PLAN_EXPLANATION_CANARY",
            "DELTA_CANARY",
            "ASSISTANT_CANARY",
        ] {
            assert!(!debug.contains(canary), "Debug leaked {canary}");
        }
        assert!(debug.contains("utf8_bytes"));
        assert!(debug.contains("assistant_utf8_bytes"));
    }

    #[test]
    fn plan_reasoning_notice_and_terminal_are_explicit_and_stable() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        let plan = reducer
            .apply(
                event(
                    1,
                    None,
                    HostEventKind::TurnPlanUpdated {
                        explanation: None,
                        steps: vec![HostPlanStep {
                            step: "safe".to_owned(),
                            status: HostPlanStepStatus::InProgress,
                        }],
                    },
                ),
                1,
            )
            .unwrap()
            .unwrap();
        assert_eq!(plan.plan.unwrap().steps[0].status, "in_progress");
        reducer
            .apply(
                event(
                    2,
                    Some("reasoning"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "trace".to_owned(),
                    },
                ),
                2,
            )
            .unwrap();
        let finalized = reducer
            .apply(
                event(
                    3,
                    Some("reasoning"),
                    HostEventKind::ReasoningTextFinalized {
                        status: HostReasoningStatus::Complete,
                        contents: vec![HostReasoningPart {
                            content_index: 0,
                            text: "trace".to_owned(),
                        }],
                        reason: None,
                    },
                ),
                3,
            )
            .unwrap()
            .unwrap();
        assert_eq!(finalized.legacy_reasoning().len(), 1);
        let terminal = reducer
            .apply(
                event(
                    4,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Completed,
                        code: None,
                        message: None,
                    },
                ),
                4,
            )
            .unwrap()
            .unwrap();
        let terminal = terminal.terminal.unwrap();
        assert_eq!(terminal.status, "completed");
        assert_eq!(terminal.unfinished_reasoning_reason_code, None);
    }

    #[test]
    fn terminal_carries_closed_reason_for_unfinished_reasoning_parts() {
        let mut reducer = Feat134TurnReducer::new(context(), None).unwrap();
        reducer
            .apply(
                event(
                    1,
                    Some("reasoning"),
                    HostEventKind::ReasoningTextDelta {
                        content_index: 0,
                        delta: "confirmed reasoning".to_owned(),
                    },
                ),
                1,
            )
            .unwrap();
        let terminal = reducer
            .apply(
                event(
                    2,
                    None,
                    HostEventKind::TurnCompleted {
                        status: HostTurnStatus::Interrupted,
                        code: None,
                        message: None,
                    },
                ),
                2,
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            terminal
                .terminal
                .as_ref()
                .unwrap()
                .unfinished_reasoning_reason_code
                .as_deref(),
            Some("turn_interrupted")
        );
        assert_eq!(
            terminal.items[0].reasoning_reason_code.as_deref(),
            Some("turn_interrupted")
        );
    }

    #[test]
    fn exact_gate_rejects_public_and_non_exact_values() {
        assert!(exact_local_enabled(Some("true"), Some("local"), Some("demo_fast")).unwrap());
        assert!(!exact_local_enabled(None, Some("local"), Some("demo_fast")).unwrap());
        assert!(exact_local_enabled(Some("true"), Some("production"), Some("demo_fast")).is_err());
        assert!(exact_local_enabled(Some("TRUE"), Some("local"), Some("demo_fast")).is_err());
    }
}
