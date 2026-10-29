import { describe, expect, it } from "vitest";
import { addPreviewTab, closePreviewTab, isSidebarFile, openPreviewFile, previewWidths, previewFailure, type PreviewFile, type PreviewTabs } from "./conversation-file-preview";
const file = (id: string): PreviewFile => ({ source: { kind: "artifact", sessionId: "s", turnId: "t", artifactId: id }, name: "same.html", mediaType: "text/html", status: "ready", expiresAt: null });
const blank = (): PreviewTabs => ({ tabs: [], activeId: null });
describe("FEAT-166 conversation preview rules", () => {
  it("deduplicates by binding identity, uses active/rightmost empty tabs, and retains same-name distinct files", () => {
    const s = blank(); let count = 0; const id = () => String(++count);
    const first = openPreviewFile(s, file("one"), id)!;
    const empty1 = addPreviewTab(s, id)!; const empty2 = addPreviewTab(s, id)!;
    s.activeId = first.id;
    expect(openPreviewFile(s, file("two"), id)?.id).toBe(empty2.id);
    expect(openPreviewFile(s, file("one"), id)).toBe(first);
    s.activeId = empty1.id;
    expect(openPreviewFile(s, file("three"), id)?.id).toBe(empty1.id);
    expect(s.tabs).toHaveLength(3);
  });
  it("counts empty tabs towards the ten-tab limit without changing state on overflow", () => {
    const s = blank(); let n = 0; const id = () => String(++n);
    for (let i = 0; i < 10; i++) openPreviewFile(s, file(String(i)), id);
    const before = JSON.stringify(s);
    expect(addPreviewTab(s, id)).toBeNull(); expect(openPreviewFile(s, file("eleven"), id)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
    expect(openPreviewFile(s, file("0"), id)?.id).toBe("1");
  });
  it("closes active tabs to the right then left, and keeps the empty workspace possible", () => {
    const s = blank(); let n = 0; const id = () => String(++n);
    for (let i = 0; i < 3; i++) addPreviewTab(s, id);
    s.activeId = "2"; closePreviewTab(s, "2"); expect(s.activeId).toBe("3");
    closePreviewTab(s, "1"); expect(s.activeId).toBe("3");
    closePreviewTab(s, "3"); expect(s).toEqual(blank());
  });
  it("distinguishes bound attachments from artifacts with matching ids", () => {
    const s = blank(); const a = file("same"); openPreviewFile(s, a, () => "1");
    openPreviewFile(s, { ...a, source: { kind: "attachment", sessionId: "s", messageId: "m", attachmentId: "same" } }, () => "2");
    expect(s.tabs).toHaveLength(2);
    openPreviewFile(s, { ...a, source: { kind: "attachment", sessionId: "s", messageId: null, attachmentId: "same" } }, () => "3");
    expect(s.tabs).toHaveLength(2);
  });
  it.each([[800,false,0],[801,true,400],[940,true,539],[1028,true,616],[1108,true,664],[2400,true,1200]])("width %s respects both columns", (width, available, right) => {
    const g = previewWidths(Number(width)); expect(g.available).toBe(available); expect(g.right).toBe(right);
    if (g.available) { expect(g.chat).toBeGreaterThanOrEqual(400); expect(g.chat + g.right + 1).toBe(width); }
  });
  it("clamps a preference without rewriting it and resets to default", () => {
    expect(previewWidths(2000,1000).right).toBe(1000);
    expect(previewWidths(940,1000).right).toBe(539);
    expect(previewWidths(2000,1000).right).toBe(1000);
    expect(previewWidths(2000).right).toBe(1199);
  });
  it.each([["image/png","a.bin"],["video/mp4","a.bin"],["text/plain","figure.SVG"],["","movie.mov"]])("excludes media %s/%s from the sidebar", (mime,name) => expect(isSidebarFile(mime,name)).toBe(false));
  it("allows actual non-media files and makes integrity failures nonretryable", () => {
    expect(isSidebarFile("application/pdf","a.pdf")).toBe(true);
    expect(previewFailure("artifact_native_integrity_failed").retryable).toBe(false);
    expect(previewFailure("artifact_native_conflict").retryable).toBe(true);
  });
});
