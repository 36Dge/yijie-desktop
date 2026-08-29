import { describe, expect, it } from "vitest";
import type {
  ChatHistoryPageV4,
  ChatProjectionEventV4,
  ChatTimelineItemV4,
} from "../domain/chat-ipc";
import {
  createConversationState,
  hydrateConversationState,
  reduceConversationEvent,
  selectConversationItem,
  selectConversationTurn,
} from "../domain/conversation-state";
import {
  conversationArtifactItemId,
  conversationMessageItemId,
  historyPageV4ToConversationSnapshot,
  projectionEventToConversation,
} from "./chat-conversation-adapter";

const CONTEXT_ID = "019fbf58-0000-7000-8000-000000000001";
const SESSION_ID = "019fbf58-0000-7000-8000-000000000002";
const TURN_ID = "019fbf58-0000-7000-8000-000000000003";
const SUBSCRIPTION_ID = "019fbf58-0000-7000-8000-000000000004";

function source(sequence: number) {
  return {
    sourceEventId: `source-event-${sequence}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-28T00:00:00Z",
  } as const;
}

function eventV4(
  sequence: number,
  kind: ChatProjectionEventV4["kind"],
  payload: ChatProjectionEventV4["payload"],
  turnId: string | null = TURN_ID,
): ChatProjectionEventV4 {
  return {
    schemaVersion: 4,
    contextId: CONTEXT_ID,
    sessionId: SESSION_ID,
    subscriptionId: SUBSCRIPTION_ID,
    ...(turnId === null ? {} : { turnId }),
    projectionSequence: String(sequence),
    eventId: `019fbf58-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    ...(kind === "resync_required" || kind === "context_invalidated"
      ? {}
      : { durableSequence: String(sequence) }),
    kind,
    payload,
  } as ChatProjectionEventV4;
}

function reduceV4(events: readonly ChatProjectionEventV4[]) {
  return events.reduce((state, event) => {
    const adapted = projectionEventToConversation(event);
    expect(adapted.kind).toBe("domain_event");
    return adapted.kind === "domain_event"
      ? reduceConversationEvent(state, adapted.event)
      : state;
  }, createConversationState());
}

function timelineItem(
  overrides: Partial<ChatTimelineItemV4> & Pick<ChatTimelineItemV4, "itemId" | "itemOrdinal" | "itemType">,
): ChatTimelineItemV4 {
  return {
    ...source(overrides.itemOrdinal + 10),
    phase: null,
    status: "completed",
    text: "",
    reasoningStatus: null,
    reasoningReasonCode: null,
    reasoningParts: [],
    startedAtMs: 1,
    completedAtMs: 2,
    ...overrides,
  };
}

