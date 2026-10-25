// Generated from FEAT-158 experts source and referenced authorities; DO NOT EDIT.
use serde::{Deserialize, Serialize};

fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}
pub type CanonicalId = String;
pub type ExpertId = String;
pub type Version = String;
pub type Digest = String;
pub type Revision = i64;
pub use crate::chat::connectors::broker_generated::ScopeBinding;
pub type NativeId = String;
pub use crate::chat::connectors::host_generated::GrantRegistration as MarketGrant;
pub use crate::chat::connectors::host_generated::PermissionMode;
pub use crate::chat::connectors::host_generated::Submission as MarketSubmission;
pub use crate::chat::connectors::host_generated::SubmissionReceipt as MarketReceipt;
pub use crate::chat::connectors::host_generated::SubmitPayload as MarketSubmitTrigger;
pub use crate::chat::connectors::selection_generated::ModelIntent;
pub use crate::chat::connectors::selection_generated::SelectionSnapshot as MarketSnapshot;
pub use crate::chat::connectors::selection_generated::SubmissionReceipt as NativeReceipt;
pub use crate::chat::connectors::selection_generated::SubmitPayload as MarketSubmitPayload;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "context_invalid")]
    ContextInvalid,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "unsupported_capability")]
    UnsupportedCapability,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "resource_unavailable")]
    ResourceUnavailable,
    #[serde(rename = "resource_in_use")]
    ResourceInUse,
    #[serde(rename = "version_unavailable")]
    VersionUnavailable,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "approval_pending")]
    ApprovalPending,
    #[serde(rename = "operation_pending")]
    OperationPending,
    #[serde(rename = "outcome_unknown")]
    OutcomeUnknown,
    #[serde(rename = "binding_unavailable")]
    BindingUnavailable,
    #[serde(rename = "thread_unavailable")]
    ThreadUnavailable,
    #[serde(rename = "qualification_required")]
    QualificationRequired,
    #[serde(rename = "model_unavailable")]
    ModelUnavailable,
    #[serde(rename = "permission_mode_unavailable")]
    PermissionModeUnavailable,
    #[serde(rename = "selection_stale")]
    SelectionStale,
    #[serde(rename = "capacity_exceeded")]
    CapacityExceeded,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceState {
    #[serde(rename = "available")]
    Available,
    #[serde(rename = "preparing")]
    Preparing,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "incompatible")]
    Incompatible,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BindingState {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "applying")]
    Applying,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "unavailable")]
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "succeeded")]
    Succeeded,
    #[serde(rename = "rejected")]
    Rejected,
    #[serde(rename = "unknown")]
    Unknown,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ExpertSelectionWire")]
