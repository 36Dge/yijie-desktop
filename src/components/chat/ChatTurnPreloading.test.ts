// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import type { NativeTurnTiming } from "../../api/generated/chat-turn-timing.gen";
import { useChatTurnTiming } from "../../composables/useChatTurnTiming";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatTimeline from "./ChatTimeline.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

const user: NativeConversationView["items"][number] = {
  ordinal: 0, lastMethod: "item/completed",
  item: { id: "user", type: "userMessage", text: "介绍杭州美食", availability: "available" },
};
function view(items: NativeConversationView["items"] = [user]): NativeConversationView {
  return { sessionId: "session", turnId: "turn", runtimeThreadId: "thread", runtimeTurnId: "native-turn",
    source: "native_observed", revision: "1", availability: "available", status: "inProgress",
    statusSource: "runtime_notification", terminalObserved: false, items };
}
function timeline(native: NativeConversationView, live: string | null = "turn") {
  return selectConversationTimeline(composeConversationView({
    threads: [{ threadId: "session", status: "active" }], turns: [], items: [],
  }, [native]), "session", undefined, { protectApprovalProcessContent: false, liveTurnId: live })!;
}
function timing(duration?: number): NativeTurnTiming {
  return { schema_version: 1, agent_session_id: "session", thread_id: "thread", turn_id: "turn", source: "runtime_read",
    started_at: { state: "known", value: 100 },
    completed_at: duration === undefined ? { state: "unknown" } : { state: "known", value: 107 },
    duration_ms: duration === undefined ? { state: "unknown" } : { state: "known", value: duration } };
}

