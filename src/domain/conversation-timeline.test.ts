import { describe, expect, it } from "vitest";
import {
  hydrateConversationState,
  type ConversationContentBlock,
  type ConversationItemKind,
  type ConversationItemStatus,
  type ConversationSnapshot,
  type ConversationState,
  type ConversationThreadStatus,
  type ConversationTurnStatus,
} from "./conversation-state";
import {
  selectConversationTimeline,
  type ConversationTimelineItemKind,
  type ConversationTimelineItemPhase,
  type ConversationTimelineRole,
  type ConversationTimelineThreadPhase,
  type ConversationTimelineTurnPhase,
} from "./conversation-timeline";

const THREAD_ID = "thread-main";
const TURN_ID = "turn-main";

function hydrate(snapshot: ConversationSnapshot): ConversationState {
  return hydrateConversationState(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function singleTurnState(
  status: ConversationTurnStatus,
  terminalStatus: "completed" | "failed" | "interrupted" | null = null,
): ConversationState {
  return hydrate({
    threads: [{ threadId: THREAD_ID, status: status === "completed" ? "ready" : "active" }],
    turns: [{
      threadId: THREAD_ID,
      turnId: TURN_ID,
      ordinal: 0,
      status,
      terminalStatus,
    }],
    items: [],
  });
}

function singleItemState(status: ConversationItemStatus = "completed"): ConversationState {
  return hydrate({
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
      itemId: "item-main",
      ordinal: 0,
      kind: "assistant_message",
      status,
      contentBlocks: [{ blockIndex: 0, type: "text", text: "safe text" }],
    }],
  });
}

