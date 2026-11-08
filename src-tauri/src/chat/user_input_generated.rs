// Generated from user-input source and canonical Runtime types. DO NOT EDIT.
fn optional_non_null<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}
pub type CanonicalID = String;
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]

pub struct ToolRequestUserInputQuestion {
    #[serde(rename = "header")]
    pub header: String,
    #[serde(rename = "id")]
    pub id: String,
    #[serde(
        rename = "isOther",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub is_other: Option<bool>,
    #[serde(
        rename = "isSecret",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub is_secret: Option<bool>,
    #[serde(rename = "options", default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<ToolRequestUserInputOption>>,
    #[serde(rename = "question")]
    pub question: String,
}
impl ToolRequestUserInputQuestion {
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Some(value) = &self.options {
            for item0 in value {
                item0.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for ToolRequestUserInputQuestion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolRequestUserInputQuestion([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]

pub struct ToolRequestUserInputAnswer {
    #[serde(rename = "answers")]
    pub answers: Vec<String>,
}
impl ToolRequestUserInputAnswer {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}
impl std::fmt::Debug for ToolRequestUserInputAnswer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolRequestUserInputAnswer([REDACTED])")
    }
}
pub type InputState = String;
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInputRequest {
    #[serde(rename = "request_id")]
    pub request_id: CanonicalID,
    #[serde(rename = "turn_id")]
    pub turn_id: String,
    #[serde(rename = "item_id")]
    pub item_id: String,
    #[serde(rename = "state")]
    pub state: InputState,
    #[serde(rename = "questions")]
    pub questions: Vec<ToolRequestUserInputQuestion>,
    #[serde(
        rename = "deadline_at",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub deadline_at: Option<String>,
    #[serde(rename = "timeout_paused")]
    pub timeout_paused: bool,
    #[serde(
        rename = "operation_id",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub operation_id: Option<CanonicalID>,
}
impl UserInputRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.request_id;
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.turn_id;
            if value.chars().count() < 1 {
                return Err("invalid user input contract");
            }
            if value.chars().count() > 160 {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.item_id;
            if value.chars().count() < 1 {
                return Err("invalid user input contract");
            }
            if value.chars().count() > 160 {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.state;
            if ![
                "pending",
                "submitting",
                "answered",
                "skipped",
                "timed_out",
                "cancelled",
                "unknown",
            ]
            .contains(&value.as_str())
            {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.questions;
            if value.len() > 3 {
                return Err("invalid user input contract");
            }
            for item0 in value {
                item0.validate()?;
            }
        }
        if let Some(value) = &self.deadline_at {
            if chrono::DateTime::parse_from_rfc3339(value).is_err() {
                return Err("invalid user input contract");
            }
        }
        if let Some(value) = &self.operation_id {
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid user input contract");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for UserInputRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UserInputRequest([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInputSnapshot {
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "requests")]
    pub requests: Vec<UserInputRequest>,
    #[serde(
        rename = "generation",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "optional_non_null"
    )]
    pub generation: Option<CanonicalID>,
}
impl UserInputSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.requests;
            if value.len() > 64 {
                return Err("invalid user input contract");
            }
            for item0 in value {
                item0.validate()?;
            }
        }
        if let Some(value) = &self.generation {
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid user input contract");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for UserInputSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UserInputSnapshot([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInputAnswerRequest {
    #[serde(rename = "operation_id")]
    pub operation_id: CanonicalID,
    #[serde(rename = "answers")]
    pub answers: std::collections::BTreeMap<String, ToolRequestUserInputAnswer>,
}
impl UserInputAnswerRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.operation_id;
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.answers;
            if value.len() > 3 {
                return Err("invalid user input contract");
            }
            for value0 in value.values() {
                value0.validate()?;
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for UserInputAnswerRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UserInputAnswerRequest([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInputError {
    #[serde(rename = "error")]
    pub error: UserInputErrorError,
}
impl UserInputError {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.error;
            value.validate()?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for UserInputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UserInputError([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]

pub struct ToolRequestUserInputOption {
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "label")]
    pub label: String,
}
impl ToolRequestUserInputOption {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}
impl std::fmt::Debug for ToolRequestUserInputOption {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolRequestUserInputOption([REDACTED])")
    }
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserInputErrorError {
    #[serde(rename = "code")]
    pub code: String,
    #[serde(rename = "message")]
    pub message: String,
}
impl UserInputErrorError {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.code;
            if ![
                "invalid_request",
                "unavailable",
                "not_found",
                "conflict",
                "unauthorized",
            ]
            .contains(&value.as_str())
            {
                return Err("invalid user input contract");
            }
        }
        {
            let value = &self.message;
            if value.chars().count() > 160 {
                return Err("invalid user input contract");
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for UserInputErrorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UserInputErrorError([REDACTED])")
    }
}
