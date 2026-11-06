// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { NTooltip } from "naive-ui";
import { afterEach, expect, it, vi } from "vitest";
import YjTooltip from "./YjTooltip.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; });

it("keeps the original button, accessible name and activation while replacing its native hint", async () => {
  const activate = vi.fn();
  const wrapper = mount({ render: () => h("div", { class: "host" }, [h(YjTooltip, { text: "打开文件预览", onClick: activate }, () => h("button", { "aria-label": "打开预览" }, "预览"))]) }, { attachTo: document.body });
  wrappers.push(wrapper);
  const button = wrapper.get(".host > button");
  expect(button.attributes("title")).toBeUndefined();
  expect(button.attributes("aria-label")).toBe("打开预览");
  await button.trigger("mouseenter");
  await flushPromises();
  const description = button.attributes("aria-describedby");
  expect(description).toBeTruthy();
  expect(document.getElementById(description!)?.textContent).toBe("打开文件预览");
  await button.trigger("keydown", { key: "Escape" });
  expect(wrapper.getComponent(NTooltip).props("show")).toBe(false);
  await button.trigger("click");
  expect(activate).toHaveBeenCalledOnce();
});

it("supports keyboard focus and dismisses when the hint is removed", async () => {
  const wrapper = mount(YjTooltip, { props: { text: "完整任务标题" }, slots: { default: () => h("button", "任务") }, attachTo: document.body });
  wrappers.push(wrapper);
  const button = wrapper.get("button");
  button.element.focus();
  await button.trigger("focusin");
  expect(wrapper.getComponent(NTooltip).props("show")).toBe(true);
  await button.trigger("focusout");
  expect(wrapper.getComponent(NTooltip).props("show")).toBe(false);
  await button.trigger("mouseenter");
  await wrapper.setProps({ text: undefined });
  expect(wrapper.getComponent(NTooltip).props("show")).toBe(false);
  expect(button.attributes("aria-describedby")).toBeUndefined();
});

it("shows only the closest hint for nested controls and restores its parent on leave", async () => {
  const wrapper = mount({ render: () => h(YjTooltip, { text: "专家说明" }, () => h("button", [h(YjTooltip, { text: "专家完整名称" }, () => h("span", "专家"))])) }, { attachTo: document.body });
  wrappers.push(wrapper);
  await wrapper.get("button").trigger("mouseenter");
  await wrapper.get("button > span").trigger("mouseenter");
  expect(wrapper.findAllComponents(NTooltip).map(tooltip => tooltip.props("show"))).toEqual([false, true]);
  await wrapper.get("button > span").trigger("mouseleave");
  expect(wrapper.findAllComponents(NTooltip).map(tooltip => tooltip.props("show"))).toEqual([true, false]);
});
