// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { useChatDelivery } from "./useChatDelivery";
const client = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn() }));
vi.mock("../api/chat-delivery-client", () => ({ chatDeliveryClient: client }));
const row = { operationId: "op", turnId: "turn", status: "never_sent", cancellable: true };
beforeEach(() => { vi.resetAllMocks(); client.read.mockResolvedValue([row]); client.cancel.mockResolvedValue(undefined); });
function fixture() {
  const session = ref("first"), allowed = ref(true), revision = ref("1"), after = vi.fn().mockResolvedValue(undefined);
  let model!: ReturnType<typeof useChatDelivery>;
  const wrapper = mount(defineComponent({ setup() { model = useChatDelivery(() => "scope", () => session.value, () => allowed.value, () => revision.value, after); return () => null; } }));
  return { session, allowed, revision, after, wrapper, get model() { return model; } };
}
it("refresh is read only and cancellation requires current proof and permission", async () => {
  const f = fixture(); try {
    await flushPromises(); await f.model.refresh(); expect(client.cancel).not.toHaveBeenCalled();
    f.allowed.value = false; await f.model.cancel("op"); expect(client.cancel).not.toHaveBeenCalled();
    f.allowed.value = true; client.read.mockResolvedValue([{ ...row, status: "unclassified", cancellable: false }]); await f.model.refresh(); await f.model.cancel("op"); expect(client.cancel).not.toHaveBeenCalled();
    client.read.mockResolvedValue([row]); await f.model.refresh(); await f.model.cancel("op");
    expect(client.cancel).toHaveBeenCalledExactlyOnceWith("scope", "first", row); expect(f.after).toHaveBeenCalledOnce(); expect(f.model.states.value).toEqual([]); expect(f.model.notice.value).toContain("原消息已保留");
  } finally { f.wrapper.unmount(); }
});
it("late cancellation cannot change another conversation", async () => {
  const f = fixture(); let resolve!: () => void; client.cancel.mockReturnValue(new Promise<void>(r => { resolve = r; }));
  try { await flushPromises(); const request = f.model.cancel("op"); f.session.value = "second"; await flushPromises(); resolve(); await request; expect(f.after).not.toHaveBeenCalled(); expect(f.model.notice.value).toBe(""); expect(f.model.states.value).toEqual([row]); } finally { f.wrapper.unmount(); }
});
it("failure clears stale cancel eligibility and never retries automatically", async () => {
  const f = fixture(); client.cancel.mockRejectedValue(new Error("unavailable"));
  try { await flushPromises(); await f.model.cancel("op"); expect(f.model.states.value).toEqual([]); expect(f.model.error.value).toContain("待核实"); await f.model.cancel("op"); expect(client.cancel).toHaveBeenCalledOnce(); expect(f.after).not.toHaveBeenCalled(); } finally { f.wrapper.unmount(); }
});
it("late reads cannot install proof after navigation or permission withdrawal", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  try { await flushPromises(); client.read.mockReturnValueOnce(new Promise(r => { resolve = r; })); const read = f.model.refresh(); f.session.value = "second"; client.read.mockResolvedValue([]); await flushPromises(); resolve([row]); await read; expect(f.model.states.value).toEqual([]); } finally { f.wrapper.unmount(); }
});
