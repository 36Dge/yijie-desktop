//! Read-only presentation adapters. Storage, admission and text parsing remain
//! owned by the existing attachment/artifact modules; nothing is executed here.
use super::artifact_file_native::{project_file_preview, FilePreviewProjection};
use super::artifact_native::ArtifactNativeCode as Code;
use super::attachment;
use quick_xml::{events::Event, Reader};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;

#[cfg(test)]
#[path = "document_preview_content_tests.rs"]
mod tests;

pub(super) const TEXT_BUDGET: usize = 262_144;
pub(super) const SOURCE_BUDGET: usize = 10 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub(super) struct Section {
    pub id: usize,
    pub label: String,
}

pub(super) struct Presentation {
    pub kind: &'static str,
    pub html: String,
    pub assets: BTreeMap<String, Vec<u8>>,
    pub sections: Vec<Section>,
    pub section: usize,
    pub offset: usize,
    pub next: Option<usize>,
    pub previous: Option<usize>,
    pub partial: bool,
}

pub(super) fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn page(body: &str, dark: bool, zoom: f64) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{{color-scheme:{};font:14px/1.6 system-ui}}body{{margin:20px;color:CanvasText;background:Canvas;overflow-wrap:anywhere;zoom:{zoom}}}
pre{{white-space:pre-wrap;tab-size:4}}table{{border-collapse:collapse;min-width:100%;margin:12px 0}}td,th{{border:1px solid GrayText;padding:6px 10px;vertical-align:top}}th{{position:sticky;top:0;background:Canvas}}
table.sheet{{width:max-content;min-width:100%}}.sheet td,.sheet th{{min-width:96px;max-width:320px;overflow-wrap:break-word}}.sheet th:first-child{{min-width:40px}}
img{{display:block;max-width:100%;height:auto;margin:12px auto}}.page{{margin:0 auto}}.notice{{color:GrayText}}.formula{{white-space:pre-wrap}}h1,h2,h3{{line-height:1.35}}p{{margin:10px 0}}.list{{padding-inline-start:20px}}
</style></head><body>{body}</body></html>"#,
        if dark { "dark" } else { "light" }
    )
}

