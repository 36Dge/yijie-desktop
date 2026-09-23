//! macOS notifications are observed, never synthesized as an OS wake command.
use super::lifecycle::{Lifecycle, Phase};
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::{rc::Retained, runtime::ProtocolObject};
    use objc2_foundation::{NSNotificationCenter, NSObjectProtocol};
    struct Observers {
        center: Retained<NSNotificationCenter>,
        tokens: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    }
    impl Drop for Observers {
        fn drop(&mut self) {
            for token in &self.tokens {
                unsafe {
                    self.center
                        .removeObserver(AsRef::<objc2::runtime::AnyObject>::as_ref(&**token));
                }
            }
        }
    }
    thread_local! {static OBSERVERS:std::cell::RefCell<Option<Observers>>=const{std::cell::RefCell::new(None)};}
    pub(super) fn install(lifecycle: Lifecycle) {
        // Registered/unregistered on Tauri's main thread. Callback captures only Send
        // native state and never touches WebView, DB or a framework object.
        let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        let mut tokens = Vec::new();
        for (name, phase) in unsafe {
            [
                (
                    objc2_app_kit::NSWorkspaceWillSleepNotification,
                    Phase::Suspended,
                ),
                (
                    objc2_app_kit::NSWorkspaceDidWakeNotification,
                    Phase::Recovering,
                ),
            ]
        } {
            let gate = lifecycle.clone();
            let block = block2::RcBlock::new(
                move |_: std::ptr::NonNull<objc2_foundation::NSNotification>| {
                    gate.transition(phase);
                },
            );
            tokens.push(unsafe {
                center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
            });
        }
        OBSERVERS.with(|v| *v.borrow_mut() = Some(Observers { center, tokens }));
    }
    pub(super) fn uninstall() {
        OBSERVERS.with(|v| {
            v.borrow_mut().take();
        });
    }
}
pub(crate) fn install(lifecycle: Lifecycle) {
    #[cfg(target_os = "macos")]
    mac::install(lifecycle);
    #[cfg(not(target_os = "macos"))]
    let _ = lifecycle;
}
pub(crate) fn uninstall() {
    #[cfg(target_os = "macos")]
    mac::uninstall();
}
