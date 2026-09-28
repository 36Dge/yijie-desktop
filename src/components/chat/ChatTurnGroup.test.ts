// @vitest-environment happy-dom

import { enableAutoUnmount, mount } from "@vue/test-utils";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { afterEach,describe,expect,it,vi } from "vitest";
import { h } from "vue";
import type { ConversationApproval } from "../../domain/conversation-approval";
import {
selectConversationTimeline,
type ConversationTimelineArtifactReferenceContentBlock,
type ConversationTimelineAttachmentReferenceContentBlock,
type ConversationTimelineItemViewModel,
type ConversationTimelineTurnViewModel,
} from "../../domain/conversation-timeline";
import {
viewFromLegacySnapshot,
type ConversationItemSnapshot,
type ConversationNotice,
type ConversationPlanSnapshot,
type ConversationTurnStatus,
} from "../../domain/conversation-view";
import ChatTimelineItemShell from "./ChatTimelineItemShell.vue";
import ChatTurnGroup from "./ChatTurnGroup.vue";

enableAutoUnmount(afterEach);

const THREAD_ID = "thread-demo";
const TURN_ID = "turn-demo";

it("uses the draft review slot for unclassified output without inventing its phase", async () => {
  const item = { ...message("unclassified", 0, "assistant_message", '{"raw":"provider"}'), agentMessagePhase: null };
  const turn = projectedTurn({ items: [item] });
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
    props: { turn, position: 0 },
    slots: { "structured-answer": ({ turnId }: { turnId: string }) => h("button", { "data-turn": turnId }, "查看本轮草案摘要") },
  });
  expect(wrapper.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
  expect(wrapper.text()).toContain("草案以校验结果为准");
  expect(wrapper.text()).toContain("模型回答");
  expect(wrapper.text()).not.toContain("未标注阶段");
  expect(wrapper.text()).not.toContain('{"raw":"provider"}');
  expect(wrapper.get("[data-turn]").attributes("data-turn")).toBe(TURN_ID);
  expect(turn.items[0]?.presentation).toBe("assistant_unclassified");
  wrapper.unmount();
});

