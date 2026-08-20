use flate2::read::ZlibDecoder;
use image::{ImageFormat, ImageReader, Limits};
use quick_xml::events::Event;
use quick_xml::Reader;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{Cursor, Read};
use std::os::unix::fs::OpenOptionsExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive};

pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_MESSAGE: usize = 10;
pub const ATTACHMENT_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const MAX_EXTRACTED_TEXT_BYTES: usize = 512 * 1024;
pub const MAX_FILE_CONTEXT_BYTES: usize = 256 * 1024;
const CHUNK_BYTES: usize = 8 * 1024;
const MAX_OOXML_ENTRIES: usize = 512;
const MAX_OOXML_UNCOMPRESSED_BYTES: u64 = 32 * 1024 * 1024;
const MAX_OOXML_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
const MAX_OOXML_COMPRESSION_RATIO: u64 = 100;
const MAX_PDF_OBJECTS: usize = 4_096;
const MAX_PDF_PAGES: usize = 256;
const MAX_PDF_STREAMS: usize = 1_024;
const MAX_PDF_STREAM_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PDF_TOTAL_STREAM_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PDF_COMPRESSION_RATIO: u64 = 100;
const MAX_PDF_EXPANDED_STREAMS: usize = 4_096;
const MAX_PDF_EXPANDED_STREAM_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PDF_FORM_DEPTH: usize = 16;
const MAX_PDF_PAGE_TREE_DEPTH: usize = 64;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const MAX_IMAGE_DECODE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachmentKind {
    File,
    Image,
}

impl AttachmentKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Image => "image",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachmentImportError {
    TooMany,
    TooLarge,
    ArchiveUnsupported,
    Unsupported,
    InvalidContent,
    ParseFailed,
    Unavailable,
}

impl AttachmentImportError {
    pub const fn issue(self) -> &'static str {
        match self {
            Self::TooMany => "too_many",
            Self::TooLarge => "too_large",
            Self::ArchiveUnsupported => "archive_unsupported",
            Self::Unsupported => "unsupported",
            Self::InvalidContent => "invalid_content",
            Self::ParseFailed => "parse_failed",
            Self::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachmentPreparationStage {
    Queued,
    Importing,
    Parsing,
    Indexing,
    Ready,
    ErrorTerminal,
}

impl AttachmentPreparationStage {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Importing => "importing",
            Self::Parsing => "parsing",
            Self::Indexing => "indexing",
            Self::Ready => "ready",
            Self::ErrorTerminal => "error_terminal",
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct AttachmentPreparationProgress {
    pub stage: AttachmentPreparationStage,
    pub item_count: usize,
    pub issue: Option<&'static str>,
}

impl std::fmt::Debug for AttachmentPreparationProgress {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AttachmentPreparationProgress")
            .field("stage", &self.stage)
            .field("item_count", &self.item_count)
            .field("issue", &self.issue)
            .finish()
    }
}

#[cfg(target_os = "macos")]
pub async fn pick_paths() -> Result<Option<Vec<PathBuf>>, AttachmentImportError> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("添加图片或文件")
        .add_filter(
            "支持的图片与文件",
            &[
                "jpg", "jpeg", "png", "webp", "gif", "pdf", "txt", "md", "markdown", "csv", "json",
                "yaml", "yml", "xml", "html", "htm", "rtf", "docx", "xlsx", "pptx",
            ],
        )
        .pick_files()
        .await;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let paths = selected
        .into_iter()
        .map(|handle| handle.path().to_path_buf())
        .collect::<Vec<_>>();
    if paths.len() > MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(AttachmentImportError::TooMany);
    }
    Ok(Some(paths))
}

#[cfg(not(target_os = "macos"))]
pub async fn pick_paths() -> Result<Option<Vec<PathBuf>>, AttachmentImportError> {
    Err(AttachmentImportError::Unavailable)
}

#[cfg(test)]
pub fn prepare_paths(
    paths: Vec<PathBuf>,
    now: i64,
    remaining_capacity: usize,
) -> Result<Vec<PreparedAttachment>, AttachmentImportError> {
    let imported = import_paths(paths, remaining_capacity)?;
    let parsed = parse_imported(imported)?;
    index_parsed(parsed, now)
}

pub fn prepare_paths_with_progress<F>(
    paths: Vec<PathBuf>,
    now: i64,
    remaining_capacity: usize,
    mut report: F,
) -> Result<Vec<PreparedAttachment>, AttachmentImportError>
where
    F: FnMut(AttachmentPreparationProgress) -> Result<(), AttachmentImportError>,
{
    validate_path_batch(&paths, remaining_capacity)?;
    let item_count = paths.len();
    let progress = |stage, issue| AttachmentPreparationProgress {
        stage,
        item_count,
        issue,
    };

    report(progress(AttachmentPreparationStage::Queued, None))?;
    report(progress(AttachmentPreparationStage::Importing, None))?;
    let imported = match import_paths(paths, remaining_capacity) {
        Ok(imported) => imported,
        Err(error) => {
            report(progress(
                AttachmentPreparationStage::ErrorTerminal,
                Some(error.issue()),
            ))?;
            return Err(error);
        }
    };

    report(progress(AttachmentPreparationStage::Parsing, None))?;
    let parsed = match parse_imported(imported) {
        Ok(parsed) => parsed,
        Err(error) => {
            report(progress(
                AttachmentPreparationStage::ErrorTerminal,
                Some(error.issue()),
            ))?;
            return Err(error);
        }
    };

    report(progress(AttachmentPreparationStage::Indexing, None))?;
    match index_parsed(parsed, now) {
        Ok(prepared) => Ok(prepared),
        Err(error) => {
            report(progress(
                AttachmentPreparationStage::ErrorTerminal,
                Some(error.issue()),
            ))?;
            Err(error)
        }
    }
}

fn validate_path_batch(
    paths: &[PathBuf],
    remaining_capacity: usize,
) -> Result<(), AttachmentImportError> {
    if !(1..=MAX_ATTACHMENTS_PER_MESSAGE).contains(&remaining_capacity)
        || paths.is_empty()
        || paths.len() > remaining_capacity
        || paths.len() > MAX_ATTACHMENTS_PER_MESSAGE
    {
        return Err(AttachmentImportError::TooMany);
    }
    let mut unique = HashSet::with_capacity(paths.len());
    if paths
        .iter()
        .any(|path| !path.is_absolute() || !unique.insert(path))
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(())
}

pub(crate) fn import_paths(
    paths: Vec<PathBuf>,
    remaining_capacity: usize,
) -> Result<Vec<ImportedAttachment>, AttachmentImportError> {
    validate_path_batch(&paths, remaining_capacity)?;
    let mut imported = Vec::with_capacity(paths.len());
    for path in paths {
        imported.push(import_path(&path)?);
    }
    Ok(imported)
}

pub(crate) fn parse_imported(
    imported: Vec<ImportedAttachment>,
) -> Result<Vec<ParsedAttachment>, AttachmentImportError> {
    imported.into_iter().map(parse_attachment).collect()
}

pub(crate) fn index_parsed(
    parsed: Vec<ParsedAttachment>,
    now: i64,
) -> Result<Vec<PreparedAttachment>, AttachmentImportError> {
    parsed
        .into_iter()
        .map(|attachment| index_attachment(attachment, now))
        .collect()
}

pub(crate) struct ImportedAttachment {
    safe_name: String,
    content: Vec<u8>,
}

pub(crate) struct ParsedAttachment {
    safe_name: String,
    content: Vec<u8>,
    detected: Detection,
}

#[derive(Clone, PartialEq, Eq)]
pub struct PreparedAttachment {
    pub id: Uuid,
    pub kind: AttachmentKind,
    pub safe_name: String,
    pub media_type: String,
    pub byte_size: usize,
    pub sha256: String,
    pub imported_at: i64,
    pub expires_at: i64,
    pub content: Vec<u8>,
    pub chunks: Vec<String>,
}

impl std::fmt::Debug for PreparedAttachment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreparedAttachment")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("safe_name", &"[ATTACHMENT_NAME]")
            .field("media_type", &self.media_type)
            .field("byte_size", &self.byte_size)
            .field("sha256", &"[DIGEST]")
            .field("imported_at", &self.imported_at)
            .field("expires_at", &self.expires_at)
            .field("chunk_count", &self.chunks.len())
            .finish()
    }
}

