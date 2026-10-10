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

describe("chat connector menu intent separation", () => {
  it("keeps global switch and current-turn selection as independent controls", async () => {
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.find('.connector-menu__status').exists()).toBe(false);
    const row = new DOMWrapper(document.querySelector<HTMLButtonElement>('[data-connector-option]')!);
    await row.trigger('click');
    expect(wrapper.emitted('select')).toEqual([["sample"]]);
    expect(wrapper.emitted('enabled-change')).toBeUndefined();
    const control = new DOMWrapper(document.querySelector<HTMLElement>('[role="switch"]')!);
    await control.trigger('click');
    expect(wrapper.emitted('enabled-change')).toEqual([["sample", false]]);
    expect(wrapper.emitted('select')).toHaveLength(1);
  });
  it("routes an unavailable entry to configuration without selecting it", async () => {
    const wrapper = setup([{ ...entry, enabled: false, selectable: false, status: { label: "待配置", tone: "warning" }, actions: ["configure"] }]);
    await flushPromises();
    await new DOMWrapper(document.querySelector<HTMLButtonElement>('[data-connector-option]')!).trigger('click');
    expect(wrapper.emitted('configure')).toEqual([["sample"]]); expect(wrapper.emitted('select')).toBeUndefined();
    await wrapper.get('footer button').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
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
