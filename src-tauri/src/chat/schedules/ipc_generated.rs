// Generated from scheduled-task-ipc-v1.schema.json and pinned shared references. DO NOT EDIT.
use super::{draft_generated as draft, execution_generated as execution, generated as plan};
use serde::{Deserialize, Serialize};
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}
impl std::fmt::Debug for Empty {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Empty([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterState {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "enabled")]
    Enabled,
    #[serde(rename = "paused")]
    Paused,
    #[serde(rename = "completed")]
    Completed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanOrder {
    #[serde(rename = "name_asc")]
    NameAsc,
    #[serde(rename = "name_desc")]
    NameDesc,
    #[serde(rename = "next_asc")]
    NextAsc,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PauseReason {
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "budget")]
    Budget,
    #[serde(rename = "authorization")]
    Authorization,
    #[serde(rename = "target")]
    Target,
    #[serde(rename = "permission")]
    Permission,
    #[serde(rename = "resource")]
    Resource,
    #[serde(rename = "confirmation")]
    Confirmation,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrivateErrorCode {
    #[serde(rename = "context_invalid")]
    ContextInvalid,
    #[serde(rename = "cursor_invalid")]
    CursorInvalid,
    #[serde(rename = "protocol_mismatch")]
    ProtocolMismatch,
    #[serde(rename = "operation_unknown")]
    OperationUnknown,
    #[serde(rename = "storage_read_only")]
    StorageReadOnly,
    #[serde(rename = "draft_unavailable")]
    DraftUnavailable,
    #[serde(rename = "draft_source_invalid")]
    DraftSourceInvalid,
    #[serde(rename = "draft_source_deleted")]
    DraftSourceDeleted,
    #[serde(rename = "draft_not_candidate")]
    DraftNotCandidate,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IpcErrorCode {
    Variant0(execution::ExecutionErrorCode),
    Variant1(PrivateErrorCode),
}
impl std::fmt::Debug for IpcErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("IpcErrorCode([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(
        rename = "requestId",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub request_id: Option<plan::Identity>,
    #[serde(rename = "code")]
    pub code: IpcErrorCode,
}
impl std::fmt::Debug for ErrorResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ErrorResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Availability {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "readable")]
    pub readable: bool,
    #[serde(rename = "writable")]
    pub writable: bool,
    #[serde(rename = "preparation_enabled")]
    pub preparation_enabled: bool,
    #[serde(rename = "dispatch")]
    pub dispatch: AvailabilityDispatch,
    #[serde(rename = "platform_qualified")]
    pub platform_qualified: bool,
}
impl std::fmt::Debug for Availability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Availability([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanQuery {
    #[serde(
        rename = "limit",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub limit: Option<i64>,
    #[serde(
        rename = "cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub cursor: Option<plan::Identity>,
    #[serde(
        rename = "search",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub search: Option<String>,
    #[serde(
        rename = "state",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub state: Option<FilterState>,
    #[serde(
        rename = "include_deleted",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub include_deleted: Option<bool>,
    #[serde(
        rename = "order",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub order: Option<PlanOrder>,
}
impl std::fmt::Debug for PlanQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetQuery {
    #[serde(
        rename = "limit",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub limit: Option<i64>,
    #[serde(
        rename = "cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub cursor: Option<plan::Identity>,
    #[serde(
        rename = "search",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub search: Option<String>,
}
impl std::fmt::Debug for TargetQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TargetQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordQuery {
    #[serde(
        rename = "limit",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub limit: Option<i64>,
    #[serde(
        rename = "cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub cursor: Option<plan::Identity>,
    #[serde(
        rename = "plan_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub plan_id: Option<plan::Identity>,
    #[serde(
        rename = "state",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub state: Option<FilterState>,
}
impl std::fmt::Debug for RecordQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanKey {
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
}
impl std::fmt::Debug for PlanKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanMutation {
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "expected_revision")]
    pub expected_revision: i64,
}
impl std::fmt::Debug for PlanMutation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanMutation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeQuery {
    #[serde(rename = "rule")]
    pub rule: plan::TimeRule,
}
impl std::fmt::Debug for TimeQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TimeQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunKey {
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "run_id")]
    pub run_id: plan::Identity,
}
impl std::fmt::Debug for RunKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceKey {
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "schedule_epoch")]
    pub schedule_epoch: i64,
    #[serde(rename = "logical_slot")]
    pub logical_slot: String,
}
impl std::fmt::Debug for OccurrenceKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OccurrenceKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RecordKey {
    Variant0(Box<RunKey>),
    Variant1(Box<OccurrenceKey>),
}
impl std::fmt::Debug for RecordKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerunInput {
    #[serde(rename = "original_run_id")]
    pub original_run_id: plan::Identity,
}
impl std::fmt::Debug for RerunInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RerunInput([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerunConfirmation {
    #[serde(rename = "original_run_id")]
    pub original_run_id: plan::Identity,
    #[serde(rename = "original_snapshot_digest")]
    pub original_snapshot_digest: String,
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "revision")]
    pub revision: i64,
    #[serde(rename = "definition_digest")]
    pub definition_digest: String,
    #[serde(rename = "grant_id")]
    pub grant_id: plan::Identity,
}
impl std::fmt::Debug for RerunConfirmation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RerunConfirmation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualInput {
    #[serde(rename = "grant_id")]
    pub grant_id: plan::Identity,
    #[serde(rename = "revision")]
    pub revision: i64,
}
impl std::fmt::Debug for ManualInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ManualInput([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanSummary {
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "revision")]
    pub revision: i64,
    #[serde(rename = "raw_state")]
    pub raw_state: plan::PlanState,
    #[serde(rename = "effective_state")]
    pub effective_state: plan::PlanState,
    #[serde(
        rename = "pause_reason",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub pause_reason: Option<PauseReason>,
    #[serde(rename = "target_mode")]
    pub target_mode: plan::TargetMode,
    #[serde(rename = "target_state")]
    pub target_state: plan::TargetState,
    #[serde(
        rename = "next_at",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_at: Option<i64>,
}
impl std::fmt::Debug for PlanSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanSummary([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanDetail {
    #[serde(rename = "plan")]
    pub plan: plan::PlanView,
    #[serde(rename = "summary")]
    pub summary: PlanSummary,
    #[serde(
        rename = "grant",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub grant: Option<execution::GrantView>,
}
impl std::fmt::Debug for PlanDetail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanDetail([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnableResult {
    #[serde(rename = "plan")]
    pub plan: plan::PlanView,
    #[serde(rename = "grant")]
    pub grant: execution::GrantView,
    #[serde(
        rename = "future_hold",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub future_hold: Option<PauseReason>,
    #[serde(rename = "automatic_consent")]
    pub automatic_consent: bool,
}
impl std::fmt::Debug for EnableResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EnableResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerunPreview {
    #[serde(rename = "confirmation")]
    pub confirmation: RerunReview,
    #[serde(rename = "original")]
    pub original: plan::PlanDefinition,
    #[serde(rename = "current")]
    pub current: plan::PlanDefinition,
}
impl std::fmt::Debug for RerunPreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RerunPreview([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetSummary {
    #[serde(rename = "conversation_id")]
    pub conversation_id: plan::Identity,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "updated_at")]
    pub updated_at: i64,
    #[serde(rename = "workspace_source")]
    pub workspace_source: execution::WorkspaceSource,
    #[serde(rename = "can_save")]
    pub can_save: bool,
    #[serde(rename = "execution")]
    pub execution: TargetSummaryExecution,
    #[serde(
        rename = "reason",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub reason: Option<TargetSummaryReason>,
}
impl std::fmt::Debug for TargetSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TargetSummary([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Disposition {
    #[serde(rename = "consumed")]
    Consumed,
    #[serde(rename = "skipped_paused")]
    SkippedPaused,
    #[serde(rename = "missed_offline")]
    MissedOffline,
    #[serde(rename = "clock_discontinuity")]
    ClockDiscontinuity,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "missed_late")]
    MissedLate,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "target_unavailable")]
    TargetUnavailable,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "resource_unavailable")]
    ResourceUnavailable,
    #[serde(rename = "unauthorized")]
    Unauthorized,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    #[serde(rename = "key")]
    pub key: OccurrenceKey,
    #[serde(rename = "scheduled_at")]
    pub scheduled_at: i64,
    #[serde(rename = "disposition")]
    pub disposition: Disposition,
    #[serde(
        rename = "missed_through",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub missed_through: Option<i64>,
}
impl std::fmt::Debug for Occurrence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Occurrence([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationLink {
    #[serde(rename = "status")]
    pub status: ConversationLinkStatus,
    #[serde(
        rename = "conversation_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub conversation_id: Option<plan::Identity>,
    #[serde(
        rename = "local_turn_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub local_turn_id: Option<plan::Identity>,
}
impl std::fmt::Debug for ConversationLink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConversationLink([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    #[serde(rename = "execution_time")]
    pub execution_time: TimingExecutionTime,
    #[serde(rename = "duration")]
    pub duration: TimingDuration,
    #[serde(rename = "source")]
    pub source: TimingSource,
    #[serde(
        rename = "started_at",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub started_at: Option<i64>,
    #[serde(
        rename = "completed_at",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub completed_at: Option<i64>,
    #[serde(
        rename = "duration_ms",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub duration_ms: Option<i64>,
    #[serde(
        rename = "time_zone",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub time_zone: Option<String>,
    #[serde(
        rename = "diagnostic",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub diagnostic: Option<TimingDiagnostic>,
}
impl std::fmt::Debug for Timing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Timing([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRecord {
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "key")]
    pub key: RunKey,
    #[serde(rename = "plan")]
    pub plan: PlanSummary,
    #[serde(rename = "run")]
    pub run: execution::RunView,
    #[serde(
        rename = "occurrence",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub occurrence: Option<Occurrence>,
    #[serde(rename = "conversation")]
    pub conversation: ConversationLink,
    #[serde(rename = "timing")]
    pub timing: Timing,
    #[serde(rename = "attention")]
    pub attention: RunRecordAttention,
    #[serde(rename = "business_result")]
    pub business_result: String,
}
impl std::fmt::Debug for RunRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunRecord([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceRecord {
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "key")]
    pub key: OccurrenceKey,
    #[serde(rename = "plan")]
    pub plan: PlanSummary,
    #[serde(rename = "occurrence")]
    pub occurrence: Occurrence,
    #[serde(rename = "timing")]
    pub timing: Timing,
}
impl std::fmt::Debug for OccurrenceRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OccurrenceRecord([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RecordView {
    Variant0(Box<RunRecord>),
    Variant1(Box<OccurrenceRecord>),
}
impl std::fmt::Debug for RecordView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordView([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedConfiguration {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "content")]
    pub content: String,
    #[serde(rename = "rule")]
    pub rule: plan::TimeRule,
    #[serde(rename = "target_mode")]
    pub target_mode: plan::TargetMode,
}
impl std::fmt::Debug for SavedConfiguration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SavedConfiguration([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordDetail {
    #[serde(rename = "record")]
    pub record: RecordView,
    #[serde(
        rename = "configuration",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub configuration: Option<SavedConfiguration>,
}
impl std::fmt::Debug for RecordDetail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordDetail([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanPage {
    #[serde(rename = "items")]
    pub items: Vec<PlanSummary>,
    #[serde(
        rename = "next_cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_cursor: Option<plan::Identity>,
}
impl std::fmt::Debug for PlanPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanPage([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetPage {
    #[serde(rename = "items")]
    pub items: Vec<TargetSummary>,
    #[serde(
        rename = "next_cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_cursor: Option<plan::Identity>,
}
impl std::fmt::Debug for TargetPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TargetPage([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordPage {
    #[serde(rename = "items")]
    pub items: Vec<RecordView>,
    #[serde(
        rename = "next_cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_cursor: Option<plan::Identity>,
}
impl std::fmt::Debug for RecordPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordPage([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvailabilityRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: Empty,
}
impl std::fmt::Debug for AvailabilityRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AvailabilityRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvailabilityResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: Availability,
}
impl std::fmt::Debug for AvailabilityResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AvailabilityResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListPlansRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanQuery,
}
impl std::fmt::Debug for ListPlansRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListPlansRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListPlansResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: PlanPage,
}
impl std::fmt::Debug for ListPlansResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListPlansResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GetPlanRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanKey,
}
impl std::fmt::Debug for GetPlanRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GetPlanRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GetPlanResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: PlanDetail,
}
impl std::fmt::Debug for GetPlanResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GetPlanResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewTimeRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: TimeQuery,
}
impl std::fmt::Debug for PreviewTimeRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewTimeRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewTimeResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: plan::TimePreview,
}
impl std::fmt::Debug for PreviewTimeResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewTimeResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListTargetsRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: TargetQuery,
}
impl std::fmt::Debug for ListTargetsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListTargetsRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListTargetsResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: TargetPage,
}
impl std::fmt::Debug for ListTargetsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListTargetsResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRecordsRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: RecordQuery,
}
impl std::fmt::Debug for ListRecordsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListRecordsRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRecordsResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: RecordPage,
}
impl std::fmt::Debug for ListRecordsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListRecordsResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GetRecordRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: RecordKey,
}
impl std::fmt::Debug for GetRecordRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GetRecordRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GetRecordResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: RecordDetail,
}
impl std::fmt::Debug for GetRecordResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GetRecordResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePlanRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: plan::SavePlanRequest,
}
impl std::fmt::Debug for SavePlanRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SavePlanRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePlanResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: plan::PlanView,
}
impl std::fmt::Debug for SavePlanResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SavePlanResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PausePlanRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanMutation,
}
impl std::fmt::Debug for PausePlanRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PausePlanRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PausePlanResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: plan::PlanView,
}
impl std::fmt::Debug for PausePlanResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PausePlanResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeletePlanRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanMutation,
}
impl std::fmt::Debug for DeletePlanRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeletePlanRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeletePlanResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: plan::PlanView,
}
impl std::fmt::Debug for DeletePlanResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeletePlanResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmGrantRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: execution::GrantConfirmation,
}
impl std::fmt::Debug for ConfirmGrantRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmGrantRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmGrantResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: execution::GrantView,
}
impl std::fmt::Debug for ConfirmGrantResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmGrantResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmEnableRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: EnableConfirmation,
}
impl std::fmt::Debug for ConfirmEnableRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmEnableRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmEnableResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: EnableResult,
}
impl std::fmt::Debug for ConfirmEnableResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmEnableResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualRunRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: ManualInput,
}
impl std::fmt::Debug for ManualRunRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ManualRunRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualRunResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: execution::RunView,
}
impl std::fmt::Debug for ManualRunResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ManualRunResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRerunRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: RerunInput,
}
impl std::fmt::Debug for PreviewRerunRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewRerunRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRerunResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: RerunPreview,
}
impl std::fmt::Debug for PreviewRerunResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewRerunResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmRerunRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: RerunConfirmation,
}
impl std::fmt::Debug for ConfirmRerunRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmRerunRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmRerunResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: execution::RunView,
}
impl std::fmt::Debug for ConfirmRerunResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmRerunResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSubmit {
    #[serde(rename = "text")]
    pub text: draft::Text,
    #[serde(
        rename = "conversation_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub conversation_id: Option<plan::Identity>,
}
impl std::fmt::Debug for DraftSubmit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmit([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftKey {
    #[serde(rename = "source_id")]
    pub source_id: plan::Identity,
}
impl std::fmt::Debug for DraftKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftReceipt {
    #[serde(rename = "source_id")]
    pub source_id: plan::Identity,
    #[serde(rename = "conversation_id")]
    pub conversation_id: plan::Identity,
    #[serde(rename = "local_turn_id")]
    pub local_turn_id: plan::Identity,
    #[serde(rename = "operation_id")]
    pub operation_id: plan::Identity,
    #[serde(rename = "status")]
    pub status: String,
}
impl std::fmt::Debug for DraftReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftPreview {
    #[serde(rename = "source_id")]
    pub source_id: plan::Identity,
    #[serde(rename = "status")]
    pub status: DraftPreviewStatus,
    #[serde(
        rename = "source_digest",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub source_digest: Option<String>,
    #[serde(
        rename = "output",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub output: Option<draft::Output>,
    #[serde(
        rename = "plan_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub plan_id: Option<plan::Identity>,
}
impl std::fmt::Debug for DraftPreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftPreview([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftConfirmation {
    #[serde(rename = "source_id")]
    pub source_id: plan::Identity,
    #[serde(rename = "source_digest")]
    pub source_digest: String,
    #[serde(rename = "definition")]
    pub definition: plan::PlanDefinition,
}
impl std::fmt::Debug for DraftConfirmation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftConfirmation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmitDraftRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftSubmit,
}
impl std::fmt::Debug for SubmitDraftRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitDraftRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmitDraftResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: DraftReceipt,
}
impl std::fmt::Debug for SubmitDraftResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitDraftResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewDraftRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftKey,
}
impl std::fmt::Debug for PreviewDraftRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewDraftRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewDraftResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: DraftPreview,
}
impl std::fmt::Debug for PreviewDraftResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PreviewDraftResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmDraftRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftConfirmation,
}
impl std::fmt::Debug for ConfirmDraftRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmDraftRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmDraftResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: plan::PlanView,
}
impl std::fmt::Debug for ConfirmDraftResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmDraftResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSourceQuery {
    #[serde(rename = "conversation_id")]
    pub conversation_id: plan::Identity,
    #[serde(rename = "local_turn_id")]
    pub local_turn_id: plan::Identity,
}
impl std::fmt::Debug for DraftSourceQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSourceQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSourceLookup {
    #[serde(rename = "found")]
    pub found: bool,
    #[serde(
        rename = "source",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub source: Option<DraftReceipt>,
}
impl std::fmt::Debug for DraftSourceLookup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSourceLookup([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationCapability {
    #[serde(rename = "available")]
    pub available: bool,
    #[serde(rename = "reason")]
    pub reason: OperationCapabilityReason,
}
impl std::fmt::Debug for OperationCapability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationCapability([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationCapabilities {
    #[serde(rename = "read")]
    pub read: OperationCapability,
    #[serde(rename = "save")]
    pub save: OperationCapability,
    #[serde(rename = "manual")]
    pub manual: OperationCapability,
    #[serde(rename = "automatic")]
    pub automatic: OperationCapability,
    #[serde(rename = "draft")]
    pub draft: OperationCapability,
    #[serde(rename = "single_run")]
    pub single_run: OperationCapability,
}
impl std::fmt::Debug for OperationCapabilities {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationCapabilities([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FindDraftSourceRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftSourceQuery,
}
impl std::fmt::Debug for FindDraftSourceRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FindDraftSourceRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FindDraftSourceResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: DraftSourceLookup,
}
impl std::fmt::Debug for FindDraftSourceResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FindDraftSourceResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationCapabilitiesRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: Empty,
}
impl std::fmt::Debug for OperationCapabilitiesRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationCapabilitiesRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationCapabilitiesResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: OperationCapabilities,
}
impl std::fmt::Debug for OperationCapabilitiesResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationCapabilitiesResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContinueDraftSourceRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftKey,
}
impl std::fmt::Debug for ContinueDraftSourceRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ContinueDraftSourceRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContinueDraftSourceResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: DraftReceipt,
}
impl std::fmt::Debug for ContinueDraftSourceResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ContinueDraftSourceResponse([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanCardOrder {
    #[serde(rename = "created_desc")]
    CreatedDesc,
    #[serde(rename = "created_asc")]
    CreatedAsc,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanCardQuery {
    #[serde(
        rename = "limit",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub limit: Option<i64>,
    #[serde(
        rename = "cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub cursor: Option<plan::Identity>,
    #[serde(
        rename = "search",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub search: Option<String>,
    #[serde(
        rename = "state",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub state: Option<FilterState>,
    #[serde(
        rename = "include_deleted",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub include_deleted: Option<bool>,
    #[serde(
        rename = "order",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub order: Option<PlanCardOrder>,
}
impl std::fmt::Debug for PlanCardQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanCardQuery([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanCard {
    #[serde(rename = "summary")]
    pub summary: PlanSummary,
    #[serde(rename = "content_preview")]
    pub content_preview: String,
    #[serde(rename = "rule")]
    pub rule: plan::TimeRule,
    #[serde(
        rename = "created_at",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub created_at: Option<i64>,
    #[serde(
        rename = "target_title",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub target_title: Option<String>,
}
impl std::fmt::Debug for PlanCard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanCard([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordRowQuery {
    #[serde(
        rename = "limit",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub limit: Option<i64>,
    #[serde(
        rename = "cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub cursor: Option<plan::Identity>,
    #[serde(
        rename = "plan_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub plan_id: Option<plan::Identity>,
    #[serde(
        rename = "state",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub state: Option<FilterState>,
    #[serde(
        rename = "search",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub search: Option<String>,
}
impl std::fmt::Debug for RecordRowQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordRowQuery([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordRowSource {
    #[serde(rename = "run_snapshot")]
    RunSnapshot,
    #[serde(rename = "current_plan_reference")]
    CurrentPlanReference,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordRow {
    #[serde(rename = "record")]
    pub record: RecordView,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "content_preview")]
    pub content_preview: String,
    #[serde(rename = "source")]
    pub source: RecordRowSource,
}
impl std::fmt::Debug for RecordRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordRow([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanMutationReceiptQuery {
    #[serde(rename = "original_request_id")]
    pub original_request_id: plan::Identity,
}
impl std::fmt::Debug for PlanMutationReceiptQuery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanMutationReceiptQuery([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReceiptObservation {
    #[serde(rename = "observed")]
    Observed,
    #[serde(rename = "not_observed")]
    NotObserved,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PlanMutationReceipt {
    Variant0(Box<ObservedPlanMutationReceipt>),
    Variant1(Box<UnobservedPlanMutationReceipt>),
}
impl std::fmt::Debug for PlanMutationReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanMutationReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanCardPage {
    #[serde(rename = "items")]
    pub items: Vec<PlanCard>,
    #[serde(
        rename = "next_cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_cursor: Option<plan::Identity>,
}
impl std::fmt::Debug for PlanCardPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanCardPage([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordRowPage {
    #[serde(rename = "items")]
    pub items: Vec<RecordRow>,
    #[serde(
        rename = "next_cursor",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_cursor: Option<plan::Identity>,
}
impl std::fmt::Debug for RecordRowPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecordRowPage([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListPlanCardsRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanCardQuery,
}
impl std::fmt::Debug for ListPlanCardsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListPlanCardsRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListPlanCardsResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: PlanCardPage,
}
impl std::fmt::Debug for ListPlanCardsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListPlanCardsResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRecordRowsRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: RecordRowQuery,
}
impl std::fmt::Debug for ListRecordRowsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListRecordRowsRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRecordRowsResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: RecordRowPage,
}
impl std::fmt::Debug for ListRecordRowsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListRecordRowsResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadPlanMutationReceiptRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: PlanMutationReceiptQuery,
}
impl std::fmt::Debug for ReadPlanMutationReceiptRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadPlanMutationReceiptRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadPlanMutationReceiptResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: PlanMutationReceipt,
}
impl std::fmt::Debug for ReadPlanMutationReceiptResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadPlanMutationReceiptResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservedPlanMutationReceipt {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "current_plan")]
    pub current_plan: PlanDetail,
}
impl std::fmt::Debug for ObservedPlanMutationReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ObservedPlanMutationReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnobservedPlanMutationReceipt {
    #[serde(rename = "observation")]
    pub observation: String,
}
impl std::fmt::Debug for UnobservedPlanMutationReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UnobservedPlanMutationReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSubmissionKey {
    #[serde(rename = "original_request_id")]
    pub original_request_id: plan::Identity,
}
impl std::fmt::Debug for DraftSubmissionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmissionKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSubmissionNotObserved {
    #[serde(rename = "observation")]
    pub observation: String,
}
impl std::fmt::Debug for DraftSubmissionNotObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmissionNotObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSubmissionObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "receipt")]
    pub receipt: DraftReceipt,
}
impl std::fmt::Debug for DraftSubmissionObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmissionObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftSubmissionDeleted {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "source_id")]
    pub source_id: plan::Identity,
    #[serde(
        rename = "plan_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub plan_id: Option<plan::Identity>,
}
impl std::fmt::Debug for DraftSubmissionDeleted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmissionDeleted([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DraftSubmissionReceipt {
    Variant0(Box<DraftSubmissionNotObserved>),
    Variant1(Box<DraftSubmissionObserved>),
    Variant2(Box<DraftSubmissionDeleted>),
}
impl std::fmt::Debug for DraftSubmissionReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DraftSubmissionReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadDraftSubmissionReceiptRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: DraftSubmissionKey,
}
impl std::fmt::Debug for ReadDraftSubmissionReceiptRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadDraftSubmissionReceiptRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadDraftSubmissionReceiptResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: DraftSubmissionReceipt,
}
impl std::fmt::Debug for ReadDraftSubmissionReceiptResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadDraftSubmissionReceiptResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionReceiptKey {
    #[serde(rename = "operation")]
    pub operation: ExecutionReceiptKeyOperation,
    #[serde(rename = "original_request_id")]
    pub original_request_id: plan::Identity,
}
impl std::fmt::Debug for ExecutionReceiptKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExecutionReceiptKey([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionNotObserved {
    #[serde(rename = "observation")]
    pub observation: String,
}
impl std::fmt::Debug for ExecutionNotObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExecutionNotObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "grant")]
    pub grant: execution::GrantView,
}
impl std::fmt::Debug for GrantObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "run")]
    pub run: execution::RunView,
}
impl std::fmt::Debug for ManualObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ManualObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExecutionReceipt {
    Variant0(Box<ExecutionNotObserved>),
    Variant1(Box<GrantObserved>),
    Variant2(Box<ManualObserved>),
    Variant3(Box<EnableObserved>),
    Variant4(Box<SingleGrantObserved>),
    Variant5(Box<RerunObserved>),
}
impl std::fmt::Debug for ExecutionReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExecutionReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadExecutionReceiptRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: ExecutionReceiptKey,
}
impl std::fmt::Debug for ReadExecutionReceiptRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadExecutionReceiptRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadExecutionReceiptResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: ExecutionReceipt,
}
impl std::fmt::Debug for ReadExecutionReceiptResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReadExecutionReceiptResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnableConfirmation {
    #[serde(rename = "confirmation")]
    pub confirmation: execution::GrantConfirmation,
    #[serde(rename = "expected_next_at")]
    pub expected_next_at: i64,
}
impl std::fmt::Debug for EnableConfirmation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EnableConfirmation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnableObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "result")]
    pub result: EnableResult,
}
impl std::fmt::Debug for EnableObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EnableObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerunReview {
    #[serde(rename = "original_run_id")]
    pub original_run_id: plan::Identity,
    #[serde(rename = "original_snapshot_digest")]
    pub original_snapshot_digest: String,
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "revision")]
    pub revision: i64,
    #[serde(rename = "definition_digest")]
    pub definition_digest: String,
}
impl std::fmt::Debug for RerunReview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RerunReview([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SingleRunKind {
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "rerun")]
    Rerun,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SingleRunGrantConfirmation {
    #[serde(rename = "confirmation")]
    pub confirmation: execution::GrantConfirmation,
    #[serde(rename = "kind")]
    pub kind: SingleRunKind,
    #[serde(
        rename = "review",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub review: Option<RerunReview>,
}
impl std::fmt::Debug for SingleRunGrantConfirmation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SingleRunGrantConfirmation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SingleRunGrantResult {
    #[serde(rename = "grant")]
    pub grant: execution::GrantView,
    #[serde(rename = "kind")]
    pub kind: SingleRunKind,
    #[serde(
        rename = "original_run_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub original_run_id: Option<plan::Identity>,
}
impl std::fmt::Debug for SingleRunGrantResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SingleRunGrantResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmSingleRunRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: SingleRunGrantConfirmation,
}
impl std::fmt::Debug for ConfirmSingleRunRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmSingleRunRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmSingleRunResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: SingleRunGrantResult,
}
impl std::fmt::Debug for ConfirmSingleRunResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfirmSingleRunResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SingleGrantObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "result")]
    pub result: SingleRunGrantResult,
}
impl std::fmt::Debug for SingleGrantObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SingleGrantObserved([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RerunObserved {
    #[serde(rename = "observation")]
    pub observation: String,
    #[serde(rename = "run")]
    pub run: execution::RunView,
}
impl std::fmt::Debug for RerunObserved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RerunObserved([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportantUpdateState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "needs_attention")]
    NeedsAttention,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "interrupted")]
    Interrupted,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportantUpdate {
    #[serde(rename = "run_id")]
    pub run_id: plan::Identity,
    #[serde(rename = "plan_id")]
    pub plan_id: plan::Identity,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "state")]
    pub state: ImportantUpdateState,
}
impl std::fmt::Debug for ImportantUpdate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImportantUpdate([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportantUpdates {
    #[serde(rename = "items")]
    pub items: Vec<ImportantUpdate>,
    #[serde(rename = "truncated")]
    pub truncated: bool,
}
impl std::fmt::Debug for ImportantUpdates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImportantUpdates([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportantUpdatesRequest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "contextId")]
    pub context_id: plan::Identity,
    #[serde(rename = "payload")]
    pub payload: Empty,
}
impl std::fmt::Debug for ImportantUpdatesRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImportantUpdatesRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportantUpdatesResponse {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: plan::Identity,
    #[serde(rename = "data")]
    pub data: ImportantUpdates,
}
impl std::fmt::Debug for ImportantUpdatesResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImportantUpdatesResponse([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AvailabilityDispatch {
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "native_candidate")]
    NativeCandidate,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetSummaryExecution {
    #[serde(rename = "requires_recheck")]
    RequiresRecheck,
    #[serde(rename = "blocked")]
    Blocked,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetSummaryReason {
    #[serde(rename = "target_unavailable")]
    TargetUnavailable,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "native_identity_unavailable")]
    NativeIdentityUnavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConversationLinkStatus {
    #[serde(rename = "available")]
    Available,
    #[serde(rename = "deleted")]
    Deleted,
    #[serde(rename = "unavailable")]
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingExecutionTime {
    #[serde(rename = "not_started")]
    NotStarted,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "known")]
    Known,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingDuration {
    #[serde(rename = "not_started")]
    NotStarted,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "known")]
    Known,
    #[serde(rename = "in_progress")]
    InProgress,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingSource {
    #[serde(rename = "no_execution_clock")]
    NoExecutionClock,
    #[serde(rename = "runtime_read")]
    RuntimeRead,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingDiagnostic {
    #[serde(rename = "format_unsupported")]
    FormatUnsupported,
    #[serde(rename = "field_invalid")]
    FieldInvalid,
    #[serde(rename = "source_conflict")]
    SourceConflict,
    #[serde(rename = "history_unavailable")]
    HistoryUnavailable,
    #[serde(rename = "identity_mismatch")]
    IdentityMismatch,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunRecordAttention {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "needs_attention")]
    NeedsAttention,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DraftPreviewStatus {
    #[serde(rename = "candidate")]
    Candidate,
    #[serde(rename = "needs_clarification")]
    NeedsClarification,
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "confirmed")]
    Confirmed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationCapabilityReason {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "storage_disabled")]
    StorageDisabled,
    #[serde(rename = "storage_read_only")]
    StorageReadOnly,
    #[serde(rename = "authority_missing")]
    AuthorityMissing,
    #[serde(rename = "candidate_disabled")]
    CandidateDisabled,
    #[serde(rename = "runtime_unqualified")]
    RuntimeUnqualified,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionReceiptKeyOperation {
    #[serde(rename = "grant")]
    Grant,
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "enable")]
    Enable,
    #[serde(rename = "single_grant")]
    SingleGrant,
    #[serde(rename = "rerun")]
    Rerun,
}
pub(crate) const COMMANDS: &[(&str, &str, &str, &str, bool)] = &[
    (
        "schedule_availability_v1",
        "AvailabilityRequest",
        "AvailabilityResponse",
        "read",
        false,
    ),
    (
        "schedule_list_plans_v1",
        "ListPlansRequest",
        "ListPlansResponse",
        "read",
        false,
    ),
    (
        "schedule_get_plan_v1",
        "GetPlanRequest",
        "GetPlanResponse",
        "read",
        false,
    ),
    (
        "schedule_preview_time_v1",
        "PreviewTimeRequest",
        "PreviewTimeResponse",
        "read",
        false,
    ),
    (
        "schedule_list_targets_v1",
        "ListTargetsRequest",
        "ListTargetsResponse",
        "read",
        false,
    ),
    (
        "schedule_list_records_v1",
        "ListRecordsRequest",
        "ListRecordsResponse",
        "read",
        false,
    ),
    (
        "schedule_get_record_v1",
        "GetRecordRequest",
        "GetRecordResponse",
        "read",
        false,
    ),
    (
        "schedule_save_plan_v1",
        "SavePlanRequest",
        "SavePlanResponse",
        "manage",
        true,
    ),
    (
        "schedule_pause_plan_v1",
        "PausePlanRequest",
        "PausePlanResponse",
        "manage",
        true,
    ),
    (
        "schedule_delete_plan_v1",
        "DeletePlanRequest",
        "DeletePlanResponse",
        "manage",
        true,
    ),
    (
        "schedule_confirm_grant_v1",
        "ConfirmGrantRequest",
        "ConfirmGrantResponse",
        "manage",
        true,
    ),
    (
        "schedule_confirm_enable_v1",
        "ConfirmEnableRequest",
        "ConfirmEnableResponse",
        "run",
        true,
    ),
    (
        "schedule_manual_run_v1",
        "ManualRunRequest",
        "ManualRunResponse",
        "run",
        true,
    ),
    (
        "schedule_preview_rerun_v1",
        "PreviewRerunRequest",
        "PreviewRerunResponse",
        "read",
        false,
    ),
    (
        "schedule_confirm_rerun_v1",
        "ConfirmRerunRequest",
        "ConfirmRerunResponse",
        "run",
        true,
    ),
    (
        "schedule_submit_draft_v1",
        "SubmitDraftRequest",
        "SubmitDraftResponse",
        "run",
        true,
    ),
    (
        "schedule_preview_draft_v1",
        "PreviewDraftRequest",
        "PreviewDraftResponse",
        "read",
        false,
    ),
    (
        "schedule_confirm_draft_v1",
        "ConfirmDraftRequest",
        "ConfirmDraftResponse",
        "manage",
        true,
    ),
    (
        "schedule_find_draft_source_v1",
        "FindDraftSourceRequest",
        "FindDraftSourceResponse",
        "read",
        false,
    ),
    (
        "schedule_operation_capabilities_v1",
        "OperationCapabilitiesRequest",
        "OperationCapabilitiesResponse",
        "read",
        false,
    ),
    (
        "schedule_continue_draft_source_v1",
        "ContinueDraftSourceRequest",
        "ContinueDraftSourceResponse",
        "run",
        true,
    ),
    (
        "schedule_list_plan_cards_v1",
        "ListPlanCardsRequest",
        "ListPlanCardsResponse",
        "read",
        false,
    ),
    (
        "schedule_list_record_rows_v1",
        "ListRecordRowsRequest",
        "ListRecordRowsResponse",
        "read",
        false,
    ),
    (
        "schedule_read_plan_mutation_receipt_v1",
        "ReadPlanMutationReceiptRequest",
        "ReadPlanMutationReceiptResponse",
        "read",
        false,
    ),
    (
        "schedule_read_draft_submission_receipt_v1",
        "ReadDraftSubmissionReceiptRequest",
        "ReadDraftSubmissionReceiptResponse",
        "read",
        false,
    ),
    (
        "schedule_read_execution_receipt_v1",
        "ReadExecutionReceiptRequest",
        "ReadExecutionReceiptResponse",
        "read",
        false,
    ),
    (
        "schedule_confirm_single_run_v1",
        "ConfirmSingleRunRequest",
        "ConfirmSingleRunResponse",
        "run",
        true,
    ),
    (
        "schedule_list_important_updates_v1",
        "ImportantUpdatesRequest",
        "ImportantUpdatesResponse",
        "read",
        false,
    ),
    (
        "schedule_save_active_plan_v1",
        "SavePlanRequest",
        "SavePlanResponse",
        "run",
        true,
    ),
    (
        "schedule_confirm_active_draft_v1",
        "ConfirmDraftRequest",
        "ConfirmDraftResponse",
        "run",
        true,
    ),
    (
        "schedule_enable_plan_v1",
        "PausePlanRequest",
        "PausePlanResponse",
        "run",
        true,
    ),
];
