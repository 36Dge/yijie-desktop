// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatSidebarSessionTitle from "./ChatSidebarSessionTitle.vue";
import ChatSidebarSessionRow from "./ChatSidebarSessionRow.vue";

enableAutoUnmount(afterEach);
let availableWidth = 120, textWidth = 300;
class MotionPreference extends EventTarget { matches = false; }
let motion: MotionPreference;
class LayoutObserver {
  static instances: LayoutObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: () => void) { LayoutObserver.instances.push(this); }
}
beforeEach(() => {
  availableWidth = 120; textWidth = 300;
  motion = new MotionPreference();
  LayoutObserver.instances = [];
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal("ResizeObserver", LayoutObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("chat-session-title") ? availableWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("chat-session-title__text") ? textWidth : 0;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sidebar title scrolling", () => {
  it("runs only for an active overflowing title, with one accessible copy, and resets on leave", async () => {
    const wrapper = mount(ChatSidebarSessionTitle, { props: { text: "介绍杭州西湖并生成阅读文档", active: false } });
    expect(LayoutObserver.instances).toHaveLength(0);
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(false);
    await wrapper.setProps({ active: true }); await flushPromises();
    expect(wrapper.classes()).toContain("chat-session-title--scrolling");
    expect(wrapper.findAll('.chat-session-title__text:not([aria-hidden])')).toHaveLength(1);
    expect(wrapper.get('[aria-hidden="true"]').text()).toBe(wrapper.props("text"));
    const observer = LayoutObserver.instances[0]!;
    await wrapper.setProps({ active: false }); await flushPromises();
    expect(wrapper.classes()).not.toContain("chat-session-title--scrolling");
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(false);
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps short titles static and remeasures after layout or title changes", async () => {
    textWidth = 100;
    const wrapper = mount(ChatSidebarSessionTitle, { props: { text: "简短标题", active: true } });
    await flushPromises();
    expect(wrapper.classes()).not.toContain("chat-session-title--scrolling");
    availableWidth = 80; LayoutObserver.instances[0]!.callback(); await flushPromises();
    expect(wrapper.classes()).toContain("chat-session-title--scrolling");
    const oldObserver = LayoutObserver.instances[0]!;
    textWidth = 50;
    await wrapper.setProps({ text: "新标题" }); await flushPromises();
    expect(wrapper.classes()).not.toContain("chat-session-title--scrolling");
    expect(wrapper.text()).toBe("新标题");
    expect(oldObserver.disconnect).toHaveBeenCalledOnce();
  });

  it("honors reduced motion and releases observers and preference listeners on unmount", async () => {
    motion.matches = true;
    const removeListener = vi.spyOn(motion, "removeEventListener");
    const wrapper = mount(ChatSidebarSessionTitle, { props: { text: "一条用于检查动态效果偏好的长标题", active: true } });
    await flushPromises();
    expect(wrapper.classes()).not.toContain("chat-session-title--scrolling");
    motion.matches = false; motion.dispatchEvent(new Event("change")); await flushPromises();
    expect(wrapper.classes()).toContain("chat-session-title--scrolling");
    motion.matches = true; motion.dispatchEvent(new Event("change")); await flushPromises();
    expect(wrapper.classes()).not.toContain("chat-session-title--scrolling");
    wrapper.unmount();
    expect(LayoutObserver.instances[0]!.disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("does not create late observers after an active title unmounts", async () => {
    const wrapper = mount(ChatSidebarSessionTitle, { props: { text: "快速切换任务时的普通长标题", active: true } });
    wrapper.unmount(); await flushPromises();
    expect(LayoutObserver.instances).toHaveLength(0);
  });

  it("starts on row hover without navigating and pauses while the context menu is open", async () => {
    const session = { sessionId: "session", projectId: null, title: "普通长任务标题用于检查悬停与菜单", titleSource: "user" as const,
      pinnedAt: null, lastActivityAt: 1, latestTurnStatus: "completed", projectAvailable: true };
    const wrapper = mount(ChatSidebarSessionRow, { props: { session, completionUnread: true, currentPath: "/chat/another",
      options: [{ label: "重命名", key: "rename" }], actionPending: false, activeMenuId: null, menuTarget: false } });
    await wrapper.trigger("mouseenter"); await flushPromises();
    expect(wrapper.getComponent(ChatSidebarSessionTitle).props("active")).toBe(true);
    expect(wrapper.emitted("open")).toBeUndefined();
    await wrapper.trigger("contextmenu", { clientX: 100, clientY: 100 }); await flushPromises();
    expect(wrapper.getComponent(ChatSidebarSessionTitle).props("active")).toBe(false);
    expect(wrapper.emitted("action")).toBeUndefined();
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});