describe("selectConversationTimeline", () => {
  it("sorts related Turns and Items by ordinal then stable domain identity", () => {
    const normalized = hydrate({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [
        {
          threadId: THREAD_ID,
          turnId: "turn-c",
          ordinal: 2,
          status: "completed",
          terminalStatus: "completed",
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-b",
          ordinal: 1,
          status: "completed",
          terminalStatus: "completed",
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-a",
          ordinal: 1,
          status: "completed",
          terminalStatus: "completed",
        },
      ],
      items: [
        {
          threadId: THREAD_ID,
          turnId: "turn-a",
          itemId: "item-b",
          ordinal: 1,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "B" }],
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-a",
          itemId: "item-a",
          ordinal: 1,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "A" }],
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-a",
          itemId: "item-zero",
          ordinal: 0,
          kind: "user_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "question" }],
        },
      ],
    });
    const thread = normalized.threads[THREAD_ID]!;
    const reordered: ConversationState = {
      ...normalized,
      threads: {
        ...normalized.threads,
        [THREAD_ID]: { ...thread, turnKeys: [...thread.turnKeys].reverse() },
      },
      turns: Object.fromEntries(Object.entries(normalized.turns).reverse().map(([key, turn]) => [
        key,
        { ...turn, itemKeys: [...turn.itemKeys].reverse() },
      ])),
      items: Object.fromEntries(Object.entries(normalized.items).reverse()),
    };

    const timeline = selectConversationTimeline(reordered, THREAD_ID)!;

    expect(timeline.turns.map((turn) => turn.turnId)).toEqual(["turn-a", "turn-b", "turn-c"]);
    expect(timeline.turns[0]?.items.map((item) => item.itemId))
      .toEqual(["item-zero", "item-a", "item-b"]);
    expect(timeline.isReadyEmpty).toBe(false);
  });

  it("keeps collision-safe Turn and Item identities stable across ordinal and key-order changes", () => {
    const normalized = hydrate({
      threads: [
        { threadId: "ab", status: "ready" },
        { threadId: "a", status: "ready" },
      ],
      turns: [
        {
          threadId: "ab",
          turnId: "c",
          ordinal: 0,
          status: "completed",
          terminalStatus: "completed",
        },
        {
          threadId: "a",
          turnId: "bc",
          ordinal: 0,
          status: "completed",
          terminalStatus: "completed",
        },
      ],
      items: [
        {
          threadId: "ab",
          turnId: "c",
          itemId: "d|e",
          ordinal: 0,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [],
        },
        {
          threadId: "a",
          turnId: "bc",
          itemId: "d|e",
          ordinal: 0,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [],
        },
      ],
    });
    const original = selectConversationTimeline(normalized, "ab")!;
    const other = selectConversationTimeline(normalized, "a")!;
    const moved: ConversationState = {
      ...normalized,
      turns: Object.fromEntries(Object.entries(normalized.turns).reverse().map(([key, turn]) => [
        key,
        turn.threadId === "ab" ? { ...turn, ordinal: 99 } : turn,
      ])),
      items: Object.fromEntries(Object.entries(normalized.items).reverse().map(([key, item]) => [
        key,
        item.threadId === "ab" ? { ...item, ordinal: 77 } : item,
      ])),
    };
    const projectedAgain = selectConversationTimeline(moved, "ab")!;

    expect(projectedAgain.identity).toBe(original.identity);
    expect(projectedAgain.turns[0]?.identity).toBe(original.turns[0]?.identity);
    expect(projectedAgain.turns[0]?.items[0]?.identity)
      .toBe(original.turns[0]?.items[0]?.identity);
    expect(original.turns[0]?.identity).not.toBe(other.turns[0]?.identity);
    expect(original.turns[0]?.items[0]?.identity).not.toBe(other.turns[0]?.items[0]?.identity);
  });

  it("maps every Thread and Turn status without inventing timing or permission facts", () => {
    const threadCases: readonly [ConversationThreadStatus, ConversationTimelineThreadPhase][] = [
      ["not_loaded", "loading"],
      ["ready", "ready"],
      ["active", "active"],
      ["archived", "archived"],
      ["unavailable", "unavailable"],
    ];
    for (const [domainStatus, phase] of threadCases) {
      const timeline = selectConversationTimeline(hydrate({
        threads: [{ threadId: THREAD_ID, status: domainStatus }],
        turns: [],
        items: [],
      }), THREAD_ID)!;
      expect({ domainStatus: timeline.domainStatus, phase: timeline.phase })
        .toEqual({ domainStatus, phase });
      expect(timeline.isReadyEmpty).toBe(domainStatus === "ready");
      expect(timeline).not.toHaveProperty("permissionDenied");
    }
    const readyEmpty = hydrate({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [],
      items: [],
    });
    expect(selectConversationTimeline({
      ...readyEmpty,
      syncStatus: "recovery_required",
    }, THREAD_ID)?.isReadyEmpty).toBe(false);

    const turnCases: readonly [
      ConversationTurnStatus,
      "completed" | "failed" | "interrupted" | null,
      ConversationTimelineTurnPhase,
      ConversationTimelineTurnPhase | null,
    ][] = [
      ["queued", null, "pending", "pending"],
      ["in_progress", null, "active", "active"],
      ["waiting_approval", null, "waiting", "waiting"],
      ["completed", "completed", "complete", null],
      ["interrupted", "interrupted", "interrupted", null],
      ["failed", "failed", "failed", null],
      ["recovery_required", null, "recovery_required", null],
    ];
    for (const [domainStatus, terminalStatus, phase, progressPhase] of turnCases) {
      const turn = selectConversationTimeline(
        singleTurnState(domainStatus, terminalStatus),
        THREAD_ID,
      )!.turns[0]!;
      expect({ domainStatus: turn.domainStatus, terminalStatus: turn.terminalStatus, phase: turn.phase })
        .toEqual({ domainStatus, terminalStatus, phase });
      expect(turn.progress?.phase ?? null).toBe(progressPhase);
      expect(turn).not.toHaveProperty("startedAt");
      expect(turn).not.toHaveProperty("durationMs");
    }

    const completed = singleTurnState("completed", "completed");
    const recovered: ConversationState = {
      ...completed,
      turns: Object.fromEntries(Object.entries(completed.turns).map(([key, turn]) => [
        key,
        { ...turn, status: "recovery_required" as const },
      ])),
    };
    expect(selectConversationTimeline(recovered, THREAD_ID)?.turns[0]).toMatchObject({
      domainStatus: "recovery_required",
      phase: "recovery_required",
      terminalStatus: "completed",
    });
  });

  it("maps all Item roles, presentation kinds, and lifecycle phases deterministically", () => {
    const domainKinds: readonly ConversationItemKind[] = [
      "user_message",
      "assistant_message",
      "reasoning",
      "artifact",
      "command",
      "tool",
      "approval",
      "unknown",
    ];
    const expected: readonly [
      ConversationTimelineItemKind,
      ConversationTimelineRole,
    ][] = [
      ["user_message", "user"],
      ["assistant_message", "process"],
      ["reasoning", "process"],
      ["artifact", "assistant"],
      ["unknown", "system"],
      ["unknown", "system"],
      ["unknown", "system"],
      ["unknown", "system"],
    ];
    const normalized = hydrate({
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: domainKinds.map((_, ordinal) => ({
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: `item-${ordinal}`,
        ordinal,
        kind: "unknown" as const,
        status: "completed" as const,
        contentBlocks: [],
      })),
    });
    const withKinds: ConversationState = {
      ...normalized,
      items: Object.fromEntries(Object.entries(normalized.items).map(([key, item]) => [
        key,
        { ...item, kind: domainKinds[item.ordinal]! },
      ])),
    };
    const items = selectConversationTimeline(withKinds, THREAD_ID)!.turns[0]!.items;

    expect(items.map((item) => [item.kind, item.role])).toEqual(expected);
    expect(items.slice(4).every((item) =>
      item.contentBlocks.length === 1 && item.contentBlocks[0]?.type === "unknown"
    )).toBe(true);

    const itemCases: readonly [ConversationItemStatus, ConversationTimelineItemPhase][] = [
      ["started", "pending"],
      ["streaming", "active"],
      ["completed", "complete"],
    ];
    for (const [domainStatus, phase] of itemCases) {
      const item = selectConversationTimeline(singleItemState(domainStatus), THREAD_ID)!
        .turns[0]!.items[0]!;
      expect({ domainStatus: item.domainStatus, phase: item.phase })
        .toEqual({ domainStatus, phase });
      expect(item).not.toHaveProperty("createdAt");
      expect(item).not.toHaveProperty("durationMs");
    }
  });

  it("preserves closed sync and reconciliation states in the presentation model", () => {
    const cases = [
      ["not_applicable", "synchronized"],
      ["matched", "synchronized"],
      ["mismatch", "recovery_required"],
    ] as const;

    for (const [reconciliation, syncStatus] of cases) {
      const normalized = singleItemState();
      const state: ConversationState = {
        ...normalized,
        syncStatus,
        items: Object.fromEntries(Object.entries(normalized.items).map(([key, item]) => [
          key,
          { ...item, reconciliation },
        ])),
      };
      const timeline = selectConversationTimeline(state, THREAD_ID)!;

      expect(timeline.syncStatus).toBe(syncStatus);
      expect(timeline.turns[0]?.items[0]?.reconciliation).toBe(reconciliation);
    }
  });

  it("projects sorted, inert ContentBlocks while preserving attachment and Artifact references", () => {
    const contentCanary = "FUTURE_BLOCK_PAYLOAD_CANARY";
    const blocks: readonly ConversationContentBlock[] = [
      { blockIndex: 4, type: "unknown", code: "unsupported_content" },
      {
        blockIndex: 3,
        type: "attachment_reference",
        attachmentId: "attachment-1",
        kind: "image",
        name: "safe.png",
        mediaType: "image/png",
        sizeBytes: 68,
        status: "ready",
        expiresAt: 100,
      },
      { blockIndex: 2, type: "artifact_reference", artifactId: "artifact-1", label: "报告" },
      { blockIndex: 1, type: "code", language: "ts", text: "const safe = true;" },
      { blockIndex: 0, type: "text", text: "plain **inert** text" },
    ];
    const normalized = hydrate({
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
        itemId: "item-content",
        ordinal: 0,
        kind: "assistant_message",
        status: "completed",
        contentBlocks: blocks,
      }],
    });
    const reversed: ConversationState = {
      ...normalized,
      items: Object.fromEntries(Object.entries(normalized.items).map(([key, item]) => [
        key,
        {
          ...item,
          contentBlocks: [
            ...item.contentBlocks,
            {
              blockIndex: 5,
              type: "future_block",
              rawPayload: contentCanary,
            } as unknown as ConversationContentBlock,
          ].reverse(),
        },
      ])),
    };
    const sourceItem = Object.values(reversed.items)[0]!;
    const item = selectConversationTimeline(reversed, THREAD_ID)!.turns[0]!.items[0]!;

    expect(item.contentBlocks.map((block) => block.blockIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(item.contentBlocks[0]).toMatchObject({ type: "text", text: "plain **inert** text" });
    expect(item.contentBlocks[1]).toMatchObject({
      type: "code",
      language: "ts",
      text: "const safe = true;",
    });
    expect(item.contentBlocks[2]).toMatchObject({
      type: "artifact_reference",
      artifactId: "artifact-1",
      label: "报告",
    });
    expect(item.contentBlocks[3]).toMatchObject({
      type: "attachment_reference",
      attachmentId: "attachment-1",
      kind: "image",
      name: "safe.png",
    });
    expect(item.contentBlocks[5]).toMatchObject({
      type: "unknown",
      code: "unsupported_content",
    });
    expect(JSON.stringify(item)).not.toContain(contentCanary);
    expect(item.contentBlocks[0]).not.toBe(sourceItem.contentBlocks[5]);
    expect(item.contentBlocks.every(Object.isFrozen)).toBe(true);
  });

  it("keeps Turn progress and aggregated notices separate from domain Items", () => {
    const state = hydrate({
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "waiting_approval",
        terminalStatus: null,
        notices: [
          { severity: "warning", code: "conversation_warning" },
          { severity: "error", code: "conversation_error" },
          { severity: "error", code: "conversation_error" },
        ],
      }],
      items: [],
    });
    const turn = selectConversationTimeline(state, THREAD_ID)!.turns[0]!;

    expect(turn.items).toEqual([]);
    expect(turn.progress).toMatchObject({
      role: "process",
      domainStatus: "waiting_approval",
      phase: "waiting",
    });
    expect(turn.notices).toEqual([
      expect.objectContaining({
        role: "system",
        severity: "error",
        code: "conversation_error",
        count: 2,
      }),
      expect.objectContaining({
        role: "system",
        severity: "warning",
        code: "conversation_warning",
        count: 1,
      }),
    ]);
    expect(turn.notices[0]?.identity).not.toBe(turn.notices[1]?.identity);
  });

  it("fails soft for unsupported Items without exposing extra payload or losing neighbors", () => {
    const normalized = hydrate({
      threads: [{ threadId: THREAD_ID, status: "ready" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "completed",
        terminalStatus: "completed",
      }],
      items: [
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "before",
          ordinal: 0,
          kind: "user_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "before" }],
        },
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "unsupported",
          ordinal: 1,
          kind: "unknown",
          status: "completed",
          contentBlocks: [],
        },
        {
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: "after",
          ordinal: 2,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "after" }],
        },
      ],
    });
    const canary = "RAW_PAYLOAD_CANARY";
    const poisoned: ConversationState = {
      ...normalized,
      items: Object.fromEntries(Object.entries(normalized.items).map(([key, item]) => [
        key,
        item.itemId === "unsupported"
          ? {
              ...item,
              kind: canary as ConversationItemKind,
              contentBlocks: [{ blockIndex: 0, type: "text" as const, text: canary }],
              rawPayload: canary,
            }
          : item,
      ])),
    };
    const timeline = selectConversationTimeline(poisoned, THREAD_ID)!;
    const unsupported = timeline.turns[0]!.items[1]!;

    expect(timeline.turns[0]?.items.map((item) => item.itemId))
      .toEqual(["before", "unsupported", "after"]);
    expect(unsupported).toMatchObject({
      kind: "unknown",
      role: "system",
      contentBlocks: [{ blockIndex: 0, type: "unknown", code: "unsupported_content" }],
    });
    expect(JSON.stringify(timeline)).not.toContain(canary);
  });

  it("does not mutate ConversationState and returns deeply frozen nullable/empty models", () => {
    const normalized = hydrate({
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [
        {
          threadId: THREAD_ID,
          turnId: "turn-history",
          ordinal: 0,
          status: "completed",
          terminalStatus: "completed",
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-active",
          ordinal: 1,
          status: "waiting_approval",
          terminalStatus: null,
          notices: [
            { severity: "warning", code: "conversation_warning" },
            { severity: "error", code: "conversation_error" },
          ],
        },
      ],
      items: [
        {
          threadId: THREAD_ID,
          turnId: "turn-history",
          itemId: "item-b",
          ordinal: 1,
          kind: "assistant_message",
          status: "completed",
          contentBlocks: [
            { blockIndex: 0, type: "text", text: "answer" },
            { blockIndex: 1, type: "code", language: null, text: "code" },
          ],
        },
        {
          threadId: THREAD_ID,
          turnId: "turn-history",
          itemId: "item-a",
          ordinal: 0,
          kind: "user_message",
          status: "completed",
          contentBlocks: [{ blockIndex: 0, type: "text", text: "question" }],
        },
      ],
    });
    const thread = normalized.threads[THREAD_ID]!;
    const state = deepFreeze<ConversationState>({
      ...normalized,
      threads: {
        ...normalized.threads,
        [THREAD_ID]: { ...thread, turnKeys: [...thread.turnKeys].reverse() },
      },
      turns: Object.fromEntries(Object.entries(normalized.turns).reverse().map(([key, turn]) => [
        key,
        { ...turn, itemKeys: [...turn.itemKeys].reverse() },
      ])),
      items: Object.fromEntries(Object.entries(normalized.items).reverse().map(([key, item]) => [
        key,
        { ...item, contentBlocks: [...item.contentBlocks].reverse() },
      ])),
    });
    const before = JSON.stringify(state);
    const turnKeysBefore = state.threads[THREAD_ID]!.turnKeys;
    const historyTurn = Object.values(state.turns)
      .find((turn) => turn.turnId === "turn-history")!;
    const itemKeysBefore = historyTurn.itemKeys;
    const sourceItem = Object.values(state.items).find((item) => item.itemId === "item-b")!;
    const blocksBefore = sourceItem.contentBlocks;
    const timeline = selectConversationTimeline(state, THREAD_ID)!;

    expect(JSON.stringify(state)).toBe(before);
    expect(state.threads[THREAD_ID]?.turnKeys).toBe(turnKeysBefore);
    expect(historyTurn.itemKeys).toBe(itemKeysBefore);
    expect(sourceItem.contentBlocks).toBe(blocksBefore);
    expect(timeline.turns.map((turn) => turn.turnId))
      .toEqual(["turn-history", "turn-active"]);
    expect(timeline.turns[0]?.items.map((item) => item.itemId)).toEqual(["item-a", "item-b"]);
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.turns)).toBe(true);
    expect(timeline.turns.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(timeline.turns[1]?.progress)).toBe(true);
    expect(Object.isFrozen(timeline.turns[1]?.notices)).toBe(true);
    expect(timeline.turns[1]?.notices.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(timeline.turns[0]?.items)).toBe(true);
    expect(timeline.turns[0]?.items.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(timeline.turns[0]?.items[1]?.contentBlocks)).toBe(true);
    expect(timeline.turns[0]?.items[1]?.contentBlocks.every(Object.isFrozen)).toBe(true);
    expect(selectConversationTimeline(state, "missing-thread")).toBeNull();

    const empty = selectConversationTimeline(hydrate({
      threads: [{ threadId: "empty-thread", status: "ready" }],
      turns: [],
      items: [],
    }), "empty-thread")!;
    expect(empty.isReadyEmpty).toBe(true);
    expect(empty.turns).toEqual([]);
    expect(Object.isFrozen(empty.turns)).toBe(true);
  });
});
