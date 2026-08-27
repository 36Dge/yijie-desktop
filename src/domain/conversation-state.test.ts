import { describe, expect, it } from "vitest";
import type {
  ConversationEvent,
  ConversationSnapshot,
} from "./conversation-state";
import {
  createConversationState,
  hydrateConversationState,
  reconcileConversationSnapshot,
  MAX_CONVERSATION_DIAGNOSTICS,
  MAX_CONVERSATION_EVENT_IDS,
  MAX_CONVERSATION_NOTICES,
  reduceConversationEvent,
  reduceConversationEvents,
  selectConversationItem,
  selectConversationTurn,
  serializeConversationState,
} from "./conversation-state";

const THREAD_ID = "thread-a";
const TURN_ID = "turn-a";
const STREAM_ID = "stream-a";

function cursor(sequence: number) {
  return {
    eventId: `event-${sequence}`,
    streamId: STREAM_ID,
    sequence: String(sequence),
    threadId: THREAD_ID,
    turnId: TURN_ID,
  };
}

function assistantFlow(): readonly ConversationEvent[] {
  return [
    { ...cursor(1), kind: "turn.started", ordinal: 0 },
    {
      ...cursor(2),
      kind: "item.started",
      itemId: "assistant-a",
      ordinal: 0,
      itemKind: "assistant_message",
    },
    {
      ...cursor(3),
      kind: "item.delta",
      itemId: "assistant-a",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "hello",
    },
    {
      ...cursor(4),
      kind: "item.completed",
      itemId: "assistant-a",
      finalBlocks: [{ blockIndex: 0, type: "text", text: "hello" }],
    },
    { ...cursor(5), kind: "turn.completed", terminalStatus: "completed" },
  ];
}

function terminalSnapshot(text: string): ConversationSnapshot {
  return {
    threads: [{ threadId: THREAD_ID, status: "ready" }],
    turns: [{
      threadId: THREAD_ID,
      turnId: TURN_ID,
      ordinal: 0,
      status: "completed",
      terminalStatus: "completed",
    }],
    items: [{
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "assistant-a",
      ordinal: 0,
      kind: "assistant_message",
      status: "completed",
      contentBlocks: [{ blockIndex: 0, type: "text", text }],
    }],
  };
}

