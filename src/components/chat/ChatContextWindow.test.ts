// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatContextWindow from "./ChatContextWindow.vue";
import ChatContextUpdate from "./ChatContextUpdate.vue";

describe("context window indicator", () => {
  it("opens on hover and keyboard focus, updates live, and dismisses with Escape", async () => {
    const w = mount(ChatContextWindow, { attachTo: document.body, props: { sample: null } });
    const trigger = w.get("button");
    expect(trigger.attributes("aria-label")).toContain("暂无用量数据");
    expect(trigger.attributes("aria-describedby")).toBeUndefined();
    await trigger.trigger("mouseenter"); await flushPromises();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("暂无用量数据");
    await w.setProps({ sample: { used_tokens: 143000, capacity_tokens: 730000, turn_id: "turn", window_id: "window", observed_at: "2026-11-08T12:00:00Z" } });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("20% 已用（剩余 80%）");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("上下文窗口：");
    expect(document.querySelector('[role="tooltip"]')?.textContent).not.toContain("最近一次统计");
    await trigger.trigger("keydown", { key: "Escape" });
    expect(trigger.attributes("aria-describedby")).toBeUndefined();
    await trigger.trigger("mouseleave");
    await new Promise(resolve => setTimeout(resolve, 130));
    await trigger.trigger("focus");
    expect(trigger.attributes("aria-describedby")).toBeDefined();
    await trigger.trigger("blur");
    expect(trigger.attributes("aria-describedby")).toBeUndefined();
    w.unmount();
  });
  it("updates the same public status row and never claims completion for interruption", async () => {
    const w = mount(ChatContextUpdate, { props: { state: "in_progress" } });
    const node = w.get('[role="status"]').element;
    expect(w.text()).toBe("正在整理上下文 · 可能需要几分钟");
    await w.setProps({ state: "completed" });
    expect(w.text()).toBe("上下文已更新"); expect(w.get('[role="status"]').element).toBe(node);
    await w.setProps({ state: "interrupted" });
    expect(w.text()).toBe("上下文整理已中断");
    w.unmount();
  });
});
