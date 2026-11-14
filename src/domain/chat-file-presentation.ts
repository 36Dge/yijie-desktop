import type { YjIconName as IconName } from "../icons/registry";

export type AttachmentPresentation = Readonly<{ sourcePath: string | null; imageUrl: string | null; expiresAt: number }>;
export type AttachmentPresentationReader = ((id: string, signal?: AbortSignal) => Promise<AttachmentPresentation>) & {
  peek?: (id: string) => AttachmentPresentation | null;
  invalidate?: (id: string) => void;
};
export function chatDocumentIcon(mime: string, name = ""): IconName {
  if (!mime && name) {
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const byExtension: Record<string, IconName> = { md: "documentMarkdown", markdown: "documentMarkdown", docx: "documentWord", rtf: "documentWord", pptx: "documentPresentation", xlsx: "documentSpreadsheet", csv: "documentSpreadsheet", pdf: "documentPdf", txt: "documentText", html: "documentCode", htm: "documentCode", json: "documentCode", yaml: "documentCode", yml: "documentCode", xml: "documentCode" };
    return byExtension[extension] ?? "document";
  }
  switch (mime) {
    case "text/markdown": return "documentMarkdown";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/rtf": return "documentWord";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "documentPresentation";
    case "text/csv":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "documentSpreadsheet";
    case "application/pdf": return "documentPdf";
    case "text/plain": return "documentText";
    case "text/html":
    case "application/json":
    case "application/vnd.yijie.report+json;version=1":
    case "application/xml":
    case "application/yaml": return "documentCode";
    default: return "document";
  }
}
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
