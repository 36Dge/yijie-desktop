use super::database::ActiveTurnContext;
use super::error::ChatError;
use super::feat134::{
    Feat134Hydration, Feat134Projection, Feat134TurnReducer, SourceIdentity, TimelineDelta,
    TimelineItem, TimelineItemStatus,
};
use super::host_domain::{
    HostArtifactEventV3, HostCommandCwd, HostCommandErrorCode, HostCommandOutput,
    HostCommandStatus, HostEvent, HostEventCursor, HostProjectionError, HostSafeText,
    HostToolErrorCode, HostToolIdentity, HostToolStatus, HostTruncationReason,
};
use std::fmt::{Debug, Formatter};

pub const FEAT136_FLAG: &str = "YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED";
pub const SOURCE_SCHEMA_VERSION: u8 = 5;
const MAX_TIMELINE_ITEMS: usize = 512;
const MAX_COMMAND_LIVE_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_TOOL_PROGRESS_ITEMS: usize = 32;
const MAX_TOOL_PROGRESS_TOTAL_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TruncationReason {
    Utf8ByteLimit,
    UpstreamTruncated,
}

impl TruncationReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Utf8ByteLimit => "utf8_byte_limit",
            Self::UpstreamTruncated => "upstream_truncated",
        }
    }
}

