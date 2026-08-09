pub mod chat;
#[cfg(feature = "feat126-s10-driver")]
mod feat126_s10_driver;
mod feat126_secure_storage;
mod native_auth;

pub use feat126_secure_storage::feat126_secure_storage_test_control;

use chat::{ChatIpcRuntime, ChatRuntime};
use native_auth::{AuthStatus, CommandError, NativeAuthRuntime, OperationResponse};
use tauri::{Manager, State};

#[tauri::command]
fn runtime_health() -> &'static str {
    "ok"
}

#[tauri::command]
async fn native_auth_login(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<AuthStatus, CommandError> {
    runtime.login().await
}

#[tauri::command]
async fn native_auth_logout(
    runtime: State<'_, NativeAuthRuntime>,
    chat_runtime: State<'_, ChatRuntime>,
    chat_ipc_runtime: State<'_, ChatIpcRuntime>,
) -> Result<AuthStatus, CommandError> {
    let status = runtime.logout().await?;
    if let Ok(manager) = chat_runtime.authorization_manager() {
        let _ = manager.invalidate_all();
    }
    chat_ipc_runtime.invalidate_pending_bindings();
    chat_ipc_runtime.invalidate_all();
    Ok(status)
}

#[tauri::command]
async fn native_auth_status(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<AuthStatus, CommandError> {
    runtime.status().await
}

#[tauri::command]
async fn list_my_tenants(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<OperationResponse, CommandError> {
    runtime.list_my_tenants().await
}

#[tauri::command]
async fn get_my_capabilities(
    tenant_id: String,
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<OperationResponse, CommandError> {
    runtime.get_my_capabilities(&tenant_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let secure_storage = feat126_secure_storage::Feat126SecureStorageBootstrap::from_environment();
    let native_auth = NativeAuthRuntime::from_environment_with_test_profile(
        secure_storage.profile(),
        secure_storage.is_invalid(),
    );
    let chat_native_auth = native_auth.clone();
    let chat_secure_storage = secure_storage.profile();
    let chat_secure_storage_invalid = secure_storage.is_invalid();
    let builder = tauri::Builder::default()
        .manage(native_auth)
        .manage(ChatIpcRuntime::new())
        .setup(move |app| {
            let app_data_directory = app
                .path()
                .app_data_dir()
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(ChatRuntime::from_environment(
                app_data_directory,
                chat_secure_storage.clone(),
                chat_secure_storage_invalid,
                chat_native_auth.clone(),
            ));
            Ok(())
        });
    #[cfg(not(feature = "feat126-s10-driver"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_health,
        native_auth_login,
        native_auth_logout,
        native_auth_status,
        list_my_tenants,
        get_my_capabilities,
        chat::chat_foundation_status,
        chat::chat_start_local_host,
        chat::chat_stop_local_host,
        chat::ipc::chat_bind_context_v1,
        chat::ipc::chat_list_projects_v1,
        chat::ipc::chat_pick_project_v1,
        chat::ipc::chat_revalidate_project_v1,
        chat::ipc::chat_set_project_pinned_v1,
        chat::ipc::chat_remove_project_v1,
        chat::ipc::chat_create_session_v1,
        chat::ipc::chat_submit_turn_v1,
        chat::ipc::chat_list_sessions_v1,
        chat::ipc::chat_load_history_v1,
        chat::ipc::chat_load_reasoning_v1,
        chat::ipc::chat_rename_session_v1,
        chat::ipc::chat_set_session_pinned_v1,
        chat::ipc::chat_interrupt_turn_v1,
        chat::ipc::chat_delete_session_v1,
        chat::ipc::chat_get_cleanup_status_v1,
        chat::ipc::chat_get_session_control_plane_v1,
        chat::ipc::chat_get_local_readiness_v1,
        chat::ipc::chat_request_local_recovery_v1,
        chat::ipc::chat_subscribe_session_v1,
        chat::ipc::chat_resync_session_v1,
        chat::ipc::chat_cancel_request_v1,
        chat::ipc::chat_unsubscribe_session_v1
    ]);
    #[cfg(feature = "feat126-s10-driver")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_health,
        native_auth_login,
        native_auth_logout,
        native_auth_status,
        list_my_tenants,
        get_my_capabilities,
        chat::chat_foundation_status,
        chat::chat_start_local_host,
        chat::chat_stop_local_host,
        chat::ipc::chat_bind_context_v1,
        chat::ipc::chat_list_projects_v1,
        chat::ipc::chat_pick_project_v1,
        chat::ipc::chat_revalidate_project_v1,
        chat::ipc::chat_set_project_pinned_v1,
        chat::ipc::chat_remove_project_v1,
        chat::ipc::chat_create_session_v1,
        chat::ipc::chat_submit_turn_v1,
        chat::ipc::chat_list_sessions_v1,
        chat::ipc::chat_load_history_v1,
        chat::ipc::chat_load_reasoning_v1,
        chat::ipc::chat_rename_session_v1,
        chat::ipc::chat_set_session_pinned_v1,
        chat::ipc::chat_interrupt_turn_v1,
        chat::ipc::chat_delete_session_v1,
        chat::ipc::chat_get_cleanup_status_v1,
        chat::ipc::chat_get_session_control_plane_v1,
        chat::ipc::chat_get_local_readiness_v1,
        chat::ipc::chat_request_local_recovery_v1,
        chat::ipc::chat_subscribe_session_v1,
        chat::ipc::chat_resync_session_v1,
        chat::ipc::chat_cancel_request_v1,
        chat::ipc::chat_unsubscribe_session_v1,
        feat126_s10_driver::feat126_s10_driver_probe
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
