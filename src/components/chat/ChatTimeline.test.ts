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
  type ConversationThreadStatus,
  type ConversationTurnSnapshot,
} from "../../domain/conversation-state";
import {
  selectConversationTimeline,
  type ConversationTimelineArtifactReferenceContentBlock,
  type ConversationTimelineAttachmentReferenceContentBlock,
  type ConversationTimelineItemViewModel,
  type ConversationTimelineViewModel,
} from "../../domain/conversation-timeline";
import ChatTimeline from "./ChatTimeline.vue";
import ChatTimelineItemShell from "./ChatTimelineItemShell.vue";

const THREAD_ID = "thread-demo";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function projectedTimeline(options: {
  threadStatus?: ConversationThreadStatus;
  threadNotices?: readonly ConversationNotice[];
  turns?: readonly ConversationTurnSnapshot[];
  items?: readonly ConversationItemSnapshot[];
} = {}): ConversationTimelineViewModel {
  const timeline = selectConversationTimeline(hydrateConversationState({
    threads: [{
      threadId: THREAD_ID,
      status: options.threadStatus ?? "ready",
      notices: options.threadNotices,
    }],
    turns: options.turns ?? [],
    items: options.items ?? [],
  }), THREAD_ID);
  if (timeline === null) throw new Error("fixture_missing_timeline");
  return timeline;
}

function completedTurn(turnId: string, ordinal: number): ConversationTurnSnapshot {
  return {
    threadId: THREAD_ID,
    turnId,
    ordinal,
    status: "completed",
    terminalStatus: "completed",
  };
}

function message(
  turnId: string,
  itemId: string,
  ordinal: number,
  kind: ConversationItemSnapshot["kind"],
  text: string,
): ConversationItemSnapshot {
  return {
    threadId: THREAD_ID,
    turnId,
    itemId,
    ordinal,
    kind,
    status: "completed",
    agentMessagePhase: kind === "assistant_message" ? "final_answer" : undefined,
    reasoning: kind === "reasoning"
      ? { status: "complete", reasonCode: null }
      : undefined,
    contentBlocks: [{ blockIndex: 0, type: "text", text }],
  };
}

