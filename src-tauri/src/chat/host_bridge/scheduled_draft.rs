//! Fixed-purpose routes; identity/config/schema never come from renderer fields.
use super::*;
use crate::chat::schedules::{draft_generated as wire, drafts::valid_wire};
use serde::de::DeserializeOwned;
fn decode<T: DeserializeOwned>(name: &str, bytes: &[u8]) -> Result<T, HostBridgeError> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| accepted_response_invalid())?;
    if !valid_wire(name, &value) {
        return Err(accepted_response_invalid());
    }
    serde_json::from_value(value).map_err(|_| accepted_response_invalid())
}
async fn reply<T: DeserializeOwned>(response: Response, name: &str) -> Result<T, HostBridgeError> {
    if response.status() != StatusCode::OK {
        let bytes = read_json_body(response).await?;
        let error: wire::Error = decode("Error", &bytes)?;
        return Err(match error.code {
            wire::ErrorCode::PolicyUnqualified | wire::ErrorCode::StorageDisabled => {
                HostBridgeError::new(HostBridgeErrorKind::NotReady)
            }
            wire::ErrorCode::OperationUnknown => transport_error(),
            _ => protocol_error(),
        });
    }
    let bytes = read_json_body(response)
        .await
        .map_err(|_| accepted_response_invalid())?;
    decode(name, &bytes)
}
impl HostBridge {
    pub(crate) async fn draft_mapping(
        &self,
        task: Uuid,
    ) -> Result<Option<wire::RecoveryMapping>, HostBridgeError> {
        let result: Option<wire::RecoveryMapping> = self
            .recovery_get(&format!("/v1/scheduled-plan-draft-session-mappings/{task}"))
            .await?;
        if let Some(value) = &result {
            if !valid_wire(
                "RecoveryMapping",
                &serde_json::to_value(value).map_err(|_| protocol_error())?,
            ) || value.task_id != task.to_string()
                || value.responding_host_instance_id.as_deref()
                    != Some(self.expected_nonce.as_str())
            {
                return Err(accepted_response_invalid());
            }
        }
        Ok(result)
    }

    pub(crate) async fn require_draft_capability(&self) -> Result<(), HostBridgeError> {
        let response = self
            .authorized_request(Method::GET, "/v1/scheduled-plan-draft-capability")
            .await?
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        let capability: wire::Capability = reply(response, "Capability").await?;
        if !capability.available {
            return Err(HostBridgeError::new(HostBridgeErrorKind::NotReady));
        }
        Ok(())
    }
    pub(crate) async fn start_draft_session(
        &self,
        task: Uuid,
        workspace: String,
    ) -> Result<HostSession, HostBridgeError> {
        let input = wire::CreateRequest {
            schema_version: 1,
            policy_version: 1,
            task_id: task.to_string(),
            workspace_id: workspace.clone(),
        };
        if !valid_wire(
            "CreateRequest",
            &serde_json::to_value(&input).map_err(|_| protocol_error())?,
        ) {
            return Err(protocol_error());
        }
        let response = self
            .send_json(Method::POST, "/v1/scheduled-plan-draft-sessions", &input)
            .await?;
        let receipt: wire::SessionReceipt = reply(response, "SessionReceipt").await?;
        if receipt.task_id != task.to_string() || receipt.workspace_id != workspace {
            return Err(accepted_response_invalid());
        }
        let session = self
            .get_session(parse_required_uuid(&receipt.agent_session_id)?)
            .await?;
        if session.task_id != task {
            return Err(accepted_response_invalid());
        }
        Ok(session)
    }
    pub(crate) async fn resume_draft_session(
        &self,
        session: Uuid,
    ) -> Result<HostSession, HostBridgeError> {
        self.require_draft_capability().await?;
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/scheduled-plan-draft-sessions/{session}/resume"),
                &wire::ResumeRequest {
                    schema_version: 1,
                    policy_version: 1,
                },
            )
            .await?;
        let receipt: wire::SessionReceipt = reply(response, "SessionReceipt").await?;
        if receipt.agent_session_id != session.to_string() {
            return Err(accepted_response_invalid());
        }
        let result = self.get_session(session).await?;
        if result.task_id.to_string() != receipt.task_id {
            return Err(accepted_response_invalid());
        }
        Ok(result)
    }
    pub(crate) async fn start_draft_turn(
        &self,
        session: Uuid,
        operation: Uuid,
        blocks: &[HostTurnInputBlock],
    ) -> Result<Uuid, HostBridgeError> {
        let [HostTurnInputBlock::Text { text }] = blocks else {
            return Err(protocol_error());
        };
        let input = wire::TurnRequest {
            schema_version: 1,
            policy_version: 1,
            operation_id: operation.to_string(),
            text: text.clone(),
        };
        if text.trim().is_empty()
            || !valid_wire(
                "TurnRequest",
                &serde_json::to_value(&input).map_err(|_| protocol_error())?,
            )
        {
            return Err(protocol_error());
        }
        // Only reached through this generation's explicit native action. Resume
        // is admitted too; startup/read-only recovery never calls this path.
        self.resume_draft_session(session).await?;
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/scheduled-plan-draft-sessions/{session}/turns"),
                &input,
            )
            .await?;
        let receipt: wire::TurnReceipt = reply(response, "TurnReceipt").await?;
        if receipt.agent_session_id != session.to_string()
            || receipt.operation_id != operation.to_string()
        {
            return Err(accepted_response_invalid());
        }
        parse_required_uuid(&receipt.turn_id).map_err(|_| accepted_response_invalid())
    }
}
