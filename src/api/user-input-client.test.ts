import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { userInputClient } from "./user-input-client";
import { ChatClientError } from "../domain/chat-ipc";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const id = "10000000-0000-4000-8000-000000000001";
beforeEach(() => vi.resetAllMocks());
describe("user input IPC errors", () => {
  it.each(["chat_resource_not_found", "chat_conflict", "chat_temporarily_unavailable"])("preserves correlated %s using the existing error envelope", async code => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const { request } = args as { request: { requestId: string } };
      throw { schemaVersion: 1, requestId: request.requestId, code, retryable: false, recovery: "reload" };
    });
    await expect(userInputClient.read("context", "session", id)).rejects.toMatchObject({ shape: { code } });
  });
  it.each(["missing id", "another request", "unknown code", "plain failure", "another version"])("keeps %s uncertain instead of inferring not-found", async scenario => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const { request } = args as { request: { requestId: string } };
      if (scenario === "plain failure") throw new Error("ordinary 404");
      throw { schemaVersion: scenario === "another version" ? 6 : 1, ...(scenario === "missing id" ? {} : { requestId: scenario === "another request" ? id : request.requestId }), code: scenario === "unknown code" ? "future_code" : "chat_resource_not_found", retryable: false, recovery: "reload" };
    });
    const failure = await userInputClient.read("context", "session", id).catch(e => e);
    expect(failure).toBeInstanceOf(ChatClientError);
    expect(failure.shape.code).toBe("chat_protocol_error");
  });
});