#[derive(Default, Clone)]
struct Node {
    name: String,
    attrs: BTreeMap<String, String>,
    text: String,
    children: Vec<Node>,
}
impl Node {
    fn attr(&self, name: &str) -> &str {
        self.attrs.get(name).map(String::as_str).unwrap_or("")
    }
    fn relationship_id(&self) -> &str {
        self.attrs
            .iter()
            .find(|(key, _)| key.ends_with(":id"))
            .map(|(_, value)| value.as_str())
            .unwrap_or("")
    }
    fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|n| n.name == name)
    }
    fn all<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        if self.name == name {
            out.push(self);
        }
        if self.name != "rPh" {
            for n in &self.children {
                n.all(name, out);
            }
        }
    }
    fn descendants(&self, name: &str) -> Vec<&Node> {
        let mut out = vec![];
        self.all(name, &mut out);
        out
    }
    fn texts(&self) -> String {
        self.descendants("t")
            .iter()
            .map(|n| n.text.as_str())
            .collect()
    }
}
fn local(value: &[u8]) -> String {
    String::from_utf8_lossy(value)
        .rsplit(':')
        .next()
        .unwrap_or("")
        .to_owned()
}
fn xml(bytes: &[u8]) -> Result<Node, Code> {
    let mut reader = Reader::from_reader(bytes);
    let mut stack = vec![Node::default()];
    let mut count = 0;
    loop {
        let event = reader.read_event().map_err(|_| Code::IntegrityFailed)?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                count += 1;
                if count > 200_000 || stack.len() > 128 {
                    return Err(Code::LimitExceeded);
                }
                let mut node = Node {
                    name: local(e.name().as_ref()),
                    ..Node::default()
                };
                for a in e.attributes() {
                    let a = a.map_err(|_| Code::IntegrityFailed)?;
                    let value = a
                        .decoded_and_normalized_value(
                            quick_xml::XmlVersion::Implicit1_0,
                            reader.decoder(),
                        )
                        .map_err(|_| Code::IntegrityFailed)?
                        .into_owned();
                    node.attrs.insert(local(a.key.as_ref()), value.clone());
                    node.attrs
                        .insert(String::from_utf8_lossy(a.key.as_ref()).into_owned(), value);
                }
                if empty {
                    stack
                        .last_mut()
                        .ok_or(Code::IntegrityFailed)?
                        .children
                        .push(node);
                } else {
                    stack.push(node);
                }
            }
            Event::Text(e) => stack
                .last_mut()
                .ok_or(Code::IntegrityFailed)?
                .text
                .push_str(&e.decode().map_err(|_| Code::IntegrityFailed)?),
            Event::CData(e) => stack
                .last_mut()
                .ok_or(Code::IntegrityFailed)?
                .text
                .push_str(&e.decode().map_err(|_| Code::IntegrityFailed)?),
            Event::GeneralRef(e) => {
                let reference = format!("&{};", e.decode().map_err(|_| Code::IntegrityFailed)?);
                let decoded =
                    quick_xml::escape::unescape(&reference).map_err(|_| Code::IntegrityFailed)?;
                stack
                    .last_mut()
                    .ok_or(Code::IntegrityFailed)?
                    .text
                    .push_str(&decoded);
            }
            Event::End(_) => {
                if stack.len() <= 1 {
                    return Err(Code::IntegrityFailed);
                }
                let node = stack.pop().ok_or(Code::IntegrityFailed)?;
                stack
                    .last_mut()
                    .ok_or(Code::IntegrityFailed)?
                    .children
                    .push(node);
            }
            Event::DocType(_) => return Err(Code::Unsupported),
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err(Code::IntegrityFailed);
    }
    Ok(stack.remove(0))
}

type Package = BTreeMap<String, Vec<u8>>;
fn part(package: &Package, path: &str) -> Result<Node, Code> {
    xml(package.get(path).ok_or(Code::IntegrityFailed)?)
}
fn related_path(base: &str, target: &str) -> Option<String> {
    if target.contains(['\\', ':', '\0', '?', '#']) {
        return None;
    }
    let mut parts: Vec<&str> = if target.starts_with('/') {
        vec![]
    } else {
        base.rsplit_once('/')?.0.split('/').collect()
    };
    for p in target.trim_start_matches('/').split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(p),
        }
    }
    Some(parts.join("/"))
}
fn relationships(package: &Package, path: &str) -> Result<BTreeMap<String, String>, Code> {
    let (dir, file) = path.rsplit_once('/').ok_or(Code::IntegrityFailed)?;
    let rel_path = format!("{dir}/_rels/{file}.rels");
    let Some(bytes) = package.get(&rel_path) else {
        return Ok(BTreeMap::new());
    };
    let tree = xml(bytes)?;
    Ok(tree
        .descendants("Relationship")
        .into_iter()
        .filter_map(|n| {
            if n.attr("TargetMode") == "External" {
                return None;
            }
            Some((
                n.attr("Id").to_owned(),
                related_path(path, n.attr("Target"))?,
            ))
        })
        .collect())
}

