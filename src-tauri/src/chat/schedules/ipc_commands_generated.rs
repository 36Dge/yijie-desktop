// Generated command allowlist; no dynamic dispatch surface. DO NOT EDIT.
use super::ipc;
#[tauri::command]
pub async fn schedule_availability_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_availability_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_plans_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_plans_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_get_plan_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(request, &chat_runtime, &ipc_runtime, "schedule_get_plan_v1").await
}
#[tauri::command]
pub async fn schedule_preview_time_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_preview_time_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_targets_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_targets_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_records_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_records_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_get_record_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_get_record_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_save_plan_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_save_plan_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_pause_plan_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_pause_plan_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_delete_plan_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_delete_plan_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_confirm_grant_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_confirm_grant_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_confirm_enable_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_confirm_enable_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_manual_run_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_manual_run_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_preview_rerun_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_preview_rerun_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_confirm_rerun_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_confirm_rerun_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_submit_draft_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_submit_draft_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_preview_draft_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_preview_draft_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_confirm_draft_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_confirm_draft_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_find_draft_source_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_find_draft_source_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_operation_capabilities_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_operation_capabilities_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_continue_draft_source_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_continue_draft_source_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_plan_cards_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_plan_cards_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_record_rows_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_record_rows_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_read_plan_mutation_receipt_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_read_plan_mutation_receipt_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_read_draft_submission_receipt_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_read_draft_submission_receipt_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_read_execution_receipt_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_read_execution_receipt_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_confirm_single_run_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_confirm_single_run_v1",
    )
    .await
}
#[tauri::command]
pub async fn schedule_list_important_updates_v1(
    request: serde_json::Value,
    chat_runtime: tauri::State<'_, crate::chat::ChatRuntime>,
    ipc_runtime: tauri::State<'_, ipc::ScheduleIpcRuntime>,
) -> Result<serde_json::Value, super::ipc_generated::ErrorResponse> {
    ipc::command(
        request,
        &chat_runtime,
        &ipc_runtime,
        "schedule_list_important_updates_v1",
    )
    .await
}