afterEach(() => {
  vi.useRealTimers();
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function projectedTurn(options: {
  status?: ConversationTurnStatus;
  items?: readonly ConversationItemSnapshot[];
  notices?: readonly ConversationNotice[];
  plan?: ConversationPlanSnapshot | null;
} = {}): ConversationTimelineTurnViewModel {
  const status = options.status ?? "completed";
  const terminalStatus = status === "completed" || status === "failed" || status === "interrupted"
    ? status
    : null;
  const timeline = selectConversationTimeline(viewFromLegacySnapshot({
    threads: [{ threadId: THREAD_ID, status: status === "completed" ? "ready" : "active" }],
    turns: [{
      threadId: THREAD_ID,
      turnId: TURN_ID,
      ordinal: 0,
      status,
      terminalStatus,
      notices: options.notices,
      plan: options.plan,
    }],
    items: options.items ?? [],
  }), THREAD_ID);
  if (timeline === null || timeline.turns[0] === undefined) throw new Error("fixture_missing_turn");
  return timeline.turns[0];
}

function message(
  itemId: string,
  ordinal: number,
  kind: ConversationItemSnapshot["kind"],
  text: string,
  status: ConversationItemSnapshot["status"] = "completed",
): ConversationItemSnapshot {
  return {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId,
    ordinal,
    kind,
    status,
    agentMessagePhase: kind === "assistant_message" ? "final_answer" : undefined,
    reasoning: kind === "reasoning"
      ? { status: status === "completed" ? "complete" : "in_progress", reasonCode: null }
      : undefined,
    contentBlocks: [{ blockIndex: 0, type: "text", text }],
  };
}

function command(): ConversationItemSnapshot {
  const source = (sequence: string) => ({
    sourceEventId: `command-event-${sequence}`,
    sourceSequence: sequence,
    sourceOccurredAt: "2026-08-30T14:28:00.000Z",
  });
  return {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: "command-demo",
    ordinal: 0,
    kind: "command",
    status: "streaming",
    execution: {
      kind: "command",
      status: "running",
      startedSource: source("1"),
      lastSource: source("2"),
      commandSummary: {
        text: "检查工作区状态",
        truncated: false,
        truncationReason: null,
      },
      cwd: { kind: "workspace_root", segments: [] },
      liveOutput: null,
      output: null,
      durationMs: null,
      exitCode: null,
      error: null,
    },
    contentBlocks: [],
  };
}

function pendingApproval(): ConversationApproval {
  return deepFreeze({
    approvalRequestId: "66666666-6666-4666-8666-666666666666",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: "command-demo",
    revision: 1,
    status: "pending",
    actionId: "git_repository_check",
    workspaceScope: "current_workspace",
    decisions: { primary: "accept_once", secondary: "cancel_current_turn" },
    requestedAt: "2026-08-30T14:28:00.000Z",
    expiresAt: "2026-08-30T14:30:00.000Z",
    resolvedAt: null,
    decisionId: null,
    decision: null,
    outcome: null,
    authority: "actionable",
    authorityStreamId: "55555555-5555-4555-8555-555555555555",
    source: {
      sourceEventId: "44444444-4444-4444-8444-444444444444",
      sourceSequence: "3",
      sourceOccurredAt: "2026-08-30T14:28:00.000Z",
    },
  });
}

function turnWithApproval(): ConversationTimelineTurnViewModel {
  const turn = projectedTurn({ status: "waiting_approval", items: [command()] });
  return deepFreeze({
    ...turn,
    items: turn.items.map((item) => ({ ...item, approval: pendingApproval() })),
  });
}

describe("ChatTurnGroup", () => {
  it("renders projected Items in order with closed role and unknown renderers", () => {
    const turn = projectedTurn({
      notices: [{ severity: "warning", code: "conversation_warning" }],
      items: [
        message("assistant", 2, "assistant_message", "回答内容"),
        message("unknown", 3, "unknown", "普通的未来类型占位内容"),
        message("user", 0, "user_message", "用户内容"),
        message("reasoning", 1, "reasoning", "过程内容"),
      ],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });
    const itemElements = wrapper.findAll(".chat-turn-group__items > .chat-turn-group__item");

    expect(itemElements).toHaveLength(4);
    expect(itemElements.map((element) => element.classes().find((name) =>
      name.startsWith("chat-turn-group__item--"))))
      .toEqual([
        "chat-turn-group__item--user_message",
        "chat-turn-group__item--reasoning",
        "chat-turn-group__item--final_answer",
        "chat-turn-group__item--unknown",
      ]);
    expect(itemElements[0]?.text()).toBe("用户内容");
    expect(itemElements[0]?.get("article").attributes("aria-label")).toBe("用户消息");
    expect(itemElements[1]?.get("article").attributes("aria-label")).toBe("过程记录");
    expect(itemElements[1]?.isVisible()).toBe(false);
    expect(itemElements[2]?.text()).toContain("模型回答");
    expect(itemElements[2]?.text()).toContain("回答内容");
    expect(itemElements[3]?.text()).toContain("此内容类型暂不支持");
    expect(itemElements[3]?.text()).toContain("unsupported_content");
    expect(itemElements[3]?.text()).not.toContain("普通的未来类型占位内容");

    const section = wrapper.get("section");
    expect(section.attributes("aria-label")).toBe("对话 1");
    expect(wrapper.find(".chat-turn-group__header").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__notices").element.parentElement).toBe(section.element);
    expect(wrapper.get(".chat-turn-group__notices").element)
      .not.toBe(wrapper.get(".chat-turn-group__items").element);
  });

  it("labels an unfinished item separately from an explicitly completed item", () => {
    const turn = projectedTurn({
      status: "interrupted",
      items: [message("partial-answer", 0, "assistant_message", "partial", "incomplete")],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });

    expect(wrapper.get(".chat-timeline-item-shell__status").text()).toBe("未完整结束");
    expect(wrapper.get(".chat-timeline-item-shell").classes())
      .toContain("chat-timeline-item-shell--incomplete");
  });

  it("keeps approval decisions closed by default and relays complete identity through an explicit bridge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-30T14:29:00.000Z"));
    const turn = turnWithApproval();
    const closed = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });

    expect(closed.find(".chat-approval-card").exists()).toBe(true);
    expect(closed.findAll(".chat-approval-card__button")
      .every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(closed.text()).toContain("暂时无法确认");
    closed.unmount();

    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1, canDecideApprovals: true },
    });
    const buttons = wrapper.findAll(".chat-approval-card__button");
    expect(buttons.every((button) => button.attributes("disabled") === undefined)).toBe(true);

    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("approval-decision")).toEqual([[{
      itemIdentity: turn.items[0]!.identity,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      itemId: "command-demo",
      approvalRequestId: pendingApproval().approvalRequestId,
      decision: "cancel_current_turn",
    }]]);
  });

  it("collapses historical process content regardless of length and never hides the final answer", async () => {
    const shortReasoning = "**短过程保持字面量**".padEnd(320, "甲");
    const longReasoning = "**长过程保持字面量** [参考](https://docs.invalid)".padEnd(321, "乙");
    const assistant = "**最终回答可使用富文本**".padEnd(500, "丙");
    const turn = projectedTurn({
      items: [
        message("reasoning-short", 0, "reasoning", shortReasoning),
        message("reasoning-long", 1, "reasoning", longReasoning),
        message("assistant", 2, "assistant_message", assistant),
      ],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });
    const reasoningItems = wrapper.findAll(".chat-turn-group__item--reasoning");

    expect(reasoningItems).toHaveLength(2);
    const disclosure = wrapper.get(".chat-turn-group__process-toggle");
    expect(disclosure.attributes("aria-expanded")).toBe("false");
    expect(reasoningItems.every(item => !item.isVisible())).toBe(true);
    expect(reasoningItems.every(item => !item.find("button").exists())).toBe(true);

    const assistantItem = wrapper.get(".chat-turn-group__item--final_answer");
    expect(assistantItem.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(assistantItem.get(".chat-timeline-item-shell__body").text()).toContain("最终回答");
    expect(assistantItem.get(".chat-safe-content strong").text()).toBe("最终回答可使用富文本");

    await disclosure.trigger("click");
    expect(disclosure.attributes("aria-expanded")).toBe("true");
    expect(reasoningItems.every(item => item.isVisible())).toBe(true);
    expect(reasoningItems[0]?.get(".chat-timeline-item-shell__body").text())
      .toContain("**短过程保持字面量**");
    expect(reasoningItems[0]?.find(".chat-safe-content strong").exists()).toBe(false);
    expect(reasoningItems[0]?.find(".chat-safe-content__inert-link").exists()).toBe(false);
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({
      itemIdentity: turn.identity,
      expanded: true,
    });
  });

  it("renders authoritative completed reasoning status without inventing content", async () => {
    const turn = projectedTurn({
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "reasoning-metadata-only",
        ordinal: 0,
        kind: "reasoning",
        status: "completed",
        reasoning: { status: "complete", reasonCode: null },
        contentBlocks: [],
      }],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });

    expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(wrapper.get("article").attributes("aria-label")).toBe("过程记录");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(wrapper.text()).toContain("模型推理记录已完成，但没有可显示的正文。");
    expect(wrapper.get(".chat-turn-group__reasoning-state").attributes("role")).toBe("note");
    expect(wrapper.find(".chat-safe-content").exists()).toBe(false);
  });

  it("shows saved unfinished reasoning without claiming a live wait", () => {
    const turn = projectedTurn({
      status: "in_progress",
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "reasoning-active-empty",
        ordinal: 0,
        kind: "reasoning",
        status: "streaming",
        reasoning: { status: "in_progress", reasonCode: null },
        contentBlocks: [],
      }],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });

    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("仅有已观察记录，当前进度待确认");
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
  });

  it("renders unavailable and unknown reasoning states explicitly", async () => {
    const turn = projectedTurn({
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "reasoning-unavailable",
        ordinal: 0,
        kind: "reasoning",
        status: "completed",
        reasoning: { status: "unavailable", reasonCode: "reasoning_not_emitted" },
        contentBlocks: [],
      }, {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "reasoning-unknown",
        ordinal: 1,
        kind: "reasoning",
        status: "completed",
        reasoning: { status: "unknown", reasonCode: "unknown" },
        contentBlocks: [],
      }],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1 } });
    const reasoningItems = wrapper.findAll(".chat-turn-group__item--reasoning");

    expect(reasoningItems.map((item) => item.get(".chat-timeline-item-shell__status").text()))
      .toEqual(["不可用", "状态未知"]);
    expect(reasoningItems[0]?.text()).toContain("本轮未产生可显示的模型推理记录");
    expect(reasoningItems[1]?.text()).toContain("模型推理记录状态未知");
  });

  it("renders phase-driven commentary, plan, reasoning, unclassified and final policies", () => {
    const turn = projectedTurn({
      status: "in_progress",
      plan: {
        explanation: "固定过程区",
        steps: [{ ordinal: 0, text: "检查状态", status: "in_progress" }],
      },
      items: [{
        ...message("commentary", 0, "assistant_message", "**过程说明**", "streaming"),
        agentMessagePhase: "commentary",
      }, {
        ...message("unclassified", 1, "assistant_message", "最终回答：不能据此推断"),
        agentMessagePhase: "unknown",
      }, {
        ...message("reasoning", 2, "reasoning", "**原始推理保持字面量**"),
        reasoning: { status: "incomplete", reasonCode: "stream_gap" },
        contentBlocks: [{
          blockIndex: 0,
          type: "code",
          language: "md",
          text: "**原始推理保持字面量**",
        }],
      }, {
        ...message("final", 3, "assistant_message", "**最终正文**"),
        agentMessagePhase: "final_answer",
      }],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1 },
      slots: {
        "item-actions": ({ item }: { item: ConversationTimelineItemViewModel }) =>
          h("button", { class: `action-${item.itemId}`, type: "button" }, "复制"),
        "code-actions": ({ item }: { item: ConversationTimelineItemViewModel }) =>
          h("button", { class: `code-action-${item.itemId}`, type: "button" }, "复制代码"),
      },
    });

    const plan = wrapper.get(".chat-turn-plan");
    const items = wrapper.get(".chat-turn-group__items");
    expect(items.element.contains(plan.element)).toBe(true);
    expect(plan.get("button").attributes("aria-expanded")).toBe("true");

    const commentary = wrapper.get(".chat-turn-group__item--commentary");
    expect(commentary.text()).toContain("处理过程");
    expect(commentary.get("button").attributes("aria-expanded")).toBe("true");
    expect(commentary.get(".chat-safe-content strong").text()).toBe("过程说明");

    const unclassified = wrapper.get(".chat-turn-group__item--assistant_unclassified");
    expect(unclassified.text()).toContain("模型回答");
    expect(unclassified.text()).not.toContain("未分类模型消息");
    expect(unclassified.text()).not.toContain("未将其视为最终回答");
    expect(unclassified.getComponent(ChatTimelineItemShell).props("icon")).toBe("assistant");
    expect(turn.items[1]?.assistantPhase).toBe("unknown");

    const reasoning = wrapper.get(".chat-turn-group__item--reasoning");
    expect(reasoning.text()).toContain("模型推理记录");
    expect(reasoning.text()).toContain("未完整结束");
    expect(reasoning.text()).toContain("流缺口");
    expect(reasoning.find(".chat-safe-content strong").exists()).toBe(false);
    expect(reasoning.find(".chat-safe-content__code-region").exists()).toBe(false);
    expect(reasoning.text()).toContain("**原始推理保持字面量**");
    expect(wrapper.find(".action-reasoning").exists()).toBe(false);
    expect(wrapper.find(".code-action-reasoning").exists()).toBe(false);

    const final = wrapper.get(".chat-turn-group__item--final_answer");
    expect(final.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(final.get(".chat-safe-content strong").text()).toBe("最终正文");
    expect(wrapper.find(".action-final").exists()).toBe(true);
  });

  it.each([undefined, null, "unknown"] as const)("renders phase %s as a normal answer without completing the turn", async (agentMessagePhase) => {
    const untagged: ConversationItemSnapshot = {
      threadId: THREAD_ID, turnId: TURN_ID, itemId: "untagged", ordinal: 0,
      kind: "assistant_message", status: "completed",
      contentBlocks: [{ blockIndex: 0, type: "text", text: "## 标题\n\n**普通回答**" }],
      ...(agentMessagePhase === undefined ? {} : { agentMessagePhase }),
    };
    const turn = projectedTurn({ status: "in_progress", items: [untagged] });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1 },
      slots: { "item-actions": () => h("button", { type: "button" }, "复制") },
    });
    const row = wrapper.get(".chat-turn-group__item--assistant_unclassified");
    expect(row.getComponent(ChatTimelineItemShell).props()).toMatchObject({ label: "模型回答", icon: "assistant", statusLabel: "已完成" });
    expect(row.text()).not.toMatch(/未分类|未标注阶段|未将其视为最终回答/);
    expect(row.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(row.get(".chat-safe-content h2").text()).toBe("标题");
    expect(row.get(".chat-safe-content strong").text()).toBe("普通回答");
    expect(row.get(".chat-timeline-item-shell__answer-actions").text()).toBe("复制");
    expect(turn.items[0]).toMatchObject({
      assistantPhase: agentMessagePhase === undefined ? "unknown" : agentMessagePhase,
      presentation: "assistant_unclassified",
      copyPolicy: "text_and_code",
    });
    expect(turn.domainStatus).toBe("in_progress");
    expect(wrapper.classes()).toContain("chat-turn-group--active");

    const completed = projectedTurn({ status: "completed", items: [untagged] });
    await wrapper.setProps({ turn: completed });
    expect(wrapper.classes()).toContain("chat-turn-group--complete");
    expect(completed.items[0]?.assistantPhase).toBe(turn.items[0]?.assistantPhase);
    expect(wrapper.text()).not.toMatch(/未分类|未标注阶段|未将其视为最终回答/);
    await wrapper.setProps({ turn: {
      ...completed,
      items: completed.items.map(item => ({ ...item, availability: "partial" as const })),
    } });
    expect(wrapper.text()).toContain("此项信息不完整");
    wrapper.unmount();
  });

  it("keeps archived activity idle and renders terminal notes and notices", () => {
    const activeCases: readonly [ConversationTurnStatus, string][] = [
      ["queued", "本轮正在等待处理"],
      ["in_progress", "本轮正在处理中"],
      ["waiting_approval", "本轮正在等待继续"],
    ];
    for (const [status] of activeCases) {
      const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
        props: { turn: projectedTurn({ status }), position: 2 },
      });
      expect(wrapper.find("[role='status']").exists()).toBe(false);
      expect(wrapper.find("[role='progressbar']").exists()).toBe(false);
      expect(wrapper.find(".chat-turn-group__items").exists()).toBe(false);
    }

    const terminalCases: readonly [ConversationTurnStatus, string | null][] = [
      ["completed", null],
      ["interrupted", "本轮已中断"],
      ["failed", "本轮未能完成"],
      ["recovery_required", "本轮状态需要核对"],
    ];
    for (const [status, label] of terminalCases) {
      const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
        props: { turn: projectedTurn({ status }), position: 3 },
      });
      if (label === null) expect(wrapper.find(".chat-turn-group__turn-state").exists()).toBe(false);
      else expect(wrapper.get(".chat-turn-group__turn-state").text()).toContain(label);
    }

    const noticed = mount(ChatTurnGroup, { attachTo: document.body,
      props: {
        turn: projectedTurn({ notices: [
          { severity: "error", code: "conversation_error" },
          { severity: "error", code: "conversation_error" },
          { severity: "warning", code: "conversation_warning" },
        ] }),
        position: 4,
      },
    });
    expect(noticed.findAll(".chat-turn-group__notice")).toHaveLength(2);
    expect(noticed.text()).toContain("共 2 次");
    expect(noticed.text()).toContain("conversation_error");
    expect(noticed.text()).toContain("conversation_warning");
  });

  it("forwards reference and action authority without resolving it locally", () => {
    const turn = projectedTurn({
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "artifact-item",
        ordinal: 0,
        kind: "artifact",
        status: "completed",
        contentBlocks: [{
          blockIndex: 0,
          type: "artifact_reference",
          artifactId: "artifact-demo",
          label: "演示生成内容",
        }, {
          blockIndex: 1,
          type: "attachment_reference",
          attachmentId: "attachment-demo",
          kind: "file",
          name: "说明.txt",
          mediaType: "text/plain",
          sizeBytes: 32,
          status: "ready",
          expiresAt: 2_000_000_000,
        }],
      }],
    });
    const projectedItem = turn.items[0]!;
    const artifactBlock = projectedItem.contentBlocks[0] as ConversationTimelineArtifactReferenceContentBlock;
    const attachmentBlock = projectedItem.contentBlocks[1] as ConversationTimelineAttachmentReferenceContentBlock;
    const artifactSlot = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      block: ConversationTimelineArtifactReferenceContentBlock;
    }) => h("span", { class: "artifact-authority" }, scope.block.artifactId));
    const attachmentSlot = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      block: ConversationTimelineAttachmentReferenceContentBlock;
    }) => h("span", { class: "attachment-authority" }, scope.block.name));
    const actionSlot = vi.fn((scope: { item: ConversationTimelineItemViewModel }) =>
      h("button", { type: "button", class: "item-authority-action" }, scope.item.itemId));
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1 },
      slots: {
        "artifact-reference": artifactSlot,
        "attachment-reference": attachmentSlot,
        "item-actions": actionSlot,
      },
    });

    expect(wrapper.findAll(".artifact-authority")).toHaveLength(1);
    expect(wrapper.findAll(".attachment-authority")).toHaveLength(1);
    expect(wrapper.findAll(".item-authority-action")).toHaveLength(1);
    expect(artifactSlot.mock.calls.every(([scope]) =>
      scope.item === projectedItem && scope.block === artifactBlock)).toBe(true);
    expect(attachmentSlot.mock.calls.every(([scope]) =>
      scope.item === projectedItem && scope.block === attachmentBlock)).toBe(true);
    expect(actionSlot.mock.calls.every(([scope]) => scope.item === projectedItem)).toBe(true);
    expect(wrapper.get("[role='group']").attributes("aria-label")).toBe("生成内容操作");
  });

  it("forwards code actions with the same frozen Item and exact code payload", () => {
    const turn = projectedTurn({
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: "assistant-code",
        ordinal: 0,
        kind: "assistant_message",
        status: "completed",
        agentMessagePhase: "final_answer",
        contentBlocks: [{
          blockIndex: 0,
          type: "code",
          language: "ts",
          text: "const answer = 42;",
        }],
      }],
    });
    const item = turn.items[0]!;
    const codeAction = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      codeIdentity: string;
      text: string;
      language: string | null;
    }) => h("button", { type: "button", class: "code-action" }, scope.language ?? "复制代码"));
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1 },
      slots: { "code-actions": codeAction },
    });

    expect(wrapper.findAll(".code-action")).toHaveLength(1);
    expect(codeAction).toHaveBeenCalledOnce();
    expect(codeAction.mock.calls[0]?.[0]).toMatchObject({
      item,
      text: "const answer = 42;",
      language: "ts",
    });
    expect(codeAction.mock.calls[0]?.[0].item).toBe(item);
    expect(codeAction.mock.calls[0]?.[0].codeIdentity).toBe(item.contentBlocks[0]?.identity);
  });

  it("keeps the Turn disclosure choice and process DOM across streamed updates and reordered Items", async () => {
    const turn = projectedTurn({items: [message("reasoning-a", 0, "reasoning", "甲"), message("reasoning-b", 1, "reasoning", "乙")]});
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,props: {turn, position: 1, timingLabel: "用时 51秒"}});
    const toggle = wrapper.get(".chat-turn-group__process-toggle");
    const before = wrapper.findAll("[data-process-item]").map(item => item.element);
    await toggle.trigger("click");
    await wrapper.setProps({turn: {...turn, items: [...turn.items].reverse()}, timingLabel: "用时 52秒"});
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll("[data-process-item]").map(item => item.element)).toEqual([...before].reverse());
    await toggle.trigger("click");
    await wrapper.setProps({turn: {...turn, items: [...turn.items]}, timingLabel: "用时 53秒"});
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll("[data-process-item]").every(item => !item.isVisible())).toBe(true);
    wrapper.unmount();
  });

  it("is accessible and stays inside the Timeline presentation boundary", async () => {
    const turn = projectedTurn({
      notices: [{ severity: "warning", code: "conversation_warning" }],
      items: [
        message("user", 0, "user_message", "问题"),
        message("reasoning", 1, "reasoning", "过程"),
        message("assistant", 2, "assistant_message", "回答"),
        message("unknown", 3, "unknown", "未来内容"),
      ],
    });
    const wrapper = mount(ChatTurnGroup, { attachTo: document.body,
      props: { turn, position: 1 },
      slots: {
        "item-actions": () => h("button", { type: "button" }, "复制"),
      },
    });
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const source = readFileSync("src/components/chat/ChatTurnGroup.vue", "utf8");
    expect(source).not.toMatch(/useChatStore|useArtifactStore|ChatArtifactList|\/api\/|@tauri-apps|v-html|fetch\(|invoke\(|clipboard|storage|router|console\./i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("ChatSafeContent");
    expect(source).toContain("ChatTimelineItemShell");
  });
});


it("places native turn duration after user input and before model output", () => {
  const turn = projectedTurn({ items: [message("user", 0, "user_message", "用户输入"), message("assistant", 1, "assistant_message", "模型输出")] });
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1, timingLabel: "用时 51秒" } });
  const children = wrapper.get(".chat-turn-group__items").element.children;
  expect(children[0]!.textContent).toContain("用户输入");
  expect(children[1]!.textContent).toBe("用时 51秒");
  expect(children[2]!.textContent).toContain("模型输出");
  expect(children[1]!.getAttribute("aria-live")).toBeNull();
  wrapper.unmount();
});

