mod native_auth;

use native_auth::{AuthStatus, CommandError, NativeAuthRuntime, OperationResponse};
use tauri::State;

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
) -> Result<AuthStatus, CommandError> {
    runtime.logout().await
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
    tauri::Builder::default()
        .manage(NativeAuthRuntime::from_environment())
        .invoke_handler(tauri::generate_handler![
            runtime_health,
            native_auth_login,
            native_auth_logout,
            native_auth_status,
            list_my_tenants,
            get_my_capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
