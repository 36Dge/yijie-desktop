// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
import { workflowNativeClient, WorkflowNativeError, type EditorOpenedView, type WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowLocalWorkspace from "./WorkflowLocalWorkspace.vue";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("vue-router", () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn(), useRouter: () => navigation }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// FEAT-154 consumer conformance uses normal source-defined states and ordinary
// client completions; no real IPC failure, iframe or network is created.
const workflowId = "7684526620584968192";
const workflow: WorkflowSchemas["Workflow"] = {
  workflow_id: workflowId,
  revision: "draft-after-publication",
  published_version: "v0.0.1",
  name: "普通文本工作流",
  canvas: '{"nodes":[],"edges":[]}',
  runnable: false,
  updated_at_ms: 1_800_000_000_000,
};
const view: EditorOpenedView = {
  bridge_id: "ordinary-editor-binding",
  generation: 1,
  protocol_version: 1,
  expires_at_ms: Date.now() + 300_000,
  workflow,
};
const status: WorkflowSchemas["ServiceStatus"] = {
  protocol_version: 1,
  run_epoch: "20000000-0000-4000-8000-000000000001",
  ready: true,
  state: "ready",
  limits: {
    input_bytes: 4096, prefix_bytes: 1024, output_bytes: 5120,
    canvas_bytes: 262144, message_bytes: 524288, max_active_runs: 1,
    execution_budget_seconds: 30, editor_ttl_seconds: 300,
  },
};

const EditorPane = defineComponent({
  name: "WorkflowEditorPane",
  emits: ["close", "history", "dirty"],
  setup(_props, { emit }) {
    return () => h("section", { "data-testid": "retained-editor" }, [
      h("button", { type: "button", onClick: () => emit("close") }, "返回工作流"),
      h("button", { type: "button", onClick: () => emit("history") }, "运行记录"),
    ]);
  },
});
const Dialog = defineComponent({
  name: "NModal",
  props: { show: Boolean, title: String },
  setup(props, { slots }) {
    return () => props.show
      ? h("div", { role: "dialog", "aria-label": props.title }, [slots["header-extra"]?.(), slots.default?.(), slots.action?.()])
      : null;
  },
});

it("shows no unavailable page or loading heading while the first open is still pending", async () => {
  let resolve!: (value: EditorOpenedView) => void;
  vi.spyOn(workflowNativeClient, "open").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  vi.spyOn(workflowNativeClient, "close").mockResolvedValue({ closed: true });
  wrapper = mount(WorkflowLocalWorkspace, { props: { workflowId }, global: { stubs: { WorkflowEditorPane: EditorPane, NModal: Dialog } } });
  await nextTick();
  expect(wrapper.find(".workflow-opening-placeholder").exists()).toBe(true);
  expect(wrapper.find("h1").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("暂时无法打开工作流");
  resolve(view);
  await flushPromises();
  expect(wrapper.find('[data-testid="retained-editor"]').exists()).toBe(true);
  expect(wrapper.find(".workflow-opening-placeholder").exists()).toBe(false);
});

it("ignores retired history actions, protects page-only design and closes only after explicit consent", async () => {
  vi.spyOn(workflowNativeClient, "status").mockResolvedValue(status);
  vi.spyOn(workflowNativeClient, "list").mockResolvedValue({ items: [workflow] });
  vi.spyOn(workflowNativeClient, "open").mockResolvedValue(view);
  vi.spyOn(workflowNativeClient, "query").mockResolvedValue({ history: { items: [] } });
  const exchange = vi.spyOn(workflowNativeClient, "exchange");
  const close = vi.spyOn(workflowNativeClient, "close")
    .mockRejectedValueOnce(new WorkflowNativeError("service_unavailable"))
    .mockResolvedValue({ closed: true });
  const run = vi.spyOn(workflowNativeClient, "run");
  wrapper = mount(WorkflowLocalWorkspace, { props: { workflowId }, global: { stubs: { WorkflowEditorPane: EditorPane, NModal: Dialog, Modal: Dialog } } });
  await flushPromises();
  const pane = wrapper.findComponent(EditorPane);
  const retainedElement = pane.element;
  pane.vm.$emit("dirty", true);
  await nextTick();
  const button = (label: string) => wrapper!.findAll("button").find(candidate => candidate.text() === label)!;

  await button("运行记录").trigger("click");
  await flushPromises();
  expect(wrapper.find('[aria-label="版本与运行记录"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("执行所选版本");
  expect(run).not.toHaveBeenCalled();
  expect(workflowNativeClient.query).not.toHaveBeenCalled();
  expect(exchange).not.toHaveBeenCalled();
  expect(wrapper.findComponent(EditorPane).element).toBe(retainedElement);

  const leave = vi.mocked(onBeforeRouteLeave).mock.calls[0]![0] as () => Promise<boolean>;
  const stay = leave();
  await nextTick();
  expect(wrapper.text()).toContain("本页节点配置");
  expect(wrapper.text()).toContain("离开将丢失未保存的修改");
  await button("继续编辑").trigger("click");
  await expect(stay).resolves.toBe(false);
  expect(close).not.toHaveBeenCalled();

  const firstClose = leave();
  await nextTick();
  await button("离开").trigger("click");
  await expect(firstClose).resolves.toBe(false);
  expect(wrapper.findComponent(EditorPane).element).toBe(retainedElement);
  const retry = leave();
  await nextTick();
  expect(wrapper.find('[aria-label="确认离开？"]').exists()).toBe(true);
  await button("离开").trigger("click");
  await expect(retry).resolves.toBe(true);
  expect(close).toHaveBeenCalledTimes(2);
  expect(workflowNativeClient.list).not.toHaveBeenCalled();
  expect(exchange).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("keeps a confirmed new workflow ID when opening fails and retries only that resource", async () => {
  vi.spyOn(workflowNativeClient, "status").mockResolvedValue(status);
  vi.spyOn(workflowNativeClient, "list").mockResolvedValue({ items: [workflow] });
  const create = vi.spyOn(workflowNativeClient, "create").mockResolvedValue(workflow);
  const open = vi.spyOn(workflowNativeClient, "open").mockRejectedValueOnce(new WorkflowNativeError("service_unavailable")).mockResolvedValue(view);
  vi.spyOn(workflowNativeClient, "query").mockResolvedValue({ history: { items: [] } });
  vi.spyOn(workflowNativeClient, "close").mockResolvedValue({ closed: true });
  wrapper = mount(WorkflowLocalWorkspace, { props: { workflowId }, global: { stubs: { WorkflowEditorPane: EditorPane, NModal: Dialog, Modal: Dialog } } });
  await flushPromises();
  expect(create).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledOnce();
  await wrapper.findAll("button").find(button => button.text() === "重新连接")!.trigger("click");
  await flushPromises();
  expect(open).toHaveBeenLastCalledWith({ workflow_id: workflowId });
  expect(open).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
  expect(wrapper.find('[data-testid="retained-editor"]').exists()).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});
