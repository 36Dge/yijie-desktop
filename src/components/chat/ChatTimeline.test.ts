// @vitest-environment happy-dom

import axe from "axe-core";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { h } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  hydrateConversationState,
  type ConversationItemSnapshot,
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

const THREAD_ID = "thread-demo";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function projectedTimeline(options: {
  threadStatus?: ConversationThreadStatus;
  turns?: readonly ConversationTurnSnapshot[];
  items?: readonly ConversationItemSnapshot[];
} = {}): ConversationTimelineViewModel {
  const timeline = selectConversationTimeline(hydrateConversationState({
    threads: [{ threadId: THREAD_ID, status: options.threadStatus ?? "ready" }],
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
    expect(wrapper.findAll(".action-reasoning")).toHaveLength(1);

    const reasoningArticle = wrapper.get(".action-reasoning").element.closest("article");
    const disclosure = reasoningArticle?.querySelector<HTMLButtonElement>(
      ".chat-timeline-item-shell__disclosure",
    );
    if (disclosure === null || disclosure === undefined) throw new Error("fixture_missing_disclosure");
    disclosure.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({
      itemIdentity: reasoningItem.identity,
      expanded: true,
    });
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
      const marker = wrapper.get(`.turn-identity-${itemId}`).element;
      const disclosure = marker.closest("article")?.querySelector<HTMLButtonElement>(
        ".chat-timeline-item-shell__disclosure",
      );
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
    expect(reorderedTurns[0]?.text()).toContain("reasoning-b");
    expect(reorderedTurns[1]?.text()).toContain("reasoning-a");
    expect(disclosureFor("reasoning-a").getAttribute("aria-expanded")).toBe("true");
    expect(disclosureFor("reasoning-b").getAttribute("aria-expanded")).toBe("false");
  });

  it("is accessible and remains independent from ChatPage and state authorities", async () => {
    const timeline = projectedTimeline({
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
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const source = readFileSync("src/components/chat/ChatTimeline.vue", "utf8");
    expect(source).not.toMatch(/ChatPage|conversation-state|store|adapter|wire|\/api\/|@tauri-apps|fetch\(|invoke\(|router|client/i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("ConversationTimelineViewModel");
    expect(source).toContain("ChatTurnGroup");
  });
});
