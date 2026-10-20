// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedSkillProjection } from "../../domain/skill-marketplace";
import ChatSkillControl from "./ChatSkillControl.vue";
enableAutoUnmount(afterEach);

const entry: ManagedSkillProjection = {
  id: "sample", runtimeName: "copywriting", displayName: "营销文案", description: "商品文案",
  category: "content-marketing", order: 0, version: "1.0.0", iconKey: "skillCopywriting",
  riskLevel: "low", riskReasons: [], sourceType: "internal", licenseExpression: "MIT",
  executionMode: "model-only", networkAccess: "none", filesystemAccess: "none", requiredTools: [],
  catalogStatus: "installable", catalogBlockedReason: null, maintenanceStatus: "maintained",
  capabilityReadiness: "ready", installationStatus: "installed", enabled: true, runtimeVisible: true, failureCode: "",
};
function setup(entries: readonly ManagedSkillProjection[] = [entry]) {
  return mount(ChatSkillControl, { props: { entries, selectedIds: [], disabled: false, loading: false, error: null, operations: {}, operationErrors: {} } });
}
describe("composer skills panel", () => {
  it("filters installed skills and toggles per-turn selection without enabling or disabling", async () => {
    const wrapper = setup([entry, { ...entry, id: "uninstalled", displayName: "未安装技能", installationStatus: "not_installed", enabled: false, runtimeVisible: false }]);
    expect(wrapper.emitted('refresh')).toEqual([[]]);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未安装技能');
    const option = wrapper.get('[role="checkbox"]');
    expect(option.attributes('aria-checked')).toBe('false');
    await option.trigger('click');
    expect(wrapper.emitted('select')).toEqual([["sample"]]);
    expect(wrapper.emitted("close")).toEqual([[]]);
    await wrapper.setProps({ selectedIds: ['sample'] });
    expect(option.attributes('aria-checked')).toBe('true');
    expect(wrapper.find('.skill-menu__check svg').exists()).toBe(true);
    await option.trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(2);
    expect(wrapper.emitted('close')).toHaveLength(2);
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    await wrapper.get('input').setValue('没有匹配');
    expect(wrapper.text()).toContain('没有找到匹配的技能');
    await wrapper.get('input').setValue('COPYWRITING');
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(true);
  });
  it("does not select disabled or unsynchronized skills but permits removing a stale selection", async () => {
    const wrapper = setup([{ ...entry, enabled: false, runtimeVisible: false }]);
    expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('已停用');
    await wrapper.get('[role="checkbox"]').trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.setProps({ selectedIds: ['sample'] });
    expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[role="checkbox"]').trigger('click');
    expect(wrapper.emitted('select')).toEqual([["sample"]]);
    await wrapper.setProps({ selectedIds: [], entries: [{ ...entry, runtimeVisible: false }] });
    expect(wrapper.get('.skill-menu__status').text()).toBe('等待同步');
    expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeDefined();
  });
  it("preserves busy restrictions and displays operation failures", async () => {
    const wrapper = setup();
    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[role="checkbox"]').trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
    await wrapper.setProps({ disabled: false, operations: { sample: 'disable' } });
    expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ operations: {}, operationErrors: { sample: '技能状态更新失败，请重试。' } });
    expect(wrapper.get('[role="alert"]').text()).toContain('技能状态更新失败');
  });
  it("supports recovery and management from empty and failed reads", async () => {
    const wrapper = setup([]);
    expect(wrapper.text()).toContain('还没有安装技能');
    await wrapper.get('footer button').trigger('click');
    expect(wrapper.emitted('close')).toEqual([[]]);
    expect(wrapper.emitted('manage')).toEqual([[]]);
    await wrapper.setProps({ error: '技能服务暂不可用' });
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(2);
  });
  it("keeps the installed list and search mounted during background refresh without a visible loading row", async () => {
    const wrapper = setup();
    await wrapper.get('input').setValue('营销');
    const row = wrapper.get('.skill-menu__list li').element;
    await wrapper.setProps({ refreshing: true });
    expect(wrapper.get('.chat-resource-panel').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.skill-menu__notice[role="status"]').exists()).toBe(false);
    expect(wrapper.get('.skill-menu__refresh-status').text()).toContain('正在更新技能状态');
    expect(wrapper.get('.skill-menu__list li').element).toBe(row);
    expect(wrapper.get('input').element.value).toBe('营销');
    await wrapper.setProps({ refreshing: false });
    expect(wrapper.get('.skill-menu__list li').element).toBe(row);
    expect(wrapper.find('.skill-menu__refresh-status').exists()).toBe(false);
    expect(wrapper.get('.chat-resource-panel').attributes('aria-busy')).toBe('false');
  });
  it("retains the empty projection while refreshing and still shows first-load and read-error states", async () => {
    const wrapper = setup([]);
    const empty = wrapper.get('.skill-menu__empty').element;
    await wrapper.setProps({ refreshing: true });
    expect(wrapper.get('.skill-menu__empty').element).toBe(empty);
    expect(wrapper.text()).toContain('还没有安装技能');
    await wrapper.setProps({ loading: true, refreshing: false });
    expect(wrapper.get('.skill-menu__notice[role="status"]').text()).toContain('正在读取技能状态');
    expect(wrapper.find('.skill-menu__empty').exists()).toBe(false);
    await wrapper.setProps({ loading: false, error: '技能服务暂不可用' });
    expect(wrapper.get('[role="alert"]').text()).toContain('技能服务暂不可用');
    expect(wrapper.get('[role="alert"] button').attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ refreshing: true });
    expect(wrapper.get('[role="alert"] button').attributes('disabled')).toBeDefined();
  });
});
