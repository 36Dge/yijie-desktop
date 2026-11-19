import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readContextWindow } from "./context-window-client";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
describe("context window read adapter", () => {
  it("uses only the read command with the selected session and validates its envelope", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const snapshot = { schema_version: 1, thread_id: id, model_profile: "ordinary", model_revision: 1, sample: null, compactions: [] };
    vi.mocked(invoke).mockImplementation(async (_, args) => ({ schemaVersion: 1, requestId: (args as { request: { requestId: string } }).request.requestId, data: snapshot }));
    expect(await readContextWindow(id, id, true)).toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("chat_context_window_v1", expect.objectContaining({ request: expect.objectContaining({ contextId: id, payload: { sessionId: id, includeHistory: true } }) }));
    await readContextWindow(id, id, false, true);
    expect(invoke).toHaveBeenLastCalledWith("chat_context_window_v1", expect.objectContaining({ request: expect.objectContaining({ payload: { sessionId: id, includeHistory: false, includeLastObservation: true } }) }));
    vi.mocked(invoke).mockResolvedValue({ schemaVersion: 1, requestId: "old-request", data: snapshot });
    await expect(readContextWindow(id, id, false)).rejects.toThrow();
  });
  it("uses the strict current-model read with an older running Native and only negotiates once", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const snapshot = { schema_version: 1, thread_id: id, model_profile: "ordinary", model_revision: 1, sample: null, compactions: [] };
    const payloads: unknown[] = [];
    vi.mocked(invoke).mockImplementation(async (_, args) => {
      const {requestId, payload} = (args as {request: {requestId: string; payload: {includeLastObservation?: boolean}}}).request;
      payloads.push(payload.includeLastObservation);
      if (payload.includeLastObservation) throw {requestId, code: "chat_request_invalid"};
      return {schemaVersion: 1, requestId, data: snapshot};
    });
    expect(await readContextWindow(id, id, false, true)).toEqual(snapshot);
    expect(await readContextWindow(id, id, false, true)).toEqual(snapshot);
    expect(payloads).toEqual([true, undefined, undefined]);
  });
});
