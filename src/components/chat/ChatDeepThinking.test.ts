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
  it("starts collapsed, preserves raw text and DOM, and retains the user's choice through completion", async () => {
    const wrapper = mount(ChatDeepThinking, {attachTo: document.body, props: {item: item("**原文** [普通标签](https://example.org)"), visible: true, live: true, stateMessage: null}});
    const button = wrapper.get("button"), panel = wrapper.get('[role="region"]');
    const original = wrapper.get(".chat-safe-content__paragraph").element;
    expect(button.text()).toBe("深度思考");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(panel.isVisible()).toBe(false);
    expect(wrapper.find("strong, a").exists()).toBe(false);
    await button.trigger("click");
    expect(panel.isVisible()).toBe(true);
    await wrapper.setProps({item: item("**原文** [普通标签](https://example.org)\n追加内容"), live: false});
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".chat-safe-content__paragraph").element).toBe(original);
    expect(wrapper.emitted("disclosure-change")![0]![0]).toEqual({itemIdentity: item().identity, expanded: true});
    await wrapper.setProps({item: item("下一条记录", "another")});
    expect(button.attributes("aria-expanded")).toBe("false");
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
});
