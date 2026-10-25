//! FEAT-158 local expert capability. The canonical daily launcher selects this
//! profile; enabling it never replaces per-operation Native admission.
#[allow(dead_code, unused_imports)]
#[cfg_attr(feature = "kimi-k31-pro-candidate", path = "generated_v2.rs")]
pub(crate) mod generated;
pub(crate) mod store;

#[cfg(test)]
mod store_tests;

pub(crate) fn enabled() -> bool {
    super::models::enabled()
        && super::connectors::enabled()
        && super::runtime_permissions::enabled()
        && std::env::var("YIJIE_EXPERTS_ENABLED").as_deref() == Ok("true")
}

pub(crate) fn control_error(
    error: super::connectors::control::ExpertControlError,
) -> generated::ErrorCode {
    use super::connectors::control::ExpertControlError as E;
    match error {
        E::Rejected(error) => error.code,
        E::OutcomeUnknown => generated::ErrorCode::OutcomeUnknown,
        E::InvalidRequest => generated::ErrorCode::InvalidRequest,
        E::Closed | E::Busy => generated::ErrorCode::TemporarilyUnavailable,
    }
}

pub(crate) async fn status(
    skills: &crate::skills::SkillRuntime,
    host: &super::HostBridge,
    scope: generated::ScopeBinding,
) -> Result<generated::PrivateStatus, generated::ErrorCode> {
    if !enabled() {
        return Err(generated::ErrorCode::UnsupportedCapability);
    }
    let control = host
        .market_control()
        .ok_or(generated::ErrorCode::UnsupportedCapability)?;
    let id = uuid::Uuid::now_v7().to_string();
    let response: generated::PrivateStatusResponse = control
        .expert_request(
            &id,
            &generated::PrivateStatusRequest {
                schema_version: 1,
                request_id: id.clone(),
                method: "expert_status".into(),
                payload: generated::PrivateStatusPayload {
                    host_instance_id: host.instance_nonce().into(),
                    scope,
                },
            },
            "expert_status",
        )
        .await
        .map_err(control_error)?;
    if response.data.catalog_revision != skills.expert_catalog_revision()? {
        return Err(generated::ErrorCode::VersionUnavailable);
    }
    Ok(response.data)
}

pub(crate) async fn require_execution(
    _chat: &super::ChatRuntime,
    skills: &crate::skills::SkillRuntime,
    host: &super::HostBridge,
    scope: generated::ScopeBinding,
) -> Result<(), generated::ErrorCode> {
    if !status(skills, host, scope).await?.execution_available {
        return Err(generated::ErrorCode::QualificationRequired);
    }
    Ok(())
}

pub(crate) mod commands;
pub(crate) mod resources;
#[cfg(test)]
mod resources_tests;
