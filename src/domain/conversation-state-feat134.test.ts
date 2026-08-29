import { describe, expect, it } from "vitest";
import {
  appendOlderConversationSnapshot,
  createConversationState,
  hydrateConversationState,
  reconcileConversationSnapshot,
  reduceConversationEvent,
  reduceConversationEvents,
  selectConversationItem,
  selectConversationTurn,
  serializeConversationState,
  type ConversationEvent,
  type ConversationSnapshot,
} from "./conversation-state";

const THREAD_ID = "thread-feat134";
const TURN_ID = "turn-feat134";
const STREAM_ID = "stream-feat134";

function cursor(sequence: number) {
  return {
    eventId: `event-feat134-${sequence}`,
    streamId: STREAM_ID,
    sequence: String(sequence),
    threadId: THREAD_ID,
    turnId: TURN_ID,
  } as const;
}

describe("FEAT-134 ConversationState semantics", () => {
  it("keeps interleaved AgentMessage phases on their real identity without inferring final", () => {
    const events: ConversationEvent[] = [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.started",
        itemId: "commentary-item",
        ordinal: 10,
        itemKind: "assistant_message",
        agentMessagePhase: "commentary",
      },
      {
        ...cursor(3),
        kind: "item.started",
        itemId: "unclassified-item",
        ordinal: 11,
        itemKind: "assistant_message",
        agentMessagePhase: null,
      },
      {
        ...cursor(4),
        kind: "item.started",
        itemId: "final-item",
        ordinal: 12,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
      },
      {
        ...cursor(5),
        kind: "item.delta",
        itemId: "final-item",
        ordinal: 12,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
        blockIndex: 0,
        blockType: "text",
        delta: "F1",
      },
      {
        ...cursor(6),
        kind: "item.delta",
        itemId: "commentary-item",
        ordinal: 10,
        itemKind: "assistant_message",
        agentMessagePhase: "commentary",
        blockIndex: 0,
        blockType: "text",
        delta: "C1",
      },
      {
        ...cursor(7),
        kind: "item.delta",
        itemId: "unclassified-item",
        ordinal: 11,
        itemKind: "assistant_message",
        agentMessagePhase: null,
        blockIndex: 0,
        blockType: "text",
        delta: "U1",
      },
      { ...cursor(8), kind: "turn.completed", terminalStatus: "completed" },
    ];

    const state = reduceConversationEvents(createConversationState(), events);
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "commentary-item"))
      .toMatchObject({ ordinal: 10, agentMessagePhase: "commentary" });
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "unclassified-item"))
      .toMatchObject({ ordinal: 11, agentMessagePhase: "unknown" });
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "final-item"))
      .toMatchObject({ ordinal: 12, agentMessagePhase: "final_answer" });
  });

  it("distinguishes an explicitly completed item from an unfinished item sealed by v4 terminal", () => {
    const state = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.delta",
        itemId: "completed-item",
        ordinal: 1,
        itemKind: "assistant_message",
        agentMessagePhase: "commentary",
        blockIndex: 0,
        blockType: "text",
        delta: "complete",
      },
      {
        ...cursor(3),
        kind: "item.completed",
        itemId: "completed-item",
        ordinal: 1,
        itemKind: "assistant_message",
        agentMessagePhase: "commentary",
      },
      {
        ...cursor(4),
        kind: "item.delta",
        itemId: "unfinished-item",
        ordinal: 2,
        itemKind: "assistant_message",
        agentMessagePhase: "commentary",
        blockIndex: 0,
        blockType: "text",
        delta: "partial",
      },
      {
        ...cursor(5),
        kind: "turn.completed",
        terminalStatus: "interrupted",
        unfinishedItemStatus: "incomplete",
      },
    ]);

    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "completed-item")?.status)
      .toBe("completed");
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "unfinished-item")?.status)
      .toBe("incomplete");
  });

  it("replaces stable plan snapshots atomically and treats an empty plan as a clear", () => {
    const first = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "turn.plan.updated",
        explanation: "first",
        steps: [
          { text: "one", status: "completed" },
          { text: "two", status: "in_progress" },
        ],
      },
    ]);
    expect(selectConversationTurn(first, THREAD_ID, TURN_ID)?.plan).toEqual({
      explanation: "first",
      steps: [
        { ordinal: 0, text: "one", status: "completed" },
        { ordinal: 1, text: "two", status: "in_progress" },
      ],
    });

    const replaced = reduceConversationEvent(first, {
      ...cursor(3),
      kind: "turn.plan.updated",
      explanation: null,
      steps: [{ text: "replacement", status: "pending" }],
    });
    expect(selectConversationTurn(replaced, THREAD_ID, TURN_ID)?.plan).toEqual({
      explanation: null,
      steps: [{ ordinal: 0, text: "replacement", status: "pending" }],
    });

    const cleared = reduceConversationEvent(replaced, {
      ...cursor(4),
      kind: "turn.plan.updated",
      explanation: "must not survive",
      steps: [],
    });
    expect(selectConversationTurn(cleared, THREAD_ID, TURN_ID)?.plan).toBeNull();
  });

  it("reconciles interleaved raw reasoning parts and keeps finalization separate from item completion", () => {
    const state = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.delta",
        itemId: "reasoning-a",
        ordinal: 20,
        itemKind: "reasoning",
        blockIndex: 1,
        blockType: "text",
        delta: "A1",
      },
      {
        ...cursor(3),
        kind: "item.delta",
        itemId: "reasoning-b",
        ordinal: 21,
        itemKind: "reasoning",
        blockIndex: 0,
        blockType: "text",
        delta: "B1",
      },
      {
        ...cursor(4),
        kind: "item.delta",
        itemId: "reasoning-a",
        ordinal: 20,
        itemKind: "reasoning",
        blockIndex: 1,
        blockType: "text",
        delta: "A2",
      },
      {
        ...cursor(5),
        kind: "reasoning.finalized",
        itemId: "reasoning-a",
        ordinal: 20,
        status: "incomplete",
        reasonCode: "stream_gap",
        finalBlocks: [{ blockIndex: 1, type: "text", text: "A1A2" }],
      },
    ]);

    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "reasoning-a"))
      .toMatchObject({
        status: "streaming",
        reasoning: { status: "incomplete", reasonCode: "stream_gap" },
        reconciliation: "matched",
        contentBlocks: [{ blockIndex: 1, type: "text", text: "A1A2" }],
      });
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "reasoning-b"))
      .toMatchObject({
        reasoning: { status: "in_progress", reasonCode: null },
        contentBlocks: [{ blockIndex: 0, type: "text", text: "B1" }],
      });

    const completed = reduceConversationEvent(state, {
      ...cursor(6),
      kind: "item.completed",
      itemId: "reasoning-a",
      ordinal: 20,
      itemKind: "reasoning",
    });
    expect(selectConversationItem(completed, THREAD_ID, TURN_ID, "reasoning-a")?.status)
      .toBe("completed");
  });

  it("replaces the low-latency reasoning buffer with the authoritative finalized snapshot", () => {
    const prefix = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.delta",
        itemId: "reasoning-authoritative",
        ordinal: 20,
        itemKind: "reasoning",
        blockIndex: 0,
        blockType: "text",
        delta: "transient raw prefix",
      },
    ]);
    const finalized = reduceConversationEvent(prefix, {
      ...cursor(3),
      kind: "reasoning.finalized",
      itemId: "reasoning-authoritative",
      ordinal: 20,
      status: "incomplete",
      reasonCode: "stream_gap",
      finalBlocks: [{ blockIndex: 0, type: "text", text: "verified" }],
    });
    expect(finalized.syncStatus).toBe("synchronized");
    expect(selectConversationItem(
      finalized,
      THREAD_ID,
      TURN_ID,
      "reasoning-authoritative",
    )).toMatchObject({
      reasoning: { status: "incomplete", reasonCode: "stream_gap" },
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "verified" }],
    });

    const unavailable = reduceConversationEvent(prefix, {
      ...cursor(3),
      kind: "reasoning.finalized",
      itemId: "reasoning-authoritative",
      ordinal: 20,
      status: "unavailable",
      reasonCode: "runtime_error",
      finalBlocks: [],
    });
    expect(unavailable.syncStatus).toBe("synchronized");
    expect(selectConversationItem(
      unavailable,
      THREAD_ID,
      TURN_ID,
      "reasoning-authoritative",
    )).toMatchObject({
      reasoning: { status: "unavailable", reasonCode: "runtime_error" },
      reconciliation: "matched",
      contentBlocks: [],
    });
  });

  it("keeps an unfinished reasoning prefix unknown when a legacy terminal omits its reason", () => {
    const state = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.delta",
        itemId: "legacy-reasoning-prefix",
        ordinal: 20,
        itemKind: "reasoning",
        blockIndex: 0,
        blockType: "text",
        delta: "transient prefix",
      },
      {
        ...cursor(3),
        kind: "turn.completed",
        terminalStatus: "completed",
      },
    ]);
    expect(selectConversationItem(
      state,
      THREAD_ID,
      TURN_ID,
      "legacy-reasoning-prefix",
    )).toMatchObject({
      status: "completed",
      reasoning: { status: "unknown", reasonCode: null },
      reconciliation: "not_applicable",
    });
  });

  it("keeps session warnings separate from turn-scoped errors and stores terminal reason", () => {
    const state = reduceConversationEvents(createConversationState(), [
      {
        eventId: "event-feat134-1",
        streamId: STREAM_ID,
        sequence: "1",
        threadId: THREAD_ID,
        kind: "thread.notice",
        severity: "warning",
      },
      { ...cursor(2), kind: "turn.started", ordinal: 0 },
      { ...cursor(3), kind: "notice", severity: "error" },
      {
        ...cursor(4),
        kind: "turn.completed",
        terminalStatus: "failed",
        terminalCode: "limit_exceeded",
      },
    ]);

    expect(state.threads[THREAD_ID]?.notices).toEqual([
      { severity: "warning", code: "conversation_warning" },
    ]);
    expect(selectConversationTurn(state, THREAD_ID, TURN_ID)).toMatchObject({
      terminalStatus: "failed",
      terminalCode: "limit_exceeded",
      notices: [{ severity: "error", code: "conversation_error" }],
    });
  });

  it("round-trips phase, plan, reasoning, notices, attachment and artifact authority", () => {
    const snapshot: ConversationSnapshot = {
      threads: [{
        threadId: THREAD_ID,
        status: "ready",
        notices: [{ severity: "warning", code: "conversation_warning" }],
      }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
        terminalCode: null,
        plan: {
          explanation: null,
          steps: [{ ordinal: 0, text: "done", status: "completed" }],
        },
      }],
      items: [
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "final-item",
          ordinal: 2,
          kind: "assistant_message",
          status: "completed",
          agentMessagePhase: "final_answer",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "answer" }],
          reconciliation: "matched",
        },
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "reasoning-item",
          ordinal: 1,
          kind: "reasoning",
          status: "completed",
          reasoning: { status: "unavailable", reasonCode: "reasoning_not_emitted" },
          contentBlocks: [],
        },
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "user-item",
          ordinal: 0,
          kind: "user_message",
          status: "completed",
          contentBlocks: [{
            blockIndex: 0,
            type: "attachment_reference",
            attachmentId: "attachment-authority",
            kind: "file",
            name: "fixture.txt",
            mediaType: "text/plain",
            sizeBytes: 7,
            status: "bound",
            expiresAt: 100,
          }],
        },
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "artifact-item",
          ordinal: 3,
          kind: "artifact",
          status: "completed",
          contentBlocks: [{
            blockIndex: 0,
            type: "artifact_reference",
            artifactId: "artifact-authority",
            label: "fixture",
          }],
        },
      ],
    };
    const first = hydrateConversationState(snapshot);
    const second = hydrateConversationState(snapshot);

    expect(serializeConversationState(first)).toBe(serializeConversationState(second));
    expect(serializeConversationState(first)).toContain('"schemaVersion":2');
    expect(selectConversationItem(first, THREAD_ID, TURN_ID, "final-item")?.agentMessagePhase)
      .toBe("final_answer");
    expect(selectConversationItem(first, THREAD_ID, TURN_ID, "reasoning-item")?.reasoning)
      .toEqual({ status: "unavailable", reasonCode: "reasoning_not_emitted" });
    expect(selectConversationItem(first, THREAD_ID, TURN_ID, "user-item")?.contentBlocks[0])
      .toMatchObject({ type: "attachment_reference", attachmentId: "attachment-authority" });
    expect(selectConversationItem(first, THREAD_ID, TURN_ID, "artifact-item")?.contentBlocks[0])
      .toMatchObject({ type: "artifact_reference", artifactId: "artifact-authority" });
  });

  it("preserves live explicit metadata when a legacy snapshot omits FEAT-134 fields", () => {
    const live = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "turn.plan.updated",
        explanation: null,
        steps: [{ text: "live", status: "in_progress" }],
      },
      {
        ...cursor(3),
        kind: "item.started",
        itemId: "final-item",
        ordinal: 1,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
      },
      {
        ...cursor(4),
        kind: "item.delta",
        itemId: "final-item",
        ordinal: 1,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
        blockIndex: 0,
        blockType: "text",
        delta: "live",
      },
    ]);
    const reconciled = reconcileConversationSnapshot(live, {
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "final-item",
        ordinal: 1,
        kind: "assistant_message",
        status: "streaming",
        contentBlocks: [],
      }],
    });

    expect(reconciled.syncStatus).toBe("synchronized");
    expect(selectConversationTurn(reconciled, THREAD_ID, TURN_ID)?.plan)
      .toMatchObject({ steps: [{ ordinal: 0, text: "live", status: "in_progress" }] });
    expect(selectConversationItem(reconciled, THREAD_ID, TURN_ID, "final-item"))
      .toMatchObject({
        agentMessagePhase: "final_answer",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "live" }],
      });
  });

  it("preserves a live session warning when a legacy snapshot has no thread-notice field", () => {
    const live = reduceConversationEvent(createConversationState(), {
      eventId: "event-feat134-1",
      streamId: STREAM_ID,
      sequence: "1",
      threadId: THREAD_ID,
      kind: "thread.notice",
      severity: "warning",
    });
    const reconciled = reconcileConversationSnapshot(live, {
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [],
      items: [],
    });

    expect(reconciled.threads[THREAD_ID]?.notices).toEqual([
      { severity: "warning", code: "conversation_warning" },
    ]);
  });

  it("prepends only disjoint terminal history while preserving every live authority field", () => {
    const live = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "turn.plan.updated",
        explanation: null,
        steps: [{ text: "live plan", status: "in_progress" }],
      },
      {
        ...cursor(3),
        kind: "item.delta",
        itemId: "live-final",
        ordinal: 1,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
        blockIndex: 0,
        blockType: "text",
        delta: "live text",
      },
      {
        eventId: "event-feat134-4",
        streamId: STREAM_ID,
        sequence: "4",
        threadId: THREAD_ID,
        kind: "thread.notice",
        severity: "warning",
      },
    ]);
    const oldTurnId = "turn-feat134-old";
    const appended = appendOlderConversationSnapshot(live, {
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: oldTurnId,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
        terminalCode: null,
        plan: null,
        notices: [],
      }],
      items: [{
        threadId: THREAD_ID,
        turnId: oldTurnId,
        itemId: "old-final",
        ordinal: 1,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "final_answer",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "old text" }],
      }],
    });

    expect(appended.streamPositions).toBe(live.streamPositions);
    expect(appended.processedEventIds).toBe(live.processedEventIds);
    expect(appended.diagnostics).toBe(live.diagnostics);
    expect(appended.threads[THREAD_ID]?.notices).toEqual(live.threads[THREAD_ID]?.notices);
    expect(selectConversationTurn(appended, THREAD_ID, TURN_ID)).toMatchObject({
      ordinal: 1,
      status: "in_progress",
      plan: { steps: [{ ordinal: 0, text: "live plan", status: "in_progress" }] },
    });
    expect(selectConversationItem(appended, THREAD_ID, TURN_ID, "live-final"))
      .toMatchObject({ contentBlocks: [{ text: "live text" }] });
    expect(selectConversationTurn(appended, THREAD_ID, oldTurnId)).toMatchObject({
      ordinal: 0,
      status: "completed",
    });

    const overlap = appendOlderConversationSnapshot(appended, {
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: oldTurnId,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
      }],
      items: [],
    });
    expect(overlap).toMatchObject({
      syncStatus: "recovery_required",
      recovery: { code: "invalid_transition", streamId: "snapshot" },
    });
  });

  it("deduplicates by event identity and fails closed on a sequence gap", () => {
    const started: ConversationEvent = { ...cursor(1), kind: "turn.started", ordinal: 0 };
    const once = reduceConversationEvent(createConversationState(), started);
    expect(reduceConversationEvent(once, started)).toBe(once);

    const gap = reduceConversationEvent(once, {
      ...cursor(3),
      kind: "turn.plan.updated",
      explanation: null,
      steps: [{ text: "must not land", status: "pending" }],
    });
    expect(gap).toMatchObject({
      syncStatus: "recovery_required",
      recovery: { code: "sequence_gap", expectedSequence: "2", receivedSequence: "3" },
    });
    expect(selectConversationTurn(gap, THREAD_ID, TURN_ID)?.plan).toBeNull();
  });
});
