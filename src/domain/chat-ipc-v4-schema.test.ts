import { describe, expect, it } from "vitest";
import {
  ChatContractError,
  parseChatProjectionEventV4,
  parseHistoryPageResponseV4,
  parseResyncResponseV4,
  parseSubscriptionResponseV4,
} from "./chat-ipc";

const REQUEST_ID = "13400000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID = "13400000-0000-4000-8000-000000000002";
const CONTEXT_ID = "13400000-0000-4000-8000-000000000003";
const SESSION_ID = "13400000-0000-4000-8000-000000000004";
const TURN_ID = "13400000-0000-4000-8000-000000000005";
const EVENT_ID = "13400000-0000-4000-8000-000000000006";
const SOURCE_EVENT_ID = "13400000-0000-4000-8000-000000000007";
const MESSAGE_ID = "13400000-0000-4000-8000-000000000008";
const OCCURRED_AT = "2026-08-28T06:00:00Z";

function source() {
  return {
    sourceEventId: SOURCE_EVENT_ID,
    sourceSequence: "3",
    sourceOccurredAt: OCCURRED_AT,
  };
}

function event(kind: string, payload: Record<string, unknown>, turnId: string | null = TURN_ID) {
  const control = kind === "resync_required" || kind === "context_invalidated";
  return {
    schemaVersion: 4,
    subscriptionId: SUBSCRIPTION_ID,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    ...(turnId === null ? {} : { turnId }),
    projectionSequence: "2",
    eventId: EVENT_ID,
    ...(control ? {} : { durableSequence: "2" }),
    kind,
    payload,
  };
}

function emptyHistory() {
  return {
    turns: [],
    nextCursor: null,
    sessionNotices: [],
    durableSequenceCut: "0",
  };
}

function response(data: unknown) {
  return { schemaVersion: 4, requestId: REQUEST_ID, data };
}

