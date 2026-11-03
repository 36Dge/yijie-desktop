//! Compact native traffic lights without replacing their actions or hit frames.

use objc2_app_kit::{NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSRect, NSSize};

const TRAFFIC_LIGHT_DIAMETER: f64 = 12.0;

fn drawing_bounds(size: NSSize) -> Option<NSRect> {
    let diameter = size.width.min(size.height);
    if !diameter.is_finite() || diameter <= 0.0 {
        return None;
    }
    let scale = (TRAFFIC_LIGHT_DIAMETER / diameter).min(1.0);
    let bounds = NSSize::new(size.width / scale, size.height / scale);
    Some(NSRect::new(
        NSPoint::new(
            (size.width - bounds.width) / 2.0,
            (size.height - bounds.height) / 2.0,
        ),
        bounds,
    ))
}

pub fn apply(window: &tauri::Window) {
    if window.label() != "main" {
        return;
    }
    let handle = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(pointer) = handle.ns_window() else {
            return;
        };
        if pointer.is_null() {
            return;
        }
        // Tauri owns this NSWindow; borrow it only while executing on AppKit's
        // main thread. No native pointer is retained across window events.
        let native = unsafe { &*pointer.cast::<NSWindow>() };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            let Some(button) = native.standardWindowButton(kind) else {
                continue;
            };
            // NSControl.controlSize is ignored by standard window widgets.
            // NSView bounds scale their native drawing while preserving frame,
            // tracking, target/action, hover symbols and accessibility identity.
            // Derive from frame each time so resize/focus cannot compound scale.
            if let Some(bounds) = drawing_bounds(button.frame().size) {
                if button.bounds() != bounds {
                    button.setBounds(bounds);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_drawing_preserves_center_and_native_hit_frame() {
        let frame = NSSize::new(14.0, 14.0);
        let bounds = drawing_bounds(frame).unwrap();
        let scale = frame.width / bounds.size.width;
        assert!((14.0 * scale - 12.0).abs() < 0.000_001);
        assert!((bounds.origin.x + bounds.size.width / 2.0 - 7.0).abs() < 0.000_001);
        assert!((bounds.origin.y + bounds.size.height / 2.0 - 7.0).abs() < 0.000_001);
        assert_eq!(frame, NSSize::new(14.0, 14.0));
    }

    #[test]
    fn already_compact_native_buttons_are_not_enlarged() {
        assert_eq!(
            drawing_bounds(NSSize::new(12.0, 12.0)),
            Some(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(12.0, 12.0)))
        );
    }
}
