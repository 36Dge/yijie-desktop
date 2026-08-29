// @vitest-environment happy-dom

import axe from "axe-core";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hydrateConversationState, type ConversationTurnStatus } from "../../domain/conversation-state";
import { selectConversationTimeline, type ConversationTimelinePlanViewModel } from "../../domain/conversation-timeline";
import ChatTurnPlan from "./ChatTurnPlan.vue";

function projectedPlan(status: ConversationTurnStatus): ConversationTimelinePlanViewModel {
  const terminalStatus = status === "completed" || status === "failed" || status === "interrupted"
    ? status
    : null;
  const timeline = selectConversationTimeline(hydrateConversationState({
    threads: [{
      threadId: "thread-plan",
      status: status === "completed" ? "ready" : "active",
    }],
    turns: [{
      threadId: "thread-plan",
      turnId: "turn-plan",
      ordinal: 0,
      status,
      terminalStatus,
      plan: {
        explanation: "**保持纯文本**\n<script>unsafe()</script>",
        steps: [
          { ordinal: 0, text: "已处理", status: "completed" },
          { ordinal: 1, text: "正在处理", status: "in_progress" },
          { ordinal: 2, text: "等待处理", status: "pending" },
          { ordinal: 3, text: "未知步骤", status: "unknown" },
        ],
      },
    }],
    items: [],
  }), "thread-plan");
  const plan = timeline?.turns[0]?.plan;
  if (plan === null || plan === undefined) throw new Error("fixture_missing_plan");
  return plan;
}

describe("ChatTurnPlan", () => {
  it("renders the live stable plan expanded with plain text and textual step statuses", () => {
    const wrapper = mount(ChatTurnPlan, { props: { plan: projectedPlan("in_progress") } });

    expect(wrapper.get("button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".chat-turn-plan__status").text()).toBe("进行中");
    expect(wrapper.get(".chat-turn-plan__explanation").text())
      .toContain("**保持纯文本**");
    expect(wrapper.find(".chat-turn-plan__explanation strong").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-plan__explanation").text()).toContain("<script>unsafe()</script>");
    expect(wrapper.findAll(".chat-turn-plan__step").map((step) => step.text())).toEqual([
      "已处理已完成",
      "正在处理进行中",
      "等待处理待执行",
      "未知步骤状态未知",
    ]);
  });

  it("defaults historical plans to collapsed and preserves the user's disclosure choice", async () => {
    const historical = projectedPlan("completed");
    const wrapper = mount(ChatTurnPlan, { props: { plan: historical } });
    const button = wrapper.get("button");

    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".chat-turn-plan__content").exists()).toBe(false);

    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(button.attributes("aria-controls"))
      .toBe(wrapper.get(".chat-turn-plan__content").attributes("id"));

    await wrapper.setProps({
      plan: Object.freeze({
        ...historical,
        explanation: "updated snapshot",
        defaultExpanded: false,
      }),
    });
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("updated snapshot");
  });

  it("is accessible and stays presentation-only without rich-content or runtime authority", async () => {
    const wrapper = mount(ChatTurnPlan, {
      attachTo: document.body,
      props: { plan: projectedPlan("in_progress") },
    });
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();

    const source = readFileSync("src/components/chat/ChatTurnPlan.vue", "utf8");
    expect(source).not.toMatch(/ChatSafeContent|v-html|fetch\(|invoke\(|@tauri-apps|router|store|client|clipboard|storage|console\./i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/reasoning effort|推理强度|model selector|模型选择/i);
    expect(source).toContain(":focus-visible");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
