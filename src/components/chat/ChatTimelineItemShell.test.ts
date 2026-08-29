// @vitest-environment happy-dom

import axe from "axe-core";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { h } from "vue";
import { describe, expect, it } from "vitest";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatTimelineItemShell from "./ChatTimelineItemShell.vue";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function item(
  overrides: Partial<ConversationTimelineItemViewModel> = {},
): ConversationTimelineItemViewModel {
  return deepFreeze({
    identity: "timeline-item-demo",
    threadId: "thread-demo",
    turnId: "turn-demo",
    itemId: "item-demo",
    ordinal: 0,
    kind: "assistant_message",
    presentation: "final_answer",
    role: "assistant",
    domainStatus: "completed",
    phase: "complete",
    assistantPhase: "final_answer",
    reasoning: null,
    contentMode: "rich",
    collapsible: false,
    defaultExpanded: true,
    copyPolicy: "text_and_code",
    reconciliation: "matched",
    contentBlocks: [],
    ...overrides,
  });
}

describe("ChatTimelineItemShell", () => {
  it("keeps a non-collapsible final item visible and correctly labelled", () => {
    const wrapper = mount(ChatTimelineItemShell, {
      props: {
        item: item(),
        label: "模型回答",
        statusLabel: "已完成",
        icon: "assistant",
      },
      slots: {
        default: () => h("p", { class: "fixture-body" }, "最终回答"),
        actions: () => h("button", { type: "button" }, "复制"),
      },
    });

    const article = wrapper.get("article");
    expect(wrapper.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(wrapper.get(".fixture-body").text()).toBe("最终回答");
    expect(article.classes()).toContain("chat-timeline-item-shell--assistant");
    expect(article.classes()).toContain("chat-timeline-item-shell--complete");
    expect(article.attributes("aria-busy")).toBe("false");
    expect(wrapper.get(`#${article.attributes("aria-labelledby")}`).text()).toBe("模型回答");
    expect(wrapper.get(`#${article.attributes("aria-describedby")}`).text()).toBe("已完成");
    expect(wrapper.get("[role='group']").attributes("aria-label")).toBe("模型回答操作");
    expect(wrapper.emitted("disclosure-change")).toBeUndefined();
  });

  it("toggles only collapsible content and emits the stable item identity", async () => {
    const reasoning = item({
      identity: "timeline-item-reasoning",
      itemId: "item-reasoning",
      kind: "reasoning",
      role: "process",
      phase: "active",
      domainStatus: "streaming",
    });
    const wrapper = mount(ChatTimelineItemShell, {
      props: {
        item: reasoning,
        label: "过程记录",
        statusLabel: "进行中",
        icon: "pending",
        collapsible: true,
        defaultExpanded: false,
      },
      slots: {
        default: () => h("p", { class: "fixture-body" }, "过程内容"),
        actions: () => h("button", { type: "button" }, "操作"),
      },
    });

    const button = wrapper.get(".chat-timeline-item-shell__disclosure");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".fixture-body").exists()).toBe(false);
    expect(wrapper.text()).toContain("过程记录");
    expect(wrapper.text()).toContain("进行中");
    expect(wrapper.find("[role='group']").exists()).toBe(true);

    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".fixture-body").text()).toBe("过程内容");
    expect(button.attributes("aria-controls"))
      .toBe(wrapper.get(".chat-timeline-item-shell__body").attributes("id"));
    const firstChange = wrapper.emitted("disclosure-change")?.[0]?.[0];
    expect(firstChange).toEqual({ itemIdentity: reasoning.identity, expanded: true });
    expect(Object.isFrozen(firstChange)).toBe(true);

    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".fixture-body").exists()).toBe(false);
    expect(wrapper.emitted("disclosure-change")?.[1]?.[0])
      .toEqual({ itemIdentity: reasoning.identity, expanded: false });

    await wrapper.setProps({ defaultExpanded: true });
    expect(button.attributes("aria-expanded")).toBe("false");
  });

  it("maps busy and role presentation without changing slotted content", () => {
    const cases: readonly [ConversationTimelineItemViewModel, boolean, string][] = [
      [item({ role: "user", kind: "user_message", phase: "pending", domainStatus: "started" }), true, "user"],
      [item({ role: "process", kind: "reasoning", phase: "active", domainStatus: "streaming" }), true, "process"],
      [item({ role: "system", kind: "unknown", phase: "complete" }), false, "system"],
    ];

    for (const [fixture, busy, role] of cases) {
      const body = `内容-${role}`;
      const wrapper = mount(ChatTimelineItemShell, {
        props: {
          item: fixture,
          label: "内容",
          statusLabel: "状态",
          icon: "pending",
        },
        slots: { default: () => body },
      });
      expect(wrapper.get("article").attributes("aria-busy")).toBe(String(busy));
      expect(wrapper.get("article").classes()).toContain(`chat-timeline-item-shell--${role}`);
      expect(wrapper.get(".chat-timeline-item-shell__body").text()).toBe(body);
    }
  });

  it("is accessible and remains presentation-only", async () => {
    const wrapper = mount(ChatTimelineItemShell, {
      attachTo: document.body,
      props: {
        item: item({ kind: "reasoning", role: "process" }),
        label: "过程记录",
        statusLabel: "已完成",
        icon: "pending",
        collapsible: true,
      },
      slots: {
        default: () => h("p", "可阅读内容"),
        actions: () => h("button", { type: "button" }, "复制"),
      },
    });
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const source = readFileSync("src/components/chat/ChatTimelineItemShell.vue", "utf8");
    expect(source).not.toMatch(/v-html|fetch\(|invoke\(|@tauri-apps|router|store|client|clipboard|storage|console\./i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain(":focus-visible");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("useId()");
  });
});
