use super::WorkflowRuntime;
use tauri::{Manager, WebviewWindowBuilder};
use url::Url;

pub(super) fn app_url(url: &Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.host_str() == Some("localhost")
        && ((url.scheme() == "tauri" && url.port().is_none())
            || (url.scheme() == "http" && url.port() == Some(1420)))
}

fn navigation_allowed(url: &Url) -> bool {
    app_url(url)
        || (url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(18888)
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/editor/"
            && url.query().is_none()
            && url.fragment().is_none())
}

pub(crate) fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main" && !window.create)
    else {
        return Ok(());
    };
    if !super::exact_local_enabled() {
        return Err(tauri::Error::Anyhow(
            std::io::Error::other("workflow window requires the exact local workflow profile")
                .into(),
        ));
    }
    let window = WebviewWindowBuilder::from_config(app, config)?
        // This callback is URL-only, not a main/subframe discriminator. The
        // parent Vue controls the iframe src; its sandbox prevents top navigation.
        .on_navigation(navigation_allowed)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_page_load(|window, _| {
            // Read the actual top document instead of treating an iframe load as
            // a top-level context change. No native delegate is replaced.
            if !window.url().ok().is_some_and(|url| app_url(&url)) {
                window
                    .state::<WorkflowRuntime>()
                    .invalidate_from_window_event();
            }
        })
        .build()?;
    report_geometry(&window);
    let observed = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Resized(_)) {
            report_geometry(&observed);
        }
    });
    Ok(())
}

// Exact-local native observation only. CUA drives actual window resizing;
// these measurements distinguish logical window dimensions from a scaled
// screenshot. No content, identity, credential, URL or browser IPC is emitted.
fn report_geometry(window: &tauri::WebviewWindow) {
    if !super::exact_local_enabled() {
        return;
    }
    let (Ok(scale), Ok(inner), Ok(outer)) = (
        window.scale_factor(),
        window.inner_size(),
        window.outer_size(),
    ) else {
        return;
    };
    let inner = inner.to_logical::<f64>(scale);
    let outer = outer.to_logical::<f64>(scale);
    eprintln!(
        "YIJIE_WORKFLOW_LOCAL_DIAGNOSTIC {}",
        serde_json::json!({
            "event": "window_geometry",
            "app_pid": std::process::id(),
            "scale_factor": scale,
            "inner_width": inner.width,
            "inner_height": inner.height,
            "outer_width": outer.width,
            "outer_height": outer.height,
        })
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_app_routes_and_exact_editor_entry_are_the_navigation_surface() {
        for address in [
            "http://localhost:1420/workflows",
            "tauri://localhost/workflows",
            "http://127.0.0.1:18888/editor/",
        ] {
            assert!(navigation_allowed(&Url::parse(address).unwrap()));
        }
        // Preview images and video remain subresources under the existing CSP;
        // they are not documents to which the main window should navigate.
        assert!(!app_url(
            &Url::parse("http://127.0.0.1:18888/editor/").unwrap()
        ));
        assert!(!navigation_allowed(
            &Url::parse("http://127.0.0.1:18888/v1/workflows").unwrap()
        ));
    }
}
