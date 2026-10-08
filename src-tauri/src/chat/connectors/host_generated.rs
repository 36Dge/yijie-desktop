// Generated from market-host source and referenced authorities; DO NOT EDIT.
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
pub use super::generated::CanonicalId;
pub use super::generated::SelectionRef;
pub use super::generated::ServiceId;
pub use super::selection_generated::SelectionDigest;
pub use super::selection_generated::SelectionSnapshot;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ModelIntentWire")]
pub struct ModelIntent {
    pub profile_id: ProfileId,
    pub expected_revision: ModelRevision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelIntentWire {
    pub profile_id: ProfileId,
    pub expected_revision: ModelRevision,
}
impl TryFrom<ModelIntentWire> for ModelIntent {
    type Error = &'static str;
    fn try_from(w: ModelIntentWire) -> Result<Self, Self::Error> {
        let v = Self {
            profile_id: w.profile_id,
            expected_revision: w.expected_revision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ModelIntent {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_expected_revision = &self.expected_revision;
            if *value_expected_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_expected_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ModelIntent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ModelIntent([redacted])")
    }
}
pub use crate::chat::models_generated::ProfileId;
pub type ModelRevision = i64;
pub use super::broker_generated::CallIdentity;
pub use super::broker_generated::Decision;
pub use super::broker_generated::NativeId;
pub use super::broker_generated::ReviewProjection;
pub use super::broker_generated::ScopeBinding;
pub use super::generated::Revision;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionMode {
    #[serde(rename = "ask")]
    Ask,
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "full")]
    Full,
}
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum ContentBlock {
    Text(Box<StartTurnV2TextBlock>),
    Image(Box<StartTurnV2ImageBlock>),
    File(Box<StartTurnV2FileBlock>),
}
impl ContentBlock {
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Text(x) => x.validate(),
            Self::Image(x) => x.validate(),
            Self::File(x) => x.validate(),
        }
    }
}
impl std::fmt::Debug for ContentBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ContentBlock([redacted])")
    }
}
pub use super::provider_generated::ProviderBinding as ServiceBinding;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionWire")]
pub struct Submission {
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub agent_session_id: Option<CanonicalId>,
    pub submission_operation_id: CanonicalId,
    pub cwd: String,
    pub content_blocks: Vec<ContentBlock>,
    pub intent: ModelIntent,
    pub permission_mode: PermissionMode,
    pub snapshot: SelectionSnapshot,
    pub services: Vec<ServiceBinding>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmissionWire {
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub agent_session_id: Option<CanonicalId>,
    pub submission_operation_id: CanonicalId,
    pub cwd: String,
    pub content_blocks: Vec<ContentBlock>,
    pub intent: ModelIntent,
    pub permission_mode: PermissionMode,
    pub snapshot: SelectionSnapshot,
    pub services: Vec<ServiceBinding>,
}
impl TryFrom<SubmissionWire> for Submission {
    type Error = &'static str;
    fn try_from(w: SubmissionWire) -> Result<Self, Self::Error> {
        let v = Self {
            task_id: w.task_id,
            local_session_id: w.local_session_id,
            agent_session_id: w.agent_session_id,
            submission_operation_id: w.submission_operation_id,
            cwd: w.cwd,
            content_blocks: w.content_blocks,
            intent: w.intent,
            permission_mode: w.permission_mode,
            snapshot: w.snapshot,
            services: w.services,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Submission {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_task_id = &self.task_id;
            if !canonical_id(value_task_id) {
                return Err("invalid market UUID");
            }
            if value_task_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid market UUID");
            }
            if value_local_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            value_agent_session_id
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if !canonical_id(value) {
                        return Err("invalid market UUID");
                    }
                    if value == "00000000-0000-0000-0000-000000000000" {
                        return Err("invalid broker identity");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_submission_operation_id = &self.submission_operation_id;
            if !canonical_id(value_submission_operation_id) {
                return Err("invalid market UUID");
            }
            if value_submission_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_cwd = &self.cwd;
            if value_cwd.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_cwd.chars().count() > 4096 {
                return Err("invalid broker text");
            }
        }
        {
            let value_content_blocks = &self.content_blocks;
            if value_content_blocks.is_empty() {
                return Err("invalid broker collection");
            }
            if value_content_blocks.len() > 16 {
                return Err("invalid broker collection");
            }
            for item in value_content_blocks.iter() {
                item.validate()?;
            }
        }
        {
            let value_intent = &self.intent;
            value_intent.validate()?;
        }
        {
            let value_snapshot = &self.snapshot;
            value_snapshot.validate()?;
        }
        {
            let value_services = &self.services;
            if value_services.len() > 51 {
                return Err("invalid broker collection");
            }
            for item in value_services.iter() {
                item.validate()?;
            }
        }
        if self.services.len() != self.snapshot.selection.len()
            || self
                .services
                .iter()
                .zip(&self.snapshot.selection)
                .any(|(s, r)| &s.reference != r)
        {
            return Err("service snapshot mismatch");
        }
        if !self.snapshot.selection.is_empty() && self.permission_mode != PermissionMode::Ask {
            return Err("permission_mode_unavailable");
        }
        if self.agent_session_id.is_none() && self.intent.expected_revision != 0 {
            return Err("invalid new session revision");
        }
        Ok(())
    }
}
impl std::fmt::Debug for Submission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Submission([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "HelloPayloadWire")]
pub struct HelloPayload {
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub owner_user_id: CanonicalId,
    pub tenant_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelloPayloadWire {
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub owner_user_id: CanonicalId,
    pub tenant_id: CanonicalId,
}
impl TryFrom<HelloPayloadWire> for HelloPayload {
    type Error = &'static str;
    fn try_from(w: HelloPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            native_process_epoch: w.native_process_epoch,
            owner_user_id: w.owner_user_id,
            tenant_id: w.tenant_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl HelloPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_native_process_epoch = &self.native_process_epoch;
            if !canonical_id(value_native_process_epoch) {
                return Err("invalid market UUID");
            }
            if value_native_process_epoch == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_owner_user_id = &self.owner_user_id;
            if !canonical_id(value_owner_user_id) {
                return Err("invalid market UUID");
            }
            if value_owner_user_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_tenant_id = &self.tenant_id;
            if !canonical_id(value_tenant_id) {
                return Err("invalid market UUID");
            }
            if value_tenant_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for HelloPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HelloPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "HelloResultWire")]
pub struct HelloResult {
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub owner_user_id: CanonicalId,
    pub tenant_id: CanonicalId,
    pub ready: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloResultWire {
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub owner_user_id: CanonicalId,
    pub tenant_id: CanonicalId,
    pub ready: bool,
}
impl TryFrom<HelloResultWire> for HelloResult {
    type Error = &'static str;
    fn try_from(w: HelloResultWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            native_process_epoch: w.native_process_epoch,
            owner_user_id: w.owner_user_id,
            tenant_id: w.tenant_id,
            ready: w.ready,
        };
        v.validate()?;
        Ok(v)
    }
}
impl HelloResult {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_native_process_epoch = &self.native_process_epoch;
            if !canonical_id(value_native_process_epoch) {
                return Err("invalid market UUID");
            }
            if value_native_process_epoch == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_owner_user_id = &self.owner_user_id;
            if !canonical_id(value_owner_user_id) {
                return Err("invalid market UUID");
            }
            if value_owner_user_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_tenant_id = &self.tenant_id;
            if !canonical_id(value_tenant_id) {
                return Err("invalid market UUID");
            }
            if value_tenant_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_ready = &self.ready;
            if !*value_ready {
                return Err("invalid broker constant");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for HelloResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HelloResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "GrantRegisterPayloadWire")]
pub struct GrantRegisterPayload {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub submission: Submission,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantRegisterPayloadWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub submission: Submission,
}
impl TryFrom<GrantRegisterPayloadWire> for GrantRegisterPayload {
    type Error = &'static str;
    fn try_from(w: GrantRegisterPayloadWire) -> Result<Self, Self::Error> {
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
impl GrantRegisterPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid market UUID");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
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
impl std::fmt::Debug for GrantRegisterPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantRegisterPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "GrantRegistrationWire")]
pub struct GrantRegistration {
    pub grant_ref: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub remaining_ttl_ms: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantRegistrationWire {
    pub grant_ref: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub native_process_epoch: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub remaining_ttl_ms: i64,
}
impl TryFrom<GrantRegistrationWire> for GrantRegistration {
    type Error = &'static str;
    fn try_from(w: GrantRegistrationWire) -> Result<Self, Self::Error> {
        let v = Self {
            grant_ref: w.grant_ref,
            host_instance_id: w.host_instance_id,
            native_process_epoch: w.native_process_epoch,
            turn_operation_id: w.turn_operation_id,
            selection_digest: w.selection_digest,
            remaining_ttl_ms: w.remaining_ttl_ms,
        };
        v.validate()?;
        Ok(v)
    }
}
impl GrantRegistration {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_grant_ref = &self.grant_ref;
            if !canonical_id(value_grant_ref) {
                return Err("invalid market UUID");
            }
            if value_grant_ref == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_native_process_epoch = &self.native_process_epoch;
            if !canonical_id(value_native_process_epoch) {
                return Err("invalid market UUID");
            }
            if value_native_process_epoch == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid market UUID");
            }
            if value_turn_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_selection_digest = &self.selection_digest;
            if value_selection_digest.len() != 64
                || !value_selection_digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid market digest");
            }
        }
        {
            let value_remaining_ttl_ms = &self.remaining_ttl_ms;
            if *value_remaining_ttl_ms < 0 {
                return Err("invalid broker number");
            }
            if *value_remaining_ttl_ms > 300000 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for GrantRegistration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantRegistration([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RevokeAuthorityPayloadWire")]
pub struct RevokeAuthorityPayload {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub installation_id: Option<CanonicalId>,
    pub reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeAuthorityPayloadWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub installation_id: Option<CanonicalId>,
    pub reason: String,
}
impl TryFrom<RevokeAuthorityPayloadWire> for RevokeAuthorityPayload {
    type Error = &'static str;
    fn try_from(w: RevokeAuthorityPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            installation_id: w.installation_id,
            reason: w.reason,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RevokeAuthorityPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid market UUID");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        self.installation_id
            .as_ref()
            .map(|value_installation_id| -> Result<(), &'static str> {
                if !canonical_id(value_installation_id) {
                    return Err("invalid market UUID");
                }
                if value_installation_id == "00000000-0000-0000-0000-000000000000" {
                    return Err("invalid broker identity");
                }
                Ok(())
            })
            .transpose()?;
        {
            let value_reason = &self.reason;
            if ![
                "authorization_changed",
                "installation_changed",
                "native_shutdown",
            ]
            .contains(&value_reason.as_str())
            {
                return Err("invalid broker enum");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for RevokeAuthorityPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RevokeAuthorityPayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RevokeAuthorityResultWire")]
pub struct RevokeAuthorityResult {
    pub outcome: String,
    pub external_outcomes: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevokeAuthorityResultWire {
    pub outcome: String,
    pub external_outcomes: String,
}
impl TryFrom<RevokeAuthorityResultWire> for RevokeAuthorityResult {
    type Error = &'static str;
    fn try_from(w: RevokeAuthorityResultWire) -> Result<Self, Self::Error> {
        let v = Self {
            outcome: w.outcome,
            external_outcomes: w.external_outcomes,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RevokeAuthorityResult {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_outcome = &self.outcome;
            if !["admission_revoked", "retirement_pending"].contains(&value_outcome.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_external_outcomes = &self.external_outcomes;
            if value_external_outcomes != "not_asserted" {
                return Err("invalid broker constant");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for RevokeAuthorityResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RevokeAuthorityResult([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubmissionState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "accepted")]
    Accepted,
    #[serde(rename = "uncertain")]
    Uncertain,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmissionReceiptWire")]
pub struct SubmissionReceipt {
    pub host_instance_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub runtime_generation: Option<CanonicalId>,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub state: SubmissionState,
    #[serde(deserialize_with = "required_nullable")]
    pub agent_session_id: Option<CanonicalId>,
    #[serde(deserialize_with = "required_nullable")]
    pub native_thread_id: Option<NativeId>,
    #[serde(deserialize_with = "required_nullable")]
    pub native_turn_id: Option<NativeId>,
    pub profile_id: ProfileId,
    pub model_revision: ModelRevision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionReceiptWire {
    pub host_instance_id: CanonicalId,
    #[serde(deserialize_with = "required_nullable")]
    pub runtime_generation: Option<CanonicalId>,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub state: SubmissionState,
    #[serde(deserialize_with = "required_nullable")]
    pub agent_session_id: Option<CanonicalId>,
    #[serde(deserialize_with = "required_nullable")]
    pub native_thread_id: Option<NativeId>,
    #[serde(deserialize_with = "required_nullable")]
    pub native_turn_id: Option<NativeId>,
    pub profile_id: ProfileId,
    pub model_revision: ModelRevision,
}
impl TryFrom<SubmissionReceiptWire> for SubmissionReceipt {
    type Error = &'static str;
    fn try_from(w: SubmissionReceiptWire) -> Result<Self, Self::Error> {
        let v = Self {
            host_instance_id: w.host_instance_id,
            runtime_generation: w.runtime_generation,
            task_id: w.task_id,
            local_session_id: w.local_session_id,
            submission_operation_id: w.submission_operation_id,
            turn_operation_id: w.turn_operation_id,
            selection_digest: w.selection_digest,
            state: w.state,
            agent_session_id: w.agent_session_id,
            native_thread_id: w.native_thread_id,
            native_turn_id: w.native_turn_id,
            profile_id: w.profile_id,
            model_revision: w.model_revision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmissionReceipt {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_runtime_generation = &self.runtime_generation;
            value_runtime_generation
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if !canonical_id(value) {
                        return Err("invalid market UUID");
                    }
                    if value == "00000000-0000-0000-0000-000000000000" {
                        return Err("invalid broker identity");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_task_id = &self.task_id;
            if !canonical_id(value_task_id) {
                return Err("invalid market UUID");
            }
            if value_task_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_local_session_id = &self.local_session_id;
            if !canonical_id(value_local_session_id) {
                return Err("invalid market UUID");
            }
            if value_local_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_submission_operation_id = &self.submission_operation_id;
            if !canonical_id(value_submission_operation_id) {
                return Err("invalid market UUID");
            }
            if value_submission_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid market UUID");
            }
            if value_turn_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_selection_digest = &self.selection_digest;
            if value_selection_digest.len() != 64
                || !value_selection_digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid market digest");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            value_agent_session_id
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if !canonical_id(value) {
                        return Err("invalid market UUID");
                    }
                    if value == "00000000-0000-0000-0000-000000000000" {
                        return Err("invalid broker identity");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_native_thread_id = &self.native_thread_id;
            value_native_thread_id
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if value.chars().count() < 1 {
                        return Err("invalid broker text");
                    }
                    if value.chars().count() > 256 {
                        return Err("invalid broker text");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_native_turn_id = &self.native_turn_id;
            value_native_turn_id
                .as_ref()
                .map(|value| -> Result<(), &'static str> {
                    if value.chars().count() < 1 {
                        return Err("invalid broker text");
                    }
                    if value.chars().count() > 256 {
                        return Err("invalid broker text");
                    }
                    Ok(())
                })
                .transpose()?;
        }
        {
            let value_model_revision = &self.model_revision;
            if *value_model_revision < 0 {
                return Err("invalid broker number");
            }
            if *value_model_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        if self.state == SubmissionState::Accepted
            && (self.agent_session_id.is_none()
                || self.native_thread_id.is_none()
                || self.native_turn_id.is_none()
                || self.runtime_generation.is_none())
        {
            return Err("accepted receipt missing native fact");
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmissionReceipt {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmissionReceipt([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitPayloadWire")]
pub struct SubmitPayload {
    pub grant_ref: CanonicalId,
    pub turn_operation_id: CanonicalId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitPayloadWire {
    pub grant_ref: CanonicalId,
    pub turn_operation_id: CanonicalId,
}
impl TryFrom<SubmitPayloadWire> for SubmitPayload {
    type Error = &'static str;
    fn try_from(w: SubmitPayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            grant_ref: w.grant_ref,
            turn_operation_id: w.turn_operation_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_grant_ref = &self.grant_ref;
            if !canonical_id(value_grant_ref) {
                return Err("invalid market UUID");
            }
            if value_grant_ref == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if !canonical_id(value_turn_operation_id) {
                return Err("invalid market UUID");
            }
            if value_turn_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitPayload([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "approved")]
    Approved,
    #[serde(rename = "rejected")]
    Rejected,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "unavailable")]
    Unavailable,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "MarketApprovalWire")]
pub struct MarketApproval {
    pub approval_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub kind: String,
    pub revision: Revision,
    pub state: ApprovalState,
    pub identity: CallIdentity,
    pub review: ReviewProjection,
    pub expires_at_unix_ms: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub decision_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub decision: Option<Decision>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketApprovalWire {
    pub approval_id: CanonicalId,
    pub agent_session_id: CanonicalId,
    pub kind: String,
    pub revision: Revision,
    pub state: ApprovalState,
    pub identity: CallIdentity,
    pub review: ReviewProjection,
    pub expires_at_unix_ms: i64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub decision_id: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub decision: Option<Decision>,
}
impl TryFrom<MarketApprovalWire> for MarketApproval {
    type Error = &'static str;
    fn try_from(w: MarketApprovalWire) -> Result<Self, Self::Error> {
        let v = Self {
            approval_id: w.approval_id,
            agent_session_id: w.agent_session_id,
            kind: w.kind,
            revision: w.revision,
            state: w.state,
            identity: w.identity,
            review: w.review,
            expires_at_unix_ms: w.expires_at_unix_ms,
            decision_id: w.decision_id,
            decision: w.decision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl MarketApproval {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_approval_id = &self.approval_id;
            if !canonical_id(value_approval_id) {
                return Err("invalid market UUID");
            }
            if value_approval_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid market UUID");
            }
            if value_agent_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_kind = &self.kind;
            if value_kind != "mcp_market" {
                return Err("invalid broker constant");
            }
        }
        {
            let value_revision = &self.revision;
            if *value_revision < 1 {
                return Err("invalid broker number");
            }
            if *value_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_identity = &self.identity;
            value_identity.validate()?;
        }
        {
            let value_review = &self.review;
            value_review.validate()?;
        }
        {
            let value_expires_at_unix_ms = &self.expires_at_unix_ms;
            if *value_expires_at_unix_ms < 1 {
                return Err("invalid broker number");
            }
            if *value_expires_at_unix_ms > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        self.decision_id
            .as_ref()
            .map(|value_decision_id| -> Result<(), &'static str> {
                if !canonical_id(value_decision_id) {
                    return Err("invalid market UUID");
                }
                if value_decision_id == "00000000-0000-0000-0000-000000000000" {
                    return Err("invalid broker identity");
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for MarketApproval {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MarketApproval([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApprovalDecidePayloadWire")]
pub struct ApprovalDecidePayload {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub agent_session_id: CanonicalId,
    pub approval_id: CanonicalId,
    pub call_ref: CanonicalId,
    pub expected_revision: Revision,
    pub decision_id: CanonicalId,
    pub decision: Decision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalDecidePayloadWire {
    pub operation_id: CanonicalId,
    pub host_instance_id: CanonicalId,
    pub scope: ScopeBinding,
    pub agent_session_id: CanonicalId,
    pub approval_id: CanonicalId,
    pub call_ref: CanonicalId,
    pub expected_revision: Revision,
    pub decision_id: CanonicalId,
    pub decision: Decision,
}
impl TryFrom<ApprovalDecidePayloadWire> for ApprovalDecidePayload {
    type Error = &'static str;
    fn try_from(w: ApprovalDecidePayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            operation_id: w.operation_id,
            host_instance_id: w.host_instance_id,
            scope: w.scope,
            agent_session_id: w.agent_session_id,
            approval_id: w.approval_id,
            call_ref: w.call_ref,
            expected_revision: w.expected_revision,
            decision_id: w.decision_id,
            decision: w.decision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApprovalDecidePayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_operation_id = &self.operation_id;
            if !canonical_id(value_operation_id) {
                return Err("invalid market UUID");
            }
            if value_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if !canonical_id(value_host_instance_id) {
                return Err("invalid market UUID");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_scope = &self.scope;
            value_scope.validate()?;
        }
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid market UUID");
            }
            if value_agent_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_approval_id = &self.approval_id;
            if !canonical_id(value_approval_id) {
                return Err("invalid market UUID");
            }
            if value_approval_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_call_ref = &self.call_ref;
            if !canonical_id(value_call_ref) {
                return Err("invalid market UUID");
            }
            if value_call_ref == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_expected_revision = &self.expected_revision;
            if *value_expected_revision < 1 {
                return Err("invalid broker number");
            }
            if *value_expected_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        {
            let value_decision_id = &self.decision_id;
            if !canonical_id(value_decision_id) {
                return Err("invalid market UUID");
            }
            if value_decision_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApprovalDecidePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApprovalDecidePayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApprovalSnapshotWire")]
pub struct ApprovalSnapshot {
    pub agent_session_id: CanonicalId,
    pub requests: Vec<MarketApproval>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalSnapshotWire {
    pub agent_session_id: CanonicalId,
    pub requests: Vec<MarketApproval>,
}
impl TryFrom<ApprovalSnapshotWire> for ApprovalSnapshot {
    type Error = &'static str;
    fn try_from(w: ApprovalSnapshotWire) -> Result<Self, Self::Error> {
        let v = Self {
            agent_session_id: w.agent_session_id,
            requests: w.requests,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApprovalSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid market UUID");
            }
            if value_agent_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_requests = &self.requests;
            if value_requests.len() > 128 {
                return Err("invalid broker collection");
            }
            for item in value_requests.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApprovalSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApprovalSnapshot([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ToolObservationWire")]
pub struct ToolObservation {
    pub native_item_id: NativeId,
    pub native_thread_id: NativeId,
    pub native_turn_id: NativeId,
    pub server_name: String,
    pub tool_name: String,
    pub state: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub service: Option<ServiceBinding>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub call_ref: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub result_text: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<String>,
    pub truncated: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolObservationWire {
    pub native_item_id: NativeId,
    pub native_thread_id: NativeId,
    pub native_turn_id: NativeId,
    pub server_name: String,
    pub tool_name: String,
    pub state: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub service: Option<ServiceBinding>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub call_ref: Option<CanonicalId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub result_text: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub error_code: Option<String>,
    pub truncated: bool,
}
impl TryFrom<ToolObservationWire> for ToolObservation {
    type Error = &'static str;
    fn try_from(w: ToolObservationWire) -> Result<Self, Self::Error> {
        let v = Self {
            native_item_id: w.native_item_id,
            native_thread_id: w.native_thread_id,
            native_turn_id: w.native_turn_id,
            server_name: w.server_name,
            tool_name: w.tool_name,
            state: w.state,
            service: w.service,
            call_ref: w.call_ref,
            result_text: w.result_text,
            error_code: w.error_code,
            truncated: w.truncated,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ToolObservation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_native_item_id = &self.native_item_id;
            if value_native_item_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_item_id.chars().count() > 256 {
                return Err("invalid broker text");
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
            let value_native_turn_id = &self.native_turn_id;
            if value_native_turn_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_turn_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_server_name = &self.server_name;
            if value_server_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_server_name.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        {
            let value_tool_name = &self.tool_name;
            if value_tool_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_tool_name.chars().count() > 128 {
                return Err("invalid broker text");
            }
        }
        {
            let value_state = &self.state;
            if !["in_progress", "completed", "failed"].contains(&value_state.as_str()) {
                return Err("invalid broker enum");
            }
        }
        self.service
            .as_ref()
            .map(|value_service| -> Result<(), &'static str> {
                value_service.validate()?;
                Ok(())
            })
            .transpose()?;
        self.call_ref
            .as_ref()
            .map(|value_call_ref| -> Result<(), &'static str> {
                if !canonical_id(value_call_ref) {
                    return Err("invalid market UUID");
                }
                if value_call_ref == "00000000-0000-0000-0000-000000000000" {
                    return Err("invalid broker identity");
                }
                Ok(())
            })
            .transpose()?;
        self.result_text
            .as_ref()
            .map(|value_result_text| -> Result<(), &'static str> {
                if value_result_text.chars().count() > 65536 {
                    return Err("invalid broker text");
                }
                Ok(())
            })
            .transpose()?;
        self.error_code
            .as_ref()
            .map(|value_error_code| -> Result<(), &'static str> {
                if ![
                    "tool_failed",
                    "cancelled",
                    "runtime_unavailable",
                    "unsupported_result",
                ]
                .contains(&value_error_code.as_str())
                {
                    return Err("invalid broker enum");
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for ToolObservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolObservation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ToolSnapshotWire")]
pub struct ToolSnapshot {
    pub agent_session_id: CanonicalId,
    pub native_turn_id: NativeId,
    pub items: Vec<ToolObservation>,
    pub truncated: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolSnapshotWire {
    pub agent_session_id: CanonicalId,
    pub native_turn_id: NativeId,
    pub items: Vec<ToolObservation>,
    pub truncated: bool,
}
impl TryFrom<ToolSnapshotWire> for ToolSnapshot {
    type Error = &'static str;
    fn try_from(w: ToolSnapshotWire) -> Result<Self, Self::Error> {
        let v = Self {
            agent_session_id: w.agent_session_id,
            native_turn_id: w.native_turn_id,
            items: w.items,
            truncated: w.truncated,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ToolSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_agent_session_id = &self.agent_session_id;
            if !canonical_id(value_agent_session_id) {
                return Err("invalid market UUID");
            }
            if value_agent_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_native_turn_id = &self.native_turn_id;
            if value_native_turn_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_turn_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_items = &self.items;
            if value_items.len() > 128 {
                return Err("invalid broker collection");
            }
            for item in value_items.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ToolSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolSnapshot([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "not_ready")]
    NotReady,
    #[serde(rename = "authority_mismatch")]
    AuthorityMismatch,
    #[serde(rename = "scope_expired")]
    ScopeExpired,
    #[serde(rename = "permission_denied")]
    PermissionDenied,
    #[serde(rename = "grant_not_found")]
    GrantNotFound,
    #[serde(rename = "grant_expired")]
    GrantExpired,
    #[serde(rename = "capacity_exceeded")]
    CapacityExceeded,
    #[serde(rename = "request_conflict")]
    RequestConflict,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "selection_stale")]
    SelectionStale,
    #[serde(rename = "execution_unavailable")]
    ExecutionUnavailable,
    #[serde(rename = "model_unavailable")]
    ModelUnavailable,
    #[serde(rename = "permission_mode_unavailable")]
    PermissionModeUnavailable,
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "operation_uncertain")]
    OperationUncertain,
    #[serde(rename = "approval_not_found")]
    ApprovalNotFound,
    #[serde(rename = "approval_stale")]
    ApprovalStale,
    #[serde(rename = "approval_expired")]
    ApprovalExpired,
    #[serde(rename = "approval_resolved")]
    ApprovalResolved,
    #[serde(rename = "cleanup_pending")]
    CleanupPending,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
    #[serde(rename = "context_invalid")]
    ContextInvalid,
    #[serde(rename = "binding_mismatch")]
    BindingMismatch,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "unknown_service")]
    UnknownService,
    #[serde(rename = "unsupported_auth")]
    UnsupportedAuth,
    #[serde(rename = "keyring_unavailable")]
    KeyringUnavailable,
    #[serde(rename = "metadata_unavailable")]
    MetadataUnavailable,
    #[serde(rename = "authorization_rejected")]
    AuthorizationRejected,
    #[serde(rename = "authorization_timeout")]
    AuthorizationTimeout,
    #[serde(rename = "not_qualified")]
    NotQualified,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "HelloRequestWire")]
pub struct HelloRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: HelloPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelloRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: HelloPayload,
}
impl TryFrom<HelloRequestWire> for HelloRequest {
    type Error = &'static str;
    fn try_from(w: HelloRequestWire) -> Result<Self, Self::Error> {
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
impl HelloRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "hello" {
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
impl std::fmt::Debug for HelloRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HelloRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "HelloResponseWire")]
pub struct HelloResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: HelloResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: HelloResult,
}
impl TryFrom<HelloResponseWire> for HelloResponse {
    type Error = &'static str;
    fn try_from(w: HelloResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl HelloResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for HelloResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HelloResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "GrantRegisterRequestWire")]
pub struct GrantRegisterRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: GrantRegisterPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantRegisterRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: GrantRegisterPayload,
}
impl TryFrom<GrantRegisterRequestWire> for GrantRegisterRequest {
    type Error = &'static str;
    fn try_from(w: GrantRegisterRequestWire) -> Result<Self, Self::Error> {
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
impl GrantRegisterRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "grant_register" {
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
impl std::fmt::Debug for GrantRegisterRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantRegisterRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "GrantRegisterResponseWire")]
pub struct GrantRegisterResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: GrantRegistration,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantRegisterResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: GrantRegistration,
}
impl TryFrom<GrantRegisterResponseWire> for GrantRegisterResponse {
    type Error = &'static str;
    fn try_from(w: GrantRegisterResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl GrantRegisterResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for GrantRegisterResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GrantRegisterResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RevokeAuthorityRequestWire")]
pub struct RevokeAuthorityRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: RevokeAuthorityPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeAuthorityRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: RevokeAuthorityPayload,
}
impl TryFrom<RevokeAuthorityRequestWire> for RevokeAuthorityRequest {
    type Error = &'static str;
    fn try_from(w: RevokeAuthorityRequestWire) -> Result<Self, Self::Error> {
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
impl RevokeAuthorityRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "revoke_authority" {
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
impl std::fmt::Debug for RevokeAuthorityRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RevokeAuthorityRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RevokeAuthorityResponseWire")]
pub struct RevokeAuthorityResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: RevokeAuthorityResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevokeAuthorityResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: RevokeAuthorityResult,
}
impl TryFrom<RevokeAuthorityResponseWire> for RevokeAuthorityResponse {
    type Error = &'static str;
    fn try_from(w: RevokeAuthorityResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl RevokeAuthorityResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for RevokeAuthorityResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RevokeAuthorityResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApprovalDecideRequestWire")]
pub struct ApprovalDecideRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ApprovalDecidePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalDecideRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ApprovalDecidePayload,
}
impl TryFrom<ApprovalDecideRequestWire> for ApprovalDecideRequest {
    type Error = &'static str;
    fn try_from(w: ApprovalDecideRequestWire) -> Result<Self, Self::Error> {
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
impl ApprovalDecideRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "approval_decide" {
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
impl std::fmt::Debug for ApprovalDecideRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApprovalDecideRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApprovalDecideResponseWire")]
pub struct ApprovalDecideResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: MarketApproval,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalDecideResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: MarketApproval,
}
impl TryFrom<ApprovalDecideResponseWire> for ApprovalDecideResponse {
    type Error = &'static str;
    fn try_from(w: ApprovalDecideResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApprovalDecideResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApprovalDecideResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApprovalDecideResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitRequestWire")]
pub struct SubmitRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub payload: SubmitPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubmitRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub payload: SubmitPayload,
}
impl TryFrom<SubmitRequestWire> for SubmitRequest {
    type Error = &'static str;
    fn try_from(w: SubmitRequestWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            payload: w.payload,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "SubmitResponseWire")]
pub struct SubmitResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
impl TryFrom<SubmitResponseWire> for SubmitResponse {
    type Error = &'static str;
    fn try_from(w: SubmitResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl SubmitResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for SubmitResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SubmitResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "OperationResponseWire")]
pub struct OperationResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: SubmissionReceipt,
}
impl TryFrom<OperationResponseWire> for OperationResponse {
    type Error = &'static str;
    fn try_from(w: OperationResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl OperationResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for OperationResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OperationResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ApprovalsResponseWire")]
pub struct ApprovalsResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApprovalSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalsResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ApprovalSnapshot,
}
impl TryFrom<ApprovalsResponseWire> for ApprovalsResponse {
    type Error = &'static str;
    fn try_from(w: ApprovalsResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ApprovalsResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ApprovalsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApprovalsResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ToolsResponseWire")]
pub struct ToolsResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ToolSnapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolsResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ToolSnapshot,
}
impl TryFrom<ToolsResponseWire> for ToolsResponse {
    type Error = &'static str;
    fn try_from(w: ToolsResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ToolsResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ToolsResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolsResponse([redacted])")
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
#[serde(rename_all = "camelCase")]
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
                    return Err("invalid market UUID");
                }
                if value_request_id == "00000000-0000-0000-0000-000000000000" {
                    return Err("invalid broker identity");
                }
                Ok(())
            })
            .transpose()?;
        {
            let value_retryable = &self.retryable;
            if *value_retryable {
                return Err("invalid broker constant");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Error([redacted])")
    }
}
pub use super::provider_generated::ProviderPayload;
pub use super::provider_generated::ProviderStatus;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthBeginRequestWire")]
pub struct AuthBeginRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthBeginRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
impl TryFrom<AuthBeginRequestWire> for AuthBeginRequest {
    type Error = &'static str;
    fn try_from(w: AuthBeginRequestWire) -> Result<Self, Self::Error> {
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
impl AuthBeginRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "provider_auth_begin" {
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
impl std::fmt::Debug for AuthBeginRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthBeginRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthBeginResponseWire")]
pub struct AuthBeginResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthBeginResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
impl TryFrom<AuthBeginResponseWire> for AuthBeginResponse {
    type Error = &'static str;
    fn try_from(w: AuthBeginResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl AuthBeginResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for AuthBeginResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthBeginResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthPollRequestWire")]
pub struct AuthPollRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthPollRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
impl TryFrom<AuthPollRequestWire> for AuthPollRequest {
    type Error = &'static str;
    fn try_from(w: AuthPollRequestWire) -> Result<Self, Self::Error> {
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
impl AuthPollRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "provider_auth_poll" {
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
impl std::fmt::Debug for AuthPollRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthPollRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthPollResponseWire")]
pub struct AuthPollResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthPollResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
impl TryFrom<AuthPollResponseWire> for AuthPollResponse {
    type Error = &'static str;
    fn try_from(w: AuthPollResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl AuthPollResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for AuthPollResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthPollResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthCancelRequestWire")]
pub struct AuthCancelRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthCancelRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
impl TryFrom<AuthCancelRequestWire> for AuthCancelRequest {
    type Error = &'static str;
    fn try_from(w: AuthCancelRequestWire) -> Result<Self, Self::Error> {
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
impl AuthCancelRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "provider_auth_cancel" {
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
impl std::fmt::Debug for AuthCancelRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthCancelRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "AuthCancelResponseWire")]
pub struct AuthCancelResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthCancelResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
impl TryFrom<AuthCancelResponseWire> for AuthCancelResponse {
    type Error = &'static str;
    fn try_from(w: AuthCancelResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl AuthCancelResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for AuthCancelResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AuthCancelResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ForgetRequestWire")]
pub struct ForgetRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForgetRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
impl TryFrom<ForgetRequestWire> for ForgetRequest {
    type Error = &'static str;
    fn try_from(w: ForgetRequestWire) -> Result<Self, Self::Error> {
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
impl ForgetRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "provider_forget" {
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
impl std::fmt::Debug for ForgetRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ForgetRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ForgetResponseWire")]
pub struct ForgetResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgetResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
impl TryFrom<ForgetResponseWire> for ForgetResponse {
    type Error = &'static str;
    fn try_from(w: ForgetResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ForgetResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ForgetResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ForgetResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ProbeRequestWire")]
pub struct ProbeRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProbeRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub method: String,
    pub payload: ProviderPayload,
}
impl TryFrom<ProbeRequestWire> for ProbeRequest {
    type Error = &'static str;
    fn try_from(w: ProbeRequestWire) -> Result<Self, Self::Error> {
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
impl ProbeRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_method = &self.method;
            if value_method != "provider_probe" {
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
impl std::fmt::Debug for ProbeRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProbeRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ProbeResponseWire")]
pub struct ProbeResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: ProviderStatus,
}
impl TryFrom<ProbeResponseWire> for ProbeResponse {
    type Error = &'static str;
    fn try_from(w: ProbeResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ProbeResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for ProbeResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProbeResponse([redacted])")
    }
}
pub use super::generated::SelectionDisplay;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeObservePayloadWire")]
pub struct NativeObservePayload {
    pub session_id: CanonicalId,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub native_turn_id: Option<NativeId>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeObservePayloadWire {
    pub session_id: CanonicalId,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub native_turn_id: Option<NativeId>,
}
impl TryFrom<NativeObservePayloadWire> for NativeObservePayload {
    type Error = &'static str;
    fn try_from(w: NativeObservePayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            session_id: w.session_id,
            native_turn_id: w.native_turn_id,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeObservePayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid market UUID");
            }
            if value_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        self.native_turn_id
            .as_ref()
            .map(|value_native_turn_id| -> Result<(), &'static str> {
                if value_native_turn_id.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if value_native_turn_id.chars().count() > 256 {
                    return Err("invalid broker text");
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for NativeObservePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeObservePayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeObservationWire")]
pub struct NativeObservation {
    pub managed: bool,
    pub selection_display: Vec<SelectionDisplay>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub approvals: Option<ApprovalSnapshot>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub tools: Option<ToolSnapshot>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub available_turns: Option<Vec<ObservedTurn>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub turns_truncated: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeObservationWire {
    pub managed: bool,
    pub selection_display: Vec<SelectionDisplay>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub approvals: Option<ApprovalSnapshot>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub tools: Option<ToolSnapshot>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub available_turns: Option<Vec<ObservedTurn>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub turns_truncated: Option<bool>,
}
impl TryFrom<NativeObservationWire> for NativeObservation {
    type Error = &'static str;
    fn try_from(w: NativeObservationWire) -> Result<Self, Self::Error> {
        let v = Self {
            managed: w.managed,
            selection_display: w.selection_display,
            approvals: w.approvals,
            tools: w.tools,
            available_turns: w.available_turns,
            turns_truncated: w.turns_truncated,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeObservation {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_selection_display = &self.selection_display;
            if value_selection_display.len() > 51 {
                return Err("invalid broker collection");
            }
            for item in value_selection_display.iter() {
                item.validate()?;
            }
        }
        self.approvals
            .as_ref()
            .map(|value_approvals| -> Result<(), &'static str> {
                value_approvals.validate()?;
                Ok(())
            })
            .transpose()?;
        self.tools
            .as_ref()
            .map(|value_tools| -> Result<(), &'static str> {
                value_tools.validate()?;
                Ok(())
            })
            .transpose()?;
        self.available_turns
            .as_ref()
            .map(|value_available_turns| -> Result<(), &'static str> {
                if value_available_turns.len() > 128 {
                    return Err("invalid broker collection");
                }
                for item in value_available_turns.iter() {
                    item.validate()?;
                }
                Ok(())
            })
            .transpose()?;
        Ok(())
    }
}
impl std::fmt::Debug for NativeObservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeObservation([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeApprovalDecidePayloadWire")]
pub struct NativeApprovalDecidePayload {
    pub session_id: CanonicalId,
    pub approval_id: CanonicalId,
    pub decision_id: CanonicalId,
    pub expected_revision: Revision,
    pub decision: Decision,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeApprovalDecidePayloadWire {
    pub session_id: CanonicalId,
    pub approval_id: CanonicalId,
    pub decision_id: CanonicalId,
    pub expected_revision: Revision,
    pub decision: Decision,
}
impl TryFrom<NativeApprovalDecidePayloadWire> for NativeApprovalDecidePayload {
    type Error = &'static str;
    fn try_from(w: NativeApprovalDecidePayloadWire) -> Result<Self, Self::Error> {
        let v = Self {
            session_id: w.session_id,
            approval_id: w.approval_id,
            decision_id: w.decision_id,
            expected_revision: w.expected_revision,
            decision: w.decision,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeApprovalDecidePayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_session_id = &self.session_id;
            if !canonical_id(value_session_id) {
                return Err("invalid market UUID");
            }
            if value_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_approval_id = &self.approval_id;
            if !canonical_id(value_approval_id) {
                return Err("invalid market UUID");
            }
            if value_approval_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_decision_id = &self.decision_id;
            if !canonical_id(value_decision_id) {
                return Err("invalid market UUID");
            }
            if value_decision_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_expected_revision = &self.expected_revision;
            if *value_expected_revision < 1 {
                return Err("invalid broker number");
            }
            if *value_expected_revision > 9007199254740991 {
                return Err("invalid broker number");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeApprovalDecidePayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeApprovalDecidePayload([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeObserveRequestWire")]
pub struct NativeObserveRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeObservePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeObserveRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeObservePayload,
}
impl TryFrom<NativeObserveRequestWire> for NativeObserveRequest {
    type Error = &'static str;
    fn try_from(w: NativeObserveRequestWire) -> Result<Self, Self::Error> {
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
impl NativeObserveRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid market UUID");
            }
            if value_context_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeObserveRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeObserveRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeObserveResponseWire")]
pub struct NativeObserveResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: NativeObservation,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeObserveResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: NativeObservation,
}
impl TryFrom<NativeObserveResponseWire> for NativeObserveResponse {
    type Error = &'static str;
    fn try_from(w: NativeObserveResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeObserveResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeObserveResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeObserveResponse([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "NativeApprovalDecideRequestWire")]
pub struct NativeApprovalDecideRequest {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeApprovalDecidePayload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeApprovalDecideRequestWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub context_id: CanonicalId,
    pub payload: NativeApprovalDecidePayload,
}
impl TryFrom<NativeApprovalDecideRequestWire> for NativeApprovalDecideRequest {
    type Error = &'static str;
    fn try_from(w: NativeApprovalDecideRequestWire) -> Result<Self, Self::Error> {
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
impl NativeApprovalDecideRequest {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_context_id = &self.context_id;
            if !canonical_id(value_context_id) {
                return Err("invalid market UUID");
            }
            if value_context_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_payload = &self.payload;
            value_payload.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeApprovalDecideRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeApprovalDecideRequest([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "NativeApprovalDecideResponseWire"
)]
pub struct NativeApprovalDecideResponse {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: MarketApproval,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeApprovalDecideResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: MarketApproval,
}
impl TryFrom<NativeApprovalDecideResponseWire> for NativeApprovalDecideResponse {
    type Error = &'static str;
    fn try_from(w: NativeApprovalDecideResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeApprovalDecideResponse {
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
                return Err("invalid market UUID");
            }
            if value_request_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_data = &self.data;
            value_data.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for NativeApprovalDecideResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeApprovalDecideResponse([redacted])")
    }
}
pub type NativeError = Error;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ObservedTurnWire")]
pub struct ObservedTurn {
    pub native_turn_id: NativeId,
    pub selection_display: Vec<SelectionDisplay>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObservedTurnWire {
    pub native_turn_id: NativeId,
    pub selection_display: Vec<SelectionDisplay>,
}
impl TryFrom<ObservedTurnWire> for ObservedTurn {
    type Error = &'static str;
    fn try_from(w: ObservedTurnWire) -> Result<Self, Self::Error> {
        let v = Self {
            native_turn_id: w.native_turn_id,
            selection_display: w.selection_display,
        };
        v.validate()?;
        Ok(v)
    }
}
impl ObservedTurn {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_native_turn_id = &self.native_turn_id;
            if value_native_turn_id.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_native_turn_id.chars().count() > 256 {
                return Err("invalid broker text");
            }
        }
        {
            let value_selection_display = &self.selection_display;
            if value_selection_display.len() > 51 {
                return Err("invalid broker collection");
            }
            for item in value_selection_display.iter() {
                item.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ObservedTurn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ObservedTurn([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StartTurnV2TextBlockWire")]
pub struct StartTurnV2TextBlock {
    pub r#type: String,
    pub text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartTurnV2TextBlockWire {
    pub r#type: String,
    pub text: String,
}
impl TryFrom<StartTurnV2TextBlockWire> for StartTurnV2TextBlock {
    type Error = &'static str;
    fn try_from(w: StartTurnV2TextBlockWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            text: w.text,
        };
        v.validate()?;
        Ok(v)
    }
}
impl StartTurnV2TextBlock {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if !["text"].contains(&value_type.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_text = &self.text;
            if value_text.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_text.chars().count() > 1048576 {
                return Err("invalid broker text");
            }
            if value_text
                .chars()
                .all(|c| c.is_whitespace() || c == '\u{feff}')
            {
                return Err("blank content");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for StartTurnV2TextBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StartTurnV2TextBlock([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StartTurnV2ImageBlockWire")]
pub struct StartTurnV2ImageBlock {
    pub r#type: String,
    #[serde(rename = "attachment_id")]
    pub attachment_id: String,
    #[serde(rename = "media_type")]
    pub media_type: String,
    #[serde(rename = "size_bytes")]
    pub size_bytes: i64,
    pub sha256: String,
    #[serde(rename = "data_url")]
    pub data_url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartTurnV2ImageBlockWire {
    pub r#type: String,
    #[serde(rename = "attachment_id")]
    pub attachment_id: String,
    #[serde(rename = "media_type")]
    pub media_type: String,
    #[serde(rename = "size_bytes")]
    pub size_bytes: i64,
    pub sha256: String,
    #[serde(rename = "data_url")]
    pub data_url: String,
}
impl TryFrom<StartTurnV2ImageBlockWire> for StartTurnV2ImageBlock {
    type Error = &'static str;
    fn try_from(w: StartTurnV2ImageBlockWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            attachment_id: w.attachment_id,
            media_type: w.media_type,
            size_bytes: w.size_bytes,
            sha256: w.sha256,
            data_url: w.data_url,
        };
        v.validate()?;
        Ok(v)
    }
}
impl StartTurnV2ImageBlock {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if !["image"].contains(&value_type.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_attachment_id = &self.attachment_id;
            if !canonical_id(value_attachment_id) {
                return Err("invalid attachment UUID");
            }
        }
        {
            let value_media_type = &self.media_type;
            if !["image/jpeg", "image/png", "image/webp", "image/gif"]
                .contains(&value_media_type.as_str())
            {
                return Err("invalid broker enum");
            }
        }
        {
            let value_size_bytes = &self.size_bytes;
            if *value_size_bytes < 1 {
                return Err("invalid broker number");
            }
            if *value_size_bytes > 10485760 {
                return Err("invalid broker number");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid attachment digest");
            }
        }
        {
            let value_data_url = &self.data_url;
            if value_data_url.chars().count() < 23 {
                return Err("invalid broker text");
            }
            if value_data_url.chars().count() > 13981039 {
                return Err("invalid broker text");
            }
            if !image_data_url(value_data_url) {
                return Err("invalid image data URL");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for StartTurnV2ImageBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StartTurnV2ImageBlock([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "StartTurnV2FileBlockWire")]
pub struct StartTurnV2FileBlock {
    pub r#type: String,
    #[serde(rename = "attachment_id")]
    pub attachment_id: String,
    pub name: String,
    #[serde(rename = "media_type")]
    pub media_type: StartTurnV2FileMediaType,
    #[serde(rename = "size_bytes")]
    pub size_bytes: i64,
    pub sha256: String,
    #[serde(rename = "context_chunks")]
    pub context_chunks: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartTurnV2FileBlockWire {
    pub r#type: String,
    #[serde(rename = "attachment_id")]
    pub attachment_id: String,
    pub name: String,
    #[serde(rename = "media_type")]
    pub media_type: StartTurnV2FileMediaType,
    #[serde(rename = "size_bytes")]
    pub size_bytes: i64,
    pub sha256: String,
    #[serde(rename = "context_chunks")]
    pub context_chunks: Vec<String>,
}
impl TryFrom<StartTurnV2FileBlockWire> for StartTurnV2FileBlock {
    type Error = &'static str;
    fn try_from(w: StartTurnV2FileBlockWire) -> Result<Self, Self::Error> {
        let v = Self {
            r#type: w.r#type,
            attachment_id: w.attachment_id,
            name: w.name,
            media_type: w.media_type,
            size_bytes: w.size_bytes,
            sha256: w.sha256,
            context_chunks: w.context_chunks,
        };
        v.validate()?;
        Ok(v)
    }
}
impl StartTurnV2FileBlock {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_type = &self.r#type;
            if !["file"].contains(&value_type.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_attachment_id = &self.attachment_id;
            if !canonical_id(value_attachment_id) {
                return Err("invalid attachment UUID");
            }
        }
        {
            let value_name = &self.name;
            if value_name.chars().count() < 1 {
                return Err("invalid broker text");
            }
            if value_name.chars().count() > 255 {
                return Err("invalid broker text");
            }
            if value_name
                .chars()
                .any(|c| c == '/' || c == '\\' || c <= '\u{1f}' || c == '\u{7f}')
                || value_name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_whitespace() || c == '\u{feff}')
                || value_name
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_whitespace() || c == '\u{feff}')
            {
                return Err("invalid attachment name");
            }
            if [".", ".."].contains(&value_name.as_str()) {
                return Err("invalid excluded value");
            }
        }
        {
            let value_size_bytes = &self.size_bytes;
            if *value_size_bytes < 1 {
                return Err("invalid broker number");
            }
            if *value_size_bytes > 10485760 {
                return Err("invalid broker number");
            }
        }
        {
            let value_sha256 = &self.sha256;
            if value_sha256.len() != 64
                || !value_sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("invalid attachment digest");
            }
        }
        {
            let value_context_chunks = &self.context_chunks;
            if value_context_chunks.is_empty() {
                return Err("invalid broker collection");
            }
            if value_context_chunks.len() > 32 {
                return Err("invalid broker collection");
            }
            for item in value_context_chunks.iter() {
                if item.chars().count() < 1 {
                    return Err("invalid broker text");
                }
                if item.chars().count() > 16384 {
                    return Err("invalid broker text");
                }
                if item.chars().all(|c| c.is_whitespace() || c == '\u{feff}') {
                    return Err("blank content");
                }
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for StartTurnV2FileBlock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StartTurnV2FileBlock([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StartTurnV2FileMediaType {
    #[serde(rename = "application/pdf")]
    ApplicationPdf,
    #[serde(rename = "text/plain")]
    TextPlain,
    #[serde(rename = "text/markdown")]
    TextMarkdown,
    #[serde(rename = "text/csv")]
    TextCsv,
    #[serde(rename = "application/json")]
    ApplicationJson,
    #[serde(rename = "application/yaml")]
    ApplicationYaml,
    #[serde(rename = "application/xml")]
    ApplicationXml,
    #[serde(rename = "text/html")]
    TextHtml,
    #[serde(rename = "application/rtf")]
    ApplicationRtf,
    #[serde(rename = "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]
    ApplicationVndOpenxmlformatsOfficedocumentWordprocessingmlDocument,
    #[serde(rename = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    ApplicationVndOpenxmlformatsOfficedocumentSpreadsheetmlSheet,
    #[serde(rename = "application/vnd.openxmlformats-officedocument.presentationml.presentation")]
    ApplicationVndOpenxmlformatsOfficedocumentPresentationmlPresentation,
}
fn canonical_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && s != "00000000-0000-0000-0000-000000000000"
        && b.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == b'-'
            } else {
                c.is_ascii_digit() || (*c >= b'a' && *c <= b'f')
            }
        })
}
fn image_data_url(s: &str) -> bool {
    let Some(s) = s.strip_prefix("data:image/") else {
        return false;
    };
    let Some((media, body)) = s.split_once(";base64,") else {
        return false;
    };
    if !["jpeg", "png", "webp", "gif"].contains(&media) {
        return false;
    }
    let raw = body.trim_end_matches('=');
    !raw.is_empty()
        && body.len() - raw.len() <= 2
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}
pub const MAX_CONTROL_FRAME_BYTES: usize = 16842752;
pub const MAX_SMALL_CONTROL_FRAME_BYTES: usize = 65536;
pub const MAX_HTTP_TRIGGER_BYTES: usize = 4096;
pub const MAX_PENDING_GRANTS: usize = 8;
pub const MAX_GRANT_BYTES: usize = 67108864;
pub const MAX_GRANT_TTL_MS: usize = 300000;
pub const MAX_CONTROL_RECEIPTS: usize = 1024;
pub const MAX_APPROVAL_RECORDS: usize = 128;
pub const MAX_TOOL_ITEMS: usize = 128;
pub const MAX_RESULT_TEXT_BYTES: usize = 65536;
