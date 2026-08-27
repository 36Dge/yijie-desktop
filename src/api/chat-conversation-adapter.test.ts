import { describe, expect, it } from "vitest";
import type { ChatHistoryPage, ChatProjectionEvent } from "../domain/chat-ipc";
import {
  createConversationState,
  hydrateConversationState,
  reduceConversationEvent,
  selectConversationItem,
  selectConversationTurn,
  serializeConversationState,
} from "../domain/conversation-state";
import {
  conversationArtifactItemId,
  conversationMessageItemId,
  conversationReasoningItemId,
  historyPageToConversationSnapshot,
  projectionEventToConversation,
} from "./chat-conversation-adapter";

const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const TURN_ID = "019c1a00-0000-7000-8000-000000000003";
const SUBSCRIPTION_ID = "019c1a00-0000-7000-8000-000000000004";

function event(
  sequence: number,
  kind: ChatProjectionEvent["kind"],
  payload: ChatProjectionEvent["payload"],
): ChatProjectionEvent {
  return {
    schemaVersion: 1,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    subscriptionId: SUBSCRIPTION_ID,
    turnId: TURN_ID,
    projectionSequence: String(sequence),
    eventId: `019c1a00-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    kind,
    payload,
  } as ChatProjectionEvent;
}

function history(): ChatHistoryPage {
  return Object.freeze({
    turns: Object.freeze([Object.freeze({
      turnId: TURN_ID,
      status: "completed",
      terminalAt: 2,
      reasoningStatus: "complete",
      reasoningReasonCode: null,
      messages: Object.freeze([
        Object.freeze({
          messageId: "019c1a00-0000-7000-8000-000000000011",
          role: "user" as const,
          content: "hello",
          contentBlocks: Object.freeze([
            Object.freeze({ type: "text" as const, text: "hello" }),
            Object.freeze({
              attachmentId: "019c1a00-0000-7000-8000-000000000012",
              type: "file" as const,
              name: "synthetic.txt",
              mediaType: "text/plain" as const,
              sizeBytes: 5,
              status: "bound" as const,
              expiresAt: 100,
            }),
          ]),
          status: "committed",
          ordinal: 0,
          createdAt: 1,
        }),
        Object.freeze({
          messageId: "019c1a00-0000-7000-8000-000000000013",
          role: "assistant" as const,
          content: "answer",
          contentBlocks: Object.freeze([Object.freeze({ type: "text" as const, text: "answer" })]),
          status: "committed",
          ordinal: 1,
          createdAt: 2,
        }),
      ]),
      reasoning: Object.freeze([Object.freeze({
        itemOrdinal: 0,
        status: "complete" as const,
        reasonCode: null,
        totalBytes: 4,
        partCount: 1,
        finalizedAtMs: 2_000,
      })]),
      artifacts: Object.freeze([Object.freeze({
        artifactId: "019c1a00-0000-7000-8000-000000000014",
        kind: "report" as const,
        provenance: "synthetic" as const,
        status: "ready" as const,
        ordinal: 0,
        progressStage: null,
        progressPercent: null,
        displayName: "Synthetic report",
        mediaType: "application/pdf",
        sizeBytes: 10,
        localCommittedAt: 2,
        expiresAt: 100,
        hasPoster: false,
        errorCode: null,
        retryable: null,
      })]),
    })]),
    nextCursor: null,
  });
}

describe("FEAT-132 chat conversation adapters", () => {
  it("hydrates messages, attachment, reasoning metadata, and artifact into stable local items", () => {
    const state = hydrateConversationState(historyPageToConversationSnapshot(SESSION_ID, history()));

    expect(selectConversationTurn(state, SESSION_ID, TURN_ID)).toMatchObject({
      status: "completed",
      terminalStatus: "completed",
    });
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "user"),
    )?.contentBlocks).toEqual([
      { blockIndex: 0, type: "text", text: "hello" },
      expect.objectContaining({
        blockIndex: 1,
        type: "attachment_reference",
        attachmentId: "019c1a00-0000-7000-8000-000000000012",
      }),
    ]);
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationReasoningItemId(TURN_ID, 0),
    )?.kind).toBe("reasoning");
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationArtifactItemId(TURN_ID, "019c1a00-0000-7000-8000-000000000014"),
    )?.kind).toBe("artifact");
  });

  it("produces byte-identical state for reordered history inputs", () => {
    const original = historyPageToConversationSnapshot(SESSION_ID, history());
    const reorderedPage = Object.freeze({ ...history(), turns: Object.freeze([...history().turns].reverse()) });
    const reordered = historyPageToConversationSnapshot(SESSION_ID, reorderedPage);

    expect(serializeConversationState(hydrateConversationState(original)))
      .toBe(serializeConversationState(hydrateConversationState(reordered)));
  });

  it("maps interleaved assistant and reasoning deltas to different stable Item identities", () => {
    const inputs = [
      event(1, "assistant_append", { text: "A1" }),
      event(2, "reasoning_append", { itemOrdinal: 0, contentIndex: 0, text: "R1" }),
      event(3, "assistant_append", { text: "A2" }),
      event(4, "reasoning_append", { itemOrdinal: 0, contentIndex: 0, text: "R2" }),
    ];
    const state = inputs.reduce((current, input) => {
      const adapted = projectionEventToConversation(input);
      expect(adapted.kind).toBe("domain_event");
      return adapted.kind === "domain_event"
        ? reduceConversationEvent(current, adapted.event)
        : current;
    }, createConversationState());

    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "A1A2" }]);
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationReasoningItemId(TURN_ID, 0),
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "R1R2" }]);
  });

  it("keeps lifecycle control events explicit and rejects content events without turn identity", () => {
    expect(projectionEventToConversation(event(1, "turn_state", { status: "streaming" })))
      .toMatchObject({ kind: "domain_event", event: { kind: "turn.started", ordinal: null } });
    expect(projectionEventToConversation(event(2, "turn_terminal", { status: "completed" })))
      .toMatchObject({ kind: "domain_event", event: { kind: "turn.completed", terminalStatus: "completed" } });
    expect(projectionEventToConversation(event(3, "resync_required", { reason: "backpressure" })))
      .toEqual({ kind: "resync_required", reason: "projection_gap" });
    expect(projectionEventToConversation(event(4, "cleanup_state", {
      operationId: "019c1a00-0000-7000-8000-000000000099",
      state: "pending",
    }))).toMatchObject({
      kind: "cleanup_state",
      event: {
        kind: "auxiliary",
        streamId: SUBSCRIPTION_ID,
        sequence: "4",
        threadId: SESSION_ID,
      },
    });
    expect(projectionEventToConversation({
      ...event(5, "assistant_append", { text: "safe" }),
      turnId: undefined,
    })).toEqual({ kind: "resync_required", reason: "invalid_projection" });
  });
});