impl From<HostTruncationReason> for TruncationReason {
    fn from(value: HostTruncationReason) -> Self {
        match value {
            HostTruncationReason::Utf8ByteLimit => Self::Utf8ByteLimit,
            HostTruncationReason::UpstreamTruncated => Self::UpstreamTruncated,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct SafeTextProjection {
    pub text: String,
    pub truncated: bool,
    pub truncation_reason: Option<TruncationReason>,
}

impl Debug for SafeTextProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SafeTextProjection")
            .field("utf8_bytes", &self.text.len())
            .field("truncated", &self.truncated)
            .field("truncation_reason", &self.truncation_reason)
            .finish()
    }
}

impl From<HostSafeText> for SafeTextProjection {
    fn from(value: HostSafeText) -> Self {
        Self {
            text: value.text,
            truncated: value.truncated,
            truncation_reason: value.truncation_reason.map(Into::into),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandCwdProjection {
    WorkspaceRoot,
    WorkspaceRelative(Vec<String>),
    Redacted,
}

impl CommandCwdProjection {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::WorkspaceRoot => "workspace_root",
            Self::WorkspaceRelative(_) => "workspace_relative",
            Self::Redacted => "redacted",
        }
    }

    pub fn segments(&self) -> &[String] {
        match self {
            Self::WorkspaceRelative(segments) => segments,
            Self::WorkspaceRoot | Self::Redacted => &[],
        }
    }
}

impl From<HostCommandCwd> for CommandCwdProjection {
    fn from(value: HostCommandCwd) -> Self {
        match value {
            HostCommandCwd::WorkspaceRoot => Self::WorkspaceRoot,
            HostCommandCwd::WorkspaceRelative(segments) => Self::WorkspaceRelative(segments),
            HostCommandCwd::Redacted => Self::Redacted,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandOutputProjection {
    Complete {
        text: String,
    },
    HeadTail {
        head: String,
        tail: String,
        reason: TruncationReason,
    },
    Unavailable,
}

impl CommandOutputProjection {
    pub fn retention(&self) -> &'static str {
        match self {
            Self::Complete { .. } => "complete",
            Self::HeadTail { .. } => "head_tail",
            Self::Unavailable => "unavailable",
        }
    }
}

impl From<HostCommandOutput> for CommandOutputProjection {
    fn from(value: HostCommandOutput) -> Self {
        match value {
            HostCommandOutput::Complete { text } => Self::Complete { text },
            HostCommandOutput::HeadTail { head, tail, reason } => Self::HeadTail {
                head,
                tail,
                reason: reason.into(),
            },
            HostCommandOutput::Unavailable => Self::Unavailable,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandStatus {
    Running,
    Completed,
    Failed,
    Declined,
    Incomplete,
}

impl CommandStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Declined => "declined",
            Self::Incomplete => "incomplete",
        }
    }
}

impl From<HostCommandStatus> for CommandStatus {
    fn from(value: HostCommandStatus) -> Self {
        match value {
            HostCommandStatus::Completed => Self::Completed,
            HostCommandStatus::Failed => Self::Failed,
            HostCommandStatus::Declined => Self::Declined,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionErrorCode {
    CommandFailed,
    CommandDeclined,
    ToolFailed,
    ToolDeclined,
    UnknownTool,
    ProjectionLimitExceeded,
    ProjectionRedactionFailed,
    ProtocolError,
}

impl ProjectionErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CommandFailed => "command_failed",
            Self::CommandDeclined => "command_declined",
            Self::ToolFailed => "tool_failed",
            Self::ToolDeclined => "tool_declined",
            Self::UnknownTool => "unknown_tool",
            Self::ProjectionLimitExceeded => "projection_limit_exceeded",
            Self::ProjectionRedactionFailed => "projection_redaction_failed",
            Self::ProtocolError => "protocol_error",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ProjectionError {
    pub code: ProjectionErrorCode,
    pub summary: String,
}

impl Debug for ProjectionError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProjectionError")
            .field("code", &self.code)
            .field("summary_utf8_bytes", &self.summary.len())
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct CommandProjection {
    pub status: CommandStatus,
    pub started_source: SourceIdentity,
    pub last_source: SourceIdentity,
    pub command_summary: SafeTextProjection,
    pub cwd: CommandCwdProjection,
    pub live_output: Option<SafeTextProjection>,
    pub output: Option<CommandOutputProjection>,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub error: Option<ProjectionError>,
}

impl Debug for CommandProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommandProjection")
            .field("status", &self.status)
            .field("started_source", &self.started_source)
            .field("last_source", &self.last_source)
            .field("command_summary", &self.command_summary)
            .field("cwd_kind", &self.cwd.kind())
            .field("live_output", &self.live_output)
            .field(
                "output",
                &self.output.as_ref().map(CommandOutputProjection::retention),
            )
            .field("duration_ms", &self.duration_ms)
            .field("exit_code", &self.exit_code)
            .field("error", &self.error)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolIdentityProjection {
    Known {
        server_name: String,
        tool_name: String,
    },
    Unknown,
}

impl ToolIdentityProjection {
    pub fn resolution(&self) -> &'static str {
        match self {
            Self::Known { .. } => "known",
            Self::Unknown => "unknown",
        }
    }

    pub fn names(&self) -> (&str, &str) {
        match self {
            Self::Known {
                server_name,
                tool_name,
            } => (server_name, tool_name),
            Self::Unknown => ("unknown", "unknown"),
        }
    }
}

impl From<HostToolIdentity> for ToolIdentityProjection {
    fn from(value: HostToolIdentity) -> Self {
        match value {
            HostToolIdentity::Known {
                server_name,
                tool_name,
            } => Self::Known {
                server_name,
                tool_name,
            },
            HostToolIdentity::Unknown => Self::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
    Incomplete,
}

impl ToolStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Declined => "declined",
            Self::Incomplete => "incomplete",
        }
    }
}

impl From<HostToolStatus> for ToolStatus {
    fn from(value: HostToolStatus) -> Self {
        match value {
            HostToolStatus::Completed => Self::Completed,
            HostToolStatus::Failed => Self::Failed,
            HostToolStatus::Declined => Self::Declined,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ToolProgressProjection {
    pub source: SourceIdentity,
    pub progress_index: usize,
    pub summary: SafeTextProjection,
}

impl Debug for ToolProgressProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ToolProgressProjection")
            .field("source", &self.source)
            .field("progress_index", &self.progress_index)
            .field("summary", &self.summary)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ToolProjection {
    pub status: ToolStatus,
    pub started_source: SourceIdentity,
    pub last_source: SourceIdentity,
    pub identity: ToolIdentityProjection,
    pub arguments_summary: SafeTextProjection,
    pub progress: Vec<ToolProgressProjection>,
    pub duration_ms: Option<u64>,
    pub result_summary: Option<SafeTextProjection>,
    pub error: Option<ProjectionError>,
}

impl Debug for ToolProjection {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ToolProjection")
            .field("status", &self.status)
            .field("started_source", &self.started_source)
            .field("last_source", &self.last_source)
            .field("identity_resolution", &self.identity.resolution())
            .field("arguments_summary", &self.arguments_summary)
            .field("progress_count", &self.progress.len())
            .field("duration_ms", &self.duration_ms)
            .field("result_summary", &self.result_summary)
            .field("error", &self.error)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExecutionProjection {
    Command(CommandProjection),
    Tool(ToolProjection),
}

pub struct Feat136TurnReducer {
    inner: Feat134TurnReducer,
}

impl Feat136TurnReducer {
    pub fn new(
        context: ActiveTurnContext,
        hydration: Option<Feat134Hydration>,
    ) -> Result<Self, ChatError> {
        Ok(Self {
            inner: Feat134TurnReducer::new_v5(context, hydration)?,
        })
    }

    pub fn apply(
        &mut self,
        event: HostEvent,
        observed_at_ms: i64,
    ) -> Result<Option<Feat134Projection>, ChatError> {
        self.inner.apply(event, observed_at_ms)
    }

    pub fn inner(&self) -> &Feat134TurnReducer {
        &self.inner
    }

    pub fn inner_mut(&mut self) -> &mut Feat134TurnReducer {
        &mut self.inner
    }

    pub fn observe_artifact(&mut self, event: &HostArtifactEventV3) -> Result<bool, ChatError> {
        self.inner.observe_artifact(event)
    }

    pub fn progress(&self) -> Result<super::database::TurnProgress, ChatError> {
        self.inner.progress()
    }

    pub fn resync_reason(
        &self,
        cursor: HostEventCursor,
        event_id: uuid::Uuid,
    ) -> super::application::ArtifactResyncReason {
        self.inner.resync_reason(cursor, event_id)
    }

    pub fn session_id(&self) -> uuid::Uuid {
        self.inner.session_id()
    }

    pub fn local_turn_id(&self) -> uuid::Uuid {
        self.inner.local_turn_id()
    }

    pub fn agent_session_id(&self) -> uuid::Uuid {
        self.inner.agent_session_id()
    }

    pub fn runtime_turn_id(&self) -> uuid::Uuid {
        self.inner.runtime_turn_id()
    }
}

pub(crate) fn command_started(
    items: &mut Vec<TimelineItem>,
    item_id: String,
    source: &SourceIdentity,
    command_summary: HostSafeText,
    cwd: HostCommandCwd,
    observed_at_ms: i64,
) -> Result<TimelineDelta, ChatError> {
    ensure_new_item(items, &item_id)?;
    let execution = ExecutionProjection::Command(CommandProjection {
        status: CommandStatus::Running,
        started_source: source.clone(),
        last_source: source.clone(),
        command_summary: command_summary.into(),
        cwd: cwd.into(),
        live_output: None,
        output: None,
        duration_ms: None,
        exit_code: None,
        error: None,
    });
    let item = execution_item(
        items,
        item_id,
        "command",
        execution,
        source,
        observed_at_ms,
        false,
    )?;
    Ok(TimelineDelta::CommandStarted(item))
}

pub(crate) fn command_output_delta(
    items: &mut [TimelineItem],
    item_id: &str,
    source: &SourceIdentity,
    delta: HostSafeText,
) -> Result<TimelineDelta, ChatError> {
    let item = items
        .iter_mut()
        .find(|item| item.item_id == item_id)
        .ok_or(ChatError::OrchestrationUnavailable)?;
    let ExecutionProjection::Command(command) = item
        .execution
        .as_mut()
        .ok_or(ChatError::OrchestrationUnavailable)?
    else {
        return Err(ChatError::OrchestrationUnavailable);
    };
    if command.status != CommandStatus::Running {
        return Err(ChatError::OrchestrationUnavailable);
    }
    let delta: SafeTextProjection = delta.into();
    let live = command
        .live_output
        .get_or_insert_with(|| SafeTextProjection {
            text: String::new(),
            truncated: false,
            truncation_reason: None,
        });
    let next = live
        .text
        .len()
        .checked_add(delta.text.len())
        .ok_or(ChatError::ProjectionLimitExceeded)?;
    if next > MAX_COMMAND_LIVE_OUTPUT_BYTES {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    live.text.push_str(&delta.text);
    if delta.truncated {
        live.truncated = true;
        live.truncation_reason = delta.truncation_reason;
    }
    command.last_source = source.clone();
    item.source_event_id = source.event_id;
    item.source_sequence = source.sequence;
    item.source_occurred_at.clone_from(&source.occurred_at);
    Ok(TimelineDelta::CommandOutputAppend {
        source: source.clone(),
        item_id: item_id.to_owned(),
        item_ordinal: item.item_ordinal,
        delta,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn command_completed(
    items: &mut Vec<TimelineItem>,
    item_id: String,
    source: &SourceIdentity,
    status: HostCommandStatus,
    command_summary: HostSafeText,
    cwd: HostCommandCwd,
    duration_ms: Option<u64>,
    exit_code: Option<i32>,
    output: HostCommandOutput,
    error: Option<HostProjectionError<HostCommandErrorCode>>,
    observed_at_ms: i64,
) -> Result<TimelineDelta, ChatError> {
    let index = item_index_or_create(items, &item_id, source, observed_at_ms, "command")?;
    let item = &mut items[index];
    if item.status != TimelineItemStatus::InProgress || item.item_type != "command" {
        return Err(ChatError::OrchestrationUnavailable);
    }
    let started_source = match item.execution.as_ref() {
        Some(ExecutionProjection::Command(command)) => command.started_source.clone(),
        None => source.clone(),
        _ => return Err(ChatError::OrchestrationUnavailable),
    };
    let live_output = match item.execution.take() {
        Some(ExecutionProjection::Command(command)) => command.live_output,
        None => None,
        _ => return Err(ChatError::OrchestrationUnavailable),
    };
    item.execution = Some(ExecutionProjection::Command(CommandProjection {
        status: status.into(),
        started_source,
        last_source: source.clone(),
        command_summary: command_summary.into(),
        cwd: cwd.into(),
        live_output,
        output: Some(output.into()),
        duration_ms,
        exit_code,
        error: error.map(command_error),
    }));
    complete_item(item, source, observed_at_ms);
    Ok(TimelineDelta::CommandCompleted(item.clone()))
}

pub(crate) fn tool_started(
    items: &mut Vec<TimelineItem>,
    item_id: String,
    source: &SourceIdentity,
    identity: HostToolIdentity,
    arguments_summary: HostSafeText,
    observed_at_ms: i64,
) -> Result<TimelineDelta, ChatError> {
    ensure_new_item(items, &item_id)?;
    let execution = ExecutionProjection::Tool(ToolProjection {
        status: ToolStatus::InProgress,
        started_source: source.clone(),
        last_source: source.clone(),
        identity: identity.into(),
        arguments_summary: arguments_summary.into(),
        progress: Vec::new(),
        duration_ms: None,
        result_summary: None,
        error: None,
    });
    let item = execution_item(
        items,
        item_id,
        "tool",
        execution,
        source,
        observed_at_ms,
        false,
    )?;
    Ok(TimelineDelta::ToolStarted(item))
}

pub(crate) fn tool_progress(
    items: &mut [TimelineItem],
    item_id: &str,
    source: &SourceIdentity,
    identity: HostToolIdentity,
    progress_index: usize,
    summary: HostSafeText,
) -> Result<TimelineDelta, ChatError> {
    let item = items
        .iter_mut()
        .find(|item| item.item_id == item_id)
        .ok_or(ChatError::OrchestrationUnavailable)?;
    let ExecutionProjection::Tool(tool) = item
        .execution
        .as_mut()
        .ok_or(ChatError::OrchestrationUnavailable)?
    else {
        return Err(ChatError::OrchestrationUnavailable);
    };
    if tool.status != ToolStatus::InProgress
        || tool.identity != ToolIdentityProjection::from(identity)
        || progress_index != tool.progress.len()
        || progress_index >= MAX_TOOL_PROGRESS_ITEMS
    {
        return Err(ChatError::OrchestrationUnavailable);
    }
    let summary: SafeTextProjection = summary.into();
    let total = tool
        .progress
        .iter()
        .try_fold(summary.text.len(), |total, progress| {
            total.checked_add(progress.summary.text.len())
        })
        .ok_or(ChatError::ProjectionLimitExceeded)?;
    if total > MAX_TOOL_PROGRESS_TOTAL_BYTES {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    let progress = ToolProgressProjection {
        source: source.clone(),
        progress_index,
        summary,
    };
    tool.progress.push(progress.clone());
    tool.last_source = source.clone();
    item.source_event_id = source.event_id;
    item.source_sequence = source.sequence;
    item.source_occurred_at.clone_from(&source.occurred_at);
    Ok(TimelineDelta::ToolProgress {
        item_id: item_id.to_owned(),
        item_ordinal: item.item_ordinal,
        progress,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn tool_completed(
    items: &mut Vec<TimelineItem>,
    item_id: String,
    source: &SourceIdentity,
    status: HostToolStatus,
    identity: HostToolIdentity,
    arguments_summary: HostSafeText,
    duration_ms: Option<u64>,
    result_summary: Option<HostSafeText>,
    error: Option<HostProjectionError<HostToolErrorCode>>,
    observed_at_ms: i64,
) -> Result<TimelineDelta, ChatError> {
    let index = item_index_or_create(items, &item_id, source, observed_at_ms, "tool")?;
    let item = &mut items[index];
    if item.status != TimelineItemStatus::InProgress || item.item_type != "tool" {
        return Err(ChatError::OrchestrationUnavailable);
    }
    let (started_source, progress) = match item.execution.take() {
        Some(ExecutionProjection::Tool(tool)) => (tool.started_source, tool.progress),
        None => (source.clone(), Vec::new()),
        _ => return Err(ChatError::OrchestrationUnavailable),
    };
    item.execution = Some(ExecutionProjection::Tool(ToolProjection {
        status: status.into(),
        started_source,
        last_source: source.clone(),
        identity: identity.into(),
        arguments_summary: arguments_summary.into(),
        progress,
        duration_ms,
        result_summary: result_summary.map(Into::into),
        error: error.map(tool_error),
    }));
    complete_item(item, source, observed_at_ms);
    Ok(TimelineDelta::ToolCompleted(item.clone()))
}

pub(crate) fn mark_incomplete(item: &mut TimelineItem) {
    match item.execution.as_mut() {
        Some(ExecutionProjection::Command(command)) if command.status == CommandStatus::Running => {
            command.status = CommandStatus::Incomplete;
        }
        Some(ExecutionProjection::Tool(tool)) if tool.status == ToolStatus::InProgress => {
            tool.status = ToolStatus::Incomplete;
        }
        _ => {}
    }
}

fn ensure_new_item(items: &[TimelineItem], item_id: &str) -> Result<(), ChatError> {
    if items.len() >= MAX_TIMELINE_ITEMS {
        return Err(ChatError::ProjectionLimitExceeded);
    }
    if items.iter().any(|item| item.item_id == item_id) {
        return Err(ChatError::OrchestrationUnavailable);
    }
    Ok(())
}

fn execution_item(
    items: &mut Vec<TimelineItem>,
    item_id: String,
    item_type: &str,
    execution: ExecutionProjection,
    source: &SourceIdentity,
    observed_at_ms: i64,
    completed: bool,
) -> Result<TimelineItem, ChatError> {
    let item_ordinal = items
        .len()
        .checked_add(1)
        .ok_or(ChatError::ProjectionLimitExceeded)?;
    let item = TimelineItem {
        item_id,
        item_ordinal,
        item_type: item_type.to_owned(),
        phase: None,
        status: if completed {
            TimelineItemStatus::Completed
        } else {
            TimelineItemStatus::InProgress
        },
        text: String::new(),
        reasoning_status: None,
        reasoning_reason_code: None,
        reasoning_parts: Vec::new(),
        reasoning_finalized_at_ms: None,
        execution: Some(execution),
        started_at_ms: observed_at_ms,
        completed_at_ms: completed.then_some(observed_at_ms),
        source_event_id: source.event_id,
        source_sequence: source.sequence,
        source_occurred_at: source.occurred_at.clone(),
    };
    items.push(item.clone());
    Ok(item)
}

fn item_index_or_create(
    items: &mut Vec<TimelineItem>,
    item_id: &str,
    source: &SourceIdentity,
    observed_at_ms: i64,
    item_type: &str,
) -> Result<usize, ChatError> {
    if let Some(index) = items.iter().position(|item| item.item_id == item_id) {
        return Ok(index);
    }
    ensure_new_item(items, item_id)?;
    let item_ordinal = items.len() + 1;
    items.push(TimelineItem {
        item_id: item_id.to_owned(),
        item_ordinal,
        item_type: item_type.to_owned(),
        phase: None,
        status: TimelineItemStatus::InProgress,
        text: String::new(),
        reasoning_status: None,
        reasoning_reason_code: None,
        reasoning_parts: Vec::new(),
        reasoning_finalized_at_ms: None,
        execution: None,
        started_at_ms: observed_at_ms,
        completed_at_ms: None,
        source_event_id: source.event_id,
        source_sequence: source.sequence,
        source_occurred_at: source.occurred_at.clone(),
    });
    Ok(item_ordinal - 1)
}

fn complete_item(item: &mut TimelineItem, source: &SourceIdentity, observed_at_ms: i64) {
    item.status = TimelineItemStatus::Completed;
    item.completed_at_ms = Some(observed_at_ms);
    item.source_event_id = source.event_id;
    item.source_sequence = source.sequence;
    item.source_occurred_at.clone_from(&source.occurred_at);
}

fn command_error(value: HostProjectionError<HostCommandErrorCode>) -> ProjectionError {
    ProjectionError {
        code: match value.code {
            HostCommandErrorCode::CommandFailed => ProjectionErrorCode::CommandFailed,
            HostCommandErrorCode::CommandDeclined => ProjectionErrorCode::CommandDeclined,
            HostCommandErrorCode::ProjectionLimitExceeded => {
                ProjectionErrorCode::ProjectionLimitExceeded
            }
            HostCommandErrorCode::ProjectionRedactionFailed => {
                ProjectionErrorCode::ProjectionRedactionFailed
            }
            HostCommandErrorCode::ProtocolError => ProjectionErrorCode::ProtocolError,
        },
        summary: value.summary,
    }
}

fn tool_error(value: HostProjectionError<HostToolErrorCode>) -> ProjectionError {
    ProjectionError {
        code: match value.code {
            HostToolErrorCode::ToolFailed => ProjectionErrorCode::ToolFailed,
            HostToolErrorCode::ToolDeclined => ProjectionErrorCode::ToolDeclined,
            HostToolErrorCode::UnknownTool => ProjectionErrorCode::UnknownTool,
            HostToolErrorCode::ProjectionLimitExceeded => {
                ProjectionErrorCode::ProjectionLimitExceeded
            }
            HostToolErrorCode::ProjectionRedactionFailed => {
                ProjectionErrorCode::ProjectionRedactionFailed
            }
            HostToolErrorCode::ProtocolError => ProjectionErrorCode::ProtocolError,
        },
        summary: value.summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn source(sequence: u64) -> SourceIdentity {
        SourceIdentity {
            event_id: Uuid::now_v7(),
            sequence,
            occurred_at: format!("2026-08-29T00:00:{sequence:02}Z"),
        }
    }

    fn safe(text: &str) -> HostSafeText {
        HostSafeText {
            text: text.to_owned(),
            truncated: false,
            truncation_reason: None,
        }
    }

    #[test]
    fn feat136_same_text_with_distinct_event_ids_is_retained_and_completed_is_authoritative() {
        let mut items = Vec::new();
        let started = source(1);
        command_started(
            &mut items,
            "command-1".to_owned(),
            &started,
            safe("initial command"),
            HostCommandCwd::WorkspaceRoot,
            1,
        )
        .unwrap();

        let first_delta = source(2);
        let second_delta = source(3);
        assert_ne!(first_delta.event_id, second_delta.event_id);
        command_output_delta(&mut items, "command-1", &first_delta, safe("same")).unwrap();
        command_output_delta(&mut items, "command-1", &second_delta, safe("same")).unwrap();

        let completed = source(4);
        command_completed(
            &mut items,
            "command-1".to_owned(),
            &completed,
            HostCommandStatus::Completed,
            safe("authoritative command"),
            HostCommandCwd::Redacted,
            Some(7),
            Some(0),
            HostCommandOutput::Complete {
                text: "authoritative output".to_owned(),
            },
            None,
            4,
        )
        .unwrap();

        let Some(ExecutionProjection::Command(command)) = items[0].execution.as_ref() else {
            panic!("command projection expected");
        };
        assert_eq!(command.status, CommandStatus::Completed);
        assert_eq!(command.started_source, started);
        assert_eq!(command.last_source, completed);
        assert_eq!(command.command_summary.text, "authoritative command");
        assert_eq!(command.cwd, CommandCwdProjection::Redacted);
        assert_eq!(command.live_output.as_ref().unwrap().text, "samesame");
        assert_eq!(
            command.output,
            Some(CommandOutputProjection::Complete {
                text: "authoritative output".to_owned()
            })
        );
    }

    #[test]
    fn feat136_unknown_tool_completed_snapshot_is_fail_soft_without_started_event() {
        let mut items = Vec::new();
        let completed = source(1);
        tool_completed(
            &mut items,
            "tool-unknown".to_owned(),
            &completed,
            HostToolStatus::Failed,
            HostToolIdentity::Unknown,
            safe("bounded arguments"),
            Some(1),
            None,
            Some(HostProjectionError {
                code: HostToolErrorCode::UnknownTool,
                summary: "unsupported tool".to_owned(),
            }),
            1,
        )
        .unwrap();

        let Some(ExecutionProjection::Tool(tool)) = items[0].execution.as_ref() else {
            panic!("tool projection expected");
        };
        assert_eq!(tool.status, ToolStatus::Failed);
        assert_eq!(tool.identity, ToolIdentityProjection::Unknown);
        assert_eq!(tool.started_source, completed);
        assert_eq!(tool.last_source, completed);
        assert_eq!(
            tool.error.as_ref().map(|error| error.code),
            Some(ProjectionErrorCode::UnknownTool)
        );
    }
}