describe("ChatTimeline", () => {
  it("renders the selector-provided Turn and Item order without a second sort", () => {
    const timeline = projectedTimeline({
      turns: [completedTurn("turn-second", 1), completedTurn("turn-first", 0)],
      items: [
        message("turn-second", "answer-second", 1, "assistant_message", "第二轮回答"),
        message("turn-first", "answer-first", 1, "assistant_message", "第一轮回答"),
        message("turn-first", "question-first", 0, "user_message", "第一轮问题"),
      ],
    });
    const wrapper = mount(ChatTimeline, { props: { timeline } });
    const turns = wrapper.findAll(".chat-timeline__turn");

    expect(turns).toHaveLength(2);
    expect(turns[0]?.text()).toContain("第 1 轮");
    expect(turns[0]?.text()).toContain("第一轮问题");
    expect(turns[0]?.text()).toContain("第一轮回答");
    expect(turns[1]?.text()).toContain("第 2 轮");
    expect(turns[1]?.text()).toContain("第二轮回答");
    expect(wrapper.get("section.chat-timeline").attributes("aria-label")).toBe("对话内容");
    expect(wrapper.get("section.chat-timeline").attributes("aria-busy")).toBe("false");
  });

  it("integrates projected Command and Tool Items and relays their disclosures", async () => {
    const source = (sequence: string) => ({
      sourceEventId: `execution-event-${sequence}`,
      sourceSequence: sequence,
      sourceOccurredAt: "2026-08-29T09:00:00.000Z",
    });
    const safeText = (text: string) => ({
      text,
      truncated: false,
      truncationReason: null,
    } as const);
    const timeline = projectedTimeline({
      turns: [completedTurn("turn-main", 0)],
      items: [{
        threadId: THREAD_ID,
        turnId: "turn-main",
        itemId: "command-main",
        ordinal: 0,
        kind: "command",
        status: "completed",
        execution: {
          kind: "command",
          status: "completed",
          startedSource: source("1"),
          lastSource: source("2"),
          commandSummary: safeText("检查仓库状态"),
          cwd: { kind: "workspace_root", segments: [] },
          liveOutput: null,
          output: {
            retention: "complete",
            text: "工作区干净",
            head: null,
            tail: null,
            reason: null,
            truncated: false,
            truncationReason: null,
          },
          durationMs: 120,
          exitCode: 0,
          error: null,
        },
        contentBlocks: [],
      }, {
        threadId: THREAD_ID,
        turnId: "turn-main",
        itemId: "tool-main",
        ordinal: 1,
        kind: "tool",
        status: "completed",
        execution: {
          kind: "tool",
          status: "completed",
          startedSource: source("3"),
          lastSource: source("4"),
          identity: { resolution: "unknown", serverName: "unknown", toolName: "unknown" },
          argumentsSummary: safeText("只读参数摘要"),
          progress: [],
          durationMs: 240,
          resultSummary: safeText("只读结果摘要"),
          error: null,
        },
        contentBlocks: [],
      }],
    });
    const commandItem = timeline.turns[0]!.items[0]!;
    const toolItem = timeline.turns[0]!.items[1]!;
    const wrapper = mount(ChatTimeline, { props: { timeline } });
    const items = wrapper.findAll(".chat-turn-group__item");

    expect(items.map((entry) => entry.classes().find((name) =>
      name.startsWith("chat-turn-group__item--"))))
      .toEqual(["chat-turn-group__item--command", "chat-turn-group__item--tool"]);
    expect(wrapper.findAll(".chat-command-item__details")).toHaveLength(0);
    expect(wrapper.findAll(".chat-tool-item__details")).toHaveLength(0);

    await items[0]!.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(items[0]!.text()).toContain("检查仓库状态");
    expect(items[0]!.text()).toContain("工作区干净");
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({
      itemIdentity: commandItem.identity,
      expanded: true,
    });

    await items[1]!.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(items[1]!.text()).toContain("未知工具");
    expect(items[1]!.text()).toContain("只读结果摘要");
    expect(items[1]!.text()).not.toContain("unsupported_execution");
    expect(wrapper.emitted("disclosure-change")?.[1]?.[0]).toEqual({
      itemIdentity: toolItem.identity,
      expanded: true,
    });
  });

  it("renders closed empty, loading, recovery, unavailable, and archived states", () => {
    const readyEmpty = mount(ChatTimeline, {
      props: { timeline: projectedTimeline() },
    });
    expect(readyEmpty.text()).toContain("尚无对话内容");
    expect(readyEmpty.find(".chat-timeline__turns").exists()).toBe(false);

    const loading = mount(ChatTimeline, {
      props: { timeline: projectedTimeline({ threadStatus: "not_loaded" }) },
    });
    expect(loading.get("section.chat-timeline").attributes("aria-busy")).toBe("true");
    expect(loading.get("[role='status']").text()).toBe("正在加载对话…");
    expect(loading.find(".chat-timeline__skeleton").exists()).toBe(true);
    expect(loading.find("button").exists()).toBe(false);

    const historicalItems = [message("turn-main", "answer", 0, "assistant_message", "保留的回答")];
    const historicalTurns = [completedTurn("turn-main", 0)];
    const synchronized = projectedTimeline({ turns: historicalTurns, items: historicalItems });
    const recovery = mount(ChatTimeline, {
      props: {
        timeline: deepFreeze({
          ...synchronized,
          syncStatus: "recovery_required" as const,
          isReadyEmpty: false,
        }),
      },
    });
    expect(recovery.text()).toContain("对话状态需要核对，现有内容仍可阅读。");
    expect(recovery.text()).toContain("保留的回答");

    const unavailable = mount(ChatTimeline, {
      props: {
        timeline: projectedTimeline({
          threadStatus: "unavailable",
          turns: historicalTurns,
          items: historicalItems,
        }),
      },
    });
    expect(unavailable.text()).toContain("对话当前不可用，已确认的内容仍可阅读。");
    expect(unavailable.text()).toContain("保留的回答");

    const archived = mount(ChatTimeline, {
      props: {
        timeline: projectedTimeline({
          threadStatus: "archived",
          turns: historicalTurns,
          items: historicalItems,
        }),
      },
    });
    expect(archived.text()).toContain("此对话已归档，内容仅供阅读。");
    expect(archived.text()).toContain("保留的回答");
  });

  it("relays reference and action authority plus stable disclosure events", async () => {
    const timeline = projectedTimeline({
      turns: [completedTurn("turn-main", 0)],
      items: [{
        threadId: THREAD_ID,
        turnId: "turn-main",
        itemId: "artifact-item",
        ordinal: 0,
        kind: "artifact",
        status: "completed",
        contentBlocks: [{
          blockIndex: 0,
          type: "artifact_reference",
          artifactId: "artifact-demo",
          label: "演示内容",
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
      }, message("turn-main", "reasoning", 1, "reasoning", "过程".repeat(161))],
    });
    const artifactItem = timeline.turns[0]!.items[0]!;
    const reasoningItem = timeline.turns[0]!.items[1]!;
    const artifactBlock = artifactItem.contentBlocks[0] as ConversationTimelineArtifactReferenceContentBlock;
    const attachmentBlock = artifactItem.contentBlocks[1] as ConversationTimelineAttachmentReferenceContentBlock;
    const artifactSlot = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      block: ConversationTimelineArtifactReferenceContentBlock;
    }) => h("span", { class: "timeline-artifact-authority" }, scope.block.artifactId));
    const attachmentSlot = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      block: ConversationTimelineAttachmentReferenceContentBlock;
    }) => h("span", { class: "timeline-attachment-authority" }, scope.block.name));
    const wrapper = mount(ChatTimeline, {
      props: { timeline },
      slots: {
        "artifact-reference": artifactSlot,
        "attachment-reference": attachmentSlot,
        "item-actions": ({ item: projectedItem }: { item: ConversationTimelineItemViewModel }) =>
          h("button", { type: "button", class: `action-${projectedItem.itemId}` }, "操作"),
      },
    });

    expect(wrapper.findAll(".timeline-artifact-authority")).toHaveLength(1);
    expect(wrapper.findAll(".timeline-attachment-authority")).toHaveLength(1);
    expect(artifactSlot.mock.calls.every(([scope]) =>
      scope.item === artifactItem && scope.block === artifactBlock)).toBe(true);
    expect(attachmentSlot.mock.calls.every(([scope]) =>
      scope.item === artifactItem && scope.block === attachmentBlock)).toBe(true);
    expect(wrapper.findAll(".action-artifact-item")).toHaveLength(1);
    expect(wrapper.findAll(".action-reasoning")).toHaveLength(0);

    const reasoningShell = wrapper.findAllComponents(ChatTimelineItemShell)
      .find((shell) => shell.props("item").itemId === "reasoning");
    if (reasoningShell === undefined) throw new Error("fixture_missing_reasoning");
    await reasoningShell.get(".chat-timeline-item-shell__disclosure").trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({
      itemIdentity: reasoningItem.identity,
      expanded: true,
    });
  });

  it("relays typed code actions without taking clipboard authority", () => {
    const timeline = projectedTimeline({
      turns: [completedTurn("turn-main", 0)],
      items: [{
        threadId: THREAD_ID,
        turnId: "turn-main",
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
    const item = timeline.turns[0]!.items[0]!;
    const codeAction = vi.fn((scope: {
      item: ConversationTimelineItemViewModel;
      codeIdentity: string;
      text: string;
      language: string | null;
    }) => h("button", { type: "button", class: "timeline-code-action" }, scope.language ?? "复制代码"));
    const wrapper = mount(ChatTimeline, {
      props: { timeline },
      slots: { "code-actions": codeAction },
    });

    expect(wrapper.findAll(".timeline-code-action")).toHaveLength(1);
    expect(codeAction).toHaveBeenCalledOnce();
    expect(codeAction.mock.calls[0]?.[0]).toMatchObject({
      item,
      text: "const answer = 42;",
      language: "ts",
    });
    expect(codeAction.mock.calls[0]?.[0].item).toBe(item);
    expect(codeAction.mock.calls[0]?.[0].codeIdentity).toBe(item.contentBlocks[0]?.identity);
  });

  it("keeps disclosure state with stable Turn identity and consumes projected array order", async () => {
    const timeline = projectedTimeline({
      turns: [completedTurn("turn-a", 0), completedTurn("turn-b", 1)],
      items: [
        message("turn-a", "reasoning-a", 0, "reasoning", "A".repeat(321)),
        message("turn-b", "reasoning-b", 0, "reasoning", "B".repeat(321)),
      ],
    });
    const wrapper = mount(ChatTimeline, {
      props: { timeline },
      slots: {
        "item-actions": ({ item: projectedItem }: { item: ConversationTimelineItemViewModel }) =>
          h("span", { class: `turn-identity-${projectedItem.itemId}` }, projectedItem.itemId),
      },
    });

    function disclosureFor(itemId: string): HTMLButtonElement {
      const shell = wrapper.findAllComponents(ChatTimelineItemShell)
        .find((candidate) => candidate.props("item").itemId === itemId);
      const disclosure = shell?.element.querySelector(
        ".chat-timeline-item-shell__disclosure",
      ) as HTMLButtonElement | null | undefined;
      if (disclosure === null || disclosure === undefined) {
        throw new Error("fixture_missing_disclosure");
      }
      return disclosure;
    }

    disclosureFor("reasoning-a").click();
    await wrapper.vm.$nextTick();
    expect(disclosureFor("reasoning-a").getAttribute("aria-expanded")).toBe("true");
    expect(disclosureFor("reasoning-b").getAttribute("aria-expanded")).toBe("false");

    await wrapper.setProps({
      timeline: deepFreeze({
        ...timeline,
        turns: [timeline.turns[1]!, timeline.turns[0]!],
      }),
    });
    const reorderedTurns = wrapper.findAll(".chat-timeline__turn");
    expect(reorderedTurns).toHaveLength(2);
    expect(wrapper.findAllComponents(ChatTimelineItemShell)
      .map((shell) => shell.props("item").itemId)).toEqual(["reasoning-b", "reasoning-a"]);
    expect(disclosureFor("reasoning-a").getAttribute("aria-expanded")).toBe("true");
    expect(disclosureFor("reasoning-b").getAttribute("aria-expanded")).toBe("false");
  });

  it("is accessible and remains independent from ChatPage and state authorities", async () => {
    const timeline = projectedTimeline({
      threadNotices: [{ severity: "warning", code: "conversation_warning" }],
      turns: [{
        ...completedTurn("turn-main", 0),
        notices: [{ severity: "warning", code: "conversation_warning" }],
      }],
      items: [
        message("turn-main", "user", 0, "user_message", "问题"),
        message("turn-main", "assistant", 1, "assistant_message", "回答"),
      ],
    });
    const wrapper = mount(ChatTimeline, {
      attachTo: document.body,
      props: { timeline },
      slots: {
        "item-actions": () => h("button", { type: "button" }, "复制"),
      },
    });
    expect(wrapper.get(".chat-timeline__notices").text())
      .toContain("对话连接存在需要注意的信息");
    expect(wrapper.get(".chat-timeline__notices code").text()).toBe("conversation_warning");
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const source = readFileSync("src/components/chat/ChatTimeline.vue", "utf8");
    expect(source).not.toMatch(/ChatPage|conversation-state|store|adapter|wire|\/api\/|@tauri-apps|fetch\(|invoke\(|router|client/i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("ConversationTimelineViewModel");
    expect(source).toContain("ChatTurnGroup");
  });
});
