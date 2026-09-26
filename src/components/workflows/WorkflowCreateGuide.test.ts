// @vitest-environment happy-dom
import { defineComponent, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import WorkflowCreateGuide from "./WorkflowCreateGuide.vue";

let wrapper: VueWrapper;
const create = vi.fn();
const Harness = defineComponent({
  components: { WorkflowCreateGuide },
  setup() { return { show: ref(true), target: ref<HTMLButtonElement | null>(null), create }; },
  template: `<div><button ref="target" @click="show = false; create()">创建工作流</button><button class="other">其他页面操作</button><WorkflowCreateGuide :show="show" :target="target" @dismiss="show = false" /></div>`,
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ""; vi.clearAllMocks(); });
async function setup() { wrapper = mount(Harness, { attachTo: document.body }); await flushPromises(); }
const close = () => document.querySelector<HTMLButtonElement>('[aria-label="关闭新手引导"]')!;

it("labels the single step, focuses the actual trigger, and closes without creating", async () => {
  await setup();
  expect(document.activeElement).toBe(wrapper.get("button").element);
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.textContent).not.toContain("新手引导 · 1 / 1");
  expect(panel.querySelector("header h2")?.textContent).toBe("从创建第一个工作流开始");
  expect(panel.textContent).toContain("点击高亮的“创建工作流”");
  const result = await axe.run(panel, { rules: { region: { enabled: false } } });
  expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  close().click(); await flushPromises();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();
  expect(document.activeElement).toBe(wrapper.get("button").element);
  expect(create).not.toHaveBeenCalled();
});

it("supports keyboard access to close, Escape, and restores the trigger", async () => {
  await setup();
  await wrapper.get("button").trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(close());
  close().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await flushPromises();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();
  expect(document.activeElement).toBe(wrapper.get("button").element);
  expect(create).not.toHaveBeenCalled();
});

it("the highlighted real button invokes its existing action exactly once", async () => {
  await setup();
  await wrapper.get("button").trigger("click"); await flushPromises();
  expect(create).toHaveBeenCalledOnce();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();
});

it("allows leaving the hint for another page control without stealing focus", async () => {
  await setup();
  wrapper.get<HTMLButtonElement>(".other").element.focus(); await flushPromises();
  expect(document.querySelector(".workflow-create-guide")).toBeNull();
  expect(document.activeElement).toBe(wrapper.get(".other").element);
  expect(create).not.toHaveBeenCalled();
});
