//! Desktop-owned access to user-selected search sources. Display metadata alone
//! never grants access: every request resolves against authorized native history.
use super::*;
use base64::Engine;
use std::{
    collections::HashMap,
    io::Cursor,
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tokio::sync::{OnceCell, Semaphore};
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Target {
    session_id: Uuid,
    turn_id: Uuid,
    item_id: String,
    url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    action: Action,
    target: Target,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Icon,
    Open,
    #[serde(rename = "open_message_link")]
    OpenMessageLink,
}
#[derive(Serialize)]
struct ResultData {
    status: &'static str,
    icon: Option<String>,
}

type IconCell = Arc<OnceCell<Option<String>>>;
pub struct WebSourceRuntime {
    cache: Mutex<HashMap<String, (std::time::Instant, IconCell)>>,
    fetches: Semaphore,
}
impl Default for WebSourceRuntime {
    fn default() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            fetches: Semaphore::new(4),
        }
    }
}
impl WebSourceRuntime {
    async fn icon(&self, url: Url) -> Option<String> {
        let key = url.origin().ascii_serialization();
        let cell = {
            let mut cache = self.cache.lock().await;
            cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(3600));
            if cache.len() >= 128 && !cache.contains_key(&key) {
                let oldest = cache
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(k, _)| k.clone());
                if let Some(oldest) = oldest {
                    cache.remove(&oldest);
                }
            }
            cache
                .entry(key)
                .or_insert_with(|| (std::time::Instant::now(), Arc::new(OnceCell::new())))
                .1
                .clone()
        };
        cell.get_or_init(|| async {
            let _permit = self.fetches.acquire().await.ok()?;
            tokio::time::timeout(Duration::from_secs(12), favicon(url))
                .await
                .ok()
                .flatten()
        })
        .await
        .clone()
    }
}

#[tauri::command]
pub async fn chat_web_source_v1(
    request: Value,
    chat_runtime: State<'_, ChatRuntime>,
    icons: State<'_, WebSourceRuntime>,
) -> Result<Value, ChatIpcError> {
    let request: CommandRequest<Payload> = decode_request(request)?;
    let invalid = || ChatIpcError::request_invalid(Some(request.request_id));
    let target = &request.payload.target;
    if target.item_id.is_empty() || target.item_id.len() > 512 {
        return Err(invalid());
    }
    let url = public_url(&target.url).ok_or_else(invalid)?;
    let (_, authorized, manager) = offline_applications(&chat_runtime, request.request_id).await?;
    let history = authorized
        .native_history(request.context_id, target.session_id, vec![target.turn_id])
        .await
        .map_err(|error| map_chat_error(error, Some(request.request_id)))?;
    let supplied = history.views.iter().any(|view| {
        view.items.iter().any(|entry| {
            entry.item.id == target.item_id
                && if matches!(request.payload.action, Action::OpenMessageLink) {
                    message_contains_link(
                        &entry.item.kind,
                        entry.item.text.as_deref(),
                        entry.item.summary.as_deref(),
                        entry.item.content.as_deref(),
                        &target.url,
                    )
                } else {
                    entry
                        .item
                        .web_search
                        .as_ref()
                        .and_then(|s| s.sources.as_ref())
                        .is_some_and(|sources| sources.iter().any(|s| s.url == target.url))
                }
        })
    });
    if !supplied {
        return Err(invalid());
    }
    authorize(
        &manager,
        request.context_id,
        ChatAction::ReadSessions,
        request.request_id,
    )?;
    let data = match request.payload.action {
        Action::Open | Action::OpenMessageLink => {
            // Same hardened system-browser library used by login and connectors.
            tokio::task::spawn_blocking(move || webbrowser::open(url.as_str()))
                .await
                .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))?
                .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))?;
            ResultData {
                status: "opened",
                icon: None,
            }
        }
        Action::Icon => {
            let icon = icons.icon(url).await;
            authorize(
                &manager,
                request.context_id,
                ChatAction::ReadSessions,
                request.request_id,
            )?;
            ResultData {
                status: if icon.is_some() {
                    "icon"
                } else {
                    "unavailable"
                },
                icon,
            }
        }
    };
    serde_json::to_value(CommandResponse::new(request.request_id, data))
        .map_err(|_| ChatIpcError::temporarily_unavailable(Some(request.request_id)))
}

/// Resolve an exact destination in the already-authorized model Item. The
/// renderer formats Markdown; Native independently checks provenance and URL
/// policy. This is a membership check, not a second rich-text renderer.
fn message_contains_link(
    kind: &str,
    text: Option<&str>,
    summary: Option<&[String]>,
    content: Option<&[String]>,
    destination: &str,
) -> bool {
    let needle = format!("]({destination})");
    match kind {
        "agentMessage" => text.is_some_and(|text| text.contains(&needle)),
        "reasoning" => summary
            .into_iter()
            .chain(content)
            .flatten()
            .any(|text| text.contains(&needle)),
        _ => false,
    }
}

