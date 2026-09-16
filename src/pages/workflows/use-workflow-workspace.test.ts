// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowNativeClient,
  WorkflowNativeError,
  type EditorOpenedView,
  type Workflow,
  type WorkflowNativeClient,
  type WorkflowSchemas,
} from "../../api/workflow-native-client";
import {
  WorkflowEditorChannel,
  WORKFLOW_EDITOR_ORIGIN,
  WORKFLOW_EDITOR_URL,
  validEditorEnvelope,
  type EditorChannelHooks,
} from "../../api/workflow-editor-channel";
import type { WorkflowEditorBridgeV1 } from "../../domain/workflow-editor-bridge.generated";
import { useWorkflowWorkspace } from "./use-workflow-workspace";

// Only normal asynchronous client completions and source-defined operation
// states are supplied here. No real HTTP/native App, expiry timer advancement,
// process failure, permission changes or attack resources are exercised.
const WORKFLOW_A = "7684523784379826176";
const WORKFLOW_B = "7684523784379826177";
const OPERATION_ID = "10000000-0000-4000-8000-000000000001";
const RUN_EPOCH = "20000000-0000-4000-8000-000000000001";
const cleanup: Array<() => void> = [];

it("creates confirmed metadata without opening a session in the departing overview", async () => {
  const native = nativeClient();
  const state = workspaceHarness(native);
  expect(await state.create(" 中文流程 ", " 本地用途 ", false)).toBe(true);
  expect(native.create).toHaveBeenCalledExactlyOnceWith({ name: "中文流程", description: "本地用途" });
  expect(state.createdWorkflowId.value).toBe(WORKFLOW_A);
  expect(native.open).not.toHaveBeenCalled();
});

