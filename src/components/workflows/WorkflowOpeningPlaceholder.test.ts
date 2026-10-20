// @vitest-environment happy-dom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import WorkflowOpeningPlaceholder from "./WorkflowOpeningPlaceholder.vue";

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); });

it("keeps fast transitions quiet and offers a return action when loading takes longer", async () => {
  vi.useFakeTimers();
  wrapper = mount(WorkflowOpeningPlaceholder);
  expect(wrapper.text()).toBe("");
  expect(wrapper.attributes("aria-busy")).toBe("true");
  await vi.advanceTimersByTimeAsync(179);
  expect(wrapper.text()).toBe("");
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.text()).toContain("正在打开工作流");
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("cancel")).toHaveLength(1);
});

it("cancels pending feedback when the canvas is already available", async () => {
  vi.useFakeTimers();
  wrapper = mount(WorkflowOpeningPlaceholder);
  await vi.advanceTimersByTimeAsync(80);
  wrapper.unmount(); wrapper = undefined;
  expect(vi.getTimerCount()).toBe(0);
});
