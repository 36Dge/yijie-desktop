// Generated from scheduled recovery source; DO NOT EDIT.
use serde::{Deserialize, Serialize};
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
fn canonical(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}
pub type CanonicalID = String;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MappingState {
    #[serde(rename = "reserved")]
    Reserved,
    #[serde(rename = "bound")]
    Bound,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "accepted")]
    Accepted,
    #[serde(rename = "uncertain")]
    Uncertain,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "SessionMappingWire")]
pub struct SessionMapping {
    pub task_id: CanonicalID,
    pub agent_session_id: CanonicalID,
    pub mapping_state: MappingState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub codex_thread_id: Option<CanonicalID>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub responding_host_instance_id: Option<CanonicalID>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionMappingWire {
    pub task_id: CanonicalID,
    pub agent_session_id: CanonicalID,
    pub mapping_state: MappingState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub codex_thread_id: Option<CanonicalID>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub responding_host_instance_id: Option<CanonicalID>,
}
impl TryFrom<SessionMappingWire> for SessionMapping {
    type Error = &'static str;
    fn try_from(w: SessionMappingWire) -> Result<Self, Self::Error> {
        let value = Self {
            task_id: w.task_id,
            agent_session_id: w.agent_session_id,
            mapping_state: w.mapping_state,
            codex_thread_id: w.codex_thread_id,
            responding_host_instance_id: w.responding_host_instance_id,
        };
        value.validate()?;
        Ok(value)
    }
}
impl SessionMapping {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !canonical(&self.task_id) {
            return Err("invalid recovery identity");
        }
        if !canonical(&self.agent_session_id) {
            return Err("invalid recovery identity");
        }
        if self.codex_thread_id.as_ref().is_some_and(|v| !canonical(v)) {
            return Err("invalid recovery identity");
        }
        if self
            .responding_host_instance_id
            .as_ref()
            .is_some_and(|v| !canonical(v))
        {
            return Err("invalid recovery identity");
        }
        if self.mapping_state == MappingState::Bound && (self.codex_thread_id.is_none()) {
            return Err("invalid recovery state fields");
        }
        if self.mapping_state == MappingState::Reserved && (self.codex_thread_id.is_some()) {
            return Err("invalid recovery state fields");
        }
        Ok(())
    }
}
impl std::fmt::Debug for SessionMapping {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionMapping([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "TurnOperationResultWire")]
pub struct TurnOperationResult {
    pub agent_session_id: CanonicalID,
    pub operation_id: CanonicalID,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub turn_id: Option<CanonicalID>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub responding_host_instance_id: Option<CanonicalID>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TurnOperationResultWire {
    pub agent_session_id: CanonicalID,
    pub operation_id: CanonicalID,
    pub state: OperationState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub turn_id: Option<CanonicalID>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub responding_host_instance_id: Option<CanonicalID>,
}
impl TryFrom<TurnOperationResultWire> for TurnOperationResult {
    type Error = &'static str;
    fn try_from(w: TurnOperationResultWire) -> Result<Self, Self::Error> {
        let value = Self {
            agent_session_id: w.agent_session_id,
            operation_id: w.operation_id,
            state: w.state,
            turn_id: w.turn_id,
            responding_host_instance_id: w.responding_host_instance_id,
        };
        value.validate()?;
        Ok(value)
    }
}
impl TurnOperationResult {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !canonical(&self.agent_session_id) {
            return Err("invalid recovery identity");
        }
        if !canonical(&self.operation_id) {
            return Err("invalid recovery identity");
        }
        if self.turn_id.as_ref().is_some_and(|v| !canonical(v)) {
            return Err("invalid recovery identity");
        }
        if self
            .responding_host_instance_id
            .as_ref()
            .is_some_and(|v| !canonical(v))
        {
            return Err("invalid recovery identity");
        }
        if self.state == OperationState::Accepted && (self.turn_id.is_none()) {
            return Err("invalid recovery state fields");
        }
        if self.state == OperationState::Pending && (self.turn_id.is_some()) {
            return Err("invalid recovery state fields");
        }
        if self.state == OperationState::Uncertain && (self.turn_id.is_some()) {
            return Err("invalid recovery state fields");
        }
        Ok(())
    }
}
impl std::fmt::Debug for TurnOperationResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnOperationResult([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RecoveryErrorWire")]
pub struct RecoveryError {
    pub error: RecoveryErrorError,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryErrorWire {
    pub error: RecoveryErrorError,
}
impl TryFrom<RecoveryErrorWire> for RecoveryError {
    type Error = &'static str;
    fn try_from(w: RecoveryErrorWire) -> Result<Self, Self::Error> {
        let value = Self { error: w.error };
        value.validate()?;
        Ok(value)
    }
}
impl RecoveryError {
    pub fn validate(&self) -> Result<(), &'static str> {
        self.error.validate()?;
        Ok(())
    }
}
impl std::fmt::Debug for RecoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecoveryError([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RecoveryErrorErrorWire")]
pub struct RecoveryErrorError {
    pub code: RecoveryErrorErrorCode,
    pub message: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecoveryErrorErrorWire {
    pub code: RecoveryErrorErrorCode,
    pub message: String,
}
impl TryFrom<RecoveryErrorErrorWire> for RecoveryErrorError {
    type Error = &'static str;
    fn try_from(w: RecoveryErrorErrorWire) -> Result<Self, Self::Error> {
        let value = Self {
            code: w.code,
            message: w.message,
        };
        value.validate()?;
        Ok(value)
    }
}
impl RecoveryErrorError {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.message.chars().count() < 1 {
            return Err("invalid recovery length");
        }
        if self.message.chars().count() > 160 {
            return Err("invalid recovery length");
        }
        Ok(())
    }
}
impl std::fmt::Debug for RecoveryErrorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecoveryErrorError([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecoveryErrorErrorCode {
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "recovery_record_not_found")]
    RecoveryRecordNotFound,
    #[serde(rename = "recovery_unavailable")]
    RecoveryUnavailable,
}
