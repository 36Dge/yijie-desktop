//! A clicked assistant reference is a locator. The stored message and the
//! session's native workspace (or OS Desktop) independently authorize the read.
use super::artifact_native::ArtifactNativeCode as Code;
use super::database::ChatRepository;
#[cfg(target_os = "macos")]
use super::document_preview_content::SOURCE_BUDGET;
use super::document_preview_native::StoredDocument;
use super::error::{map_sqlite_error, ChatError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use std::fs::OpenOptions;
#[cfg(target_os = "macos")]
use std::io::Read;
#[cfg(target_os = "macos")]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Component;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MessageFile {
    pub session_id: Uuid,
    pub turn_id: Uuid,
    pub item_id: String,
    pub reference: String,
}

impl MessageFile {
    pub fn path(&self) -> Result<PathBuf, Code> {
        let raw = &self.reference;
        if self.session_id.is_nil()
            || self.turn_id.is_nil()
            || self.item_id.is_empty()
            || self.item_id.len() > 512
            || raw.len() > 4096
            || raw.chars().any(char::is_control)
        {
            return Err(Code::InvalidRequest);
        }
        reference_path(raw, false, true).ok_or(Code::InvalidRequest)
    }

    fn in_view(&self, view: &super::native_conversation_generated::NativeConversationView) -> bool {
        view.session_id == self.session_id.to_string()
            && view.turn_id == self.turn_id.to_string()
            && view.items.iter().any(|entry| {
                entry.item.kind == "agentMessage"
                    && entry.item.id == self.item_id
                    && entry
                        .item
                        .text
                        .as_deref()
                        .is_some_and(|text| self.mentioned_in(text))
            })
    }

    fn mentioned_in(&self, text: &str) -> bool {
        self.path().is_ok_and(|path| message_mentions(text, &path))
    }
}

// Compare complete references from the stored message. Never search for the
// requested prefix in a substring cut before a Markdown delimiter.
fn decoded_uri(raw: &str) -> Option<String> {
    if raw.contains(['?', '#']) {
        return None;
    }
    let mut bytes = raw.bytes();
    let mut out = Vec::with_capacity(raw.len());
    while let Some(b) = bytes.next() {
        if b != b'%' {
            out.push(b);
            continue;
        }
        let hi = char::from(bytes.next()?).to_digit(16)?;
        let lo = char::from(bytes.next()?).to_digit(16)?;
        let decoded = (hi * 16 + lo) as u8;
        if matches!(decoded, b'/' | b'\\') {
            return None;
        }
        out.push(decoded);
    }
    String::from_utf8(out).ok()
}

fn has_extension(text: &str) -> bool {
    text.rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .is_some_and(|(_, ext)| {
            !ext.is_empty() && ext.chars().count() <= 16 && ext.chars().all(char::is_alphanumeric)
        })
}

fn reference_path(raw: &str, markdown: bool, relative: bool) -> Option<PathBuf> {
    if raw.is_empty() || raw.len() > 4096 {
        return None;
    }
    let file_url = raw
        .get(..7)
        .is_some_and(|p| p.eq_ignore_ascii_case("file://"));
    let mut value = raw;
    if file_url {
        value = &raw[7..];
        if value
            .get(..10)
            .is_some_and(|host| host.eq_ignore_ascii_case("localhost/"))
        {
            value = &value[9..];
        }
        if !value.starts_with('/') {
            return None;
        }
    }
    let absolute = value.starts_with('/');
    if !absolute && (!relative || value.starts_with('~') || value.split('/').next()?.contains(':'))
    {
        return None;
    }
    let decoded;
    if markdown || file_url {
        decoded = decoded_uri(value)?;
        value = &decoded;
    }
    if !absolute {
        value = value.strip_prefix("./").unwrap_or(value);
    }
    if value.contains('\\')
        || value.chars().any(char::is_control)
        || (if absolute {
            value.strip_prefix('/')?
        } else {
            value
        })
        .split('/')
        .any(|p| p.is_empty() || matches!(p, "." | ".."))
        || (!absolute && !has_extension(value))
    {
        return None;
    }
    Some(PathBuf::from(value))
}

