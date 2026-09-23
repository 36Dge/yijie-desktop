// Generated from scheduled plan source; DO NOT EDIT.
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

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeRule {
    pub frequency: TimeRuleFrequency,
    pub time_zone: String,
    pub local_time: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub local_date: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub weekdays: Option<Vec<i64>>,
}
impl std::fmt::Debug for TimeRule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TimeRule([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetMode {
    #[serde(rename = "dedicated_chat")]
    DedicatedChat,
    #[serde(rename = "new_chat_each_run")]
    NewChatEachRun,
    #[serde(rename = "existing_chat")]
    ExistingChat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanState {
    #[serde(rename = "paused")]
    Paused,
    #[serde(rename = "enabled")]
    Enabled,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "deleted")]
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetState {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "unbound")]
    Unbound,
    #[serde(rename = "missing")]
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleErrorCode {
    #[serde(rename = "invalid_input")]
    InvalidInput,
    #[serde(rename = "target_unavailable")]
    TargetUnavailable,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "storage_disabled")]
    StorageDisabled,
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "time_query_exhausted")]
    TimeQueryExhausted,
    #[serde(rename = "rule_version_unsupported")]
    RuleVersionUnsupported,
    #[serde(rename = "execution_not_ready")]
    ExecutionNotReady,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetReference {
    pub mode: TargetMode,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub conversation_id: Option<Identity>,
}
impl std::fmt::Debug for TargetReference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TargetReference([redacted])")
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanDefinition {
    pub name: String,
    pub content: String,
    pub rule: TimeRule,
    pub target: TargetReference,
}
impl std::fmt::Debug for PlanDefinition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanDefinition([redacted])")
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavePlanRequest {
    pub request_id: Identity,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub plan_id: Option<Identity>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub expected_revision: Option<i64>,
    pub definition: PlanDefinition,
}
impl std::fmt::Debug for SavePlanRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SavePlanRequest([redacted])")
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanView {
    pub plan_id: Identity,
    pub revision: i64,
    pub schedule_epoch: i64,
    pub definition: PlanDefinition,
    pub state: PlanState,
    pub target_state: TargetState,
    pub effective_from: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_at: Option<i64>,
    pub rule_version: i64,
    pub tzdb_version: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub authorization_ref: Option<Identity>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub authorization_expires_at: Option<i64>,
}
impl std::fmt::Debug for PlanView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PlanView([redacted])")
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimePreview {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub next_at: Option<i64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub logical_slot: Option<String>,
    pub skipped_slots: Vec<String>,
    pub candidates_examined: i64,
    pub rule_version: i64,
    pub tzdb_version: String,
}
impl std::fmt::Debug for TimePreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TimePreview([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeRuleFrequency {
    #[serde(rename = "once")]
    Once,
    #[serde(rename = "daily")]
    Daily,
    #[serde(rename = "weekdays")]
    Weekdays,
    #[serde(rename = "weekly")]
    Weekly,
}
