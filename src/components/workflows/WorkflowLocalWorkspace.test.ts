// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowNativeClient, WorkflowNativeError, type EditorOpenedView, type WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowLocalWorkspace from "./WorkflowLocalWorkspace.vue";

vi.mock("vue-router", () => ({ onBeforeRouteLeave: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// contract-impact=none: this component test changes no implementation, wire,
// persistence or native behavior. It supplies a source-defined unknown result
// to ordinary client mocks; no real IPC failure, iframe or network is created.
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
  emits: ["close"],
  setup(_props, { emit }) {
    return () => h("section", { "data-testid": "retained-editor" }, [
      h("button", { type: "button", onClick: () => emit("close") }, "返回工作流"),
    ]);
  },
});
const Dialog = defineComponent({
  name: "NModal",
  props: { show: Boolean },
  setup(props, { slots }) {
    return () => props.show
      ? h("div", { role: "dialog", "aria-label": "有未保存或待确认的内容" }, [slots.default?.(), slots.action?.()])
      : null;
  },
});
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("workflow unknown execution departure", () => {
  it("retains the page on continue, then closes and permits leaving only after explicit confirmation", async () => {
    vi.spyOn(workflowNativeClient, "status").mockResolvedValue(status);
    vi.spyOn(workflowNativeClient, "list").mockResolvedValue({ items: [workflow] });
    vi.spyOn(workflowNativeClient, "open").mockResolvedValue(view);
    vi.spyOn(workflowNativeClient, "query").mockResolvedValue({ history: { items: [] } });
    const close = vi.spyOn(workflowNativeClient, "close").mockResolvedValue({ closed: true });
    const run = vi.spyOn(workflowNativeClient, "run").mockRejectedValueOnce(new WorkflowNativeError("operation_unknown"));
    wrapper = mount(WorkflowLocalWorkspace, { global: { stubs: { WorkflowEditorPane: EditorPane, NModal: Dialog, Modal: Dialog } } });
    await flushPromises();
    const button = (label: string) => {
      const target = wrapper!.findAll("button").find(candidate => candidate.text() === label);
      expect(target, `button: ${label}`).toBeDefined();
      return target!;
    };
    await button("打开编辑器").trigger("click");
    await flushPromises();
    await wrapper.get("#workflow-run-input").setValue("普通输入");
    await wrapper.get("form.workflow-runs__form").trigger("submit");
    await flushPromises();
    expect(run).toHaveBeenCalledExactlyOnceWith({ workflow_id: workflowId, version: "v0.0.1", input: { input: "普通输入" } });
    expect(wrapper.text()).toContain("尚未取得可查询的操作标识");
    expect(button("执行所选版本").attributes("disabled")).toBeDefined();

    // Exercise the actual component's registered route guard, with its normal
    // two choices. The dialog substitute preserves show/slots, not focus/layout.
    const leave = vi.mocked(onBeforeRouteLeave).mock.calls[0]![0] as () => Promise<boolean>;
    const stay = leave();
    await nextTick();
    expect(wrapper.get('[role="dialog"]').text()).toContain("待确认操作的查询入口");
    await button("继续编辑").trigger("click");
    await expect(stay).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="retained-editor"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("尚未取得可查询的操作标识");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

    const depart = leave();
    await nextTick();
    expect(wrapper.get('[role="dialog"]').text()).toContain("已经提交的操作不会因此撤销");
    expect(wrapper.get('[role="dialog"]').text()).toContain("运行历史仍保留在服务端");
    await button("放弃本地内容并返回").trigger("click");
    await expect(depart).resolves.toBe(true);
    await flushPromises();
    expect(close).toHaveBeenCalledExactlyOnceWith({ bridge_id: view.bridge_id });
    expect(wrapper.find('[data-testid="retained-editor"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("我的工作流");
    expect(run).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
});