struct Renderer<'a> {
    package: &'a Package,
    images: BTreeMap<String, String>,
    partial: bool,
    list_counters: BTreeMap<String, usize>,
    numbering: BTreeMap<String, (bool, usize)>,
}
impl<'a> Renderer<'a> {
    fn new(package: &'a Package) -> Self {
        let mut numbering = BTreeMap::new();
        if let Some(tree) = package.get("word/numbering.xml").and_then(|b| xml(b).ok()) {
            for num in tree.descendants("num") {
                let abstract_id = num
                    .child("abstractNumId")
                    .map(|n| n.attr("val"))
                    .unwrap_or("");
                if let Some(definition) = tree
                    .descendants("abstractNum")
                    .into_iter()
                    .find(|n| n.attr("abstractNumId") == abstract_id)
                {
                    for level in definition.children.iter().filter(|n| n.name == "lvl") {
                        let bullet = level
                            .child("numFmt")
                            .is_some_and(|n| n.attr("val") == "bullet");
                        let start = level
                            .child("start")
                            .and_then(|n| n.attr("val").parse().ok())
                            .unwrap_or(1);
                        numbering.insert(
                            format!("{}:{}", num.attr("numId"), level.attr("ilvl")),
                            (bullet, start),
                        );
                    }
                }
            }
        }
        Self {
            package,
            images: BTreeMap::new(),
            partial: false,
            list_counters: BTreeMap::new(),
            numbering,
        }
    }
    fn picture(&mut self, n: &Node, rels: &BTreeMap<String, String>) -> String {
        let id = n
            .descendants("blip")
            .first()
            .map(|b| b.attr("embed"))
            .or_else(|| {
                n.descendants("imagedata")
                    .first()
                    .map(|b| b.relationship_id())
            });
        if let Some(path) = id
            .and_then(|id| rels.get(id))
            .filter(|p| self.package.contains_key(*p))
        {
            let key = format!("image/{}.png", self.images.len());
            self.images.insert(key.clone(), path.clone());
            format!(
                "<img loading=\"lazy\" src=\"yijie-document://preview/{key}\" alt=\"文档图片\">"
            )
        } else {
            self.partial = true;
            "<p class=\"notice\">[此对象暂不能呈现]</p>".into()
        }
    }
    fn inline(&mut self, n: &Node, rels: &BTreeMap<String, String>) -> String {
        match n.name.as_str() {
            "t" => escape(&n.text),
            "tab" => "&emsp;".into(),
            "br" | "cr" => "<br>".into(),
            "drawing" | "pict" | "pic" => self.picture(n, rels),
            "object" | "graphicFrame" => {
                self.partial = true;
                "<span class=\"notice\">[嵌入对象暂不能呈现]</span>".into()
            }
            _ => n.children.iter().map(|c| self.inline(c, rels)).collect(),
        }
    }
    fn paragraph(&mut self, n: &Node, rels: &BTreeMap<String, String>) -> String {
        let style = n
            .descendants("pStyle")
            .first()
            .map(|n| n.attr("val").to_ascii_lowercase())
            .unwrap_or_default();
        let tag = if style.starts_with("heading") || style == "title" {
            "h2"
        } else {
            "p"
        };
        let prefix = if let Some(num) = n.descendants("numPr").first() {
            let id = num
                .descendants("numId")
                .first()
                .map(|n| n.attr("val"))
                .unwrap_or("0");
            let level = num
                .descendants("ilvl")
                .first()
                .map(|n| n.attr("val"))
                .unwrap_or("0");
            let key = format!("{id}:{level}");
            let (bullet, start) = self.numbering.get(&key).copied().unwrap_or((false, 1));
            let count = self
                .list_counters
                .entry(key)
                .or_insert(start.saturating_sub(1));
            *count += 1;
            if bullet {
                "•&nbsp; ".into()
            } else {
                format!("{}.&nbsp; ", count)
            }
        } else {
            String::new()
        };
        format!("<{tag}>{prefix}{}</{tag}>", self.inline(n, rels))
    }
    fn paragraph_blocks(&mut self, n: &Node, rels: &BTreeMap<String, String>) -> Vec<String> {
        let html = self.paragraph(n, rels);
        if html.len() <= TEXT_BUDGET {
            return vec![html];
        }
        // Very long paragraphs remain readable in bounded text batches. The
        // partial flag describes the reduced formatting, never hides omission.
        self.partial = true;
        n.texts()
            .chars()
            .collect::<Vec<_>>()
            .chunks(16_384)
            .map(|chars| format!("<p>{}</p>", escape(&chars.iter().collect::<String>())))
            .collect()
    }
    fn table(&mut self, n: &Node, rels: &BTreeMap<String, String>) -> Vec<String> {
        let mut blocks = vec![];
        let mut html = String::from("<table>");
        let mut rows = 0;
        for row in n.children.iter().filter(|n| n.name == "tr") {
            let mut value = String::from("<tr>");
            for cell in row.children.iter().filter(|n| n.name == "tc") {
                let span = cell
                    .descendants("gridSpan")
                    .first()
                    .and_then(|n| n.attr("val").parse::<usize>().ok())
                    .unwrap_or(1)
                    .clamp(1, 50);
                value.push_str(&format!(
                    "<td colspan=\"{span}\">{}</td>",
                    self.inline(cell, rels)
                ));
            }
            value.push_str("</tr>");
            if value.len() > TEXT_BUDGET / 2 {
                self.partial = true;
                value = "<tr><td>此行内容超出单次预览限制</td></tr>".into();
            }
            if rows == 100 || html.len() + value.len() > TEXT_BUDGET / 2 {
                html.push_str("</table>");
                blocks.push(html);
                html = "<table>".into();
                rows = 0;
            }
            html.push_str(&value);
            rows += 1;
        }
        html.push_str("</table>");
        blocks.push(html);
        blocks
    }
    fn assets(&mut self, html: &mut String) -> BTreeMap<String, Vec<u8>> {
        let mut assets = BTreeMap::new();
        let mut pixels = 0_u64;
        for (key, path) in &self.images {
            if !html.contains(key) {
                continue;
            }
            let bytes = &self.package[path];
            let dimensions = image::ImageReader::new(Cursor::new(bytes))
                .with_guessed_format()
                .ok()
                .and_then(|r| r.into_dimensions().ok());
            // Account for the source decode and the bounded thumbnail at once.
            // Previously converted pictures also count toward the 48 MiB cap.
            let remaining = 48 * 1024 * 1024_u64 - pixels * 4;
            let decode_budget = dimensions.and_then(|(w, h)| {
                let source = u64::from(w) * u64::from(h) * 4;
                let thumbnail = source.min(4_000_000 * 4);
                (source + thumbnail <= remaining).then_some(source)
            });
            let decoded = image::ImageReader::new(Cursor::new(bytes))
                .with_guessed_format()
                .ok()
                .and_then(|r| {
                    let budget = decode_budget?;
                    let mut limits = image::Limits::default();
                    limits.max_image_width = Some(16_384);
                    limits.max_image_height = Some(16_384);
                    limits.max_alloc = Some(budget);
                    let mut r = r;
                    r.limits(limits);
                    r.decode().ok()
                });
            let converted = decoded.and_then(|image| {
                let image = image.thumbnail(2000, 2000);
                let count = u64::from(image.width()) * u64::from(image.height());
                if pixels + count > 12_000_000 {
                    return None;
                }
                let mut out = Cursor::new(Vec::new());
                image.write_to(&mut out, image::ImageFormat::Png).ok()?;
                pixels += count;
                Some(out.into_inner())
            });
            if let Some(bytes) = converted {
                assets.insert(key.clone(), bytes);
            } else {
                self.partial = true;
                *html = html.replace(&format!("<img loading=\"lazy\" src=\"yijie-document://preview/{key}\" alt=\"文档图片\">"), "<p class=\"notice\">[图片暂不能呈现或超出预览资源限制]</p>");
            }
        }
        assets
    }
}

