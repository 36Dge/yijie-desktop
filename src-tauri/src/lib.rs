pub mod chat;
#[cfg(feature = "feat126-s10-driver")]
mod feat126_s10_driver;
mod feat126_secure_storage;
#[cfg(feature = "feat128-s10-runtime")]
mod feat128_s10d_runtime;
#[cfg(feature = "feat128-s7b-runtime")]
mod feat128_s7b_runtime;
mod local_profile;
mod native_auth;
#[cfg(target_os = "macos")]
mod single_instance;
mod skills;

pub use feat126_secure_storage::feat126_secure_storage_test_control;

use chat::{
    ArtifactFileNativeRuntime, ArtifactNativeRuntime, ArtifactReportNativeRuntime,
    ArtifactVideoNativeRuntime, ChatIpcRuntime, ChatRuntime,
};
use local_profile::LocalRuntimeProfile;
use native_auth::NativeAuthRuntime;
#[cfg(not(feature = "feat126-s10-driver"))]
use native_auth::{AuthStatus, CommandError, OperationResponse};
#[cfg(not(feature = "feat126-s10-driver"))]
use serde::Deserialize;
#[cfg(not(feature = "feat126-s10-driver"))]
use skills::SkillRuntime;
use tauri::Manager;
#[cfg(not(feature = "feat126-s10-driver"))]
use tauri::State;
#[cfg(not(feature = "feat126-s10-driver"))]
use zeroize::ZeroizeOnDrop;

