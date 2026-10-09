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
  return mount(ChatSkillControl, { props: { entries, canManage: true, disabled: false, loading: false, error: null, operations: {}, operationErrors: {} } });
}
describe("composer skills panel", () => {
  it("reads on open, filters installed skills and emits the existing enable action", async () => {
    const wrapper = setup([entry, { ...entry, id: "uninstalled", displayName: "未安装技能", installationStatus: "not_installed" }]);
    expect(wrapper.emitted('refresh')).toEqual([[]]);
    expect(wrapper.find('header').exists()).toBe(false);
    expect(wrapper.find('.skill-menu__status').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('未安装技能');
    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.emitted('enabled-change')).toEqual([["sample", false]]);
    await wrapper.get('input').setValue('没有匹配');
    expect(wrapper.text()).toContain('没有找到匹配的技能');
    await wrapper.get('input').setValue('COPYWRITING');
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
  });
  it("preserves permission and busy restrictions and displays operation failures", async () => {
    const wrapper = setup();
    await wrapper.setProps({ canManage: false });
    expect(wrapper.text()).toContain('没有管理技能的权限');
    expect(wrapper.get('[role="switch"]').attributes('aria-disabled')).toBe('true');
    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    await wrapper.setProps({ canManage: true, operations: { sample: 'disable' } });
    expect(wrapper.get('[role="switch"]').attributes('aria-disabled')).toBe('true');
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
});