fn choose_blocks(
    blocks: &[String],
    offset: usize,
) -> (String, usize, Option<usize>, Option<usize>) {
    let offset = offset.min(blocks.len().saturating_sub(1));
    let mut body = String::new();
    let mut end = offset;
    for block in blocks.iter().skip(offset) {
        if !body.is_empty()
            && (body.len() + block.len() > TEXT_BUDGET
                || (body.matches("<img ").count() + block.matches("<img ").count() > 3))
        {
            break;
        }
        body.push_str(block);
        end += 1;
    }
    (
        body,
        offset,
        (end < blocks.len()).then_some(end),
        (offset > 0).then_some(offset.saturating_sub(1)),
    )
}

pub(super) fn render(
    mime: &str,
    bytes: &[u8],
    section: usize,
    offset: usize,
    dark: bool,
    zoom: f64,
) -> Result<Presentation, Code> {
    if bytes.is_empty() || bytes.len() > SOURCE_BUDGET {
        return Err(Code::LimitExceeded);
    }
    let mut result = Presentation {
        kind: "text",
        html: String::new(),
        assets: BTreeMap::new(),
        sections: vec![],
        section: 0,
        offset: 0,
        next: None,
        previous: None,
        partial: false,
    };
    if mime == "text/html" {
        result.kind = "html";
        result.html = std::str::from_utf8(bytes)
            .map_err(|_| Code::IntegrityFailed)?
            .to_owned();
        return Ok(result);
    }
    if matches!(
        mime,
        "text/plain" | "text/markdown" | "text/csv" | "application/json"
    ) {
        if bytes.len() > 1_048_576 {
            return Err(Code::LimitExceeded);
        }
        let mime = match mime {
            "text/plain" => "text/plain",
            "text/markdown" => "text/markdown",
            "text/csv" => "text/csv",
            _ => "application/json",
        };
        let body = match project_file_preview(mime, bytes)? {
            FilePreviewProjection::Text {
                text, truncated, ..
            } => {
                result.partial = truncated;
                format!("<pre>{}</pre>", escape(&text))
            }
            FilePreviewProjection::Csv { rows, truncated } => {
                result.partial = truncated;
                format!(
                    "<table>{}</table>",
                    rows.iter()
                        .map(|r| format!(
                            "<tr>{}</tr>",
                            r.iter()
                                .map(|c| format!("<td>{}</td>", escape(c)))
                                .collect::<String>()
                        ))
                        .collect::<String>()
                )
            }
        };
        result.html = page(&body, dark, zoom);
        return Ok(result);
    }
    if mime == "application/pdf" {
        let (count, selected, png) = super::document_preview_pdf::render(bytes, section)?;
        result.kind = "pdf";
        result.section = selected;
        result.sections = (0..count)
            .map(|id| Section {
                id,
                label: format!("第 {} 页", id + 1),
            })
            .collect();
        result.assets.insert("image/page.png".into(), png);
        result.html = page(
            "<img class=\"page\" src=\"yijie-document://preview/image/page.png\" alt=\"PDF页面\">",
            dark,
            zoom,
        );
        return Ok(result);
    }
    let extension = match mime {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        _ => return Err(Code::Unsupported),
    };
    let package = attachment::document_preview_entries(extension, bytes)
        .map_err(|_| Code::IntegrityFailed)?;
    let mut renderer = Renderer::new(&package);
    result.kind = extension;
    let mut body = if extension == "docx" {
        let tree = part(&package, "word/document.xml")?;
        let body = tree
            .descendants("body")
            .first()
            .copied()
            .ok_or(Code::IntegrityFailed)?;
        let rels = relationships(&package, "word/document.xml")?;
        let mut blocks = vec![];
        for node in &body.children {
            if node.name == "p" {
                blocks.extend(renderer.paragraph_blocks(node, &rels));
            } else if node.name == "tbl" {
                blocks.extend(renderer.table(node, &rels));
            } else if node.name != "sectPr" {
                renderer.partial = true;
            }
        }
        let (body, index, next, prev) = choose_blocks(&blocks, offset);
        result.offset = index;
        result.next = next;
        result.previous = prev;
        body
    } else if extension == "pptx" {
        let root = part(&package, "ppt/presentation.xml")?;
        let rels = relationships(&package, "ppt/presentation.xml")?;
        let slides = root
            .descendants("sldId")
            .into_iter()
            .map(|n| rels.get(n.relationship_id()).ok_or(Code::IntegrityFailed))
            .collect::<Result<Vec<_>, _>>()?;
        if slides.is_empty() || slides.len() > 512 {
            return Err(Code::Unsupported);
        }
        result.section = section.min(slides.len() - 1);
        result.sections = slides
            .iter()
            .enumerate()
            .map(|(id, _)| Section {
                id,
                label: format!("第 {} 页", id + 1),
            })
            .collect();
        let path = slides[result.section];
        let tree = part(&package, path)?;
        let rels = relationships(&package, path)?;
        let shapes = tree
            .descendants("spTree")
            .first()
            .copied()
            .ok_or(Code::IntegrityFailed)?;
        let mut blocks = vec![];
        for node in &shapes.children {
            match node.name.as_str() {
                "sp" => {
                    for p in node.descendants("p") {
                        blocks.extend(renderer.paragraph_blocks(p, &rels));
                    }
                }
                "pic" => blocks.push(renderer.picture(node, &rels)),
                "graphicFrame" => {
                    let tables = node.descendants("tbl");
                    if tables.is_empty() {
                        renderer.partial = true;
                        blocks.push("<p>[此图表或对象暂不能呈现]</p>".into());
                    }
                    for table in tables {
                        blocks.extend(renderer.table(table, &rels));
                    }
                }
                "nvGrpSpPr" | "grpSpPr" => {}
                _ => {
                    renderer.partial = true;
                    blocks.push("<p>[复杂对象暂不能呈现]</p>".into());
                }
            }
        }
        let (body, index, next, prev) = choose_blocks(&blocks, offset);
        result.offset = index;
        result.next = next;
        result.previous = prev;
        body
    } else {
        workbook(&package, &mut result, section, offset)?
    };
    if body.len() > TEXT_BUDGET {
        return Err(Code::LimitExceeded);
    }
    if body.is_empty() {
        body = "<p class=\"notice\">此页没有可显示的正文</p>".into();
    }
    result.assets = renderer.assets(&mut body);
    result.partial |= renderer.partial;
    result.html = page(&body, dark, zoom);
    Ok(result)
}

