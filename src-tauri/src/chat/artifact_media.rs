//! FEAT-159 adapters for existing Artifact storage and system media rendering.
use super::{
    artifact::{MAX_ARTIFACT_BYTES, MAX_IMAGE_BYTES},
    artifact_native::{ArtifactNativeCode, ArtifactNativeError, ArtifactNativeResponse},
    ChatRuntime,
};
use serde::Serialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State, WebviewWindow};

pub fn enabled() -> bool {
    std::env::var("YIJIE_ARTIFACT_MEDIA_ENABLED").as_deref() == Ok("true")
        && std::env::var("YIJIE_ENV").as_deref() == Ok("local")
        && std::env::var("YIJIE_LOCAL_PROFILE").as_deref() == Ok("demo_fast")
}

// FEAT-165 rides the current K3.1 candidate and its compatible private reader.
pub fn files_enabled() -> bool {
    enabled() && cfg!(feature = "kimi-k31-pro-candidate")
}

pub(super) fn validate_artifact_image(mime: &str, bytes: &[u8]) -> Result<(), ()> {
    if mime != "image/svg+xml" {
        return super::attachment::validate_image_content(mime, bytes)
            .map(|_| ())
            .map_err(|_| ());
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES || bytes.contains(&0) {
        return Err(());
    }
    std::str::from_utf8(bytes).map_err(|_| ())?;
    let mut reader = quick_xml::NsReader::from_reader(bytes);
    let mut depth = 0usize;
    let mut root = false;
    loop {
        let (namespace, event) = reader.read_resolved_event().map_err(|_| ())?;
        let svg_namespace = matches!(namespace, quick_xml::name::ResolveResult::Bound(ns)
            if ns.as_ref() == b"http://www.w3.org/2000/svg");
        match event {
            quick_xml::events::Event::DocType(_) | quick_xml::events::Event::PI(_) => {
                return Err(())
            }
            quick_xml::events::Event::Start(e) => {
                if depth == 0 {
                    if root || e.local_name().as_ref() != b"svg" || !svg_namespace {
                        return Err(());
                    }
                    root = true;
                }
                depth += 1;
                if depth > 128 {
                    return Err(());
                }
            }
            quick_xml::events::Event::Empty(e) if depth == 0 => {
                if root || e.local_name().as_ref() != b"svg" || !svg_namespace {
                    return Err(());
                }
                root = true;
            }
            quick_xml::events::Event::End(_) => {
                depth = depth.checked_sub(1).ok_or(())?;
            }
            quick_xml::events::Event::Eof => {
                return if root && depth == 0 { Ok(()) } else { Err(()) }
            }
            _ => {}
        }
    }
}

#[derive(Serialize)]
pub struct HtmlPreviewResult {
    status: &'static str,
}

#[cfg(target_os = "macos")]
thread_local! { static HTML_VIEWS:std::cell::RefCell<std::collections::HashMap<String,wry::WebView>>=std::cell::RefCell::new(std::collections::HashMap::new()); }

#[tauri::command]
pub async fn chat_open_artifact_html_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
) -> Result<ArtifactNativeResponse<HtmlPreviewResult>, ArtifactNativeError> {
    let request = super::artifact_file_native::decode_request(request)?;
    let fail = |c| ArtifactNativeError::new(Some(request.request_id), c);
    if webview.label() != "main" {
        return Err(fail(ArtifactNativeCode::Forbidden));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| fail(ArtifactNativeCode::Unavailable))?
        .as_secs() as i64;
    let content = super::artifact_file_native::authorized_file(
        &chat_runtime,
        request.context_id,
        request.payload,
        now,
        MAX_ARTIFACT_BYTES,
    )
    .await
    .map_err(fail)?;
    if content.media_type != "text/html" {
        return Err(fail(ArtifactNativeCode::Unsupported));
    }
    let label = html_window_label(request.context_id, request.payload.artifact_id);
    let authorization = chat_runtime
        .authorization_manager()
        .map_err(|_| fail(ArtifactNativeCode::Unauthenticated))?;
    let app = webview.app_handle().clone();
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let deadline = content.expires_at.unwrap_or(now).min(now + 1800);
            let result = open_html_window(
                &handle,
                &label,
                content.bytes,
                authorization,
                request.context_id,
                deadline,
            );
            let _ = tx.send(result);
        })
        .map_err(|_| fail(ArtifactNativeCode::Unavailable))?;
        rx.await
            .map_err(|_| fail(ArtifactNativeCode::Unavailable))?
            .map_err(fail)?;
    }
    #[cfg(not(target_os = "macos"))]
    return Err(fail(ArtifactNativeCode::Unsupported));
    Ok(ArtifactNativeResponse::new(
        request.request_id,
        HtmlPreviewResult { status: "opened" },
    ))
}