fn import_path(path: &Path) -> Result<ImportedAttachment, AttachmentImportError> {
    let safe_name = safe_file_name(path)?;
    let file = open_regular_file(path)?;
    let metadata = file
        .metadata()
        .map_err(|_| AttachmentImportError::Unavailable)?;
    let declared_size =
        usize::try_from(metadata.len()).map_err(|_| AttachmentImportError::TooLarge)?;
    if declared_size == 0 {
        return Err(AttachmentImportError::InvalidContent);
    }
    if declared_size > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentImportError::TooLarge);
    }
    let mut content = Vec::with_capacity(declared_size);
    file.take((MAX_ATTACHMENT_BYTES + 1) as u64)
        .read_to_end(&mut content)
        .map_err(|_| AttachmentImportError::Unavailable)?;
    if content.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentImportError::TooLarge);
    }
    if content.len() != declared_size {
        return Err(AttachmentImportError::Unavailable);
    }
    Ok(ImportedAttachment { safe_name, content })
}

#[cfg(test)]
pub fn prepare_bytes(
    safe_name: String,
    content: Vec<u8>,
    now: i64,
) -> Result<PreparedAttachment, AttachmentImportError> {
    let parsed = parse_attachment(ImportedAttachment { safe_name, content })?;
    index_attachment(parsed, now)
}

fn parse_attachment(
    imported: ImportedAttachment,
) -> Result<ParsedAttachment, AttachmentImportError> {
    let ImportedAttachment { safe_name, content } = imported;
    if content.is_empty() {
        return Err(AttachmentImportError::InvalidContent);
    }
    if content.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentImportError::TooLarge);
    }
    let safe_name = normalize_safe_name(&safe_name)?;
    let extension = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(AttachmentImportError::Unsupported)?;
    let detected = detect_and_extract(&extension, &content)?;
    Ok(ParsedAttachment {
        safe_name,
        content,
        detected,
    })
}

fn index_attachment(
    parsed: ParsedAttachment,
    now: i64,
) -> Result<PreparedAttachment, AttachmentImportError> {
    index_attachment_with_id(parsed, now, Uuid::now_v7())
}

fn index_attachment_with_id(
    parsed: ParsedAttachment,
    now: i64,
    id: Uuid,
) -> Result<PreparedAttachment, AttachmentImportError> {
    if now < 0 {
        return Err(AttachmentImportError::InvalidContent);
    }
    if id.is_nil() {
        return Err(AttachmentImportError::InvalidContent);
    }
    let ParsedAttachment {
        safe_name,
        content,
        detected,
    } = parsed;
    let imported_at = now;
    let expires_at = imported_at
        .checked_add(ATTACHMENT_TTL_SECONDS)
        .ok_or(AttachmentImportError::InvalidContent)?;
    let chunks = detected
        .extracted_text
        .as_deref()
        .map(chunk_text)
        .unwrap_or_default();
    Ok(PreparedAttachment {
        id,
        kind: detected.kind,
        safe_name,
        media_type: detected.media_type.to_owned(),
        byte_size: content.len(),
        sha256: format!("{:x}", Sha256::digest(&content)),
        imported_at,
        expires_at,
        content,
        chunks,
    })
}

fn open_regular_file(path: &Path) -> Result<File, AttachmentImportError> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| AttachmentImportError::Unavailable)?;
    let metadata = file
        .metadata()
        .map_err(|_| AttachmentImportError::Unavailable)?;
    if !metadata.file_type().is_file() {
        return Err(AttachmentImportError::Unsupported);
    }
    Ok(file)
}

fn safe_file_name(path: &Path) -> Result<String, AttachmentImportError> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(AttachmentImportError::Unsupported)?;
    normalize_safe_name(name)
}

fn normalize_safe_name(value: &str) -> Result<String, AttachmentImportError> {
    let normalized = value
        .nfc()
        .filter(|character| !character.is_control() && !matches!(character, '/' | '\\'))
        .collect::<String>();
    let trimmed = normalized.trim().trim_matches('.').trim();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return Err(AttachmentImportError::Unsupported);
    }
    Ok(trimmed.to_owned())
}

struct Detection {
    kind: AttachmentKind,
    media_type: &'static str,
    extracted_text: Option<String>,
}

fn detect_and_extract(extension: &str, content: &[u8]) -> Result<Detection, AttachmentImportError> {
    if matches!(
        extension,
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz"
    ) {
        return Err(AttachmentImportError::ArchiveUnsupported);
    }
    if let Some(media_type) = detect_image(content) {
        validate_image_content(media_type, content)?;
        let expected_extension = match media_type {
            "image/jpeg" => matches!(extension, "jpg" | "jpeg"),
            "image/png" => extension == "png",
            "image/webp" => extension == "webp",
            "image/gif" => extension == "gif",
            _ => false,
        };
        if !expected_extension {
            return Err(AttachmentImportError::InvalidContent);
        }
        return Ok(Detection {
            kind: AttachmentKind::Image,
            media_type,
            extracted_text: None,
        });
    }

    match extension {
        "pdf" if content.starts_with(b"%PDF-") => Ok(Detection {
            kind: AttachmentKind::File,
            media_type: "application/pdf",
            extracted_text: Some(extract_pdf(content)?),
        }),
        "docx" | "xlsx" | "pptx" if content.starts_with(b"PK\x03\x04") => {
            let (media_type, text) = extract_ooxml(extension, content)?;
            Ok(Detection {
                kind: AttachmentKind::File,
                media_type,
                extracted_text: Some(text),
            })
        }
        "txt" | "md" | "markdown" | "csv" | "json" | "yaml" | "yml" | "xml" | "html" | "htm"
        | "rtf" => extract_text_document(extension, content),
        _ => Err(AttachmentImportError::Unsupported),
    }
}

fn detect_image(content: &[u8]) -> Option<&'static str> {
    let inferred = infer::get(content)?.mime_type();
    match inferred {
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" => Some(inferred),
        _ => None,
    }
}

pub(crate) fn validate_image_content(
    media_type: &str,
    content: &[u8],
) -> Result<(), AttachmentImportError> {
    if detect_image(content) != Some(media_type)
        || !has_complete_image_container(media_type, content)
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    let format = match media_type {
        "image/jpeg" => ImageFormat::Jpeg,
        "image/png" => ImageFormat::Png,
        "image/webp" => ImageFormat::WebP,
        "image/gif" => ImageFormat::Gif,
        _ => return Err(AttachmentImportError::Unsupported),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_DECODE_BYTES);
    let mut reader = ImageReader::with_format(Cursor::new(content), format);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    let pixels = u64::from(decoded.width())
        .checked_mul(u64::from(decoded.height()))
        .ok_or(AttachmentImportError::InvalidContent)?;
    if pixels == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(())
}

fn has_complete_image_container(media_type: &str, content: &[u8]) -> bool {
    match media_type {
        "image/jpeg" => content.len() >= 4 && content.ends_with(&[0xff, 0xd9]),
        "image/png" => {
            const IEND: [u8; 12] = [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82];
            content.len() >= 33 && content.ends_with(&IEND)
        }
        "image/gif" => content.len() >= 14 && content.last() == Some(&0x3b),
        "image/webp" => {
            if content.len() < 12
                || !content.starts_with(b"RIFF")
                || content.get(8..12) != Some(b"WEBP")
            {
                return false;
            }
            let Some(length) = content.get(4..8) else {
                return false;
            };
            let declared = u32::from_le_bytes([length[0], length[1], length[2], length[3]]);
            usize::try_from(declared)
                .ok()
                .and_then(|length| length.checked_add(8))
                == Some(content.len())
        }
        _ => false,
    }
}

#[cfg(test)]
pub(crate) fn test_image_bytes(extension: &str) -> Vec<u8> {
    let format = match extension {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        "gif" => ImageFormat::Gif,
        _ => panic!("unsupported test image extension"),
    };
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        2,
        2,
        image::Rgb([0x21, 0x80, 0xc0]),
    ));
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, format).expect("encode image");
    output.into_inner()
}

fn extract_pdf(content: &[u8]) -> Result<String, AttachmentImportError> {
    let document = preflight_pdf(content)?;
    extract_pdf_document(&document, MAX_EXTRACTED_TEXT_BYTES)
}

pub(crate) fn validate_pdf_artifact_content(content: &[u8]) -> Result<(), AttachmentImportError> {
    preflight_pdf(content).map(drop)
}

fn extract_pdf_document(
    document: &pdf_extract::Document,
    limit: usize,
) -> Result<String, AttachmentImportError> {
    let mut writer = BoundedPdfText::new(limit);
    let extraction = catch_unwind(AssertUnwindSafe(|| {
        let mut output = pdf_extract::PlainTextOutput::new(&mut writer);
        pdf_extract::output_doc(document, &mut output)
    }));
    match extraction {
        Ok(Ok(())) => {}
        Ok(Err(_)) if writer.truncated => {}
        Ok(Err(_)) | Err(_) => return Err(AttachmentImportError::ParseFailed),
    }
    bounded_normalized_text(&writer.value)
}

