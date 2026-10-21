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

describe("chat connector switch selection", () => {
  it("uses the switch as the sole toggle, without a checkbox or checkmark", async () => {
    const wrapper = setup();
    await wrapper.setProps({ selectedIds: [entry.id] });
    const control = wrapper.get('[role="switch"]');
    const row = wrapper.get('[data-connector-option]');
    expect(control.attributes('aria-checked')).toBe('true');
    expect(row.attributes('role')).toBeUndefined();
    expect(row.attributes('aria-checked')).toBeUndefined();
    expect(wrapper.find('.connector-menu__check').exists()).toBe(false);
    await row.trigger('click');
    expect(wrapper.emitted('enabled-change')).toEqual([['sample', false]]);
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    // Wait for the authoritative result before changing the controlled switch.
    expect(control.attributes('aria-checked')).toBe('true');
    await wrapper.setProps({ entries: [{ ...entry, enabled: false, selectable: false, status: { label: '未启用', tone: 'neutral' }, actions: ['enable'] }], selectedIds: [] });
    expect(control.attributes('aria-checked')).toBe('false');
    await control.trigger('click');
    expect(wrapper.emitted('enabled-change')).toEqual([['sample', false], ['sample', true]]);
    expect(wrapper.emitted('close')).toBeUndefined();
  });
  it.each([
    { canManage: false, disabled: false, entry },
    { canManage: true, disabled: true, entry },
    { canManage: true, disabled: false, entry: { ...entry, busy: true } },
    { canManage: true, disabled: false, entry: { ...entry, actions: [] } },
    { canManage: true, disabled: false, entry: { ...entry, enabled: false, selectable: false, actions: [] } },
  ])("disables the switch when management is unavailable: %j", async ({ canManage, disabled, entry: state }) => {
    const wrapper = setup([state]);
    await wrapper.setProps({ canManage, disabled });
    const control = wrapper.get('[role="switch"]');
    expect(control.attributes('aria-disabled')).toBe('true');
    await control.trigger('click');
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    expect(wrapper.emitted('select')).toBeUndefined();
  });
  it("allows the off switch to request configuration without selecting an unready connector", async () => {
    const wrapper = setup([{ ...entry, enabled: false, selectable: false, status: { label: '连接待恢复', tone: 'warning' }, actions: ['configure'] }]);
    const control = wrapper.get('[role="switch"]');
    expect(control.attributes('aria-checked')).toBe('false');
    expect(control.attributes('aria-disabled')).toBe('false');
    await control.trigger('click');
    expect(wrapper.emitted('enabled-change')).toEqual([['sample', true]]);
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });
  it("preserves busy and unavailable management restrictions", async () => {
    const wrapper = setup([{ ...entry, busy: true }]);
    await wrapper.get('[data-connector-option]').trigger('click');
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    await wrapper.setProps({ entries: [entry], disabled: true });
    await wrapper.get('[data-connector-option]').trigger('click');
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    await wrapper.setProps({ disabled: false, canManage: false });
    await wrapper.get('[data-connector-option]').trigger('click');
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
  });
  it("routes configuration-only entries to management when the switch cannot start them", async () => {
    const wrapper = setup([{ ...entry, enabled: false, selectable: false, status: { label: "待授权", tone: "warning" }, actions: ["authorize"] }]);
    await flushPromises();
    await new DOMWrapper(document.querySelector<HTMLButtonElement>('[data-connector-option]')!).trigger('click');
    expect(wrapper.emitted('configure')).toEqual([["sample"]]);
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    await wrapper.get('footer button').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
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