it("shows turn duration while waiting for the first model item", () => {
  const turn = projectedTurn({ status: "in_progress", items: [message("user", 0, "user_message", "用户输入")] });
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: { turn, position: 1, timingLabel: "已处理 7秒" } });
  expect(wrapper.get(".chat-turn-group__items").element.lastElementChild!.textContent).toBe("已处理 7秒");
  wrapper.unmount();
});

it("uses elapsed time to reveal the entire process while leaving answers and later user input visible", async () => {
  const doneCommand = command();
  if (doneCommand.execution?.kind !== "command") throw Error("command fixture missing");
  const turn = projectedTurn({items: [
    message("user", 0, "user_message", "检查工作区"),
    {...message("process", 1, "assistant_message", "**先检查当前状态**"), agentMessagePhase: "commentary"},
    {...doneCommand, ordinal: 2, status: "completed", execution: {...doneCommand.execution, status: "completed"}},
    message("follow-up", 3, "user_message", "保留当前设置"),
    {...message("unclassified", 4, "assistant_message", "兼容模型的回答"), agentMessagePhase: "unknown"},
    message("final", 5, "assistant_message", "**最终结果**"),
  ]});
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: {turn, position: 1, timingLabel: "用时 1分44秒"}});
  const toggle = wrapper.get(".chat-turn-group__process-toggle");
  expect(toggle.element.tagName).toBe("BUTTON");
  expect(toggle.text()).toBe("用时 1分44秒");
  expect(toggle.attributes("aria-expanded")).toBe("false");
  const controlled = toggle.attributes("aria-controls")!.split(" ");
  expect(controlled).toHaveLength(2);
  expect(controlled.every(id => document.getElementById(id)?.style.display === "none")).toBe(true);
  expect(wrapper.findAll(".chat-turn-group__item--user_message").every(item => item.isVisible())).toBe(true);
  expect(wrapper.get(".chat-turn-group__item--assistant_unclassified").isVisible()).toBe(true);
  expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
  await toggle.trigger("click");
  expect(wrapper.findAll("[data-process-item]").every(item => item.isVisible())).toBe(true);
  expect(wrapper.get(".chat-turn-group__item--commentary .chat-safe-content strong").text()).toBe("先检查当前状态");
  expect(wrapper.get(".chat-turn-group__item--command").text()).toContain("运行了命令");
  expect(wrapper.get(".chat-turn-group__item--commentary article").classes()).toContain("chat-timeline-item-shell--process-inline");
  await toggle.trigger("click");
  expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
});