struct BoundedPdfText {
    value: String,
    limit: usize,
    truncated: bool,
}

impl BoundedPdfText {
    fn new(limit: usize) -> Self {
        Self {
            value: String::new(),
            limit,
            truncated: false,
        }
    }
}

impl std::fmt::Write for BoundedPdfText {
    fn write_str(&mut self, value: &str) -> std::fmt::Result {
        let remaining = self.limit.saturating_sub(self.value.len());
        if value.len() <= remaining {
            self.value.push_str(value);
            return Ok(());
        }
        self.value.push_str(truncate_utf8(value, remaining));
        self.truncated = true;
        Err(std::fmt::Error)
    }
}

impl<'a> pdf_extract::ConvertToFmt for &'a mut BoundedPdfText {
    type Writer = &'a mut BoundedPdfText;

    fn convert(self) -> Self::Writer {
        self
    }
}

#[derive(Default)]
struct PdfExpansionBudget {
    streams: usize,
    bytes: u64,
}

impl PdfExpansionBudget {
    fn consume(&mut self, bytes: usize) -> Result<(), AttachmentImportError> {
        self.streams = self
            .streams
            .checked_add(1)
            .ok_or(AttachmentImportError::InvalidContent)?;
        self.bytes = self
            .bytes
            .checked_add(u64::try_from(bytes).map_err(|_| AttachmentImportError::InvalidContent)?)
            .ok_or(AttachmentImportError::InvalidContent)?;
        if self.streams > MAX_PDF_EXPANDED_STREAMS || self.bytes > MAX_PDF_EXPANDED_STREAM_BYTES {
            return Err(AttachmentImportError::InvalidContent);
        }
        Ok(())
    }
}

fn preflight_pdf(content: &[u8]) -> Result<pdf_extract::Document, AttachmentImportError> {
    validate_classic_pdf_xref(content)?;
    if [
        b"ObjStm".as_slice(),
        b"XRef".as_slice(),
        b"XRefStm".as_slice(),
        b"Prev".as_slice(),
        b"Encrypt".as_slice(),
    ]
    .iter()
    .any(|name| contains_pdf_name(content, name))
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    let options = pdf_extract::LoadOptions {
        filter: Some(filter_pdf_object_streams),
        ..pdf_extract::LoadOptions::default()
    };
    let mut document = pdf_extract::Document::load_mem_with_options(content, options)
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    if document.objects.is_empty()
        || document.objects.len() > MAX_PDF_OBJECTS
        || document.trailer.get(b"Encrypt").is_ok()
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    let pages = document.get_pages();
    let page_count = pages.len();
    if page_count == 0 || page_count > MAX_PDF_PAGES {
        return Err(AttachmentImportError::InvalidContent);
    }

    let mut stream_count = 0_usize;
    let mut total_stream_bytes = 0_u64;
    let mut decoded_streams = HashMap::new();
    let mut image_streams = Vec::new();
    for (object_id, object) in &document.objects {
        if matches!(object, pdf_extract::Object::Name(name) if name == b"YijieRejectedObjStm") {
            return Err(AttachmentImportError::InvalidContent);
        }
        let pdf_extract::Object::Stream(stream) = object else {
            continue;
        };
        stream_count = stream_count
            .checked_add(1)
            .ok_or(AttachmentImportError::InvalidContent)?;
        if stream_count > MAX_PDF_STREAMS {
            return Err(AttachmentImportError::InvalidContent);
        }
        if stream.dict.has_type(b"ObjStm") {
            return Err(AttachmentImportError::InvalidContent);
        }

        let compressed_bytes = u64::try_from(stream.content.len())
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        let is_image = pdf_stream_has_subtype(stream, b"Image");
        let decoded = if stream.dict.get(b"Filter").is_err() {
            Some(stream.content.clone())
        } else {
            let filters = stream
                .filters()
                .map_err(|_| AttachmentImportError::InvalidContent)?;
            if filters.as_slice() == [b"FlateDecode"] {
                if stream.dict.get(b"DecodeParms").is_ok() {
                    return Err(AttachmentImportError::InvalidContent);
                }
                Some(bounded_zlib_content(&stream.content, MAX_PDF_STREAM_BYTES)?)
            } else if is_encoded_pdf_image(stream, &filters) {
                None
            } else {
                return Err(AttachmentImportError::InvalidContent);
            }
        };
        let uncompressed_bytes = decoded
            .as_ref()
            .map(|value| value.len() as u64)
            .unwrap_or(compressed_bytes);
        if uncompressed_bytes > MAX_PDF_STREAM_BYTES
            || compression_ratio_exceeded(
                compressed_bytes,
                uncompressed_bytes,
                MAX_PDF_COMPRESSION_RATIO,
            )
        {
            return Err(AttachmentImportError::InvalidContent);
        }
        total_stream_bytes = total_stream_bytes
            .checked_add(uncompressed_bytes)
            .ok_or(AttachmentImportError::InvalidContent)?;
        if total_stream_bytes > MAX_PDF_TOTAL_STREAM_BYTES {
            return Err(AttachmentImportError::InvalidContent);
        }
        if is_image {
            image_streams.push(*object_id);
        } else if let Some(decoded) = decoded {
            decoded_streams.insert(*object_id, decoded);
        }
    }
    validate_pdf_expansion(&document, &pages, &decoded_streams)?;
    sanitize_pdf_image_streams(&mut document, &image_streams)?;
    Ok(document)
}

fn validate_classic_pdf_xref(content: &[u8]) -> Result<(), AttachmentImportError> {
    let eof = find_last_bytes(content, b"%%EOF").ok_or(AttachmentImportError::InvalidContent)?;
    let marker = find_last_bytes(&content[..eof], b"startxref")
        .ok_or(AttachmentImportError::InvalidContent)?;
    let mut cursor = marker + b"startxref".len();
    while content
        .get(cursor)
        .is_some_and(|value| is_pdf_whitespace(*value))
    {
        cursor += 1;
    }
    let digits_start = cursor;
    let mut offset = 0_usize;
    while let Some(value @ b'0'..=b'9') = content.get(cursor).copied() {
        offset = offset
            .checked_mul(10)
            .and_then(|current| current.checked_add(usize::from(value - b'0')))
            .ok_or(AttachmentImportError::InvalidContent)?;
        cursor += 1;
    }
    let xref_end = offset
        .checked_add(4)
        .ok_or(AttachmentImportError::InvalidContent)?;
    if cursor == digits_start
        || !content
            .get(cursor)
            .is_some_and(|value| is_pdf_whitespace(*value))
        || content.get(offset..xref_end) != Some(b"xref")
        || content
            .get(xref_end)
            .is_some_and(|value| !is_pdf_whitespace(*value))
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(())
}

fn find_last_bytes(content: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || content.len() < needle.len() {
        return None;
    }
    content
        .windows(needle.len())
        .rposition(|value| value == needle)
}

fn is_pdf_whitespace(value: u8) -> bool {
    matches!(value, 0 | b'\t' | b'\n' | 0x0c | b'\r' | b' ')
}

fn validate_pdf_expansion(
    document: &pdf_extract::Document,
    pages: &std::collections::BTreeMap<u32, pdf_extract::ObjectId>,
    decoded_streams: &HashMap<pdf_extract::ObjectId, Vec<u8>>,
) -> Result<(), AttachmentImportError> {
    let mut budget = PdfExpansionBudget::default();
    let mut active = HashSet::new();
    for page_id in pages.values() {
        let resources = resolve_pdf_page_resources(document, *page_id)?;
        let content_ids = document.get_page_contents(*page_id);
        for content_id in content_ids {
            validate_pdf_stream_expansion(
                document,
                decoded_streams,
                content_id,
                resources,
                0,
                &mut active,
                &mut budget,
            )?;
        }
    }
    Ok(())
}

