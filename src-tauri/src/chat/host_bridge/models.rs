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
            .recovery_get(&format!("{}catalog", model_prefix()))
            .await?
            .ok_or_else(protocol_error)?;
        if value.schema_version != crate::chat::models::schema_version() || value.models.len() != 2
        {
            return Err(protocol_error());
        }
        Ok(value)
    }
    pub(crate) async fn model_selection(
        &self,
        session: Uuid,
    ) -> Result<wire::Selection, HostBridgeError> {
        let value: wire::Selection = self
            .recovery_get(&format!("{}agent-sessions/{session}/model", model_prefix()))
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
                &format!("{}agent-sessions/{session}/model", model_prefix()),
                &request,
            )
            .await?;
        if response.status() != StatusCode::OK {
            let bytes = read_json_body(response).await?;
            let error: wire::Error =
                serde_json::from_slice(&bytes).map_err(|_| protocol_error())?;
            if error.schema_version != crate::chat::models::schema_version() {
                return Err(protocol_error());
            }
            return Err(HostBridgeError::rejected(match error.code {
                #[cfg(feature = "kimi-k31-pro-candidate")]
                wire::ErrorCode::ModelRetired | wire::ErrorCode::ActivationRequired => {
                    HostErrorCode::SessionNotUsable
                }
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
        #[cfg(feature = "kimi-k31-pro-candidate")]
        let requested_profile = request.profile_id.into();
        #[cfg(not(feature = "kimi-k31-pro-candidate"))]
        let requested_profile = request.profile_id;
        if value.profile_id != Some(requested_profile)
            || value.operation_id.as_deref() != Some(request.operation_id.as_str())
            || value.state != wire::SelectionState::Ready
            || value.revision < request.expected_revision
        {
            return Err(accepted_response_invalid());
        }
        Ok(value)
    }
}
pub(crate) fn validate_selection(
    value: wire::Selection,
    session: Uuid,
) -> Result<wire::Selection, HostBridgeError> {
    if value.schema_version != crate::chat::models::schema_version()
        || value.agent_session_id != session.to_string()
        || value.revision < 0
        || value.revision > 9007199254740991
        || (value.state == wire::SelectionState::Ready && value.profile_id.is_none())
    {
        return Err(accepted_response_invalid());
    }
    #[cfg(feature = "kimi-k31-pro-candidate")]
    {
        if value
            .operation_id
            .as_ref()
            .is_some_and(|id| !canonical_id(id))
            || (value.profile_id == Some(wire::ProfileId::KimiK3MaxV1)
                && value.availability != wire::SelectionAvailability::Retired)
            || (value.availability == wire::SelectionAvailability::Retired
                && value.profile_id != Some(wire::ProfileId::KimiK3MaxV1))
            || (value.availability == wire::SelectionAvailability::Ready
                && (value.state != wire::SelectionState::Ready
                    || value.profile_id.is_none_or(|p| {
                        !crate::chat::models::executable_profile(crate::chat::models::profile_id(p))
                    })))
        {
            return Err(accepted_response_invalid());
        }
    }
    Ok(value)
}

#[cfg(feature = "kimi-k31-pro-candidate")]
fn canonical_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|v| !v.is_nil() && v.to_string() == id)
}

