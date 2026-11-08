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
    vi.mocked(invoke).mockResolvedValue({ schemaVersion: 1, requestId: "old-request", data: snapshot });
    await expect(readContextWindow(id, id, false)).rejects.toThrow();
  });
});
