import type { YjIconName as IconName } from "../icons/registry";

export type AttachmentPresentation = Readonly<{ sourcePath: string | null; imageUrl: string | null; expiresAt: number }>;
export type AttachmentPresentationReader = (id: string) => Promise<AttachmentPresentation>;
export function chatFilePresentation(mime: string): { icon: IconName; label: string; tone: string; image: boolean } {
  const rows: Record<string, [IconName, string, string]> = {
    "text/csv": ["fileCsv", "CSV", "success"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["fileCsv", "XLSX", "success"],
    "application/json": ["fileHtml", "JSON", "muted"],
    "application/yaml": ["fileTxt", "YAML", "muted"],
    "application/xml": ["fileHtml", "XML", "muted"],
    "application/rtf": ["fileDocx", "RTF", "muted"],
    "image/webp": ["fileImage", "WebP", "info"],
    "image/gif": ["fileImage", "GIF", "info"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["fileDocx", "DOCX", "brand"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["filePptx", "PPTX", "warning"],
    "text/markdown": ["fileMarkdown", "Markdown", "info"],
    "text/plain": ["fileTxt", "TXT", "muted"],
    "image/jpeg": ["fileJpeg", "JPEG", "info"],
    "image/png": ["filePng", "PNG", "info"],
    "image/svg+xml": ["fileSvg", "SVG", "brand"],
    "text/html": ["fileHtml", "HTML", "brand"],
    "application/pdf": ["filePdf", "PDF", "error"],
    "video/mp4": ["fileVideo", "MP4", "brand"],
  };
  const [icon, label, tone] = rows[mime] ?? [mime.startsWith("image/") ? "fileImage" : "file", mime.startsWith("image/") ? "图片" : "文件", "muted"];
  return { icon, label, tone, image: mime.startsWith("image/") };
}
export function fileNameParts(name: string): { stem: string; extension: string } {
  const index = name.lastIndexOf(".");
  return index > 0 ? { stem: name.slice(0, index), extension: name.slice(index) } : { stem: name, extension: "" };
}