#[cfg(feature = "kimi-k31-pro-candidate")]
pub(crate) fn validate_operation_receipt(
    value: &wire::ModelOperationReceipt,
    session: Uuid,
    request: &wire::SelectRequest,
) -> Result<(), HostBridgeError> {
    if value.schema_version != 2
        || value.agent_session_id != session.to_string()
        || value.operation_id != request.operation_id
        || !canonical_id(&value.operation_id)
        || value.request.schema_version != 2
        || value.request.operation_id != request.operation_id
        || value.request.profile_id != request.profile_id.into()
        || value.request.expected_revision != request.expected_revision
        || !(0..9007199254740991).contains(&request.expected_revision)
    {
        return Err(accepted_response_invalid());
    }
    if value.state == wire::ModelOperationState::Committed {
        let r = value
            .result
            .as_ref()
            .ok_or_else(accepted_response_invalid)?;
        if r.schema_version != 2
            || r.agent_session_id != session.to_string()
            || r.operation_id.as_deref() != Some(request.operation_id.as_str())
            || r.profile_id != Some(request.profile_id.into())
            || r.revision != request.expected_revision + 1
            || r.state != wire::SelectionState::Ready
            || r.availability != Some(wire::SelectionAvailability::Ready)
        {
            return Err(accepted_response_invalid());
        }
    } else if value.result.is_some() {
        return Err(accepted_response_invalid());
    }
    Ok(())
}

#[cfg(feature = "kimi-k31-pro-candidate")]
impl HostBridge {
    pub(crate) async fn model_operation(
        &self,
        session: Uuid,
        request: &wire::SelectRequest,
    ) -> Result<Option<wire::ModelOperationReceipt>, HostBridgeError> {
        if !canonical_id(&request.operation_id) {
            return Err(protocol_error());
        }
        let value: Option<wire::ModelOperationReceipt> = self
            .recovery_get(&format!(
                "{}agent-sessions/{session}/model-operations/{}",
                model_prefix(),
                request.operation_id
            ))
            .await?;
        if let Some(value) = &value {
            validate_operation_receipt(value, session, request)?;
        }
        Ok(value)
    }
    pub(crate) async fn recover_model_operation(
        &self,
        session: Uuid,
        request: &wire::SelectRequest,
    ) -> Result<wire::ModelOperationReceipt, HostBridgeError> {
        if !canonical_id(&request.operation_id) {
            return Err(protocol_error());
        }
        let body = wire::RecoverRequest {
            schema_version: 2,
            operation_id: request.operation_id.clone(),
            expected_revision: request.expected_revision,
            profile_id: request.profile_id,
        };
        let response = self
            .send_json(
                Method::POST,
                &format!(
                    "{}agent-sessions/{session}/model-operations/{}/recover",
                    model_prefix(),
                    request.operation_id
                ),
                &body,
            )
            .await?;
        if response.status() != StatusCode::OK {
            // A failed recovery is not evidence of non-dispatch. Keep the Native
            // original intent blocked and let a later explicit action recheck it.
            return Err(HostBridgeError::rejected(HostErrorCode::SessionNotUsable));
        }
        let bytes = read_json_body(response).await?;
        let value: wire::ModelOperationReceipt =
            serde_json::from_slice(&bytes).map_err(|_| accepted_response_invalid())?;
        validate_operation_receipt(&value, session, request)?;
        Ok(value)
    }
}
pub(super) fn route(path: &str) -> Option<String> {
    if cfg!(feature = "kimi-k31-pro-candidate") && path.starts_with("/v1/model-chat/") {
        return Some(path.replacen("/v1/model-chat/", "/v2/model-chat/", 1));
    }
    if path.starts_with("/v1/tasks/") && path.ends_with("/agent-sessions")
        || path.starts_with("/v1/scheduled-plan-draft-sessions")
    {
        return Some(path.replacen("/v1/", model_prefix(), 1));
    }
    if path.starts_with("/v2/agent-sessions/") && path.ends_with("/turns") {
        return Some(path.replacen("/v2/", model_prefix(), 1));
    }
    if path.starts_with("/v1/agent-sessions/") {
        let suffix = path.trim_start_matches("/v1/agent-sessions/");
        if !suffix.contains('/')
            || suffix.ends_with("/resume")
            || suffix.ends_with("/permission-turns")
        {
            return Some(path.replacen("/v1/", model_prefix(), 1));
        }
    }
    None
}

fn model_prefix() -> &'static str {
    if cfg!(feature = "kimi-k31-pro-candidate") {
        "/v2/model-chat/"
    } else {
        "/v1/model-chat/"
    }
}