describe("FEAT-134 chat IPC v4", () => {
  it("parses authoritative item identity and nullable AgentMessage phase", () => {
    const parsed = parseChatProjectionEventV4(event("item_started", {
      ...source(),
      itemId: "agent-message-1",
      itemOrdinal: 2,
      itemType: "agentMessage",
      phase: null,
      text: "",
    }));

    expect(parsed.kind).toBe("item_started");
    if (parsed.kind !== "item_started") throw new Error("unexpected kind");
    expect(parsed.payload).toMatchObject({
      itemId: "agent-message-1",
      itemOrdinal: 2,
      phase: null,
    });

    const maximumItemType = "x".repeat(256);
    expect(parseChatProjectionEventV4(event("item_started", {
      ...source(),
      itemId: "future-item",
      itemOrdinal: 3,
      itemType: maximumItemType,
      phase: null,
      text: null,
    })).kind).toBe("item_started");
    expect(() => parseChatProjectionEventV4(event("item_started", {
      ...source(),
      itemId: "future-item-overflow",
      itemOrdinal: 4,
      itemType: `${maximumItemType}x`,
      phase: null,
      text: null,
    }))).toThrow(ChatContractError);
  });

  it("accepts Host-valid AgentMessage deltas through the private 1 MiB boundary", () => {
    const aboveLegacyLimit = "a".repeat(64 * 1024 + 1);
    const maximumDelta = "b".repeat(1024 * 1024);
    const payload = (text: string) => ({
      ...source(),
      itemId: "agent-message-large-delta",
      itemOrdinal: 1,
      phase: "commentary",
      text,
    });

    expect(parseChatProjectionEventV4(event("agent_message_append", payload(aboveLegacyLimit))).kind)
      .toBe("agent_message_append");
    expect(parseChatProjectionEventV4(event("agent_message_append", payload(maximumDelta))).kind)
      .toBe("agent_message_append");
    expect(() => parseChatProjectionEventV4(event(
      "agent_message_append",
      payload(`${maximumDelta}x`),
    ))).toThrow(ChatContractError);
  });

  it("requires durable positions only on semantic events and an explicit history cut", () => {
    const semantic = event("turn_started", source());
    const withoutDurableSequence = Object.fromEntries(
      Object.entries(semantic).filter(([key]) => key !== "durableSequence"),
    );
    expect(() => parseChatProjectionEventV4(withoutDurableSequence)).toThrow(ChatContractError);

    const control = event("resync_required", { reason: "sequence_gap" }, null);
    expect(parseChatProjectionEventV4(control).kind).toBe("resync_required");
    expect(() => parseChatProjectionEventV4({ ...control, durableSequence: "1" }))
      .toThrow(ChatContractError);

    const withoutCut = Object.fromEntries(
      Object.entries(emptyHistory()).filter(([key]) => key !== "durableSequenceCut"),
    );
    expect(() => parseHistoryPageResponseV4(response(withoutCut))).toThrow(ChatContractError);
    expect(parseHistoryPageResponseV4(response(emptyHistory())).durableSequenceCut).toBe("0");
  });

  it("requires an explicit closed reason for unfinished reasoning at turn terminal", () => {
    const terminal = parseChatProjectionEventV4(event("turn_terminal", {
      ...source(),
      status: "interrupted",
      code: "turn_interrupted",
      unfinishedReasoningReasonCode: "turn_interrupted",
    }));
    expect(terminal.kind).toBe("turn_terminal");
    if (terminal.kind !== "turn_terminal") throw new Error("unexpected kind");
    expect(terminal.payload.unfinishedReasoningReasonCode).toBe("turn_interrupted");

    expect(() => parseChatProjectionEventV4(event("turn_terminal", {
      ...source(),
      status: "interrupted",
      code: "turn_interrupted",
    }))).toThrow(ChatContractError);
    expect(() => parseChatProjectionEventV4(event("turn_terminal", {
      ...source(),
      status: "interrupted",
      code: "turn_interrupted",
      unfinishedReasoningReasonCode: "invented_reason",
    }))).toThrow(ChatContractError);
  });

  it("accepts contract-valid high-precision RFC3339 facts live and in history", () => {
    const highPrecisionOccurredAt = "2026-08-28T06:00:00.1234567890Z";
    const live = parseChatProjectionEventV4(event("turn_started", {
      ...source(),
      sourceOccurredAt: highPrecisionOccurredAt,
    }));
    expect(live.kind).toBe("turn_started");
    if (live.kind !== "turn_started") throw new Error("unexpected kind");
    expect(live.payload.sourceOccurredAt).toBe(highPrecisionOccurredAt);

    const history = parseHistoryPageResponseV4(response({
      ...emptyHistory(),
      sessionNotices: [{
        ...source(),
        sourceOccurredAt: highPrecisionOccurredAt,
        scope: "session",
        severity: "warning",
        code: null,
        willRetry: false,
        observedAtMs: 30,
      }],
    }));
    expect(history.sessionNotices[0]?.sourceOccurredAt).toBe(highPrecisionOccurredAt);

    const overlongOccurredAt = `2026-08-28T06:00:00.${"1".repeat(44)}Z`;
    expect(overlongOccurredAt).toHaveLength(65);
    expect(() => parseChatProjectionEventV4(event("turn_started", {
      ...source(),
      sourceOccurredAt: overlongOccurredAt,
    }))).toThrow(ChatContractError);
    expect(() => parseHistoryPageResponseV4(response({
      ...emptyHistory(),
      sessionNotices: [{
        ...source(),
        sourceOccurredAt: overlongOccurredAt,
        scope: "session",
        severity: "warning",
        code: null,
        willRetry: false,
        observedAtMs: 30,
      }],
    }))).toThrow(ChatContractError);
  });

  it("parses stable plan snapshots and treats the empty snapshot as a valid live clear", () => {
    const parsed = parseChatProjectionEventV4(event("plan_updated", {
      ...source(),
      explanation: null,
      steps: [],
    }));

    expect(parsed.kind).toBe("plan_updated");
    if (parsed.kind !== "plan_updated") throw new Error("unexpected kind");
    expect(parsed.payload.steps).toEqual([]);

    const missingText = parseChatProjectionEventV4(event("plan_updated", {
      ...source(),
      explanation: null,
      steps: [{ ordinal: 0, step: "", status: "in_progress" }],
    }));
    expect(missingText.kind).toBe("plan_updated");
    if (missingText.kind !== "plan_updated") throw new Error("unexpected kind");
    expect(missingText.payload.steps[0]).toEqual({
      ordinal: 0,
      step: "",
      status: "in_progress",
    });
  });

  it("keeps raw reasoning typed, bounded, and content-only", () => {
    const parsed = parseChatProjectionEventV4(event("reasoning_finalized", {
      ...source(),
      itemId: "reasoning-1",
      itemOrdinal: 512,
      status: "incomplete",
      reasonCode: "turn_interrupted",
      parts: [{ contentIndex: 0, text: "synthetic reasoning text" }],
    }));

    expect(parsed.kind).toBe("reasoning_finalized");
    if (parsed.kind !== "reasoning_finalized") throw new Error("unexpected kind");
    expect(parsed.payload.parts[0]?.text).toBe("synthetic reasoning text");

    expect(() => parseChatProjectionEventV4(event("reasoning_append", {
      ...source(),
      itemId: "reasoning-overflow",
      itemOrdinal: 513,
      contentIndex: 0,
      text: "synthetic reasoning text",
    }))).toThrow(ChatContractError);
  });

  it("rejects message bodies and invalid attribution in private notices", () => {
    expect(() => parseChatProjectionEventV4(event("notice", {
      ...source(),
      scope: "turn",
      severity: "error",
      code: "runtime_error",
      willRetry: false,
      message: "must not cross the private boundary",
    }))).toThrow(ChatContractError);

    expect(() => parseChatProjectionEventV4(event("notice", {
      ...source(),
      scope: "session",
      severity: "warning",
      code: null,
      willRetry: false,
    }))).toThrow(ChatContractError);

    expect(parseChatProjectionEventV4(event("notice", {
      ...source(),
      scope: "session",
      severity: "warning",
      code: null,
      willRetry: false,
    }, null)).kind).toBe("notice");
  });

  it("parses durable v4 history without replacing attachment or Artifact authority", () => {
    const page = parseHistoryPageResponseV4(response({
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "completed",
        terminalAt: 100,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: [{
          messageId: MESSAGE_ID,
          role: "user",
          content: "synthetic request",
          contentBlocks: [{ type: "text", text: "synthetic request" }],
          status: "complete",
          ordinal: 0,
          createdAt: 1,
        }],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [{
          ...source(),
          itemId: "agent-message-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer",
          status: "completed",
          text: "synthetic final",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: [],
          startedAtMs: 10,
          completedAtMs: 20,
        }],
        plan: {
          ...source(),
          explanation: "synthetic plan",
          steps: [{ ordinal: 0, step: "", status: "completed" }],
        },
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [{
        ...source(),
        scope: "session",
        severity: "warning",
        code: "synthetic_warning",
        willRetry: false,
        observedAtMs: 30,
      }],
      durableSequenceCut: "30",
    }));

    expect(page.turns[0]?.messages[0]?.content).toBe("synthetic request");
    expect(page.turns[0]?.artifacts).toEqual([]);
    expect(page.turns[0]?.timelineItems[0]?.phase).toBe("final_answer");
    expect(page.turns[0]?.plan?.steps[0]?.step).toBe("");
    expect(page.sessionNotices[0]?.scope).toBe("session");
  });

  it("keeps reasoning finalization independent from item lifecycle during hydration", () => {
    const page = parseHistoryPageResponseV4(response({
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: [],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [{
          ...source(),
          itemId: "reasoning-finalized-before-item-completed",
          itemOrdinal: 1,
          itemType: "reasoning",
          phase: null,
          status: "in_progress",
          text: "",
          reasoningStatus: "complete",
          reasoningReasonCode: null,
          reasoningParts: [{ contentIndex: 0, text: "synthetic reasoning text" }],
          startedAtMs: 10,
          completedAtMs: null,
        }],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "5",
    }));

    expect(page.turns[0]?.timelineItems[0]).toMatchObject({
      status: "in_progress",
      reasoningStatus: "complete",
      completedAtMs: null,
    });

    const invalidReasoning = {
      ...page.turns[0]!.timelineItems[0]!,
      reasoningStatus: "unavailable",
    };
    expect(() => parseHistoryPageResponseV4(response({
      turns: [{
        ...page.turns[0],
        timelineItems: [invalidReasoning],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "5",
    }))).toThrow(ChatContractError);
  });

  it("rejects a non-null empty durable plan and raw message leakage in history", () => {
    const invalidTurn = {
      turnId: TURN_ID,
      projectionAuthority: "v4",
      status: "completed",
      terminalAt: 100,
      reasoningStatus: "unavailable",
      reasoningReasonCode: "reasoning_not_emitted",
      messages: [],
      reasoning: [],
      artifacts: [],
      terminalCode: null,
      timelineItems: [],
      plan: { ...source(), explanation: null, steps: [] },
      notices: [],
    };
    expect(() => parseHistoryPageResponseV4(response({
      turns: [invalidTurn],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "1",
    }))).toThrow(ChatContractError);

    expect(() => parseHistoryPageResponseV4(response({
      turns: [],
      nextCursor: null,
      sessionNotices: [{
        ...source(),
        scope: "session",
        severity: "warning",
        code: null,
        willRetry: false,
        observedAtMs: 30,
        message: "must not persist",
      }],
      durableSequenceCut: "30",
    }))).toThrow(ChatContractError);

    const legacyAssistantTurn = {
      ...invalidTurn,
      projectionAuthority: "legacy",
      plan: null,
      messages: [{
        messageId: MESSAGE_ID,
        role: "assistant",
        content: "legacy answer",
        contentBlocks: [{ type: "text", text: "legacy answer" }],
        status: "complete",
        ordinal: 0,
        createdAt: 1,
      }],
    };
    expect(parseHistoryPageResponseV4(response({
      turns: [legacyAssistantTurn],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "30",
    })).turns[0]?.messages[0]?.role).toBe("assistant");

    expect(() => parseHistoryPageResponseV4(response({
      turns: [{
        ...legacyAssistantTurn,
        projectionAuthority: "v4",
        timelineItems: [{
          ...source(),
          itemId: "agent-message-authority",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer",
          status: "completed",
          text: "v4 answer",
          reasoningStatus: null,
          reasoningReasonCode: null,
          reasoningParts: [],
          startedAtMs: 10,
          completedAtMs: 20,
        }],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "30",
    }))).toThrow(ChatContractError);
  });

  it("parses v4 subscription and resync envelopes and rejects older schema responses", () => {
    expect(parseSubscriptionResponseV4(response({ subscriptionId: SUBSCRIPTION_ID })))
      .toBe(SUBSCRIPTION_ID);

    const session = {
      sessionId: SESSION_ID,
      projectId: "13400000-0000-4000-8000-000000000009",
      title: "Synthetic session",
      titleSource: "fallback",
      pinnedAt: null,
      lastActivityAt: 1,
      latestTurnStatus: null,
      projectAvailable: true,
    };
    expect(parseResyncResponseV4(response({
      session,
      history: emptyHistory(),
      cleanup: null,
    })).history.sessionNotices).toEqual([]);

    expect(() => parseSubscriptionResponseV4({
      schemaVersion: 3,
      requestId: REQUEST_ID,
      data: { subscriptionId: SUBSCRIPTION_ID },
    })).toThrow(ChatContractError);
  });
});
