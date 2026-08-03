import { describe, expect, it, vi } from "vitest";
import { createChatClient, type ChatClientTransport } from "./chat-client";
import { ChatClientError } from "../domain/chat-ipc";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000001";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000003";

function transport(invoke: ChatClientTransport["invoke"]): ChatClientTransport {
  return { invoke, listen: async () => () => undefined };
}

describe("chat client", () => {
  it("sends only the closed versioned request envelope", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const nativeInvoke = vi.fn(async (command: string) => {
      void command;
      return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: { sessions: [], nextCursor: null },
      };
    });
    const client = createChatClient(transport(nativeInvoke));

    await client.listSessions(CONTEXT_ID, undefined, 20);

    expect(nativeInvoke).toHaveBeenCalledWith("chat_list_sessions_v1", {
      request: {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { limit: 20 },
      },
    });
  });

  it("maps only the stable content-free error and rejects arbitrary native failures", async () => {
    const stable = createChatClient(transport(async () => {
      throw { schemaVersion: 1, code: "chat_context_invalid", retryable: false, recovery: "rebind_context" };
    }));
    await expect(stable.listProjects(CONTEXT_ID)).rejects.toMatchObject({
      shape: { code: "chat_context_invalid", recovery: "rebind_context" },
    });

    const arbitrary = createChatClient(transport(async () => {
      throw { message: "Bearer secret /private/project" };
    }));
    await expect(arbitrary.listProjects(CONTEXT_ID)).rejects.toEqual(
      expect.objectContaining<Partial<ChatClientError>>({
        shape: expect.objectContaining({ code: "chat_protocol_error" }),
      }),
    );
  });

  it("cancels a pending read by request ID without cancelling a durable write", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    let resolveRead!: (value: unknown) => void;
    const nativeInvoke = vi.fn((command: string) => {
      if (command === "chat_list_sessions_v1") {
        return new Promise<unknown>((resolve) => { resolveRead = resolve; });
      }
      return Promise.resolve({ schemaVersion: 1, requestId: REQUEST_ID, data: { cancelled: true } });
    });
    const client = createChatClient(transport(nativeInvoke));
    const controller = new AbortController();
    const pending = client.listSessions(CONTEXT_ID, undefined, 20, controller.signal);
    controller.abort();
    resolveRead({ schemaVersion: 1, requestId: REQUEST_ID, data: { sessions: [], nextCursor: null } });

    await expect(pending).rejects.toMatchObject({ shape: { code: "chat_request_cancelled" } });
    expect(nativeInvoke).toHaveBeenCalledWith("chat_cancel_request_v1", expect.any(Object));
  });

  it("drops malformed Tauri events and signals a required recovery", async () => {
    let listener!: (payload: unknown) => void;
    const invalid = vi.fn();
    const client = createChatClient({
      invoke: async () => undefined,
      listen: async (_channel, handler) => {
        listener = handler;
        return () => undefined;
      },
    });
    await client.onEvent(vi.fn(), invalid);
    listener({ hostBearer: "secret" });
    expect(invalid).toHaveBeenCalledOnce();
  });

  it("uses the closed readiness and recovery commands instead of legacy Host commands", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const nativeInvoke = vi.fn(async (command: string) => {
      void command;
      return {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        data: {
          lifecycle: "blocked",
          host: "unavailable",
          runtime: "unavailable",
          storage: "ready",
          canSend: false,
          issueCode: "chat_host_unavailable",
          retryable: true,
          recovery: "start_or_retry",
          retryAfterMs: 1000,
        },
      };
    });
    const client = createChatClient(transport(nativeInvoke));

    await client.getLocalReadiness(CONTEXT_ID);
    await client.requestLocalRecovery(CONTEXT_ID, REQUEST_ID);

    expect(nativeInvoke.mock.calls.map(([command]) => command)).toEqual([
      "chat_get_local_readiness_v1",
      "chat_request_local_recovery_v1",
    ]);
    expect(nativeInvoke).not.toHaveBeenCalledWith("chat_start_local_host", expect.anything());
  });
});
