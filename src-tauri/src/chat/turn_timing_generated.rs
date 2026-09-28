// Generated from chat-turn-timing-v1.schema.json. Do not edit.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnTimingRequest {
    pub session_id: uuid::Uuid,
    pub turn_id: uuid::Uuid,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnTimingView {
    pub session_id: uuid::Uuid,
    pub turn_id: uuid::Uuid,
    pub timing: Option<super::schedules::timing_generated::NativeTurnTiming>,
}