fn public_url(raw: &str) -> Option<Url> {
    if raw.len() > 8192 || raw.chars().any(char::is_control) {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host = url.host_str()?.trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || !host.contains('.') && !host.contains(':')
    {
        return None;
    }
    if host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip)) {
        return None;
    }
    Some(url)
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b)
                    || a == 192 && (b == 0 || b == 168)
                    || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
                    || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|ip| public_ip(IpAddr::V4(ip)))
            .unwrap_or_else(|| {
                let s = ip.segments();
                s[0] & 0xe000 == 0x2000 && !(s[0] == 0x2001 && s[1] == 0x0db8)
            }),
    }
}

// Some local VPNs resolve public hostnames into the benchmark Fake-IP range.
// Accept that mapping only when the OS routes it through the user's TUN device;
// literal/private URL destinations and ordinary LAN routes remain excluded.
async fn routed_fake_ip(ip: IpAddr) -> bool {
    let IpAddr::V4(ip) = ip else {
        return false;
    };
    let [a, b, _, _] = ip.octets();
    if a != 198 || !(b == 18 || b == 19) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("/sbin/route")
                .env_clear()
                .args(["-n", "get", &ip.to_string()])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let text = String::from_utf8(output.stdout).ok()?;
            Some(
                text.lines()
                    .filter_map(|line| line.trim().strip_prefix("interface:"))
                    .any(|name| {
                        name.trim().strip_prefix("utun").is_some_and(|suffix| {
                            !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit())
                        })
                    }),
            )
        })
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

