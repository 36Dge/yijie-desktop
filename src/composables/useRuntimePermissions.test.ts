// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPermissionState, RuntimeApproval } from "../api/runtime-permission-client";
import { useRuntimePermissions } from "./useRuntimePermissions";

const client = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), approvals: vi.fn(), decide: vi.fn() }));
vi.mock("../api/runtime-permission-client", () => ({ runtimePermissionClient: client }));
const ask: ChatPermissionState = { mode: "ask", busy: false, fullAccessConfirmed: false };
const request: RuntimeApproval = { id: "019c1a00-0000-7000-8000-000000000001", kind: "command", summary: "printf sample", scope: "/workspace", reason: "Sample", status: "pending" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const wrappers: ReturnType<typeof mount>[] = [];
function setup() {
  const session = ref<string | null>("task-a");
  let permissions!: ReturnType<typeof useRuntimePermissions>;
  wrappers.push(mount(defineComponent({ setup() { permissions = useRuntimePermissions(() => "context", () => session.value, () => false); return () => h("div"); } })));
  return { permissions, session };
}
beforeEach(() => { vi.resetAllMocks(); client.get.mockResolvedValue(ask); client.approvals.mockResolvedValue([]); });
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); });

describe("task permission synchronization", () => {
  it("keeps a failed decision visible until the pending action is resolved", async () => {
    client.approvals.mockResolvedValue([request]);
    const { permissions } = setup(); await flushPromises();
    client.decide.mockRejectedValue(new Error("temporarily unavailable"));
    await permissions.decide(request.id, "approve_once"); await flushPromises();
    expect(permissions.error.value).toContain("审批提交失败");
    expect(permissions.approvals.value[0]?.status).toBe("pending");
    expect(permissions.approvalsConnected.value).toBe(true);
    client.decide.mockResolvedValue({ ...request, status: "approved" });
    client.approvals.mockResolvedValue([{ ...request, status: "approved" }]);
    await permissions.decide(request.id, "approve_once"); await flushPromises();
    expect(permissions.error.value).toBeNull();
    expect(permissions.approvals.value[0]?.status).toBe("approved");
  });
  it("retains the last label but blocks sending when permission refresh fails", async () => {
    const { permissions } = setup(); await flushPromises();
    client.get.mockRejectedValue(new Error("temporarily unavailable"));
    await permissions.refresh();
    expect(permissions.state.value?.mode).toBe("ask");
    expect(permissions.ready.value).toBe(false);
  });
  it("discards the previous task's response when selection changes", async () => {
    const previous = deferred<ChatPermissionState>();
    client.get.mockReturnValueOnce(previous.promise).mockResolvedValue({ ...ask, mode: "auto" });
    const { permissions, session } = setup();
    session.value = "task-b";
    expect(permissions.ready.value).toBe(false);
    await flushPromises();
    expect(permissions.state.value?.mode).toBe("auto");
    previous.resolve(ask); await flushPromises();
    expect(permissions.state.value?.mode).toBe("auto");
  });

  it("rereads an uncertain save before allowing another submission", async () => {
    const { permissions } = setup(); await flushPromises();
    const reread = deferred<ChatPermissionState>();
    client.set.mockRejectedValue(new Error("response unavailable"));
    client.get.mockReturnValueOnce(reread.promise);
    await permissions.setMode("auto");
    expect(permissions.ready.value).toBe(false);
    reread.resolve({ ...ask, mode: "auto" }); await flushPromises();
    expect(permissions.state.value?.mode).toBe("auto");
    expect(permissions.ready.value).toBe(true);
  });

  it("blocks mode changes while pending and submits only one decision", async () => {
    client.approvals.mockResolvedValue([request]);
    const { permissions } = setup(); await flushPromises();
    await permissions.setMode("auto");
    expect(client.set).not.toHaveBeenCalled();
    const reply = deferred<RuntimeApproval>(); client.decide.mockReturnValue(reply.promise);
    const first = permissions.decide(request.id, "approve_once");
    await permissions.decide(request.id, "approve_once");
    expect(client.decide).toHaveBeenCalledTimes(1);
    client.approvals.mockResolvedValue([{ ...request, status: "approved" }]);
    reply.resolve({ ...request, status: "approved" }); await first; await flushPromises();
    expect(permissions.busy.value).toBe(false);
  });

  it("disables approval decisions when their authoritative snapshot is unavailable", async () => {
    client.approvals.mockResolvedValueOnce([request]);
    const { permissions } = setup(); await flushPromises();
    client.approvals.mockRejectedValue(new Error("temporarily unavailable"));
    await permissions.refresh(); await permissions.decide(request.id, "approve_once");
    expect(permissions.ready.value).toBe(false);
    expect(client.decide).not.toHaveBeenCalled();
  });
});
