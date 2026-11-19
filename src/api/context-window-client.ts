import { invoke } from "@tauri-apps/api/core";
import type { components } from "./generated/context-window.gen";
import { validateContextWindowQuery, validateContextWindowSnapshot } from "./generated/context-window-validator.gen.js";

export type ContextWindowSnapshot = components["schemas"]["ContextWindowSnapshot"];
export type ContextWindowSample = components["schemas"]["ContextWindowSample"];
export type ContextCompaction = components["schemas"]["ContextCompaction"];

let legacyNative = false;

export async function readContextWindow(contextId: string, sessionId: string, includeHistory: boolean, includeLastObservation = false): Promise<ContextWindowSnapshot> {
  const requestId = crypto.randomUUID();
  const extended = includeLastObservation && !legacyNative;
  const payload = { sessionId, includeHistory, ...(extended && { includeLastObservation: true }) };
  if (!validateContextWindowQuery(payload)) throw new Error("上下文状态暂不可用");
  let response: unknown;
  try {
    response = await invoke("chat_context_window_v1", { request: { schemaVersion: 1, requestId, contextId, payload } });
  } catch (error) {
    // HMR can pair the updated renderer with an older running Native binary.
    if (!extended || !error || typeof error !== "object" || !("requestId" in error) || error.requestId !== requestId ||
        !("code" in error) || error.code !== "chat_request_invalid") throw error;
    const compatible = await readContextWindow(contextId, sessionId, includeHistory);
    legacyNative = true;
    return compatible;
  }
  if (!response || typeof response !== "object" || !("data" in response) || !("requestId" in response) || response.requestId !== requestId || !("schemaVersion" in response) || response.schemaVersion !== 1 || !validateContextWindowSnapshot(response.data)) {
    throw new Error("上下文状态暂不可用");
  }
  return response.data as ContextWindowSnapshot;
}
