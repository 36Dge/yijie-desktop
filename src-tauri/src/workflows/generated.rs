// Code generated from workflow-local OpenAPI by generate-workflow-local.mjs. DO NOT EDIT.
// Debug implementations intentionally omit all field values, including native-only secrets.
use serde::{Deserialize, Serialize};

pub type Identifier = String;

pub type OperationId = String;

pub type Version = String;

pub type RunEpoch = OperationId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "profile_disabled")]
    ProfileDisabled,
    #[serde(rename = "service_unavailable")]
    ServiceUnavailable,
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "session_expired")]
    SessionExpired,
    #[serde(rename = "resource_not_found")]
    ResourceNotFound,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "operation_conflict")]
    OperationConflict,
    #[serde(rename = "invalid_draft")]
    InvalidDraft,
    #[serde(rename = "input_too_large")]
    InputTooLarge,
    #[serde(rename = "run_busy")]
    RunBusy,
    #[serde(rename = "operation_unknown")]
    OperationUnknown,
    #[serde(rename = "protocol_mismatch")]
    ProtocolMismatch,
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "internal_error")]
    InternalError,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<OperationId>,
}
impl std::fmt::Debug for ErrorResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ErrorResponse([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    pub input_bytes: i64,
    pub prefix_bytes: i64,
    pub output_bytes: i64,
    pub canvas_bytes: i64,
    pub message_bytes: i64,
    pub max_active_runs: i64,
    pub execution_budget_seconds: i64,
    pub editor_ttl_seconds: i64,
}
impl std::fmt::Debug for Limits {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Limits([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceStatus {
    pub protocol_version: i64,
    pub run_epoch: RunEpoch,
    pub ready: bool,
    pub state: String,
    pub limits: Limits,
}
impl std::fmt::Debug for ServiceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ServiceStatus([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Principal {
    pub owner_id: Identifier,
    pub tenant_id: Identifier,
    pub user_id: Identifier,
    pub space_id: Identifier,
}
impl std::fmt::Debug for Principal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Principal([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workflow {
    pub workflow_id: Identifier,
    pub name: String,
    pub revision: Identifier,
    pub canvas: String,
    pub runnable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_version: Option<Version>,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
impl std::fmt::Debug for Workflow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Workflow([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkflowList {
    pub items: Vec<WorkflowSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}
impl std::fmt::Debug for WorkflowList {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WorkflowList([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}
impl std::fmt::Debug for ListRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateInput {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
impl std::fmt::Debug for CreateInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CreateInput([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    pub name: String,
    pub operation_id: OperationId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
impl std::fmt::Debug for CreateRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CreateRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextInput {
    pub input: String,
}
impl std::fmt::Debug for TextInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TextInput([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    pub operation_id: OperationId,
    pub expected_revision: Identifier,
    pub name: String,
    pub canvas: String,
}
impl std::fmt::Debug for SaveRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SaveRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestRequest {
    pub operation_id: OperationId,
    pub expected_revision: Identifier,
    pub input: TextInput,
}
impl std::fmt::Debug for TestRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TestRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishRequest {
    pub operation_id: OperationId,
    pub expected_revision: Identifier,
    pub successful_test_run_id: Identifier,
}
impl std::fmt::Debug for PublishRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PublishRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRequest {
    pub operation_id: OperationId,
    pub version: Version,
    pub input: TextInput,
}
impl std::fmt::Debug for RunRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunInput {
    pub workflow_id: Identifier,
    pub version: Version,
    pub input: TextInput,
}
impl std::fmt::Debug for RunInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunInput([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunMode {
    #[serde(rename = "debug")]
    Debug,
    #[serde(rename = "release")]
    Release,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeResult {
    pub node_id: Identifier,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}
impl std::fmt::Debug for NodeResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NodeResult([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    pub run_id: Identifier,
    pub workflow_id: Identifier,
    pub operation_id: OperationId,
    pub mode: RunMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
    pub state: String,
    pub terminal: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<TextInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NodeResult>>,
    pub started_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}
impl std::fmt::Debug for Run {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Run([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunList {
    pub items: Vec<RunSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}
impl std::fmt::Debug for RunList {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunList([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationKind {
    #[serde(rename = "create")]
    Create,
    #[serde(rename = "save")]
    Save,
    #[serde(rename = "test")]
    Test,
    #[serde(rename = "publish")]
    Publish,
    #[serde(rename = "run")]
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationPhase {
    #[serde(rename = "recorded")]
    Recorded,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "rejected")]
    Rejected,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationReceipt {
    pub operation_id: OperationId,
    pub kind: OperationKind,
    pub phase: OperationPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}
impl std::fmt::Debug for OperationReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationReceipt([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorOpenRequest {
    pub workflow_id: Identifier,
}
impl std::fmt::Debug for EditorOpenRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorOpenRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorSessionSecret {
    pub session_id: Identifier,
    pub workflow_id: Identifier,
    pub secret: String,
    pub run_epoch: RunEpoch,
    pub expires_at_ms: i64,
}
impl std::fmt::Debug for EditorSessionSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorSessionSecret([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorOpenedView {
    pub bridge_id: Identifier,
    pub workflow: Workflow,
    pub generation: i64,
    pub expires_at_ms: i64,
    pub protocol_version: i64,
}
impl std::fmt::Debug for EditorOpenedView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorOpenedView([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bootstrap {
    pub workflow: Workflow,
    pub principal: Principal,
    pub node_types: Vec<i64>,
    pub limits: Limits,
}
impl std::fmt::Debug for Bootstrap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Bootstrap([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorOperation {
    #[serde(rename = "bootstrap")]
    Bootstrap,
    #[serde(rename = "read_draft")]
    ReadDraft,
    #[serde(rename = "save_draft")]
    SaveDraft,
    #[serde(rename = "test_draft")]
    TestDraft,
    #[serde(rename = "publish_internal")]
    PublishInternal,
    #[serde(rename = "read_run")]
    ReadRun,
    #[serde(rename = "read_operation")]
    ReadOperation,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorExchangeInput {
    pub bridge_id: Identifier,
    pub generation: i64,
    pub protocol_version: i64,
    pub request_id: Identifier,
    pub operation: EditorOperation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<TextInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successful_test_run_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<OperationId>,
}
impl std::fmt::Debug for EditorExchangeInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorExchangeInput([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorExchangeResult {
    pub request_id: Identifier,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<OperationId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bootstrap: Option<Bootstrap>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<Workflow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<Run>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<OperationReceipt>,
}
impl std::fmt::Debug for EditorExchangeResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorExchangeResult([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorCloseInput {
    pub bridge_id: Identifier,
}
impl std::fmt::Debug for EditorCloseInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EditorCloseInput([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunQueryKind {
    #[serde(rename = "run")]
    Run,
    #[serde(rename = "history")]
    History,
    #[serde(rename = "operation")]
    Operation,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunQueryInput {
    pub kind: RunQueryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<OperationId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}
impl std::fmt::Debug for RunQueryInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunQueryInput([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunQueryResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<Run>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<RunList>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<OperationReceipt>,
}
impl std::fmt::Debug for RunQueryResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunQueryResult([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseResult {
    pub closed: bool,
}
impl std::fmt::Debug for CloseResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CloseResult([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkflowSummary {
    pub workflow_id: Identifier,
    pub name: String,
    pub revision: Identifier,
    pub runnable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_version: Option<Version>,
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}
impl std::fmt::Debug for WorkflowSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WorkflowSummary([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunSummary {
    pub run_id: Identifier,
    pub workflow_id: Identifier,
    pub operation_id: OperationId,
    pub mode: RunMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Identifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
    pub state: String,
    pub terminal: bool,
    pub started_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}
impl std::fmt::Debug for RunSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RunSummary([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteInput {
    pub workflow_id: Identifier,
    pub expected_revision: Identifier,
}
impl std::fmt::Debug for DeleteInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeleteInput([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteRequest {
    pub expected_revision: Identifier,
}
impl std::fmt::Debug for DeleteRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeleteRequest([redacted])")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteResult {
    pub workflow_id: Identifier,
    pub deleted: bool,
}
impl std::fmt::Debug for DeleteResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeleteResult([redacted])")
    }
}
