import { describe, expect, it } from "vitest";
import { hydrateConversationState, type ConversationSnapshot } from "./conversation-state";
import { selectConversationTimeline } from "./conversation-timeline";

const THREAD_ID = "thread-feat134-timeline";
const TURN_ID = "turn-feat134-timeline";

function snapshot(): ConversationSnapshot {
  return {
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
        explanation: "safe plan",
        steps: [
          { ordinal: 0, text: "first", status: "completed" },
          { ordinal: 1, text: "second", status: "pending" },
        ],
      },
    }],
    items: [
      {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "commentary",
        ordinal: 1,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "commentary",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "process" }],
      },
      {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "unclassified",
        ordinal: 2,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "unknown",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "unclassified" }],
      },
      {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "reasoning",
        ordinal: 3,
        kind: "reasoning",
        status: "completed",
        reasoning: { status: "incomplete", reasonCode: "stream_gap" },
        contentBlocks: [
          { blockIndex: 0, type: "text", text: "raw" },
          { blockIndex: 1, type: "code", language: "md", text: "**still raw**" },
        ],
      },
      {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "final",
        ordinal: 4,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "final_answer",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "result" }],
      },
    ],
  };
}

describe("FEAT-134 conversation timeline selector", () => {
  it("projects explicit phase, plan, reasoning and thread notice without positional inference", () => {
    const timeline = selectConversationTimeline(
      hydrateConversationState(snapshot()),
      THREAD_ID,
    )!;
    const turn = timeline.turns[0]!;

    expect(timeline.notices).toEqual([
      expect.objectContaining({
        source: "thread_notice",
        severity: "warning",
        code: "conversation_warning",
      }),
    ]);
    expect(turn.plan).toMatchObject({
      explanation: "safe plan",
      collapsible: true,
      defaultExpanded: false,
      steps: [
        { ordinal: 0, text: "first", status: "completed" },
        { ordinal: 1, text: "second", status: "pending" },
      ],
    });
    expect(turn.items.map((item) => ({
      itemId: item.itemId,
      assistantPhase: item.assistantPhase,
      presentation: item.presentation,
      role: item.role,
      contentMode: item.contentMode,
      collapsible: item.collapsible,
      defaultExpanded: item.defaultExpanded,
      copyPolicy: item.copyPolicy,
    }))).toEqual([
      {
        itemId: "commentary",
        assistantPhase: "commentary",
        presentation: "commentary",
        role: "process",
        contentMode: "rich",
        collapsible: true,
        defaultExpanded: false,
        copyPolicy: "text_and_code",
      },
      {
        itemId: "unclassified",
        assistantPhase: "unknown",
        presentation: "assistant_unclassified",
        role: "process",
        contentMode: "rich",
        collapsible: true,
        defaultExpanded: false,
        copyPolicy: "text_and_code",
      },
      {
        itemId: "reasoning",
        assistantPhase: null,
        presentation: "reasoning",
        role: "process",
        contentMode: "plain",
        collapsible: true,
        defaultExpanded: false,
        copyPolicy: "none",
      },
      {
        itemId: "final",
        assistantPhase: "final_answer",
        presentation: "final_answer",
        role: "assistant",
        contentMode: "rich",
        collapsible: false,
        defaultExpanded: true,
        copyPolicy: "text_and_code",
      },
    ]);
    expect(turn.items.find((item) => item.itemId === "reasoning")?.reasoning)
      .toEqual({ status: "incomplete", reasonCode: "stream_gap" });
    expect(turn.items.find((item) => item.itemId === "reasoning")?.contentBlocks)
      .toEqual([
        expect.objectContaining({ type: "text", text: "raw" }),
        expect.objectContaining({ type: "text", text: "**still raw**" }),
      ]);
  });

  it("keeps plan and step identities stable across equivalent hydration", () => {
    const first = selectConversationTimeline(hydrateConversationState(snapshot()), THREAD_ID)!;
    const updated = snapshot();
    const second = selectConversationTimeline(hydrateConversationState({
      ...updated,
      turns: [{
        ...updated.turns[0]!,
        plan: {
          explanation: "updated explanation",
          steps: [
            { ordinal: 0, text: "first changed", status: "completed" },
            { ordinal: 1, text: "second changed", status: "in_progress" },
          ],
        },
      }],
    }), THREAD_ID)!;

    expect(first.turns[0]?.plan?.identity).toBe(second.turns[0]?.plan?.identity);
    expect(first.turns[0]?.plan?.steps.map((step) => step.identity))
      .toEqual(second.turns[0]?.plan?.steps.map((step) => step.identity));
    expect(second.turns[0]?.plan).toMatchObject({
      explanation: "updated explanation",
      steps: [
        { text: "first changed", status: "completed" },
        { text: "second changed", status: "in_progress" },
      ],
    });
  });

  it("never infers a final answer from text or position and expands only live process entries", () => {
    const input = snapshot();
    const state = hydrateConversationState({
      ...input,
      threads: [{ ...input.threads[0]!, status: "active" }],
      turns: [{
        ...input.turns[0]!,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: input.items.map((item) => item.itemId === "commentary"
        ? {
            ...item,
            contentBlocks: [{ blockIndex: 0, type: "text", text: "最终回答：看起来像结果" }],
          }
        : item),
    });
    const turn = selectConversationTimeline(state, THREAD_ID)!.turns[0]!;

    expect(turn.plan?.defaultExpanded).toBe(true);
    expect(turn.items.find((item) => item.itemId === "commentary")).toMatchObject({
      presentation: "commentary",
      collapsible: true,
      defaultExpanded: true,
    });
    expect(turn.items.find((item) => item.itemId === "unclassified")).toMatchObject({
      presentation: "assistant_unclassified",
      collapsible: true,
      defaultExpanded: true,
    });
    expect(turn.items.find((item) => item.itemId === "reasoning")).toMatchObject({
      presentation: "reasoning",
      contentMode: "plain",
      copyPolicy: "none",
      defaultExpanded: true,
    });
    expect(turn.items.find((item) => item.itemId === "final")).toMatchObject({
      presentation: "final_answer",
      domainStatus: "completed",
      collapsible: false,
      defaultExpanded: true,
    });
    expect(turn.progress).toMatchObject({ phase: "active" });
  });

  it("maps a missing assistant phase to unclassified instead of guessing final", () => {
    const input = snapshot();
    const state = hydrateConversationState({
      ...input,
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "missing-phase",
        ordinal: 99,
        kind: "assistant_message",
        status: "completed",
        contentBlocks: [{ blockIndex: 0, type: "text", text: "Final answer shaped text" }],
      }],
    });
    const timeline = selectConversationTimeline(state, THREAD_ID)!;

    expect(timeline.turns[0]?.items[0]).toMatchObject({
      assistantPhase: "unknown",
      presentation: "assistant_unclassified",
      role: "process",
      collapsible: true,
    });

    const [itemKey, item] = Object.entries(state.items)[0]!;
    const nullPhaseTimeline = selectConversationTimeline({
      ...state,
      items: { ...state.items, [itemKey]: { ...item, agentMessagePhase: null } },
    }, THREAD_ID)!;
    expect(nullPhaseTimeline.turns[0]?.items[0]).toMatchObject({
      assistantPhase: null,
      presentation: "assistant_unclassified",
    });
  });

  it("treats an empty stable plan snapshot as cleared", () => {
    const input = snapshot();
    const timeline = selectConversationTimeline(hydrateConversationState({
      ...input,
      turns: [{
        ...input.turns[0]!,
        plan: { explanation: "ignored without steps", steps: [] },
      }],
    }), THREAD_ID)!;

    expect(timeline.turns[0]?.plan).toBeNull();
  });
});
