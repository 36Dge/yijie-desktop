// @vitest-environment happy-dom

import axe from "axe-core";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { h } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  hydrateConversationState,
  type ConversationItemSnapshot,
  type ConversationNotice,
  type ConversationPlanSnapshot,
  type ConversationTurnStatus,
} from "../../domain/conversation-state";
import {
  selectConversationTimeline,
  type ConversationTimelineArtifactReferenceContentBlock,
  type ConversationTimelineAttachmentReferenceContentBlock,
  type ConversationTimelineItemViewModel,
  type ConversationTimelineTurnViewModel,
} from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import ChatTimelineItemShell from "./ChatTimelineItemShell.vue";

const THREAD_ID = "thread-demo";
const TURN_ID = "turn-demo";

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
  const timeline = selectConversationTimeline(hydrateConversationState({
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

describe("ChatTurnGroup", () => {
  it("renders projected Items in order with closed role and unknown renderers", () => {
    const turn = projectedTurn({
      notices: [{ severity: "warning", code: "conversation_warning" }],
      items: [
        message("assistant", 2, "assistant_message", "回答内容"),
        message("unknown", 3, "tool", "普通的未来类型占位内容"),
        message("user", 0, "user_message", "用户内容"),
        message("reasoning", 1, "reasoning", "过程内容"),
      ],
    });
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });
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
    expect(itemElements[0]?.text()).toContain("用户消息");
    expect(itemElements[0]?.text()).toContain("用户内容");
    expect(itemElements[1]?.text()).toContain("过程记录");
    expect(itemElements[2]?.text()).toContain("模型回答");
    expect(itemElements[2]?.text()).toContain("回答内容");
    expect(itemElements[3]?.text()).toContain("此内容类型暂不支持");
    expect(itemElements[3]?.text()).toContain("unsupported_content");
    expect(itemElements[3]?.text()).not.toContain("普通的未来类型占位内容");

    const section = wrapper.get("section");
    expect(wrapper.get(`#${section.attributes("aria-labelledby")}`).text()).toBe("第 1 轮");
    expect(wrapper.get(".chat-turn-group__notices").element.parentElement).toBe(section.element);
    expect(wrapper.get(".chat-turn-group__notices").element)
      .not.toBe(wrapper.get(".chat-turn-group__items").element);
  });

  it("labels an unfinished item separately from an explicitly completed item", () => {
    const turn = projectedTurn({
      status: "interrupted",
      items: [message("partial-answer", 0, "assistant_message", "partial", "incomplete")],
    });
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });

    expect(wrapper.get(".chat-timeline-item-shell__status").text()).toBe("未完整结束");
    expect(wrapper.get(".chat-timeline-item-shell").classes())
      .toContain("chat-timeline-item-shell--incomplete");
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
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });
    const reasoningItems = wrapper.findAll(".chat-turn-group__item--reasoning");

    expect(reasoningItems).toHaveLength(2);
    expect(reasoningItems[0]?.get("button").attributes("aria-expanded")).toBe("false");
    expect(reasoningItems[0]?.find("strong").exists()).toBe(true);
    expect(reasoningItems[0]?.find(".chat-timeline-item-shell__body").exists()).toBe(false);
    expect(reasoningItems[1]?.get("button").attributes("aria-expanded")).toBe("false");
    expect(reasoningItems[1]?.find(".chat-timeline-item-shell__body").exists()).toBe(false);

    const assistantItem = wrapper.get(".chat-turn-group__item--final_answer");
    expect(assistantItem.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(assistantItem.get(".chat-timeline-item-shell__body").text()).toContain("最终回答");
    expect(assistantItem.get(".chat-safe-content strong").text()).toBe("最终回答可使用富文本");

    await reasoningItems[0]?.get("button").trigger("click");
    expect(reasoningItems[0]?.get("button").attributes("aria-expanded")).toBe("true");
    expect(reasoningItems[0]?.get(".chat-timeline-item-shell__body").text())
      .toContain("**短过程保持字面量**");
    expect(reasoningItems[0]?.find(".chat-safe-content strong").exists()).toBe(false);
    expect(reasoningItems[0]?.find(".chat-safe-content__inert-link").exists()).toBe(false);
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({
      itemIdentity: turn.items[0]?.identity,
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
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });

    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(wrapper.text()).toContain("模型推理记录已完成，但没有可显示的正文。");
    expect(wrapper.get(".chat-turn-group__reasoning-state").attributes("role")).toBe("note");
    expect(wrapper.find(".chat-safe-content").exists()).toBe(false);
  });

  it("keeps active empty reasoning expanded with an explicit waiting state", () => {
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
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });

    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("正在等待模型推理记录…");
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
    const wrapper = mount(ChatTurnGroup, { props: { turn, position: 1 } });
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
    const wrapper = mount(ChatTurnGroup, {
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
    expect(plan.element.compareDocumentPosition(items.element) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(plan.get("button").attributes("aria-expanded")).toBe("true");

    const commentary = wrapper.get(".chat-turn-group__item--commentary");
    expect(commentary.text()).toContain("处理过程");
    expect(commentary.get("button").attributes("aria-expanded")).toBe("true");
    expect(commentary.get(".chat-safe-content strong").text()).toBe("过程说明");

    const unclassified = wrapper.get(".chat-turn-group__item--assistant_unclassified");
    expect(unclassified.text()).toContain("未分类模型消息");
    expect(unclassified.text()).toContain("未将其视为最终回答");
    expect(unclassified.text()).not.toContain("模型回答");

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

  it("renders lifecycle progress, terminal notes, and aggregated notices outside the Item list", () => {
    const activeCases: readonly [ConversationTurnStatus, string][] = [
      ["queued", "本轮正在等待处理"],
      ["in_progress", "本轮正在处理中"],
      ["waiting_approval", "本轮正在等待继续"],
    ];
    for (const [status, label] of activeCases) {
      const wrapper = mount(ChatTurnGroup, {
        props: { turn: projectedTurn({ status }), position: 2 },
      });
      const progress = wrapper.get("[role='status']");
      expect(progress.text()).toContain(label);
      expect(progress.attributes("aria-live")).toBe("polite");
      expect(progress.attributes("aria-atomic")).toBe("true");
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
      const wrapper = mount(ChatTurnGroup, {
        props: { turn: projectedTurn({ status }), position: 3 },
      });
      if (label === null) expect(wrapper.find(".chat-turn-group__turn-state").exists()).toBe(false);
      else expect(wrapper.get(".chat-turn-group__turn-state").text()).toContain(label);
    }

    const noticed = mount(ChatTurnGroup, {
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
    const wrapper = mount(ChatTurnGroup, {
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
    const wrapper = mount(ChatTurnGroup, {
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

  it("keeps disclosure state attached to stable identity when the ViewModel order changes", async () => {
    const turn = projectedTurn({
      items: [
        message("reasoning-a", 0, "reasoning", "A".repeat(321)),
        message("reasoning-b", 1, "reasoning", "B".repeat(321)),
      ],
    });
    const wrapper = mount(ChatTurnGroup, {
      props: { turn, position: 1 },
      slots: {
        "item-actions": ({ item: projectedItem }: { item: ConversationTimelineItemViewModel }) =>
          h("span", { class: `identity-${projectedItem.itemId}` }, projectedItem.itemId),
      },
    });

    function disclosureFor(itemId: string): HTMLButtonElement {
      const shell = wrapper.findAllComponents(ChatTimelineItemShell)
        .find((candidate) => candidate.props("item").itemId === itemId);
      const button = shell?.element.querySelector(
        ".chat-timeline-item-shell__disclosure",
      ) as HTMLButtonElement | null | undefined;
      if (button === null || button === undefined) throw new Error("fixture_missing_disclosure");
      return button;
    }

    disclosureFor("reasoning-a").click();
    await wrapper.vm.$nextTick();
    expect(disclosureFor("reasoning-a").getAttribute("aria-expanded")).toBe("true");
    expect(disclosureFor("reasoning-b").getAttribute("aria-expanded")).toBe("false");

    await wrapper.setProps({
      turn: deepFreeze({ ...turn, items: [...turn.items].reverse() }),
    });
    expect(disclosureFor("reasoning-a").getAttribute("aria-expanded")).toBe("true");
    expect(disclosureFor("reasoning-b").getAttribute("aria-expanded")).toBe("false");
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
    const wrapper = mount(ChatTurnGroup, {
      attachTo: document.body,
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
