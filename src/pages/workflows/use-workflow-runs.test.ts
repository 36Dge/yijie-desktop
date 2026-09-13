// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowNativeClient, WorkflowNativeError, type EditorOpenedView, type WorkflowNativeClient, type WorkflowSchemas } from "../../api/workflow-native-client";
import { useWorkflowRuns } from "./use-workflow-runs";

// Source-defined states and ordinary asynchronous completions only.
const id = "7684526620584968192", runId = "7684526620584968193";
const operationId = "10000000-0000-4000-8000-000000000001";
const view: EditorOpenedView = { bridge_id: "editor-one", generation: 1, protocol_version: 1, expires_at_ms: Date.now() + 300_000,
  workflow: { workflow_id: id, revision: "draft-b", published_version: "v0.0.2", name: "普通文本", canvas: "{}", runnable: true, updated_at_ms: 1_800_000_000_000 } };
const run = (overrides: Partial<WorkflowSchemas["Run"]> = {}): WorkflowSchemas["Run"] => ({ workflow_id: id, run_id: runId, operation_id: operationId, mode: "release", version: "v0.0.1", state: "succeeded", terminal: true, input: { input: "输入" }, output: "旧版本：输入", started_at_ms: 1_800_000_000_000, ...overrides });
const cleanup: (() => void)[] = [];
function harness() {
  const native = createWorkflowNativeClient(vi.fn());
  const query = vi.spyOn(native, "query").mockResolvedValue({ history: { items: [] } });
  const start = vi.spyOn(native, "run").mockResolvedValue(run());
  const editor = shallowRef<EditorOpenedView | null>(view);
  let state!: ReturnType<typeof useWorkflowRuns>;
  const wrapper = mount(defineComponent({ setup() { state = useWorkflowRuns(editor, native); return () => h("div"); } }));
  cleanup.push(() => wrapper.unmount());
  return { state, editor, query, start };
}
afterEach(() => { cleanup.splice(0).forEach(close => close()); });

describe("normal workflow execution and history", () => {
  it("executes the explicit old version and retains the provider result", async () => {
    const { state, start } = harness();
    await nextTick();
    state.version.value = "v0.0.1"; state.input.value = "输入";
    await state.start();
    expect(start).toHaveBeenCalledExactlyOnceWith({ workflow_id: id, version: "v0.0.1", input: { input: "输入" } });
    expect(state.selected.value?.output).toBe("旧版本：输入");
    expect(state.selected.value?.version).toBe("v0.0.1");
  });

  it("queries an unknown original operation without repeating execution or calling it successful", async () => {
    const { state, start, query } = harness();
    await nextTick();
    state.version.value = "v0.0.1";
    start.mockRejectedValueOnce(new WorkflowNativeError("operation_unknown", operationId));
    await state.start(); await state.start();
    expect(start).toHaveBeenCalledTimes(1);
    query.mockResolvedValueOnce({ receipt: { operation_id: operationId, kind: "run", phase: "recorded" } });
    await state.reconcile();
    expect(state.pending.value?.operationId).toBe(operationId);
    expect(state.selected.value).toBeNull();
    query.mockResolvedValueOnce({ receipt: { operation_id: operationId, kind: "run", phase: "completed", workflow_id: id, version: "v0.0.1", run_id: runId } });
    query.mockResolvedValueOnce({ run: run({ state: "running", terminal: false, output: undefined }) });
    await state.reconcile();
    expect(state.pending.value).toBeNull();
    expect(state.selected.value?.state).toBe("running");
    expect(state.activeRun.value?.run_id).toBe(runId);
    await state.start();
    expect(start).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ kind: "operation", operation_id: operationId });
    expect(query).toHaveBeenCalledWith({ kind: "run", workflow_id: id, run_id: runId });
  });

  it("allows explicit correction after source-defined rejection", async () => {
    const { state, start } = harness();
    await nextTick();
    state.version.value = "v0.0.3";
    start.mockRejectedValueOnce(new WorkflowNativeError("resource_not_found"));
    await state.start();
    expect(state.pending.value).toBeNull();
    expect(state.error.value?.code).toBe("resource_not_found");
    state.version.value = "v0.0.1";
    await state.start();
    expect(start).toHaveBeenCalledTimes(2);
    expect(state.selected.value?.state).toBe("succeeded");
  });

  it("does not let a late historical read replace a newly selected real run", async () => {
    const { state, query } = harness();
    await nextTick();
    let resolve!: (result: WorkflowSchemas["RunQueryResult"]) => void;
    query.mockReturnValueOnce(new Promise(complete => { resolve = complete; }));
    const reading = state.read("7684526620584968194");
    state.accept(run());
    resolve({ run: run({ run_id: "7684526620584968194" }) });
    await reading;
    expect(state.selected.value?.run_id).toBe(runId);
    expect(state.reading.value).toBe(false);
  });

  it("keeps history paging explicit and discards a closed workspace response", async () => {
    const { state, query, editor } = harness();
    await nextTick();
    query.mockResolvedValueOnce({ history: { items: [run()], next_cursor: "older" } });
    await state.refresh();
    query.mockResolvedValueOnce({ history: { items: [run({ run_id: "7684526620584968194" })] } });
    await state.refresh(true);
    expect(query).toHaveBeenLastCalledWith({ kind: "history", workflow_id: id, cursor: "older", limit: 20 });
    expect(state.history.value).toHaveLength(2);
    let resolve!: (result: WorkflowSchemas["RunQueryResult"]) => void;
    query.mockReturnValueOnce(new Promise(complete => { resolve = complete; }));
    const reading = state.read(runId);
    editor.value = null; await nextTick();
    resolve({ run: run() }); await reading;
    expect(state.selected.value).toBeNull();
    expect(state.history.value).toHaveLength(0);
  });

  it("marks an untyped IPC outcome as unknown for a dispatched version execution", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("IPC result unavailable"));
    const native: WorkflowNativeClient = createWorkflowNativeClient(invoke);
    await expect(native.run({ workflow_id: id, version: "v0.0.1", input: { input: "普通输入" } })).rejects.toMatchObject({ code: "operation_unknown" });
  });

  it("queues a fresh history read when a new run arrives during an older list request", async () => {
    const { state, query } = harness();
    await nextTick();
    let resolve!: (result: WorkflowSchemas["RunQueryResult"]) => void;
    query.mockReturnValueOnce(new Promise(complete => { resolve = complete; }));
    const oldList = state.refresh();
    state.accept(run());
    query.mockResolvedValueOnce({ history: { items: [run()] } });
    resolve({ history: { items: [] } });
    await oldList;
    await vi.waitFor(() => expect(state.history.value[0]?.run_id).toBe(runId));
    expect(query).toHaveBeenCalledTimes(3);
    expect(state.loading.value).toBe(false);
  });
});