pub struct ExpertSelection {
    pub expert_id: ExpertId,
    pub version: Version,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpertSelectionWire {
    pub expert_id: ExpertId,
    pub version: Version,
}
impl TryFrom<ExpertSelectionWire> for ExpertSelection {
    type Error = &'static str;
    fn try_from(w: ExpertSelectionWire) -> Result<Self, Self::Error> {
        let v = Self {
            expert_id: w.expert_id,
            version: w.version,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ExpertSelection {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expert_id = &self.expert_id;
            if value_expert_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_expert_id.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if !slug(value_expert_id, false) {
                return Err("invalid expert id");
            }
        }
        {
            let value_version = &self.version;
            if !semantic_version(value_version) {
                return Err("invalid expert version");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ExpertSelection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExpertSelection([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ExpertRefWire")]
pub struct ExpertRef {
    pub expert_id: ExpertId,
    pub version: Version,
    pub archive_sha256: Digest,
    pub role_sha256: Digest,
    pub knowledge_manifest_sha256: Digest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpertRefWire {
    pub expert_id: ExpertId,
    pub version: Version,
    pub archive_sha256: Digest,
    pub role_sha256: Digest,
    pub knowledge_manifest_sha256: Digest,
}
impl TryFrom<ExpertRefWire> for ExpertRef {
    type Error = &'static str;
    fn try_from(w: ExpertRefWire) -> Result<Self, Self::Error> {
        let v = Self {
            expert_id: w.expert_id,
            version: w.version,
            archive_sha256: w.archive_sha256,
            role_sha256: w.role_sha256,
            knowledge_manifest_sha256: w.knowledge_manifest_sha256,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ExpertRef {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expert_id = &self.expert_id;
            if value_expert_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_expert_id.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if !slug(value_expert_id, false) {
                return Err("invalid expert id");
            }
        }
        {
            let value_version = &self.version;
            if !semantic_version(value_version) {
                return Err("invalid expert version");
            }
        }
        {
            let value_archive_sha256 = &self.archive_sha256;
            if value_archive_sha256.len() != 64
                || !value_archive_sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        {
            let value_role_sha256 = &self.role_sha256;
            if value_role_sha256.len() != 64
                || !value_role_sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        {
            let value_knowledge_manifest_sha256 = &self.knowledge_manifest_sha256;
            if value_knowledge_manifest_sha256.len() != 64
                || !value_knowledge_manifest_sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ExpertRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExpertRef([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ExpertDisplayWire")]
pub struct ExpertDisplay {
    pub expert_id: ExpertId,
    pub version: Version,
    pub display_name: String,
    pub subtitle: String,
    pub icon_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpertDisplayWire {
    pub expert_id: ExpertId,
    pub version: Version,
    pub display_name: String,
    pub subtitle: String,
    pub icon_key: String,
}
impl TryFrom<ExpertDisplayWire> for ExpertDisplay {
    type Error = &'static str;
    fn try_from(w: ExpertDisplayWire) -> Result<Self, Self::Error> {
        let v = Self {
            expert_id: w.expert_id,
            version: w.version,
            display_name: w.display_name,
            subtitle: w.subtitle,
            icon_key: w.icon_key,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ExpertDisplay {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expert_id = &self.expert_id;
            if value_expert_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_expert_id.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if !slug(value_expert_id, false) {
                return Err("invalid expert id");
            }
        }
        {
            let value_version = &self.version;
            if !semantic_version(value_version) {
                return Err("invalid expert version");
            }
        }
        {
            let value_display_name = &self.display_name;
            if value_display_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_display_name.chars().count() > 80 {
                return Err("invalid broker text");
            }
        }
        {
            let value_subtitle = &self.subtitle;
            if value_subtitle.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_subtitle.chars().count() > 80 {
                return Err("invalid broker text");
            }
        }
        {
            let value_icon_key = &self.icon_key;
            if value_icon_key.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if value_icon_key.is_empty()
                || !value_icon_key.as_bytes()[0].is_ascii_lowercase()
                || !value_icon_key.bytes().all(|c| c.is_ascii_alphanumeric())
            {
                return Err("invalid icon key");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ExpertDisplay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExpertDisplay([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "CatalogEntryWire")]
pub struct CatalogEntry {
    pub display: ExpertDisplay,
    pub description: String,
    pub platform: String,
    pub tags: Vec<String>,
    pub quick_prompts: Vec<String>,
    pub knowledge_summary: String,
    pub state: ResourceState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub operation: Option<ResourceOperation>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogEntryWire {
    pub display: ExpertDisplay,
    pub description: String,
    pub platform: String,
    pub tags: Vec<String>,
    pub quick_prompts: Vec<String>,
    pub knowledge_summary: String,
    pub state: ResourceState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub operation: Option<ResourceOperation>,
}
impl TryFrom<CatalogEntryWire> for CatalogEntry {
    type Error = &'static str;
    fn try_from(w: CatalogEntryWire) -> Result<Self, Self::Error> {
        let v = Self {
            display: w.display,
            description: w.description,
            platform: w.platform,
            tags: w.tags,
            quick_prompts: w.quick_prompts,
            knowledge_summary: w.knowledge_summary,
            state: w.state,
            error_code: w.error_code,
            operation: w.operation,
        };
        v.validate()?;
        Ok(v)
    }
}
impl CatalogEntry {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_display = &self.display;
            value_display.validate()?;
        }
        {
            let value_description = &self.description;
            if value_description.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_description.chars().count() > 240 {
                return Err("invalid broker text");
            }
        }
        {
            let value_platform = &self.platform;
            if value_platform.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_platform.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_tags = &self.tags;
            if value_tags.len() > 8 {
                return Err("invalid broker collection");
            }
            for item in value_tags.iter() {
                if item.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if item.chars().count() > 40 {
                    return Err("invalid broker text");
                }
            }
        }
        {
            let value_quick_prompts = &self.quick_prompts;
            if value_quick_prompts.len() > 3 {
                return Err("invalid broker collection");
            }
            for item in value_quick_prompts.iter() {
                if item.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if item.chars().count() > 500 {
                    return Err("invalid broker text");
                }
            }
        }
        {
            let value_knowledge_summary = &self.knowledge_summary;
            if value_knowledge_summary.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_knowledge_summary.chars().count() > 300 {
                return Err("invalid broker text");
            }
        }
        self.operation
            .as_ref()
            .map(|value_operation| -> Result<(), &'static str> {
                value_operation.validate()?;
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for CatalogEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CatalogEntry([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "CatalogSnapshotWire")]
pub struct CatalogSnapshot {
    pub experts: Vec<CatalogEntry>,
    pub can_manage: bool,
    pub execution_available: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogSnapshotWire {
    pub experts: Vec<CatalogEntry>,
    pub can_manage: bool,
    pub execution_available: bool,
}
impl TryFrom<CatalogSnapshotWire> for CatalogSnapshot {
    type Error = &'static str;
    fn try_from(w: CatalogSnapshotWire) -> Result<Self, Self::Error> {
        let v = Self {
            experts: w.experts,
            can_manage: w.can_manage,
            execution_available: w.execution_available,
        };
        v.validate()?;
        Ok(v)
    }
}
impl CatalogSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_experts = &self.experts;
            if value_experts.len() > 64 {
                return Err("invalid broker collection");
            }
            for item in value_experts.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for CatalogSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CatalogSnapshot([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "EmptyPayloadWire")]
pub struct EmptyPayload {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmptyPayloadWire {}
impl TryFrom<EmptyPayloadWire> for EmptyPayload {
    type Error = &'static str;
    fn try_from(_w: EmptyPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {};
        v.validate()?;
        Ok(v)
    }
}
impl EmptyPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}
impl std::fmt::Debug for EmptyPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EmptyPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ResourcePayloadWire")]
pub struct ResourcePayload {
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourcePayloadWire {
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
}
impl TryFrom<ResourcePayloadWire> for ResourcePayload {
    type Error = &'static str;
    fn try_from(w: ResourcePayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            expert: w.expert,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourcePayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourcePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourcePayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "OperationReadPayloadWire")]
pub struct OperationReadPayload {
    pub operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationReadPayloadWire {
    pub operation_id: CanonicalId,
}
impl TryFrom<OperationReadPayloadWire> for OperationReadPayload {
    type Error = &'static str;
    fn try_from(w: OperationReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl OperationReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for OperationReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ResourceOperationWire")]
pub struct ResourceOperation {
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
    pub action: String,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceOperationWire {
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
    pub action: String,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
impl TryFrom<ResourceOperationWire> for ResourceOperation {
    type Error = &'static str;
    fn try_from(w: ResourceOperationWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            expert: w.expert,
            action: w.action,
            state: w.state,
            error_code: w.error_code,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourceOperation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert.validate()?;
        }
        {
            let value_action = &self.action;
            if !["prepare", "remove"].contains(&value_action.as_str()) {
                return Err("invalid broker enum");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourceOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceOperation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingReadPayloadWire")]
pub struct BindingReadPayload {
    pub session_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingReadPayloadWire {
    pub session_id: CanonicalId,
}
impl TryFrom<BindingReadPayloadWire> for BindingReadPayload {
    type Error = &'static str;
    fn try_from(w: BindingReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            session_id: w.session_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingSetPayloadWire")]
pub struct BindingSetPayload {
    pub operation_id: CanonicalId,
    pub session_id: CanonicalId,
    pub expected_binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertSelection>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingSetPayloadWire {
    pub operation_id: CanonicalId,
    pub session_id: CanonicalId,
    pub expected_binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertSelection>,
}
impl TryFrom<BindingSetPayloadWire> for BindingSetPayload {
    type Error = &'static str;
    fn try_from(w: BindingSetPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            session_id: w.session_id,
            expected_binding_revision: w.expected_binding_revision,
            expert: w.expert,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingSetPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_expected_binding_revision = &self.expected_binding_revision;
            if *value_expected_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingSetPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingSetPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingOperationReadPayloadWire")]
pub struct BindingOperationReadPayload {
    pub session_id: CanonicalId,
    pub operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingOperationReadPayloadWire {
    pub session_id: CanonicalId,
    pub operation_id: CanonicalId,
}
impl TryFrom<BindingOperationReadPayloadWire> for BindingOperationReadPayload {
    type Error = &'static str;
    fn try_from(w: BindingOperationReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            session_id: w.session_id,
            operation_id: w.operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingOperationReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingOperationReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingOperationReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingViewWire")]
pub struct BindingView {
    pub session_id: CanonicalId,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertDisplay>,
    pub state: BindingState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub operation_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
    pub managed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingViewWire {
    pub session_id: CanonicalId,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertDisplay>,
    pub state: BindingState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub operation_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
    pub managed: bool,
}
impl TryFrom<BindingViewWire> for BindingView {
    type Error = &'static str;
    fn try_from(w: BindingViewWire) -> Result<Self, Self::Error> {
        let v = Self {
            session_id: w.session_id,
            binding_revision: w.binding_revision,
            expert: w.expert,
            state: w.state,
            operation_id: w.operation_id,
            error_code: w.error_code,
            managed: w.managed,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingView {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        self.operation_id
            .as_ref()
            .map(|value_operation_id| -> Result<(), &'static str> {
                if !canonical_id(value_operation_id) {
                    return Err("invalid expert identity");
                }
                Ok(())
            })
            .transpose()?;
        if !self.managed
            && (self.binding_revision != 0
                || self.expert.is_some()
                || self.state != BindingState::None
                || self.operation_id.is_some())
        {
            return Err("invalid unmanaged binding");
        }
        if self.state == BindingState::None && self.expert.is_some() {
            return Err("ordinary binding has expert");
        }
        if self.state == BindingState::Ready && self.expert.is_none() {
            return Err("ready binding missing expert");
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingView([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingOperationWire")]
pub struct BindingOperation {
    pub operation_id: CanonicalId,
    pub session_id: CanonicalId,
    pub state: OperationState,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub requested_expert: Option<ExpertDisplay>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingOperationWire {
    pub operation_id: CanonicalId,
    pub session_id: CanonicalId,
    pub state: OperationState,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub requested_expert: Option<ExpertDisplay>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
impl TryFrom<BindingOperationWire> for BindingOperation {
    type Error = &'static str;
    fn try_from(w: BindingOperationWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            session_id: w.session_id,
            state: w.state,
            expected_binding_revision: w.expected_binding_revision,
            binding_revision: w.binding_revision,
            requested_expert: w.requested_expert,
            error_code: w.error_code,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingOperation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_expected_binding_revision = &self.expected_binding_revision;
            if *value_expected_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_requested_expert = &self.requested_expert;
            value_requested_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        let expected = if self.state == OperationState::Succeeded {
            self.expected_binding_revision.checked_add(1)
        } else {
            Some(self.expected_binding_revision)
        };
        if expected != Some(self.binding_revision) {
            return Err("invalid effective binding revision");
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingOperation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingResultWire")]
pub struct BindingResult {
    pub binding: BindingView,
    pub operation: BindingOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingResultWire {
    pub binding: BindingView,
    pub operation: BindingOperation,
}
impl TryFrom<BindingResultWire> for BindingResult {
    type Error = &'static str;
    fn try_from(w: BindingResultWire) -> Result<Self, Self::Error> {
        let v = Self {
            binding: w.binding,
            operation: w.operation,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingResult {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_binding = &self.binding;
            value_binding.validate()?;
        }
        {
            let value_operation = &self.operation;
            value_operation.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeSubmitPayloadWire")]
pub struct NativeSubmitPayload {
    pub submission: MarketSubmitPayload,
    pub expected_binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertSelection>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeSubmitPayloadWire {
    pub submission: MarketSubmitPayload,
    pub expected_binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertSelection>,
}
impl TryFrom<NativeSubmitPayloadWire> for NativeSubmitPayload {
    type Error = &'static str;
    fn try_from(w: NativeSubmitPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            submission: w.submission,
            expected_binding_revision: w.expected_binding_revision,
            expert: w.expert,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeSubmitPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_submission = &self.submission;
            value_submission.validate()?;
        }
        {
            let value_expected_binding_revision = &self.expected_binding_revision;
            if *value_expected_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeSubmitPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeSubmitPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "TurnExpertSnapshotWire")]
pub struct TurnExpertSnapshot {
    pub format_version: i64,
    pub turn_operation_id: CanonicalId,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub snapshot_digest: Digest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TurnExpertSnapshotWire {
    pub format_version: i64,
    pub turn_operation_id: CanonicalId,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub snapshot_digest: Digest,
}
impl TryFrom<TurnExpertSnapshotWire> for TurnExpertSnapshot {
    type Error = &'static str;
    fn try_from(w: TurnExpertSnapshotWire) -> Result<Self, Self::Error> {
        let v = Self {
            format_version: w.format_version,
            turn_operation_id: w.turn_operation_id,
            binding_revision: w.binding_revision,
            expert: w.expert,
            snapshot_digest: w.snapshot_digest,
        };
        v.validate()?;
        Ok(v)
    }
}
impl TurnExpertSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_format_version = &self.format_version;
            if *value_format_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_snapshot_digest = &self.snapshot_digest;
            if value_snapshot_digest.len() != 64
                || !value_snapshot_digest
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        if snapshot_digest(
            &self.turn_operation_id,
            self.binding_revision,
            self.expert.as_ref(),
        )? != self.snapshot_digest
        {
            return Err("expert snapshot digest mismatch");
        }
        Ok(())
    }
}
impl std::fmt::Debug for TurnExpertSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnExpertSnapshot([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateSubmissionWire")]
pub struct PrivateSubmission {
    pub submission: MarketSubmission,
    pub expert_snapshot: TurnExpertSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateSubmissionWire {
    pub submission: MarketSubmission,
    pub expert_snapshot: TurnExpertSnapshot,
}
impl TryFrom<PrivateSubmissionWire> for PrivateSubmission {
    type Error = &'static str;
    fn try_from(w: PrivateSubmissionWire) -> Result<Self, Self::Error> {
        let v = Self {
            submission: w.submission,
            expert_snapshot: w.expert_snapshot,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateSubmission {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_submission = &self.submission;
            value_submission.validate()?;
        }
        {
            let value_expert_snapshot = &self.expert_snapshot;
            value_expert_snapshot.validate()?;
        }
        if self.submission.snapshot.turn_operation_id != self.expert_snapshot.turn_operation_id {
            return Err("expert turn identity mismatch");
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateSubmission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateSubmission([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateGrantPayloadWire")]
pub struct PrivateGrantPayload {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub submission: PrivateSubmission,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateGrantPayloadWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub submission: PrivateSubmission,
}
impl TryFrom<PrivateGrantPayloadWire> for PrivateGrantPayload {
    type Error = &'static str;
    fn try_from(w: PrivateGrantPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            submission: w.submission,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateGrantPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_submission = &self.submission;
            value_submission.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateGrantPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateGrantPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateGrantWire")]
pub struct PrivateGrant {
    pub grant: MarketGrant,
    pub expert_snapshot_digest: Digest,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateGrantWire {
    pub grant: MarketGrant,
    pub expert_snapshot_digest: Digest,
}
impl TryFrom<PrivateGrantWire> for PrivateGrant {
    type Error = &'static str;
    fn try_from(w: PrivateGrantWire) -> Result<Self, Self::Error> {
        let v = Self {
            grant: w.grant,
            expert_snapshot_digest: w.expert_snapshot_digest,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateGrant {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_grant = &self.grant;
            value_grant.validate()?;
        }
        {
            let value_expert_snapshot_digest = &self.expert_snapshot_digest;
            if value_expert_snapshot_digest.len() != 64
                || !value_expert_snapshot_digest
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateGrant([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateReceiptWire")]
pub struct PrivateReceipt {
    pub receipt: MarketReceipt,
    pub expert_snapshot: TurnExpertSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateReceiptWire {
    pub receipt: MarketReceipt,
    pub expert_snapshot: TurnExpertSnapshot,
}
impl TryFrom<PrivateReceiptWire> for PrivateReceipt {
    type Error = &'static str;
    fn try_from(w: PrivateReceiptWire) -> Result<Self, Self::Error> {
        let v = Self {
            receipt: w.receipt,
            expert_snapshot: w.expert_snapshot,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateReceipt {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_receipt = &self.receipt;
            value_receipt.validate()?;
        }
        {
            let value_expert_snapshot = &self.expert_snapshot;
            value_expert_snapshot.validate()?;
        }
        if self.receipt.turn_operation_id != self.expert_snapshot.turn_operation_id {
            return Err("expert receipt identity mismatch");
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApplyPayloadWire")]
pub struct ApplyPayload {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub native_thread_id: NativeId,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub intent: ModelIntent,
    pub permission_mode: PermissionMode,
    pub market_snapshot: MarketSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyPayloadWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub native_thread_id: NativeId,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub intent: ModelIntent,
    pub permission_mode: PermissionMode,
    pub market_snapshot: MarketSnapshot,
}
impl TryFrom<ApplyPayloadWire> for ApplyPayload {
    type Error = &'static str;
    fn try_from(w: ApplyPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            local_session_id: w.local_session_id,
            agent_session_id: w.agent_session_id,
            native_thread_id: w.native_thread_id,
            expected_binding_revision: w.expected_binding_revision,
            binding_revision: w.binding_revision,
            expert: w.expert,
            intent: w.intent,
            permission_mode: w.permission_mode,
            market_snapshot: w.market_snapshot,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApplyPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_native_thread_id = &self.native_thread_id;
            if value_native_thread_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_thread_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_expected_binding_revision = &self.expected_binding_revision;
            if *value_expected_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_intent = &self.intent;
            value_intent.validate()?;
        }
        {
            let value_market_snapshot = &self.market_snapshot;
            value_market_snapshot.validate()?;
        }
        if self.expected_binding_revision.checked_add(1) != Some(self.binding_revision) {
            return Err("invalid expert binding revision");
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApplyPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApplyPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateOperationReadPayloadWire")]
pub struct PrivateOperationReadPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateOperationReadPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub operation_id: CanonicalId,
}
impl TryFrom<PrivateOperationReadPayloadWire> for PrivateOperationReadPayload {
    type Error = &'static str;
    fn try_from(w: PrivateOperationReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            local_session_id: w.local_session_id,
            agent_session_id: w.agent_session_id,
            operation_id: w.operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateOperationReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateOperationReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateOperationReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApplyReceiptWire")]
pub struct ApplyReceipt {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub native_thread_id: NativeId,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyReceiptWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub native_thread_id: NativeId,
    pub expected_binding_revision: Revision,
    pub binding_revision: Revision,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertRef>,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<ErrorCode>,
}
impl TryFrom<ApplyReceiptWire> for ApplyReceipt {
    type Error = &'static str;
    fn try_from(w: ApplyReceiptWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            host_instance_id: w.host_instance_id,
            local_session_id: w.local_session_id,
            agent_session_id: w.agent_session_id,
            native_thread_id: w.native_thread_id,
            expected_binding_revision: w.expected_binding_revision,
            binding_revision: w.binding_revision,
            expert: w.expert,
            state: w.state,
            error_code: w.error_code,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApplyReceipt {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_native_thread_id = &self.native_thread_id;
            if value_native_thread_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_thread_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_expected_binding_revision = &self.expected_binding_revision;
            if *value_expected_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        let expected = if self.state == OperationState::Succeeded {
            self.expected_binding_revision.checked_add(1)
        } else {
            Some(self.expected_binding_revision)
        };
        if expected != Some(self.binding_revision) {
            return Err("invalid effective binding revision");
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApplyReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApplyReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeSubmissionResultWire")]
pub struct NativeSubmissionResult {
    pub receipt: NativeReceipt,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertDisplay>,
    pub binding_revision: Revision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeSubmissionResultWire {
    pub receipt: NativeReceipt,
    #[serde(deserialize_with = "required_nullable")]
    pub expert: Option<ExpertDisplay>,
    pub binding_revision: Revision,
}
impl TryFrom<NativeSubmissionResultWire> for NativeSubmissionResult {
    type Error = &'static str;
    fn try_from(w: NativeSubmissionResultWire) -> Result<Self, Self::Error> {
        let v = Self {
            receipt: w.receipt,
            expert: w.expert,
            binding_revision: w.binding_revision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeSubmissionResult {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_receipt = &self.receipt;
            value_receipt.validate()?;
        }
        {
            let value_expert = &self.expert;
            value_expert
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    value.validate()?;
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_binding_revision = &self.binding_revision;
            if *value_binding_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_binding_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeSubmissionResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeSubmissionResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SnapshotRequestWire")]
pub struct SnapshotRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: EmptyPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: EmptyPayload,
}
impl TryFrom<SnapshotRequestWire> for SnapshotRequest {
    type Error = &'static str;
    fn try_from(w: SnapshotRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SnapshotRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SnapshotRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SnapshotRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SnapshotResponseWire")]
pub struct SnapshotResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: CatalogSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: CatalogSnapshot,
}
impl TryFrom<SnapshotResponseWire> for SnapshotResponse {
    type Error = &'static str;
    fn try_from(w: SnapshotResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SnapshotResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SnapshotResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SnapshotResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrepareRequestWire")]
pub struct PrepareRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ResourcePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ResourcePayload,
}
impl TryFrom<PrepareRequestWire> for PrepareRequest {
    type Error = &'static str;
    fn try_from(w: PrepareRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrepareRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrepareRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrepareRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrepareResponseWire")]
pub struct PrepareResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<PrepareResponseWire> for PrepareResponse {
    type Error = &'static str;
    fn try_from(w: PrepareResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrepareResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrepareResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrepareResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RemoveRequestWire")]
pub struct RemoveRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ResourcePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ResourcePayload,
}
impl TryFrom<RemoveRequestWire> for RemoveRequest {
    type Error = &'static str;
    fn try_from(w: RemoveRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RemoveRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for RemoveRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RemoveRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RemoveResponseWire")]
pub struct RemoveResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoveResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<RemoveResponseWire> for RemoveResponse {
    type Error = &'static str;
    fn try_from(w: RemoveResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RemoveResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for RemoveResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RemoveResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "ResourceOperationReadRequestWire"
)]
pub struct ResourceOperationReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: OperationReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceOperationReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: OperationReadPayload,
}
impl TryFrom<ResourceOperationReadRequestWire> for ResourceOperationReadRequest {
    type Error = &'static str;
    fn try_from(w: ResourceOperationReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourceOperationReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourceOperationReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceOperationReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "ResourceOperationReadResponseWire"
)]
pub struct ResourceOperationReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceOperationReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<ResourceOperationReadResponseWire> for ResourceOperationReadResponse {
    type Error = &'static str;
    fn try_from(w: ResourceOperationReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourceOperationReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourceOperationReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceOperationReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingReadRequestWire")]
pub struct BindingReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingReadPayload,
}
impl TryFrom<BindingReadRequestWire> for BindingReadRequest {
    type Error = &'static str;
    fn try_from(w: BindingReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingReadResponseWire")]
pub struct BindingReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingView,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingView,
}
impl TryFrom<BindingReadResponseWire> for BindingReadResponse {
    type Error = &'static str;
    fn try_from(w: BindingReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingSetRequestWire")]
pub struct BindingSetRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingSetPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingSetRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingSetPayload,
}
impl TryFrom<BindingSetRequestWire> for BindingSetRequest {
    type Error = &'static str;
    fn try_from(w: BindingSetRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingSetRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingSetRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingSetRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingSetResponseWire")]
pub struct BindingSetResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingSetResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
impl TryFrom<BindingSetResponseWire> for BindingSetResponse {
    type Error = &'static str;
    fn try_from(w: BindingSetResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingSetResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingSetResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingSetResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingOperationReadRequestWire")]
pub struct BindingOperationReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingOperationReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingOperationReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingOperationReadPayload,
}
impl TryFrom<BindingOperationReadRequestWire> for BindingOperationReadRequest {
    type Error = &'static str;
    fn try_from(w: BindingOperationReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingOperationReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingOperationReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingOperationReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "BindingOperationReadResponseWire"
)]
pub struct BindingOperationReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingOperationReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
impl TryFrom<BindingOperationReadResponseWire> for BindingOperationReadResponse {
    type Error = &'static str;
    fn try_from(w: BindingOperationReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingOperationReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingOperationReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingOperationReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeSubmitRequestWire")]
pub struct NativeSubmitRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeSubmitPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeSubmitRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeSubmitPayload,
}
impl TryFrom<NativeSubmitRequestWire> for NativeSubmitRequest {
    type Error = &'static str;
    fn try_from(w: NativeSubmitRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeSubmitRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeSubmitRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeSubmitRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeSubmitResponseWire")]
pub struct NativeSubmitResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: NativeSubmissionResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeSubmitResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: NativeSubmissionResult,
}
impl TryFrom<NativeSubmitResponseWire> for NativeSubmitResponse {
    type Error = &'static str;
    fn try_from(w: NativeSubmitResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeSubmitResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeSubmitResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeSubmitResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApplyRequestWire")]
pub struct ApplyRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ApplyPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ApplyPayload,
}
impl TryFrom<ApplyRequestWire> for ApplyRequest {
    type Error = &'static str;
    fn try_from(w: ApplyRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApplyRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_apply_binding" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApplyRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApplyRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApplyResponseWire")]
pub struct ApplyResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
impl TryFrom<ApplyResponseWire> for ApplyResponse {
    type Error = &'static str;
    fn try_from(w: ApplyResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApplyResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApplyResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApplyResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateOperationReadRequestWire")]
pub struct PrivateOperationReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateOperationReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateOperationReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateOperationReadPayload,
}
impl TryFrom<PrivateOperationReadRequestWire> for PrivateOperationReadRequest {
    type Error = &'static str;
    fn try_from(w: PrivateOperationReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateOperationReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_operation_read" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateOperationReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateOperationReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateOperationReadResponseWire"
)]
pub struct PrivateOperationReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateOperationReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
impl TryFrom<PrivateOperationReadResponseWire> for PrivateOperationReadResponse {
    type Error = &'static str;
    fn try_from(w: PrivateOperationReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateOperationReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateOperationReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateOperationReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateGrantRequestWire")]
pub struct PrivateGrantRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateGrantPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateGrantRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateGrantPayload,
}
impl TryFrom<PrivateGrantRequestWire> for PrivateGrantRequest {
    type Error = &'static str;
    fn try_from(w: PrivateGrantRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateGrantRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_grant_register" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateGrantRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateGrantRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateGrantResponseWire")]
pub struct PrivateGrantResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateGrant,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateGrantResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateGrant,
}
impl TryFrom<PrivateGrantResponseWire> for PrivateGrantResponse {
    type Error = &'static str;
    fn try_from(w: PrivateGrantResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateGrantResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateGrantResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateGrantResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateSubmitRequestWire")]
pub struct PrivateSubmitRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: MarketSubmitTrigger,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateSubmitRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: MarketSubmitTrigger,
}
impl TryFrom<PrivateSubmitRequestWire> for PrivateSubmitRequest {
    type Error = &'static str;
    fn try_from(w: PrivateSubmitRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateSubmitRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_submit" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateSubmitRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateSubmitRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateSubmitResponseWire")]
pub struct PrivateSubmitResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateSubmitResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateReceipt,
}
impl TryFrom<PrivateSubmitResponseWire> for PrivateSubmitResponse {
    type Error = &'static str;
    fn try_from(w: PrivateSubmitResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateSubmitResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateSubmitResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateSubmitResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ErrorWire")]
pub struct Error {
    pub schema_version: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub request_id: Option<CanonicalId>,
    pub code: ErrorCode,
    pub retryable: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ErrorWire {
    pub schema_version: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub request_id: Option<CanonicalId>,
    pub code: ErrorCode,
    pub retryable: bool,
}
impl TryFrom<ErrorWire> for Error {
    type Error = &'static str;
    fn try_from(w: ErrorWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            code: w.code,
            retryable: w.retryable,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Error {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        self.request_id
            .as_ref()
            .map(|value_request_id| -> Result<(), &'static str> {
                if !canonical_id(value_request_id) {
                    return Err("invalid expert identity");
                }
                Ok(())
            })
            .transpose()?;
        if self.retryable && self.code != ErrorCode::TemporarilyUnavailable {
            return Err("expert error is not retryable");
        }
        Ok(())
    }
}
impl std::fmt::Debug for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Error([redacted])")
    }
}
pub type ResourcePath = String;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RoleResourceWire")]
pub struct RoleResource {
    pub path: ResourcePath,
    pub sha256: Digest,
    pub bytes: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoleResourceWire {
    pub path: ResourcePath,
    pub sha256: Digest,
    pub bytes: i64,
}
impl TryFrom<RoleResourceWire> for RoleResource {
    type Error = &'static str;
    fn try_from(w: RoleResourceWire) -> Result<Self, Self::Error> {
        let v = Self {
            path: w.path,
            sha256: w.sha256,
            bytes: w.bytes,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RoleResource {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_path = &self.path;
            if !resource_path(value_path) {
                return Err("invalid expert resource path");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        {
            let value_bytes = &self.bytes;
            if *value_bytes < 1 {
                return Err("invalid broker number");
            }
            if *value_bytes > 32768 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for RoleResource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RoleResource([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "KnowledgeResourceWire")]
pub struct KnowledgeResource {
    pub id: String,
    pub title: String,
    pub path: ResourcePath,
    pub sha256: Digest,
    pub bytes: i64,
    #[serde(rename = "content_version")]
    pub content_version: Version,
    #[serde(rename = "content_status")]
    pub content_status: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KnowledgeResourceWire {
    pub id: String,
    pub title: String,
    pub path: ResourcePath,
    pub sha256: Digest,
    pub bytes: i64,
    #[serde(rename = "content_version")]
    pub content_version: Version,
    #[serde(rename = "content_status")]
    pub content_status: String,
}
impl TryFrom<KnowledgeResourceWire> for KnowledgeResource {
    type Error = &'static str;
    fn try_from(w: KnowledgeResourceWire) -> Result<Self, Self::Error> {
        let v = Self {
            id: w.id,
            title: w.title,
            path: w.path,
            sha256: w.sha256,
            bytes: w.bytes,
            content_version: w.content_version,
            content_status: w.content_status,
        };
        v.validate()?;
        Ok(v)
    }
}
impl KnowledgeResource {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_id = &self.id;
            if value_id.chars().count() > 80 {
                return Err("invalid broker text");
            }
            if !slug(value_id, true) {
                return Err("invalid resource identity");
            }
        }
        {
            let value_title = &self.title;
            if value_title.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_title.chars().count() > 160 {
                return Err("invalid broker text");
            }
        }
        {
            let value_path = &self.path;
            if !resource_path(value_path) {
                return Err("invalid expert resource path");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        {
            let value_bytes = &self.bytes;
            if *value_bytes < 1 {
                return Err("invalid broker number");
            }
            if *value_bytes > 8388608 {
                return Err("invalid broker number");
            }
        }
        {
            let value_content_version = &self.content_version;
            if !semantic_version(value_content_version) {
                return Err("invalid expert version");
            }
        }
        {
            let value_content_status = &self.content_status;
            if ![
                "pending-review",
                "reviewed-reference",
                "conflicted",
                "incomplete",
            ]
            .contains(&value_content_status.as_str())
            {
                return Err("invalid broker enum");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for KnowledgeResource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("KnowledgeResource([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ExpertMetadataWire")]
pub struct ExpertMetadata {
    #[serde(rename = "expert_id")]
    pub expert_id: String,
    #[serde(rename = "source_id")]
    pub source_id: String,
    pub platform: String,
    pub subtitle: String,
    pub tags: Vec<String>,
    #[serde(rename = "quick_prompts")]
    pub quick_prompts: Vec<String>,
    #[serde(rename = "knowledge_summary")]
    pub knowledge_summary: String,
    #[serde(rename = "role_resource")]
    pub role_resource: RoleResource,
    #[serde(rename = "knowledge_resources")]
    pub knowledge_resources: Vec<KnowledgeResource>,
    #[serde(rename = "runtime_projection")]
    pub runtime_projection: String,
    #[serde(rename = "local_use_authorization")]
    pub local_use_authorization: LocalUseAuthorization,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpertMetadataWire {
    #[serde(rename = "expert_id")]
    pub expert_id: String,
    #[serde(rename = "source_id")]
    pub source_id: String,
    pub platform: String,
    pub subtitle: String,
    pub tags: Vec<String>,
    #[serde(rename = "quick_prompts")]
    pub quick_prompts: Vec<String>,
    #[serde(rename = "knowledge_summary")]
    pub knowledge_summary: String,
    #[serde(rename = "role_resource")]
    pub role_resource: RoleResource,
    #[serde(rename = "knowledge_resources")]
    pub knowledge_resources: Vec<KnowledgeResource>,
    #[serde(rename = "runtime_projection")]
    pub runtime_projection: String,
    #[serde(rename = "local_use_authorization")]
    pub local_use_authorization: LocalUseAuthorization,
}
impl TryFrom<ExpertMetadataWire> for ExpertMetadata {
    type Error = &'static str;
    fn try_from(w: ExpertMetadataWire) -> Result<Self, Self::Error> {
        let v = Self {
            expert_id: w.expert_id,
            source_id: w.source_id,
            platform: w.platform,
            subtitle: w.subtitle,
            tags: w.tags,
            quick_prompts: w.quick_prompts,
            knowledge_summary: w.knowledge_summary,
            role_resource: w.role_resource,
            knowledge_resources: w.knowledge_resources,
            runtime_projection: w.runtime_projection,
            local_use_authorization: w.local_use_authorization,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ExpertMetadata {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expert_id = &self.expert_id;
            if value_expert_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_expert_id.chars().count() > 64 {
                return Err("invalid broker text");
            }
            if !slug(value_expert_id, false) {
                return Err("invalid expert id");
            }
        }
        {
            let value_source_id = &self.source_id;
            if value_source_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_source_id.chars().count() > 128 {
                return Err("invalid broker text");
            }
            if !slug(value_source_id, true) {
                return Err("invalid resource identity");
            }
        }
        {
            let value_platform = &self.platform;
            if value_platform.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_platform.chars().count() > 64 {
                return Err("invalid broker text");
            }
        }
        {
            let value_subtitle = &self.subtitle;
            if value_subtitle.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_subtitle.chars().count() > 80 {
                return Err("invalid broker text");
            }
        }
        {
            let value_tags = &self.tags;
            if value_tags.len() > 8 {
                return Err("invalid broker collection");
            }
            for item in value_tags.iter() {
                if item.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if item.chars().count() > 40 {
                    return Err("invalid broker text");
                }
            }
            for (i, item) in value_tags.iter().enumerate() {
                if value_tags[..i].contains(item) {
                    return Err("duplicate broker collection item");
                }
            }
        }
        {
            let value_quick_prompts = &self.quick_prompts;
            if value_quick_prompts.len() > 3 {
                return Err("invalid broker collection");
            }
            for item in value_quick_prompts.iter() {
                if item.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if item.chars().count() > 500 {
                    return Err("invalid broker text");
                }
            }
            for (i, item) in value_quick_prompts.iter().enumerate() {
                if value_quick_prompts[..i].contains(item) {
                    return Err("duplicate broker collection item");
                }
            }
        }
        {
            let value_knowledge_summary = &self.knowledge_summary;
            if value_knowledge_summary.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_knowledge_summary.chars().count() > 300 {
                return Err("invalid broker text");
            }
        }
        {
            let value_role_resource = &self.role_resource;
            value_role_resource.validate()?;
        }
        {
            let value_knowledge_resources = &self.knowledge_resources;
            if value_knowledge_resources.is_empty() {
                return Err("invalid broker collection");
            }
            if value_knowledge_resources.len() > 32 {
                return Err("invalid broker collection");
            }
            for item in value_knowledge_resources.iter() {
                item.validate()?;
            }
            for (i, item) in value_knowledge_resources.iter().enumerate() {
                if value_knowledge_resources[..i].contains(item) {
                    return Err("duplicate broker collection item");
                }
            }
        }
        {
            let value_runtime_projection = &self.runtime_projection;
            if value_runtime_projection != "expert_only" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_local_use_authorization = &self.local_use_authorization;
            value_local_use_authorization.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ExpertMetadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ExpertMetadata([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionReadPayloadWire")]
pub struct SubmissionReadPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionReadPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
}
impl TryFrom<SubmissionReadPayloadWire> for SubmissionReadPayload {
    type Error = &'static str;
    fn try_from(w: SubmissionReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            task_id: w.task_id,
            local_session_id: w.local_session_id,
            turn_operation_id: w.turn_operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmissionReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_task_id = &self.task_id;
            if !canonical_id(value_task_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmissionReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmissionReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionReadRequestWire")]
pub struct SubmissionReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: SubmissionReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: SubmissionReadPayload,
}
impl TryFrom<SubmissionReadRequestWire> for SubmissionReadRequest {
    type Error = &'static str;
    fn try_from(w: SubmissionReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmissionReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_submission_read" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmissionReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmissionReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionReadResponseWire")]
pub struct SubmissionReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateReceipt,
}
impl TryFrom<SubmissionReadResponseWire> for SubmissionReadResponse {
    type Error = &'static str;
    fn try_from(w: SubmissionReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmissionReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmissionReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmissionReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "LocalUseAuthorizationWire")]
pub struct LocalUseAuthorization {
    pub status: String,
    #[serde(rename = "evidence_reference")]
    pub evidence_reference: ResourcePath,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalUseAuthorizationWire {
    pub status: String,
    #[serde(rename = "evidence_reference")]
    pub evidence_reference: ResourcePath,
}
impl TryFrom<LocalUseAuthorizationWire> for LocalUseAuthorization {
    type Error = &'static str;
    fn try_from(w: LocalUseAuthorizationWire) -> Result<Self, Self::Error> {
        let v = Self {
            status: w.status,
            evidence_reference: w.evidence_reference,
        };
        v.validate()?;
        Ok(v)
    }
}
impl LocalUseAuthorization {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_status = &self.status;
            if value_status != "local-use-authorized" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_evidence_reference = &self.evidence_reference;
            if !resource_path(value_evidence_reference) {
                return Err("invalid expert resource path");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for LocalUseAuthorization {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LocalUseAuthorization([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateStatusPayloadWire")]
pub struct PrivateStatusPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateStatusPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
}
impl TryFrom<PrivateStatusPayloadWire> for PrivateStatusPayload {
    type Error = &'static str;
    fn try_from(w: PrivateStatusPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateStatusPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateStatusPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateStatusPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateStatusWire")]
pub struct PrivateStatus {
    pub catalog_revision: Digest,
    pub execution_available: bool,
    pub resource_operations: Vec<ResourceOperation>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateStatusWire {
    pub catalog_revision: Digest,
    pub execution_available: bool,
    pub resource_operations: Vec<ResourceOperation>,
}
impl TryFrom<PrivateStatusWire> for PrivateStatus {
    type Error = &'static str;
    fn try_from(w: PrivateStatusWire) -> Result<Self, Self::Error> {
        let v = Self {
            catalog_revision: w.catalog_revision,
            execution_available: w.execution_available,
            resource_operations: w.resource_operations,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateStatus {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_catalog_revision = &self.catalog_revision;
            if value_catalog_revision.len() != 64
                || !value_catalog_revision
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err("invalid expert digest");
            }
        }
        {
            let value_resource_operations = &self.resource_operations;
            if value_resource_operations.len() > 64 {
                return Err("invalid broker collection");
            }
            for item in value_resource_operations.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateStatus([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateResourcePayloadWire")]
pub struct PrivateResourcePayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourcePayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub operation_id: CanonicalId,
    pub expert: ExpertSelection,
}
impl TryFrom<PrivateResourcePayloadWire> for PrivateResourcePayload {
    type Error = &'static str;
    fn try_from(w: PrivateResourcePayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            operation_id: w.operation_id,
            expert: w.expert,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourcePayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_expert = &self.expert;
            value_expert.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourcePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourcePayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateResourceReadPayloadWire")]
pub struct PrivateResourceReadPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceReadPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub operation_id: CanonicalId,
}
impl TryFrom<PrivateResourceReadPayloadWire> for PrivateResourceReadPayload {
    type Error = &'static str;
    fn try_from(w: PrivateResourceReadPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            operation_id: w.operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceReadPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid expert identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceReadPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceReadPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateStatusRequestWire")]
pub struct PrivateStatusRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateStatusPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateStatusRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateStatusPayload,
}
impl TryFrom<PrivateStatusRequestWire> for PrivateStatusRequest {
    type Error = &'static str;
    fn try_from(w: PrivateStatusRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateStatusRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_status" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateStatusRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateStatusRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateStatusResponseWire")]
pub struct PrivateStatusResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateStatusResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: PrivateStatus,
}
impl TryFrom<PrivateStatusResponseWire> for PrivateStatusResponse {
    type Error = &'static str;
    fn try_from(w: PrivateStatusResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateStatusResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateStatusResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateStatusResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourcePrepareRequestWire"
)]
pub struct PrivateResourcePrepareRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourcePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourcePrepareRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourcePayload,
}
impl TryFrom<PrivateResourcePrepareRequestWire> for PrivateResourcePrepareRequest {
    type Error = &'static str;
    fn try_from(w: PrivateResourcePrepareRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourcePrepareRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_resources_prepare" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourcePrepareRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourcePrepareRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourcePrepareResponseWire"
)]
pub struct PrivateResourcePrepareResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourcePrepareResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<PrivateResourcePrepareResponseWire> for PrivateResourcePrepareResponse {
    type Error = &'static str;
    fn try_from(w: PrivateResourcePrepareResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourcePrepareResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourcePrepareResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourcePrepareResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourceRemoveRequestWire"
)]
pub struct PrivateResourceRemoveRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourcePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceRemoveRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourcePayload,
}
impl TryFrom<PrivateResourceRemoveRequestWire> for PrivateResourceRemoveRequest {
    type Error = &'static str;
    fn try_from(w: PrivateResourceRemoveRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceRemoveRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_resources_remove" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceRemoveRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceRemoveRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourceRemoveResponseWire"
)]
pub struct PrivateResourceRemoveResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceRemoveResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<PrivateResourceRemoveResponseWire> for PrivateResourceRemoveResponse {
    type Error = &'static str;
    fn try_from(w: PrivateResourceRemoveResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceRemoveResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceRemoveResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceRemoveResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateResourceReadRequestWire")]
pub struct PrivateResourceReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourceReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourceReadPayload,
}
impl TryFrom<PrivateResourceReadRequestWire> for PrivateResourceReadRequest {
    type Error = &'static str;
    fn try_from(w: PrivateResourceReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_resources_operation_read" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "PrivateResourceReadResponseWire")]
pub struct PrivateResourceReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<PrivateResourceReadResponseWire> for PrivateResourceReadResponse {
    type Error = &'static str;
    fn try_from(w: PrivateResourceReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceReadResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingRecoverRequestWire")]
pub struct BindingRecoverRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingOperationReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingRecoverRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: BindingOperationReadPayload,
}
impl TryFrom<BindingRecoverRequestWire> for BindingRecoverRequest {
    type Error = &'static str;
    fn try_from(w: BindingRecoverRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingRecoverRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingRecoverRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingRecoverRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "BindingRecoverResponseWire")]
pub struct BindingRecoverResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingRecoverResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: BindingResult,
}
impl TryFrom<BindingRecoverResponseWire> for BindingRecoverResponse {
    type Error = &'static str;
    fn try_from(w: BindingRecoverResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl BindingRecoverResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for BindingRecoverResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BindingRecoverResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "ResourceOperationRecoverRequestWire"
)]
pub struct ResourceOperationRecoverRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: OperationReadPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceOperationRecoverRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: OperationReadPayload,
}
impl TryFrom<ResourceOperationRecoverRequestWire> for ResourceOperationRecoverRequest {
    type Error = &'static str;
    fn try_from(w: ResourceOperationRecoverRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourceOperationRecoverRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourceOperationRecoverRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceOperationRecoverRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "ResourceOperationRecoverResponseWire"
)]
pub struct ResourceOperationRecoverResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceOperationRecoverResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<ResourceOperationRecoverResponseWire> for ResourceOperationRecoverResponse {
    type Error = &'static str;
    fn try_from(w: ResourceOperationRecoverResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ResourceOperationRecoverResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ResourceOperationRecoverResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceOperationRecoverResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateBindingRecoverPayloadWire"
)]
pub struct PrivateBindingRecoverPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub original: ApplyPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateBindingRecoverPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub original: ApplyPayload,
}
impl TryFrom<PrivateBindingRecoverPayloadWire> for PrivateBindingRecoverPayload {
    type Error = &'static str;
    fn try_from(w: PrivateBindingRecoverPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            original: w.original,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateBindingRecoverPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_original = &self.original;
            value_original.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateBindingRecoverPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateBindingRecoverPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourceRecoverPayloadWire"
)]
pub struct PrivateResourceRecoverPayload {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub original: PrivateResourcePayload,
    pub action: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceRecoverPayloadWire {
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub original: PrivateResourcePayload,
    pub action: String,
}
impl TryFrom<PrivateResourceRecoverPayloadWire> for PrivateResourceRecoverPayload {
    type Error = &'static str;
    fn try_from(w: PrivateResourceRecoverPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            original: w.original,
            action: w.action,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceRecoverPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_original = &self.original;
            value_original.validate()?;
        }
        {
            let value_action = &self.action;
            if !["prepare", "remove"].contains(&value_action.as_str()) {
                return Err("invalid broker enum");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceRecoverPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceRecoverPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateBindingRecoverRequestWire"
)]
pub struct PrivateBindingRecoverRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateBindingRecoverPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateBindingRecoverRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateBindingRecoverPayload,
}
impl TryFrom<PrivateBindingRecoverRequestWire> for PrivateBindingRecoverRequest {
    type Error = &'static str;
    fn try_from(w: PrivateBindingRecoverRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateBindingRecoverRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_binding_recover" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateBindingRecoverRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateBindingRecoverRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourceRecoverRequestWire"
)]
pub struct PrivateResourceRecoverRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourceRecoverPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceRecoverRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: PrivateResourceRecoverPayload,
}
impl TryFrom<PrivateResourceRecoverRequestWire> for PrivateResourceRecoverRequest {
    type Error = &'static str;
    fn try_from(w: PrivateResourceRecoverRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            method: w.method,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceRecoverRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "expert_resources_recover" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceRecoverRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceRecoverRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateBindingRecoverResponseWire"
)]
pub struct PrivateBindingRecoverResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateBindingRecoverResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApplyReceipt,
}
impl TryFrom<PrivateBindingRecoverResponseWire> for PrivateBindingRecoverResponse {
    type Error = &'static str;
    fn try_from(w: PrivateBindingRecoverResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateBindingRecoverResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateBindingRecoverResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateBindingRecoverResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "PrivateResourceRecoverResponseWire"
)]
pub struct PrivateResourceRecoverResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateResourceRecoverResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ResourceOperation,
}
impl TryFrom<PrivateResourceRecoverResponseWire> for PrivateResourceRecoverResponse {
    type Error = &'static str;
    fn try_from(w: PrivateResourceRecoverResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl PrivateResourceRecoverResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for PrivateResourceRecoverResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivateResourceRecoverResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "DeveloperInfoWire")]
pub struct DeveloperInfo {
    pub expert: ExpertSelection,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeveloperInfoWire {
    pub expert: ExpertSelection,
    pub name: String,
}
impl TryFrom<DeveloperInfoWire> for DeveloperInfo {
    type Error = &'static str;
    fn try_from(w: DeveloperInfoWire) -> Result<Self, Self::Error> {
        let v = Self {
            expert: w.expert,
            name: w.name,
        };
        v.validate()?;
        Ok(v)
    }
}
impl DeveloperInfo {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expert = &self.expert;
            value_expert.validate()?;
        }
        {
            let value_name = &self.name;
            if value_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_name.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for DeveloperInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeveloperInfo([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "DeveloperReadRequestWire")]
pub struct DeveloperReadRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ExpertSelection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeveloperReadRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: ExpertSelection,
}
impl TryFrom<DeveloperReadRequestWire> for DeveloperReadRequest {
    type Error = &'static str;
    fn try_from(w: DeveloperReadRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            context_id: w.context_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl DeveloperReadRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for DeveloperReadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeveloperReadRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "DeveloperReadResponseWire")]
pub struct DeveloperReadResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: DeveloperInfo,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeveloperReadResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: DeveloperInfo,
}
impl TryFrom<DeveloperReadResponseWire> for DeveloperReadResponse {
    type Error = &'static str;
    fn try_from(w: DeveloperReadResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl DeveloperReadResponse {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if !canonical_id(value_request_id) {
                return Err("invalid expert identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for DeveloperReadResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeveloperReadResponse([redacted])")
    }
}

fn canonical_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && s != "00000000-0000-0000-0000-000000000000"
        && b.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(c)
            }
        })
}
fn slug(s: &str, dot: bool) -> bool {
    !s.is_empty()
        && s.split(|c| c == '-' || (dot && c == '.')).all(|v| {
            !v.is_empty()
                && v.bytes()
                    .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase())
        })
}
fn semantic_version(s: &str) -> bool {
    let mut plus = s.split('+');
    let first = plus.next().unwrap_or("");
    let suffix = |v: &str| {
        !v.is_empty()
            && v.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
    };
    if plus.next().is_some_and(|v| !suffix(v)) || plus.next().is_some() {
        return false;
    }
    let (core, pre) = first
        .split_once('-')
        .map_or((first, None), |(c, p)| (c, Some(p)));
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|v| {
            !v.is_empty()
                && (v.len() == 1 || !v.starts_with('0'))
                && v.bytes().all(|c| c.is_ascii_digit())
        })
        && pre.is_none_or(suffix)
}
fn resource_path(s: &str) -> bool {
    !s.is_empty()
        && s.chars().count() <= 512
        && !s.starts_with('/')
        && !s.contains('\\')
        && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        && !s.split('/').any(|p| p == "..")
}
pub fn canonical_snapshot_bytes(
    turn: &str,
    revision: i64,
    expert: Option<&ExpertRef>,
) -> Result<Vec<u8>, &'static str> {
    if !canonical_id(turn) || !(0..=9007199254740991).contains(&revision) {
        return Err("invalid snapshot identity");
    }
    let mut text = format!("yijie.expert-snapshot/v1\n{}\n{}\n", turn, revision);
    if let Some(e) = expert {
        e.validate()?;
        text.push_str(&format!(
            "expert\n{}\n{}\n{}\n{}\n{}\n",
            e.expert_id, e.version, e.archive_sha256, e.role_sha256, e.knowledge_manifest_sha256
        ));
    } else {
        text.push_str("none\n");
    }
    Ok(text.into_bytes())
}
pub fn snapshot_digest(
    turn: &str,
    revision: i64,
    expert: Option<&ExpertRef>,
) -> Result<String, &'static str> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_snapshot_bytes(turn, revision, expert)?)
    ))
}
pub fn freeze_snapshot(
    turn_operation_id: String,
    binding_revision: i64,
    expert: Option<ExpertRef>,
) -> Result<TurnExpertSnapshot, &'static str> {
    let snapshot_digest = snapshot_digest(&turn_operation_id, binding_revision, expert.as_ref())?;
    Ok(TurnExpertSnapshot {
        format_version: 1,
        turn_operation_id,
        binding_revision,
        expert,
        snapshot_digest,
    })
}
pub fn canonical_knowledge_manifest_bytes(
    resources: &[KnowledgeResource],
) -> Result<Vec<u8>, &'static str> {
    if resources.is_empty() || resources.len() > 32 {
        return Err("invalid knowledge count");
    }
    let mut refs = resources.iter().collect::<Vec<_>>();
    refs.sort_by(|a, b| a.id.cmp(&b.id));
    let mut out = format!("yijie.expert-knowledge/v1\n{}\n", refs.len()).into_bytes();
    for (i, r) in refs.iter().enumerate() {
        r.validate()?;
        if i > 0 && refs[i - 1].id == r.id {
            return Err("duplicate knowledge id");
        }
        for v in [
            &r.id,
            &r.title,
            &r.path,
            &r.sha256,
            &r.bytes.to_string(),
            &r.content_version,
            &r.content_status,
        ] {
            out.extend_from_slice(format!("{}:", v.len()).as_bytes());
            out.extend_from_slice(v.as_bytes());
        }
        out.push(b'\n');
    }
    Ok(out)
}
pub fn knowledge_manifest_digest(resources: &[KnowledgeResource]) -> Result<String, &'static str> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_knowledge_manifest_bytes(resources)?)
    ))
}
pub const EXPERT_APPLY_BINDING_TIMEOUT_MS: u64 = 20000;
pub const EXPERT_OPERATION_READ_TIMEOUT_MS: u64 = 5000;
pub const EXPERT_GRANT_REGISTER_TIMEOUT_MS: u64 = 5000;
pub const EXPERT_SUBMIT_TIMEOUT_MS: u64 = 25000;
pub const EXPERT_SUBMISSION_READ_TIMEOUT_MS: u64 = 5000;
pub const EXPERT_STATUS_TIMEOUT_MS: u64 = 5000;
pub const EXPERT_RESOURCES_PREPARE_TIMEOUT_MS: u64 = 25000;
pub const EXPERT_RESOURCES_REMOVE_TIMEOUT_MS: u64 = 25000;
pub const EXPERT_RESOURCES_OPERATION_READ_TIMEOUT_MS: u64 = 5000;
pub const EXPERT_BINDING_RECOVER_TIMEOUT_MS: u64 = 20000;
pub const EXPERT_RESOURCES_RECOVER_TIMEOUT_MS: u64 = 25000;
pub const NATIVE_RESPONSE_TIMEOUT_MS: u64 = 30000;