fn path_label(text: &str) -> Option<&str> {
    let (prefix, value) = text.split_once(['：', ':'])?;
    let prefix = prefix.trim();
    (matches!(
        prefix,
        "路径" | "文件路径" | "保存路径" | "输出路径" | "完整路径"
    ) || prefix.eq_ignore_ascii_case("path"))
    .then(|| value.trim())
}

fn literal_file(text: &str, labelled: bool) -> Option<PathBuf> {
    if !has_extension(text)
        || text.contains('`')
        || (!labelled && text.contains(char::is_whitespace))
    {
        return None;
    }
    reference_path(text, false, false)
}

fn structural_content(mut line: &str) -> &str {
    loop {
        line = line.trim_start();
        if let Some(rest) = line.strip_prefix('>') {
            line = rest;
            continue;
        }
        let marker = line.split_once(char::is_whitespace);
        if let Some((prefix, rest)) = marker {
            let ordered = prefix.strip_suffix(['.', ')']).is_some_and(|n| {
                !n.is_empty() && n.len() <= 9 && n.bytes().all(|b| b.is_ascii_digit())
            });
            if ordered
                || matches!(prefix, "-" | "*" | "+")
                || (prefix.len() <= 6
                    && prefix.starts_with('#')
                    && prefix.bytes().all(|b| b == b'#'))
            {
                line = rest;
                continue;
            }
        }
        return line.trim_end();
    }
}

fn markdown_destination(text: &str) -> &str {
    let mut value = text.trim();
    if let Some(inner) = value.strip_prefix('<') {
        if let Some((path, tail)) = inner.split_once('>') {
            if tail.is_empty() || tail.starts_with(char::is_whitespace) {
                return path;
            }
        }
    }
    for (open, close) in [('"', '"'), ('\'', '\''), ('(', ')')] {
        if let Some(before_end) = value.strip_suffix(close) {
            if let Some((path, _)) = before_end.rsplit_once(open) {
                if path.ends_with(char::is_whitespace) {
                    value = path.trim_end();
                    break;
                }
            }
        }
    }
    value
}

fn markdown_link(text: &str) -> Option<(&str, usize)> {
    let mut brackets = 1;
    let mut escaped = false;
    let (end, _) = text.char_indices().find(|(_, ch)| {
        if escaped {
            escaped = false;
            return false;
        }
        match ch {
            '\\' => escaped = true,
            '[' => brackets += 1,
            ']' => brackets -= 1,
            _ => {}
        }
        brackets == 0
    })?;
    let dest = text.get(end + 1..)?.strip_prefix('(')?;
    let mut depth = 1;
    let mut quote = None;
    let mut space = false;
    for (i, ch) in dest.char_indices() {
        if let Some(close) = quote {
            if ch == close {
                quote = None;
            }
        } else if (i == 0 && ch == '<') || (space && matches!(ch, '"' | '\'')) {
            quote = Some(if ch == '<' { '>' } else { ch });
        } else if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some((markdown_destination(&dest[..i]), end + 2 + i + 1));
            }
        }
        space = ch.is_whitespace();
    }
    None
}