it("queries an uncertain modal creation without duplicate writes or opening a departing session", async () => {
  const native = nativeClient();
  native.create.mockRejectedValueOnce(new WorkflowNativeError("operation_unknown", OPERATION_ID));
  const state = workspaceHarness(native);
  await state.create("中文流程", "说明", false);
  await state.create("中文流程", "说明", false);
  expect(native.create).toHaveBeenCalledOnce();
  native.query.mockResolvedValueOnce({ receipt: { operation_id: OPERATION_ID, kind: "create", phase: "completed", workflow_id: WORKFLOW_A } });
  await state.queryPendingCreate(false);
  expect(state.createdWorkflowId.value).toBe(WORKFLOW_A);
  expect(native.open).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function workflow(id = WORKFLOW_A): Workflow {
  return {
    workflow_id: id, name: "普通文本工作流", revision: "7684523784379826178",
    canvas: '{"nodes":[],"edges":[]}', runnable: false, updated_at_ms: 1_800_000_000_000,
  };
}

function opened(id = WORKFLOW_A, generation = 1): EditorOpenedView {
  return {
    bridge_id: "bridge-" + id + "-" + generation, workflow: workflow(id),
    generation, expires_at_ms: Date.now() + 300_000, protocol_version: 1,
  };
}

function nativeClient() {
  const status: WorkflowSchemas["ServiceStatus"] = {
    protocol_version: 1, run_epoch: RUN_EPOCH, ready: true, state: "ready",
    limits: {
      input_bytes: 4096, prefix_bytes: 1024, output_bytes: 5120, canvas_bytes: 262144,
      message_bytes: 524288, max_active_runs: 1, execution_budget_seconds: 30,
      editor_ttl_seconds: 300,
    },
  };
  return {
    status: vi.fn<WorkflowNativeClient["status"]>().mockResolvedValue(status),
    list: vi.fn<WorkflowNativeClient["list"]>().mockResolvedValue({ items: [] }),
    delete: vi.fn<WorkflowNativeClient["delete"]>(),
    create: vi.fn<WorkflowNativeClient["create"]>().mockResolvedValue(workflow()),
    open: vi.fn<WorkflowNativeClient["open"]>().mockImplementation(async request => opened(request.workflow_id)),
    exchange: vi.fn<WorkflowNativeClient["exchange"]>().mockImplementation(async request => ({ request_id: request.request_id, workflow: workflow() })),
    close: vi.fn<WorkflowNativeClient["close"]>().mockResolvedValue({ closed: true }),
    run: vi.fn<WorkflowNativeClient["run"]>(),
    query: vi.fn<WorkflowNativeClient["query"]>().mockResolvedValue({ receipt: { operation_id: OPERATION_ID, kind: "create", phase: "recorded" } }),
  };
}

function workspaceHarness(native: WorkflowNativeClient) {
  let workspace!: ReturnType<typeof useWorkflowWorkspace>;
  const wrapper = mount(defineComponent({
    setup() {
      workspace = useWorkflowWorkspace(native);
      return () => h("div");
    },
  }));
  cleanup.push(() => wrapper.unmount());
  return workspace;
}

function channelHarness(view: EditorOpenedView, native: WorkflowNativeClient, hooks: EditorChannelHooks) {
  // A normal frame transport mock transfers the real MessagePort without
  // invoking happy-dom's iframe page loader or making any network request.
  const post = vi.fn<(message: unknown, origin: string, transfer?: Transferable[]) => void>();
  const frame = { src: WORKFLOW_EDITOR_URL, contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
  const channel = new WorkflowEditorChannel(frame, view, native, hooks);
  const [connect, origin, transfer] = post.mock.calls[0]!;
  const peer = transfer![0] as MessagePort;
  cleanup.push(() => { channel.close(); peer.close(); });
  return { channel, peer, connect, origin };
}

function hooks(): EditorChannelHooks {
  return { ready: vi.fn(), dirty: vi.fn(), requestClose: vi.fn(), requestHistory: vi.fn(), result: vi.fn(), failure: vi.fn(), busy: vi.fn() };
}

function notification(view: EditorOpenedView, kind: "ready" | "request_close" | "request_history"): WorkflowEditorBridgeV1 {
  return { kind, protocol_version: 1, request_id: crypto.randomUUID(), bridge_id: view.bridge_id, generation: view.generation };
}

afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
});

describe("FEAT-153 normal workspace transitions", () => {
  it("waits for the cancelled A open to close before allowing B to open", async () => {
    const native = nativeClient();
    const openingA = deferred<EditorOpenedView>();
    const closingA = deferred<WorkflowSchemas["CloseResult"]>();
    native.open.mockReturnValueOnce(openingA.promise);
    native.close.mockReturnValueOnce(closingA.promise);
    const state = workspaceHarness(native);

    const opening = state.openWorkflow(WORKFLOW_A);
    const cancellation = state.cancelOpening();
    let cancelled = false;
    void cancellation.then(() => { cancelled = true; });
    expect(state.opening.value).toBe(false);
    expect(state.openPending.value).toBe(true);
    await state.openWorkflow(WORKFLOW_B);
    expect(native.open).toHaveBeenCalledTimes(1);

    const a = opened();
    openingA.resolve(a);
    await vi.waitFor(() => expect(native.close).toHaveBeenCalledWith({ bridge_id: a.bridge_id }));
    expect(state.editor.value).toBeNull();
    expect(cancelled).toBe(false);
    expect(state.openPending.value).toBe(true);
    await state.openWorkflow(WORKFLOW_B);
    expect(native.open).toHaveBeenCalledTimes(1);

    closingA.resolve({ closed: true });
    await Promise.all([opening, cancellation]);
    expect(cancelled).toBe(true);
    expect(state.openPending.value).toBe(false);
    await state.openWorkflow(WORKFLOW_B);
    expect(native.open).toHaveBeenLastCalledWith({ workflow_id: WORKFLOW_B });
    expect(state.editor.value?.workflow.workflow_id).toBe(WORKFLOW_B);
  });

  it("keeps an uncertain create operation queryable and opens only its completed resource", async () => {
    const native = nativeClient();
    // This is an ordinary source-defined operation state, not a transport fault.
    native.create.mockRejectedValueOnce(new WorkflowNativeError("operation_unknown", OPERATION_ID));
    const state = workspaceHarness(native);
    expect(await state.create(" 普通文本工作流 ")).toBe(false);
    expect(native.create).toHaveBeenCalledWith({ name: "普通文本工作流" });
    expect(state.pendingCreate.value).toBe(OPERATION_ID);
    expect(state.createUncertain.value).toBe(true);
    expect(await state.create("普通文本工作流")).toBe(false);
    expect(native.create).toHaveBeenCalledTimes(1);

    await state.queryPendingCreate();
    expect(native.query).toHaveBeenLastCalledWith({ kind: "operation", operation_id: OPERATION_ID });
    expect(native.query.mock.calls[0]![0]).not.toHaveProperty("limit");
    expect(state.pendingCreate.value).toBe(OPERATION_ID);
    expect(state.createUncertain.value).toBe(true);
    expect(native.open).not.toHaveBeenCalled();

    native.query.mockResolvedValueOnce({ receipt: {
      operation_id: OPERATION_ID, kind: "create", phase: "completed", workflow_id: WORKFLOW_A,
    } });
    await state.queryPendingCreate();
    expect(native.query).toHaveBeenCalledTimes(2);
    expect(state.pendingCreate.value).toBeNull();
    expect(state.createUncertain.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.open).toHaveBeenCalledExactlyOnceWith({ workflow_id: WORKFLOW_A });
  });

  it("blocks reconnect while a normal channel save is pending, then preserves dirty state on reconnect", async () => {
    const native = nativeClient();
    const state = workspaceHarness(native);
    await state.openWorkflow(WORKFLOW_A);
    state.dirty.value = true;
    const view = state.editor.value!;
    const save = deferred<WorkflowSchemas["EditorExchangeResult"]>();
    native.exchange.mockReturnValueOnce(save.promise);
    const events = hooks();
    events.busy = writes => { state.pendingWrites.value = writes; };
    const { peer } = channelHarness(view, native, events);
    peer.postMessage(notification(view, "ready"));
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledOnce());
    const requestId = crypto.randomUUID();
    const request: WorkflowSchemas["EditorExchangeInput"] = {
      protocol_version: 1, request_id: requestId, bridge_id: view.bridge_id,
      generation: view.generation, operation: "save_draft", name: view.workflow.name,
      canvas: view.workflow.canvas, expected_revision: view.workflow.revision,
    };
    peer.postMessage({ kind: "request", protocol_version: 1, request_id: requestId,
      bridge_id: view.bridge_id, generation: view.generation, request } satisfies WorkflowEditorBridgeV1);
    await vi.waitFor(() => expect(state.pendingWrites.value).toBe(1));
    await state.openWorkflow(WORKFLOW_A, true);
    expect(native.open).toHaveBeenCalledTimes(1);
    expect(state.reconnecting.value).toBe(false);
    expect(state.editor.value?.bridge_id).toBe(view.bridge_id);

    save.resolve({ request_id: requestId, operation_id: OPERATION_ID, workflow: workflow() });
    await vi.waitFor(() => expect(state.pendingWrites.value).toBe(0));
    expect(events.failure).not.toHaveBeenCalled();
    native.open.mockResolvedValueOnce(opened(WORKFLOW_A, 2));
    await state.openWorkflow(WORKFLOW_A, true);
    expect(native.open).toHaveBeenCalledTimes(2);
    expect(state.editor.value?.generation).toBe(2);
    expect(state.dirty.value).toBe(true);
  });
});

