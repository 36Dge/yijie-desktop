import { describe, expect, it, vi } from "vitest";
import {
  createFrameBatchedProjection,
  type FrameProjectionScheduler,
} from "./frame-batched-projection";
import {
  createConversationState,
  reduceConversationEvent,
  type ConversationEvent,
  type ConversationState,
} from "./conversation-state";
import { selectConversationTimeline } from "./conversation-timeline";

const THREAD_ID = "thread-frame-projection";
const TURN_ID = "turn-frame-projection";
const STREAM_ID = "stream-frame-projection";

type EventPayload<T> = T extends ConversationEvent
  ? Omit<T, "eventId" | "streamId" | "sequence" | "threadId" | "turnId">
  : never;

function event(
  sequence: number,
  payload: EventPayload<ConversationEvent>,
): ConversationEvent {
  return {
    eventId: `event-frame-projection-${sequence}`,
    streamId: STREAM_ID,
    sequence: String(sequence),
    threadId: THREAD_ID,
    turnId: TURN_ID,
    ...payload,
  } as ConversationEvent;
}

function controlledScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: FrameProjectionScheduler = {
    request(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  };
  return {
    scheduler,
    callbacks,
    runFrame() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}

describe("frame-batched presentation projection", () => {
  it("publishes only the latest value once per frame without dropping semantic input", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);

    for (let value = 1; value <= 1_000; value += 1) projection.push(value, true);
    expect(controlled.callbacks.size).toBe(1);
    expect(publish).not.toHaveBeenCalled();

    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(1_000);
  });

  it("holds a pending render while text is selected and flushes exactly once after release", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    let selectionActive = true;
    const projection = createFrameBatchedProjection(
      publish,
      controlled.scheduler,
      () => !selectionActive,
    );

    projection.push("partial", true);
    controlled.runFrame();
    projection.push("final", false);
    expect(publish).not.toHaveBeenCalled();

    selectionActive = false;
    expect(projection.flush()).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("final");
    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("cancels pending publication on disposal", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);
    projection.push("stale", true);
    projection.dispose();
    controlled.runFrame();
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps the reducer synchronous while publishing an equivalent interleaved Timeline once", () => {
    const controlled = controlledScheduler();
    const published: ConversationState[] = [];
    const projection = createFrameBatchedProjection(
      (state: ConversationState) => published.push(state),
      controlled.scheduler,
    );
    const events: ConversationEvent[] = [
      event(1, { kind: "turn.started", ordinal: 0 }),
      event(2, {
        kind: "turn.plan.updated",
        explanation: "synthetic plan",
        steps: [{ text: "inspect", status: "in_progress" }],
      }),
      event(3, {
        kind: "item.delta",
        itemId: "reasoning-item",
        ordinal: 1,
        itemKind: "reasoning",
        blockIndex: 0,
        blockType: "text",
        delta: "reasoning metadata",
      }),
      event(4, {
        kind: "item.delta",
        itemId: "final-item",
        ordinal: 2,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
        blockIndex: 0,
        blockType: "text",
        delta: "A",
      }),
      event(5, {
        kind: "item.delta",
        itemId: "final-item",
        ordinal: 2,
        itemKind: "assistant_message",
        agentMessagePhase: "final_answer",
        blockIndex: 0,
        blockType: "text",
        delta: "B",
      }),
    ];

    let semanticState = createConversationState();
    for (const nextEvent of events) {
      semanticState = reduceConversationEvent(semanticState, nextEvent);
      projection.push(semanticState, true);
    }

    expect(semanticState.streamPositions[STREAM_ID]).toBe("5");
    expect(published).toHaveLength(0);
    expect(controlled.callbacks.size).toBe(1);

    controlled.runFrame();
    expect(published).toHaveLength(1);
    expect(selectConversationTimeline(published[0]!, THREAD_ID))
      .toEqual(selectConversationTimeline(semanticState, THREAD_ID));
    expect(selectConversationTimeline(published[0]!, THREAD_ID)?.turns[0])
      .toMatchObject({
        phase: "active",
        plan: { steps: [{ text: "inspect", status: "in_progress" }] },
        items: [
          { presentation: "reasoning" },
          { presentation: "final_answer", contentBlocks: [{ text: "AB" }] },
        ],
      });
  });

  it("publishes a terminal state immediately and leaves no streaming presentation behind", () => {
    const controlled = controlledScheduler();
    const published: ConversationState[] = [];
    const projection = createFrameBatchedProjection(
      (state: ConversationState) => published.push(state),
      controlled.scheduler,
    );
    let semanticState = reduceConversationEvent(
      createConversationState(),
      event(1, { kind: "turn.started", ordinal: 0 }),
    );
    semanticState = reduceConversationEvent(semanticState, event(2, {
      kind: "item.delta",
      itemId: "final-item",
      ordinal: 1,
      itemKind: "assistant_message",
      agentMessagePhase: "final_answer",
      blockIndex: 0,
      blockType: "text",
      delta: "complete",
    }));
    projection.push(semanticState, true);

    semanticState = reduceConversationEvent(semanticState, event(3, {
      kind: "turn.completed",
      terminalStatus: "completed",
    }));
    projection.push(semanticState, false);

    expect(published).toHaveLength(1);
    expect(controlled.callbacks.size).toBe(0);
    const terminalTimeline = selectConversationTimeline(published[0]!, THREAD_ID);
    expect(terminalTimeline?.turns[0]).toMatchObject({
      domainStatus: "completed",
      phase: "complete",
      progress: null,
      items: [{ domainStatus: "completed", phase: "complete" }],
    });
  });

  it("replaces a pending session publication before the next frame", () => {
    const controlled = controlledScheduler();
    const publish = vi.fn();
    const projection = createFrameBatchedProjection(publish, controlled.scheduler);

    projection.push({ sessionId: "old", revision: 1 }, true);
    projection.push({ sessionId: "new", revision: 2 }, false);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ sessionId: "new", revision: 2 });
    controlled.runFrame();
    expect(publish).toHaveBeenCalledOnce();
  });
});
