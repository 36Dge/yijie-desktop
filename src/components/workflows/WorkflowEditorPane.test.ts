// @vitest-environment happy-dom

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorChannelHooks } from "../../api/workflow-editor-channel";
import { WorkflowNativeError, type EditorOpenedView } from "../../api/workflow-native-client";
import WorkflowEditorPane from "./WorkflowEditorPane.vue";

const channels = vi.hoisted(() => ({ hooks: [] as EditorChannelHooks[], close: vi.fn() }));
vi.mock("../../api/workflow-editor-channel", () => ({
  WORKFLOW_EDITOR_URL: "about:blank",
  WorkflowEditorChannel: vi.fn(function (_frame: unknown, _view: unknown, _native: unknown, hooks: EditorChannelHooks) {
    channels.hooks.push(hooks);
    return { close: channels.close };
  }),
}));

// Ordinary source-shaped bootstrap/reconnect callbacks only. No actual iframe
// server, native command, clock advancement or credential is involved.
const view: EditorOpenedView = {
  protocol_version: 1, bridge_id: "ordinary-editor", generation: 1, expires_at_ms: Date.now() + 300_000,
  workflow: { workflow_id: "10001", name: "中文工作流", revision: "10002", canvas: '{"nodes":[],"edges":[]}', runnable: false, updated_at_ms: 1_800_000_000_000 },
};
let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); wrapper = undefined; channels.hooks.length = 0; vi.clearAllMocks(); });
const props = { view, reconnecting: false, closing: false, dirty: false, pendingWrites: 0, parentFailure: null };

describe("native Coze page carrier", () => {
  it("gives the full page to Coze while loading and expiry retain return and reconnect", async () => {
    wrapper = mount(WorkflowEditorPane, { props: { ...props, fullPage: true } });
    expect(wrapper.find("header").exists()).toBe(false);
    expect(wrapper.text()).toContain("返回工作流");
    const frame = wrapper.get("iframe");
    await frame.trigger("load");
    const binding = channels.hooks[channels.hooks.length - 1]!;
    binding.result({ request_id: "bootstrap-1", bootstrap: {
      workflow: view.workflow,
      principal: { owner_id: "local-owner", tenant_id: "local-tenant", user_id: "local-user", space_id: "local-space" },
      node_types: [1, 15, 2],
      limits: { input_bytes: 4096, prefix_bytes: 1024, output_bytes: 5120, canvas_bytes: 262144,
        message_bytes: 524288, max_active_runs: 1, execution_budget_seconds: 30, editor_ttl_seconds: 300 },
    } });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".workflow-editor-pane__overlay").exists()).toBe(false);
    expect(wrapper.find("header").exists()).toBe(false);
    binding.requestHistory();
    expect(wrapper.emitted("history")).toHaveLength(1);

    await wrapper.setProps({ parentFailure: new WorkflowNativeError("session_expired") });
    expect(wrapper.text()).toContain("当前画布和未保存内容仍保留");
    const reconnect = wrapper.findAll("button").find(button => button.text() === "重新连接")!;
    await reconnect.trigger("click");
    expect(wrapper.emitted("reconnect")).toHaveLength(1);
    await wrapper.findAll("button").find(button => button.text() === "返回工作流")!.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.setProps({ view: { ...view, bridge_id: "ordinary-reconnected", generation: 2 }, parentFailure: null, reconnecting: true });
    expect(wrapper.get("iframe").element).toBe(frame.element);
    binding.requestHistory();
    expect(wrapper.emitted("history")).toHaveLength(1);
  });

  it("keeps the existing embedded header and actions slot for non-full-page consumers", () => {
    wrapper = mount(WorkflowEditorPane, { props, slots: { actions: "原有嵌入操作" } });
    expect(wrapper.get("header").text()).toContain("返回工作流");
    expect(wrapper.get("h2").text()).toBe(view.workflow.name);
    expect(wrapper.get("header").text()).toContain("原有嵌入操作");
  });
});
