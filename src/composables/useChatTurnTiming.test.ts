// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeTurnTiming } from "../api/generated/chat-turn-timing.gen";
import type { ConversationTimelineTurnViewModel } from "../domain/conversation-timeline";
import { useChatTurnTiming, useChatTurnTimingDetails } from "./useChatTurnTiming";
import { turnTimingLabel } from "../domain/chat-turn-timing";

const native = (duration?: number): NativeTurnTiming => ({
  schema_version: 1, agent_session_id: "session", thread_id: "thread", turn_id: "turn", source: "runtime_read",
  started_at: { state: "known", value: 100 },
  completed_at: duration === undefined ? { state: "unknown" } : { state: "known", value: 150 },
  duration_ms: duration === undefined ? { state: "unknown" } : { state: "known", value: duration },
});
const turn = (id = "turn", ended = false): ConversationTimelineTurnViewModel => ({
  identity: id, threadId: "session", turnId: id, ordinal: 0, domainStatus: ended ? "completed" : "in_progress",
  phase: ended ? "complete" : "active", terminalStatus: ended ? "completed" : null, terminalCode: null,
  plan: null, progress: null, notices: [], items: [], liveObserved: !ended, source: "native_observed", availability: "available",
});
function harness(read: (id: string, signal: AbortSignal) => Promise<NativeTurnTiming | null>, initial = [turn()]) {
  const scope = ref<string | null>("session");
  const turns = ref(initial);
  const wrapper = mount(defineComponent({
    setup: () => ({ labels: useChatTurnTiming({ scope: () => scope.value, turns: () => turns.value, read }) }),
    template: '<div>{{ labels }}</div>',
  }));
  return { wrapper, scope, turns };
}
afterEach(() => vi.useRealTimers());

describe("native turn duration", () => {
  it("shares the same native read for the elapsed label and completion timestamp", async () => {
    const read=vi.fn(async()=>native(51345));
    let details!: ReturnType<typeof useChatTurnTimingDetails>;
    const wrapper=mount(defineComponent({setup(){details=useChatTurnTimingDetails({scope:()=>"session",turns:()=>[turn("turn",true)],read});return ()=>null;}}));
    await flushPromises();
    expect(details.labels.value.turn).toBe("已完成 51s");
    expect(details.facts.value.turn?.completed_at).toEqual({state:"known",value:150});
    expect(read).toHaveBeenCalledTimes(1); wrapper.unmount();
  });
  it("ticks from native start without polling, then freezes to native duration rather than timestamp difference", async () => {
    vi.useFakeTimers(); vi.setSystemTime(160000);
    const read = vi.fn().mockResolvedValueOnce(native()).mockResolvedValueOnce(native(81345));
    const { wrapper, turns } = harness(read);
    await flushPromises();
    expect(wrapper.text()).toContain("执行 60s");
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain("执行 1m1s");
    expect(read).toHaveBeenCalledTimes(1);
    turns.value = [turn("turn", true)]; await flushPromises();
    expect(wrapper.text()).toContain("已完成 1m21s");
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("已完成 1m21s");
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not attach a late response to a new scope and aborts on unmount", async () => {
    let finish!: (fact: NativeTurnTiming) => void;
    const signals: AbortSignal[] = [];
    const read = vi.fn((_id: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<NativeTurnTiming>(resolve => { finish = resolve; });
    });
    const { wrapper, scope } = harness(read);
    const oldFinish = finish;
    scope.value = "another-session"; await flushPromises();
    expect(signals[0]!.aborted).toBe(true);
    oldFinish(native(12000)); await flushPromises();
    expect(wrapper.text()).not.toContain("12秒");
    wrapper.unmount();
    expect(signals[signals.length - 1]!.aborted).toBe(true);
  });

  it("bounds concurrent reads and retries unavailable timing only three times", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => null);
    const { wrapper } = harness(read);
    await flushPromises(); await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).not.toContain("0秒");
    wrapper.unmount();
    let finish!: (fact: NativeTurnTiming) => void;
    const pending = vi.fn(() => new Promise<NativeTurnTiming>(resolve => { finish = resolve; }));
    const batch = harness(pending, Array.from({length: 5}, (_, index) => turn(String(index), true)));
    expect(pending).toHaveBeenCalledTimes(2);
    finish(native(0)); await flushPromises();
    expect(pending).toHaveBeenCalledTimes(3);
    batch.wrapper.unmount();
  });

  it.each([
    [0, "0s"],
    [38_999, "38s"],
    [60_000, "60s"],
    [60_001, "1m0s"],
    [61_000, "1m1s"],
    [81_000, "1m21s"],
    [120_000, "2m0s"],
    [313_000, "5m13s"],
    [390_000, "6m30s"],
    [3_661_000, "61m1s"],
  ] as const)("formats a live or completed duration of %i ms as %s", (durationMs, expected) => {
    expect(turnTimingLabel(native(), true, 100_000 + durationMs, "in_progress")).toBe(`执行 ${expected}`);
    expect(turnTimingLabel(native(durationMs), false, 200000, "completed")).toBe(`已完成 ${expected}`);
  });

  it("preserves non-completed, missing, invalid and history timing semantics", () => {
    for (const status of ["failed", "interrupted", "unknown", "in_progress"] as const) {
      expect(turnTimingLabel(native(38000), false, 200000, status)).toBe("用时 38秒");
    }
    expect(turnTimingLabel(native(), false, 200000)).toBeNull();
    expect(turnTimingLabel(native(), true, 99000)).toBeNull();
    expect(turnTimingLabel({ ...native(), started_at: {state: "invalid"} }, true, 200000)).toBeNull();
    expect(turnTimingLabel({ ...native(), completed_at: {state: "known", value: 150} }, true, 200000)).toBeNull();
  });
});
