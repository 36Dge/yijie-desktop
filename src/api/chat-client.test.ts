import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createChatClient, type ChatClientTransport } from "./chat-client";
import {
  CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL,
  CHAT_EVENT_CHANNEL,
  CHAT_NEW_DRAFT_TARGET,
  ChatClientError,
} from "../domain/chat-ipc";

const REQUEST_ID = "019c1a00-0000-7000-8000-000000000001";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000003";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000004";
const SUBSCRIPTION_ID = "019c1a00-0000-7000-8000-000000000005";

function transport(invoke: ChatClientTransport["invoke"]): ChatClientTransport {
  return { invoke, listen: async () => () => undefined };
}

describe("chat client", () => {
  it("negotiates v5 through the existing private commands without widening the envelope", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const nativeInvoke = vi.fn(async () => ({
      schemaVersion: 5,
      requestId: REQUEST_ID,
      data: {
        turns: [],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "0",
      },
    }));
    const client = createChatClient(transport(nativeInvoke));

    await client.loadHistoryV5(CONTEXT_ID, SESSION_ID, undefined, 20);

    expect(nativeInvoke).toHaveBeenCalledWith("chat_load_history_v3", {
      request: {
        schemaVersion: 5,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { sessionId: SESSION_ID, limit: 20 },
      },
    });
  });

  it("delivers only parsed v5 events and requests scoped recovery for an unknown wire kind", async () => {
    let listener!: (payload: unknown) => void;
    const handler = vi.fn();
    const invalid = vi.fn();
    const listen = vi.fn(async (_channel: string, callback: (payload: unknown) => void) => {
      listener = callback;
      return () => undefined;
    });
    const client = createChatClient({ invoke: async () => undefined, listen });
    await client.onEventV5(handler, invalid);

    const base = {
      schemaVersion: 5,
      subscriptionId: SUBSCRIPTION_ID,
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      turnId: "019c1a00-0000-7000-8000-000000000006",
      projectionSequence: "1",
      eventId: "019c1a00-0000-7000-8000-000000000007",
      durableSequence: "1",
    };
    listener({
      ...base,
      kind: "command_started",
      payload: {
        sourceEventId: "019c1a00-0000-7000-8000-000000000008",
        sourceSequence: "1",
        sourceOccurredAt: "2026-08-29T08:00:00Z",
        itemId: "command-1",
        itemOrdinal: 1,
        status: "running",
        commandSummary: { text: "Inspect repository status", truncated: false, truncationReason: null },
        cwd: { kind: "workspace_root", segments: [] },
      },
    });
    listener({ ...base, kind: "future.execution", payload: {} });

    expect(listen).toHaveBeenCalledWith(CHAT_EVENT_CHANNEL, expect.any(Function));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 5,
      kind: "command_started",
    }));
    expect(invalid).toHaveBeenCalledWith({
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      subscriptionId: SUBSCRIPTION_ID,
    });
  });

  it("loads Artifact history through only the closed v3 command and envelope", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const nativeInvoke = vi.fn(async () => ({
      schemaVersion: 3,
      requestId: REQUEST_ID,
      data: { turns: [], nextCursor: null },
    }));
    const client = createChatClient(transport(nativeInvoke));

    await client.loadHistoryV3(
      CONTEXT_ID,
      "019c1a00-0000-7000-8000-000000000004",
      "abcdefghijklmnop",
      20,
    );

    expect(nativeInvoke).toHaveBeenCalledWith("chat_load_history_v3", {
      request: {
        schemaVersion: 3,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: {
          sessionId: "019c1a00-0000-7000-8000-000000000004",
          cursor: "abcdefghijklmnop",
          limit: 20,
        },
      },
    });
    expect(nativeInvoke).not.toHaveBeenCalledWith("chat_load_history_v2", expect.anything());
  });

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
    expect(invalid).toHaveBeenCalledWith(null);
  });

  it("extracts only a safe routing scope from malformed current and old-session events", async () => {
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

    listener({
      schemaVersion: 1,
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      subscriptionId: SUBSCRIPTION_ID,
      kind: "malformed_current",
      payload: { text: "private current body" },
    });
    const oldSessionId = "019c1a00-0000-7000-8000-000000000006";
    const oldSubscriptionId = "019c1a00-0000-7000-8000-000000000007";
    listener({
      contextId: CONTEXT_ID,
      sessionId: oldSessionId,
      subscriptionId: oldSubscriptionId,
      body: { token: "private old body" },
    });

    expect(invalid).toHaveBeenNthCalledWith(1, {
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      subscriptionId: SUBSCRIPTION_ID,
    });
    expect(invalid).toHaveBeenNthCalledWith(2, {
      contextId: CONTEXT_ID,
      sessionId: oldSessionId,
      subscriptionId: oldSubscriptionId,
    });
    expect(JSON.stringify(invalid.mock.calls)).not.toContain("payload");
    expect(JSON.stringify(invalid.mock.calls)).not.toContain("body");
    expect(JSON.stringify(invalid.mock.calls)).not.toContain("private");
  });

  it("returns null routing scope for non-objects and malformed event IDs", async () => {
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

    listener(null);
    listener("not-an-event");
    listener({
      contextId: CONTEXT_ID,
      sessionId: "not-a-uuid",
      subscriptionId: SUBSCRIPTION_ID,
      payload: { text: "must not escape" },
    });
    listener({
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      subscriptionId: "00000000-0000-0000-0000-000000000000",
    });

    expect(invalid).toHaveBeenCalledTimes(4);
    expect(invalid.mock.calls).toEqual([[null], [null], [null], [null]]);
  });

  it("listens for aggregate attachment progress and rejects leaked file metadata", async () => {
    let listener!: (payload: unknown) => void;
    const handler = vi.fn();
    const invalid = vi.fn();
    const unlisten = vi.fn();
    const listen = vi.fn(async (_channel: string, callback: (payload: unknown) => void) => {
      listener = callback;
      return unlisten;
    });
    const client = createChatClient({ invoke: async () => undefined, listen });

    await expect(client.onAttachmentImportEvent(handler, invalid)).resolves.toBe(unlisten);
    expect(listen).toHaveBeenCalledWith(CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL, expect.any(Function));

    const event = {
      schemaVersion: 2,
      contextId: CONTEXT_ID,
      operationId: REQUEST_ID,
      sequence: "1",
      stage: "queued",
      itemCount: 2,
      issue: null,
    };
    listener(event);
    listener({ ...event, sequence: "2", path: "/private/source.pdf" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
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

  it("uses the closed control-plane command and rejects leaked Public IDs on its event channel", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const sessionId = "019c1a00-0000-7000-8000-000000000005";
    let listener!: (payload: unknown) => void;
    const invalid = vi.fn();
    const invoke = vi.fn(async () => ({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      data: {
        sessionId,
        state: "bound",
        issueCode: null,
        retryable: false,
        recovery: "none",
      },
    }));
    const client = createChatClient({
      invoke,
      listen: async (_channel, handler) => {
        listener = handler;
        return () => undefined;
      },
    });

    await expect(client.getSessionControlPlane(CONTEXT_ID, sessionId)).resolves.toMatchObject({
      sessionId,
      state: "bound",
    });
    expect(invoke).toHaveBeenCalledWith("chat_get_session_control_plane_v1", {
      request: {
        schemaVersion: 1,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { sessionId },
      },
    });
    await client.onControlPlaneEvent(vi.fn(), invalid);
    listener({
      schemaVersion: 1,
      sequence: "1",
      sessionId,
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
      publicTaskId: "019c1a00-0000-7000-8000-000000000099",
    });
    expect(invalid).toHaveBeenCalledOnce();
  });

  it("uses additive v2 envelopes for attachment metadata and ordered multimodal turns", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const attachmentId = "019c1a00-0000-7000-8000-000000000010";
    const sessionId = "019c1a00-0000-7000-8000-000000000011";
    const nativeInvoke = vi.fn(async (command: string, arguments_?: Record<string, unknown>) => {
      void arguments_;
      if (
        command === "chat_pick_attachments_v2" ||
        command === "chat_import_attachments_v2" ||
        command === "chat_list_draft_attachments_v2"
      ) return {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        data: [{
          attachmentId,
          type: "file",
          name: "synthetic.pdf",
          mediaType: "application/pdf",
          sizeBytes: 2048,
          status: "ready",
          expiresAt: 2_000_000_000,
        }],
      };
      if (command === "chat_remove_attachment_v2") return {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        data: { operationId: REQUEST_ID },
      };
      return {
          schemaVersion: 2,
          requestId: REQUEST_ID,
          data: { sessionId, turnId: "019c1a00-0000-7000-8000-000000000012", operationId: REQUEST_ID },
        };
    });
    const client = createChatClient(transport(nativeInvoke));

    await expect(client.pickAttachments(CONTEXT_ID, CHAT_NEW_DRAFT_TARGET, 7, REQUEST_ID)).resolves.toHaveLength(1);
    await expect(client.importAttachments(CONTEXT_ID, CHAT_NEW_DRAFT_TARGET, ["/transient/drop.pdf"], 6, REQUEST_ID)).resolves.toHaveLength(1);
    await expect(client.listDraftAttachments(CONTEXT_ID, CHAT_NEW_DRAFT_TARGET)).resolves.toHaveLength(1);
    await expect(client.removeAttachment(CONTEXT_ID, CHAT_NEW_DRAFT_TARGET, attachmentId, REQUEST_ID)).resolves.toBe(REQUEST_ID);
    await client.createSessionV2(CONTEXT_ID, "019c1a00-0000-7000-8000-000000000013", [
      { type: "text", text: "检查文档" },
      { type: "file", attachmentId },
    ], REQUEST_ID);

    expect(nativeInvoke.mock.calls[0]).toEqual(["chat_pick_attachments_v2", {
      request: {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { draftTarget: { type: "new" }, operationId: REQUEST_ID, remainingCapacity: 7 },
      },
    }]);
    expect(nativeInvoke.mock.calls[1]).toEqual(["chat_import_attachments_v2", {
      request: {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: {
          paths: ["/transient/drop.pdf"],
          draftTarget: { type: "new" },
          operationId: REQUEST_ID,
          remainingCapacity: 6,
        },
      },
    }]);
    expect(nativeInvoke.mock.calls[2]).toEqual(["chat_list_draft_attachments_v2", {
      request: {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { draftTarget: { type: "new" } },
      },
    }]);
    expect(nativeInvoke.mock.calls[3]).toEqual(["chat_remove_attachment_v2", {
      request: {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: { attachmentId, draftTarget: { type: "new" }, operationId: REQUEST_ID },
      },
    }]);
    expect(nativeInvoke.mock.calls[4]?.[1]).toEqual({
      request: {
        schemaVersion: 2,
        requestId: REQUEST_ID,
        contextId: CONTEXT_ID,
        payload: {
          projectId: "019c1a00-0000-7000-8000-000000000013",
          contentBlocks: [
            { type: "text", text: "检查文档" },
            { type: "file", attachmentId },
          ],
          operationId: REQUEST_ID,
        },
      },
    });
  });

  it("produces the same attachment-only request fixture consumed by Rust serde", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const fixture = JSON.parse(readFileSync(
      new URL("../../src-tauri/fixtures/chat-ipc-v2/create-session-attachment-only-request.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    const nativeInvoke = vi.fn(async () => ({
      schemaVersion: 2,
      requestId: REQUEST_ID,
      data: {
        sessionId: "019c1a00-0000-7000-8000-000000000011",
        turnId: "019c1a00-0000-7000-8000-000000000012",
        operationId: REQUEST_ID,
      },
    }));
    const client = createChatClient(transport(nativeInvoke));

    await client.createSessionV2(
      CONTEXT_ID,
      "019c1a00-0000-7000-8000-000000000013",
      [{ type: "file", attachmentId: "019c1a00-0000-7000-8000-000000000010" }],
      REQUEST_ID,
    );

    expect(nativeInvoke).toHaveBeenCalledWith("chat_create_session_v2", { request: fixture });
  });
});
