use super::generated::*;
use super::{error, WorkflowRuntime};
use tauri::{State, WebviewWindow};

async fn require_app_main(
    window: &WebviewWindow,
    runtime: &WorkflowRuntime,
) -> Result<(), ErrorResponse> {
    let trusted = window.label() == "main"
        && window
            .url()
            .ok()
            .is_some_and(|url| super::window::app_url(&url));
    if !trusted {
        runtime.invalidate_local().await;
        return Err(error(ErrorCode::Unauthorized));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn workflow_service_status(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
) -> Result<ServiceStatus, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.service_status().await
}

#[tauri::command]
pub(crate) async fn workflow_list(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: ListRequest,
) -> Result<WorkflowList, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.list(request).await
}

#[tauri::command]
pub(crate) async fn workflow_create(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: CreateInput,
) -> Result<Workflow, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.create(request).await
}

#[tauri::command]
pub(crate) async fn workflow_editor_open(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: EditorOpenRequest,
) -> Result<EditorOpenedView, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.open(request).await
}

#[tauri::command]
pub(crate) async fn workflow_editor_exchange(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: EditorExchangeInput,
) -> Result<EditorExchangeResult, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.exchange(request).await
}

#[tauri::command]
pub(crate) async fn workflow_editor_close(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: EditorCloseInput,
) -> Result<CloseResult, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.close(request).await
}

#[tauri::command]
pub(crate) async fn workflow_run_start(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: RunInput,
) -> Result<Run, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.start_run(request).await
}

#[tauri::command]
pub(crate) async fn workflow_run_query(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: RunQueryInput,
) -> Result<RunQueryResult, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.query(request).await
}

#[tauri::command]
pub(crate) async fn workflow_delete(
    window: WebviewWindow,
    runtime: State<'_, WorkflowRuntime>,
    request: DeleteInput,
) -> Result<DeleteResult, ErrorResponse> {
    require_app_main(&window, &runtime).await?;
    runtime.delete(request).await
}
