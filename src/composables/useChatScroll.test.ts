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

  it("follows streamed frames immediately while keeping explicit return-to-bottom smooth", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const wrapper = mount(Harness);
    const scrollTo = vi.fn();
    Object.defineProperties(wrapper.element, {
      scrollHeight: { configurable: true, value: 1200 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    await wrapper.vm.followNewContent();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: "auto" });
    wrapper.vm.scrollToBottom();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: "smooth" });
    wrapper.unmount();
  });

  it("does not pull the reader down if they scroll up or select text during a pending frame", async () => {
    const wrapper = mount(Harness, { attachTo: document.body });
    const scrollTo = vi.fn();
    Object.defineProperties(wrapper.element, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    const pending = wrapper.vm.followNewContent();
    wrapper.vm.update();
    await pending;
    expect(scrollTo).not.toHaveBeenCalled();
    wrapper.vm.following = true;
    wrapper.element.textContent = "选中的正文";
    const range = document.createRange();
    range.selectNodeContents(wrapper.element);
    document.getSelection()!.addRange(range);
    await wrapper.vm.followNewContent();
    expect(scrollTo).not.toHaveBeenCalled();
    document.getSelection()!.removeAllRanges();
    wrapper.unmount();
  });

  it("follows content height changes between source events, respects turn location and disconnects", async () => {
    let resized: () => void = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resized = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const located = ref(false);
    const wrapper = mount(defineComponent({
      setup() {
        const element = ref<HTMLElement | null>(null);
        const content = ref<HTMLElement | null>(null);
        return { element, content, ...useChatScroll(element, content, () => !located.value) };
      },
      template: '<div ref="element"><div ref="content">正文</div></div>',
    }));
    await nextTick();
    const scrollTo = vi.fn();
    Object.defineProperties(wrapper.element, {
      scrollHeight: { configurable: true, value: 1500 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    expect(observe).toHaveBeenCalledWith(wrapper.element.firstElementChild);
    resized();
    await nextTick();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1500, behavior: "auto" });
    scrollTo.mockClear();
    located.value = true;
    resized();
    await nextTick();
    expect(scrollTo).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
