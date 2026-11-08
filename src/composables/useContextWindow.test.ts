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
    expect(read).toHaveBeenLastCalledWith("scope", "session-a", true);
    read.mockResolvedValue({ ...value(), sample: null, compactions: [{ turn_id: "turn", item_id: "native-compact", state: "in_progress" }] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenLastCalledWith("scope", "session-a", false);
    expect(h.state.sample.value).toBeNull();
    expect(h.state.compactionSnapshot.value?.compactions[0]?.state).toBe("in_progress");
    h.wrapper.unmount(); await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("clears on model selection and rejects old profile/revision values", async () => {
    vi.useFakeTimers(); read.mockResolvedValue(value());
    const h = setup(); await flushPromises();
    h.switching.value = true;
    expect(h.state.sample.value).toBeNull();
    h.model.value = "second"; h.revision.value = 2; h.switching.value = false;
    await flushPromises(); expect(h.state.sample.value).toBeNull();
    read.mockResolvedValue(value("second", 2)); await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.sample.value?.used_tokens).toBe(143000);
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
