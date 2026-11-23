// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import WorkflowCardRail from "./WorkflowCardRail.vue";

it("scrolls an overflowing list from the keyboard without a paging toolbar", async () => {
  const wrapper = mount(WorkflowCardRail, { slots: { default: '<li><a href="#edit">进入编辑</a></li>' } });
  try {
    const list = wrapper.get<HTMLUListElement>("ul");
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    Object.defineProperties(list.element, {
      clientWidth: { value: 240 }, scrollWidth: { value: 720 },
      scrollBy: { value: scrollBy }, scrollTo: { value: scrollTo },
    });
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("左右滑动");
    await list.trigger("keydown", { key: "ArrowRight" });
    expect(scrollBy).toHaveBeenCalledWith({ left: 240 });
    await list.trigger("keydown", { key: "End" });
    expect(scrollTo).toHaveBeenCalledWith({ left: 720 });
    await wrapper.get("a").trigger("keydown", { key: "ArrowLeft" });
    expect(scrollBy).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

it("shows the thumb only while the rail is scrolling and renews the idle delay on movement", async () => {
  vi.useFakeTimers();
  const wrapper = mount(WorkflowCardRail);
  try {
    const rail = wrapper.get<HTMLUListElement>("ul");
    Object.defineProperties(rail.element, {
      clientWidth: { value: 240 },
      scrollWidth: { value: 720 },
    });
    const scrolling = () => rail.classes().includes("workflow-card-rail__list--scrolling");
    await rail.trigger("mouseenter");
    await rail.trigger("focus");
    expect(scrolling()).toBe(false);

    rail.element.scrollLeft = 40;
    await rail.trigger("scroll");
    expect(scrolling()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    rail.element.scrollLeft = 80;
    await rail.trigger("scroll");
    await vi.advanceTimersByTimeAsync(100);
    expect(scrolling()).toBe(true);

    await vi.runAllTimersAsync();
    expect(scrolling()).toBe(false);
  } finally {
    wrapper.unmount();
    vi.useRealTimers();
  }
});
