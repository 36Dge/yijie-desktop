import { describe, expect, it } from "vitest";
import {
  ChatContractError,
  parseChatProjectionEventV4,
  parseChatProjectionEventV5,
  parseHistoryPageResponseV5,
  type ChatCommandOutputV5,
} from "./chat-ipc";

const CONTEXT_ID = "019fbf59-2000-7000-8000-000000000001";
const SESSION_ID = "019fbf59-2000-7000-8000-000000000002";
const TURN_ID = "019fbf59-2000-7000-8000-000000000003";
const SUBSCRIPTION_ID = "019fbf59-2000-7000-8000-000000000004";

function source(sequence: number) {
  return {
    sourceEventId: `019fbf59-2000-7000-8000-${String(100 + sequence).padStart(12, "0")}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-29T08:00:00Z",
  } as const;
}

function event(
  sequence: number,
  kind: string,
  payload: Record<string, unknown>,
) {
  return {
    schemaVersion: 5,
    subscriptionId: SUBSCRIPTION_ID,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    projectionSequence: String(sequence),
    eventId: `019fbf59-2000-7000-8000-${String(sequence).padStart(12, "0")}`,
    durableSequence: String(sequence),
    kind,
    payload,
  };
}

const summary = Object.freeze({
  text: "Inspect repository status",
  truncated: false,
  truncationReason: null,
});
const cwd = Object.freeze({ kind: "workspace_root", segments: Object.freeze([]) });

function output(retention: ChatCommandOutputV5["retention"]): ChatCommandOutputV5 {
  if (retention === "complete") {
    return {
      retention,
      text: "working tree clean\n",
      head: null,
      tail: null,
      reason: null,
      truncated: false,
      truncationReason: null,
    };
  }
  if (retention === "head_tail") {
    return {
      retention,
      text: null,
      head: "first retained section\n",
      tail: "last retained section\n",
      reason: null,
      truncated: true,
      truncationReason: "utf8_byte_limit",
    };
  }
  return {
    retention,
    text: null,
    head: null,
    tail: null,
    reason: "not_available",
    truncated: false,
    truncationReason: null,
  };
}

describe("FEAT-136 private IPC v5 closed parser", () => {
  it("counts v5 live and inherited item IDs by Unicode code point with the 1024-byte cap", () => {
    const maximumItemId = "😀".repeat(256);
    const overlongItemId = `${maximumItemId}😀`;
    expect([...maximumItemId]).toHaveLength(256);
    expect(new TextEncoder().encode(maximumItemId)).toHaveLength(1024);

    expect(parseChatProjectionEventV5(event(1, "command_started", {
      ...source(1),
      itemId: maximumItemId,
      itemOrdinal: 1,
      status: "running",
      commandSummary: summary,
      cwd,
    }))).toMatchObject({ payload: { itemId: maximumItemId } });
    expect(() => parseChatProjectionEventV5(event(1, "command_started", {
      ...source(1),
      itemId: overlongItemId,
      itemOrdinal: 1,
      status: "running",
      commandSummary: summary,
      cwd,
    }))).toThrow(ChatContractError);

    const inherited = event(2, "item_started", {
      ...source(2),
      itemId: maximumItemId,
      itemOrdinal: 1,
      itemType: "webSearch",
      phase: null,
      text: null,
    });
    expect(parseChatProjectionEventV5(inherited))
      .toMatchObject({ payload: { itemId: maximumItemId } });
    expect(() => parseChatProjectionEventV5({
      ...inherited,
      sourceSchemaVersion: 4,
    })).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV5({
      ...inherited,
      payload: { ...inherited.payload, itemId: overlongItemId },
    })).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV4({ ...inherited, schemaVersion: 4 }))
      .toThrow(ChatContractError);
  });

  it("uses code-point maxLength only for true v5 history Items and Artifact names", () => {
    const maximumItemId = "😀".repeat(256);
    const maximumDisplayName = "😀".repeat(255);
    expect(new TextEncoder().encode(maximumItemId)).toHaveLength(1024);
    expect(new TextEncoder().encode(maximumDisplayName)).toHaveLength(1020);
    const artifact = {
      artifactId: "019fbf59-2000-7000-8000-000000000020",
      kind: "file",
      provenance: "synthetic",
      status: "ready",
      ordinal: 0,
      progressStage: null,
      progressPercent: null,
      displayName: maximumDisplayName,
      mediaType: "text/plain",
      sizeBytes: 1,
      localCommittedAt: 1,
      expiresAt: 604_801,
      hasPoster: false,
      errorCode: null,
      retryable: null,
    };
    const v5Item = {
      ...source(3),
      itemId: maximumItemId,
      itemOrdinal: 1,
      itemType: "command",
      phase: null,
      status: "completed",
      text: "",
      reasoningStatus: null,
      reasoningReasonCode: null,
      reasoningParts: [],
      startedAtMs: 1,
      completedAtMs: 2,
      execution: {
        kind: "command",
        status: "completed",
        startedSource: source(1),
        lastSource: source(3),
        commandSummary: summary,
        cwd,
        liveOutput: null,
        output: output("complete"),
        durationMs: 1,
        exitCode: 0,
        error: null,
      },
    };
    const commonTurn = {
      turnId: TURN_ID,
      status: "completed",
      terminalAt: 2,
      reasoningStatus: "unavailable",
      reasoningReasonCode: "reasoning_not_emitted",
      messages: [],
      reasoning: [],
      artifacts: [artifact],
      terminalCode: null,
      timelineItems: [v5Item],
      plan: null,
      notices: [],
    };
    const response = (turn: Record<string, unknown>) => ({
      schemaVersion: 5,
      requestId: CONTEXT_ID,
      data: {
        turns: [turn],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "3",
      },
    });
    const parsed = parseHistoryPageResponseV5(response({
      ...commonTurn,
      projectionAuthority: "v5",
    }));
    expect(parsed.turns[0]).toMatchObject({
      projectionAuthority: "v5",
      artifacts: [{ displayName: maximumDisplayName }],
      timelineItems: [{ itemId: maximumItemId }],
    });

    expect(() => parseHistoryPageResponseV5(response({
      ...commonTurn,
      projectionAuthority: "v5",
      timelineItems: [{ ...v5Item, itemId: `${maximumItemId}😀` }],
    }))).toThrow(ChatContractError);
    expect(() => parseHistoryPageResponseV5(response({
      ...commonTurn,
      projectionAuthority: "v5",
      artifacts: [{ ...artifact, displayName: `${maximumDisplayName}😀` }],
    }))).toThrow(ChatContractError);

    const v4Item = {
      ...source(3),
      itemId: maximumItemId,
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      status: "completed",
      text: "older final",
      reasoningStatus: null,
      reasoningReasonCode: null,
      reasoningParts: [],
      startedAtMs: 1,
      completedAtMs: 2,
    };
    expect(() => parseHistoryPageResponseV5(response({
      ...commonTurn,
      projectionAuthority: "v4",
      artifacts: [],
      timelineItems: [v4Item],
    }))).toThrow(ChatContractError);
    expect(() => parseHistoryPageResponseV5(response({
      ...commonTurn,
      projectionAuthority: "v4",
      timelineItems: [],
    }))).toThrow(ChatContractError);
  });

  it("decodes a mixed legacy/v4/v5 page without widening older Turn shapes", () => {
    const v4Item = {
      ...source(2),
      itemId: "v4-final",
      itemOrdinal: 1,
      itemType: "agentMessage",
      phase: "final_answer",
      status: "completed",
      text: "older final",
      reasoningStatus: null,
      reasoningReasonCode: null,
      reasoningParts: [],
      startedAtMs: 1,
      completedAtMs: 2,
    };
    const commonTurn = {
      status: "streaming",
      terminalAt: null,
      reasoningStatus: "pending",
      reasoningReasonCode: null,
      messages: [],
      reasoning: [],
      artifacts: [],
      terminalCode: null,
      plan: null,
      notices: [],
    };
    const turns = [{
      ...commonTurn,
      turnId: "019fbf59-2000-7000-8000-000000000010",
      projectionAuthority: "legacy",
      timelineItems: [],
    }, {
      ...commonTurn,
      turnId: "019fbf59-2000-7000-8000-000000000011",
      projectionAuthority: "v4",
      timelineItems: [v4Item],
    }, {
      ...commonTurn,
      turnId: "019fbf59-2000-7000-8000-000000000012",
      projectionAuthority: "v5",
      timelineItems: [{
        ...v4Item,
        ...source(3),
        itemId: "v5-command",
        itemType: "command",
        phase: null,
        text: "",
        execution: {
          kind: "command",
          status: "completed",
          startedSource: source(1),
          lastSource: source(3),
          commandSummary: summary,
          cwd,
          liveOutput: null,
          output: output("complete"),
          durationMs: 8,
          exitCode: 0,
          error: null,
        },
      }],
    }];
    const response = (mixedTurns: readonly unknown[]) => ({
      schemaVersion: 5,
      requestId: CONTEXT_ID,
      data: {
        turns: mixedTurns,
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "3",
      },
    });

    const parsed = parseHistoryPageResponseV5(response(turns));
    expect(parsed.schemaVersion).toBe(5);
    expect(parsed.turns.map((turn) => turn.projectionAuthority))
      .toEqual(["legacy", "v4", "v5"]);
    expect(parsed.turns[1]?.timelineItems[0]).not.toHaveProperty("execution");
    expect(parsed.turns[2]?.timelineItems[0]).toMatchObject({
      itemType: "command",
      execution: { kind: "command" },
    });

    const widenedV4 = turns.map((turn, index) => index === 1
      ? { ...turn, timelineItems: [{ ...v4Item, execution: null }] }
      : turn);
    expect(() => parseHistoryPageResponseV5(response(widenedV4)))
      .toThrow(ChatContractError);
    const narrowedV5 = turns.map((turn, index) => index === 2
      ? { ...turn, timelineItems: [{ ...turn.timelineItems[0], execution: undefined }] }
      : turn);
    expect(() => parseHistoryPageResponseV5(response(narrowedV5)))
      .toThrow(ChatContractError);
  });

  it("accepts all three authoritative Command output retention states", () => {
    for (const [index, retention] of (["complete", "head_tail", "unavailable"] as const).entries()) {
      const parsed = parseChatProjectionEventV5(event(index + 1, "command_completed", {
        ...source(index + 1),
        itemId: `command-${index}`,
        itemOrdinal: index + 1,
        status: "completed",
        commandSummary: summary,
        cwd,
        durationMs: 8,
        exitCode: 0,
        output: output(retention),
        error: null,
      }));

      expect(parsed.kind).toBe("command_completed");
      if (parsed.kind === "command_completed") {
        expect(parsed.payload.output.retention).toBe(retention);
      }
    }
  });

  it("enforces the UTF-8 16 KiB delta cap at a scalar boundary", () => {
    const withinLimit = "界".repeat(Math.floor((16 * 1024) / 3));
    expect(parseChatProjectionEventV5(event(1, "command_output_append", {
      ...source(1),
      itemId: "command-1",
      itemOrdinal: 1,
      text: withinLimit,
      truncated: false,
      truncationReason: null,
    }))).toMatchObject({ kind: "command_output_append" });

    expect(() => parseChatProjectionEventV5(event(1, "command_output_append", {
      ...source(1),
      itemId: "command-1",
      itemOrdinal: 1,
      text: `${withinLimit}界`,
      truncated: false,
      truncationReason: null,
    }))).toThrow(ChatContractError);
  });

  it("keeps an unknown Tool as a closed Tool identity", () => {
    const parsed = parseChatProjectionEventV5(event(1, "tool_completed", {
      ...source(1),
      itemId: "tool-unknown-1",
      itemOrdinal: 1,
      status: "failed",
      identity: { resolution: "unknown", serverName: "unknown", toolName: "unknown" },
      argumentsSummary: { text: "request metadata unavailable", truncated: false, truncationReason: null },
      durationMs: null,
      resultSummary: null,
      error: { code: "unknown_tool", summary: "tool is not registered" },
    }));

    expect(parsed).toMatchObject({
      kind: "tool_completed",
      payload: { identity: { resolution: "unknown", serverName: "unknown", toolName: "unknown" } },
    });
  });

  it("rejects extra execution fields, malformed unknown identity, and unknown wire variants", () => {
    expect(() => parseChatProjectionEventV5(event(1, "command_started", {
      ...source(1),
      itemId: "command-1",
      itemOrdinal: 1,
      status: "running",
      commandSummary: summary,
      cwd,
      unapprovedDetail: "benign extra field",
    }))).toThrow(ChatContractError);

    expect(() => parseChatProjectionEventV5(event(1, "tool_started", {
      ...source(1),
      itemId: "tool-1",
      itemOrdinal: 1,
      status: "in_progress",
      identity: { resolution: "unknown", serverName: "source-label", toolName: "unknown" },
      argumentsSummary: { text: "metadata", truncated: false, truncationReason: null },
    }))).toThrow(ChatContractError);

    expect(() => parseChatProjectionEventV5(event(1, "future.execution", {})))
      .toThrow(ChatContractError);
  });

  it("closes the inherited generic Item allowlist in v5 without changing v4", () => {
    const generic = event(1, "item_started", {
      ...source(1),
      itemId: "future-item",
      itemOrdinal: 1,
      itemType: "fileChange",
      phase: null,
      text: null,
    });
    expect(() => parseChatProjectionEventV5(generic)).toThrow(ChatContractError);
    expect(parseChatProjectionEventV4({ ...generic, schemaVersion: 4 }))
      .toMatchObject({ schemaVersion: 4, kind: "item_started" });
  });

  it("accepts only sticky v4 semantic markers and keeps generic Command/Tool inert", () => {
    for (const [index, itemType] of ["commandExecution", "mcpToolCall"].entries()) {
      const generic = event(index + 1, "item_started", {
        ...source(index + 1),
        itemId: `sticky-${index}`,
        itemOrdinal: index + 1,
        itemType,
        phase: null,
        text: null,
      });
      const parsed = parseChatProjectionEventV5({
        ...generic,
        sourceSchemaVersion: 4,
      });
      expect(parsed).toMatchObject({
        schemaVersion: 5,
        sourceSchemaVersion: 4,
        kind: "item_started",
        payload: { itemType },
      });
      expect(() => parseChatProjectionEventV5(generic)).toThrow(ChatContractError);
      expect(parseChatProjectionEventV4({ ...generic, schemaVersion: 4 }))
        .toMatchObject({ schemaVersion: 4, kind: "item_started", payload: { itemType } });
      expect(() => parseChatProjectionEventV4({
        ...generic,
        schemaVersion: 4,
        sourceSchemaVersion: 4,
      })).toThrow(ChatContractError);
    }

    expect(() => parseChatProjectionEventV5({
      ...event(3, "command_started", {
        ...source(3),
        itemId: "command-marker",
        itemOrdinal: 1,
        status: "running",
        commandSummary: summary,
        cwd,
      }),
      sourceSchemaVersion: 4,
    })).toThrow(ChatContractError);

    const control = {
      schemaVersion: 5,
      subscriptionId: SUBSCRIPTION_ID,
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      projectionSequence: "4",
      eventId: "019fbf59-2000-7000-8000-000000000030",
      kind: "resync_required",
      payload: { reason: "protocol_error" },
    };
    expect(() => parseChatProjectionEventV5({
      ...control,
      sourceSchemaVersion: 4,
    })).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV5({
      ...event(5, "item_started", {
        ...source(5),
        itemId: "bad-marker",
        itemOrdinal: 1,
        itemType: "webSearch",
        phase: null,
        text: null,
      }),
      sourceSchemaVersion: null,
    })).toThrow(ChatContractError);
  });
});
