// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowEditorSession } from "./workflow-editor-session";
import { WorkflowNativeError, type EditorOpenedView, type WorkflowNativeClient, type WorkflowSchemas } from "./workflow-native-client";

// Normal virtual time and source-defined responses in memory only. No live
// credential expiry, process interruption, permission changes or fault injection.
const workflow = { workflow_id: "10001", name: "普通工作流", revision: "10002", canvas: '{"nodes":[],"edges":[]}', runnable: false, updated_at_ms: 1_800_000_000_000 };
const opened = (generation = 1): EditorOpenedView => ({ protocol_version: 1, bridge_id: `bridge-${generation}`, generation, expires_at_ms: Date.now() + 300_000, workflow });
const sessions: WorkflowEditorSession[] = [];
function harness() {
  const initial = opened();
  let generation = 1;
  const native = {
    open: vi.fn<WorkflowNativeClient["open"]>().mockImplementation(async () => opened(++generation)),
    close: vi.fn<WorkflowNativeClient["close"]>().mockResolvedValue({ closed: true }),
    exchange: vi.fn<WorkflowNativeClient["exchange"]>().mockImplementation(async request => ({ request_id: request.request_id, workflow })),
  };
  const renewed = vi.fn();
  const failed = vi.fn();
  const session = new WorkflowEditorSession(initial, native as unknown as WorkflowNativeClient, renewed, failed);
  sessions.push(session);
  session.start();
  const request = (operation: "read_draft" | "save_draft" = "read_draft"): WorkflowSchemas["EditorExchangeInput"] => ({ protocol_version: 1, bridge_id: initial.bridge_id, generation: initial.generation, request_id: crypto.randomUUID(), operation });
  return { session, native, renewed, failed, request };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T12:00:00Z")); });
afterEach(() => { sessions.splice(0).forEach(session => session.close()); vi.useRealTimers(); });

describe("page-long workflow connection", () => {
  it("quietly renews while idle for multiple credential lifetimes and maps requests to the current native binding", async () => {
    const { native, renewed, failed, session, request } = harness();
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    expect(native.open).toHaveBeenCalledTimes(3);
    expect(native.open).toHaveBeenLastCalledWith({ workflow_id: workflow.workflow_id });
    expect(failed).not.toHaveBeenCalled();
    expect(renewed).toHaveBeenCalledTimes(3);
    const input = request();
    const response = await session.exchange(input);
    expect(response.request_id).toBe(input.request_id);
    expect(native.exchange).toHaveBeenCalledExactlyOnceWith({ ...input, bridge_id: "bridge-4", generation: 4 });
    expect(input.bridge_id).toBe("bridge-1");
  });

  it("finishes a dispatched save before rotating and queues the next read behind renewal", async () => {
    const { native, session, request } = harness();
    let finishSave!: (value: WorkflowSchemas["EditorExchangeResult"]) => void;
    native.exchange.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    await vi.advanceTimersByTimeAsync(239_000);
    const input = request("save_draft");
    const save = session.exchange(input);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(native.open).not.toHaveBeenCalled();
    const next = request();
    const read = session.exchange(next);
    finishSave({ request_id: input.request_id, workflow });
    await Promise.all([save, read]);
    expect(native.open).toHaveBeenCalledOnce();
    expect(native.exchange).toHaveBeenNthCalledWith(1, input);
    expect(native.exchange).toHaveBeenNthCalledWith(2, { ...next, bridge_id: "bridge-2", generation: 2 });
  });

  it("refreshes before the first request after normal sleep and does not replay uncertain writes", async () => {
    const { native, session, request } = harness();
    vi.setSystemTime(Date.now() + 20 * 60_000);
    const input = request("save_draft");
    native.exchange.mockRejectedValueOnce(new WorkflowNativeError("operation_unknown", "10000000-0000-4000-8000-000000000001"));
    await expect(session.exchange(input)).rejects.toMatchObject({ code: "operation_unknown" });
    expect(native.open).toHaveBeenCalledOnce();
    expect(native.exchange).toHaveBeenCalledOnce();
  });

  it("recovers a typed preflight expiry once without changing the operation ID", async () => {
    const { native, session, request } = harness();
    const input = { ...request("save_draft"), operation_id: "10000000-0000-4000-8000-000000000001" };
    native.exchange.mockRejectedValueOnce(new WorkflowNativeError("session_expired"));
    await session.exchange(input);
    expect(native.open).toHaveBeenCalledOnce();
    expect(native.exchange).toHaveBeenLastCalledWith({ ...input, bridge_id: "bridge-2", generation: 2 });
  });

  it("stops on leave and normally closes an already-opening credential when its result arrives", async () => {
    const { native, session, renewed } = harness();
    let finishOpen!: (value: EditorOpenedView) => void;
    native.open.mockImplementationOnce(() => new Promise(resolve => { finishOpen = resolve; }));
    await vi.advanceTimersByTimeAsync(240_000);
    session.close();
    finishOpen(opened(2));
    await vi.advanceTimersByTimeAsync(900_000);
    expect(native.close).toHaveBeenCalledExactlyOnceWith({ bridge_id: "bridge-2" });
    expect(renewed).not.toHaveBeenCalled();
    expect(native.open).toHaveBeenCalledOnce();
  });

  it("surfaces a real reconnect rejection without retrying indefinitely", async () => {
    const { native, failed } = harness();
    native.open.mockRejectedValueOnce(new WorkflowNativeError("unauthorized"));
    await vi.advanceTimersByTimeAsync(900_000);
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "unauthorized" }));
    expect(native.open).toHaveBeenCalledOnce();
  });
});
