use super::*;
use crate::skills::market_v2::failure;
use crate::skills::market_v2_generated::{Catalog, ErrorResponse, Mutation, Operation};

fn bridge_error(_: HostBridgeError) -> ErrorResponse {
    failure("skill_host_unavailable", true)
}
async fn decode<T: serde::de::DeserializeOwned>(response: Response, limit: usize) -> Result<T, ErrorResponse> {
    let status = response.status();
    let body = read_json_body_with_limit(response, limit).await.map_err(bridge_error)?;
    if status != StatusCode::OK {
        let error: ErrorResponse =
            serde_json::from_slice(&body).map_err(|_| failure("skill_contract_mismatch", false))?;
        error
            .validate()
            .map_err(|_| failure("skill_contract_mismatch", false))?;
        return Err(error);
    }
    serde_json::from_slice(&body).map_err(|_| failure("skill_contract_mismatch", false))
}
impl HostBridge {
    pub(crate) async fn skill_market_catalog(&self) -> Result<Catalog, ErrorResponse> {
        let response = self
            .authorized_request(Method::GET, "/v2/skills")
            .await
            .map_err(bridge_error)?
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| failure("skill_host_unavailable", true))?;
        let catalog: Catalog = decode(response, crate::skills::market_v2_generated::MAX_CATALOG_RESPONSE_BYTES).await?;
        catalog
            .validate()
            .map_err(|_| failure("skill_contract_mismatch", false))?;
        Ok(catalog)
    }
    pub(crate) async fn skill_market_mutate(
        &self,
        request: &Mutation,
    ) -> Result<Operation, ErrorResponse> {
        let response = self
            .send_json(Method::POST, "/v2/skills/operations", request)
            .await
            .map_err(bridge_error)?;
        checked_operation(response, &request.operation_id).await
    }
    pub(crate) async fn skill_market_operation(
        &self,
        id: &str,
        cancel: bool,
    ) -> Result<Operation, ErrorResponse> {
        let path = format!(
            "/v2/skills/operations/{id}{}",
            if cancel { "/cancel" } else { "" }
        );
        let response = self
            .authorized_request(if cancel { Method::POST } else { Method::GET }, &path)
            .await
            .map_err(bridge_error)?
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| failure("skill_host_unavailable", true))?;
        checked_operation(response, id).await
    }
    pub(crate) async fn skill_market_import(
        &self,
        id: &str,
        name: &str,
        digest: &str,
        bytes: Vec<u8>,
    ) -> Result<Operation, ErrorResponse> {
        let response = self
            .authorized_request(Method::POST, &format!("/v2/skills/imports/{id}"))
            .await
            .map_err(bridge_error)?
            .query(&[("filename", name)])
            .header(CONTENT_TYPE, "application/octet-stream")
            .header("X-Skill-SHA256", digest)
            .timeout(Duration::from_secs(60))
            .body(bytes)
            .send()
            .await
            .map_err(|_| failure("skill_import_outcome_unknown", true))?;
        checked_operation(response, id).await
    }
}
async fn checked_operation(response: Response, id: &str) -> Result<Operation, ErrorResponse> {
    let operation: Operation = decode(response, MAX_JSON_BYTES).await?;
    operation
        .validate()
        .map_err(|_| failure("skill_contract_mismatch", false))?;
    if operation.operation_id != id {
        return Err(failure("skill_contract_mismatch", false));
    }
    Ok(operation)
}