describe("FEAT-153 generated native request boundary", () => {
  it("accepts an operation query without injecting the history-only default limit", async () => {
    const result: WorkflowSchemas["RunQueryResult"] = { receipt: {
      operation_id: OPERATION_ID, kind: "create", phase: "recorded",
    } };
    const invoke = vi.fn().mockResolvedValue(result);
    const native = createWorkflowNativeClient(invoke);
    const input: WorkflowSchemas["RunQueryInput"] = { kind: "operation", operation_id: OPERATION_ID };
    expect(await native.query(input)).toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("workflow_run_query", { request: input });
    expect(input).not.toHaveProperty("limit");
  });

  it("preserves the source operation ID while mapping an unknown result to fixed UI text", async () => {
    const response: WorkflowSchemas["ErrorResponse"] = {
      code: "operation_unknown", message: "The registered operation is not yet reconciled.", operation_id: OPERATION_ID,
    };
    const native = createWorkflowNativeClient(vi.fn().mockRejectedValue(response));
    await expect(native.create({ name: "普通文本工作流" })).rejects.toMatchObject({
      code: "operation_unknown", operationId: OPERATION_ID,
      message: "操作结果尚不确定，请先查询原操作，避免重复提交。",
    });
  });
});

describe("FEAT-153 normal editor MessageChannel", () => {
  it("reprojects page-only protection after reconnect without saving or treating history as busy", async () => {
    const native = nativeClient();
    const state = workspaceHarness(native);
    await state.openWorkflow(WORKFLOW_A);
    const events = hooks();
    events.dirty = vi.fn(value => { state.dirty.value = value; });
    const firstView = state.editor.value!;
    const first = channelHarness(firstView, native, events);
    first.peer.postMessage(notification(firstView, "ready"));
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledOnce());
    const protectedPage = (view: EditorOpenedView) => ({ kind: "dirty_changed" as const,
      protocol_version: 1 as const, request_id: crypto.randomUUID(), bridge_id: view.bridge_id,
      generation: view.generation, dirty: true });
    first.peer.postMessage(protectedPage(firstView));
    await vi.waitFor(() => expect(state.dirty.value).toBe(true));
    first.channel.close();
    native.open.mockResolvedValueOnce(opened(WORKFLOW_A, 2));
    await state.openWorkflow(WORKFLOW_A, true);
    expect(state.dirty.value).toBe(true);
    const secondView = state.editor.value!;
    const secondEvents = hooks();
    secondEvents.dirty = vi.fn(value => { state.dirty.value = value; });
    const second = channelHarness(secondView, native, secondEvents);
    second.peer.postMessage(notification(secondView, "ready"));
    await vi.waitFor(() => expect(secondEvents.ready).toHaveBeenCalledOnce());
    second.peer.postMessage(protectedPage(secondView));
    second.peer.postMessage(notification(secondView, "request_history"));
    await vi.waitFor(() => expect(secondEvents.requestHistory).toHaveBeenCalledOnce());
    expect(secondEvents.dirty).toHaveBeenCalledExactlyOnceWith(true);
    expect(state.dirty.value).toBe(true);
    expect(native.exchange).not.toHaveBeenCalled();
    expect(native.run).not.toHaveBeenCalled();
    expect(secondEvents.busy).not.toHaveBeenCalled();
  });

  it("opens history only from a ready current port and keeps it independent of native editor writes", async () => {
    const view = opened();
    const native = nativeClient();
    const events = hooks();
    const { peer, channel } = channelHarness(view, native, events);
    peer.postMessage(notification(view, "request_history"));
    peer.postMessage(notification(view, "ready"));
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledOnce());
    expect(events.requestHistory).not.toHaveBeenCalled();
    peer.postMessage(notification(view, "request_history"));
    await vi.waitFor(() => expect(events.requestHistory).toHaveBeenCalledOnce());
    expect(native.exchange).not.toHaveBeenCalled();
    expect(native.query).not.toHaveBeenCalled();
    expect(events.busy).not.toHaveBeenCalled();
    expect(events.failure).not.toHaveBeenCalled();

    channel.close();
    const nextView = opened(WORKFLOW_A, 2);
    const nextEvents = hooks();
    const next = channelHarness(nextView, native, nextEvents);
    // A normal queued notification from the closed prior editor cannot open
    // the new editor's history panel; no real transport fault is manufactured.
    peer.postMessage(notification(view, "request_history"));
    next.peer.postMessage(notification(nextView, "ready"));
    await vi.waitFor(() => expect(nextEvents.ready).toHaveBeenCalledOnce());
    expect(events.requestHistory).toHaveBeenCalledOnce();
    expect(nextEvents.requestHistory).not.toHaveBeenCalled();
    next.peer.postMessage(notification(nextView, "request_history"));
    await vi.waitFor(() => expect(nextEvents.requestHistory).toHaveBeenCalledOnce());
  });

  it("uses the source handshake and forwards ordinary dirty/close notifications", async () => {
    const view = opened();
    const native = nativeClient();
    const events = hooks();
    const { peer, connect, origin } = channelHarness(view, native, events);
    expect(origin).toBe(WORKFLOW_EDITOR_ORIGIN);
    expect(validEditorEnvelope(connect)).toBe(true);
    expect(connect).toMatchObject({ kind: "connect", protocol_version: 1,
      bridge_id: view.bridge_id, generation: view.generation });
    peer.postMessage(notification(view, "ready"));
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledOnce());
    peer.postMessage({ kind: "dirty_changed", protocol_version: 1, request_id: crypto.randomUUID(),
      bridge_id: view.bridge_id, generation: view.generation, dirty: true } satisfies WorkflowEditorBridgeV1);
    peer.postMessage(notification(view, "request_close"));
    await vi.waitFor(() => expect(events.requestClose).toHaveBeenCalledOnce());
    expect(events.dirty).toHaveBeenCalledExactlyOnceWith(true);
    expect(native.exchange).not.toHaveBeenCalled();
    expect(events.failure).not.toHaveBeenCalled();
  });

  it("returns a normal read result on the same source request and generation", async () => {
    const view = opened();
    const native = nativeClient();
    const events = hooks();
    const { peer } = channelHarness(view, native, events);
    const reply = deferred<unknown>();
    peer.onmessage = event => reply.resolve(event.data);
    peer.start();
    peer.postMessage(notification(view, "ready"));
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledOnce());
    const requestId = crypto.randomUUID();
    const request: WorkflowSchemas["EditorExchangeInput"] = {
      protocol_version: 1, request_id: requestId, bridge_id: view.bridge_id,
      generation: view.generation, operation: "read_draft",
    };
    peer.postMessage({ kind: "request", protocol_version: 1, request_id: requestId,
      bridge_id: view.bridge_id, generation: view.generation, request } satisfies WorkflowEditorBridgeV1);
    const response = await reply.promise;
    expect(validEditorEnvelope(response)).toBe(true);
    expect(response).toEqual({ kind: "response", protocol_version: 1, request_id: requestId,
      bridge_id: view.bridge_id, generation: view.generation,
      response: { request_id: requestId, workflow: workflow() } });
    expect(native.exchange).toHaveBeenCalledExactlyOnceWith(request);
    expect(events.result).toHaveBeenCalledOnce();
    expect(events.busy).not.toHaveBeenCalledWith(1);
    expect(events.failure).not.toHaveBeenCalled();
  });
});
