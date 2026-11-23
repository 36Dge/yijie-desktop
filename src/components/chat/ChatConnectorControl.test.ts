// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectorView } from "../../domain/connector-ui";
import ChatConnectorControl from "./ChatConnectorControl.vue";

enableAutoUnmount(afterEach);
const entry: ConnectorView = {
  id: "sample", name: "普通合成服务", description: "组件验证", iconAssetId: "cue", categoryId: "productivity", categoryLabel: "效率工具",
  installed: true, enabled: true, selectable: true, status: { label: "已启用", tone: "success" },
  explanation: null, configurationLabel: "", busy: false, actions: ["disable", "uninstall"],
};
function setup(entries: ConnectorView[] = [entry]) {
  return mount(ChatConnectorControl, { attachTo: document.body, props: { entries, selectedIds: [], selectionAvailable: true } });
}

describe("chat connector selection", () => {
  it("checks the whole row and closes on selection or deselection without management permission", async () => {
    const wrapper = setup([{ ...entry, actions: [] }]);
    const option = wrapper.get('[role="checkbox"]');
    expect(option.text()).toBe(entry.name);
    expect(option.attributes("aria-checked")).toBe("false");
    expect(option.find(".chat-resource-check svg").exists()).toBe(false);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("开关");

    await option.trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([[entry.id, true]]);
    await wrapper.setProps({ selectedIds: [entry.id] });
    expect(option.attributes("aria-checked")).toBe("true");
    expect(option.get(".chat-resource-check svg").attributes("width")).toBe("14");
    await option.trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([[entry.id, true], [entry.id, false]]);
    expect(wrapper.emitted("close")).toEqual([["selection"], ["selection"]]);
    expect(wrapper.emitted("manage")).toBeUndefined();
  });

  it("searches only installed and effectively enabled entries, including when an old selection is hidden", async () => {
    const disabled = { ...entry, id: "disabled", name: "待配置服务", desiredEnabled: true, enabled: false, selectable: false };
    const missing = { ...entry, id: "missing", name: "未安装服务", installed: false, enabled: false, selectable: false };
    const second = { ...entry, id: "second", name: "Sorftime" };
    const wrapper = setup([disabled, second, missing, entry]);
    await wrapper.setProps({ selectedIds: [disabled.id, second.id, entry.id] });
    expect(wrapper.findAll('[aria-checked="true"]').map(option => option.text())).toEqual([second.name, entry.name]);
    const input = wrapper.get("input");
    await input.setValue("sOrF");
    expect(wrapper.findAll('[role="checkbox"]').map(option => option.text())).toEqual([second.name]);
    await input.setValue(disabled.name);
    expect(wrapper.text()).toContain("没有找到匹配的连接器");
    await wrapper.get(".connector-menu__empty button").trigger("click");
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(2);
    await wrapper.setProps({ entries: [disabled, missing] });
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("暂无已安装且启用的连接器");
  });

  it("allows removing a checked row when use is unavailable, and locks all choices during a task", async () => {
    const wrapper = setup();
    await wrapper.setProps({ selectionAvailable: false });
    const option = wrapper.get('[role="checkbox"]');
    expect(option.attributes("disabled")).toBeDefined();
    await option.trigger("click");
    expect(wrapper.emitted("selection-change")).toBeUndefined();
    expect(wrapper.get('[role="status"]').text()).toContain("当前无法选用");

    await wrapper.setProps({ selectedIds: [entry.id] });
    await option.trigger("click");
    expect(wrapper.emitted("selection-change")).toEqual([[entry.id, false]]);
    await wrapper.setProps({ disabled: true });
    expect(option.attributes("disabled")).toBeDefined();
    await option.trigger("click");
    expect(wrapper.emitted("selection-change")).toHaveLength(1);
  });

  it("navigates eligible rows with the keyboard and skips a pending operation", async () => {
    const wrapper = setup([
      entry,
      { ...entry, id: "pending", selectable: false, busy: true, status: { label: "正在停用", tone: "neutral" } },
      { ...entry, id: "last", name: "另一个服务" },
    ]);
    const [first, pending, last] = wrapper.findAll<HTMLButtonElement>('[role="checkbox"]');
    expect(pending!.attributes("disabled")).toBeDefined();
    expect(pending!.text()).toContain("正在停用");
    first!.element.focus();
    await first!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(last!.element);
    await last!.trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(first!.element);
    await first!.trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(last!.element);
    expect(wrapper.emitted("selection-change")).toBeUndefined();
  });

  it("offers retry on read failure and management from the empty state", async () => {
    const wrapper = setup([]);
    expect(wrapper.emitted("refresh")).toHaveLength(1);
    await wrapper.setProps({ loading: true });
    expect(wrapper.get('[role="status"]').text()).toContain("正在读取");
    expect(wrapper.find(".connector-menu__empty").exists()).toBe(false);
    await wrapper.setProps({ loading: false, error: "无法读取连接器状态" });
    await wrapper.get('[role="alert"] button').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(2);
    await wrapper.setProps({ error: null });
    expect(wrapper.text()).toContain("暂无已安装且启用的连接器");
    await wrapper.get("footer button").trigger("click");
    expect(wrapper.emitted("close")).toEqual([[]]);
    expect(wrapper.emitted("manage")).toEqual([[]]);
  });

  it("keeps recovery for an enabled connector with an unconfirmed operation separate from selection", async () => {
    const wrapper = setup([{ ...entry, selectable: false, actions: ["retry"], status: { label: "操作结果待确认", tone: "warning" } }]);
    await wrapper.setProps({ operationErrors: { sample: "操作结果尚未确认，请重新确认状态。" } });
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("操作结果尚未确认");
    await alert.get("button").trigger("click");
    expect(wrapper.emitted("retry")).toEqual([[entry.id]]);
    expect(wrapper.emitted("selection-change")).toBeUndefined();
    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
