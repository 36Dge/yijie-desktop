import { describe, expect, it } from "vitest";
import type { ChatHistoryPage } from "../../src/domain/chat-ipc";
import { parseChatProjectionEvent } from "../../src/domain/chat-ipc";
import {
  createConversationState,
  hydrateConversationState,
  reconcileConversationSnapshot,
  reduceConversationEvent,
  selectConversationItem,
  selectConversationTurn,
  serializeConversationState,
} from "../../src/domain/conversation-state";
import {
  conversationMessageItemId,
  conversationReasoningItemId,
  historyPageToConversationSnapshot,
  projectionEventToConversation,
} from "../../src/api/chat-conversation-adapter";

const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000201";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000202";
const TURN_ID = "019c1a00-0000-7000-8000-000000000203";
const SUBSCRIPTION_ID = "019c1a00-0000-7000-8000-000000000204";
const SECOND_TURN_ID = "019c1a00-0000-7000-8000-000000000205";

function rawEvent(
  projectionSequence: string,
  eventId: string,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
  turnId = TURN_ID,
): unknown {
  return {
    schemaVersion: 1,
    subscriptionId: SUBSCRIPTION_ID,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    turnId,
    projectionSequence,
    eventId,
    kind,
    payload,
  };
}

const RAW_EVENTS = Object.freeze([
  rawEvent("1", "019c1a00-0000-7000-8000-000000000211", "turn_state", { status: "streaming" }),
  rawEvent("2", "019c1a00-0000-7000-8000-000000000212", "reasoning_append", {
    itemOrdinal: 0,
    contentIndex: 0,
    text: "safe reasoning summary",
  }),
  rawEvent("3", "019c1a00-0000-7000-8000-000000000213", "assistant_append", {
    text: "final",
  }),
  // A repeated event id remains a no-op even if a malformed producer changes
  // only its sequence. The following legitimate event must still be sequence 4.
  rawEvent("99", "019c1a00-0000-7000-8000-000000000213", "assistant_append", {
    text: "must-not-repeat",
  }),
  rawEvent("4", "019c1a00-0000-7000-8000-000000000214", "turn_terminal", {
    status: "completed",
  }),
]);

const AUTHORITATIVE_HISTORY: ChatHistoryPage = Object.freeze({
  turns: Object.freeze([Object.freeze({
    turnId: TURN_ID,
    status: "completed",
    terminalAt: 10,
    reasoningStatus: "complete",
    reasoningReasonCode: null,
    messages: Object.freeze([Object.freeze({
      messageId: "019c1a00-0000-7000-8000-000000000221",
      role: "assistant" as const,
      content: "final answer",
      contentBlocks: Object.freeze([Object.freeze({ type: "text" as const, text: "final answer" })]),
      status: "completed",
      ordinal: 0,
      createdAt: 10,
    })]),
    reasoning: Object.freeze([]),
    artifacts: Object.freeze([]),
  })]),
  nextCursor: null,
});

function replay() {
  let state = createConversationState();
  const trajectory: string[] = [];
  for (const raw of RAW_EVENTS) {
    const parsed = parseChatProjectionEvent(raw);
    const adapted = projectionEventToConversation(parsed);
    expect(adapted.kind).toBe("domain_event");
    if (adapted.kind === "domain_event") {
      state = reduceConversationEvent(state, adapted.event);
    }
    trajectory.push(selectConversationTurn(state, SESSION_ID, TURN_ID)?.status ?? "missing");
  }
  return { state, trajectory };
}

describe("FEAT-132 production projection replay", () => {
  it("is deterministic from strict parser through terminal snapshot reconciliation", () => {
    const first = replay();
    const second = replay();

    expect(first.trajectory).toEqual([
      "in_progress",
      "in_progress",
      "in_progress",
      "in_progress",
      "completed",
    ]);
    expect(serializeConversationState(first.state)).toBe(serializeConversationState(second.state));
    expect(selectConversationItem(
      first.state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "final" }]);
    expect(selectConversationItem(
      first.state,
      SESSION_ID,
      TURN_ID,
      conversationReasoningItemId(TURN_ID, 0),
    )?.contentBlocks).toEqual([{
      blockIndex: 0,
      type: "text",
      text: "safe reasoning summary",
    }]);

    const reconciled = reconcileConversationSnapshot(
      first.state,
      historyPageToConversationSnapshot(SESSION_ID, AUTHORITATIVE_HISTORY),
    );
    expect(reconciled.syncStatus).toBe("synchronized");
    expect(reconciled.threads[SESSION_ID]?.status).toBe("ready");
    expect(selectConversationItem(
      reconciled,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toMatchObject({
      status: "completed",
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "final answer" }],
    });
  });

  it("starts a second historical Turn without treating its unknown live ordinal as drift", () => {
    const history: ChatHistoryPage = Object.freeze({
      turns: Object.freeze([
        AUTHORITATIVE_HISTORY.turns[0]!,
        Object.freeze({
          turnId: SECOND_TURN_ID,
          status: "queued",
          terminalAt: null,
          reasoningStatus: "incomplete",
          reasoningReasonCode: null,
          messages: Object.freeze([]),
          reasoning: Object.freeze([]),
          artifacts: Object.freeze([]),
        }),
      ]),
      nextCursor: null,
    });
    const historical = hydrateConversationState(
      historyPageToConversationSnapshot(SESSION_ID, history),
    );
    const parsed = parseChatProjectionEvent(rawEvent(
      "1",
      "019c1a00-0000-7000-8000-000000000231",
      "turn_state",
      { status: "streaming" },
      SECOND_TURN_ID,
    ));
    const adapted = projectionEventToConversation(parsed);

    expect(adapted).toMatchObject({
      kind: "domain_event",
      event: { kind: "turn.started", ordinal: null },
    });
    expect(adapted.kind).toBe("domain_event");
    if (adapted.kind !== "domain_event") return;

    const started = reduceConversationEvent(historical, adapted.event);
    expect(started.syncStatus).toBe("synchronized");
    expect(selectConversationTurn(started, SESSION_ID, SECOND_TURN_ID)).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });
  });
});
