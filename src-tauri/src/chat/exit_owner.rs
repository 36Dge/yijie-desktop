//! A Tauri-owned task survives repeated quit requests and retains normal stop work.
use super::{lifecycle::Phase, ChatIpcRuntime, ChatRuntime};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;

pub(crate) const QUIT_MENU_ID: &str = "yijie-normal-quit";

#[cfg(target_os = "macos")]
mod system_quit {
    use super::*;
    use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
    use objc2_foundation::{
        MainThreadMarker, NSAppleEventDescriptor, NSAppleEventManager, NSObject, NSObjectProtocol,
    };

    // macOS SDK AppleEvents.h: kCoreEventClass / kAEQuitApplication (OSType=u32).
    const EVENT_CLASS: u32 = u32::from_be_bytes(*b"aevt");
    const EVENT_ID: u32 = u32::from_be_bytes(*b"quit");

    define_class!(
        // NSObject has no additional subclass requirements. The handler and its
        // AppHandle are retained on the main thread until cleanup is complete.
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = tauri::AppHandle]
        struct YijieNormalQuitHandler;

        unsafe impl NSObjectProtocol for YijieNormalQuitHandler {}

        impl YijieNormalQuitHandler {
            #[unsafe(method(handleQuit:withReplyEvent:))]
            fn handle_quit(
                &self,
                _event: Option<&NSAppleEventDescriptor>,
                _reply: Option<&NSAppleEventDescriptor>,
            ) {
                eprintln!("FEAT-164 normal system quit requested");
                let app = self.ivars();
                app.state::<ExitOwner>().request(app.clone());
            }
        }
    );

    thread_local! {
        static HANDLER: std::cell::RefCell<Option<Retained<YijieNormalQuitHandler>>> = const { std::cell::RefCell::new(None) };
    }

    pub(super) fn install(app: &tauri::AppHandle) -> std::io::Result<()> {
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| std::io::Error::other("system quit requires the main thread"))?;
        let allocated = YijieNormalQuitHandler::alloc(mtm).set_ivars(app.clone());
        // SAFETY: NSObject init has this signature; no superclass overrides.
        let handler: Retained<YijieNormalQuitHandler> =
            unsafe { msg_send![super(allocated), init] };
        HANDLER.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_some() {
                return Err(std::io::Error::other("system quit already installed"));
            }
            let manager = NSAppleEventManager::sharedAppleEventManager();
            // SAFETY: Foundation's documented signature is (id, SEL, OSType,
            // OSType). The selector above accepts event/reply descriptors. Only
            // this App's standard Quit event is registered; no delegate or
            // runtime method is replaced. The strong handler lives in HANDLER.
            let _: () = unsafe {
                msg_send![&manager, setEventHandler: &*handler,
                    andSelector: sel!(handleQuit:withReplyEvent:),
                    forEventClass: EVENT_CLASS, andEventID: EVENT_ID]
            };
            *slot = Some(handler);
            Ok(())
        })
    }

    pub(super) fn uninstall() {
        HANDLER.with(|slot| {
            if slot.borrow().is_some() {
                let manager = NSAppleEventManager::sharedAppleEventManager();
                // SAFETY: Matching Foundation method takes the same two OSType
                // values. Remove registration before releasing the handler.
                let _: () = unsafe {
                    msg_send![&manager, removeEventHandlerForEventClass: EVENT_CLASS,
                        andEventID: EVENT_ID]
                };
                slot.borrow_mut().take();
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn install_system_quit(app: &tauri::AppHandle) -> std::io::Result<()> {
    system_quit::install(app)
}

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
                    #[cfg(target_os = "macos")]
                    system_quit::uninstall();
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
            eprintln!("FEAT-164 normal app cleanup complete");
            app.exit(0);
        });
        if let Ok(mut owner) = self.task.lock() {
            *owner = Some(task);
        }
    }
}
