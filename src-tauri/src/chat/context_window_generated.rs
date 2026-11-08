// Generated from context-window source. DO NOT EDIT.
fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    <Option<T> as serde::Deserialize<'de>>::deserialize(d)
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextWindowQuery {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "includeHistory")]
    pub include_history: bool,
}
impl ContextWindowQuery {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.session_id;
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid context window");
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextWindowSample {
    #[serde(rename = "used_tokens")]
    pub used_tokens: i64,
    #[serde(rename = "capacity_tokens", deserialize_with = "required_nullable")]
    pub capacity_tokens: Option<i64>,
    #[serde(rename = "turn_id")]
    pub turn_id: String,
    #[serde(rename = "window_id")]
    pub window_id: String,
    #[serde(rename = "observed_at")]
    pub observed_at: String,
}
impl ContextWindowSample {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.used_tokens;
            if *value < 0 {
                return Err("invalid context window");
            }
            if *value > 9007199254740991 {
                return Err("invalid context window");
            }
        }
        if let Some(value) = &self.capacity_tokens {
            if *value < 1 {
                return Err("invalid context window");
            }
            if *value > 9007199254740991 {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.turn_id;
            if value.chars().count() < 1 {
                return Err("invalid context window");
            }
            if value.chars().count() > 512 {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.window_id;
            if uuid::Uuid::parse_str(value).is_err() {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.observed_at;
            if chrono::DateTime::parse_from_rfc3339(value).is_err() {
                return Err("invalid context window");
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextCompaction {
    #[serde(rename = "item_id")]
    pub item_id: String,
    #[serde(rename = "turn_id")]
    pub turn_id: String,
    #[serde(rename = "state")]
    pub state: String,
}
impl ContextCompaction {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.item_id;
            if value.chars().count() < 1 {
                return Err("invalid context window");
            }
            if value.chars().count() > 512 {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.turn_id;
            if value.chars().count() < 1 {
                return Err("invalid context window");
            }
            if value.chars().count() > 512 {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.state;
            if !["in_progress", "completed", "interrupted", "unknown"].contains(&value.as_str()) {
                return Err("invalid context window");
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextWindowSnapshot {
    #[serde(rename = "schema_version")]
    pub schema_version: i64,
    #[serde(rename = "thread_id", deserialize_with = "required_nullable")]
    pub thread_id: Option<String>,
    #[serde(rename = "model_profile", deserialize_with = "required_nullable")]
    pub model_profile: Option<String>,
    #[serde(rename = "model_revision")]
    pub model_revision: i64,
    #[serde(rename = "sample", deserialize_with = "required_nullable")]
    pub sample: Option<ContextWindowSample>,
    #[serde(rename = "compactions")]
    pub compactions: Vec<ContextCompaction>,
}
impl ContextWindowSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        {
            let value = &self.schema_version;
            if ![1].contains(value) {
                return Err("invalid context window");
            }
        }
        if let Some(value) = &self.thread_id {
            if value.chars().count() > 512 {
                return Err("invalid context window");
            }
        }
        if let Some(value) = &self.model_profile {
            if value.chars().count() > 128 {
                return Err("invalid context window");
            }
        }
        {
            let value = &self.model_revision;
            if *value < 0 {
                return Err("invalid context window");
            }
            if *value > 9007199254740991 {
                return Err("invalid context window");
            }
        }
        if let Some(value) = &self.sample {
            value.validate()?;
        }
        {
            let value = &self.compactions;
            if value.len() > 128 {
                return Err("invalid context window");
            }
            for entry in value {
                entry.validate()?;
            }
        }
        Ok(())
    }
}