#[tauri::command]
pub async fn chat_close_artifact_html_preview_v1(
    request: Value,
    webview: WebviewWindow,
) -> Result<(), ArtifactNativeError> {
    let request = super::artifact_file_native::decode_request(request)?;
    if webview.label() != "main" {
        return Err(ArtifactNativeError::new(
            Some(request.request_id),
            ArtifactNativeCode::Forbidden,
        ));
    }
    if let Some(window) = webview.app_handle().get_window(&html_window_label(
        request.context_id,
        request.payload.artifact_id,
    )) {
        window.close().map_err(|_| {
            ArtifactNativeError::new(Some(request.request_id), ArtifactNativeCode::Unavailable)
        })?;
    }
    Ok(())
}

fn html_window_label(context_id: uuid::Uuid, artifact_id: uuid::Uuid) -> String {
    format!("artifact-html-{context_id}-{artifact_id}")
}

#[cfg(target_os = "macos")]
fn open_html_window(
    app: &tauri::AppHandle,
    label: &str,
    bytes: Vec<u8>,
    authorization: super::ChatAuthorizationManager,
    context_id: uuid::Uuid,
    deadline: i64,
) -> Result<(), ArtifactNativeCode> {
    if let Some(window) = app.get_window(label) {
        return window
            .set_focus()
            .map_err(|_| ArtifactNativeCode::Unavailable);
    }
    if HTML_VIEWS.with(|v| v.borrow().len() >= 2) {
        return Err(ArtifactNativeCode::LimitExceeded);
    }
    let window = tauri::window::WindowBuilder::new(app, label)
        .title("HTML 预览 · 易界")
        .inner_size(1000., 720.)
        .min_inner_size(640., 480.)
        .visible(false)
        .build()
        .map_err(|_| ArtifactNativeCode::Unavailable)?;
    let document = "yijie-html://preview/document";
    let view=wry::WebViewBuilder::new()
  .with_incognito(true).with_devtools(false)
  .with_navigation_handler(move|url|url==document)
  .with_new_window_req_handler(|_,_|wry::NewWindowResponse::Deny)
  .with_download_started_handler(|_,_|false)
  .with_custom_protocol("yijie-html".into(),move|_,request|{
   let allowed=request.uri()==document&&request.method()=="GET";
   let body=if allowed{bytes.clone()}else{Vec::new()};
   // Delivered by the resource response: document markup cannot relax this policy.
   wry::http::Response::builder().status(if allowed{200}else{404})
    .header("Content-Type","text/html; charset=utf-8").header("Cache-Control","no-store")
    .header("X-Content-Type-Options","nosniff")
    .header("Content-Security-Policy","sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
    .body(std::borrow::Cow::Owned(body)).expect("constant headers")
  })
  .with_url(document).build(&window).map_err(|_|{let _=window.close();ArtifactNativeCode::Unavailable})?;
    // This raw Wry view never installs Tauri's initialization or IPC handler.
    HTML_VIEWS.with(|views| {
        views.borrow_mut().insert(label.to_owned(), view);
    });
    let owned = label.to_owned();
    let destroyed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let destroyed_event = destroyed.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            destroyed_event.store(true, std::sync::atomic::Ordering::Release);
            HTML_VIEWS.with(|views| {
                views.borrow_mut().remove(&owned);
            });
        }
    });
    window.show().map_err(|_| ArtifactNativeCode::Unavailable)?;
    let label = label.to_owned();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if destroyed.load(std::sync::atomic::Ordering::Acquire) {
                return;
            }
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|t| t.as_secs() as i64);
            let authorized = now.is_some_and(|now| {
                now < deadline
                    && authorization
                        .authorize_detailed(context_id, super::ChatAction::ReadSessions, now)
                        .is_ok()
            });
            if !authorized {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if !destroyed.load(std::sync::atomic::Ordering::Acquire) {
                        if let Some(window) = handle.get_window(&label) {
                            let _ = window.close();
                        }
                    }
                });
                return;
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_normal_svg_and_sample_video() {
        assert!(validate_artifact_image("image/svg+xml",br#"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="teal"/></svg>"#).is_ok());
        assert!(validate_artifact_image("image/svg+xml",br#"<?xml version="1.0"?><s:svg xmlns:s="http://www.w3.org/2000/svg" width="80" height="60"><s:rect width="80" height="60" fill="teal"/></s:svg>"#).is_ok());
        assert!(validate_artifact_image(
            "image/svg+xml",
            br#"<s:svg xmlns:s="http://www.w3.org/2000/svg" width="80" height="60"/>"#
        )
        .is_ok());
        if let Ok(sample) = std::env::var("YIJIE_TEST_MEDIA_FILE") {
            let bytes = std::fs::read(sample).unwrap();
            assert!(super::super::artifact_video_native::validate_mp4(&bytes).is_ok());
        }
    }
}
