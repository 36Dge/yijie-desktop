use super::host::SkillRuntime;
use super::market_v2_generated::{
    Bundle, Catalog, DependencyState, ErrorResponse, InstallState, Mutation, Operation, Origin,
    Skill,
};
use crate::chat::ChatRuntime;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

pub(crate) fn enabled() -> bool {
    std::env::var("YIJIE_FEAT174_NATIVE_SKILLS").as_deref() == Ok("true")
}
pub(crate) fn failure(code: &str, retryable: bool) -> ErrorResponse {
    ErrorResponse {
        code: code.to_owned(),
        retryable,
    }
}
pub(super) async fn host(
    runtime: &SkillRuntime,
    chat: &ChatRuntime,
) -> Result<std::sync::Arc<crate::chat::HostBridge>, ErrorResponse> {
    if !enabled() {
        return Err(failure("skill_market_unavailable", false));
    }
    runtime
        .host(chat)
        .await
        .map_err(|_| failure("skill_host_unavailable", true))
}

#[tauri::command]
pub async fn skills_list_v2(
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Catalog, ErrorResponse> {
    let result = match host(&runtime, &chat).await {
        Ok(host) => host.skill_market_catalog().await,
        Err(error) => Err(error),
    };
    match result {
        Err(error)
            if matches!(
                error.code.as_str(),
                "skill_host_unavailable" | "skill_runtime_unavailable" | "runtime_unavailable"
            ) =>
        {
            offline_catalog(&runtime)
        }
        value => value,
    }
}
#[tauri::command]
pub async fn skills_mutate_v2(
    request: Mutation,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Operation, ErrorResponse> {
    request
        .validate()
        .map_err(|_| failure("invalid_request", false))?;
    host(&runtime, &chat)
        .await?
        .skill_market_mutate(&request)
        .await
}
#[tauri::command]
pub async fn skills_operation_v2(
    operation_id: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Operation, ErrorResponse> {
    validate_operation(&operation_id)?;
    host(&runtime, &chat)
        .await?
        .skill_market_operation(&operation_id, false)
        .await
}
#[tauri::command]
pub async fn skills_cancel_v2(
    operation_id: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Operation, ErrorResponse> {
    validate_operation(&operation_id)?;
    host(&runtime, &chat)
        .await?
        .skill_market_operation(&operation_id, true)
        .await
}
pub(super) fn validate_operation(id: &str) -> Result<(), ErrorResponse> {
    let parsed = Uuid::parse_str(id).map_err(|_| failure("invalid_request", false))?;
    if parsed.is_nil() || parsed.to_string() != id {
        return Err(failure("invalid_request", false));
    }
    Ok(())
}

#[tauri::command]
pub async fn skills_import_v2(
    operation_id: String,
    runtime: State<'_, SkillRuntime>,
    chat: State<'_, ChatRuntime>,
) -> Result<Option<Operation>, ErrorResponse> {
    validate_operation(&operation_id)?;
    let host = host(&runtime, &chat).await?;
    let Some(path) = super::import_dialog::pick_file().await else {
        return Ok(None);
    };
    let file = super::import_dialog::read_file(path).await?;
    host.skill_market_import(&operation_id, &file.name, &file.digest, file.bytes)
        .await
        .map(Some)
}

fn offline_catalog(runtime: &SkillRuntime) -> Result<Catalog, ErrorResponse> {
    let roots = runtime
        .roots()
        .ok_or_else(|| failure("skill_resource_unavailable", false))?;
    let (bundle, _, expected) = super::native_market_roots(&roots)
        .map_err(|_| failure("skill_resource_unavailable", false))?;
    let bytes = std::fs::read(bundle.join("presentation.json"))
        .map_err(|_| failure("skill_resource_unavailable", false))?;
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err(failure("skill_resource_unavailable", false));
    }
    let bundle: Bundle =
        serde_json::from_slice(&bytes).map_err(|_| failure("skill_contract_mismatch", false))?;
    bundle
        .validate()
        .map_err(|_| failure("skill_contract_mismatch", false))?;
    Ok(offline_projection(bundle, expected))
}
fn offline_projection(bundle: Bundle, revision: String) -> Catalog {
    Catalog {
        schema_version: 2,
        revision,
        operations: Vec::new(),
        notice: Some("内置目录可浏览；当前无法确认安装状态，服务恢复后请刷新。".to_owned()),
        skills: bundle
            .skills
            .into_iter()
            .map(|source| Skill {
                id: source.id,
                version: source.content_version,
                runtime_name: String::new(),
                display_name: source.display_name,
                description: source.description,
                category: source.category,
                order: source.order,
                icon_key: source.icon_key,
                origin: Origin::Builtin,
                installation_state: InstallState::Unknown,
                enabled: false,
                runtime_visible: false,
                retired: false,
                dependency_state: DependencyState::Unknown,
                required_tools: source.required_tools,
                epoch: 0,
                failure_code: "runtime_unavailable".to_owned(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_catalog_never_claims_an_installation_fact() {
        let bundle = Bundle {
            schema_version: 2,
            marketplace_name: "yijie-builtin".to_owned(),
            skills: vec![super::super::market_v2_generated::CatalogSource {
                id: "ordinary".to_owned(),
                content_version: "1.0.0".to_owned(),
                content_sha256: "a".repeat(64),
                source_revision: "b".repeat(64),
                native_package_version: "1.0.0".to_owned(),
                plugin_name: "ordinary".to_owned(),
                display_name: "Ordinary".to_owned(),
                description: "Ordinary source".to_owned(),
                category: "personal".to_owned(),
                order: 0,
                icon_key: "skill".to_owned(),
                required_tools: Vec::new(),
                source_path: "plugins/ordinary".to_owned(),
                files: Vec::new(),
            }],
        };
        let projected = offline_projection(bundle, "c".repeat(64));
        assert_eq!(
            projected.skills[0].installation_state,
            InstallState::Unknown
        );
        assert!(!projected.skills[0].enabled && !projected.skills[0].runtime_visible);
        assert!(projected.operations.is_empty());
        assert!(projected.notice.is_some());
    }
}
