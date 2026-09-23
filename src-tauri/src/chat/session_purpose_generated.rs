// Generated from chat-ipc-v1.schema.json sessionPurpose. DO NOT EDIT.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionPurpose {
    #[serde(rename = "ordinary")]
    Ordinary,
    #[serde(rename = "scheduled_plan_draft")]
    ScheduledPlanDraft,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPurposeView {
    pub session_id: uuid::Uuid,
    pub purpose: SessionPurpose,
}
