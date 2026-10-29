import { expect, it, vi } from "vitest";
import { createDocumentPreviewClient, parseDocumentPreviewResponse } from "./chat-document-preview-client";
const response = { schemaVersion: 1, requestId: "request", data: { status: "closed", viewId: "view", document: null, position: null } };
it("requires response correlation, known status and known document kind", () => {
  expect(parseDocumentPreviewResponse(response,"request","view").status).toBe("closed");
  expect(() => parseDocumentPreviewResponse(response,"another","view")).toThrow();
  expect(() => parseDocumentPreviewResponse({ ...response, schemaVersion: 2 },"request","view")).toThrow();
  expect(() => parseDocumentPreviewResponse({ ...response, data: { ...response.data, status: "future" } },"request","view")).toThrow();
  expect(() => parseDocumentPreviewResponse({ ...response, data: { ...response.data, status: "ready", document: { kind: "future" } } },"request","view")).toThrow();
});
it("sends only the versioned identity operation and preserves typed failure", async () => {
  const invoke = vi.fn(async (_command, args) => ({ ...response, requestId: args.request.requestId }));
  await createDocumentPreviewClient(invoke).run("scope", { action: "close", viewId: "view" });
  expect(invoke.mock.calls[0]?.[0]).toBe("chat_document_preview_v1");
  expect(invoke.mock.calls[0]?.[1].request).toMatchObject({ schemaVersion: 1, contextId: "scope", payload: { action: "close", viewId: "view" } });
  const failure = createDocumentPreviewClient(async () => { throw { code: "artifact_native_forbidden" }; });
  await expect(failure.run("scope",{ action: "close", viewId: "view" })).rejects.toMatchObject({ code: "artifact_native_forbidden" });
});
