import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAT_COMMAND_NAMES,
  CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL,
  CHAT_ATTACHMENT_ISSUES,
  CHAT_NEW_DRAFT_TARGET,
  CHAT_V2_COMMAND_NAMES,
  CHAT_V3_COMMAND_NAMES,
  CHAT_CONTROL_PLANE_EVENT_CHANNEL,
  CHAT_ERROR_CODES,
  CHAT_EVENT_CHANNEL,
  ChatContractError,
  chatSessionDraftTarget,
  parseAttachmentListResponse,
  parseAttachmentImportEvent,
  parseBoundContextResponse,
  parseCancelledResponse,
  parseChatIpcError,
  parseChatProjectionEvent,
  parseCleanupResponse,
  parseControlPlaneEvent,
  parseControlPlaneEventV6,
  parseCreatedTurnResponse,
  parseHistoryPageResponse,
  parseHistoryPageResponseV2,
  parseHistoryPageResponseV3,
  parseLocalReadinessResponse,
  parseOperationResponse,
  parseOperationResponseV2,
  parseOptionalCleanupResponse,
  parseOptionalProjectResponse,
  parseProjectListResponse,
  parseProjectResponse,
  parseReasoningResponse,
  parseResyncResponse,
  parseSessionPageResponse,
  parseSessionControlPlaneResponse,
  parseSessionControlPlaneResponseV6,
  parseSubscriptionResponse,
} from "./chat-ipc";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../src-tauri/fixtures/chat-ipc-v1/${name}`, import.meta.url), "utf8"),
  );
}

describe("private chat IPC v1 contract", () => {
  it("keeps the v2 attachment command allowlist closed", () => {
    expect(CHAT_V2_COMMAND_NAMES).toEqual([
      "chat_pick_attachments_v2",
      "chat_import_attachments_v2",
      "chat_list_draft_attachments_v2",
      "chat_remove_attachment_v2",
      "chat_create_session_v2",
      "chat_submit_turn_v2",
      "chat_load_history_v2",
      "chat_resync_session_v2",
    ]);
  });

  it("keeps private v3 history metadata-only and rejects inconsistent artifact state", () => {
    expect(CHAT_V3_COMMAND_NAMES).toEqual(["chat_load_history_v3"]);
    const schema = JSON.parse(
      readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v3.schema.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(schema["x-yijie-schema-version"]).toBe(3);
    expect(schema["x-yijie-command-names"]).toEqual(CHAT_V3_COMMAND_NAMES);

    const response = {
      schemaVersion: 3,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: {
        turns: [{
          turnId: "019c1a00-0000-7000-8000-000000000022",
          status: "completed",
          terminalAt: 1_785_000_003,
          reasoningStatus: "complete",
          reasoningReasonCode: null,
          messages: [{
            messageId: "019c1a00-0000-7000-8000-000000000023",
            role: "assistant",
            content: "完成",
            contentBlocks: [{ type: "text", text: "完成" }],
            status: "committed",
            ordinal: 1,
            createdAt: 1_785_000_002,
          }],
          reasoning: [],
          artifacts: [{
            artifactId: "019c1a00-0000-7000-8000-000000000024",
            kind: "image",
            provenance: "synthetic",
            status: "ready",
            ordinal: 0,
            progressStage: null,
            progressPercent: null,
            displayName: "synthetic.png",
            mediaType: "image/png",
            sizeBytes: 68,
            localCommittedAt: 1_785_000_004,
            expiresAt: 1_785_604_804,
            hasPoster: false,
            errorCode: null,
            retryable: null,
          }],
        }],
        nextCursor: null,
      },
    };
    const history = parseHistoryPageResponseV3(response);
    expect(history.turns[0]?.artifacts?.[0]).toMatchObject({ kind: "image", status: "ready" });
    expect(JSON.stringify(history)).not.toMatch(/"(?:sha256|contentHref|token|path|bytes)"/i);

    const badExpiry = structuredClone(response);
    badExpiry.data.turns[0]!.artifacts[0]!.expiresAt += 1;
    expect(() => parseHistoryPageResponseV3(badExpiry)).toThrow(ChatContractError);

    const terminalWithProgress = structuredClone(response) as unknown as {
      data: { turns: Array<{ artifacts: Array<{ progressStage: unknown }> }> };
    };
    terminalWithProgress.data.turns[0]!.artifacts[0]!.progressStage = "generating";
    expect(() => parseHistoryPageResponseV3(terminalWithProgress)).toThrow(ChatContractError);
    const leakedHref = structuredClone(response) as typeof response & {
      data: { turns: Array<{ artifacts: Array<Record<string, unknown>> }> };
    };
    leakedHref.data.turns[0]!.artifacts[0]!.contentHref = "/v3/private";
    expect(() => parseHistoryPageResponseV3(leakedHref)).toThrow(ChatContractError);
  });

  it("constructs only explicit non-nil attachment draft targets", () => {
    const sessionId = "019c1a00-0000-7000-8000-000000000005";
    expect(CHAT_NEW_DRAFT_TARGET).toEqual({ type: "new" });
    expect(chatSessionDraftTarget(sessionId)).toEqual({ type: "session", sessionId });
    expect(() => chatSessionDraftTarget("00000000-0000-0000-0000-000000000000"))
      .toThrow(ChatContractError);
  });

  it("keeps the private v2 schema authoritative and aligned with the TypeScript adapter", () => {
    const schema = JSON.parse(
      readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v2.schema.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(schema["x-yijie-schema-version"]).toBe(2);
    expect(schema["x-yijie-command-names"]).toEqual(CHAT_V2_COMMAND_NAMES);
    expect(schema["x-yijie-attachment-issues"]).toEqual(CHAT_ATTACHMENT_ISSUES);
    expect(schema["x-yijie-public-chat-time-projection"]).toBe(
      "Unix epoch seconds are converted to RFC3339 date-time strings at the public ChatMessage boundary.",
    );
    expect(schema["x-yijie-attachment-import-event-channel"]).toBe(
      CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL,
    );

    const contracts = schema["x-yijie-command-contracts"] as Record<string, Record<string, string>>;
    const definitions = schema.$defs as Record<string, Record<string, unknown>>;
    expect(Object.keys(contracts)).toEqual(CHAT_V2_COMMAND_NAMES);
    for (const command of CHAT_V2_COMMAND_NAMES) {
      expect(Object.keys(contracts[command] ?? {}).sort()).toEqual(["request", "response"]);
      for (const surface of ["request", "response"] as const) {
        const reference = contracts[command]?.[surface];
        expect(reference).toMatch(/^#\/\$defs\//);
        expect(definitions[reference.replace("#/$defs/", "")]).toBeDefined();
      }
    }
    for (const payload of [
      "pickAttachmentsPayload", "importAttachmentsPayload", "removeAttachmentPayload",
      "createSessionPayload", "submitTurnPayload", "sessionReadPayload",
      "textTurnBlock", "fileTurnBlock", "imageTurnBlock",
    ]) {
      expect(definitions[payload]?.additionalProperties).toBe(false);
    }
    expect(definitions.epochSeconds).toMatchObject({ type: "integer", minimum: 1 });
  });

  it("keeps schema, TypeScript allowlists, channel, and golden fixtures equal", () => {
    const schema = JSON.parse(
      readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v1.schema.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(schema["x-yijie-schema-version"]).toBe(1);
    expect(schema["x-yijie-event-channel"]).toBe(CHAT_EVENT_CHANNEL);
    expect(schema["x-yijie-control-plane-event-channel"]).toBe(CHAT_CONTROL_PLANE_EVENT_CHANNEL);
    expect(CHAT_EVENT_CHANNEL).toMatch(/^[A-Za-z0-9/:_-]+$/);
    expect(CHAT_CONTROL_PLANE_EVENT_CHANNEL).toMatch(/^[A-Za-z0-9/:_-]+$/);
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
      "sessionControlPlanePayload", "sessionControlPlane", "controlPlaneEvent",
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
    expect(parseSessionControlPlaneResponse(fixture("control-plane-response.json"))).toEqual({
      sessionId: "019c1a00-0000-7000-8000-000000000005",
      state: "retry_wait",
      issueCode: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
    });
    expect(parseControlPlaneEvent(fixture("control-plane-event.json"))).toEqual({
      schemaVersion: 1,
      sequence: "7",
      sessionId: "019c1a00-0000-7000-8000-000000000005",
      state: "bound",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });

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

    const leakedPublicId = fixture("control-plane-event.json") as Record<string, unknown>;
    leakedPublicId.publicTaskId = "019c1a00-0000-7000-8000-000000000099";
    expect(() => parseControlPlaneEvent(leakedPublicId)).toThrow(ChatContractError);

    const inconsistent = fixture("control-plane-response.json") as Record<string, unknown>;
    (inconsistent.data as Record<string, unknown>).recovery = "none";
    expect(() => parseSessionControlPlaneResponse(inconsistent)).toThrow(ChatContractError);
  });

  it("keeps Host identity binding pending distinct from a missing task", () => {
    const response = fixture("control-plane-response.json") as Record<string, unknown>;
    response.data = {
      ...(response.data as Record<string, unknown>),
      state: "binding_pending",
      issueCode: null,
      retryable: false,
      recovery: "none",
    };
    expect(() => parseSessionControlPlaneResponse(response)).toThrow(ChatContractError);
    expect(parseSessionControlPlaneResponseV6(response)).toMatchObject({
      state: "binding_pending",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
  });

  it("accepts the exact Rust control-plane shapes for inflight and exhausted bindings", () => {
    expect(parseSessionControlPlaneResponse(
      fixture("control-plane-inflight-response.json"),
    )).toMatchObject({
      state: "pending",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    expect(parseSessionControlPlaneResponseV6(
      fixture("control-plane-inflight-response.json"),
    )).toMatchObject({
      state: "pending",
      issueCode: null,
      retryable: false,
      recovery: "none",
    });
    expect(() => parseSessionControlPlaneResponse(
      fixture("control-plane-failed-response.json"),
    )).toThrow(ChatContractError);
    expect(parseSessionControlPlaneResponseV6(
      fixture("control-plane-failed-response.json"),
    )).toMatchObject({
      state: "failed",
      issueCode: "chat_temporarily_unavailable",
      retryable: false,
      recovery: "resync",
    });

    const event = fixture("control-plane-event.json") as Record<string, unknown>;
    event.state = "binding_pending";
    event.issueCode = null;
    event.retryable = false;
    event.recovery = "none";
    expect(() => parseControlPlaneEvent(event)).toThrow(ChatContractError);
    expect(parseControlPlaneEventV6(event).state).toBe("binding_pending");
  });

  it("parses only v2 attachment issues with a matching stable error code", () => {
    expect(parseChatIpcError({
      schemaVersion: 2,
      code: "chat_limit_exceeded",
      retryable: false,
      recovery: "reduce_input",
      attachmentIssue: "too_large",
      attachmentItemCount: 2,
    })).toMatchObject({
      code: "chat_limit_exceeded",
      attachmentIssue: "too_large",
      attachmentItemCount: 2,
    });
    expect(() => parseChatIpcError({
      schemaVersion: 1,
      code: "chat_limit_exceeded",
      retryable: false,
      recovery: "reduce_input",
      attachmentIssue: "too_large",
    })).toThrow(ChatContractError);
    expect(() => parseChatIpcError({
      schemaVersion: 1,
      code: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
      attachmentItemCount: 2,
    })).toThrow(ChatContractError);
    expect(() => parseChatIpcError({
      schemaVersion: 2,
      code: "chat_temporarily_unavailable",
      retryable: true,
      recovery: "retry",
      attachmentItemCount: 0,
    })).toThrow(ChatContractError);
    expect(() => parseChatIpcError({
      schemaVersion: 2,
      code: "chat_request_invalid",
      retryable: false,
      recovery: "fix_request",
      attachmentIssue: "too_large",
    })).toThrow(ChatContractError);
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

  it("parses v2 attachment metadata and ordered multimodal history without accepting paths", () => {
    const attachment = {
      attachmentId: "019c1a00-0000-7000-8000-000000000021",
      type: "image",
      name: "synthetic-image.png",
      mediaType: "image/png",
      sizeBytes: 4096,
      status: "ready",
      expiresAt: 2_000_000_000,
    };
    expect(parseAttachmentListResponse({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: [attachment],
    })).toEqual([attachment]);
    expect(parseOperationResponseV2({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: { operationId: "019c1a00-0000-7000-8000-000000000024" },
    })).toBe("019c1a00-0000-7000-8000-000000000024");

    const historyAttachment = { ...attachment, status: "bound" };
    const historyWire = {
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: {
        turns: [{
          turnId: "019c1a00-0000-7000-8000-000000000022",
          status: "completed",
          terminalAt: 3,
          reasoningStatus: "complete",
          reasoningReasonCode: null,
          messages: [{
            messageId: "019c1a00-0000-7000-8000-000000000023",
            role: "user",
            content: "检查图片",
            contentBlocks: [{ type: "text", text: "检查图片" }, historyAttachment],
            status: "complete",
            ordinal: 1,
            createdAt: 2,
          }],
          reasoning: [],
        }],
        nextCursor: null,
      },
    };
    const history = parseHistoryPageResponseV2(historyWire);
    expect(history.turns[0]?.messages[0]?.contentBlocks?.map((block) => block.type)).toEqual(["text", "image"]);

    const missingContent = structuredClone(historyWire);
    delete (missingContent.data.turns[0]?.messages[0] as Partial<{ content: string }>).content;
    expect(() => parseHistoryPageResponseV2(missingContent)).toThrow(ChatContractError);

    const readyHistory = structuredClone(historyWire);
    const readyHistoryAttachment = readyHistory.data.turns[0]!.messages[0]!.contentBlocks[1] as {
      status: string;
    };
    readyHistoryAttachment.status = "ready";
    expect(() => parseHistoryPageResponseV2(readyHistory)).toThrow(ChatContractError);

    const mismatchedProjection = structuredClone(historyWire);
    mismatchedProjection.data.turns[0]!.messages[0]!.content = "不同文本";
    expect(() => parseHistoryPageResponseV2(mismatchedProjection)).toThrow(ChatContractError);

    expect(() => parseAttachmentListResponse({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: [{ ...attachment, name: "/private/synthetic-image.png" }],
    })).toThrow(ChatContractError);
    expect(() => parseAttachmentListResponse({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000020",
      data: [{ ...attachment, type: "file" }],
    })).toThrow(ChatContractError);
  });

  it("parses only content-free aggregate attachment import events", () => {
    const event = {
      schemaVersion: 2,
      contextId: "019c1a00-0000-7000-8000-000000000003",
      operationId: "019c1a00-0000-7000-8000-000000000024",
      sequence: "3",
      stage: "parsing",
      itemCount: 2,
      issue: null,
    };
    expect(parseAttachmentImportEvent(event)).toEqual(event);
    expect(() => parseAttachmentImportEvent({ ...event, name: "private.pdf" }))
      .toThrow(ChatContractError);
    expect(() => parseAttachmentImportEvent({ ...event, attachment: { path: "/private/file" } }))
      .toThrow(ChatContractError);
    expect(() => parseAttachmentImportEvent({ ...event, stage: "error_terminal" }))
      .toThrow(ChatContractError);
    expect(parseAttachmentImportEvent({
      ...event,
      sequence: "4",
      stage: "error_terminal",
      issue: "parse_failed",
    })).toMatchObject({ stage: "error_terminal", issue: "parse_failed" });
  });
});