describe("first-content loading feedback", () => {
  it("keeps one status row from empty reasoning through live ticks to the authoritative completed duration", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const native = ref(view());
    const read = vi.fn().mockResolvedValueOnce(timing()).mockResolvedValueOnce(timing(7345));
    const wrapper = mount(defineComponent({ setup() {
      const current = computed(() => timeline(native.value));
      const labels = useChatTurnTiming({ scope: () => "session", turns: () => current.value.turns, read });
      return () => h(ChatTimeline, { timeline: current.value, turnTimingLabels: labels.value });
    } }), { attachTo: document.body });
    await flushPromises();
    const row = wrapper.get(".chat-turn-group__timing").element;
    expect(row.textContent).toBe("正在思考");
    expect(wrapper.find(".chat-execution-progress").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__items").element.children[0]!.textContent).toContain("介绍杭州美食");

    const emptyReasoning: NativeConversationView["items"][number] = { ordinal: 1, lastMethod: "item/started",
      item: { id: "reasoning", type: "reasoning", content: [], summary: [], availability: "available" } };
    native.value = view([user, emptyReasoning]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.get(".chat-thinking").isVisible()).toBe(true);
    expect(wrapper.find(".chat-turn-group__details-control").exists()).toBe(false);
    expect(wrapper.find(".chat-turn-group__item--reasoning").exists()).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);

    native.value = view([user, { ...emptyReasoning, item: { ...emptyReasoning.item, summary: ["先核对店铺信息。"] } }]);
    await flushPromises();
    expect(wrapper.find(".chat-turn-group__thinking .chat-thinking").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__timing").element).toBe(row);
    expect(row.textContent).toBe("已处理 3s");
    expect(wrapper.get(".chat-turn-group__timing").find('[aria-live]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(row.textContent).toBe("已处理 4s");

    const answer: NativeConversationView["items"][number] = { ordinal: 2, lastMethod: "item/started",
      item: { id: "answer", type: "agentMessage", phase: "final_answer", text: "可以先尝小笼。", availability: "available" } };
    native.value = view([...native.value.items, answer]);
    await flushPromises();
    expect(wrapper.find('.chat-turn-group__process-toggle').exists()).toBe(false);
    native.value = view(native.value.items.map(item => ({ ...item, lastMethod: "item/completed" })));
    await flushPromises();
    expect(row.textContent).toBe("已处理 4s"); // Item completion does not complete the Turn.

    native.value = { ...native.value, status: "completed", terminalObserved: true };
    await flushPromises();
    expect(wrapper.get(".chat-turn-group__timing").element).toBe(row);
    expect(row.textContent).toBe("已完成 7s");
    await vi.advanceTimersByTimeAsync(10000);
    expect(row.textContent).toBe("已完成 7s");
    expect(read).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["commentary", "final_answer", undefined] as const)("waits for actual text in an empty %s Item", async phase => {
    const item: NativeConversationView["items"][number] = { ordinal: 1, lastMethod: "item/started",
      item: { id: "answer", type: "agentMessage", phase, text: "  ", availability: "available" } };
    const wrapper = mount(ChatTimeline, { props: { timeline: timeline(view([user, item])), turnTimingLabels: { turn: "已处理 2s" } } });
    expect(wrapper.get(".chat-turn-group__timing").text()).toBe("正在思考");
    await wrapper.setProps({ timeline: timeline(view([user, { ...item, item: { ...item.item, text: "开始输出" } }])) });
    expect(wrapper.find(".chat-turn-group__thinking .chat-thinking").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__timing").text()).toBe("已处理 2s");
  });

  it("hands off to actual tool progress even before an assistant message arrives", async () => {
    const wrapper = mount(ChatTimeline, { props: { timeline: timeline(view()), turnTimingLabels: { turn: "已处理 2s" } } });
    await wrapper.setProps({ timeline: timeline(view([user, { ordinal: 1, lastMethod: "item/started",
      item: { id: "search", type: "webSearch", webSearch: { action: "search", queries: ["杭州美食"] }, availability: "available" } }])) });
    expect(wrapper.find(".chat-turn-group__thinking .chat-thinking").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__timing").text()).toBe("已处理 2s");
    expect(wrapper.get(".chat-web-search").attributes("aria-busy")).toBe("true");
    expect(wrapper.get(".chat-web-search__toggle").text()).toContain("网页搜索杭州美食");
  });

  it("shows loading even before optional timing metadata is available", () => {
    const wrapper = mount(ChatTimeline, { props: { timeline: timeline(view([])) } });
    expect(wrapper.get(".chat-thinking").text()).toBe("正在思考");
    expect(wrapper.text()).not.toContain("0 s");
  });

  it("does not restart first-content loading when the same live turn refreshes its projection", async () => {
    const output = view([user, { ordinal: 1, lastMethod: "item/started", item: {
      id: "reasoning", type: "reasoning", content: ["先核对信息。"], summary: [], availability: "available",
    } }]);
    const wrapper = mount(ChatTimeline, { props: { timeline: timeline(output), turnTimingLabels: { turn: "已处理 3s" } } });
    await wrapper.setProps({ timeline: timeline(view()) });
    expect(wrapper.find(".chat-turn-group__thinking .chat-thinking").exists()).toBe(false);
    expect(wrapper.get(".chat-turn-group__timing").text()).toBe("已处理 3s");
  });

  it("does not animate cold history, unavailable observations or ended turns", () => {
    const variants: [NativeConversationView, string | null][] = [
      [view(), null],
      [{ ...view(), source: "native_rebuilt", statusSource: "runtime_read" }, "turn"],
      [{ ...view(), diagnostic: "stream_gap" }, "turn"],
      [{ ...view(), availability: "unavailable" }, "turn"],
      ...(["completed", "failed", "interrupted"] as const).map(status =>
        [{ ...view(), status, terminalObserved: true }, "turn"] as [NativeConversationView, string]),
    ];
    for (const [native, live] of variants) {
      const wrapper = mount(ChatTimeline, { props: { timeline: timeline(native, live) } });
      expect(wrapper.find(".chat-turn-group__thinking .chat-thinking").exists()).toBe(false);
      wrapper.unmount();
    }
  });
});