fn inline_mentions(line: &str, path: &Path, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    let mut i = 0;
    while i < line.len() {
        let rest = &line[i..];
        let ch = rest.chars().next().expect("character boundary");
        if ch == '\\' {
            i += 1 + rest[1..].chars().next().map_or(0, char::len_utf8);
            continue;
        }
        if ch == '`' {
            let len = rest.bytes().take_while(|b| *b == b'`').count();
            let mut scan = len;
            let closing = loop {
                let Some(pos) = rest[scan..].find(&rest[..len]) else {
                    break None;
                };
                let start = scan + pos;
                let width = rest[start..].bytes().take_while(|b| *b == b'`').count();
                if width == len {
                    break Some(start - len);
                }
                scan = start + width;
            };
            let Some(end) = closing else { break };
            if len == 1 && literal_file(&rest[len..len + end], false).as_deref() == Some(path) {
                return true;
            }
            i += len + end + len;
            continue;
        }
        if let Some(label) = rest.strip_prefix('[') {
            if let Some((raw, len)) = markdown_link(label) {
                if reference_path(raw, true, true).as_deref() == Some(path) {
                    return true;
                }
                i += 1 + len;
                continue;
            }
        }
        if matches!(ch, '*' | '_' | '~') {
            let len = rest.bytes().take_while(|b| *b == ch as u8).count();
            if len <= 2 && (ch != '~' || len == 2) {
                if let Some(end) = rest[len..].find(&rest[..len]) {
                    if inline_mentions(&rest[len..len + end], path, depth + 1) {
                        return true;
                    }
                    i += len + end + len;
                    continue;
                }
            }
        }
        let start = i == 0
            || line[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_whitespace() || "(（【《“‘\"'：，、|".contains(c));
        if start
            && (ch == '/'
                || rest
                    .get(..7)
                    .is_some_and(|p| p.eq_ignore_ascii_case("file://")))
        {
            let end = rest
                .find(|c: char| {
                    c.is_whitespace() || "<>`\"'“”‘’《》【】（），。；、！？：|".contains(c)
                })
                .unwrap_or(rest.len());
            let raw = rest[..end].trim_end_matches(['.', ',', ';', ':', '!', '?']);
            let raw = if line[..i].ends_with('(') {
                raw.strip_suffix(')').unwrap_or(raw)
            } else {
                raw
            };
            if literal_file(raw, false).as_deref() == Some(path) {
                return true;
            }
            i += end;
            continue;
        }
        i += ch.len_utf8();
    }
    false
}

fn message_mentions(text: &str, path: &Path) -> bool {
    let mut fence: Option<(char, usize)> = None;
    for line in text.lines().map(structural_content) {
        if let Some(ch @ ('`' | '~')) = line.chars().next() {
            let len = line.bytes().take_while(|b| *b == ch as u8).count();
            if len >= 3 {
                if let Some((marker, width)) = fence {
                    if ch == marker && len >= width && line[len..].trim().is_empty() {
                        fence = None;
                    }
                } else if ch != '`' || !line[len..].contains('`') {
                    fence = Some((ch, len));
                }
                continue;
            }
        }
        if fence.is_some() {
            continue;
        }
        let labelled = path_label(line);
        let body = labelled.unwrap_or(line);
        let raw = body
            .strip_prefix('`')
            .and_then(|s| s.strip_suffix('`'))
            .unwrap_or(body);
        if let Some(candidate) = literal_file(raw, labelled.is_some()) {
            if candidate == path {
                return true;
            }
            continue;
        }
        if inline_mentions(line, path, 0) {
            return true;
        }
    }
    false
}

pub(super) enum MessageFileProject {
    Saved(String),
    Rebuilt(String),
}

