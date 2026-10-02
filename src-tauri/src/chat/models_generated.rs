// Generated from model-selection-v1.schema.json; DO NOT EDIT.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProfileId {
    #[serde(rename = "kimi-k3-max-v1")]
    KimiK3MaxV1,
    #[serde(rename = "minimax-m3-high-v1")]
    MinimaxM3HighV1,
}
pub type CanonicalId = String;
pub type Revision = i64;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SelectionState {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "switching")]
    Switching,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDefinition {
    pub profile_id: ProfileId,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub effort: String,
    pub context_window: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelAvailability {
    pub profile: ModelDefinition,
    pub available: bool,
    pub reason: ModelAvailabilityReason,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: i64,
    pub default_profile: ProfileId,
    pub models: Vec<ModelAvailability>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub schema_version: i64,
    pub agent_session_id: CanonicalId,
    pub state: SelectionState,
    pub revision: Revision,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<ProfileId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<CanonicalId>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectRequest {
    pub schema_version: i64,
    pub operation_id: CanonicalId,
    pub expected_revision: Revision,
    pub profile_id: ProfileId,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Error {
    pub schema_version: i64,
    pub code: ErrorCode,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelAvailabilityReason {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "not_configured")]
    NotConfigured,
    #[serde(rename = "runtime_unavailable")]
    RuntimeUnavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "model_unavailable")]
    ModelUnavailable,
    #[serde(rename = "selection_unknown")]
    SelectionUnknown,
    #[serde(rename = "runtime_unavailable")]
    RuntimeUnavailable,
}
