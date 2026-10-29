import { invoke } from "@tauri-apps/api/core";
import type { Action, Document, Request, Result, Response } from "../domain/document-preview.generated";

export class DocumentPreviewError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DocumentPreviewError"; }
}
type Invoker = (command: string, args: Record<string, unknown>) => Promise<unknown>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentPreviewError("artifact_native_unavailable");
  return value as Record<string, unknown>;
}
function document(value: unknown): Document | null {
  if (value === null) return null;
  const d = object(value);
  if (!["html", "text", "docx", "pptx", "xlsx", "pdf"].includes(String(d.kind)) || typeof d.revision !== "string" || !/^[a-f0-9]{64}$/.test(d.revision) || !Number.isSafeInteger(d.expiresAt) || Number(d.expiresAt) <= 0 || !Array.isArray(d.sections) || d.sections.length > 512 || typeof d.partial !== "boolean" || (d.notice !== null && (typeof d.notice !== "string" || d.notice.length > 512))) throw new DocumentPreviewError("artifact_native_unavailable");
  for (const key of ["section", "offset", "nextOffset", "previousOffset"]) {
    if ((key === "nextOffset" || key === "previousOffset") && d[key] === null) continue;
    if (!Number.isSafeInteger(d[key]) || Number(d[key]) < 0) throw new DocumentPreviewError("artifact_native_unavailable");
  }
  for (const value of d.sections) { const section = object(value); if (!Number.isSafeInteger(section.id) || Number(section.id) < 0 || typeof section.label !== "string" || section.label.length > 255) throw new DocumentPreviewError("artifact_native_unavailable"); }
  return d as Document;
}
export function parseDocumentPreviewResponse(value: unknown, requestId: string, viewId: string): Result {
  const response = object(value);
  if (response.schemaVersion !== 1 || response.requestId !== requestId) throw new DocumentPreviewError("artifact_native_unavailable");
  const data = object(response.data);
  if (data.viewId !== viewId || !["ready", "resized", "position", "closed"].includes(String(data.status))) throw new DocumentPreviewError("artifact_native_unavailable");
  const doc = document(data.document);
  if (data.status === "ready" && !doc) throw new DocumentPreviewError("artifact_native_unavailable");
  if (data.position !== null) {
    const p = object(data.position);
    if (![p.scrollX, p.scrollY].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000_000)) throw new DocumentPreviewError("artifact_native_unavailable");
  }
  return { ...(data as Response["data"]), document: doc };
}
export function createDocumentPreviewClient(nativeInvoke: Invoker = invoke) {
  return {
    async run(contextId: string, payload: Action): Promise<Result> {
      const request: Request = { schemaVersion: 1, requestId: crypto.randomUUID(), contextId, payload };
      try {
        const result = parseDocumentPreviewResponse(await nativeInvoke("chat_document_preview_v1", { request }), request.requestId, payload.viewId);
        if (result.status !== { open: "ready", resize: "resized", position: "position", close: "closed" }[payload.action]) throw new DocumentPreviewError("artifact_native_unavailable");
        return result;
      }
      catch (error) {
        if (error instanceof DocumentPreviewError) throw error;
        const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
        throw new DocumentPreviewError(typeof value.code === "string" && value.code.startsWith("artifact_native_") ? value.code : "artifact_native_unavailable");
      }
    },
  };
}
export const documentPreviewClient = createDocumentPreviewClient();