fn column(value: &str) -> Option<usize> {
    let mut n = 0_usize;
    for b in value.bytes().take_while(u8::is_ascii_alphabetic) {
        n = n
            .checked_mul(26)?
            .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))?;
    }
    n.checked_sub(1).filter(|n| *n < 16_384)
}
fn column_name(mut n: usize) -> String {
    let mut s = String::new();
    n += 1;
    while n > 0 {
        n -= 1;
        s.insert(0, (b'A' + (n % 26) as u8) as char);
        n /= 26;
    }
    s
}
fn cell_value(
    n: &Node,
    shared: &[String],
    styles: &[usize],
    custom: &BTreeMap<usize, String>,
    date_1904: bool,
) -> String {
    let raw = n.child("v").map(|v| v.text.as_str()).unwrap_or("");
    if let Some(formula) = n.child("f") {
        if raw.is_empty() {
            return format!("={}（无已保存计算结果）", formula.text);
        }
    }
    match n.attr("t") {
        "s" => raw
            .parse::<usize>()
            .ok()
            .and_then(|i| shared.get(i))
            .cloned()
            .unwrap_or_else(|| "[字符串索引不可用]".into()),
        "inlineStr" => n.child("is").map(Node::texts).unwrap_or_default(),
        "b" => if raw == "1" { "TRUE" } else { "FALSE" }.into(),
        "str" | "e" | "d" => raw.to_owned(),
        _ => {
            let format = n
                .attr("s")
                .parse::<usize>()
                .ok()
                .and_then(|s| styles.get(s))
                .copied()
                .unwrap_or(0);
            let code = custom.get(&format).map(String::as_str).unwrap_or("");
            if let Ok(number) = raw.parse::<f64>() {
                if number.is_finite() && (format == 9 || format == 10 || code.contains('%')) {
                    let precision = if format == 9 {
                        0
                    } else if format == 10 {
                        2
                    } else {
                        code.split_once('.')
                            .map(|(_, s)| s.chars().take_while(|c| matches!(c, '0' | '#')).count())
                            .unwrap_or(0)
                            .min(12)
                    };
                    return format!("{:.*}%", precision, number * 100.0);
                }
                if number.is_finite()
                    && ((14..=22).contains(&format)
                        || (code.to_ascii_lowercase().contains('y')
                            && code.to_ascii_lowercase().contains('d')))
                {
                    let seconds = (number.rem_euclid(1.0) * 86400.0).round() as u32 % 86400;
                    let time = format!(
                        "{:02}:{:02}:{:02}",
                        seconds / 3600,
                        (seconds / 60) % 60,
                        seconds % 60
                    );
                    if (18..=21).contains(&format) {
                        return time;
                    }
                    if !date_1904 && number.floor() == 60.0 {
                        return "1900-02-29".into();
                    }
                    let base = if date_1904 {
                        chrono::NaiveDate::from_ymd_opt(1904, 1, 1)
                    } else {
                        chrono::NaiveDate::from_ymd_opt(
                            1899,
                            12,
                            if number < 60.0 { 31 } else { 30 },
                        )
                    };
                    if number.abs() < 3_000_000.0 {
                        if let Some(date) = base.and_then(|d| {
                            d.checked_add_signed(chrono::Duration::days(number.floor() as i64))
                        }) {
                            return if format == 22 || code.to_ascii_lowercase().contains('h') {
                                format!("{date} {time}")
                            } else {
                                date.to_string()
                            };
                        }
                    }
                }
            }
            raw.to_owned()
        }
    }
}
fn workbook(
    package: &Package,
    result: &mut Presentation,
    section: usize,
    offset: usize,
) -> Result<String, Code> {
    let tree = part(package, "xl/workbook.xml")?;
    let rels = relationships(package, "xl/workbook.xml")?;
    let sheets = tree
        .descendants("sheet")
        .into_iter()
        .filter(|n| !matches!(n.attr("state"), "hidden" | "veryHidden"))
        .map(|n| {
            rels.get(n.relationship_id())
                .map(|path| (n, path))
                .ok_or(Code::IntegrityFailed)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if sheets.is_empty() || sheets.len() > 512 {
        return Err(Code::Unsupported);
    }
    result.section = section.min(sheets.len() - 1);
    result.sections = sheets
        .iter()
        .enumerate()
        .map(|(id, (n, _))| Section {
            id,
            label: n.attr("name").chars().take(255).collect(),
        })
        .collect();
    let date_1904 = tree
        .descendants("workbookPr")
        .iter()
        .any(|n| matches!(n.attr("date1904"), "1" | "true"));
    let shared = if let Some(bytes) = package.get("xl/sharedStrings.xml") {
        xml(bytes)?
            .descendants("si")
            .iter()
            .map(|n| n.texts())
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    let style_tree = package
        .get("xl/styles.xml")
        .map(|b| xml(b))
        .transpose()?
        .unwrap_or_default();
    let custom = style_tree
        .descendants("numFmt")
        .iter()
        .filter_map(|n| {
            Some((
                n.attr("numFmtId").parse().ok()?,
                n.attr("formatCode").to_owned(),
            ))
        })
        .collect();
    let styles = style_tree
        .descendants("cellXfs")
        .first()
        .map(|n| {
            n.children
                .iter()
                .map(|n| n.attr("numFmtId").parse().unwrap_or(0))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let sheet = part(package, sheets[result.section].1)?;
    fn address(value: &str) -> Option<(usize, usize)> {
        let col = column(value)?;
        let row = value
            .trim_start_matches(|c: char| c.is_ascii_alphabetic())
            .parse::<usize>()
            .ok()?
            .checked_sub(1)?;
        (row < 1_048_576).then_some((row, col))
    }
    let cells = sheet
        .descendants("c")
        .into_iter()
        .map(|n| {
            address(n.attr("r"))
                .map(|a| (a, n))
                .ok_or(Code::Unsupported)
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let merges = sheet
        .descendants("mergeCell")
        .into_iter()
        .map(|n| {
            let (start, end) = n.attr("ref").split_once(':').ok_or(Code::Unsupported)?;
            let (start, end) = (
                address(start).ok_or(Code::Unsupported)?,
                address(end).ok_or(Code::Unsupported)?,
            );
            if start.0 > end.0 || start.1 > end.1 {
                return Err(Code::Unsupported);
            }
            Ok((start, end))
        })
        .collect::<Result<Vec<_>, Code>>()?;
    // Keep actual cell coordinates, including sparse rows and merged ranges.
    let max_col = cells
        .keys()
        .map(|(_, c)| *c)
        .chain(merges.iter().map(|(_, end)| end.1))
        .max()
        .unwrap_or(0);
    let max_row = cells
        .keys()
        .map(|(r, _)| *r)
        .chain(merges.iter().map(|(_, end)| end.0))
        .max()
        .unwrap_or(0);
    let windows = max_col / 50 + 1;
    let row_batches = (max_row + 1).div_ceil(100);
    let page = offset.min(row_batches * windows - 1);
    let row_start = (page / windows) * 100;
    let col_start = (page % windows) * 50;
    result.offset = page;
    result.next = (page + 1 < row_batches * windows).then_some(page + 1);
    result.previous = (page > 0).then_some(page.saturating_sub(1));
    let mut html = String::from("<p class=\"notice\">只读工作表 · 公式显示已保存结果，未重新计算</p><table class=\"sheet\"><thead><tr><th>行</th>");
    for c in col_start..=(col_start + 49).min(max_col) {
        html.push_str(&format!("<th>{}</th>", column_name(c)));
    }
    html.push_str("</tr></thead><tbody>");
    let row_end = (row_start + 99).min(max_row);
    let col_end = (col_start + 49).min(max_col);
    let visible_merges = merges
        .iter()
        .filter(|(start, end)| {
            end.0 >= row_start && start.0 <= row_end && end.1 >= col_start && start.1 <= col_end
        })
        .collect::<Vec<_>>();
    for r in row_start..=row_end {
        html.push_str(&format!("<tr><th>{}</th>", r + 1));
        for c in col_start..=(col_start + 49).min(max_col) {
            let merge = visible_merges
                .iter()
                .find(|(start, end)| r >= start.0 && r <= end.0 && c >= start.1 && c <= end.1);
            let (address, rowspan, colspan) = if let Some((start, end)) = merge {
                if r != start.0.max(row_start) || c != start.1.max(col_start) {
                    continue;
                }
                (
                    *start,
                    end.0.min(row_end) - r + 1,
                    end.1.min(col_end) - c + 1,
                )
            } else {
                ((r, c), 1, 1)
            };
            let value = cells
                .get(&address)
                .map(|n| cell_value(n, &shared, &styles, &custom, date_1904))
                .unwrap_or_default();
            let remaining_cells = (row_end - r) * (col_end - col_start + 1) + col_end - c;
            let remaining = TEXT_BUDGET.saturating_sub(html.len() + remaining_cells * 40 + 512);
            let mut value = escape(&value);
            if value.len() > remaining {
                result.partial = true;
                value = "…".into();
            }
            html.push_str(&format!(
                "<td rowspan=\"{rowspan}\" colspan=\"{colspan}\">{value}</td>"
            ));
        }
        html.push_str("</tr>");
    }
    html.push_str("</tbody></table>");
    if cells.is_empty() {
        html.push_str("<p>此工作表为空</p>");
    }
    Ok(html)
}