#[cfg(not(feature = "feat126-s10-driver"))]
#[derive(Deserialize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct LocalWhitelistLoginRequest {
    username: String,
    password: String,
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
fn runtime_health() -> &'static str {
    "ok"
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn native_auth_login(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<AuthStatus, CommandError> {
    runtime.login().await
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn native_auth_local_whitelist_login(
    request: LocalWhitelistLoginRequest,
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<AuthStatus, CommandError> {
    runtime
        .local_whitelist_login(&request.username, &request.password)
        .await
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn native_auth_logout(
    runtime: State<'_, NativeAuthRuntime>,
    chat_runtime: State<'_, ChatRuntime>,
    chat_ipc_runtime: State<'_, ChatIpcRuntime>,
    artifact_file_native_runtime: State<'_, ArtifactFileNativeRuntime>,
    artifact_native_runtime: State<'_, ArtifactNativeRuntime>,
    artifact_report_native_runtime: State<'_, ArtifactReportNativeRuntime>,
    artifact_video_native_runtime: State<'_, ArtifactVideoNativeRuntime>,
) -> Result<AuthStatus, CommandError> {
    let status = runtime.logout().await?;
    if let Ok(manager) = chat_runtime.authorization_manager() {
        let _ = manager.invalidate_all();
    }
    chat_ipc_runtime.invalidate_pending_bindings();
    chat_ipc_runtime.invalidate_all();
    artifact_file_native_runtime.invalidate_all();
    artifact_native_runtime.invalidate_all();
    artifact_report_native_runtime.invalidate_all();
    artifact_video_native_runtime.invalidate_all();
    Ok(status)
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn native_auth_status(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<AuthStatus, CommandError> {
    runtime.status().await
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn list_my_tenants(
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<OperationResponse, CommandError> {
    runtime.list_my_tenants().await
}

#[cfg(not(feature = "feat126-s10-driver"))]
#[tauri::command]
async fn get_my_capabilities(
    tenant_id: String,
    runtime: State<'_, NativeAuthRuntime>,
) -> Result<OperationResponse, CommandError> {
    runtime.get_my_capabilities(&tenant_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let _single_instance = match single_instance::acquire() {
        Ok(guard) => guard,
        Err(single_instance::AcquireError::AlreadyRunning)
            if std::env::var("YIJIE_FEAT131_STABLE_ENTRY").as_deref() == Ok("true") =>
        {
            eprintln!("yijie desktop instance is already running");
            std::process::exit(1);
        }
        Err(single_instance::AcquireError::AlreadyRunning) => return,
        Err(
            single_instance::AcquireError::UnsafeLockFile
            | single_instance::AcquireError::Unavailable,
        ) => {
            eprintln!("yijie desktop single-instance guard unavailable");
            std::process::exit(1);
        }
    };
    #[cfg(feature = "feat126-s10-driver")]
    chat::feat126_s10_driver_unregistered_command_guard();
    let secure_storage = feat126_secure_storage::Feat126SecureStorageBootstrap::from_environment();
    let local_profile = LocalRuntimeProfile::from_environment();
    let local_profile_invalid = local_profile.is_err();
    let local_profile = local_profile.unwrap_or_default();
    #[cfg(feature = "feat126-s10-driver")]
    let driver = match feat126_s10_driver::Feat126S10DriverRuntime::from_environment(
        secure_storage.profile(),
    ) {
        Ok(driver) => driver,
        Err(failure_class) => {
            feat126_s10_driver::emit_startup_failure_from_environment(failure_class);
            std::process::exit(1);
        }
    };
    #[cfg(feature = "feat126-s10-driver")]
    driver.start_startup_watchdog();
    let native_auth = NativeAuthRuntime::from_environment_with_test_profile(
        secure_storage.profile(),
        secure_storage.is_invalid() || local_profile_invalid,
        local_profile,
    );
    let chat_native_auth = native_auth.clone();
    let chat_secure_storage = secure_storage.profile();
    let chat_secure_storage_invalid = secure_storage.is_invalid();
    #[cfg(feature = "feat128-s7b-runtime")]
    let feat128_s7b_runtime =
        feat128_s7b_runtime::Feat128S7bRuntimeHarness::from_environment(secure_storage.profile())
            .unwrap_or_else(|failure| panic!("{failure}"));
    #[cfg(feature = "feat128-s10-runtime")]
    let feat128_s10d_runtime =
        feat128_s10d_runtime::Feat128S10dRuntime::from_environment(secure_storage.profile())
            .unwrap_or_else(|failure| panic!("{failure}"));
    let builder = tauri::Builder::default()
        .manage(native_auth)
        .manage(ChatIpcRuntime::new())
        .manage(ArtifactFileNativeRuntime::new())
        .manage(ArtifactNativeRuntime::new())
        .manage(ArtifactReportNativeRuntime::new())
        .manage(ArtifactVideoNativeRuntime::new());
    #[cfg(feature = "feat128-s7b-runtime")]
    let builder = builder.manage(feat128_s7b_runtime);
    #[cfg(feature = "feat128-s10-runtime")]
    let builder = builder.manage(feat128_s10d_runtime);
    let builder = builder.on_window_event(|window, event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            window
                .state::<ArtifactFileNativeRuntime>()
                .invalidate_webview(window.label());
            window
                .state::<ArtifactNativeRuntime>()
                .invalidate_webview(window.label());
            window
                .state::<ArtifactReportNativeRuntime>()
                .invalidate_webview(window.label());
            window
                .state::<ArtifactVideoNativeRuntime>()
                .invalidate_webview(window.label());
        }
    });
    #[cfg(not(feature = "feat126-s10-driver"))]
    let builder = builder.register_asynchronous_uri_scheme_protocol(
        "yijie-artifact-preview",
        chat::artifact_native::handle_preview_protocol,
    );
    #[cfg(not(feature = "feat126-s10-driver"))]
    let builder = builder.register_asynchronous_uri_scheme_protocol(
        "yijie-artifact-video",
        chat::artifact_video_native::handle_video_protocol,
    );
    #[cfg(feature = "feat126-s10-driver")]
    let startup_failure_driver = driver.clone();
    #[cfg(feature = "feat126-s10-driver")]
    let page_load_driver = driver.clone();
    #[cfg(feature = "feat126-s10-driver")]
    let builder = builder.manage(driver);
    #[cfg(feature = "feat126-s10-driver")]
    let builder = builder.on_page_load(move |_webview, payload| {
        page_load_driver.record_page_load(payload.event());
    });
    let builder = builder.setup(move |app| {
        #[cfg(feature = "feat126-s10-driver")]
        {
            let setup_driver = app
                .state::<feat126_s10_driver::Feat126S10DriverRuntime>()
                .inner()
                .clone();
            setup_driver.record_setup_entry();
            if let Err(failure_class) = setup_driver.record_app_handle_ready(app.handle()) {
                setup_driver.emit_startup_failure(failure_class);
                return Err(std::io::Error::other(failure_class).into());
            }
            setup_driver.guard_setup(|| {
                let app_data_directory = match app.path().app_data_dir() {
                    Ok(path) => path,
                    Err(error) => {
                        setup_driver.emit_startup_failure("driver_app_data_invalid");
                        return Err(Box::new(error) as Box<dyn std::error::Error>);
                    }
                };
                app.manage(ChatRuntime::from_environment(
                    app_data_directory,
                    chat_secure_storage.clone(),
                    chat_secure_storage_invalid || local_profile_invalid,
                    chat_native_auth.clone(),
                    local_profile,
                    None,
                ));
                if let Err(failure_class) = setup_driver.start_control_monitor(app.handle().clone())
                {
                    setup_driver.emit_startup_failure(failure_class);
                    return Err(std::io::Error::other(failure_class).into());
                }
                Ok(())
            })
        }
        #[cfg(not(feature = "feat126-s10-driver"))]
        {
            let app_data_directory = match app.path().app_data_dir() {
                Ok(path) => path,
                Err(error) => {
                    return Err(Box::new(error) as Box<dyn std::error::Error>);
                }
            };
            let skill_runtime = if local_profile.is_demo_fast() {
                match app
                    .path()
                    .resource_dir()
                    .map_err(|_| skills::SkillRootsError::PathUnavailable)
                    .and_then(|resource_directory| {
                        skills::resolve_skill_roots(&resource_directory, &app_data_directory)
                    }) {
                    Ok(roots) => SkillRuntime::from_roots(roots),
                    Err(_) => SkillRuntime::unavailable(),
                }
            } else {
                SkillRuntime::disabled()
            };
            let skill_roots = skill_runtime.roots();
            app.manage(skill_runtime);
            app.manage(ChatRuntime::from_environment(
                app_data_directory,
                chat_secure_storage.clone(),
                chat_secure_storage_invalid || local_profile_invalid,
                chat_native_auth.clone(),
                local_profile,
                skill_roots,
            ));
            if let Some(roots) = app.state::<SkillRuntime>().roots() {
                skills::watch_skill_install_root(app.handle().clone(), roots.install_root.clone());
            }
            let startup_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let runtime = startup_app.state::<SkillRuntime>();
                let chat = startup_app.state::<ChatRuntime>();
                skills::reconcile_background(&runtime, &chat, "startup").await;
            });
            #[cfg(feature = "feat128-s7b-runtime")]
            feat128_s7b_runtime::Feat128S7bRuntimeHarness::start_watchdog(app.handle().clone());
            #[cfg(feature = "feat128-s10-runtime")]
            feat128_s10d_runtime::Feat128S10dRuntime::start_watchdog(app.handle().clone());
            Ok(())
        }
    });
    #[cfg(not(feature = "feat126-s10-driver"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_health,
        native_auth_login,
        native_auth_local_whitelist_login,
        native_auth_logout,
        native_auth_status,
        list_my_tenants,
        get_my_capabilities,
        skills::host::skills_list_v1,
        skills::host::skills_scan_v1,
        skills::host::skills_install_v1,
        skills::host::skills_set_enabled_v1,
        skills::host::skills_uninstall_v1,
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
        chat::ipc::chat_pick_attachments_v2,
        chat::ipc::chat_import_attachments_v2,
        chat::ipc::chat_list_draft_attachments_v2,
        chat::ipc::chat_remove_attachment_v2,
        chat::ipc::chat_create_session_v2,
        chat::ipc::chat_submit_turn_v2,
        chat::ipc::chat_list_sessions_v1,
        chat::ipc::chat_load_history_v1,
        chat::ipc::chat_load_history_v2,
        chat::ipc::chat_load_history_v3,
        chat::artifact_native::chat_open_artifact_image_preview_v1,
        chat::artifact_native::chat_release_artifact_image_preview_v1,
        chat::artifact_native::chat_save_artifact_image_v1,
        chat::artifact_video_native::chat_open_artifact_video_preview_v1,
        chat::artifact_video_native::chat_release_artifact_video_preview_v1,
        chat::artifact_video_native::chat_save_artifact_video_v1,
        chat::artifact_file_native::chat_read_artifact_file_preview_v1,
        chat::artifact_file_native::chat_save_artifact_file_v1,
        chat::artifact_report_native::chat_read_artifact_report_preview_v1,
        chat::artifact_report_native::chat_save_artifact_report_v1,
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
        chat::ipc::chat_resync_session_v2,
        chat::ipc::chat_decide_approval_v6,
        chat::ipc::chat_cancel_request_v1,
        chat::ipc::chat_unsubscribe_session_v1,
        #[cfg(feature = "feat128-s7b-runtime")]
        feat128_s7b_runtime::feat128_s7b_runtime_seed,
        #[cfg(feature = "feat128-s7b-runtime")]
        feat128_s7b_runtime::feat128_s7b_runtime_result,
        #[cfg(feature = "feat128-s10-runtime")]
        feat128_s10d_runtime::feat128_s10d_runtime_prepare_v1,
        #[cfg(feature = "feat128-s10-runtime")]
        feat128_s10d_runtime::feat128_s10d_runtime_checkpoint_v1,
        #[cfg(feature = "feat128-s10-runtime")]
        feat128_s10d_runtime::feat128_s10d_runtime_finish_v1
    ]);
    #[cfg(feature = "feat126-s10-driver")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        feat126_s10_driver::feat126_s10_driver_startup_stage,
        feat126_s10_driver::feat126_s10_driver_login,
        feat126_s10_driver::feat126_s10_driver_register_project,
        feat126_s10_driver::feat126_s10_driver_bind,
        feat126_s10_driver::feat126_s10_driver_list_projects,
        feat126_s10_driver::feat126_s10_driver_list_sessions,
        feat126_s10_driver::feat126_s10_driver_get_local_readiness,
        feat126_s10_driver::feat126_s10_driver_revalidate_project,
        feat126_s10_driver::feat126_s10_driver_request_local_recovery,
        feat126_s10_driver::feat126_s10_driver_component_ready,
        feat126_s10_driver::feat126_s10_driver_case_result,
        feat126_s10_driver::feat126_s10_driver_r8_observation,
        feat126_s10_driver::feat126_s10_driver_r8_phase,
        feat126_s10_driver::feat126_s10_driver_wait_case,
        feat126_s10_driver::feat126_s10_driver_planned_restart,
        feat126_s10_driver::feat126_s10_driver_chat,
        feat126_s10_driver::feat126_s10_driver_wait_abort,
        feat126_s10_driver::feat126_s10_driver_abort_complete,
        feat126_s10_driver::feat126_s10_driver_fail_closed
    ]);
    #[cfg(feature = "feat126-s10-driver")]
    if builder.run(tauri::generate_context!()).is_err() {
        startup_failure_driver.emit_startup_failure("driver_tauri_startup_invalid");
        std::process::exit(1);
    }
    #[cfg(not(feature = "feat126-s10-driver"))]
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                // Tauri terminates the process after this callback, so managed state destructors
                // are not a reliable place to stop the owned Host child.
                let _ = tauri::async_runtime::block_on(
                    app.state::<ChatRuntime>().shutdown_for_app_exit(),
                );
            }
        });
}
