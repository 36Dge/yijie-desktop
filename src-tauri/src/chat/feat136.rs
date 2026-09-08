use super::feat134::SourceIdentity;
use super::host_domain::{
    HostCommandCwd, HostCommandOutput, HostCommandStatus, HostSafeText, HostToolIdentity,
    HostToolStatus, HostTruncationReason,
};
use std::fmt::{Debug, Formatter};

pub const FEAT136_FLAG: &str = "YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED";
pub const SOURCE_SCHEMA_VERSION: u8 = 5;

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
