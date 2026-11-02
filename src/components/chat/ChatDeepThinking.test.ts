// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatDeepThinking from "./ChatDeepThinking.vue";

enableAutoUnmount(afterEach);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function item(text = "第一段普通思考记录。", id = "reasoning") {
  const view: NativeConversationView = {sessionId: "session", turnId: "turn", runtimeThreadId: "thread", runtimeTurnId: "turn",
    source: "native_observed", revision: "1", availability: "available", status: "inProgress", statusSource: "runtime_notification",
    terminalObserved: false, items: [{ordinal: 0, lastMethod: "item/started", item: {id, type: "reasoning", content: [text], summary: [], availability: "available"}}]};
  return selectConversationTimeline(composeConversationView({threads: [{threadId: "session", status: "ready"}], turns: [], items: []}, [view]),
    "session", undefined, {liveTurnId: "turn", protectApprovalProcessContent: false})!.turns[0]!.items[0]!;
}
async function paint() { await nextTick(); await vi.advanceTimersByTimeAsync(20); }

describe("deep thinking disclosure and scroll ownership", () => {
  it("reuses the thinking sweep only for active reasoning and pauses inside a folded process", async () => {
    const wrapper = mount(ChatDeepThinking, {props: {item: item(), visible: true, live: true, thinking: true, stateMessage: null}});
    expect(wrapper.get(".chat-thinking").text()).toBe("深度思考");
    expect(wrapper.get(".chat-thinking").classes()).toContain("chat-thinking--active");
    await wrapper.setProps({visible: false});
    expect(wrapper.get(".chat-thinking").classes()).toContain("chat-thinking--paused");
    await wrapper.setProps({visible: true, thinking: false});
    expect(wrapper.get(".chat-thinking").classes()).not.toContain("chat-thinking--active");
    await wrapper.setProps({thinking: true, live: false});
    expect(wrapper.get(".chat-thinking").classes()).not.toContain("chat-thinking--active");
  });
  it("starts collapsed, renders Markdown and preserves DOM and the user's choice through completion", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item("**原文** [普通标签](https://example.org)"), visible: true, live: true, stateMessage: null}});
    const button = wrapper.get("button"), panel = wrapper.get('[role="region"]');
    const original = wrapper.get(".chat-safe-content__paragraph").element;
    expect(button.text()).toBe("深度思考");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(panel.isVisible()).toBe(false);
    expect(wrapper.get("strong").text()).toBe("原文");
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.get(".chat-text-link").text()).toBe("普通标签");
    await button.trigger("click");
    expect(panel.isVisible()).toBe(true);
    await wrapper.setProps({item: item("**原文** [普通标签](https://example.org)\n追加内容"), live: false});
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".chat-safe-content__paragraph").element).toBe(original);
    expect(wrapper.emitted("disclosure-change")![0]![0]).toEqual({itemIdentity: item().identity, expanded: true});
    await wrapper.setProps({item: item("下一条记录", "another")});
    expect(button.attributes("aria-expanded")).toBe("false");
  });

  it("uses the existing rich renderer for headings, lists, tables and streaming Markdown", async () => {
    const wrapper = mount(ChatDeepThinking, {props: {item: item("### 核对信息\n\n- **重点"), visible: true, live: true, stateMessage: null}});
    expect(wrapper.get("h3").text()).toBe("核对信息");
    expect(wrapper.get("li strong").text()).toBe("重点");
    const heading = wrapper.get("h3").element;
    const markdown = "### 核对信息\n\n- **重点信息**\n  - 核对位置\n\n| 项目 | 状态 |\n| --- | --- |\n| 路线 | 已整理 |\n\n```txt\n第一行\n第二行\n```";
    await wrapper.setProps({item: item(markdown), live: false});
    expect(wrapper.get("h3").element).toBe(heading);
    expect(wrapper.get("li strong").text()).toBe("重点信息");
    expect(wrapper.get("ul ul li").text()).toBe("核对位置");
    expect(wrapper.findAll("td").map(cell => cell.text())).toEqual(["路线", "已整理"]);
    expect(wrapper.get("pre code").text()).toBe("第一行\n第二行");
    expect(wrapper.props("item").contentBlocks[0]).toMatchObject({text: markdown});
  });

  it("follows live text only while pinned, lets the reader scroll up, and resumes at the bottom", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item(), visible: true, live: true, stateMessage: null}});
    const panel = wrapper.get('[role="region"]').element as HTMLElement;
    let height = 600;
    Object.defineProperties(panel, {scrollHeight: {get: () => height}, clientHeight: {get: () => 240}});
    await wrapper.get("button").trigger("click"); await paint();
    expect(panel.scrollTop).toBe(360);
    height = 700;
    await wrapper.setProps({item: item("追加内容")}); await paint();
    expect(panel.scrollTop).toBe(460);
    panel.scrollTop = 80;
    await wrapper.get('[role="region"]').trigger("scroll");
    height = 800;
    await wrapper.setProps({item: item("继续追加内容")}); await paint();
    expect(panel.scrollTop).toBe(80);
    panel.scrollTop = 560;
    await wrapper.get('[role="region"]').trigger("scroll");
    height = 900;
    await wrapper.setProps({item: item("最后一段内容"), live: false}); await paint();
    expect(panel.scrollTop).toBe(660);
  });

  it("cancels queued live-follow on upward wheel intent, even within 24px of the bottom", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item(), visible: true, live: true, stateMessage: null}});
    const region = wrapper.get('[role="region"]');
    const panel = region.element as HTMLElement;
    let height = 600;
    Object.defineProperties(panel, {scrollHeight: {get: () => height}, clientHeight: {value: 240}});
    await wrapper.get("button").trigger("click"); await paint();
    expect(panel.scrollTop).toBe(360);
    // New output schedules a bottom-follow frame before the wheel's native scroll event.
    await wrapper.setProps({item: item("待呈现的新内容")});
    await region.trigger("wheel", {deltaY: -8});
    panel.scrollTop = 352;
    await region.trigger("scroll");
    height = 700;
    await wrapper.setProps({item: item("继续到达的新内容")}); await paint();
    expect(panel.scrollTop).toBe(352);
    panel.scrollTop = 460;
    await region.trigger("scroll");
    height = 800;
    await wrapper.setProps({item: item("回到底部后恢复跟随")}); await paint();
    expect(panel.scrollTop).toBe(560);
  });

  it("shows the scrollbar during scrolling, fades it when idle, and hides it on collapse", async () => {
    const wrapper = mount(ChatDeepThinking, {props: {item: item(), visible: true, live: false, stateMessage: null}});
    await nextTick();
    const region = wrapper.get('[role="region"]');
    const panel = region.element as HTMLElement;
    const rail = wrapper.get(".chat-short-scrollbar");
    Object.defineProperties(panel, {scrollHeight: {value: 720}, clientHeight: {value: 240}});
    await wrapper.get("button").trigger("click"); await paint();
    expect(rail.classes()).not.toContain("chat-short-scrollbar--active");
    panel.scrollTop = 120;
    await region.trigger("scroll");
    expect(rail.classes()).toContain("chat-short-scrollbar--active");
    await vi.advanceTimersByTimeAsync(500);
    panel.scrollTop = 240;
    await region.trigger("scroll");
    await vi.advanceTimersByTimeAsync(500);
    expect(rail.classes()).toContain("chat-short-scrollbar--active");
    await vi.advanceTimersByTimeAsync(200);
    expect(rail.classes()).not.toContain("chat-short-scrollbar--active");
    panel.scrollTop = 360;
    await region.trigger("scroll");
    await wrapper.get("button").trigger("click");
    expect(rail.classes()).toContain("chat-short-scrollbar--hidden");
    expect(rail.classes()).not.toContain("chat-short-scrollbar--active");
  });

  it("keeps history at its reading position and does not scroll an outer folded process", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item(), visible: true, live: false, stateMessage: null}});
    const panel = wrapper.get('[role="region"]').element as HTMLElement;
    Object.defineProperties(panel, {scrollHeight: {value: 900}, clientHeight: {value: 240}});
    await wrapper.get("button").trigger("click"); await paint();
    expect(panel.scrollTop).toBe(0);
    await wrapper.setProps({visible: false, live: true, item: item("隐藏时更新")}); await paint();
    expect(panel.scrollTop).toBe(0);
    await wrapper.setProps({visible: true}); await paint();
    expect(panel.scrollTop).toBe(660);
  });

  it("keeps availability and interruption notices visible outside the collapsed text", () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: {...item(), availability: "partial"}, visible: true, live: false,
      stateMessage: "模型推理记录未完整结束，已保留可用内容。"}});
    expect(wrapper.get('[role="region"]').isVisible()).toBe(false);
    expect(wrapper.findAll('[role="note"]').every(note => note.isVisible())).toBe(true);
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
  });

  it("maps short-thumb dragging, track clicks and keys to the full scroll range at 200% zoom", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item(), visible: true, live: false, stateMessage: null}});
    await nextTick();
    const panel = wrapper.get('[role="region"]').element as HTMLElement;
    const rail = wrapper.get(".chat-short-scrollbar");
    const thumb = wrapper.get('[role="scrollbar"]');
    Object.defineProperties(panel, {scrollHeight: {value: 720}, clientHeight: {value: 240}});
    panel.style.setProperty("--yj-ui-scale", "2");
    Object.defineProperty(rail.element, "clientHeight", {value: 232});
    Object.defineProperty(thumb.element, "offsetHeight", {value: 18});
    vi.spyOn(rail.element, "getBoundingClientRect").mockReturnValue({height: 464, top: 8} as DOMRect);
    vi.spyOn(thumb.element, "getBoundingClientRect").mockReturnValue({height: 36} as DOMRect);
    Object.assign(thumb.element, {setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn()});
    await wrapper.get("button").trigger("click"); await paint();
    expect(thumb.attributes("aria-valuemax")).toBe("480");
    await thumb.trigger("pointerdown", {button: 0, pointerId: 1, clientY: 26});
    await thumb.trigger("pointermove", {pointerId: 1, clientY: 454});
    await thumb.trigger("pointerup", {pointerId: 1});
    expect(panel.scrollTop).toBe(480);
    expect(thumb.attributes("aria-valuenow")).toBe("480");
    expect(thumb.attributes("style")).toContain("translateY(214px)");
    await thumb.trigger("keydown", {key: "Home"});
    expect(panel.scrollTop).toBe(0);
    await rail.trigger("pointerdown", {button: 0, clientY: 240});
    expect(panel.scrollTop).toBe(240);
    await thumb.trigger("keydown", {key: "End"});
    expect(panel.scrollTop).toBe(480);
    const wheel = new WheelEvent("wheel", {deltaY: -120, bubbles: true, cancelable: true});
    rail.element.dispatchEvent(wheel);
    expect(panel.contains(rail.element)).toBe(true);
    expect(wheel.defaultPrevented).toBe(false);
  });
});