describe("FEAT-132 deterministic conversation domain", () => {
  it("AC-001 hydrates normalized snapshots and serializes byte-identically", () => {
    const snapshot: ConversationSnapshot = {
      threads: [
        { threadId: "thread-b", status: "not_loaded" },
        { threadId: THREAD_ID, status: "ready" },
      ],
      turns: [{
        threadId: THREAD_ID,
        turnId: "historical",
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
      }],
      items: [{
        threadId: THREAD_ID,
        turnId: "historical",
        itemId: "message-1",
        ordinal: 0,
        kind: "assistant_message",
        status: "completed",
        contentBlocks: [
          { blockIndex: 0, type: "text", text: "history" },
          {
            blockIndex: 1,
            type: "attachment_reference",
            attachmentId: "attachment-1",
            kind: "image",
            name: "synthetic.png",
            mediaType: "image/png",
            sizeBytes: 68,
            status: "ready",
            expiresAt: 100,
          },
        ],
      }],
      streamPositions: [{ streamId: "history", lastSequence: "7" }],
    };
    const reordered: ConversationSnapshot = {
      ...snapshot,
      threads: [...snapshot.threads].reverse(),
      turns: [...snapshot.turns].reverse(),
      items: [...snapshot.items].reverse(),
    };

    expect(serializeConversationState(hydrateConversationState(snapshot)))
      .toBe(serializeConversationState(hydrateConversationState(reordered)));
    expect(hydrateConversationState(snapshot).threads[THREAD_ID]?.status).toBe("ready");
    expect(serializeConversationState(reduceConversationEvents(createConversationState(), assistantFlow())))
      .toBe(serializeConversationState(reduceConversationEvents(createConversationState(), assistantFlow())));
  });

  it("fails closed when an authoritative snapshot contains a recovery turn", () => {
    const state = hydrateConversationState({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "recovery_required",
        terminalStatus: null,
      }],
      items: [],
    });

    expect(state.syncStatus).toBe("recovery_required");
    expect(state.recovery).toEqual({
      code: "invalid_transition",
      streamId: "snapshot",
      expectedSequence: null,
      receivedSequence: "0",
    });
  });

  it("AC-002 isolates interleaved deltas by turnId plus itemId", () => {
    const events: ConversationEvent[] = [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      { ...cursor(2), kind: "item.started", itemId: "a", ordinal: 0, itemKind: "assistant_message" },
      { ...cursor(3), kind: "item.started", itemId: "b", ordinal: 1, itemKind: "reasoning" },
      { ...cursor(4), kind: "item.delta", itemId: "a", ordinal: 0, itemKind: "assistant_message", blockIndex: 0, blockType: "text", delta: "A1" },
      { ...cursor(5), kind: "item.delta", itemId: "b", ordinal: 1, itemKind: "reasoning", blockIndex: 0, blockType: "text", delta: "B1" },
      { ...cursor(6), kind: "item.delta", itemId: "a", ordinal: 0, itemKind: "assistant_message", blockIndex: 0, blockType: "text", delta: "A2" },
      { ...cursor(7), kind: "item.delta", itemId: "b", ordinal: 1, itemKind: "reasoning", blockIndex: 0, blockType: "text", delta: "B2" },
    ];
    const state = reduceConversationEvents(createConversationState(), events);

    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "A1A2" }]);
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "b")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "B1B2" }]);
  });

  it("materializes a normalized live delta when lifecycle events were not projected", () => {
    const state = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "item.delta",
      itemId: "assistant-live",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "first batch",
    });

    expect(selectConversationTurn(state, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "assistant-live")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "first batch" }]);
  });

  it("moves a Thread from ready to active and back to ready at authoritative completion", () => {
    const ready = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "thread.started",
    });
    expect(ready.threads[THREAD_ID]?.status).toBe("ready");

    const active = reduceConversationEvent(ready, {
      ...cursor(2),
      kind: "turn.started",
      ordinal: 0,
    });
    expect(active.threads[THREAD_ID]?.status).toBe("active");

    const completed = reduceConversationEvent(active, {
      ...cursor(3),
      kind: "turn.completed",
      terminalStatus: "completed",
    });
    expect(completed.threads[THREAD_ID]?.status).toBe("ready");
  });

  it("preserves a historical Turn ordinal when a live start has no ordinal", () => {
    const secondTurnId = "turn-b";
    const historical = hydrateConversationState({
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          ordinal: 0,
          status: "completed",
          terminalStatus: "completed",
        },
        {
          threadId: THREAD_ID,
          turnId: secondTurnId,
          ordinal: 1,
          status: "queued",
          terminalStatus: null,
        },
      ],
      items: [],
    });

    const started = reduceConversationEvent(historical, {
      ...cursor(1),
      turnId: secondTurnId,
      kind: "turn.started",
      ordinal: null,
    });

    expect(started.syncStatus).toBe("synchronized");
    expect(selectConversationTurn(started, THREAD_ID, secondTurnId)).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });

    const materialized = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "turn.started",
      ordinal: null,
    });
    expect(selectConversationTurn(materialized, THREAD_ID, TURN_ID)?.ordinal).toBe(0);
  });

  it("assigns the next same-Thread ordinal when a new live Turn precedes its snapshot", () => {
    const historical = hydrateConversationState({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
      }],
      items: [],
    });

    const fromTurnStarted = reduceConversationEvent(historical, {
      ...cursor(1),
      turnId: "turn-live-state",
      kind: "turn.started",
      ordinal: null,
    });
    expect(selectConversationTurn(fromTurnStarted, THREAD_ID, "turn-live-state")).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });

    const fromItemDelta = reduceConversationEvent(historical, {
      ...cursor(1),
      turnId: "turn-live-delta",
      kind: "item.delta",
      itemId: "assistant-live",
      ordinal: 200,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "latest",
    });
    expect(selectConversationTurn(fromItemDelta, THREAD_ID, "turn-live-delta")).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });
    expect(selectConversationItem(
      fromItemDelta,
      THREAD_ID,
      "turn-live-delta",
      "assistant-live",
    )?.contentBlocks).toEqual([{ blockIndex: 0, type: "text", text: "latest" }]);

    const explicit = reduceConversationEvent(historical, {
      ...cursor(1),
      turnId: "turn-live-explicit",
      kind: "turn.started",
      ordinal: 7,
    });
    expect(selectConversationTurn(explicit, THREAD_ID, "turn-live-explicit")?.ordinal).toBe(7);
  });

  it("AC-003 ignores duplicate eventIds without duplicating content", () => {
    const prefix = assistantFlow().slice(0, 3);
    const state = reduceConversationEvents(createConversationState(), prefix);
    const duplicate = { ...prefix[2]!, sequence: "99" };
    const replayed = reduceConversationEvent(state, duplicate);

    expect(replayed).toBe(state);
    expect(selectConversationItem(replayed, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "hello" }]);
  });

  it("bounds the deterministic event-id ledger without losing projected content", () => {
    const events: ConversationEvent[] = Array.from(
      { length: MAX_CONVERSATION_EVENT_IDS + 16 },
      (_, index) => ({
        ...cursor(index + 1),
        eventId: `019c1a00-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
        kind: "item.delta" as const,
        itemId: "bounded",
        ordinal: 0,
        itemKind: "assistant_message" as const,
        blockIndex: 0,
        blockType: "text" as const,
        delta: "x",
      }),
    );
    const state = reduceConversationEvents(createConversationState(), events);

    expect(Object.keys(state.processedEventIds)).toHaveLength(MAX_CONVERSATION_EVENT_IDS);
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "bounded")?.contentBlocks)
      .toEqual([{
        blockIndex: 0,
        type: "text",
        text: "x".repeat(MAX_CONVERSATION_EVENT_IDS + 16),
      }]);
  });

  it("retains the most recently consumed event id even when its UUID sorts first", () => {
    const prefix: ConversationEvent[] = Array.from(
      { length: MAX_CONVERSATION_EVENT_IDS },
      (_, index) => ({
        ...cursor(index + 1),
        eventId: `z-event-${String(index).padStart(4, "0")}`,
        kind: "unknown" as const,
      }),
    );
    const latest: ConversationEvent = {
      ...cursor(MAX_CONVERSATION_EVENT_IDS + 1),
      eventId: "a-latest-consumed-event",
      kind: "unknown",
    };
    const state = reduceConversationEvent(
      reduceConversationEvents(createConversationState(), prefix),
      latest,
    );

    expect(state.processedEventIds[latest.eventId]).toBe(true);
    expect(reduceConversationEvent(state, { ...latest, sequence: "999" })).toBe(state);
  });

  it("fails closed instead of activating two regular turns in one thread", () => {
    const active = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "turn.started",
      ordinal: 0,
    });
    const conflicting = reduceConversationEvent(active, {
      ...cursor(2),
      eventId: "event-turn-b",
      turnId: "turn-b",
      kind: "turn.started",
      ordinal: 1,
    });

    expect(conflicting.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(conflicting, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
    expect(selectConversationTurn(conflicting, THREAD_ID, "turn-b")).toBeNull();
  });

  it("rejects a conflicting Turn before materializing its Item or content", () => {
    const active = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "turn.started",
      ordinal: 0,
    });
    const conflictingDelta = reduceConversationEvent(active, {
      ...cursor(2),
      eventId: "event-turn-b-delta",
      turnId: "turn-b",
      kind: "item.delta",
      itemId: "must-not-exist",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "must-not-land",
    });

    expect(conflictingDelta.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(conflictingDelta, THREAD_ID, "turn-b")).toBeNull();
    expect(selectConversationItem(
      conflictingDelta,
      THREAD_ID,
      "turn-b",
      "must-not-exist",
    )).toBeNull();
  });

  it("does not demote an active Thread when thread.started is repeated", () => {
    const active = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "turn.started",
      ordinal: 0,
    });
    const repeatedThread = reduceConversationEvent(active, {
      eventId: "event-thread-repeat",
      streamId: STREAM_ID,
      sequence: "2",
      threadId: THREAD_ID,
      kind: "thread.started",
    });

    expect(repeatedThread.syncStatus).toBe("synchronized");
    expect(repeatedThread.threads[THREAD_ID]?.status).toBe("active");
    expect(selectConversationTurn(repeatedThread, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
  });

  it("fails closed on completed-item deltas and identity conflicts without partial content", () => {
    const completedItem = reduceConversationEvents(
      createConversationState(),
      assistantFlow().slice(0, 4),
    );
    const invalidDelta = reduceConversationEvent(completedItem, {
      ...cursor(5),
      kind: "item.delta",
      itemId: "assistant-a",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "must-not-append",
    });
    expect(invalidDelta.syncStatus).toBe("recovery_required");
    expect(selectConversationItem(invalidDelta, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "hello" }]);

    const started = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 2));
    const conflict = reduceConversationEvent(started, {
      ...cursor(3),
      kind: "item.delta",
      itemId: "assistant-a",
      ordinal: 0,
      itemKind: "reasoning",
      blockIndex: 0,
      blockType: "text",
      delta: "must-not-land",
    });
    expect(conflict.syncStatus).toBe("recovery_required");
    expect(selectConversationItem(conflict, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([]);
  });

  it("atomically seals streaming Items when their Turn becomes terminal", () => {
    const streaming = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      {
        ...cursor(2),
        kind: "item.delta",
        itemId: "assistant-a",
        ordinal: 0,
        itemKind: "assistant_message",
        blockIndex: 0,
        blockType: "text",
        delta: "partial",
      },
    ]);
    const interrupted = reduceConversationEvent(streaming, {
      ...cursor(3),
      kind: "turn.completed",
      terminalStatus: "interrupted",
    });

    expect(selectConversationTurn(interrupted, THREAD_ID, TURN_ID)).toMatchObject({
      status: "interrupted",
      terminalStatus: "interrupted",
    });
    expect(selectConversationItem(interrupted, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      status: "completed",
      reconciliation: "not_applicable",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "partial" }],
    });

    const lateDelta = reduceConversationEvent(interrupted, {
      ...cursor(4),
      kind: "item.delta",
      itemId: "assistant-a",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: "must-not-append",
    });
    expect(lateDelta.syncStatus).toBe("recovery_required");
    expect(selectConversationItem(lateDelta, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "partial" }]);
  });

  it("AC-004 keeps error and warning notices non-terminal until turn.completed", () => {
    const events: ConversationEvent[] = [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      { ...cursor(2), kind: "notice", severity: "error" },
      { ...cursor(3), kind: "notice", severity: "warning" },
      { ...cursor(4), kind: "item.started", itemId: "a", ordinal: 0, itemKind: "assistant_message" },
      { ...cursor(5), kind: "item.delta", itemId: "a", ordinal: 0, itemKind: "assistant_message", blockIndex: 0, blockType: "text", delta: "continues" },
    ];
    const active = reduceConversationEvents(createConversationState(), events);

    expect(selectConversationTurn(active, THREAD_ID, TURN_ID)).toMatchObject({
      status: "in_progress",
      terminalStatus: null,
    });
    expect(selectConversationTurn(active, THREAD_ID, TURN_ID)?.notices).toEqual([
      { severity: "error", code: "conversation_error" },
      { severity: "warning", code: "conversation_warning" },
    ]);
    const completed = reduceConversationEvent(active, {
      ...cursor(6),
      kind: "turn.completed",
      terminalStatus: "completed",
    });
    expect(selectConversationTurn(completed, THREAD_ID, TURN_ID)?.terminalStatus).toBe("completed");
    const lateDelta = reduceConversationEvent(completed, {
      ...cursor(7),
      kind: "item.delta",
      itemId: "a",
      ordinal: 0,
      itemKind: "assistant_message",
      blockIndex: 0,
      blockType: "text",
      delta: " ignored",
    });
    expect(selectConversationItem(lateDelta, THREAD_ID, TURN_ID, "a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "continues" }]);
  });

  it("AC-005 reconciles matching or extending final content without duplication and marks mismatches", () => {
    const matching = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 4));
    expect(selectConversationItem(matching, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "hello" }],
    });

    const prefix = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 3));
    const extended = reduceConversationEvent(prefix, {
      ...cursor(4),
      kind: "item.completed",
      itemId: "assistant-a",
      finalBlocks: [{ blockIndex: 0, type: "text", text: "hello world" }],
    });
    expect(selectConversationItem(extended, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "hello world" }],
    });

    const mismatched = reduceConversationEvent(prefix, {
      ...cursor(4),
      kind: "item.completed",
      itemId: "assistant-a",
      finalBlocks: [{ blockIndex: 0, type: "text", text: "divergent" }],
    });
    expect(selectConversationItem(mismatched, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      reconciliation: "mismatch",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "hello" }],
    });
    expect(mismatched.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(mismatched, THREAD_ID, TURN_ID)?.status)
      .toBe("recovery_required");
  });

  it("reconciles an authoritative terminal snapshot without rolling back displayed live text", () => {
    const streaming = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 3));
    const live = reduceConversationEvent(streaming, {
      ...cursor(4),
      kind: "turn.completed",
      terminalStatus: "completed",
    });
    expect(selectConversationTurn(live, THREAD_ID, TURN_ID)?.terminalStatus).toBe("completed");
    const extended = reconcileConversationSnapshot(live, terminalSnapshot("hello world"));

    expect(extended.syncStatus).toBe("synchronized");
    expect(selectConversationItem(extended, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      status: "completed",
      reconciliation: "matched",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "hello world" }],
    });
    expect(selectConversationTurn(extended, THREAD_ID, TURN_ID)?.status).toBe("completed");

    const regressed = reconcileConversationSnapshot(live, terminalSnapshot("hell"));
    expect(regressed.syncStatus).toBe("recovery_required");
    expect(selectConversationItem(regressed, THREAD_ID, TURN_ID, "assistant-a")).toMatchObject({
      reconciliation: "mismatch",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "hello" }],
    });
    expect(selectConversationTurn(regressed, THREAD_ID, TURN_ID)?.status)
      .toBe("recovery_required");
  });

  it("preserves a live terminal lifecycle on snapshot regression or divergence", () => {
    const streaming = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 3));
    const completed = reduceConversationEvent(streaming, {
      ...cursor(4),
      kind: "turn.completed",
      terminalStatus: "completed",
    });
    const pending: ConversationSnapshot = {
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
        itemId: "assistant-a",
        ordinal: 0,
        kind: "assistant_message",
        status: "streaming",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "hello" }],
      }],
    };
    const regressed = reconcileConversationSnapshot(completed, pending);

    expect(regressed.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(regressed, THREAD_ID, TURN_ID)).toMatchObject({
      status: "recovery_required",
      terminalStatus: "completed",
    });
    expect(selectConversationItem(regressed, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "hello" }]);

    const failedSnapshot: ConversationSnapshot = {
      ...terminalSnapshot("hello"),
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "failed",
        terminalStatus: "failed",
      }],
    };
    const diverged = reconcileConversationSnapshot(completed, failedSnapshot);
    expect(diverged.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(diverged, THREAD_ID, TURN_ID)?.terminalStatus).toBe("completed");
  });

  it("preserves an itemless live terminal Turn when the snapshot omits it", () => {
    const live = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      { ...cursor(2), kind: "turn.completed", terminalStatus: "failed" },
    ]);
    const reconciled = reconcileConversationSnapshot(live, {
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [],
      items: [],
    });

    expect(reconciled.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(reconciled, THREAD_ID, TURN_ID)).toMatchObject({
      status: "recovery_required",
      terminalStatus: "failed",
    });
  });

  it("preserves live content when a non-terminal snapshot has not persisted it yet", () => {
    const live = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 3));
    const pendingSnapshot: ConversationSnapshot = {
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
        itemId: "assistant-a",
        ordinal: 0,
        kind: "assistant_message",
        status: "streaming",
        contentBlocks: [],
      }],
    };

    const reconciled = reconcileConversationSnapshot(live, pendingSnapshot);
    expect(reconciled.syncStatus).toBe("synchronized");
    expect(selectConversationItem(reconciled, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "hello" }]);
    expect(selectConversationTurn(reconciled, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
    expect(reconciled.threads[THREAD_ID]?.status).toBe("active");
  });

  it("accepts a non-terminal authoritative snapshot that no longer contains a stale live turn", () => {
    const live = reduceConversationEvents(createConversationState(), assistantFlow().slice(0, 3));
    const emptySnapshot: ConversationSnapshot = {
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [],
      items: [],
    };

    const reconciled = reconcileConversationSnapshot(live, emptySnapshot);
    expect(reconciled.syncStatus).toBe("synchronized");
    expect(selectConversationTurn(reconciled, THREAD_ID, TURN_ID)).toBeNull();
    expect(selectConversationItem(reconciled, THREAD_ID, TURN_ID, "assistant-a")).toBeNull();
  });

  it("AC-006 contains unknown input with fixed codes and lets known items continue", () => {
    const secret = "RAW_SECRET_SHOULD_NOT_SURVIVE";
    const unknownStart = {
      ...cursor(2),
      kind: "item.started",
      itemId: "unknown-a",
      ordinal: 0,
      itemKind: secret,
      rawPayload: secret,
    } as unknown as ConversationEvent;
    const unknownEvent = {
      ...cursor(3),
      kind: "unknown",
      rawPayload: { nested: secret },
    } as unknown as ConversationEvent;
    const state = reduceConversationEvents(createConversationState(), [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      unknownStart,
      unknownEvent,
      { ...cursor(4), kind: "item.started", itemId: "known-a", ordinal: 1, itemKind: "assistant_message" },
      { ...cursor(5), kind: "item.delta", itemId: "known-a", ordinal: 1, itemKind: "assistant_message", blockIndex: 0, blockType: "text", delta: "safe" },
    ]);
    const serialized = serializeConversationState(state);

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("unsupported_content");
    expect(serialized).toContain("unsupported_event");
    expect(selectConversationItem(state, THREAD_ID, TURN_ID, "known-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "safe" }]);
  });

  it("bounds sanitized diagnostics and turn notices", () => {
    const unknownEvents: ConversationEvent[] = Array.from(
      { length: MAX_CONVERSATION_DIAGNOSTICS + 8 },
      (_, index) => ({
        ...cursor(index + 1),
        eventId: `unknown-${index}`,
        kind: "unknown" as const,
      }),
    );
    const unknownState = reduceConversationEvents(createConversationState(), unknownEvents);
    expect(unknownState.diagnostics).toHaveLength(MAX_CONVERSATION_DIAGNOSTICS);

    const noticeEvents: ConversationEvent[] = [
      { ...cursor(1), kind: "turn.started", ordinal: 0 },
      ...Array.from({ length: MAX_CONVERSATION_NOTICES + 8 }, (_, index) => ({
        ...cursor(index + 2),
        eventId: `notice-${index}`,
        kind: "notice" as const,
        severity: index % 2 === 0 ? "warning" as const : "error" as const,
      })),
    ];
    const noticeState = reduceConversationEvents(createConversationState(), noticeEvents);
    expect(selectConversationTurn(noticeState, THREAD_ID, TURN_ID)?.notices)
      .toHaveLength(MAX_CONVERSATION_NOTICES);
  });

  it("rejects inconsistent or multiply-active authoritative snapshots", () => {
    const multipleActive = hydrateConversationState({
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [
        { threadId: THREAD_ID, turnId: TURN_ID, ordinal: 0, status: "in_progress", terminalStatus: null },
        { threadId: THREAD_ID, turnId: "turn-b", ordinal: 1, status: "queued", terminalStatus: null },
      ],
      items: [],
    });
    expect(multipleActive.syncStatus).toBe("recovery_required");

    const inconsistent = hydrateConversationState({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "completed",
        terminalStatus: null,
      }],
      items: [],
    });
    expect(inconsistent.syncStatus).toBe("recovery_required");
  });

  it("requires recovery on a sequence gap and stops projecting later events", () => {
    const initial = reduceConversationEvent(createConversationState(), {
      ...cursor(1),
      kind: "turn.started",
      ordinal: 0,
    });
    const gap = reduceConversationEvent(initial, {
      ...cursor(3),
      kind: "item.started",
      itemId: "missed",
      ordinal: 0,
      itemKind: "assistant_message",
    });

    expect(gap.recovery).toEqual({
      code: "sequence_gap",
      streamId: STREAM_ID,
      expectedSequence: "2",
      receivedSequence: "3",
    });
    expect(gap.syncStatus).toBe("recovery_required");
    expect(selectConversationTurn(gap, THREAD_ID, TURN_ID)?.status).toBe("recovery_required");
    expect(selectConversationItem(gap, THREAD_ID, TURN_ID, "missed")).toBeNull();
    expect(reduceConversationEvent(gap, {
      ...cursor(2),
      kind: "item.started",
      itemId: "late",
      ordinal: 0,
      itemKind: "assistant_message",
    })).toBe(gap);

    const recovered = reconcileConversationSnapshot(gap, terminalSnapshot("authoritative"));
    expect(recovered.syncStatus).toBe("synchronized");
    expect(selectConversationItem(recovered, THREAD_ID, TURN_ID, "assistant-a")?.contentBlocks)
      .toEqual([{ blockIndex: 0, type: "text", text: "authoritative" }]);
  });

  it("tracks auxiliary events in-order without changing conversation semantics", () => {
    const auxiliary: ConversationEvent = {
      eventId: "event-1",
      streamId: STREAM_ID,
      sequence: "1",
      threadId: THREAD_ID,
      kind: "auxiliary",
    };
    const tracked = reduceConversationEvent(createConversationState(), auxiliary);
    expect(tracked.streamPositions[STREAM_ID]).toBe("1");
    expect(tracked.turns).toEqual({});

    const continued = reduceConversationEvent(tracked, {
      ...cursor(2),
      kind: "turn.started",
      ordinal: 0,
    });
    expect(continued.syncStatus).toBe("synchronized");
    expect(selectConversationTurn(continued, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
    expect(reduceConversationEvent(continued, auxiliary)).toBe(continued);

    const gap = reduceConversationEvent(continued, {
      eventId: "event-4",
      streamId: STREAM_ID,
      sequence: "4",
      threadId: THREAD_ID,
      kind: "auxiliary",
    });
    expect(gap.recovery).toMatchObject({
      code: "sequence_gap",
      expectedSequence: "3",
      receivedSequence: "4",
    });
    expect(selectConversationTurn(gap, THREAD_ID, TURN_ID)?.status).toBe("in_progress");
  });
});
