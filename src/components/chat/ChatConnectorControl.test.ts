// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectorView } from "../../domain/connector-ui";
import ChatConnectorControl from "./ChatConnectorControl.vue";

const entry: ConnectorView = { id: "sample", name: "普通合成服务", description: "组件验证", iconAssetId: "cue", categoryId: "productivity", categoryLabel: "效率工具", installed: true, enabled: true, selectable: true, status: { label: "已启用", tone: "success" }, explanation: null, configurationLabel: "", busy: false, actions: ["disable", "uninstall"] };
const wrappers: ReturnType<typeof mount>[] = [];
function setup(entries: ConnectorView[] = [entry]) {
  const wrapper = mount(ChatConnectorControl, { attachTo: document.body, props: { entries, selectedIds: [], selectionAvailable: true, canManage: true } }); wrappers.push(wrapper); return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; });

describe("chat connector conversation selection", () => {
  it("controls conversation selection independently of the globally enabled connection", async () => {
    const wrapper = setup();
    const control = wrapper.get('[role="switch"]');
    expect(control.attributes("aria-checked")).toBe("false");
    await wrapper.get('[data-connector-option]').trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([["sample", true]]);
    expect(wrapper.emitted("enabled-change")).toBeUndefined();
    await wrapper.setProps({ selectedIds: [entry.id] });
    expect(control.attributes("aria-checked")).toBe("true");
    await control.trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([["sample", true], ["sample", false]]);
    expect(wrapper.emitted("configure")).toBeUndefined();
    expect(wrapper.emitted("close")).toBeUndefined();
  });
  it("allows selection without connector management permission", async () => {
    const wrapper = setup();
    await wrapper.setProps({ canManage: false });
    expect(wrapper.get('[role="switch"]').attributes("aria-disabled")).toBe("false");
    await wrapper.get('[role="switch"]').trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([["sample", true]]);
  });
  it.each([false, true])("allows removal of an unavailable selection, including busy=%s", async busy => {
    const wrapper = setup([{ ...entry, busy, selectable: false, enabled: false }]);
    await wrapper.setProps({ selectedIds: [entry.id], canManage: false, selectionAvailable: false });
    await wrapper.get('[role="switch"]').trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([["sample", false]]);
    expect(wrapper.emitted("enabled-change")).toBeUndefined();
  });
  it("blocks selection changes while a conversation is running", async () => {
    const wrapper = setup(); await wrapper.setProps({ disabled: true });
    await wrapper.get('[role="switch"]').trigger("click");
    expect(wrapper.emitted("selection-change")).toBeUndefined();
  });
  it("routes an unready row to management without enabling or authorizing", async () => {
    const wrapper = setup([{ ...entry, enabled: false, selectable: false, status: { label: "待授权", tone: "warning" }, actions: ["authorize"] }]);
    expect(wrapper.get('[role="switch"]').attributes("aria-disabled")).toBe("true");
    await wrapper.get('[data-connector-option]').trigger("click");
    expect(wrapper.emitted("configure")).toEqual([["sample"]]);
    expect(wrapper.emitted("selection-change")).toBeUndefined();
    expect(wrapper.emitted("enabled-change")).toBeUndefined();
  });
  it("offers management from the empty state without fabricating an installed app", async () => {
    const wrapper = setup([]);
    await flushPromises();
    expect(document.body.textContent).toContain('还没有安装连接器');
    expect(document.querySelector('[role="switch"]')).toBeNull();
    const manage = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '管理连接器')!;
    await new DOMWrapper(manage).trigger('click'); expect(wrapper.emitted('manage')).toHaveLength(1);
  });
  it.each([
    ["连接待恢复", "待连接", false],
    ["需要重新授权", "待授权", false],
    ["正在授权，请在浏览器中完成", "授权中", true],
    ["操作结果待确认", "待确认", true],
    ["未来的未知状态", "待确认", false],
  ])("keeps the original %s status accessible beside its compact label", async (label, compact, busy) => {
    const wrapper = setup([{ ...entry, enabled: false, selectable: false, busy, status: { label, tone: "warning" }, actions: ["configure"] }]);
    await flushPromises();
    expect(wrapper.get('.connector-menu__status').text()).toBe(compact);
    expect(wrapper.get('.connector-menu__status').attributes('title')).toBe(label);
    const option = wrapper.get('[data-connector-option]');
    expect(option.attributes('aria-label')).toContain(label);
    expect(wrapper.get('.connector-menu__name').text()).toBe(entry.name);
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
  });
});


it("shows operation errors beside the affected connector and queries its original operation", async () => {
  const wrapper = setup([{ ...entry, enabled: false, selectable: false, actions: ["retry"], status: { label: "操作结果待确认", tone: "warning" } }]);
  await wrapper.setProps({ operationErrors: { sample: "操作结果尚未确认，请重新确认状态。" } });
  const alert = wrapper.get('[role="alert"]');
  expect(alert.text()).toContain("操作结果尚未确认");
  await alert.get("button").trigger("click");
  expect(wrapper.emitted("retry")).toEqual([["sample"]]);
  expect(wrapper.emitted("configure")).toBeUndefined();
  expect(wrapper.emitted("close")).toBeUndefined();
  await wrapper.setProps({ disabled: true });
  expect(alert.get("button").attributes("disabled")).toBeDefined();
});
