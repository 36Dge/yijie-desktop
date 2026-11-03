// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "./useChatScroll";

const Harness = defineComponent({
  setup() {
    const element = ref<HTMLElement | null>(null);
    return { element, ...useChatScroll(element) };
  },
  template: '<div ref="element" tabindex="-1" />',
});

afterEach(() => vi.unstubAllGlobals());

describe("useChatScroll", () => {
  it("follows at 48px and shows the bottom control only beyond 160px", async () => {
    const wrapper = mount(Harness);
    const element = wrapper.get("div").element as HTMLElement;
    let scrollTop = 552;
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, get: () => 1000 },
      clientHeight: { configurable: true, get: () => 400 },
      scrollTop: { configurable: true, get: () => scrollTop, set: (value) => { scrollTop = value as number; } },
    });

    wrapper.vm.update();
    expect(wrapper.vm.following).toBe(true);
    expect(wrapper.vm.showBottomButton).toBe(false);

    scrollTop = 439;
    wrapper.vm.update();
    expect(wrapper.vm.following).toBe(false);
    expect(wrapper.vm.showBottomButton).toBe(true);
  });

  it("uses immediate scrolling when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mount(Harness);
    const element = wrapper.get("div").element as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 1200 },
      scrollTo: { configurable: true, value: scrollTo },
    });

    wrapper.vm.scrollToBottom();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "auto" });
  });

  it("preserves the visible anchor when older history is prepended", async () => {
    const wrapper = mount(Harness);
    const element = wrapper.get("div").element as HTMLElement;
    let scrollHeight = 1000;
    let scrollTop = 180;
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, get: () => scrollTop, set: (value) => { scrollTop = value as number; } },
    });
    await wrapper.vm.preservePositionWhile(async () => { scrollHeight = 1320; });
    expect(scrollTop).toBe(500);
  });

  it("anchors a long latest turn without allowing pending or subsequent content updates to pull it to the bottom", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(1, callback); return 1; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    const wrapper = mount(Harness);
    await nextTick();
    const element = wrapper.get("div").element as HTMLElement;
    const anchor = document.createElement("div");
    anchor.tabIndex = -1;
    element.append(anchor);
    const scroll = vi.fn();
    Object.defineProperty(anchor, "scrollIntoView", { value: scroll });
    Object.defineProperties(element, {
      scrollHeight: { value: 2400 }, clientHeight: { value: 400 }, scrollTop: { configurable: true, value: 1000 },
    });
    await wrapper.vm.followNewContent();
    expect(callbacks.size).toBe(1);
    wrapper.vm.scrollToAnchor(anchor);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(callbacks.size).toBe(0);
    await wrapper.vm.followNewContent();
    expect(callbacks.size).toBe(0);
    expect(wrapper.vm.following).toBe(false);
    wrapper.unmount();
  });
});


it("coalesces automatic follow into one frame and cancels it on upward reading input", async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const wrapper = mount(Harness); await nextTick();
  const element = wrapper.get("div").element as HTMLElement;
  const smooth = vi.fn(); let top = 600; let height = 1000;
  Object.defineProperties(element, {
    scrollHeight: {configurable: true, get: () => height}, clientHeight: {configurable: true, value: 400},
    scrollTop: {configurable: true, get: () => top, set: value => { top = Number(value); }},
    scrollTo: {configurable: true, value: smooth},
  });
  wrapper.vm.update(); height = 1400; wrapper.vm.update();
  expect(wrapper.vm.following).toBe(true);
  await wrapper.vm.followNewContent(); await wrapper.vm.followNewContent();
  expect(callbacks.size).toBe(1);
  for (const callback of callbacks.values()) callback(16); callbacks.clear();
  expect(top).toBe(1000); expect(smooth).not.toHaveBeenCalled();
  await wrapper.vm.followNewContent();
  element.dispatchEvent(new WheelEvent("wheel", {deltaY: -1}));
  expect(callbacks.size).toBe(0); expect(wrapper.vm.following).toBe(false);
  top = 990; wrapper.vm.update(); expect(wrapper.vm.following).toBe(false);
  top = 1000; wrapper.vm.update(); expect(wrapper.vm.following).toBe(true);
  await wrapper.vm.followNewContent(); wrapper.unmount(); expect(callbacks.size).toBe(0);
});


it("keeps following while explicit smooth navigation is still far from the bottom", async () => {
  const wrapper = mount(Harness); await nextTick();
  const element = wrapper.get("div").element as HTMLElement;
  let top = 100;
  Object.defineProperties(element, {
    scrollHeight: {configurable: true, value: 2400}, clientHeight: {configurable: true, value: 400},
    scrollTop: {configurable: true, get: () => top}, scrollTo: {configurable: true, value: vi.fn()},
  });
  wrapper.vm.scrollToBottom(); top = 200; wrapper.vm.update();
  expect(wrapper.vm.following).toBe(true);
  element.dispatchEvent(new WheelEvent("wheel", {deltaY: -10}));
  expect(wrapper.vm.following).toBe(false);
  wrapper.unmount();
});
