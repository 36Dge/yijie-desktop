// @vitest-environment happy-dom
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContextWindow } from "./useContextWindow";
import { readContextWindow, type ContextWindowSnapshot } from "../api/context-window-client";
vi.mock("../api/context-window-client", () => ({ readContextWindow: vi.fn() }));
const read = vi.mocked(readContextWindow);
const value = (model = "first", revision = 1): ContextWindowSnapshot => ({ schema_version: 1, thread_id: "native-thread", model_profile: model, model_revision: revision, sample: { used_tokens: 143000, capacity_tokens: 730000, turn_id: "turn", window_id: "window", observed_at: "2026-11-08T12:00:00Z" }, compactions: [] });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

function setup() {
  const session = ref<string | null>("session-a"), model = ref("first"), revision = ref(1), switching = ref(false);
  let state!: ReturnType<typeof useContextWindow>;
  const wrapper = mount(defineComponent({ setup() { state = useContextWindow(() => "scope", () => session.value, () => model.value, () => revision.value, () => switching.value); return () => null; } }));
  return { state, wrapper, session, model, revision, switching };
}
describe("context observation lifecycle", () => {
  it("reads history once and follows native statistics without model commands", async () => {
    vi.useFakeTimers(); read.mockResolvedValue(value());
    const h = setup(); await flushPromises();
    expect(h.state.sample.value?.used_tokens).toBe(143000);
    expect(read).toHaveBeenLastCalledWith("scope", "session-a", true, true);
    read.mockResolvedValue({ ...value(), sample: null, compactions: [{ turn_id: "turn", item_id: "native-compact", state: "in_progress" }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenLastCalledWith("scope", "session-a", false, true);
    expect(h.state.sample.value).toBeNull();
    expect(h.state.compactionSnapshot.value?.compactions[0]?.state).toBe("in_progress");
    h.wrapper.unmount(); await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("keeps the measured source through model selection until the new model reports its own usage", async () => {
    vi.useFakeTimers(); read.mockResolvedValue(value());
    const h = setup(); await flushPromises();
    h.switching.value = true;
    expect(h.state.sample.value).toEqual(value().sample);
    expect(h.state.lastModel.value).toBe("first");
    h.model.value = "second"; h.revision.value = 2; h.switching.value = false;
    await flushPromises();
    expect(h.state.lastModel.value).toBe("first");
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({ ...value("second", 2), sample: null, last_observation: { model: "first", sample: value().sample! } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.sample.value).toEqual(value().sample);
    expect(h.state.lastModel.value).toBe("first");
    read.mockResolvedValue({ ...value("second", 2), sample: { ...value().sample!, used_tokens: 18000, capacity_tokens: 950000 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.sample.value).toMatchObject({ used_tokens: 18000, capacity_tokens: 950000 });
    expect(h.state.lastModel.value).toBeNull();
    h.wrapper.unmount();
  });
  it("restores a prior observation on first read and discards it on a real window invalidation or loss of scope", async () => {
    vi.useFakeTimers();
    const previous = { ...value().sample!, used_tokens: 0, capacity_tokens: null };
    const restored = { ...value("second", 2), sample: null, last_observation: { model: "first", sample: previous } };
    read.mockResolvedValue(restored);
    const h = setup(); await flushPromises();
    expect(h.state.sample.value).toEqual(previous);
    expect(h.state.lastModel.value).toBe("first");
    read.mockResolvedValue({ ...value("second", 2), sample: null, compactions: [{turn_id:"turn", item_id:"compact", state:"in_progress"}] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.sample.value).toBeNull();
    read.mockResolvedValue(restored);
    await vi.advanceTimersByTimeAsync(1000);
    h.session.value = null;
    expect(h.state.sample.value).toBeNull();
    expect(h.state.lastModel.value).toBeNull();
    h.wrapper.unmount();
  });
  it("rejects late responses after switching chat and reports read errors as unknown", async () => {
    vi.useFakeTimers();
    let resolve!: (value: ContextWindowSnapshot) => void;
    read.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ...value(), sample: null });
    const h = setup(); h.session.value = "session-b"; await flushPromises();
    resolve(value()); await flushPromises(); expect(h.state.sample.value).toBeNull();
    read.mockRejectedValueOnce(new Error("ordinary unavailable")); await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.snapshot.value).toBeNull();
    h.wrapper.unmount();
  });
});