impl ChatRepository {
    /// A missing local projection can only be recovered through its stored Runtime
    /// binding, as in the normal history reader. A user message never grants a file.
    pub(super) fn message_file_project(
        &self,
        target: &MessageFile,
    ) -> Result<Option<MessageFileProject>, ChatError> {
        let row: Option<(String, bool)> = self.connection.query_row(
            "SELECT p.id, EXISTS(SELECT 1 FROM chat_native_bindings b WHERE b.turn_id=t.id AND b.session_id=s.id)
             FROM chat_projects p JOIN chat_sessions s ON s.project_id=p.id
             JOIN chat_turns t ON t.session_id=s.id WHERE s.id=?1 AND t.id=?2
             AND s.owner_user_id=?3 AND s.tenant_id=?4 AND p.owner_user_id=s.owner_user_id
             AND p.tenant_id=s.tenant_id AND p.removed_at IS NULL
             AND NOT EXISTS(SELECT 1 FROM chat_deletion_jobs d WHERE d.session_id=s.id)",
            params![target.session_id.to_string(), target.turn_id.to_string(), self.scope.owner_user_id, self.scope.tenant_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(map_sqlite_error)?;
        let Some((project, bound)) = row else {
            return Ok(None);
        };
        let records = self.native_view_records(target.session_id, &[target.turn_id])?;
        if !records.record_diagnostics.is_empty() {
            return Ok(None);
        }
        if !records.views.is_empty() {
            return Ok(records
                .views
                .iter()
                .any(|view| target.in_view(view))
                .then_some(MessageFileProject::Saved(project)));
        }
        if bound {
            return Ok(Some(MessageFileProject::Rebuilt(project)));
        }
        // The legacy reader identifies a stored assistant message by role ordinal.
        let prefix = format!("{}:assistant:", target.turn_id);
        let Some(index) = target
            .item_id
            .strip_prefix(&prefix)
            .and_then(|v| v.parse::<u32>().ok())
        else {
            return Ok(None);
        };
        let text: Option<String> = self.connection.query_row(
            "SELECT content FROM chat_messages WHERE session_id=?1 AND turn_id=?2 AND role='assistant'
             ORDER BY ordinal,id LIMIT 1 OFFSET ?3",
            params![target.session_id.to_string(), target.turn_id.to_string(), index], |row| row.get(0),
        ).optional().map_err(map_sqlite_error)?;
        Ok(text
            .is_some_and(|text| target.mentioned_in(&text))
            .then_some(MessageFileProject::Saved(project)))
    }
}

pub(super) async fn locate(
    runtime: &super::ChatRuntime,
    context: Uuid,
    target: &MessageFile,
    desktop: Option<PathBuf>,
) -> Result<(PathBuf, PathBuf), Code> {
    super::document_preview_native::authorize(runtime, context)?;
    let path = target.path()?;
    let worker = runtime.database().await.map_err(|_| Code::Unavailable)?;
    let locator = target.clone();
    let binding = worker
        .call(move |repo| repo.message_file_project(&locator))
        .await
        .map_err(|_| Code::Unavailable)?
        .ok_or(Code::Forbidden)?;
    let project = match binding {
        MessageFileProject::Saved(project) => project,
        MessageFileProject::Rebuilt(project) => {
            let app = runtime
                .local_offline_conversation_application()
                .await
                .map_err(|_| Code::Unavailable)?
                .with_history_host(runtime.host_bridge.lock().await.clone());
            let authority = runtime
                .authorization_manager()
                .map_err(|_| Code::Unauthenticated)?;
            let history = super::AuthorizedConversationApplication::new(app, authority)
                .native_history(context, target.session_id, vec![target.turn_id])
                .await
                .map_err(|_| Code::Unavailable)?;
            if !history.views.iter().any(|view| target.in_view(view)) {
                return Err(Code::NotFound);
            }
            project
        }
    };
    let root = match desktop.filter(|root| path.starts_with(root)) {
        Some(root) => root,
        None => worker
            .call(move |repo| repo.resolve_schedule_project(&project))
            .await
            .map_err(|_| Code::NotFound)?,
    };
    super::document_preview_native::authorize(runtime, context)?;
    let resolved = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    check_location(&resolved, &root)?;
    Ok((resolved, root))
}

pub(super) async fn open(
    runtime: &super::ChatRuntime,
    context: Uuid,
    target: &MessageFile,
    desktop: Option<PathBuf>,
    now: i64,
) -> Result<StoredDocument, Code> {
    let (path, root) = locate(runtime, context, target, desktop).await?;
    tokio::task::spawn_blocking(move || read(&path, &root, now))
        .await
        .map_err(|_| Code::Unavailable)?
}

fn check_location(path: &Path, root: &Path) -> Result<(), Code> {
    let relative = path.strip_prefix(root).map_err(|_| Code::Forbidden)?;
    if relative.as_os_str().is_empty()
        || relative.components().any(
            |part| !matches!(part, Component::Normal(s) if !s.to_string_lossy().starts_with('.')),
        )
    {
        return Err(Code::Forbidden);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn read(path: &Path, root: &Path, now: i64) -> Result<StoredDocument, Code> {
    check_location(path, root)?;
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "htm" | "html" => "text/html",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        _ => return Err(Code::Unsupported),
    };
    // macOS rejects symlinks in ANY component in the open itself, including the
    // selected root. The size/type checks and bounded read use that same handle.
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW_ANY | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => Code::NotFound,
            std::io::ErrorKind::PermissionDenied => Code::Forbidden,
            _ => Code::Unavailable,
        })?;
    let meta = file.metadata().map_err(|_| Code::Unavailable)?;
    if !meta.is_file() || meta.nlink() != 1 {
        return Err(Code::Forbidden);
    }
    if meta.len() > SOURCE_BUDGET as u64 {
        return Err(Code::LimitExceeded);
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(SOURCE_BUDGET as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Code::Unavailable)?;
    if bytes.len() > SOURCE_BUDGET {
        return Err(Code::LimitExceeded);
    }
    match mime {
        "video/mp4" => {
            super::artifact_video_native::validate_mp4(&bytes).map_err(|_| Code::IntegrityFailed)?
        }
        image if image.starts_with("image/") => {
            super::artifact_media::validate_artifact_image(image, &bytes)
                .map_err(|_| Code::IntegrityFailed)?
        }
        _ => super::artifact_file_native::validate_file_for_save(mime, &bytes)?,
    }
    Ok(StoredDocument {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(Code::InvalidRequest)?
            .to_owned(),
        mime: mime.into(),
        revision: format!("{:x}", Sha256::digest(&bytes)),
        bytes,
        expires: now + 1800,
    })
}

#[cfg(not(target_os = "macos"))]
pub(super) fn read(_: &Path, _: &Path, _: i64) -> Result<StoredDocument, Code> {
    Err(Code::Unsupported)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::chat::document_preview_content;
    #[test]
    fn matches_complete_references_in_shared_normal_markdown_examples() {
        #[derive(Deserialize)]
        struct Example {
            label: String,
            source: String,
            targets: Vec<String>,
            #[serde(default)]
            distinct: Vec<String>,
        }
        let cases: Vec<Example> = serde_json::from_str(include_str!(
            "../../schemas/fixtures/chat-message-file-references.json"
        ))
        .unwrap();
        for case in cases {
            for target in case.targets {
                assert!(
                    message_mentions(&case.source, Path::new(&target)),
                    "{}",
                    case.label
                );
            }
            // Pure string comparison of two ordinary filenames. No file access.
            for other in case.distinct {
                assert!(
                    !message_mentions(&case.source, Path::new(&other)),
                    "{}",
                    case.label
                );
            }
        }
    }
    #[test]
    fn local_image_video_and_html_use_the_read_only_viewers() {
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("yijie-output-{}", Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        let png = crate::chat::attachment::test_image_bytes("png");
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4"/></svg>"#.to_vec();
        let html = b"<html><body>Travel notes</body></html>".to_vec();
        for (filename, bytes, kind) in [
            ("cover.png", png, "image"),
            (
                "clip.mp4",
                crate::chat::artifact_video_native::test_mp4_bytes(),
                "video",
            ),
            ("map.svg", svg, "image"),
            ("notes.html", html, "html"),
        ] {
            let path = root.join(filename);
            std::fs::write(&path, &bytes).unwrap();
            let file = read(&path, &root, 100).unwrap();
            let view =
                document_preview_content::render(&file.mime, &file.bytes, 0, 0, true, 1.0).unwrap();
            assert_eq!(view.kind, kind);
            assert!(!view.html.contains("file://"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