fn validate_pdf_stream_expansion<'a>(
    document: &'a pdf_extract::Document,
    decoded_streams: &HashMap<pdf_extract::ObjectId, Vec<u8>>,
    stream_id: pdf_extract::ObjectId,
    resources: Option<&'a pdf_extract::Dictionary>,
    depth: usize,
    active: &mut HashSet<pdf_extract::ObjectId>,
    budget: &mut PdfExpansionBudget,
) -> Result<(), AttachmentImportError> {
    if !active.insert(stream_id) {
        return Err(AttachmentImportError::InvalidContent);
    }
    let result = (|| {
        let stream = document
            .get_object(stream_id)
            .and_then(pdf_extract::Object::as_stream)
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        if pdf_stream_has_subtype(stream, b"Image") {
            budget.consume(0)?;
            return Ok(());
        }
        let decoded = decoded_streams
            .get(&stream_id)
            .ok_or(AttachmentImportError::InvalidContent)?;
        budget.consume(decoded.len())?;
        let operations = pdf_extract::content::Content::decode(decoded)
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        for operation in operations.operations {
            if operation.operator != "Do" {
                continue;
            }
            let name = operation
                .operands
                .first()
                .and_then(|value| value.as_name().ok())
                .ok_or(AttachmentImportError::InvalidContent)?;
            let resources = resources.ok_or(AttachmentImportError::InvalidContent)?;
            let (child_id, child_stream) = resolve_pdf_xobject(document, resources, name)?;
            if pdf_stream_has_subtype(child_stream, b"Image") {
                budget.consume(0)?;
                continue;
            }
            if !pdf_stream_has_subtype(child_stream, b"Form") || depth >= MAX_PDF_FORM_DEPTH {
                return Err(AttachmentImportError::InvalidContent);
            }
            let child_resources = match child_stream.dict.get(b"Resources") {
                Ok(value) => Some(resolve_pdf_dictionary(document, value)?),
                Err(_) => Some(resources),
            };
            validate_pdf_stream_expansion(
                document,
                decoded_streams,
                child_id,
                child_resources,
                depth + 1,
                active,
                budget,
            )?;
        }
        Ok(())
    })();
    active.remove(&stream_id);
    result
}

fn resolve_pdf_page_resources(
    document: &pdf_extract::Document,
    page_id: pdf_extract::ObjectId,
) -> Result<Option<&pdf_extract::Dictionary>, AttachmentImportError> {
    let mut current = page_id;
    let mut visited = HashSet::new();
    for _ in 0..MAX_PDF_PAGE_TREE_DEPTH {
        if !visited.insert(current) {
            return Err(AttachmentImportError::InvalidContent);
        }
        let page = document
            .get_dictionary(current)
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        if let Ok(resources) = page.get(b"Resources") {
            return Ok(Some(resolve_pdf_dictionary(document, resources)?));
        }
        match page
            .get(b"Parent")
            .and_then(pdf_extract::Object::as_reference)
        {
            Ok(parent) => current = parent,
            Err(_) => return Ok(None),
        }
    }
    Err(AttachmentImportError::InvalidContent)
}

fn resolve_pdf_dictionary<'a>(
    document: &'a pdf_extract::Document,
    value: &'a pdf_extract::Object,
) -> Result<&'a pdf_extract::Dictionary, AttachmentImportError> {
    document
        .dereference(value)
        .and_then(|(_, value)| value.as_dict())
        .map_err(|_| AttachmentImportError::InvalidContent)
}

fn resolve_pdf_xobject<'a>(
    document: &'a pdf_extract::Document,
    resources: &'a pdf_extract::Dictionary,
    name: &[u8],
) -> Result<(pdf_extract::ObjectId, &'a pdf_extract::Stream), AttachmentImportError> {
    let xobjects = resources
        .get(b"XObject")
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    let xobjects = resolve_pdf_dictionary(document, xobjects)?;
    let value = xobjects
        .get(name)
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    let (object_id, value) = document
        .dereference(value)
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    let object_id = object_id.ok_or(AttachmentImportError::InvalidContent)?;
    let stream = value
        .as_stream()
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    Ok((object_id, stream))
}

fn sanitize_pdf_image_streams(
    document: &mut pdf_extract::Document,
    image_streams: &[pdf_extract::ObjectId],
) -> Result<(), AttachmentImportError> {
    for object_id in image_streams {
        let stream = document
            .get_object_mut(*object_id)
            .and_then(pdf_extract::Object::as_stream_mut)
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        stream.content.clear();
        stream.dict.remove(b"Filter");
        stream.dict.remove(b"DecodeParms");
        stream.dict.set("Length", 0_i64);
    }
    Ok(())
}

fn pdf_stream_has_subtype(stream: &pdf_extract::Stream, expected: &[u8]) -> bool {
    stream
        .dict
        .get(b"Subtype")
        .and_then(pdf_extract::Object::as_name)
        .is_ok_and(|value| value == expected)
}

fn contains_pdf_name(content: &[u8], expected: &[u8]) -> bool {
    let mut cursor = 0_usize;
    while cursor < content.len() {
        if content[cursor] != b'/' {
            cursor += 1;
            continue;
        }
        cursor += 1;
        let mut matched = true;
        let mut decoded_length = 0_usize;
        while cursor < content.len() && !is_pdf_delimiter(content[cursor]) {
            let decoded = if content[cursor] == b'#' && cursor + 2 < content.len() {
                match (
                    pdf_hex_digit(content[cursor + 1]),
                    pdf_hex_digit(content[cursor + 2]),
                ) {
                    (Some(high), Some(low)) => {
                        cursor += 3;
                        high * 16 + low
                    }
                    _ => {
                        cursor += 1;
                        b'#'
                    }
                }
            } else {
                let value = content[cursor];
                cursor += 1;
                value
            };
            if expected.get(decoded_length) != Some(&decoded) {
                matched = false;
            }
            decoded_length += 1;
        }
        if matched && decoded_length == expected.len() {
            return true;
        }
    }
    false
}

fn is_pdf_delimiter(value: u8) -> bool {
    matches!(
        value,
        0 | b'\t'
            | b'\n'
            | 0x0c
            | b'\r'
            | b' '
            | b'('
            | b')'
            | b'<'
            | b'>'
            | b'['
            | b']'
            | b'/'
            | b'%'
    )
}

fn pdf_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn filter_pdf_object_streams(
    object_id: (u32, u16),
    object: &mut pdf_extract::Object,
) -> Option<((u32, u16), pdf_extract::Object)> {
    if matches!(
        object,
        pdf_extract::Object::Stream(stream) if stream.dict.has_type(b"ObjStm")
    ) {
        *object = pdf_extract::Object::Name(b"YijieRejectedObjStm".to_vec());
    }
    Some((object_id, pdf_extract::Object::Null))
}

fn bounded_zlib_content(content: &[u8], limit: u64) -> Result<Vec<u8>, AttachmentImportError> {
    let mut decoder = ZlibDecoder::new(content).take(limit + 1);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    if decoded.len() as u64 > limit {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(decoded)
}

fn is_encoded_pdf_image(stream: &pdf_extract::Stream, filters: &[&[u8]]) -> bool {
    stream
        .dict
        .get(b"Subtype")
        .and_then(pdf_extract::Object::as_name)
        .is_ok_and(|name| name == b"Image")
        && matches!(
            filters,
            [b"DCTDecode"] | [b"JPXDecode"] | [b"CCITTFaxDecode"]
        )
}

fn compression_ratio_exceeded(compressed: u64, uncompressed: u64, maximum: u64) -> bool {
    uncompressed > compressed.saturating_mul(maximum)
}

fn extract_text_document(
    extension: &str,
    content: &[u8],
) -> Result<Detection, AttachmentImportError> {
    let raw = std::str::from_utf8(content).map_err(|_| AttachmentImportError::InvalidContent)?;
    if raw.chars().any(|character| character == '\0') {
        return Err(AttachmentImportError::InvalidContent);
    }
    let (media_type, text) = match extension {
        "txt" => ("text/plain", raw.to_owned()),
        "md" | "markdown" => ("text/markdown", raw.to_owned()),
        "csv" => ("text/csv", raw.to_owned()),
        "json" => {
            serde_json::from_str::<serde_json::Value>(raw)
                .map_err(|_| AttachmentImportError::InvalidContent)?;
            ("application/json", raw.to_owned())
        }
        "yaml" | "yml" => ("application/yaml", raw.to_owned()),
        "xml" => ("application/xml", extract_xml_text(raw.as_bytes())?),
        "html" | "htm" => ("text/html", strip_markup(raw)),
        "rtf" if raw.starts_with("{\\rtf") => ("application/rtf", strip_rtf(raw)),
        _ => return Err(AttachmentImportError::InvalidContent),
    };
    Ok(Detection {
        kind: AttachmentKind::File,
        media_type,
        extracted_text: Some(bounded_normalized_text(&text)?),
    })
}

fn extract_ooxml(
    extension: &str,
    content: &[u8],
) -> Result<(&'static str, String), AttachmentImportError> {
    let mut archive =
        ZipArchive::new(Cursor::new(content)).map_err(|_| AttachmentImportError::InvalidContent)?;
    let OoxmlPreflight {
        names,
        media_type,
        prefixes,
        mut actual_total_size,
    } = preflight_ooxml(extension, &mut archive)?;
    let mut selected = names
        .into_iter()
        .filter(|name| {
            name.ends_with(".xml") && prefixes.iter().any(|prefix| name.starts_with(prefix))
        })
        .collect::<Vec<_>>();
    selected.sort();
    let mut output = String::new();
    for name in selected {
        let xml = read_ooxml_entry(&mut archive, &name, &mut actual_total_size)?;
        let text = extract_xml_text(&xml)?;
        if !text.is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&text);
        }
        if output.len() >= MAX_EXTRACTED_TEXT_BYTES {
            break;
        }
    }
    Ok((media_type, bounded_normalized_text(&output)?))
}