async fn fetch(mut url: Url, limit: usize, prefix: bool) -> Option<(Url, Vec<u8>)> {
    for _ in 0..4 {
        public_url(url.as_str())?;
        let host = url.host_str()?.trim_matches(['[', ']']);
        let addresses: Vec<SocketAddr> =
            tokio::net::lookup_host((host, url.port_or_known_default()?))
                .await
                .ok()?
                .collect();
        if addresses.is_empty() {
            return None;
        }
        for address in &addresses {
            if !(public_ip(address.ip())
                || host.parse::<IpAddr>().is_err() && routed_fake_ip(address.ip()).await)
            {
                return None;
            }
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(4))
            .resolve_to_addrs(host, &addresses)
            .build()
            .ok()?;
        let mut response = client.get(url.clone()).send().await.ok()?;
        if response.status().is_redirection() {
            let next = url
                .join(
                    response
                        .headers()
                        .get(reqwest::header::LOCATION)?
                        .to_str()
                        .ok()?,
                )
                .ok()?;
            if url.scheme() == "https" && next.scheme() != "https" {
                return None;
            }
            url = next;
            continue;
        }
        if !response.status().is_success()
            || (!prefix && response.content_length().is_some_and(|n| n > limit as u64))
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > limit {
                if prefix {
                    bytes.extend_from_slice(&chunk[..limit - bytes.len()]);
                    break;
                }
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        return Some((url, bytes));
    }
    None
}
fn icon_links(page: &str, base: &Url) -> Vec<Url> {
    let mut reader = quick_xml::Reader::from_str(page);
    reader.config_mut().check_end_names = false;
    let mut links = Vec::new();
    while let Ok(event) = reader.read_event() {
        match event {
            quick_xml::events::Event::Start(tag) | quick_xml::events::Event::Empty(tag)
                if tag.name().as_ref().eq_ignore_ascii_case(b"link") =>
            {
                let mut rel = String::new();
                let mut href = String::new();
                for attr in tag.attributes().with_checks(false).flatten() {
                    if let Ok(value) = attr.normalized_value(quick_xml::XmlVersion::Implicit1_0) {
                        if attr.key.as_ref().eq_ignore_ascii_case(b"rel") {
                            rel = value.to_ascii_lowercase();
                        } else if attr.key.as_ref().eq_ignore_ascii_case(b"href") {
                            href = value.into_owned();
                        }
                    }
                }
                if rel
                    .split_whitespace()
                    .any(|s| s == "icon" || s == "apple-touch-icon")
                {
                    if let Ok(url) = base.join(&href) {
                        if public_url(url.as_str()).is_some() {
                            links.push(url);
                        }
                    }
                }
                if links.len() >= 6 {
                    break;
                }
            }
            quick_xml::events::Event::Eof => break,
            _ => {}
        }
    }
    links
}
fn png_icon(bytes: &[u8]) -> Option<String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(16 * 1024 * 1024);
    reader.limits(limits);
    let icon = reader.decode().ok()?.thumbnail(32, 32);
    let mut output = Cursor::new(Vec::new());
    icon.write_to(&mut output, image::ImageFormat::Png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(output.into_inner())
    ))
}
async fn favicon(url: Url) -> Option<String> {
    // Root favicon works for ICO-only sites and avoids fetching large documents.
    let root_icon = url.join("/favicon.ico").ok()?;
    if let Some((_, bytes)) = fetch(root_icon.clone(), 256 * 1024, false).await {
        if let Some(icon) = png_icon(&bytes) {
            return Some(icon);
        }
    }
    let root = url.join("/").ok()?;
    let (base, html) = fetch(root, 256 * 1024, true).await?;
    for candidate in icon_links(&String::from_utf8_lossy(&html), &base)
        .into_iter()
        .filter(|u| u != &root_icon)
    {
        if let Some((_, bytes)) = fetch(candidate, 256 * 1024, false).await {
            if let Some(icon) = png_icon(&bytes) {
                return Some(icon);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn message_links_match_the_exact_model_destination_without_rewriting_history() {
        let url = "https://example.org/Guide_(city)?q=1#overview";
        let text = format!("参考 [路线来源]({url})。");
        assert!(message_contains_link(
            "agentMessage",
            Some(&text),
            None,
            None,
            url
        ));
        assert!(!message_contains_link(
            "agentMessage",
            Some(&text),
            None,
            None,
            "https://example.org/other"
        ));
        assert!(!message_contains_link(
            "userMessage",
            Some(&text),
            None,
            None,
            url
        ));
        assert!(!message_contains_link(
            "agentMessage",
            None,
            None,
            None,
            url
        ));
        assert!(message_contains_link(
            "reasoning",
            None,
            Some(std::slice::from_ref(&text)),
            None,
            url
        ));
        assert!(message_contains_link(
            "reasoning",
            None,
            None,
            Some(std::slice::from_ref(&text)),
            url
        ));
        assert_eq!(text, format!("参考 [路线来源]({url})。"));
    }
    #[test]
    fn additive_message_action_preserves_the_original_open_and_icon_actions() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../schemas/chat-web-source-v1.schema.json"
        ))
        .unwrap();
        for action in ["open", "icon", "open_message_link"] {
            assert!(
                schema["definitions"]["WebSourcePayload"]["properties"]["action"]["enum"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|value| value == action)
            );
            let request = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":Uuid::now_v7(),"payload":{"action":action,"target":{"sessionId":Uuid::now_v7(),"turnId":Uuid::now_v7(),"itemId":"answer","url":"https://example.org/guide"}}});
            let decoded: CommandRequest<Payload> = decode_request(request).unwrap();
            assert_eq!(
                matches!(decoded.payload.action, Action::OpenMessageLink),
                action == "open_message_link"
            );
        }
    }
    #[test]
    fn normal_site_urls_and_declared_icons() {
        let page = public_url("https://www.hangzhou.gov.cn/guide.html?q=city#overview").unwrap();
        assert_eq!(page.host_str(), Some("www.hangzhou.gov.cn"));
        let html = r#"<!doctype html><html><head><link rel="shortcut icon" href="/favicon.ico"><link href="https://static.example.org/city.png" rel="apple-touch-icon"></head></html>"#;
        let urls = icon_links(html, &page);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0].as_str(), "https://www.hangzhou.gov.cn/favicon.ico");
        assert_eq!(urls[1].as_str(), "https://static.example.org/city.png");
    }
    #[test]
    fn normal_png_is_resized_and_encoded_for_existing_csp() {
        let image = image::DynamicImage::new_rgba8(64, 64);
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let icon = png_icon(bytes.get_ref()).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(icon.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let icon = image::load_from_memory(&bytes).unwrap();
        assert_eq!((icon.width(), icon.height()), (32, 32));
    }
    #[test]
    fn private_schema_matches_normal_native_request_and_response() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../schemas/chat-web-source-v1.schema.json"
        ))
        .unwrap();
        let request = json!({"schemaVersion":1,"requestId":Uuid::now_v7(),"contextId":Uuid::now_v7(),"payload":{"action":"icon","target":{"sessionId":Uuid::now_v7(),"turnId":Uuid::now_v7(),"itemId":"search","url":"https://example.org/guide"}}});
        let decoded: CommandRequest<Payload> = decode_request(request).unwrap();
        let response = serde_json::to_value(CommandResponse::new(
            decoded.request_id,
            ResultData {
                status: "unavailable",
                icon: None,
            },
        ))
        .unwrap();
        assert_eq!(
            response["schemaVersion"],
            schema["definitions"]["WebSourceResponse"]["properties"]["schemaVersion"]["const"]
        );
        for required in schema["definitions"]["WebSourceResponse"]["required"]
            .as_array()
            .unwrap()
        {
            assert!(response.get(required.as_str().unwrap()).is_some());
        }
    }
    #[tokio::test]
    #[ignore = "Explicit normal network check against the requested reference website"]
    async fn reference_website_returns_its_own_icon() {
        let icons = WebSourceRuntime::default();
        let url = public_url("https://www.ctrip.com/").unwrap();
        let first = icons
            .icon(url.clone())
            .await
            .expect("reference website favicon available");
        assert!(first.starts_with("data:image/png;base64,"));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(first.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        std::fs::write(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../.local/development/web-source-reference-icon.png"),
            bytes,
        )
        .unwrap();
        assert_eq!(icons.icon(url).await.as_ref(), Some(&first));
    }
}
