// Generated from native-turn-timing source; DO NOT EDIT.
use serde::{Deserialize, Serialize};
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
fn canonical(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|v| !v.is_nil() && v.to_string() == s)
}
pub type CanonicalID = String;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeFieldState {
    #[serde(rename = "known")]
    Known,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "invalid")]
    Invalid,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "UnixSecondsFactWire")]
pub struct UnixSecondsFact {
    pub state: TimeFieldState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub value: Option<i64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UnixSecondsFactWire {
    pub state: TimeFieldState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub value: Option<i64>,
}
impl TryFrom<UnixSecondsFactWire> for UnixSecondsFact {
    type Error = &'static str;
    fn try_from(w: UnixSecondsFactWire) -> Result<Self, Self::Error> {
        let v = Self {
            state: w.state,
            value: w.value,
        };
        v.validate()?;
        Ok(v)
    }
}
impl UnixSecondsFact {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self
            .value
            .is_some_and(|n| !(-8640000000000..=8640000000000).contains(&n))
        {
            return Err("invalid timing number");
        }
        if self.state == TimeFieldState::Known && (self.value.is_none()) {
            return Err("invalid timing state");
        }
        if self.state == TimeFieldState::Unknown && (self.value.is_some()) {
            return Err("invalid timing state");
        }
        if self.state == TimeFieldState::Invalid && (self.value.is_some()) {
            return Err("invalid timing state");
        }
        Ok(())
    }
}
impl std::fmt::Debug for UnixSecondsFact {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UnixSecondsFact([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "DurationMsFactWire")]
pub struct DurationMsFact {
    pub state: TimeFieldState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub value: Option<i64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DurationMsFactWire {
    pub state: TimeFieldState,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub value: Option<i64>,
}
impl TryFrom<DurationMsFactWire> for DurationMsFact {
    type Error = &'static str;
    fn try_from(w: DurationMsFactWire) -> Result<Self, Self::Error> {
        let v = Self {
            state: w.state,
            value: w.value,
        };
        v.validate()?;
        Ok(v)
    }
}
impl DurationMsFact {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self
            .value
            .is_some_and(|n| !(0..=9007199254740991).contains(&n))
        {
            return Err("invalid timing number");
        }
        if self.state == TimeFieldState::Known && (self.value.is_none()) {
            return Err("invalid timing state");
        }
        if self.state == TimeFieldState::Unknown && (self.value.is_some()) {
            return Err("invalid timing state");
        }
        if self.state == TimeFieldState::Invalid && (self.value.is_some()) {
            return Err("invalid timing state");
        }
        Ok(())
    }
}
impl std::fmt::Debug for DurationMsFact {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DurationMsFact([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingSource {
    #[serde(rename = "runtime_read")]
    RuntimeRead,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "NativeTurnTimingWire")]
pub struct NativeTurnTiming {
    pub schema_version: i64,
    pub agent_session_id: CanonicalID,
    pub thread_id: CanonicalID,
    pub turn_id: CanonicalID,
    pub source: TimingSource,
    pub started_at: UnixSecondsFact,
    pub completed_at: UnixSecondsFact,
    pub duration_ms: DurationMsFact,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeTurnTimingWire {
    pub schema_version: i64,
    pub agent_session_id: CanonicalID,
    pub thread_id: CanonicalID,
    pub turn_id: CanonicalID,
    pub source: TimingSource,
    pub started_at: UnixSecondsFact,
    pub completed_at: UnixSecondsFact,
    pub duration_ms: DurationMsFact,
}
impl TryFrom<NativeTurnTimingWire> for NativeTurnTiming {
    type Error = &'static str;
    fn try_from(w: NativeTurnTimingWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            agent_session_id: w.agent_session_id,
            thread_id: w.thread_id,
            turn_id: w.turn_id,
            source: w.source,
            started_at: w.started_at,
            completed_at: w.completed_at,
            duration_ms: w.duration_ms,
        };
        v.validate()?;
        Ok(v)
    }
}
impl NativeTurnTiming {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let n = self.schema_version;
            if ![1].contains(&n) {
                return Err("invalid timing number");
            }
        }
        if !canonical(&self.agent_session_id) {
            return Err("invalid timing identity");
        }
        if !canonical(&self.thread_id) {
            return Err("invalid timing identity");
        }
        if !canonical(&self.turn_id) {
            return Err("invalid timing identity");
        }
        self.started_at.validate()?;
        self.completed_at.validate()?;
        self.duration_ms.validate()?;
        Ok(())
    }
}
impl std::fmt::Debug for NativeTurnTiming {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NativeTurnTiming([redacted])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimingErrorCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "unauthorized")]
    Unauthorized,
    #[serde(rename = "session_not_found")]
    SessionNotFound,
    #[serde(rename = "turn_not_found")]
    TurnNotFound,
    #[serde(rename = "native_timing_unavailable")]
    NativeTimingUnavailable,
    #[serde(rename = "native_timing_timeout")]
    NativeTimingTimeout,
    #[serde(rename = "native_timing_identity_mismatch")]
    NativeTimingIdentityMismatch,
    #[serde(rename = "native_timing_limit_exceeded")]
    NativeTimingLimitExceeded,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "TimingErrorWire")]
pub struct TimingError {
    pub error: TimingErrorError,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimingErrorWire {
    pub error: TimingErrorError,
}
impl TryFrom<TimingErrorWire> for TimingError {
    type Error = &'static str;
    fn try_from(w: TimingErrorWire) -> Result<Self, Self::Error> {
        let v = Self { error: w.error };
        v.validate()?;
        Ok(v)
    }
}
impl TimingError {
    pub fn validate(&self) -> Result<(), &'static str> {
        self.error.validate()?;
        Ok(())
    }
}
impl std::fmt::Debug for TimingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TimingError([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "TimingErrorErrorWire")]
pub struct TimingErrorError {
    pub code: TimingErrorCode,
    pub message: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TimingErrorErrorWire {
    pub code: TimingErrorCode,
    pub message: String,
}
impl TryFrom<TimingErrorErrorWire> for TimingErrorError {
    type Error = &'static str;
    fn try_from(w: TimingErrorErrorWire) -> Result<Self, Self::Error> {
        let v = Self {
            code: w.code,
            message: w.message,
        };
        v.validate()?;
        Ok(v)
    }
}
impl TimingErrorError {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.message.chars().count() < 1 {
            return Err("invalid timing text");
        }
        if self.message.chars().count() > 160 {
            return Err("invalid timing text");
        }
        Ok(())
    }
}
impl std::fmt::Debug for TimingErrorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TimingErrorError([redacted])")
    }
}