it("follows live Turn state until the user chooses expansion, without resetting on duration or streamed updates", async () => {
  const base = projectedTurn({status: "in_progress", items: [
    {...message("progress", 0, "assistant_message", "开始检查", "streaming"), agentMessagePhase: "commentary"},
  ]});
  const active = {...base, source: "native_observed" as const, liveObserved: true, items: base.items.map(item => ({...item, busy: true, activityLabel: undefined}))};
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: {turn: active, position: 1, timingLabel: "已处理 7秒"}});
  const toggle = wrapper.get(".chat-turn-group__process-toggle");
  expect(toggle.attributes("aria-expanded")).toBe("true");
  await toggle.trigger("click");
  await wrapper.setProps({timingLabel: "已处理 8秒", turn: {...active, items: [...active.items, {...active.items[0]!, identity: "new-process", itemId: "new"}]}});
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(wrapper.findAll("[data-process-item]").every(item => !item.isVisible())).toBe(true);
  const ended = {...active, domainStatus: "completed" as const, terminalStatus: "completed" as const, phase: "complete" as const};
  await toggle.trigger("click");
  await wrapper.setProps({turn: ended, timingLabel: "用时 51秒"});
  expect(toggle.attributes("aria-expanded")).toBe("true");
  await wrapper.setProps({turn: {...ended, identity: "another-turn"}});
  expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
  const automatic = mount(ChatTurnGroup, { attachTo: document.body, props: {turn: active, position: 2}});
  await automatic.setProps({turn: ended});
  expect(automatic.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
});

