// Generated from scheduled execution source; DO NOT EDIT.
use serde::{Deserialize, Serialize};

// Optional in this source means omitted, never explicit JSON null.
fn optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub type Identity = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleCapability {
    #[serde(rename = "schedule.read")]
    ScheduleRead,
    #[serde(rename = "schedule.manage")]
    ScheduleManage,
    #[serde(rename = "schedule.run")]
    ScheduleRun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkspaceSource {
    #[serde(rename = "user_project")]
    UserProject,
    #[serde(rename = "managed_schedule")]
    ManagedSchedule,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceReference {
    pub source: WorkspaceSource,
    pub resource_id: Identity,
}
impl std::fmt::Debug for WorkspaceReference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WorkspaceReference([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionErrorCode {
    #[serde(rename = "invalid_input")]
    InvalidInput,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "scope_denied")]
    ScopeDenied,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "target_unavailable")]
    TargetUnavailable,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "grant_missing")]
    GrantMissing,
    #[serde(rename = "grant_expired")]
    GrantExpired,
    #[serde(rename = "grant_exhausted")]
    GrantExhausted,
    #[serde(rename = "grant_stale")]
    GrantStale,
    #[serde(rename = "reservation_busy")]
    ReservationBusy,
    #[serde(rename = "storage_disabled")]
    StorageDisabled,
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "format_unsupported")]
    FormatUnsupported,
    #[serde(rename = "execution_not_ready")]
    ExecutionNotReady,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GrantState {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "stale")]
    Stale,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "exhausted")]
    Exhausted,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantConfirmation {
    pub request_id: Identity,
    pub plan_id: Identity,
    pub expected_revision: i64,
    pub max_runs: i64,
    pub expires_at: i64,
}
impl std::fmt::Debug for GrantConfirmation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantConfirmation([redacted])")
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantView {
    pub grant_id: Identity,
    pub plan_id: Identity,
    pub plan_revision: i64,
    pub authorization_revision: i64,
    pub definition_digest: String,
    pub workspace: WorkspaceReference,
    pub max_runs: i64,
    pub occupied_runs: i64,
    pub expires_at: i64,
    pub state: GrantState,
}
impl std::fmt::Debug for GrantView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantView([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunTrigger {
    #[serde(rename = "automatic")]
    Automatic,
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "rerun")]
    Rerun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeliveryState {
    #[serde(rename = "reserved")]
    Reserved,
    #[serde(rename = "sending")]
    Sending,
    #[serde(rename = "accepted")]
    Accepted,
    #[serde(rename = "uncertain")]
    Uncertain,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeOutcome {
    #[serde(rename = "unobserved")]
    Unobserved,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "interrupted")]
    Interrupted,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunView {
    pub run_id: Identity,
    pub plan_id: Identity,
    pub plan_revision: i64,
    pub schedule_epoch: i64,
    pub request_id: Identity,
    pub operation_id: Identity,
    pub trigger: RunTrigger,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub original_run_id: Option<Identity>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub logical_slot: Option<String>,
    pub grant_id: Identity,
    pub snapshot_digest: String,
    pub workspace: WorkspaceReference,
    pub permission_mode: RunViewPermissionMode,
    pub delivery_state: DeliveryState,
    pub native_outcome: NativeOutcome,
    pub needs_attention: bool,
}
impl std::fmt::Debug for RunView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunView([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunViewPermissionMode {
    #[serde(rename = "ask")]
    Ask,
}
