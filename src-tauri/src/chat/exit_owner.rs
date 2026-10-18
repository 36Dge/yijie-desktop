//! A Tauri-owned task survives repeated quit requests and retains normal stop work.
use super::{lifecycle::Phase, ChatIpcRuntime, ChatRuntime};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;

pub(crate) const QUIT_MENU_ID: &str = "yijie-normal-quit";

#[cfg(target_os = "macos")]
pub(crate) fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    // The macOS predefined Quit calls NSApplication terminate: directly. Keep
    // the standard menu, replacing only that action with our existing owner.
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            for (position, item) in submenu.items()?.into_iter().enumerate() {
                if let MenuItemKind::Predefined(item) = item {
                    if item.text()? == quit_text {
                        submenu.remove(&item)?;
                        submenu.insert(
                            &MenuItem::with_id(
                                app,
                                QUIT_MENU_ID,
                                &quit_text,
                                true,
                                Some("CmdOrCtrl+Q"),
                            )?,
                            position,
                        )?;
                        return Ok(menu);
                    }
                }
            }
        }
    }
    Err(std::io::Error::other("normal quit menu unavailable").into())
}

#[derive(Default)]
pub(crate) struct ExitOwner {
    started: AtomicBool,
    ready: AtomicBool,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}
impl ExitOwner {
    pub(crate) fn ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
    pub(crate) fn request(&self, app: tauri::AppHandle) {
        app.state::<ChatRuntime>()
            .lifecycle
            .transition(Phase::Stopping);
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let task = tauri::async_runtime::spawn(async move {
            let mut reported = false;
            loop {
                let stopped = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    app.state::<ChatIpcRuntime>().stop_coordinator(),
                )
                .await;
                if matches!(stopped, Ok(Ok(()))) {
                    break;
                }
                app.state::<ChatRuntime>()
                    .lifecycle
                    .transition(Phase::StopPending);
                if !reported {
                    eprintln!("FEAT-155 STOP_PENDING: waiting for normal coordinator stop");
                    reported = true;
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            app.state::<crate::workflows::WorkflowRuntime>()
                .shutdown_for_app_exit()
                .await;
            loop {
                if app
                    .state::<ChatRuntime>()
                    .shutdown_for_app_exit()
                    .await
                    .is_ok()
                {
                    break;
                }
                app.state::<ChatRuntime>()
                    .lifecycle
                    .transition(Phase::StopPending);
                if !reported {
                    eprintln!("FEAT-155 STOP_PENDING: managed process or database still owned");
                    reported = true;
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            let (tx, rx) = tokio::sync::oneshot::channel();
            if app
                .run_on_main_thread(move || {
                    super::platform_lifecycle::uninstall();
                    let _ = tx.send(());
                })
                .is_err()
                || rx.await.is_err()
            {
                return;
            }
            app.state::<ChatRuntime>()
                .lifecycle
                .transition(Phase::Stopped);
            app.state::<ExitOwner>().ready.store(true, Ordering::SeqCst);
            app.exit(0);
        });
        if let Ok(mut owner) = self.task.lock() {
            *owner = Some(task);
        }
    }
}
