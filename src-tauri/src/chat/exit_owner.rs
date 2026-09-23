//! A Tauri-owned task survives repeated quit requests and retains normal stop work.
use super::{lifecycle::Phase, ChatIpcRuntime, ChatRuntime};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;
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