pub(crate) fn validate_xlsx_artifact_content(content: &[u8]) -> Result<(), AttachmentImportError> {
    let mut archive =
        ZipArchive::new(Cursor::new(content)).map_err(|_| AttachmentImportError::InvalidContent)?;
    preflight_ooxml("xlsx", &mut archive).map(|_| ())
}

struct OoxmlPreflight {
    names: HashSet<String>,
    media_type: &'static str,
    prefixes: &'static [&'static str],
    actual_total_size: u64,
}

fn preflight_ooxml(
    extension: &str,
    archive: &mut ZipArchive<Cursor<&[u8]>>,
) -> Result<OoxmlPreflight, AttachmentImportError> {
    if archive.is_empty() || archive.len() > MAX_OOXML_ENTRIES {
        return Err(AttachmentImportError::InvalidContent);
    }
    let mut names = HashSet::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| AttachmentImportError::InvalidContent)?;
        let name = file.name().to_owned();
        validate_zip_name(&name)?;
        if !names.insert(name.clone())
            || file.size() > MAX_OOXML_ENTRY_BYTES
            || compression_ratio_exceeded(
                file.compressed_size(),
                file.size(),
                MAX_OOXML_COMPRESSION_RATIO,
            )
            || !matches!(
                file.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            return Err(AttachmentImportError::InvalidContent);
        }
        total_size = total_size
            .checked_add(file.size())
            .ok_or(AttachmentImportError::InvalidContent)?;
        if total_size > MAX_OOXML_UNCOMPRESSED_BYTES
            || name.to_ascii_lowercase().contains("vbaproject")
            || name.to_ascii_lowercase().ends_with(".bin")
        {
            return Err(AttachmentImportError::InvalidContent);
        }
    }
    if !names.contains("[Content_Types].xml") {
        return Err(AttachmentImportError::InvalidContent);
    }
    let (media_type, marker, main_content_type, prefixes): (&str, &str, &str, &[&str]) =
        match extension {
        "docx" => (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            &[
                "word/document.xml",
                "word/header",
                "word/footer",
                "word/footnotes.xml",
                "word/endnotes.xml",
            ],
        ),
        "xlsx" => (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            &["xl/sharedStrings.xml", "xl/worksheets/"],
        ),
        "pptx" => (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
            &["ppt/slides/", "ppt/notesSlides/"],
        ),
        _ => return Err(AttachmentImportError::Unsupported),
    };
    if !names.contains(marker) {
        return Err(AttachmentImportError::InvalidContent);
    }
    let mut actual_total_size = 0_u64;
    let content_types = read_ooxml_entry(archive, "[Content_Types].xml", &mut actual_total_size)?;
    validate_ooxml_main_content_type(&content_types, marker, main_content_type)?;
    Ok(OoxmlPreflight {
        names,
        media_type,
        prefixes,
        actual_total_size,
    })
}

fn read_ooxml_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    actual_total_size: &mut u64,
) -> Result<Vec<u8>, AttachmentImportError> {
    let mut file = archive
        .by_name(name)
        .map_err(|_| AttachmentImportError::InvalidContent)?;
    let declared_size = file.size();
    let compressed_size = file.compressed_size();
    let mut content = Vec::with_capacity(usize::try_from(declared_size).unwrap_or(0));
    file.by_ref()
        .take(MAX_OOXML_ENTRY_BYTES + 1)
        .read_to_end(&mut content)
        .map_err(|_| AttachmentImportError::ParseFailed)?;
    let actual_size =
        u64::try_from(content.len()).map_err(|_| AttachmentImportError::InvalidContent)?;
    *actual_total_size = actual_total_size
        .checked_add(actual_size)
        .ok_or(AttachmentImportError::InvalidContent)?;
    if actual_size != declared_size
        || actual_size > MAX_OOXML_ENTRY_BYTES
        || *actual_total_size > MAX_OOXML_UNCOMPRESSED_BYTES
        || compression_ratio_exceeded(compressed_size, actual_size, MAX_OOXML_COMPRESSION_RATIO)
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(content)
}

fn validate_ooxml_main_content_type(
    content: &[u8],
    marker: &str,
    expected_content_type: &str,
) -> Result<(), AttachmentImportError> {
    let expected_part_name = format!("/{marker}");
    let mut reader = Reader::from_reader(content);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.name().as_ref().ends_with(b"Override") =>
            {
                let mut part_name = None;
                let mut content_type = None;
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|_| AttachmentImportError::InvalidContent)?;
                    match attribute.key.as_ref() {
                        b"PartName" => part_name = Some(attribute.value.into_owned()),
                        b"ContentType" => content_type = Some(attribute.value.into_owned()),
                        _ => {}
                    }
                }
                if part_name.as_deref() == Some(expected_part_name.as_bytes())
                    && content_type.as_deref() == Some(expected_content_type.as_bytes())
                {
                    return Ok(());
                }
            }
            Ok(Event::Eof) => return Err(AttachmentImportError::InvalidContent),
            Err(_) => return Err(AttachmentImportError::InvalidContent),
            _ => {}
        }
    }
}

fn validate_zip_name(name: &str) -> Result<(), AttachmentImportError> {
    let path = Path::new(name);
    if name.is_empty()
        || name.contains('\\')
        || name.contains('\0')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AttachmentImportError::InvalidContent);
    }
    Ok(())
}

fn extract_xml_text(content: &[u8]) -> Result<String, AttachmentImportError> {
    let mut reader = Reader::from_reader(content);
    reader.config_mut().trim_text(true);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(text)) => {
                let decoded = text
                    .decode()
                    .map_err(|_| AttachmentImportError::ParseFailed)?;
                if !decoded.trim().is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(decoded.trim());
                }
            }
            Ok(Event::CData(text)) => {
                let decoded = text
                    .decode()
                    .map_err(|_| AttachmentImportError::ParseFailed)?;
                if !decoded.trim().is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(decoded.trim());
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AttachmentImportError::ParseFailed),
            _ => {}
        }
        if output.len() >= MAX_EXTRACTED_TEXT_BYTES {
            break;
        }
    }
    bounded_normalized_text(&output)
}

fn strip_markup(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
}

fn strip_rtf(value: &str) -> String {
    let mut output = String::new();
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '{' | '}' => output.push(' '),
            '\\' => {
                while characters
                    .peek()
                    .is_some_and(|value| value.is_ascii_alphabetic())
                {
                    characters.next();
                }
                while characters
                    .peek()
                    .is_some_and(|value| value.is_ascii_digit() || *value == '-')
                {
                    characters.next();
                }
                if characters.peek() == Some(&' ') {
                    characters.next();
                }
                output.push(' ');
            }
            _ => output.push(character),
        }
    }
    output
}

fn bounded_normalized_text(value: &str) -> Result<String, AttachmentImportError> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(AttachmentImportError::ParseFailed);
    }
    Ok(truncate_utf8(&normalized, MAX_EXTRACTED_TEXT_BYTES).to_owned())
}