describe("FEAT-134 private projection conversation adapter", () => {
  it("maps true item lifecycle, phase, plan, reasoning, notices and terminal without inference", () => {
    const state = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "plan_updated", {
        ...source(2),
        explanation: null,
        steps: [{ ordinal: 0, step: "safe step", status: "in_progress" }],
      }),
      eventV4(3, "item_started", {
        ...source(3),
        itemId: "commentary",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "commentary",
        text: "",
      }),
      eventV4(4, "agent_message_append", {
        ...source(4),
        itemId: "commentary",
        itemOrdinal: 1,
        phase: "commentary",
        text: "process",
      }),
      eventV4(5, "item_completed", {
        ...source(5),
        itemId: "commentary",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "commentary",
        text: "process",
      }),
      eventV4(6, "item_started", {
        ...source(6),
        itemId: "unclassified",
        itemOrdinal: 2,
        itemType: "agentMessage",
        phase: null,
        text: "",
      }),
      eventV4(7, "agent_message_append", {
        ...source(7),
        itemId: "unclassified",
        itemOrdinal: 2,
        phase: null,
        text: "unknown",
      }),
      eventV4(8, "item_completed", {
        ...source(8),
        itemId: "unclassified",
        itemOrdinal: 2,
        itemType: "agentMessage",
        phase: null,
        text: "unknown",
      }),
      eventV4(9, "reasoning_append", {
        ...source(9),
        itemId: "reasoning",
        itemOrdinal: 3,
        contentIndex: 0,
        text: "raw",
      }),
      eventV4(10, "reasoning_finalized", {
        ...source(10),
        itemId: "reasoning",
        itemOrdinal: 3,
        status: "incomplete",
        reasonCode: "stream_gap",
        parts: [{ contentIndex: 0, text: "raw" }],
      }),
      eventV4(11, "item_completed", {
        ...source(11),
        itemId: "reasoning",
        itemOrdinal: 3,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(12, "notice", {
        ...source(12),
        scope: "session",
        severity: "warning",
        code: "safe_warning",
        willRetry: false,
      }, null),
      eventV4(13, "notice", {
        ...source(13),
        scope: "turn",
        severity: "error",
        code: "safe_error",
        willRetry: false,
      }),
      eventV4(14, "turn_terminal", {
        ...source(14),
        status: "failed",
        code: "limit_exceeded",
        unfinishedReasoningReasonCode: "runtime_error",
      }),
    ]);

    expect(state.syncStatus).toBe("synchronized");
    expect(state.threads[SESSION_ID]?.notices).toEqual([
      { severity: "warning", code: "conversation_warning" },
    ]);
    expect(selectConversationTurn(state, SESSION_ID, TURN_ID)).toMatchObject({
      terminalStatus: "failed",
      terminalCode: "limit_exceeded",
      plan: { steps: [{ ordinal: 0, text: "safe step", status: "in_progress" }] },
      notices: [{ severity: "error", code: "conversation_error" }],
    });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "commentary"))
      .toMatchObject({ ordinal: 1, agentMessagePhase: "commentary" });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "unclassified"))
      .toMatchObject({ ordinal: 2, agentMessagePhase: "unknown" });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "reasoning"))
      .toMatchObject({
        ordinal: 3,
        status: "completed",
        reasoning: { status: "incomplete", reasonCode: "stream_gap" },
        contentBlocks: [{ blockIndex: 0, type: "text", text: "raw" }],
      });
    expect(Object.values(state.items).some((item) => item.agentMessagePhase === "final_answer"))
      .toBe(false);
  });

  it("maps v4 terminal without inventing item.completed for an active item", () => {
    const state = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "item_started", {
        ...source(2),
        itemId: "unfinished-commentary",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "commentary",
        text: "",
      }),
      eventV4(3, "agent_message_append", {
        ...source(3),
        itemId: "unfinished-commentary",
        itemOrdinal: 1,
        phase: "commentary",
        text: "partial",
      }),
      eventV4(4, "item_started", {
        ...source(4),
        itemId: "reasoning-without-finalized",
        itemOrdinal: 2,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(5, "reasoning_append", {
        ...source(5),
        itemId: "reasoning-without-finalized",
        itemOrdinal: 2,
        contentIndex: 0,
        text: "verified prefix",
      }),
      eventV4(6, "turn_terminal", {
        ...source(6),
        status: "interrupted",
        code: "turn_interrupted",
        unfinishedReasoningReasonCode: "turn_interrupted",
      }),
    ]);

    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "unfinished-commentary"))
      .toMatchObject({ status: "incomplete", contentBlocks: [{ text: "partial" }] });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "reasoning-without-finalized"))
      .toMatchObject({
        status: "incomplete",
        reasoning: { status: "incomplete", reasonCode: "turn_interrupted" },
      });

    const hydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(SESSION_ID, {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "interrupted",
        terminalAt: 6,
        reasoningStatus: "incomplete",
        reasoningReasonCode: "turn_interrupted",
        messages: [],
        reasoning: [],
        artifacts: [],
        terminalCode: "turn_interrupted",
        timelineItems: [
          timelineItem({
            itemId: "unfinished-commentary",
            itemOrdinal: 1,
            itemType: "agentMessage",
            phase: "commentary",
            status: "incomplete",
            text: "partial",
            completedAtMs: 5,
          }),
          timelineItem({
            itemId: "reasoning-without-finalized",
            itemOrdinal: 2,
            itemType: "reasoning",
            status: "incomplete",
            reasoningStatus: "incomplete",
            reasoningReasonCode: "turn_interrupted",
            reasoningParts: [{ contentIndex: 0, text: "verified prefix" }],
            completedAtMs: 6,
          }),
        ],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "6",
    }));
    expect(selectConversationItem(hydrated, SESSION_ID, TURN_ID, "reasoning-without-finalized"))
      .toMatchObject({
        status: "incomplete",
        reasoning: { status: "incomplete", reasonCode: "turn_interrupted" },
      });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "unfinished-commentary"))
      .toEqual(selectConversationItem(
        hydrated,
        SESSION_ID,
        TURN_ID,
        "unfinished-commentary",
      ));
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "reasoning-without-finalized"))
      .toEqual(selectConversationItem(
        hydrated,
        SESSION_ID,
        TURN_ID,
        "reasoning-without-finalized",
      ));
  });

  it("keeps finalized-first and lifecycle-only reasoning live/hydration equivalent", () => {
    const finalizedLive = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "reasoning_finalized", {
        ...source(2),
        itemId: "reasoning-unavailable-first",
        itemOrdinal: 1,
        status: "unavailable",
        reasonCode: "runtime_error",
        parts: [],
      }),
    ]);
    const finalizedHydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        turns: [{
          turnId: TURN_ID,
          projectionAuthority: "v4",
          status: "streaming",
          terminalAt: null,
          reasoningStatus: "unavailable",
          reasoningReasonCode: "runtime_error",
          messages: [],
          reasoning: [],
          artifacts: [],
          terminalCode: null,
          timelineItems: [timelineItem({
            itemId: "reasoning-unavailable-first",
            itemOrdinal: 1,
            itemType: "reasoning",
            status: "in_progress",
            reasoningStatus: "unavailable",
            reasoningReasonCode: "runtime_error",
            reasoningParts: [],
            completedAtMs: null,
          })],
          plan: null,
          notices: [],
        }],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "2",
      },
    ));
    expect(selectConversationItem(
      finalizedLive,
      SESSION_ID,
      TURN_ID,
      "reasoning-unavailable-first",
    )).toEqual(selectConversationItem(
      finalizedHydrated,
      SESSION_ID,
      TURN_ID,
      "reasoning-unavailable-first",
    ));

    const lifecycleLive = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "item_started", {
        ...source(2),
        itemId: "reasoning-lifecycle-only",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(3, "item_completed", {
        ...source(3),
        itemId: "reasoning-lifecycle-only",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
    ]);
    const lifecycleHydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        turns: [{
          turnId: TURN_ID,
          projectionAuthority: "v4",
          status: "streaming",
          terminalAt: null,
          reasoningStatus: "unknown",
          reasoningReasonCode: null,
          messages: [],
          reasoning: [],
          artifacts: [],
          terminalCode: null,
          timelineItems: [timelineItem({
            itemId: "reasoning-lifecycle-only",
            itemOrdinal: 1,
            itemType: "reasoning",
            status: "completed",
            reasoningStatus: null,
          })],
          plan: null,
          notices: [],
        }],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "3",
      },
    ));
    expect(selectConversationItem(
      lifecycleLive,
      SESSION_ID,
      TURN_ID,
      "reasoning-lifecycle-only",
    )).toEqual(selectConversationItem(
      lifecycleHydrated,
      SESSION_ID,
      TURN_ID,
      "reasoning-lifecycle-only",
    ));
  });

  it("keeps completed reasoning identity fail-closed if a suppressed lifecycle replay crosses IPC", () => {
    const completed = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "reasoning_finalized", {
        ...source(2),
        itemId: "reasoning-finalized",
        itemOrdinal: 1,
        status: "complete",
        reasonCode: null,
        parts: [{ contentIndex: 0, text: "confirmed" }],
      }),
      eventV4(3, "item_completed", {
        ...source(3),
        itemId: "reasoning-finalized",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
    ]);
    const replay = projectionEventToConversation(eventV4(4, "item_started", {
      ...source(4),
      itemId: "reasoning-finalized",
      itemOrdinal: 1,
      itemType: "reasoning",
      phase: null,
      text: null,
    }));
    expect(replay.kind).toBe("domain_event");
    if (replay.kind !== "domain_event") throw new Error("expected domain event");

    const rejected = reduceConversationEvent(completed, replay.event);
    expect(rejected.syncStatus).toBe("recovery_required");
    expect(rejected.recovery).toMatchObject({ code: "invalid_transition" });
  });

  it("seals unfinished reasoning with the explicit terminal reason across live and hydration", () => {
    const cases = [
      ["completed", null, "protocol_error"],
      ["failed", "provider_failed", "runtime_error"],
      ["failed", "projection_limit_exceeded", "limit_exceeded"],
      ["failed", "projection_conflict", "protocol_error"],
    ] as const;

    for (const [status, code, reasonCode] of cases) {
      const live = reduceV4([
        eventV4(1, "turn_started", source(1)),
        eventV4(2, "reasoning_append", {
          ...source(2),
          itemId: "terminal-reasoning-prefix",
          itemOrdinal: 1,
          contentIndex: 0,
          text: "verified prefix",
        }),
        eventV4(3, "turn_terminal", {
          ...source(3),
          status,
          code,
          unfinishedReasoningReasonCode: reasonCode,
        }),
      ]);
      const hydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(
        SESSION_ID,
        {
          turns: [{
            turnId: TURN_ID,
            projectionAuthority: "v4",
            status,
            terminalAt: 3,
            reasoningStatus: "incomplete",
            reasoningReasonCode: reasonCode,
            messages: [],
            reasoning: [],
            artifacts: [],
            terminalCode: code,
            timelineItems: [timelineItem({
              itemId: "terminal-reasoning-prefix",
              itemOrdinal: 1,
              itemType: "reasoning",
              status: "incomplete",
              reasoningStatus: "incomplete",
              reasoningReasonCode: reasonCode,
              reasoningParts: [{ contentIndex: 0, text: "verified prefix" }],
              completedAtMs: 3,
            })],
            plan: null,
            notices: [],
          }],
          nextCursor: null,
          sessionNotices: [],
          durableSequenceCut: "3",
        },
      ));
      expect(selectConversationItem(
        live,
        SESSION_ID,
        TURN_ID,
        "terminal-reasoning-prefix",
      )).toEqual(selectConversationItem(
        hydrated,
        SESSION_ID,
        TURN_ID,
        "terminal-reasoning-prefix",
      ));
    }
  });

  it("seals a reasoning prefix even when its item lifecycle completed first", () => {
    const live = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "reasoning_append", {
        ...source(2),
        itemId: "completed-reasoning-prefix",
        itemOrdinal: 1,
        contentIndex: 0,
        text: "verified prefix",
      }),
      eventV4(3, "item_completed", {
        ...source(3),
        itemId: "completed-reasoning-prefix",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(4, "turn_terminal", {
        ...source(4),
        status: "completed",
        code: null,
        unfinishedReasoningReasonCode: "protocol_error",
      }),
    ]);
    const hydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        turns: [{
          turnId: TURN_ID,
          projectionAuthority: "v4",
          status: "completed",
          terminalAt: 4,
          reasoningStatus: "incomplete",
          reasoningReasonCode: "protocol_error",
          messages: [],
          reasoning: [],
          artifacts: [],
          terminalCode: null,
          timelineItems: [timelineItem({
            itemId: "completed-reasoning-prefix",
            itemOrdinal: 1,
            itemType: "reasoning",
            status: "completed",
            reasoningStatus: "incomplete",
            reasoningReasonCode: "protocol_error",
            reasoningParts: [{ contentIndex: 0, text: "verified prefix" }],
            completedAtMs: 3,
          })],
          plan: null,
          notices: [],
        }],
        nextCursor: null,
        sessionNotices: [],
        durableSequenceCut: "4",
      },
    ));
    expect(selectConversationItem(
      live,
      SESSION_ID,
      TURN_ID,
      "completed-reasoning-prefix",
    )).toEqual(selectConversationItem(
      hydrated,
      SESSION_ID,
      TURN_ID,
      "completed-reasoning-prefix",
    ));
  });

  it("keeps a completed-first lifecycle item live/hydration equivalent", () => {
    const live = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "item_completed", {
        ...source(2),
        itemId: "completed-first-final",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "final_answer",
        text: "confirmed answer",
      }),
      eventV4(3, "turn_terminal", {
        ...source(3),
        status: "completed",
        code: null,
        unfinishedReasoningReasonCode: "protocol_error",
      }),
    ]);
    const hydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(SESSION_ID, {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "completed",
        terminalAt: 3,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: [],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [timelineItem({
          ...source(2),
          itemId: "completed-first-final",
          itemOrdinal: 1,
          itemType: "agentMessage",
          phase: "final_answer",
          text: "confirmed answer",
        })],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "3",
    }));

    expect(live.syncStatus).toBe("synchronized");
    expect(selectConversationItem(live, SESSION_ID, TURN_ID, "completed-first-final"))
      .toEqual(selectConversationItem(hydrated, SESSION_ID, TURN_ID, "completed-first-final"));
    expect(selectConversationTurn(live, SESSION_ID, TURN_ID))
      .toMatchObject({ status: "completed", terminalStatus: "completed" });
  });

  it("accepts a late lifecycle start for an already streaming reasoning identity", () => {
    const live = reduceV4([
      eventV4(1, "turn_started", source(1)),
      eventV4(2, "reasoning_append", {
        ...source(2),
        itemId: "reasoning-before-start",
        itemOrdinal: 1,
        contentIndex: 0,
        text: "raw prefix",
      }),
      eventV4(3, "reasoning_finalized", {
        ...source(3),
        itemId: "reasoning-before-start",
        itemOrdinal: 1,
        status: "complete",
        reasonCode: null,
        parts: [{ contentIndex: 0, text: "raw prefix" }],
      }),
      eventV4(4, "item_started", {
        ...source(4),
        itemId: "reasoning-before-start",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(5, "item_completed", {
        ...source(5),
        itemId: "reasoning-before-start",
        itemOrdinal: 1,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(6, "turn_terminal", {
        ...source(6),
        status: "completed",
        code: null,
        unfinishedReasoningReasonCode: "protocol_error",
      }),
    ]);
    const hydrated = hydrateConversationState(historyPageV4ToConversationSnapshot(SESSION_ID, {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "completed",
        terminalAt: 6,
        reasoningStatus: "complete",
        reasoningReasonCode: null,
        messages: [],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [timelineItem({
          ...source(5),
          itemId: "reasoning-before-start",
          itemOrdinal: 1,
          itemType: "reasoning",
          text: "",
          reasoningStatus: "complete",
          reasoningReasonCode: null,
          reasoningParts: [{ contentIndex: 0, text: "raw prefix" }],
          startedAtMs: 2,
          completedAtMs: 5,
        })],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "6",
    }));

    expect(live.syncStatus).toBe("synchronized");
    expect(selectConversationItem(live, SESSION_ID, TURN_ID, "reasoning-before-start"))
      .toEqual(selectConversationItem(hydrated, SESSION_ID, TURN_ID, "reasoning-before-start"));
  });

  it("hydrates v4 history without duplicating legacy assistant messages or replacing attachment/artifact authority", () => {
    const page: ChatHistoryPageV4 = {
      nextCursor: null,
      durableSequenceCut: "11",
      sessionNotices: [{
        ...source(1),
        scope: "session",
        severity: "warning",
        code: null,
        willRetry: false,
        observedAtMs: 1,
      }],
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "v4",
        status: "completed",
        terminalAt: 10,
        reasoningStatus: "incomplete",
        reasoningReasonCode: "stream_gap",
        terminalCode: null,
        messages: [
          {
            messageId: "019fbf58-0000-7000-8000-000000000011",
            role: "user",
            content: "request",
            contentBlocks: [
              { type: "text", text: "request" },
              {
                attachmentId: "019fbf58-0000-7000-8000-000000000012",
                type: "file",
                name: "safe.txt",
                mediaType: "text/plain",
                sizeBytes: 4,
                status: "bound",
                expiresAt: 100,
              },
            ],
            status: "committed",
            ordinal: 0,
            createdAt: 1,
          },
          {
            messageId: "019fbf58-0000-7000-8000-000000000013",
            role: "assistant",
            content: "legacy duplicate",
            contentBlocks: [{ type: "text", text: "legacy duplicate" }],
            status: "committed",
            ordinal: 1,
            createdAt: 2,
          },
        ],
        reasoning: [],
        artifacts: [{
          artifactId: "019fbf58-0000-7000-8000-000000000014",
          kind: "report",
          provenance: "synthetic",
          status: "ready",
          ordinal: 0,
          progressStage: null,
          progressPercent: null,
          displayName: "Safe report",
          mediaType: "application/pdf",
          sizeBytes: 10,
          localCommittedAt: 2,
          expiresAt: 100,
          hasPoster: false,
          errorCode: null,
          retryable: null,
        }],
        timelineItems: [
          timelineItem({
            itemId: "final-real-id",
            itemOrdinal: 1,
            itemType: "agentMessage",
            phase: "final_answer",
            status: "completed",
            text: "answer",
          }),
          timelineItem({
            itemId: "reasoning-real-id",
            itemOrdinal: 2,
            itemType: "reasoning",
            status: "completed",
            reasoningStatus: "incomplete",
            reasoningReasonCode: "stream_gap",
            reasoningParts: [{ contentIndex: 0, text: "raw" }],
          }),
          timelineItem({
            itemId: "unknown-real-id",
            itemOrdinal: 3,
            itemType: "commandExecution",
            status: "incomplete",
          }),
        ],
        plan: {
          ...source(2),
          explanation: null,
          steps: [{ ordinal: 0, step: "done", status: "completed" }],
        },
        notices: [{
          ...source(3),
          scope: "turn",
          severity: "error",
          code: "safe_error",
          willRetry: false,
          observedAtMs: 3,
        }],
      }],
    };
    const state = hydrateConversationState(
      historyPageV4ToConversationSnapshot(SESSION_ID, page),
    );

    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toBeNull();
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "final-real-id"))
      .toMatchObject({ agentMessagePhase: "final_answer", contentBlocks: [{ text: "answer" }] });
    expect(selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "user"),
    )?.contentBlocks[1]).toMatchObject({
      type: "attachment_reference",
      attachmentId: "019fbf58-0000-7000-8000-000000000012",
    });
    const artifactItem = selectConversationItem(
      state,
      SESSION_ID,
      TURN_ID,
      conversationArtifactItemId(TURN_ID, "019fbf58-0000-7000-8000-000000000014"),
    );
    expect(artifactItem?.contentBlocks[0]).toMatchObject({ type: "artifact_reference" });
    expect(artifactItem?.ordinal).toBeGreaterThan(512);
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "reasoning-real-id"))
      .toMatchObject({
        reasoning: { status: "incomplete", reasonCode: "stream_gap" },
        contentBlocks: [{ blockIndex: 0, type: "text", text: "raw" }],
      });
    expect(selectConversationItem(state, SESSION_ID, TURN_ID, "unknown-real-id"))
      .toMatchObject({
        kind: "unknown",
        status: "incomplete",
        contentBlocks: [{ type: "unknown" }],
      });

    const live = reduceV4([
      eventV4(1, "notice", {
        ...source(1),
        scope: "session",
        severity: "warning",
        code: null,
        willRetry: false,
      }, null),
      eventV4(2, "turn_started", source(2)),
      eventV4(3, "plan_updated", {
        ...source(2),
        explanation: null,
        steps: [{ ordinal: 0, step: "done", status: "completed" }],
      }),
      eventV4(4, "item_started", {
        ...source(4),
        itemId: "final-real-id",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "final_answer",
        text: "",
      }),
      eventV4(5, "agent_message_append", {
        ...source(5),
        itemId: "final-real-id",
        itemOrdinal: 1,
        phase: "final_answer",
        text: "answer",
      }),
      eventV4(6, "item_completed", {
        ...source(6),
        itemId: "final-real-id",
        itemOrdinal: 1,
        itemType: "agentMessage",
        phase: "final_answer",
        text: "answer",
      }),
      eventV4(7, "reasoning_append", {
        ...source(7),
        itemId: "reasoning-real-id",
        itemOrdinal: 2,
        contentIndex: 0,
        text: "raw",
      }),
      eventV4(8, "reasoning_finalized", {
        ...source(8),
        itemId: "reasoning-real-id",
        itemOrdinal: 2,
        status: "incomplete",
        reasonCode: "stream_gap",
        parts: [{ contentIndex: 0, text: "raw" }],
      }),
      eventV4(9, "item_completed", {
        ...source(9),
        itemId: "reasoning-real-id",
        itemOrdinal: 2,
        itemType: "reasoning",
        phase: null,
        text: null,
      }),
      eventV4(10, "notice", {
        ...source(10),
        scope: "turn",
        severity: "error",
        code: "safe_error",
        willRetry: false,
      }),
      eventV4(11, "turn_terminal", {
        ...source(11),
        status: "completed",
        code: null,
        unfinishedReasoningReasonCode: "protocol_error",
      }),
    ]);
    const liveTurn = selectConversationTurn(live, SESSION_ID, TURN_ID)!;
    const hydratedTurn = selectConversationTurn(state, SESSION_ID, TURN_ID)!;
    expect({
      threadNotices: live.threads[SESSION_ID]?.notices,
      status: liveTurn.status,
      terminalStatus: liveTurn.terminalStatus,
      terminalCode: liveTurn.terminalCode,
      plan: liveTurn.plan,
      notices: liveTurn.notices,
      final: selectConversationItem(live, SESSION_ID, TURN_ID, "final-real-id"),
      reasoning: selectConversationItem(live, SESSION_ID, TURN_ID, "reasoning-real-id"),
    }).toEqual({
      threadNotices: state.threads[SESSION_ID]?.notices,
      status: hydratedTurn.status,
      terminalStatus: hydratedTurn.terminalStatus,
      terminalCode: hydratedTurn.terminalCode,
      plan: hydratedTurn.plan,
      notices: hydratedTurn.notices,
      final: selectConversationItem(state, SESSION_ID, TURN_ID, "final-real-id"),
      reasoning: selectConversationItem(state, SESSION_ID, TURN_ID, "reasoning-real-id"),
    });
  });

  it("preserves pre-v4 assistant history only when no timeline AgentMessage authority exists", () => {
    const legacyPage: ChatHistoryPageV4 = {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "legacy",
        status: "completed",
        terminalAt: 2,
        reasoningStatus: "unavailable",
        reasoningReasonCode: "reasoning_not_emitted",
        messages: [{
          messageId: "019fbf58-0000-7000-8000-000000000021",
          role: "assistant",
          content: "legacy answer",
          contentBlocks: [{ type: "text", text: "legacy answer" }],
          status: "committed",
          ordinal: 0,
          createdAt: 1,
        }],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "0",
    };
    const legacy = hydrateConversationState(
      historyPageV4ToConversationSnapshot(SESSION_ID, legacyPage),
    );
    expect(selectConversationItem(
      legacy,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toMatchObject({
      agentMessagePhase: "final_answer",
      contentBlocks: [{ text: "legacy answer" }],
    });

    const withV4Authority = hydrateConversationState(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        ...legacyPage,
        turns: [{
          ...legacyPage.turns[0]!,
          projectionAuthority: "v4",
          timelineItems: [timelineItem({
            itemId: "v4-final",
            itemOrdinal: 1,
            itemType: "agentMessage",
            phase: "final_answer",
            text: "v4 answer",
          })],
        }],
      },
    ));
    expect(selectConversationItem(
      withV4Authority,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toBeNull();
    expect(selectConversationItem(withV4Authority, SESSION_ID, TURN_ID, "v4-final"))
      .toMatchObject({ contentBlocks: [{ text: "v4 answer" }] });
  });

  it("does not project the active legacy pending assistant scaffold as a final answer", () => {
    const activePage: ChatHistoryPageV4 = {
      turns: [{
        turnId: TURN_ID,
        projectionAuthority: "legacy",
        status: "streaming",
        terminalAt: null,
        reasoningStatus: "pending",
        reasoningReasonCode: null,
        messages: [
          {
            messageId: "019fbf58-0000-7000-8000-000000000031",
            role: "user",
            content: "request",
            contentBlocks: [{ type: "text", text: "request" }],
            status: "committed",
            ordinal: 0,
            createdAt: 1,
          },
          {
            messageId: "019fbf58-0000-7000-8000-000000000032",
            role: "assistant",
            content: "",
            contentBlocks: [{ type: "text", text: " " }],
            status: "pending",
            ordinal: 1,
            createdAt: 2,
          },
        ],
        reasoning: [],
        artifacts: [],
        terminalCode: null,
        timelineItems: [],
        plan: null,
        notices: [],
      }],
      nextCursor: null,
      sessionNotices: [],
      durableSequenceCut: "0",
    };
    const active = hydrateConversationState(
      historyPageV4ToConversationSnapshot(SESSION_ID, activePage),
    );
    expect(selectConversationItem(
      active,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toBeNull();

    const partial = hydrateConversationState(historyPageV4ToConversationSnapshot(
      SESSION_ID,
      {
        ...activePage,
        turns: [{
          ...activePage.turns[0]!,
          messages: activePage.turns[0]!.messages.map((message) => message.role === "assistant"
            ? { ...message, content: "confirmed legacy partial", contentBlocks: [
                { type: "text" as const, text: "confirmed legacy partial" },
              ] }
            : message),
        }],
      },
    ));
    expect(selectConversationItem(
      partial,
      SESSION_ID,
      TURN_ID,
      conversationMessageItemId(TURN_ID, "assistant"),
    )).toMatchObject({ contentBlocks: [{ text: "confirmed legacy partial" }] });
  });

  it("keeps session warnings thread-scoped and rejects a turn event without turn identity", () => {
    expect(projectionEventToConversation(eventV4(1, "notice", {
      ...source(1),
      scope: "session",
      severity: "warning",
      code: null,
      willRetry: false,
    }, null))).toMatchObject({
      kind: "domain_event",
      event: { kind: "thread.notice", threadId: SESSION_ID },
    });
    expect(projectionEventToConversation(eventV4(2, "turn_started", source(2), null)))
      .toEqual({ kind: "resync_required", reason: "invalid_projection" });
  });
});
