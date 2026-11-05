// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import type { NativeConversationView, NativeItem } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());
const reason = (id: string, text: string): NativeItem => ({id, type: "reasoning", summary: [text], content: ["不进入摘要入口的原始内容"], availability: "available"});
const tool = (id: string): NativeItem => ({id, type: "commandExecution", commandLabel: "python3 --version", status: "completed", exitCode: 0, availability: "available"});
function saved(items: NativeItem[], live = false): NativeConversationView {
  return {sessionId: "session", turnId: "turn", runtimeThreadId: "runtime", runtimeTurnId: "runtime-turn", source: "native_observed", revision: "1", availability: "available", status: live ? "inProgress" : "completed", statusSource: "runtime_notification", terminalObserved: !live,
    items: items.map((item, ordinal) => ({item, ordinal, lastMethod: item.type === "reasoning" && live ? "item/started" : "item/completed"}))};
}
function project(view: NativeConversationView, live = false) {
  const state = composeConversationView({threads: [{threadId: view.sessionId, status: "ready"}], turns: [], items: []}, [view]);
  return selectConversationTimeline(state, view.sessionId, undefined, {liveTurnId: live ? view.turnId : null, protectApprovalProcessContent: false})!.turns[0]!;
}
const render = (view: NativeConversationView, live = false) => mount(ChatTurnGroup, {attachTo: document.body, props: {turn: project(view, live), position: 1, timingLabel: "已用时 12 秒"}});
const toggle = ".chat-turn-group__reasoning-summary .chat-deep-thinking__toggle";

describe("one expandable reasoning summary per turn", () => {
  it("shows an empty live wait, then exposes a real summary without a tool group", async () => {
    const wrapper = render(saved([reason("r", "")], true), true);
    expect(wrapper.get('[role="status"]').text()).toBe("正在思考");
    expect(wrapper.find(toggle).exists()).toBe(false);
    await wrapper.setProps({turn: project(saved([reason("r", "## 城市定位\n\n已有摘要内容")], true), true)});
    expect(wrapper.get(toggle).text()).toBe("正在思考 · 城市定位");
    expect(wrapper.get(toggle).attributes("aria-expanded")).toBe("false");
    const controlledId = wrapper.get(toggle).attributes("aria-controls");
    expect(wrapper.get(`[id="${controlledId}"]`).isVisible()).toBe(false);
    expect(wrapper.find(".chat-activity-group").exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    // Closed summaries do not eagerly mount every historical reasoning body.
    expect(wrapper.find('[data-reasoning-item]').exists()).toBe(false);
    await wrapper.get(toggle).trigger("click");
    expect(wrapper.get('[role="region"]').isVisible()).toBe(true);
    expect(wrapper.text()).toContain("已有摘要内容");
    expect(wrapper.text()).not.toContain("不进入摘要入口的原始内容");
  });

  it("updates same-Item titles immediately, stabilizes new Items and preserves opened content identity", async () => {
    vi.useFakeTimers({now: 0});
    const wrapper = render(saved([reason("r1", "## 地理")], true), true);
    await wrapper.get(toggle).trigger("click");
    const button = wrapper.get(toggle).element, section = wrapper.get('[data-reasoning-item="r1"]').element;
    await wrapper.setProps({turn: project(saved([reason("r1", "## 地理与交通")], true), true)});
    expect(wrapper.get(toggle).text()).toBe("正在思考 · 地理与交通");
    await wrapper.setProps({turn: project(saved([reason("r1", "## 地理与交通"), reason("r2", "**城市生活**")], true), true)});
    expect(wrapper.get(toggle).text()).toBe("正在思考 · 地理与交通");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(wrapper.get(toggle).text()).toBe("正在思考 · 城市生活");
    expect(wrapper.get(toggle).element).toBe(button);
    expect(wrapper.get('[data-reasoning-item="r1"]').element).toBe(section);
    expect(wrapper.get(toggle).attributes("aria-expanded")).toBe("true");
  });

  it("keeps interleaved tools as one group and summaries as one separate disclosure", async () => {
    const input = saved([reason("r1", "## 查阅资料"), tool("c1"), reason("r2", "## 整理结果"), tool("c2"), reason("r3", "## 核对结论")], true);
    const before = JSON.stringify(input), wrapper = render(input, true);
    expect(wrapper.findAll(toggle)).toHaveLength(1);
    expect(wrapper.findAll(".chat-activity-group")).toHaveLength(1);
    expect(wrapper.get(".chat-activity-group__counts").text()).toBe("2 次调用");
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("运行了命令");
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    expect(wrapper.findAll('[data-activity-item]')).toHaveLength(2);
    await wrapper.get(toggle).trigger("click");
    expect(wrapper.findAll('[data-reasoning-item]').map(row => row.attributes('data-reasoning-item'))).toEqual(["r1", "r2", "r3"]);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(wrapper.get(toggle).isVisible()).toBe(true);
    expect(wrapper.get('[aria-label="思考摘要内容"]').isVisible()).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["final_answer", undefined] as const)("keeps answer text visible and user choice intact when phase=%s begins", async phase => {
    const wrapper = render(saved([reason("r", "## 整理城市资料")], true), true);
    await wrapper.get(toggle).trigger("click");
    const input = saved([reason("r", "## 整理城市资料"), {id: "answer", type: "agentMessage", text: "这是可读正文。", availability: "available", ...(phase ? {phase} : {})}], true);
    await wrapper.setProps({turn: project(input, true)});
    expect(wrapper.get(toggle).text()).toBe("思考摘要 · 整理城市资料");
    expect(wrapper.get(toggle).attributes("aria-expanded")).toBe("true");
    expect(wrapper.get('.chat-turn-group__reasoning-summary .chat-thinking').classes()).not.toContain('chat-thinking--active');
    const answer = wrapper.get(phase ? '.chat-turn-group__item--final_answer' : '.chat-turn-group__item--assistant_unclassified');
    await wrapper.get(toggle).trigger("click");
    expect(answer.isVisible()).toBe(true);
    expect(answer.text()).toContain("这是可读正文。");
    expect(input.items[1]!.item.phase).toBe(phase);
  });

  it("keeps untouched content collapsed through final text and restores readable history after remount", async () => {
    const input = saved([reason("r", "## 保存的摘要\n\n原生记录仍在。")]);
    const before = JSON.stringify(input), wrapper = render(input);
    expect(wrapper.get(toggle).attributes('aria-expanded')).toBe('false');
    await wrapper.get(toggle).trigger('click');
    expect(wrapper.get('[aria-label="思考摘要内容"]').text()).toContain('原生记录仍在。');
    wrapper.unmount();
    const reopened = render(JSON.parse(before));
    expect(reopened.get(toggle).attributes('aria-expanded')).toBe('false');
    expect(reopened.find('.chat-thinking--active').exists()).toBe(false);
    await reopened.get(toggle).trigger('click');
    expect(reopened.get('[aria-label="思考摘要内容"]').isVisible()).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(reopened.emitted('approval-decision')).toBeUndefined();
  });
});
