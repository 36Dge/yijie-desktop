// Generated from market-submission-rejection-v1; DO NOT EDIT.
use serde::{Deserialize, Serialize};

pub type CanonicalId = String;
pub type SelectionDigest = String;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ProofWire")]
pub struct Proof {
    pub schema_version: i64,
    pub host_instance_id: CanonicalId,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub reason: String,
    pub outcome: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProofWire {
    pub schema_version: i64,
    pub host_instance_id: CanonicalId,
    pub task_id: CanonicalId,
    pub local_session_id: CanonicalId,
    pub submission_operation_id: CanonicalId,
    pub turn_operation_id: CanonicalId,
    pub selection_digest: SelectionDigest,
    pub reason: String,
    pub outcome: String,
}
impl TryFrom<ProofWire> for Proof {
    type Error = &'static str;
    fn try_from(w: ProofWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            host_instance_id: w.host_instance_id,
            task_id: w.task_id,
            local_session_id: w.local_session_id,
            submission_operation_id: w.submission_operation_id,
            turn_operation_id: w.turn_operation_id,
            selection_digest: w.selection_digest,
            reason: w.reason,
            outcome: w.outcome,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Proof {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_host_instance_id = &self.host_instance_id;
            if value_host_instance_id.len() != 36
                || !value_host_instance_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid identity");
            }
            if value_host_instance_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_task_id = &self.task_id;
            if value_task_id.len() != 36
                || !value_task_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid identity");
            }
            if value_task_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_local_session_id = &self.local_session_id;
            if value_local_session_id.len() != 36
                || !value_local_session_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid identity");
            }
            if value_local_session_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_submission_operation_id = &self.submission_operation_id;
            if value_submission_operation_id.len() != 36
                || !value_submission_operation_id
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| {
                        if [8, 13, 18, 23].contains(&i) {
                            b == b'-'
                        } else {
                            b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                        }
                    })
            {
                return Err("invalid identity");
            }
            if value_submission_operation_id == "00000000-0000-0000-0000-000000000000" {
                return Err("invalid broker identity");
            }
        }
        {
            let value_turn_operation_id = &self.turn_operation_id;
            if value_turn_operation_id.len() != 36
                || !value_turn_operation_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid identity");
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
                return Err("invalid digest");
            }
        }
        {
            let value_reason = &self.reason;
            if !["skill_maintenance_busy", "skill_unavailable"].contains(&value_reason.as_str()) {
                return Err("invalid broker enum");
            }
        }
        {
            let value_outcome = &self.outcome;
            if !["not_dispatched"].contains(&value_outcome.as_str()) {
                return Err("invalid broker enum");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for Proof {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Proof([redacted])")
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ResponseWire")]
pub struct Response {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: Proof,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResponseWire {
    pub schema_version: i64,
    pub request_id: CanonicalId,
    pub data: Proof,
}
impl TryFrom<ResponseWire> for Response {
    type Error = &'static str;
    fn try_from(w: ResponseWire) -> Result<Self, Self::Error> {
        let v = Self {
            schema_version: w.schema_version,
            request_id: w.request_id,
            data: w.data,
        };
        v.validate()?;
        Ok(v)
    }
}
impl Response {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value_schema_version = &self.schema_version;
            if *value_schema_version != 1 {
                return Err("invalid broker constant");
            }
        }
        {
            let value_request_id = &self.request_id;
            if value_request_id.len() != 36
                || !value_request_id.bytes().enumerate().all(|(i, b)| {
                    if [8, 13, 18, 23].contains(&i) {
                        b == b'-'
                    } else {
                        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                    }
                })
            {
                return Err("invalid identity");
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
impl std::fmt::Debug for Response {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Response([redacted])")
    }
}
