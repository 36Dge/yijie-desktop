// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
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
});
