import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAT_COMMAND_NAMES,
  CHAT_ERROR_CODES,
  CHAT_EVENT_CHANNEL,
  ChatContractError,
  parseBoundContextResponse,
  parseCancelledResponse,
  parseChatIpcError,
  parseChatProjectionEvent,
  parseCleanupResponse,
  parseCreatedTurnResponse,
  parseHistoryPageResponse,
  parseLocalReadinessResponse,
  parseOperationResponse,
  parseOptionalCleanupResponse,
  parseOptionalProjectResponse,
  parseProjectListResponse,
  parseProjectResponse,
  parseReasoningResponse,
  parseResyncResponse,
  parseSessionPageResponse,
  parseSubscriptionResponse,
} from "./chat-ipc";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../src-tauri/fixtures/chat-ipc-v1/${name}`, import.meta.url), "utf8"),
  );
}

describe("private chat IPC v1 contract", () => {
  it("keeps schema, TypeScript allowlists, channel, and golden fixtures equal", () => {
    const schema = JSON.parse(
      readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v1.schema.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(schema["x-yijie-schema-version"]).toBe(1);
    expect(schema["x-yijie-event-channel"]).toBe(CHAT_EVENT_CHANNEL);
    expect(schema["x-yijie-command-names"]).toEqual(CHAT_COMMAND_NAMES);
    expect(schema["x-yijie-error-codes"]).toEqual(CHAT_ERROR_CODES);
    const contracts = schema["x-yijie-command-contracts"] as Record<string, Record<string, string>>;
    const definitions = schema.$defs as Record<string, Record<string, unknown>>;
    expect(Object.keys(contracts)).toEqual(CHAT_COMMAND_NAMES);
    for (const command of CHAT_COMMAND_NAMES) {
      expect(Object.keys(contracts[command] ?? {}).sort()).toEqual(["request", "response"]);
      for (const surface of ["request", "response"] as const) {
        const reference = contracts[command]?.[surface];
        expect(reference).toMatch(/^#\/\$defs\//);
        expect(definitions[reference.replace("#/$defs/", "")]).toBeDefined();
      }
    }
    expect((definitions.event.oneOf as unknown[])).toHaveLength(7);
    for (const payload of [
      "bindPayload", "emptyPayload", "operationOnlyPayload", "recoveryPayload", "projectOperationPayload",
      "setProjectPinnedPayload", "createSessionPayload", "submitTurnPayload", "listSessionsPayload",
      "sessionReadPayload", "reasoningPayload", "renameSessionPayload", "setSessionPinnedPayload",
      "sessionOperationPayload", "cleanupStatusPayload", "subscribePayload", "unsubscribePayload",
      "cancelPayload", "assistantPayload", "reasoningAppendPayload", "turnStatePayload",
      "turnTerminalPayload", "cleanupEventPayload", "resyncRequiredPayload", "contextInvalidatedPayload",
    ]) {
      expect(definitions[payload]?.additionalProperties).toBe(false);
    }

    expect(parseBoundContextResponse(fixture("context-response.json"))).toEqual({
      contextId: "019c1a00-0000-7000-8000-000000000003",
      expiresAtEpochSeconds: 1785758700,
      allowedActions: ["read_sessions", "read_projects"],
    });
    expect(parseChatIpcError(fixture("error.json")).code).toBe("chat_context_invalid");
    expect(parseChatProjectionEvent(fixture("reasoning-event.json"))).toMatchObject({
      projectionSequence: "7",
      kind: "reasoning_append",
      payload: { itemOrdinal: 0, contentIndex: 0, text: "synthetic reasoning fixture" },
    });

    const responses = fixture("response-corpus.json") as Record<string, unknown>;
    expect(parseProjectListResponse(responses.projectList)).toHaveLength(1);
    expect(parseOptionalProjectResponse(responses.optionalProject)).toBeNull();
    expect(parseProjectResponse(responses.project).safeName).toBe("Synthetic Project");
    expect(parseOperationResponse(responses.operation)).toBe("019c1a00-0000-7000-8000-00000000000b");
    expect(parseCreatedTurnResponse(responses.createdTurn).turnId).toBe("019c1a00-0000-7000-8000-000000000006");
    expect(parseSessionPageResponse(responses.sessionPage).nextCursor).toBe("abcdef0123456789");
    expect(parseHistoryPageResponse(responses.historyPage).turns).toHaveLength(1);
    expect(parseReasoningResponse(responses.reasoningList)).toHaveLength(1);
    expect(parseCleanupResponse(responses.cleanup).outcomeCode).toBe("cleanup_complete");
    expect(parseOptionalCleanupResponse(responses.optionalCleanup)).toBeNull();
    expect(parseSubscriptionResponse(responses.subscription)).toBe("019c1a00-0000-7000-8000-000000000004");
    expect(parseCancelledResponse(responses.cancelled)).toBe(true);
    expect(parseLocalReadinessResponse(responses.localReadiness)).toMatchObject({
      lifecycle: "ready", canSend: true, issueCode: null,
    });
    expect(parseResyncResponse(responses.resync).session.title).toBe("Synthetic Session");

    const events = fixture("event-corpus.json") as unknown[];
    expect(events.map((event) => parseChatProjectionEvent(event).kind)).toEqual([
      "assistant_append", "reasoning_append", "turn_state", "turn_terminal",
      "cleanup_state", "resync_required", "context_invalidated",
    ]);
  });

  it("rejects unknown authority, path, Host wire, and oversized projection fields", () => {
    const context = fixture("context-response.json") as Record<string, unknown>;
    const data = context.data as Record<string, unknown>;
    data.ownerUserId = "019c1a00-0000-7000-8000-000000000008";
    expect(() => parseBoundContextResponse(context)).toThrow(ChatContractError);

    const event = fixture("reasoning-event.json") as Record<string, unknown>;
    event.hostEventId = "private";
    expect(() => parseChatProjectionEvent(event)).toThrow(ChatContractError);

    const eventWithPath = fixture("reasoning-event.json") as Record<string, unknown>;
    (eventWithPath.payload as Record<string, unknown>).projectPath = "/private/synthetic";
    expect(() => parseChatProjectionEvent(eventWithPath)).toThrow(ChatContractError);

    const oversized = fixture("reasoning-event.json") as Record<string, unknown>;
    (oversized.payload as Record<string, unknown>).text = "a".repeat(16 * 1024 + 1);
    expect(() => parseChatProjectionEvent(oversized)).toThrow(ChatContractError);

    const oversizedUnicode = fixture("reasoning-event.json") as Record<string, unknown>;
    (oversizedUnicode.payload as Record<string, unknown>).text = "界".repeat(6 * 1024);
    expect(() => parseChatProjectionEvent(oversizedUnicode)).toThrow(ChatContractError);
  });

  it("uses decimal strings for u64 event sequence and rejects historical Host item IDs", () => {
    const event = fixture("reasoning-event.json") as Record<string, unknown>;
    event.projectionSequence = "18446744073709551616";
    expect(() => parseChatProjectionEvent(event)).toThrow(ChatContractError);

    const response = {
      schemaVersion: 1,
      requestId: "019c1a00-0000-7000-8000-000000000001",
      data: [{
        itemOrdinal: 0,
        itemId: "host-private",
        status: "complete",
        reasonCode: null,
        finalizedAtMs: 1,
        parts: [],
      }],
    };
    expect(() => parseReasoningResponse(response)).toThrow(ChatContractError);
  });
});