it("keeps pending approvals and failed or incomplete process records outside the folded content", async () => {
  const approved = turnWithApproval();
  const normal = projectedTurn({items: [{...message("commentary", 1, "assistant_message", "普通过程"), agentMessagePhase: "commentary"}]}).items[0]!;
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: {
    turn: {...approved, items: [...approved.items.map(item => ({...item, approval: null, activityLabel: undefined})), normal]}, position: 1, timingLabel: "已处理 7秒",
  }});
  expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
  expect(wrapper.get(".chat-turn-group__item--command").isVisible()).toBe(false);
  await wrapper.setProps({turn: {...approved, items: [...approved.items, normal]}});
  expect(wrapper.get(".chat-approval-card").isVisible()).toBe(true);
  expect(wrapper.get(".chat-turn-group__item--commentary").isVisible()).toBe(false);
  const commandItem = approved.items[0]!;
  if (!commandItem.execution) throw Error("missing execution");
  await wrapper.setProps({turn: {...approved, items: [{...commandItem, approval: null, domainStatus: "completed", activityLabel: undefined, execution: {...commandItem.execution, status: "failed"}}, normal]}});
  expect(wrapper.get(".chat-turn-group__item--command").isVisible()).toBe(true);
  expect(wrapper.get(".chat-turn-group__item--command").text()).toContain("执行失败");
  await wrapper.setProps({turn: {...approved, items: [{...normal, availability: "partial"}]}});
  expect(wrapper.get(".chat-turn-group__item--commentary").isVisible()).toBe(true);
  expect(wrapper.text()).toContain("此项信息不完整");
  expect(wrapper.find(".chat-turn-group__process-toggle").exists()).toBe(false);
});

it("keeps an empty process control out of answer-only Turns and supports plans without duration", async () => {
  const answerOnly = projectedTurn({items: [message("answer", 0, "assistant_message", "普通答案")]});
  const wrapper = mount(ChatTurnGroup, { attachTo: document.body, props: {turn: answerOnly, position: 1, timingLabel: "用时 0秒"}});
  expect(wrapper.find(".chat-turn-group__process-toggle").exists()).toBe(false);
  expect(wrapper.get(".chat-turn-group__timing").text()).toBe("用时 0秒");
  const planOnly = projectedTurn({plan: {explanation: "计划说明", steps: [{ordinal: 0, text: "检查状态", status: "completed"}]}});
  await wrapper.setProps({turn: planOnly, timingLabel: null});
  expect(wrapper.get(".chat-turn-group__process-toggle").text()).toBe("处理过程");
  expect(wrapper.get(".chat-turn-plan").isVisible()).toBe(false);
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  expect(wrapper.get(".chat-turn-plan").isVisible()).toBe(true);
});
