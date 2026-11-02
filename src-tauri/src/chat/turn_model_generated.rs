// Generated from chat-turn-model-v1.schema.json. Do not edit.
// SHA256 d8944c12c8e6114c161faa3c6607d0ed9971945ebdcf46e4984e86b4d55df6dc
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnModelRequest {
    pub session_id: uuid::Uuid,
    pub turn_id: uuid::Uuid,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnModelView {
    pub session_id: uuid::Uuid,
    pub turn_id: uuid::Uuid,
    pub profile_id: Option<String>,
}
