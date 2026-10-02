use super::*;
use crate::chat::models_generated as wire;
impl HostBridge {
    pub(crate) fn with_model_profile(
        &self,
        profile: Option<String>,
    ) -> Result<Self, HostBridgeError> {
        if profile
            .as_ref()
            .is_some_and(|s| !crate::chat::models::valid_profile(s))
        {
            return Err(protocol_error());
        }
        let mut next = self.clone();
        next.model_profile = profile;
        Ok(next)
    }
    pub(crate) async fn model_catalog(&self) -> Result<wire::Catalog, HostBridgeError> {
        let value: wire::Catalog = self
            .recovery_get("/v1/model-chat/catalog")
            .await?
            .ok_or_else(protocol_error)?;
        if value.schema_version != 1 || value.models.len() != 2 {
            return Err(protocol_error());
        }
        Ok(value)
    }
    pub(crate) async fn model_selection(
        &self,
        session: Uuid,
    ) -> Result<wire::Selection, HostBridgeError> {
        let value: wire::Selection = self
            .recovery_get(&format!("/v1/model-chat/agent-sessions/{session}/model"))
            .await?
            .ok_or_else(protocol_error)?;
        validate_selection(value, session)
    }
    pub(crate) async fn select_model(
        &self,
        session: Uuid,
        request: wire::SelectRequest,
    ) -> Result<wire::Selection, HostBridgeError> {
        let response = self
            .send_json(
                Method::POST,
                &format!("/v1/model-chat/agent-sessions/{session}/model"),
                &request,
            )
            .await?;
        if response.status() != StatusCode::OK {
            let bytes = read_json_body(response).await?;
            let error: wire::Error =
                serde_json::from_slice(&bytes).map_err(|_| protocol_error())?;
            if error.schema_version != 1 {
                return Err(protocol_error());
            }
            return Err(HostBridgeError::rejected(match error.code {
                wire::ErrorCode::InvalidRequest => HostErrorCode::InvalidRequest,
                wire::ErrorCode::Unauthorized => HostErrorCode::Unauthorized,
                wire::ErrorCode::NotFound => HostErrorCode::SessionNotFound,
                wire::ErrorCode::Busy => HostErrorCode::TurnActive,
                wire::ErrorCode::RevisionConflict | wire::ErrorCode::RequestConflict => {
                    HostErrorCode::TurnOperationConflict
                }
                wire::ErrorCode::SelectionUnknown => HostErrorCode::SessionNotUsable,
                wire::ErrorCode::ModelUnavailable | wire::ErrorCode::RuntimeUnavailable => {
                    HostErrorCode::RuntimeRequestFailed
                }
            }));
        }
        let bytes = read_json_body(response).await?;
        let value = validate_selection(
            serde_json::from_slice(&bytes).map_err(|_| accepted_response_invalid())?,
            session,
        )?;
        if value.profile_id != Some(request.profile_id)
            || value.operation_id.as_deref() != Some(request.operation_id.as_str())
            || value.state != wire::SelectionState::Ready
            || value.revision < request.expected_revision
        {
            return Err(accepted_response_invalid());
        }
        Ok(value)
    }
}
fn validate_selection(
    value: wire::Selection,
    session: Uuid,
) -> Result<wire::Selection, HostBridgeError> {
    if value.schema_version != 1
        || value.agent_session_id != session.to_string()
        || value.revision < 0
        || value.revision > 9007199254740991
        || (value.state == wire::SelectionState::Ready && value.profile_id.is_none())
    {
        return Err(accepted_response_invalid());
    }
    Ok(value)
}
pub(super) fn route(path: &str) -> Option<String> {
    if path.starts_with("/v1/tasks/") && path.ends_with("/agent-sessions")
        || path.starts_with("/v1/scheduled-plan-draft-sessions")
    {
        return Some(path.replacen("/v1/", "/v1/model-chat/", 1));
    }
    if path.starts_with("/v2/agent-sessions/") && path.ends_with("/turns") {
        return Some(path.replacen("/v2/", "/v1/model-chat/", 1));
    }
    if path.starts_with("/v1/agent-sessions/") {
        let suffix = path.trim_start_matches("/v1/agent-sessions/");
        if !suffix.contains('/')
            || suffix.ends_with("/resume")
            || suffix.ends_with("/permission-turns")
        {
            return Some(path.replacen("/v1/", "/v1/model-chat/", 1));
        }
    }
    None
}