fn chunk_text(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut remaining = value;
    while !remaining.is_empty() && chunks.len() < 128 {
        let piece = truncate_utf8(remaining, CHUNK_BYTES);
        if piece.is_empty() {
            break;
        }
        chunks.push(piece.to_owned());
        remaining = &remaining[piece.len()..];
    }
    chunks
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_extract::{Dictionary, Document, Object, Stream};
    use std::ffi::CString;
    use std::fs;
    use std::io::Write;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;
    use zip::write::SimpleFileOptions;

    fn test_pdf(content: Vec<u8>, compress_content: bool) -> Vec<u8> {
        test_pdf_with_xref(
            content,
            compress_content,
            pdf_extract::xref::XrefType::CrossReferenceTable,
        )
    }

    fn test_pdf_with_xref(
        content: Vec<u8>,
        compress_content: bool,
        xref_type: pdf_extract::xref::XrefType,
    ) -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        document.reference_table.cross_reference_type = xref_type;
        let pages_id = document.new_object_id();

        let mut font = Dictionary::new();
        font.set("Type", "Font");
        font.set("Subtype", "Type1");
        font.set("BaseFont", "Courier");
        let font_id = document.add_object(font);

        let mut fonts = Dictionary::new();
        fonts.set("F1", font_id);
        let mut resources = Dictionary::new();
        resources.set("Font", fonts);
        let resources_id = document.add_object(resources);

        let mut stream = Stream::new(Dictionary::new(), content);
        if compress_content {
            stream.compress().unwrap();
        }
        let content_id = document.add_object(stream);

        let mut page = Dictionary::new();
        page.set("Type", "Page");
        page.set("Parent", pages_id);
        page.set("Contents", content_id);
        let page_id = document.add_object(page);

        let mut pages = Dictionary::new();
        pages.set("Type", "Pages");
        pages.set("Kids", vec![Object::Reference(page_id)]);
        pages.set("Count", 1);
        pages.set("Resources", resources_id);
        pages.set(
            "MediaBox",
            vec![0_i32.into(), 0_i32.into(), 595_i32.into(), 842_i32.into()],
        );
        document.objects.insert(pages_id, Object::Dictionary(pages));

        let mut catalog = Dictionary::new();
        catalog.set("Type", "Catalog");
        catalog.set("Pages", pages_id);
        let catalog_id = document.add_object(catalog);
        document.trailer.set("Root", catalog_id);

        let mut output = Vec::new();
        document.save_to(&mut output).unwrap();
        output
    }

    fn test_pdf_with_shared_pages(content: Vec<u8>, page_count: usize) -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        document.reference_table.cross_reference_type =
            pdf_extract::xref::XrefType::CrossReferenceTable;
        let pages_id = document.new_object_id();
        let content_id = document.add_object(Stream::new(Dictionary::new(), content));
        let mut page_ids = Vec::with_capacity(page_count);
        for _ in 0..page_count {
            let mut page = Dictionary::new();
            page.set("Type", "Page");
            page.set("Parent", pages_id);
            page.set("Contents", content_id);
            page_ids.push(document.add_object(page));
        }
        let mut pages = Dictionary::new();
        pages.set("Type", "Pages");
        pages.set(
            "Kids",
            page_ids
                .into_iter()
                .map(Object::Reference)
                .collect::<Vec<_>>(),
        );
        pages.set("Count", i64::try_from(page_count).unwrap());
        pages.set(
            "MediaBox",
            vec![0_i32.into(), 0_i32.into(), 595_i32.into(), 842_i32.into()],
        );
        document.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", "Catalog");
        catalog.set("Pages", pages_id);
        let catalog_id = document.add_object(catalog);
        document.trailer.set("Root", catalog_id);
        let mut output = Vec::new();
        document.save_to(&mut output).unwrap();
        output
    }

    fn test_pdf_with_image_and_text() -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        document.reference_table.cross_reference_type =
            pdf_extract::xref::XrefType::CrossReferenceTable;
        let pages_id = document.new_object_id();

        let mut font = Dictionary::new();
        font.set("Type", "Font");
        font.set("Subtype", "Type1");
        font.set("BaseFont", "Courier");
        let font_id = document.add_object(font);

        let mut image = Dictionary::new();
        image.set("Type", "XObject");
        image.set("Subtype", "Image");
        image.set("Width", 2);
        image.set("Height", 2);
        image.set("ColorSpace", "DeviceRGB");
        image.set("BitsPerComponent", 8);
        image.set("Filter", "DCTDecode");
        let image_id = document.add_object(Stream::new(image, test_image_bytes("jpg")));

        let mut fonts = Dictionary::new();
        fonts.set("F1", font_id);
        let mut xobjects = Dictionary::new();
        xobjects.set("Im0", image_id);
        let mut resources = Dictionary::new();
        resources.set("Font", fonts);
        resources.set("XObject", xobjects);
        let resources_id = document.add_object(resources);

        let content_id = document.add_object(Stream::new(
            Dictionary::new(),
            b"q 2 0 0 2 72 700 cm /Im0 Do Q BT /F1 12 Tf 72 720 Td (image pdf text) Tj ET".to_vec(),
        ));
        let mut page = Dictionary::new();
        page.set("Type", "Page");
        page.set("Parent", pages_id);
        page.set("Contents", content_id);
        let page_id = document.add_object(page);

        let mut pages = Dictionary::new();
        pages.set("Type", "Pages");
        pages.set("Kids", vec![Object::Reference(page_id)]);
        pages.set("Count", 1);
        pages.set("Resources", resources_id);
        pages.set(
            "MediaBox",
            vec![0_i32.into(), 0_i32.into(), 595_i32.into(), 842_i32.into()],
        );
        document.objects.insert(pages_id, Object::Dictionary(pages));

        let mut catalog = Dictionary::new();
        catalog.set("Type", "Catalog");
        catalog.set("Pages", pages_id);
        let catalog_id = document.add_object(catalog);
        document.trailer.set("Root", catalog_id);

        let mut output = Vec::new();
        document.save_to(&mut output).unwrap();
        output
    }

    fn test_pdf_with_form_chain(form_count: usize, self_cycle: bool) -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        document.reference_table.cross_reference_type =
            pdf_extract::xref::XrefType::CrossReferenceTable;
        let pages_id = document.new_object_id();

        let root_form_id = if self_cycle {
            let form_id = document.new_object_id();
            let mut xobjects = Dictionary::new();
            xobjects.set("Loop", form_id);
            let mut resources = Dictionary::new();
            resources.set("XObject", xobjects);
            let mut form = Dictionary::new();
            form.set("Type", "XObject");
            form.set("Subtype", "Form");
            form.set("Resources", resources);
            form.set(
                "BBox",
                vec![0_i32.into(), 0_i32.into(), 10_i32.into(), 10_i32.into()],
            );
            document.set_object(form_id, Stream::new(form, b"/Loop Do".to_vec()));
            form_id
        } else {
            let mut child = None;
            for _ in 0..form_count {
                let mut form = Dictionary::new();
                form.set("Type", "XObject");
                form.set("Subtype", "Form");
                form.set(
                    "BBox",
                    vec![0_i32.into(), 0_i32.into(), 10_i32.into(), 10_i32.into()],
                );
                let content = if let Some(child_id) = child {
                    let mut xobjects = Dictionary::new();
                    xobjects.set("Next", child_id);
                    let mut resources = Dictionary::new();
                    resources.set("XObject", xobjects);
                    form.set("Resources", resources);
                    b"/Next Do".to_vec()
                } else {
                    b"q Q".to_vec()
                };
                child = Some(document.add_object(Stream::new(form, content)));
            }
            child.unwrap()
        };

        let mut xobjects = Dictionary::new();
        xobjects.set("RootForm", root_form_id);
        let mut resources = Dictionary::new();
        resources.set("XObject", xobjects);
        let resources_id = document.add_object(resources);
        let content_id =
            document.add_object(Stream::new(Dictionary::new(), b"/RootForm Do".to_vec()));
        let mut page = Dictionary::new();
        page.set("Type", "Page");
        page.set("Parent", pages_id);
        page.set("Contents", content_id);
        let page_id = document.add_object(page);
        let mut pages = Dictionary::new();
        pages.set("Type", "Pages");
        pages.set("Kids", vec![Object::Reference(page_id)]);
        pages.set("Count", 1);
        pages.set("Resources", resources_id);
        pages.set(
            "MediaBox",
            vec![0_i32.into(), 0_i32.into(), 595_i32.into(), 842_i32.into()],
        );
        document.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", "Catalog");
        catalog.set("Pages", pages_id);
        let catalog_id = document.add_object(catalog);
        document.trailer.set("Root", catalog_id);
        let mut output = Vec::new();
        document.save_to(&mut output).unwrap();
        output
    }

    fn forge_zip_central_uncompressed_size(content: &mut [u8], name: &[u8], size: u32) {
        let mut cursor = 0_usize;
        while cursor + 46 <= content.len() {
            if content.get(cursor..cursor + 4) != Some(b"PK\x01\x02") {
                cursor += 1;
                continue;
            }
            let name_length =
                u16::from_le_bytes([content[cursor + 28], content[cursor + 29]]) as usize;
            let extra_length =
                u16::from_le_bytes([content[cursor + 30], content[cursor + 31]]) as usize;
            let comment_length =
                u16::from_le_bytes([content[cursor + 32], content[cursor + 33]]) as usize;
            let name_start = cursor + 46;
            let name_end = name_start + name_length;
            if content.get(name_start..name_end) == Some(name) {
                content[cursor + 24..cursor + 28].copy_from_slice(&size.to_le_bytes());
                return;
            }
            cursor = name_end + extra_length + comment_length;
        }
        panic!("central directory entry not found");
    }

    fn test_ooxml(extension: &str, text: &str) -> Vec<u8> {
        let (marker, text_part, main_content_type, marker_xml, text_xml) = match extension {
            "docx" => (
                "word/document.xml",
                "word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                String::new(),
                format!("<w:document xmlns:w='urn:w'><w:t>{text}</w:t></w:document>"),
            ),
            "xlsx" => (
                "xl/workbook.xml",
                "xl/worksheets/sheet1.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                "<workbook xmlns='urn:sheet'/>".to_owned(),
                format!("<worksheet xmlns='urn:sheet'><t>{text}</t></worksheet>"),
            ),
            "pptx" => (
                "ppt/presentation.xml",
                "ppt/slides/slide1.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
                "<p:presentation xmlns:p='urn:presentation'/>".to_owned(),
                format!("<p:sld xmlns:p='urn:presentation'><a:t xmlns:a='urn:drawing'>{text}</a:t></p:sld>"),
            ),
            _ => panic!("unsupported OOXML fixture extension"),
        };
        test_ooxml_with_content_type(marker, text_part, main_content_type, &marker_xml, &text_xml)
    }

    fn test_ooxml_with_content_type(
        marker: &str,
        text_part: &str,
        main_content_type: &str,
        marker_xml: &str,
        text_xml: &str,
    ) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut output);
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            writer.start_file("[Content_Types].xml", options).unwrap();
            writer
                .write_all(
                    format!(
                        "<Types><Override PartName='/{marker}' ContentType='{main_content_type}'/></Types>"
                    )
                    .as_bytes(),
                )
                .unwrap();
            if marker != text_part {
                writer.start_file(marker, options).unwrap();
                writer.write_all(marker_xml.as_bytes()).unwrap();
            }
            writer.start_file(text_part, options).unwrap();
            writer.write_all(text_xml.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        output.into_inner()
    }

    #[test]
    fn image_magic_and_extension_must_agree_at_the_exact_size_boundary() {
        let png = test_image_bytes("png");
        let image = prepare_bytes("sample.png".to_owned(), png.clone(), 10).expect("image");
        assert_eq!(image.kind, AttachmentKind::Image);
        assert_eq!(image.media_type, "image/png");
        assert!(prepare_bytes("sample.jpg".to_owned(), png, 10).is_err());
        assert_eq!(
            prepare_bytes(
                "large.txt".to_owned(),
                vec![b'a'; MAX_ATTACHMENT_BYTES + 1],
                10
            ),
            Err(AttachmentImportError::TooLarge)
        );
    }

    #[test]
    fn every_supported_text_format_is_parsed_with_its_declared_media_type() {
        for (name, content, media_type, marker) in [
            ("notes.txt", "plain alpha", "text/plain", "plain alpha"),
            (
                "notes.md",
                "# markdown alpha",
                "text/markdown",
                "markdown alpha",
            ),
            (
                "notes.markdown",
                "markdown alias",
                "text/markdown",
                "markdown alias",
            ),
            ("rows.csv", "name,value\nalpha,1", "text/csv", "alpha,1"),
            ("data.json", "{\"alpha\":1}", "application/json", "alpha"),
            ("data.yaml", "alpha: 1", "application/yaml", "alpha: 1"),
            ("data.yml", "alpha: 2", "application/yaml", "alpha: 2"),
            (
                "data.xml",
                "<root><value>xml alpha</value></root>",
                "application/xml",
                "xml alpha",
            ),
            ("page.html", "<p>html alpha</p>", "text/html", "html alpha"),
            ("page.htm", "<p>html alias</p>", "text/html", "html alias"),
            (
                "copy.rtf",
                "{\\rtf1\\ansi rtf alpha}",
                "application/rtf",
                "rtf alpha",
            ),
        ] {
            let attachment = prepare_bytes(name.to_owned(), content.as_bytes().to_vec(), 10)
                .unwrap_or_else(|error| panic!("{name} should parse: {error:?}"));
            assert_eq!(attachment.kind, AttachmentKind::File, "{name}");
            assert_eq!(attachment.media_type, media_type, "{name}");
            assert!(attachment.chunks.join(" ").contains(marker), "{name}");
        }

        for (name, content) in [
            ("bad.json", b"{not-json".as_slice()),
            ("bad.xml", b"<root>".as_slice()),
            ("bad.rtf", b"plain text with rtf extension".as_slice()),
            ("nul.txt", b"alpha\0beta".as_slice()),
            ("utf8.txt", &[0xff, 0xfe][..]),
        ] {
            assert!(
                prepare_bytes(name.to_owned(), content.to_vec(), 10).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn filesystem_boundary_accepts_exactly_ten_mib_and_rejects_oversize_and_non_regular_files() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-paths-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let exact = root.join("exact.txt");
        fs::write(&exact, vec![b'a'; MAX_ATTACHMENT_BYTES]).unwrap();
        let exact_attachment = prepare_paths(vec![exact.clone()], 10, 1).expect("exact limit");
        assert_eq!(exact_attachment[0].byte_size, MAX_ATTACHMENT_BYTES);

        let oversized = root.join("oversized.txt");
        fs::write(&oversized, vec![b'a'; MAX_ATTACHMENT_BYTES + 1]).unwrap();
        assert_eq!(
            prepare_paths(vec![oversized], 10, 1),
            Err(AttachmentImportError::TooLarge)
        );

        let directory = root.join("directory.txt");
        fs::create_dir(&directory).unwrap();
        assert!(prepare_paths(vec![directory], 10, 1).is_err());

        let link = root.join("link.txt");
        symlink(&exact, &link).unwrap();
        assert!(prepare_paths(vec![link], 10, 1).is_err());

        let fifo = root.join("fifo.txt");
        let fifo_path = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: fifo_path is a valid, NUL-terminated path owned for the duration of the call.
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
        assert!(prepare_paths(vec![fifo], 10, 1).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_preparation_reports_minimal_ordered_batch_stages_and_a_terminal_failure() {
        let root = std::env::temp_dir().join(format!("yijie-feat127-progress-{}", Uuid::now_v7()));
        fs::create_dir(&root).unwrap();
        let first = root.join("first.txt");
        let second = root.join("second.csv");
        fs::write(&first, "first context").unwrap();
        fs::write(&second, "name,value\nsecond,2").unwrap();
        let mut progress = Vec::new();
        let prepared = prepare_paths_with_progress(vec![first, second], 10, 2, |event| {
            progress.push((event.stage, event.item_count, event.issue));
            Ok(())
        })
        .unwrap();
        assert_eq!(prepared.len(), 2);
        assert_eq!(
            progress,
            vec![
                (AttachmentPreparationStage::Queued, 2, None),
                (AttachmentPreparationStage::Importing, 2, None),
                (AttachmentPreparationStage::Parsing, 2, None),
                (AttachmentPreparationStage::Indexing, 2, None),
            ]
        );

        let archive = root.join("blocked.zip");
        fs::write(&archive, b"PK\x03\x04synthetic").unwrap();
        let mut failed = Vec::new();
        assert_eq!(
            prepare_paths_with_progress(vec![archive], 10, 1, |event| {
                failed.push((event.stage, event.issue));
                Ok(())
            }),
            Err(AttachmentImportError::ArchiveUnsupported)
        );
        assert_eq!(
            failed,
            vec![
                (AttachmentPreparationStage::Queued, None),
                (AttachmentPreparationStage::Importing, None),
                (AttachmentPreparationStage::Parsing, None),
                (
                    AttachmentPreparationStage::ErrorTerminal,
                    Some("archive_unsupported")
                ),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_decoding_is_bounded_and_rejects_truncated_magic_only_payloads() {
        for (extension, media_type) in [
            ("jpg", "image/jpeg"),
            ("png", "image/png"),
            ("webp", "image/webp"),
            ("gif", "image/gif"),
        ] {
            let encoded = test_image_bytes(extension);
            let image = prepare_bytes(format!("valid.{extension}"), encoded.clone(), 10)
                .expect("valid decoded image");
            assert_eq!(image.media_type, media_type);
            assert_eq!(
                prepare_bytes(
                    format!("truncated.{extension}"),
                    encoded[..encoded.len() - 1].to_vec(),
                    10,
                ),
                Err(AttachmentImportError::InvalidContent),
            );
        }
        assert_eq!(
            prepare_bytes(
                "fake.png".to_owned(),
                vec![
                    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, b'I', b'E', b'N',
                    b'D',
                ],
                10,
            ),
            Err(AttachmentImportError::InvalidContent),
        );
    }

    #[test]
    fn text_is_bounded_chunked_and_archive_extensions_are_rejected() {
        let text = prepare_bytes("notes.md".to_owned(), b"alpha beta gamma".to_vec(), 20)
            .expect("markdown");
        assert_eq!(text.kind, AttachmentKind::File);
        assert_eq!(text.chunks, vec!["alpha beta gamma"]);
        assert_eq!(text.expires_at, 20 + ATTACHMENT_TTL_SECONDS);
        assert_eq!(
            prepare_bytes("payload.zip".to_owned(), b"PK\x03\x04payload".to_vec(), 20),
            Err(AttachmentImportError::ArchiveUnsupported)
        );
    }

    #[test]
    fn parse_and_index_are_separate_bounded_stages() {
        let parsed = parse_imported(vec![ImportedAttachment {
            safe_name: "context-marker.txt".to_owned(),
            content: b"Context verification code: ALPHA-7319".to_vec(),
        }])
        .expect("parse stage");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].detected.media_type, "text/plain");

        let indexed = index_parsed(parsed, 20).expect("index stage");
        assert_eq!(indexed.len(), 1);
        assert_eq!(
            indexed[0].chunks,
            vec!["Context verification code: ALPHA-7319"]
        );
        assert_eq!(indexed[0].expires_at, 20 + ATTACHMENT_TTL_SECONDS);
    }

    #[test]
    fn pdf_preflight_accepts_small_text_and_rejects_high_ratio_streams() {
        let valid = test_pdf(
            b"BT /F1 12 Tf 72 720 Td (hello bounded pdf) Tj ET".to_vec(),
            false,
        );
        assert!(preflight_pdf(&valid).is_ok());
        assert!(validate_pdf_artifact_content(&valid).is_ok());
        let document = prepare_bytes("brief.pdf".to_owned(), valid, 20).expect("bounded PDF");
        assert_eq!(document.chunks, vec!["hello bounded pdf"]);

        let bomb = test_pdf(b"q ".repeat(512 * 1024), true);
        assert_eq!(
            prepare_bytes("compressed.pdf".to_owned(), bomb, 20),
            Err(AttachmentImportError::InvalidContent)
        );
        assert!(contains_pdf_name(b"<< /Type /Obj#53tm >>", b"ObjStm"));
        assert!(contains_pdf_name(b"<< /Encrypt 9 0 R >>", b"Encrypt"));
        assert!(!contains_pdf_name(b"xref\n0 1", b"XRef"));
    }

    #[test]
    fn pdf_with_image_and_text_is_sanitized_and_extracts_text() {
        let document = prepare_bytes(
            "image-and-text.pdf".to_owned(),
            test_pdf_with_image_and_text(),
            20,
        )
        .expect("PDF with an image should remain importable");
        assert_eq!(document.chunks, vec!["image pdf text"]);
    }

    #[test]
    fn pdf_accepts_bounded_forms_and_rejects_xref_cycles_depth_and_reference_amplification() {
        let mut xref_stream = test_pdf_with_xref(
            b"q Q".to_vec(),
            false,
            pdf_extract::xref::XrefType::CrossReferenceStream,
        );
        if let Some(position) = xref_stream
            .windows(b"/Type/XRef".len())
            .position(|value| value == b"/Type/XRef")
        {
            xref_stream[position..position + b"/Type/XRef".len()].fill(b' ');
        }
        assert_eq!(
            prepare_bytes("xref.pdf".to_owned(), xref_stream, 20),
            Err(AttachmentImportError::InvalidContent)
        );

        assert_eq!(
            prepare_bytes(
                "recursive.pdf".to_owned(),
                test_pdf_with_form_chain(1, true),
                20,
            ),
            Err(AttachmentImportError::InvalidContent)
        );
        assert!(preflight_pdf(&test_pdf_with_form_chain(MAX_PDF_FORM_DEPTH, false,)).is_ok());
        assert_eq!(
            prepare_bytes(
                "deep.pdf".to_owned(),
                test_pdf_with_form_chain(MAX_PDF_FORM_DEPTH + 1, false),
                20,
            ),
            Err(AttachmentImportError::InvalidContent)
        );

        let per_page = MAX_PDF_EXPANDED_STREAM_BYTES as usize / MAX_PDF_PAGES + 1024;
        let mut content = vec![b'a'; per_page];
        content[0] = b'%';
        content.push(b'\n');
        let shared = test_pdf_with_shared_pages(content, MAX_PDF_PAGES);
        assert_eq!(
            prepare_bytes("shared.pdf".to_owned(), shared, 20),
            Err(AttachmentImportError::InvalidContent)
        );
    }

    #[test]
    fn pdf_text_output_stops_at_the_extracted_text_limit() {
        const TEST_LIMIT: usize = 4 * 1024;
        let content = format!(
            "BT /F1 12 Tf 72 720 Td ({}) Tj ET",
            "a".repeat(TEST_LIMIT * 2)
        );
        let pdf = test_pdf(content.into_bytes(), false);
        let document = preflight_pdf(&pdf).expect("bounded PDF preflight");
        let extracted = extract_pdf_document(&document, TEST_LIMIT).expect("bounded PDF output");
        assert!(!extracted.is_empty());
        assert!(extracted.len() <= TEST_LIMIT);
    }

    #[test]
    fn over_capacity_batches_are_rejected_before_any_path_is_opened() {
        let missing = PathBuf::from("/definitely/not/a/real/attachment.txt");
        assert_eq!(
            prepare_paths(vec![missing.clone(), missing], 20, 1),
            Err(AttachmentImportError::TooMany)
        );
        assert_eq!(
            prepare_paths(Vec::new(), 20, MAX_ATTACHMENTS_PER_MESSAGE),
            Err(AttachmentImportError::TooMany)
        );
        assert_eq!(
            prepare_paths(vec![PathBuf::from("/missing.txt")], 20, 0),
            Err(AttachmentImportError::TooMany)
        );
    }

    #[test]
    fn ooxml_requires_matching_content_types_and_accepts_docx_xlsx_and_pptx() {
        for extension in ["docx", "xlsx", "pptx"] {
            let marker = format!("hello {extension}");
            let document = prepare_bytes(
                format!("brief.{extension}"),
                test_ooxml(extension, &marker),
                30,
            )
            .unwrap_or_else(|error| panic!("{extension} should parse: {error:?}"));
            assert_eq!(document.chunks, vec![marker]);
        }

        assert_eq!(
            prepare_bytes(
                "mismatch.xlsx".to_owned(),
                test_ooxml("docx", "wrong kind"),
                30
            ),
            Err(AttachmentImportError::InvalidContent)
        );
        let wrong_declaration = test_ooxml_with_content_type(
            "word/document.xml",
            "word/document.xml",
            "application/vnd.ms-word.document.macroEnabled.main+xml",
            "",
            "<w:document xmlns:w='urn:w'><w:t>macro declaration</w:t></w:document>",
        );
        assert_eq!(
            prepare_bytes("declared.docx".to_owned(), wrong_declaration, 30),
            Err(AttachmentImportError::InvalidContent)
        );

        let mut invalid = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut invalid);
            let options = SimpleFileOptions::default();
            writer.start_file("[Content_Types].xml", options).unwrap();
            writer.write_all(b"<Types><Override PartName='/word/document.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'/></Types>").unwrap();
            writer.start_file("word/document.xml", options).unwrap();
            writer
                .write_all(b"<w:document xmlns:w='urn:w'><w:t>visible</w:t></w:document>")
                .unwrap();
            writer.start_file("../word/document.xml", options).unwrap();
            writer.write_all(b"<w:t>hidden</w:t>").unwrap();
            writer.finish().unwrap();
        }
        assert!(prepare_bytes("bad.docx".to_owned(), invalid.into_inner(), 30).is_err());

        let compressed_bomb = test_ooxml("docx", &"x".repeat(512 * 1024));
        assert_eq!(
            prepare_bytes("compressed.docx".to_owned(), compressed_bomb, 30),
            Err(AttachmentImportError::InvalidContent)
        );

        let mut forged = test_ooxml("docx", "forged size");
        forge_zip_central_uncompressed_size(&mut forged, b"word/document.xml", 1);
        assert_eq!(
            prepare_bytes("forged.docx".to_owned(), forged, 30),
            Err(AttachmentImportError::InvalidContent)
        );

        let xlsx = test_ooxml("xlsx", "validated without extraction");
        assert!(validate_xlsx_artifact_content(&xlsx).is_ok());
        assert!(validate_xlsx_artifact_content(&test_ooxml("docx", "wrong package")).is_err());
    }
}
