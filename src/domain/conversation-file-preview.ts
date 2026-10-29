import type { Location, Source } from "./document-preview.generated";

export const MAX_PREVIEW_TABS = 10;
export const MIN_PREVIEW_WORKSPACE = 801;
export type PreviewFile = Readonly<{ source: Source; name: string; mediaType: string; status: string; expiresAt: number | null }>;
export type PreviewTab = { id: string; file: PreviewFile | null; location: Location };
export type PreviewTabs = { tabs: PreviewTab[]; activeId: string | null };
export const defaultPreviewLocation = (): Location => ({ section: 0, offset: 0, zoom: 1, scrollX: 0, scrollY: 0, revision: null });
export function previewFileKey(file: PreviewFile): string {
  const s = file.source;
  return s.kind === "artifact" ? [s.kind, s.sessionId, s.turnId, s.artifactId].join(":") : [s.kind, s.sessionId, s.attachmentId].join(":");
}
export function isSidebarFile(mediaType: string, name = ""): boolean {
  return !mediaType.toLowerCase().startsWith("image/") && !mediaType.toLowerCase().startsWith("video/") && !/\.(?:svgz?|png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|ico|apng|mp4|mov|webm|m4v|mkv|avi|mpeg|mpg|wmv|flv|ogv|m2ts)$/iu.test(name.trim());
}
export function openPreviewFile(state: PreviewTabs, file: PreviewFile, id: () => string): PreviewTab | null {
  const existing = state.tabs.find(t => t.file && previewFileKey(t.file) === previewFileKey(file));
  if (existing) { existing.file = file; state.activeId = existing.id; return existing; }
  const current = state.tabs.find(t => t.id === state.activeId && !t.file);
  const empty = current ?? [...state.tabs].reverse().find(t => !t.file);
  if (empty) { empty.file = file; empty.location = defaultPreviewLocation(); state.activeId = empty.id; return empty; }
  if (state.tabs.length >= MAX_PREVIEW_TABS) return null;
  const tab = { id: id(), file, location: defaultPreviewLocation() };
  state.tabs.push(tab); state.activeId = tab.id; return tab;
}
export function addPreviewTab(state: PreviewTabs, id: () => string): PreviewTab | null {
  if (state.tabs.length >= MAX_PREVIEW_TABS) return null;
  const tab = { id: id(), file: null, location: defaultPreviewLocation() };
  state.tabs.push(tab); state.activeId = tab.id; return tab;
}
export function closePreviewTab(state: PreviewTabs, id: string): void {
  const index = state.tabs.findIndex(t => t.id === id);
  if (index < 0) return;
  state.tabs.splice(index, 1);
  if (state.activeId === id) state.activeId = state.tabs[index]?.id ?? state.tabs[index - 1]?.id ?? null;
}
export function previewWidths(width: number, preferred: number | null = null): { available: boolean; min: number; max: number; right: number; chat: number } {
  if (!Number.isFinite(width) || width < MIN_PREVIEW_WORKSPACE) return { available: false, min: 400, max: 400, right: 0, chat: Math.max(0, width || 0) };
  const available = width - 1;
  const max = Math.min(1200, Math.floor(0.7 * available), available - 400);
  const right = Math.max(400, Math.min(max, preferred ?? Math.round(0.6 * available)));
  return { available: true, min: 400, max, right, chat: available - right };
}

export function previewFailure(code: string): Readonly<{ text: string; retryable: boolean }> {
  switch (code) {
    case "artifact_native_unauthenticated": case "artifact_native_forbidden": return { text: "暂无权限预览此文件", retryable: false };
    case "artifact_native_not_found": return { text: "文件暂不可用", retryable: false };
    case "artifact_native_expired": return { text: "文件或预览会话已过期，请重新打开文件", retryable: false };
    case "artifact_native_integrity_failed": return { text: "文件校验失败，无法预览", retryable: false };
    case "artifact_native_limit_exceeded": return { text: "内容超出本次预览资源限制", retryable: false };
    case "artifact_native_not_ready": return { text: "文件尚未准备完成", retryable: false };
    case "artifact_native_unsupported": return { text: "此文件暂不支持内容预览", retryable: false };
    case "artifact_native_conflict": return { text: "预览资源忙，请稍后重新加载", retryable: true };
    case "preview_timeout": return { text: "预览加载超时，请重新加载", retryable: true };
    default: return { text: "预览暂时不可用，请重新加载", retryable: true };
  }
}
