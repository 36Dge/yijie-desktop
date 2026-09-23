// Generated from draft-execution source. DO NOT EDIT.
use serde::{Deserialize, Serialize};
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
pub type Identity = String;
pub type Version = i64;
pub type Text = String;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
    #[serde(rename = "task_id")]
    pub task_id: Identity,
    #[serde(rename = "workspace_id")]
    pub workspace_id: Identity,
}
impl std::fmt::Debug for CreateRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CreateRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResumeRequest {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
}
impl std::fmt::Debug for ResumeRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResumeRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurnRequest {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
    #[serde(rename = "operation_id")]
    pub operation_id: Identity,
    #[serde(rename = "text")]
    pub text: Text,
}
impl std::fmt::Debug for TurnRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionReceipt {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
    #[serde(rename = "purpose")]
    pub purpose: String,
    #[serde(rename = "task_id")]
    pub task_id: Identity,
    #[serde(rename = "agent_session_id")]
    pub agent_session_id: Identity,
    #[serde(rename = "workspace_id")]
    pub workspace_id: Identity,
}
impl std::fmt::Debug for SessionReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurnReceipt {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
    #[serde(rename = "agent_session_id")]
    pub agent_session_id: Identity,
    #[serde(rename = "operation_id")]
    pub operation_id: Identity,
    #[serde(rename = "turn_id")]
    pub turn_id: Identity,
}
impl std::fmt::Debug for TurnReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capability {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "available")]
    pub available: bool,
    #[serde(rename = "reason")]
    pub reason: CapabilityReason,
}
impl std::fmt::Debug for Capability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Capability([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "purpose_conflict")]
    PurposeConflict,
    #[serde(rename = "storage_disabled")]
    StorageDisabled,
    #[serde(rename = "policy_unqualified")]
    PolicyUnqualified,
    #[serde(rename = "operation_unknown")]
    OperationUnknown,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "unauthorized")]
    Unauthorized,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Error {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "code")]
    pub code: ErrorCode,
}
impl std::fmt::Debug for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Error([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Clarification {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "missing_fields")]
    pub missing_fields: Vec<ClarificationMissingFieldsItem>,
    #[serde(rename = "question")]
    pub question: String,
}
impl std::fmt::Debug for Clarification {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Clarification([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "content")]
    pub content: String,
    #[serde(rename = "schedule")]
    pub schedule: CandidateSchedule,
    #[serde(rename = "target")]
    pub target: CandidateTarget,
}
impl std::fmt::Debug for Candidate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Candidate([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Output {
    Variant0(Box<Clarification>),
    Variant1(Box<Candidate>),
}
impl std::fmt::Debug for Output {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Output([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryMapping {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "policy_version")]
    pub policy_version: i64,
    #[serde(rename = "purpose")]
    pub purpose: String,
    #[serde(rename = "task_id")]
    pub task_id: Identity,
    #[serde(rename = "agent_session_id")]
    pub agent_session_id: Identity,
    #[serde(rename = "workspace_id")]
    pub workspace_id: Identity,
    #[serde(rename = "mapping_state")]
    pub mapping_state: RecoveryMappingMappingState,
    #[serde(
        rename = "codex_thread_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub codex_thread_id: Option<Identity>,
    #[serde(
        rename = "responding_host_instance_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub responding_host_instance_id: Option<Identity>,
}
impl std::fmt::Debug for RecoveryMapping {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecoveryMapping([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityReason {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "storage_disabled")]
    StorageDisabled,
    #[serde(rename = "policy_unqualified")]
    PolicyUnqualified,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClarificationMissingFieldsItem {
    #[serde(rename = "name")]
    Name,
    #[serde(rename = "content")]
    Content,
    #[serde(rename = "frequency")]
    Frequency,
    #[serde(rename = "time")]
    Time,
    #[serde(rename = "time_zone")]
    TimeZone,
    #[serde(rename = "target")]
    Target,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateSchedule {
    #[serde(rename = "frequency")]
    pub frequency: CandidateScheduleFrequency,
    #[serde(rename = "time_zone")]
    pub time_zone: String,
    #[serde(rename = "local_time")]
    pub local_time: String,
    #[serde(
        rename = "local_date",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub local_date: Option<String>,
    #[serde(
        rename = "weekdays",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub weekdays: Option<Vec<i64>>,
}
impl std::fmt::Debug for CandidateSchedule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CandidateSchedule([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateTarget {
    #[serde(rename = "mode")]
    pub mode: CandidateTargetMode,
    #[serde(
        rename = "existing_chat_label",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub existing_chat_label: Option<String>,
}
impl std::fmt::Debug for CandidateTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CandidateTarget([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecoveryMappingMappingState {
    #[serde(rename = "reserved")]
    Reserved,
    #[serde(rename = "bound")]
    Bound,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CandidateScheduleFrequency {
    #[serde(rename = "once")]
    Once,
    #[serde(rename = "daily")]
    Daily,
    #[serde(rename = "weekdays")]
    Weekdays,
    #[serde(rename = "weekly")]
    Weekly,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CandidateTargetMode {
    #[serde(rename = "dedicated_chat")]
    DedicatedChat,
    #[serde(rename = "new_chat_each_run")]
    NewChatEachRun,
    #[serde(rename = "existing_chat")]
    ExistingChat,
}
