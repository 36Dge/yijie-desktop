//! FEAT-166 private, identity-only presentation of existing Native files.
use super::artifact_file_native::{authorized_file, ArtifactLocator};
use super::artifact_native::{
    ArtifactNativeCode as Code, ArtifactNativeError, ArtifactNativeResponse,
};
use super::authorization::{AuthorizationFailure, ChatAction};
use super::document_preview_content::{self as content, Section, SOURCE_BUDGET};
use super::{ChatRuntime, ConversationApplication};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum DocumentSource {
    #[serde(rename_all = "camelCase")]
    Artifact {
        session_id: Uuid,
        turn_id: Uuid,
        artifact_id: Uuid,
    },
    #[serde(rename_all = "camelCase")]
    Attachment {
        session_id: Uuid,
        #[serde(deserialize_with = "required_optional_uuid")]
        message_id: Option<Uuid>,
        attachment_id: Uuid,
    },
}
fn required_optional_uuid<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Uuid>, D::Error> {
    Option::<Uuid>::deserialize(d)
}
impl DocumentSource {
    pub fn ids(&self) -> (Uuid, Option<Uuid>, Uuid) {
        match *self {
            Self::Artifact {
                session_id,
                turn_id,
                artifact_id,
            } => (session_id, Some(turn_id), artifact_id),
            Self::Attachment {
                session_id,
                message_id,
                attachment_id,
            } => (session_id, message_id, attachment_id),
        }
    }
}
pub(super) struct StoredDocument {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub expires: i64,
    pub revision: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Viewport {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Location {
    section: usize,
    offset: usize,
    zoom: f64,
    scroll_x: f64,
    scroll_y: f64,
    revision: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    #[serde(rename_all = "camelCase")]
    Open {
        view_id: Uuid,
        source: DocumentSource,
        viewport: Viewport,
        location: Location,
        theme: String,
    },
    #[serde(rename_all = "camelCase")]
    Resize {
        view_id: Uuid,
        viewport: Viewport,
        visible: bool,
    },
    #[serde(rename_all = "camelCase")]
    Position { view_id: Uuid },
    #[serde(rename_all = "camelCase")]
    Close { view_id: Uuid },
}
impl Action {
    fn view_id(&self) -> Uuid {
        match *self {
            Self::Open { view_id, .. }
            | Self::Resize { view_id, .. }
            | Self::Position { view_id }
            | Self::Close { view_id } => view_id,
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u8,
    request_id: Uuid,
    context_id: Uuid,
    payload: Action,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    kind: &'static str,
    revision: String,
    expires_at: i64,
    sections: Vec<Section>,
    section: usize,
    offset: usize,
    next_offset: Option<usize>,
    previous_offset: Option<usize>,
    partial: bool,
    notice: Option<&'static str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    scroll_x: f64,
    scroll_y: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultData {
    status: &'static str,
    view_id: Uuid,
    document: Option<DocumentMetadata>,
    position: Option<Position>,
}
fn now() -> Result<i64, Code> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .map_err(|_| Code::Unavailable)
}
fn authorize(runtime: &ChatRuntime, context: Uuid) -> Result<(), Code> {
    let manager = runtime
        .authorization_manager()
        .map_err(|_| Code::Unavailable)?;
    manager
        .authorize_detailed(context, ChatAction::ReadSessions, now()?)
        .map_err(|e| match e {
            AuthorizationFailure::ContextInvalid => Code::Unauthenticated,
            AuthorizationFailure::CapabilityDenied => Code::Forbidden,
        })
}

async fn read_source(
    runtime: &ChatRuntime,
    context: Uuid,
    source: &DocumentSource,
) -> Result<StoredDocument, Code> {
    authorize(runtime, context)?;
    let (session, second, id) = source.ids();
    if session.is_nil() || id.is_nil() || second.is_some_and(|id| id.is_nil()) {
        return Err(Code::InvalidRequest);
    }
    match source {
        DocumentSource::Artifact { .. } => {
            let content = authorized_file(
                runtime,
                context,
                ArtifactLocator {
                    session_id: session,
                    turn_id: second.ok_or(Code::InvalidRequest)?,
                    artifact_id: id,
                },
                now()?,
                SOURCE_BUDGET,
            )
            .await?;
            Ok(StoredDocument {
                mime: content.media_type.into(),
                bytes: content.bytes,
                expires: content.expires_at.ok_or(Code::Expired)?,
                revision: content.sha256.iter().map(|b| format!("{b:02x}")).collect(),
            })
        }
        DocumentSource::Attachment { .. } => {
            let application = runtime
                .local_offline_conversation_application()
                .await
                .map_err(|_| Code::Unavailable)?;
            application
                .bound_document_preview(session, second, id)
                .await
                .map_err(|_| Code::Unavailable)?
                .map_err(|e| match e {
                    super::artifact::ReadyFileReadError::NotFound => Code::NotFound,
                    super::artifact::ReadyFileReadError::NotReady => Code::NotReady,
                    super::artifact::ReadyFileReadError::Expired => Code::Expired,
                    super::artifact::ReadyFileReadError::Unsupported => Code::Unsupported,
                    super::artifact::ReadyFileReadError::Integrity => Code::IntegrityFailed,
                    super::artifact::ReadyFileReadError::LimitExceeded => Code::LimitExceeded,
                })
        }
    }
}

#[tauri::command]
pub async fn chat_document_preview_v1(
    request: Value,
    webview: WebviewWindow,
    chat_runtime: State<'_, ChatRuntime>,
    image_runtime: State<'_, super::ArtifactNativeRuntime>,
) -> Result<ArtifactNativeResponse<ResultData>, ArtifactNativeError> {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok());
    let fail = |code| ArtifactNativeError::new(request_id, code);
    if webview.label() != "main" || !super::artifact_media::files_enabled() {
        return Err(fail(Code::Forbidden));
    }
    if serde_json::to_vec(&request).map_or(true, |v| v.len() > 8192) {
        return Err(fail(Code::InvalidRequest));
    }
    let request: Request =
        serde_json::from_value(request).map_err(|_| fail(Code::InvalidRequest))?;
    if request.schema_version != 1
        || request.request_id.is_nil()
        || request.context_id.is_nil()
        || request.payload.view_id().is_nil()
    {
        return Err(fail(Code::InvalidRequest));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (request, image_runtime);
        Err(fail(Code::Unsupported))
    }
    #[cfg(target_os = "macos")]
    {
        let id = request.payload.view_id();
        let context = request.context_id;
        let data = match request.payload {
            Action::Open {
                source,
                viewport,
                mut location,
                theme,
                ..
            } => {
                if !matches!(theme.as_str(), "light" | "dark")
                    || !location.zoom.is_finite()
                    || !(0.5..=3.0).contains(&location.zoom)
                    || !location.scroll_x.is_finite()
                    || !location.scroll_y.is_finite()
                    || location.scroll_x < 0.0
                    || location.scroll_y < 0.0
                    || location.scroll_x > 10_000_000.0
                    || location.scroll_y > 10_000_000.0
                    || location.revision.as_ref().is_some_and(|revision| {
                        revision.len() != 64
                            || !revision
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
                {
                    return Err(fail(Code::InvalidRequest));
                }
                let _read_lease = image_runtime.borrow_read(SOURCE_BUDGET).map_err(fail)?;
                let stored = read_source(&chat_runtime, context, &source)
                    .await
                    .map_err(fail)?;
                if stored.expires <= now().map_err(fail)? {
                    return Err(fail(Code::Expired));
                }
                if location
                    .revision
                    .as_deref()
                    .is_some_and(|r| r != stored.revision)
                {
                    location.section = 0;
                    location.offset = 0;
                    location.scroll_x = 0.0;
                    location.scroll_y = 0.0;
                }
                let render_location = location.clone();
                let dark = theme == "dark";
                let revision = stored.revision.clone();
                let expires = stored.expires.min(now().map_err(fail)? + 1800);
                let presentation = tokio::task::spawn_blocking(move || {
                    content::render(
                        &stored.mime,
                        &stored.bytes,
                        render_location.section,
                        render_location.offset,
                        dark,
                        render_location.zoom,
                    )
                })
                .await
                .map_err(|_| fail(Code::Unavailable))?
                .map_err(fail)?;
                authorize(&chat_runtime, context).map_err(fail)?;
                let application = chat_runtime
                    .local_offline_conversation_application()
                    .await
                    .map_err(|_| fail(Code::Unavailable))?;
                if !application
                    .document_preview_current(
                        source.clone(),
                        revision.clone(),
                        now().map_err(fail)?,
                    )
                    .await
                    .map_err(|_| fail(Code::Unavailable))?
                {
                    return Err(fail(Code::Expired));
                }
                let metadata = DocumentMetadata {
                    kind: presentation.kind,
                    revision: revision.clone(),
                    expires_at: expires,
                    sections: presentation.sections.clone(),
                    section: presentation.section,
                    offset: presentation.offset,
                    next_offset: presentation.next,
                    previous_offset: presentation.previous,
                    partial: presentation.partial,
                    notice: presentation
                        .partial
                        .then_some("部分内容预览：存在截断或未呈现对象"),
                };
                let app = webview.app_handle().clone();
                let parent = webview.clone();
                let (tx, rx) = tokio::sync::oneshot::channel();
                app.run_on_main_thread(move || {
                    let _ = tx.send(platform::open(
                        parent,
                        id,
                        context,
                        viewport,
                        location,
                        presentation,
                    ));
                })
                .map_err(|_| fail(Code::Unavailable))?;
                let live = rx
                    .await
                    .map_err(|_| fail(Code::Unavailable))?
                    .map_err(fail)?;
                monitor(
                    webview.app_handle().clone(),
                    application,
                    context,
                    source,
                    revision,
                    expires,
                    id,
                    live,
                );
                ResultData {
                    status: "ready",
                    view_id: id,
                    document: Some(metadata),
                    position: None,
                }
            }
            Action::Resize {
                viewport, visible, ..
            } => {
                authorize(&chat_runtime, context).map_err(fail)?;
                let parent = webview.clone();
                let (tx, rx) = tokio::sync::oneshot::channel();
                webview
                    .app_handle()
                    .run_on_main_thread(move || {
                        let _ = tx.send(platform::resize(&parent, id, context, viewport, visible));
                    })
                    .map_err(|_| fail(Code::Unavailable))?;
                rx.await
                    .map_err(|_| fail(Code::Unavailable))?
                    .map_err(fail)?;
                ResultData {
                    status: "resized",
                    view_id: id,
                    document: None,
                    position: None,
                }
            }
            Action::Position { .. } => {
                authorize(&chat_runtime, context).map_err(fail)?;
                let (tx, rx) = tokio::sync::oneshot::channel();
                webview
                    .app_handle()
                    .run_on_main_thread(move || platform::position(id, context, tx))
                    .map_err(|_| fail(Code::Unavailable))?;
                let position = tokio::time::timeout(std::time::Duration::from_secs(2), rx)
                    .await
                    .map_err(|_| fail(Code::Unavailable))?
                    .map_err(|_| fail(Code::Unavailable))?;
                ResultData {
                    status: "position",
                    view_id: id,
                    document: None,
                    position: Some(position),
                }
            }
            Action::Close { .. } => {
                let (tx, rx) = tokio::sync::oneshot::channel();
                webview
                    .app_handle()
                    .run_on_main_thread(move || {
                        platform::close(id, context);
                        let _ = tx.send(());
                    })
                    .map_err(|_| fail(Code::Unavailable))?;
                rx.await.map_err(|_| fail(Code::Unavailable))?;
                ResultData {
                    status: "closed",
                    view_id: id,
                    document: None,
                    position: None,
                }
            }
        };
        Ok(ArtifactNativeResponse::new(request.request_id, data))
    }
}

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_arguments)]
fn monitor(
    app: tauri::AppHandle,
    application: ConversationApplication,
    context: Uuid,
    source: DocumentSource,
    revision: String,
    expires: i64,
    id: Uuid,
    live: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    tauri::async_runtime::spawn(async move {
        while live.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if !live.load(Ordering::Acquire) {
                break;
            }
            let runtime = app.state::<ChatRuntime>();
            let reason = match now() {
                Err(_) => Some("unavailable"),
                Ok(time) if time >= expires => Some("expired"),
                Ok(time) => match authorize(&runtime, context) {
                    Err(Code::Unauthenticated | Code::Forbidden) => Some("forbidden"),
                    Err(_) => Some("unavailable"),
                    Ok(()) => match application
                        .document_preview_current(source.clone(), revision.clone(), time)
                        .await
                    {
                        Ok(true) => None,
                        Ok(false) => Some("expired"),
                        Err(_) => Some("unavailable"),
                    },
                },
            };
            if let Some(reason) = reason {
                let event = serde_json::json!({"viewId":id,"reason":reason});
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    platform::close(id, context);
                    let _ = handle.emit_to("main", "chat-document-preview-invalidated", event);
                });
                break;
            }
        }
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{
        cell::RefCell,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };
    struct View {
        id: Uuid,
        context: Uuid,
        webview: wry::WebView,
        live: Arc<AtomicBool>,
        loaded: bool,
        visible: bool,
    }
    impl Drop for View {
        fn drop(&mut self) {
            self.live.store(false, Ordering::Release);
            let _ = self.webview.set_visible(false);
        }
    }
    thread_local! {static CURRENT:RefCell<Option<View>>=const{RefCell::new(None)};static CANCELLED:RefCell<std::collections::VecDeque<(Uuid,Uuid)>>=const{RefCell::new(std::collections::VecDeque::new())};static CLEANUP_INSTALLED:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
    fn bounds(parent: &WebviewWindow, v: &Viewport) -> Result<wry::Rect, Code> {
        if ![v.x, v.y, v.width, v.height, v.dpr]
            .iter()
            .all(|n| n.is_finite())
            || v.x < 0.0
            || v.y < 0.0
            || v.width < 1.0
            || v.height < 1.0
            || v.width > 20_000.0
            || v.height > 20_000.0
            || !(0.25..=8.0).contains(&v.dpr)
        {
            return Err(Code::InvalidRequest);
        }
        let size = parent.inner_size().map_err(|_| Code::Unavailable)?;
        if (v.x + v.width) * v.dpr > f64::from(size.width) + 2.0
            || (v.y + v.height) * v.dpr > f64::from(size.height) + 2.0
        {
            return Err(Code::InvalidRequest);
        }
        Ok(wry::Rect {
            position: wry::dpi::PhysicalPosition::new(v.x * v.dpr, v.y * v.dpr).into(),
            size: wry::dpi::PhysicalSize::new(v.width * v.dpr, v.height * v.dpr).into(),
        })
    }
    pub fn close(id: Uuid, context: Uuid) {
        CANCELLED.with(|s| {
            let mut s = s.borrow_mut();
            if !s.contains(&(id, context)) {
                s.push_back((id, context));
            }
            while s.len() > 256 {
                s.pop_front();
            }
        });
        CURRENT.with(|s| {
            let mut s = s.borrow_mut();
            if s.as_ref()
                .is_some_and(|v| v.id == id && v.context == context)
            {
                s.take();
            }
        });
    }
    pub fn resize(
        parent: &WebviewWindow,
        id: Uuid,
        context: Uuid,
        viewport: Viewport,
        visible: bool,
    ) -> Result<(), Code> {
        let rect = bounds(parent, &viewport)?;
        CURRENT.with(|s| {
            let mut s = s.borrow_mut();
            let v = s
                .as_mut()
                .filter(|v| v.id == id && v.context == context)
                .ok_or(Code::NotFound)?;
            v.visible = visible;
            v.webview.set_bounds(rect).map_err(|_| Code::Unavailable)?;
            v.webview
                .set_visible(visible && v.loaded)
                .map_err(|_| Code::Unavailable)
        })
    }
    pub fn position(id: Uuid, context: Uuid, tx: tokio::sync::oneshot::Sender<Position>) {
        CURRENT.with(|s| {
            let s = s.borrow();
            if let Some(v) = s.as_ref().filter(|v| v.id == id && v.context == context) {
                let tx = std::sync::Mutex::new(Some(tx));
                let _ = v.webview.evaluate_script_with_callback(
                    "({scrollX:Math.max(0,window.scrollX),scrollY:Math.max(0,window.scrollY)})",
                    move |value| {
                        let value: Value = serde_json::from_str(&value).unwrap_or(Value::Null);
                        let n = |k| {
                            value
                                .get(k)
                                .and_then(Value::as_f64)
                                .filter(|n| n.is_finite() && *n >= 0.0)
                                .unwrap_or(0.0)
                                .min(10_000_000.0)
                        };
                        if let Some(tx) = tx.lock().ok().and_then(|mut tx| tx.take()) {
                            let _ = tx.send(Position {
                                scroll_x: n("scrollX"),
                                scroll_y: n("scrollY"),
                            });
                        }
                    },
                );
            } else {
                let _ = tx.send(Position {
                    scroll_x: 0.0,
                    scroll_y: 0.0,
                });
            }
        });
    }
    pub fn open(
        parent: WebviewWindow,
        id: Uuid,
        context: Uuid,
        viewport: Viewport,
        location: Location,
        p: content::Presentation,
    ) -> Result<Arc<AtomicBool>, Code> {
        if CANCELLED.with(|s| s.borrow().contains(&(id, context))) {
            return Err(Code::NotFound);
        }
        let rect = bounds(&parent, &viewport)?;
        let app = parent.app_handle().clone();
        CLEANUP_INSTALLED.with(|flag| {
            if !flag.replace(true) {
                parent.on_window_event(|event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        CURRENT.with(|s| {
                            s.borrow_mut().take();
                        });
                    }
                });
            }
        });
        CURRENT.with(|s| {
            s.borrow_mut().take();
        });
        let live = Arc::new(AtomicBool::new(true));
        let resource_live = live.clone();
        let root = "yijie-document://preview/document";
        let html = p.html.into_bytes();
        let assets = p.assets;
        let readonly = format!(
            r#"(() => {{
const stop=e=>{{e.preventDefault();e.stopImmediatePropagation();}};
for(const t of ['click','dblclick','auxclick','submit','contextmenu','dragstart','drop'])window.addEventListener(t,stop,true);
window.addEventListener('keydown',e=>{{e.stopImmediatePropagation();const copy=(e.metaKey||e.ctrlKey)&&['c','a'].includes(e.key.toLowerCase());const read=!e.metaKey&&!e.ctrlKey&&!e.altKey&&['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(e.key);if(!copy&&!read)e.preventDefault();}},true);
for(const t of ['keyup','keypress'])window.addEventListener(t,e=>e.stopImmediatePropagation(),true);
for(const t of ['pointerdown','pointerup','pointermove','mousedown','mouseup','mousemove','touchstart','touchend'])window.addEventListener(t,e=>{{e.stopImmediatePropagation();if(e.target?.closest?.('input,select,textarea,button,a,[contenteditable]'))e.preventDefault();}},true);
window.addEventListener('wheel',e=>e.stopImmediatePropagation(),{{capture:true,passive:true}});
const disable=()=>{{for(const e of document.querySelectorAll('input,select,textarea,button,iframe,object,embed,[contenteditable]')){{e.setAttribute('disabled','');e.setAttribute('tabindex','-1');e.setAttribute('aria-disabled','true');if(e.hasAttribute('contenteditable'))e.setAttribute('contenteditable','false');}}for(const a of document.querySelectorAll('a'))a.setAttribute('tabindex','-1');}};
window.addEventListener('DOMContentLoaded',()=>{{document.documentElement.style.zoom='{}';disable();new MutationObserver(disable).observe(document.documentElement,{{childList:true,subtree:true}});}},{{once:true}});
window.addEventListener('load',()=>window.scrollTo({},{}),{{once:true}});
}})();"#,
            if p.kind == "html" { location.zoom } else { 1.0 },
            location.scroll_x.min(10_000_000.0),
            location.scroll_y.min(10_000_000.0)
        );
        let load_app = app.clone();
        let view=wry::WebViewBuilder::new().with_incognito(true).with_devtools(false).with_focused(false).with_visible(false).with_bounds(rect)
            .with_initialization_script(readonly)
            .with_navigation_handler(move|url|url==root)
            .with_new_window_req_handler(|_,_|wry::NewWindowResponse::Deny)
            .with_download_started_handler(|_,_|false)
            .with_custom_protocol("yijie-document".into(),move|_,request|{
                let uri=request.uri().to_string();
                let (mime,body)=if resource_live.load(Ordering::Acquire)&&request.method()=="GET"&&uri==root{("text/html; charset=utf-8",html.clone())}
                    else if resource_live.load(Ordering::Acquire)&&request.method()=="GET"{uri.strip_prefix("yijie-document://preview/").and_then(|k|assets.get(k)).map(|b|("image/png",b.clone())).unwrap_or(("text/plain",vec![]))}
                    else{("text/plain",vec![])};
                wry::http::Response::builder().status(if body.is_empty(){404}else{200}).header("Content-Type",mime).header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff")
                    .header("Content-Security-Policy","sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: yijie-document:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
                    .body(std::borrow::Cow::Owned(body)).expect("constant resource headers")
            })
            .with_on_page_load_handler(move|event,_|{if matches!(event,wry::PageLoadEvent::Finished){let app=load_app.clone();let _=load_app.run_on_main_thread(move||{CURRENT.with(|s|{if let Some(v)=s.borrow_mut().as_mut().filter(|v|v.id==id){v.loaded=true;let _=v.webview.set_visible(v.visible);}});let _=app.emit_to("main","chat-document-preview-loaded",serde_json::json!({"viewId":id}));});}})
            .with_url(root).build_as_child(&parent).map_err(|_|Code::Unavailable)?;
        CURRENT.with(|s| {
            *s.borrow_mut() = Some(View {
                id,
                context,
                webview: view,
                live: live.clone(),
                loaded: false,
                visible: false,
            })
        });
        Ok(live)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_normal_document_requests_round_trip_through_native_types() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../schemas/fixtures/chat-document-preview-v1.json"
        ))
        .unwrap();
        for value in fixtures["requests"].as_array().unwrap() {
            let request: Request = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(request).unwrap(), *value);
        }
    }
}
