// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { expertDisplay, expertEntry } from "../../test/expert-fixture";
import ChatExpertControl from "./ChatExpertControl.vue";

enableAutoUnmount(afterEach);
const ready = { ...expertEntry, state: "ready" as const };
const available = { ...expertEntry, display: { ...expertDisplay, expertId: "another", displayName: "待准备专家" } };
const unavailable = { ...expertEntry, display: { ...expertDisplay, expertId: "unavailable", displayName: "不可用专家" }, state: "unavailable" as const };
function setup() {
  return mount(ChatExpertControl, { attachTo: document.body, props: {
    entries: [ready, available, unavailable], selected: null, disabled: false, loading: false,
    error: null, executionAvailable: true, canManage: true, busyKeys: new Set<string>(), operationErrors: {}, pendingKeys: [],
  } });
}
it("lists a short catalog and only marks the authoritative single selection", async () => {
  const view = setup();
  expect(view.findAll('[role="radio"]')).toHaveLength(3);
  await view.findAll('[role="radio"]')[1]!.trigger("click");
  expect(view.emitted("select")).toEqual([[available]]);
  expect(view.find('[aria-checked="true"]').exists()).toBe(false);
  expect(view.emitted("close")).toBeUndefined();
  await view.setProps({ selected: available.display });
  expect(view.findAll('[aria-checked="true"]')).toHaveLength(1);
  expect(view.get('[aria-checked="true"]').text()).toContain("待准备专家");
  expect(view.get('[aria-checked="true"] .chat-resource-check svg').attributes("width")).toBe("14");
  await view.findAll('[role="radio"]')[2]!.trigger("click");
  expect(view.emitted("select")).toHaveLength(1);
});
it("defaults to seven experts while searching the entire catalog and restoring the default after clearing", async () => {
  const view = setup();
  const entries = Array.from({ length: 10 }, (_, index) => ({ ...ready, display: { ...ready.display, expertId: `expert-${index}`, displayName: `合成专家 ${index + 1}` } }));
  await view.setProps({ entries, selected: entries[9]!.display });
  expect(view.findAll('[role="radio"]').map(option => option.text())).toEqual(entries.slice(0, 7).map(entry => entry.display.displayName));
  expect(view.find('[aria-checked="true"]').exists()).toBe(false);
  const input = view.get('input[aria-label="搜索专家"]');
  await input.setValue('合成专家');
  expect(view.findAll('[role="radio"]')).toHaveLength(10);
  await input.setValue('合成专家 10');
  expect(view.findAll('[role="radio"]')).toHaveLength(1);
  expect(view.get('[role="radio"]').attributes('aria-checked')).toBe('true');
  await view.get('[role="radio"]').trigger('click');
  expect(view.emitted('select')).toEqual([[entries[9]]]);
  await input.setValue('   ');
  expect(view.findAll('[role="radio"]')).toHaveLength(7);
  expect(view.emitted('select')).toHaveLength(1);
});
it("searches the full list, preserves it during refresh, and handles no matches and failures", async () => {
  const view = setup();
  const list = view.get('[role="radiogroup"]').element;
  await view.setProps({ refreshing: true });
  expect(view.get('[role="radiogroup"]').element).toBe(list);
  expect(view.find('.expert-menu__notice').exists()).toBe(false);
  await view.get('input[aria-label="搜索专家"]').setValue("待准备");
  expect(view.findAll('[role="radio"]')).toHaveLength(1);
  await view.get("input").setValue("不存在的专家");
  expect(view.text()).toContain("没有找到匹配的专家");
  await view.findAll("button").find(b => b.text() === "清空搜索")!.trigger("click");
  expect(view.findAll('[role="radio"]')).toHaveLength(3);
  await view.setProps({ refreshing: false, entries: [], error: "读取失败" });
  expect(view.get('[role="alert"]').text()).toContain("读取失败");
  await view.findAll("button").find(b => b.text() === "重试")!.trigger("click");
  expect(view.emitted("refresh")).toHaveLength(2);
  await view.get("footer button").trigger("click");
  expect(view.emitted("manage")).toHaveLength(1);
  expect(view.emitted("close")).toHaveLength(1);
});
it("blocks unavailable permissions, operations and task states while allowing ready resources without management", async () => {
  const view = setup();
  await view.setProps({ canManage: false });
  expect(view.findAll('[role="radio"]')[0]!.attributes("disabled")).toBeUndefined();
  expect(view.findAll('[role="radio"]')[1]!.attributes("disabled")).toBeDefined();
  await view.setProps({ pendingKeys: [`${ready.display.expertId}@${ready.display.version}`] });
  await view.findAll('[role="radio"]')[0]!.trigger("click");
  expect(view.emitted("select")).toBeUndefined();
  await view.setProps({ pendingKeys: [], disabled: true });
  expect(view.findAll('[role="radio"]:disabled')).toHaveLength(3);
  await view.setProps({ disabled: false, executionAvailable: false });
  expect(view.findAll('[role="radio"]:disabled')).toHaveLength(3);
});
it("supports keyboard navigation and leaves selection until explicit activation", async () => {
  const view = setup();
  const options = view.findAll<HTMLButtonElement>('[role="radio"]');
  options[0]!.element.focus();
  await options[0]!.trigger("keydown", { key: "End" });
  expect(document.activeElement).toBe(options[1]!.element);
  expect(view.emitted("select")).toBeUndefined();
  await options[1]!.trigger("click");
  expect(view.emitted("select")).toEqual([[available]]);
});
