import { invoke } from "@tauri-apps/api/core";
import type { components } from "./generated/context-window.gen";
import { validateContextWindowQuery, validateContextWindowSnapshot } from "./generated/context-window-validator.gen.js";

export type ContextWindowSnapshot = components["schemas"]["ContextWindowSnapshot"];
export type ContextWindowSample = components["schemas"]["ContextWindowSample"];
export type ContextCompaction = components["schemas"]["ContextCompaction"];

export async function readContextWindow(contextId: string, sessionId: string, includeHistory: boolean): Promise<ContextWindowSnapshot> {
  const requestId = crypto.randomUUID();
  const payload = { sessionId, includeHistory };
  if (!validateContextWindowQuery(payload)) throw new Error("上下文状态暂不可用");
  const response: unknown = await invoke("chat_context_window_v1", { request: { schemaVersion: 1, requestId, contextId, payload } });
  if (!response || typeof response !== "object" || !("data" in response) || !("requestId" in response) || response.requestId !== requestId || !("schemaVersion" in response) || response.schemaVersion !== 1 || !validateContextWindowSnapshot(response.data)) {
    throw new Error("上下文状态暂不可用");
  }
  return response.data as ContextWindowSnapshot;
}
