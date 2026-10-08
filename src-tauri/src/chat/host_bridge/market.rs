//! Versioned market HTTP reads/triggers. All execution/approval authority stays
//! on the Native-owned pipe; these HTTP calls carry only opaque references.
use super::*;
use crate::chat::connectors::host_generated as wire;

impl HostBridge {
    pub(crate) async fn market_submit(
        &self,
        request: &wire::SubmitRequest,
    ) -> Result<wire::SubmissionReceipt, HostBridgeError> {
        request.validate().map_err(|_| protocol_error())?;
        let response = self
            .send_json_with_limit(
                Method::POST,
                "/v1/market-chat/submissions",
                request,
                wire::MAX_HTTP_TRIGGER_BYTES,
            )
            .await?;
        let bytes = expect_json_status(response, StatusCode::ACCEPTED).await?;
        let response: wire::SubmitResponse =
            serde_json::from_slice(&bytes).map_err(|_| protocol_error())?;
        if response.request_id != request.request_id {
            return Err(protocol_error());
        }
        Ok(response.data)
    }

    async fn market_get<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        request: &str,
    ) -> Result<T, HostBridgeError> {
        let health = self
            .client
            .get(self.exact_url("/healthz")?)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        if header_text_name(health.headers(), "X-Yijie-Host-Instance-Nonce")? != self.expected_nonce
        {
            return Err(instance_error());
        }
        let bytes = expect_json_status(health, StatusCode::OK).await?;
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| protocol_error())?;
        if value.as_object().is_none_or(|v| v.len() != 2)
            || value["service"] != "yijie-agent-host"
            || value["status"] != "ok"
        {
            return Err(protocol_error());
        }
        let response = self
            .bearer_request(Method::GET, path)
            .await?
            .header("X-Yijie-Market-Request-Id", request)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| transport_error())?;
        let bytes = expect_json_status(response, StatusCode::OK).await?;
        serde_json::from_slice(&bytes).map_err(|_| protocol_error())
    }

    pub(crate) async fn market_operation(
        &self,
        task: Uuid,
        operation: Uuid,
    ) -> Result<wire::SubmissionReceipt, HostBridgeError> {
        require_non_nil(task)?;
        require_non_nil(operation)?;
        let request = Uuid::now_v7().to_string();
        let response: wire::OperationResponse = self
            .market_get(
                &format!("/v1/market-chat/tasks/{task}/operations/{operation}"),
                &request,
            )
            .await?;
        if response.request_id != request {
            return Err(protocol_error());
        }
        Ok(response.data)
    }

    pub(crate) async fn market_approvals(
        &self,
        session: Uuid,
    ) -> Result<wire::ApprovalSnapshot, HostBridgeError> {
        require_non_nil(session)?;
        let request = Uuid::now_v7().to_string();
        let response: wire::ApprovalsResponse = self
            .market_get(
                &format!("/v1/market-chat/agent-sessions/{session}/approvals"),
                &request,
            )
            .await?;
        if response.request_id != request {
            return Err(protocol_error());
        }
        Ok(response.data)
    }

    pub(crate) async fn market_tools(
        &self,
        session: Uuid,
        turn: Uuid,
    ) -> Result<wire::ToolSnapshot, HostBridgeError> {
        require_non_nil(session)?;
        require_non_nil(turn)?;
        let request = Uuid::now_v7().to_string();
        let response: wire::ToolsResponse = self
            .market_get(
                &format!("/v1/market-chat/agent-sessions/{session}/turns/{turn}/tools"),
                &request,
            )
            .await?;
        if response.request_id != request {
            return Err(protocol_error());
        }
        Ok(response.data)
    }
}
