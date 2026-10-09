// @vitest-environment happy-dom
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import ChatAddControl from "./ChatAddControl.vue";
enableAutoUnmount(afterEach);

function setup(attachmentDisabled = false) {
  return mount(ChatAddControl, {
    attachTo: document.body,
    props: { disabled: false, attachmentDisabled, skillsAvailable: true, connectorsAvailable: true },
    slots: {
      skills: ({ close }: { close: () => void }) => h("section", [h("input", { "aria-label": "搜索技能" }), h("button", { onClick: close }, "关闭技能")]),
      connectors: ({ close }: { close: () => void }) => h("section", [h("input", { "aria-label": "搜索连接器" }), h("button", { onClick: close }, "关闭连接器")]),
    },
  });
}
function menu() { return new DOMWrapper(document.querySelector<HTMLElement>('.composer-add-menu')!); }

describe("composer add menu", () => {
  it("opens without invoking the picker, then forwards the existing file action once", async () => {
    const wrapper = setup();
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.emitted('pick-attachments')).toBeUndefined();
    expect(menu().findAll('[role="menuitem"]').map(item => item.text())).toEqual(['添加文件', '技能', '连接器']);
    await menu().get('[role="menuitem"]').trigger('click'); await flushPromises();
    expect(wrapper.emitted('pick-attachments')).toEqual([[]]);
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });
  it("keeps resources accessible when files are unavailable and restores keyboard focus on close", async () => {
    const wrapper = setup(true);
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' }); await flushPromises();
    const options = menu().findAll('[role="menuitem"]');
    expect(options[0]!.attributes('disabled')).toBeDefined();
    expect(document.activeElement).toBe(options[1]!.element);
    await options[1]!.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(options[2]!.element);
    await options[2]!.trigger('click'); await flushPromises();
    expect(document.activeElement).toBe(menu().get('.composer-add-menu__submenu').element);
    await menu().trigger('keydown', { key: 'Escape' }); await flushPromises();
    expect(document.activeElement).toBe(options[2]!.element);
    expect(menu().find('.composer-add-menu__submenu').exists()).toBe(false);
    await menu().trigger('keydown', { key: 'Escape' }); await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('button').element);
    await wrapper.get('button').trigger('click'); await flushPromises();
    await menu().findAll('[role="menuitem"]')[1]!.trigger('click'); await flushPromises();
    expect(document.activeElement).toBe(menu().get('.composer-add-menu__submenu').element);
    await menu().get('.composer-add-menu__submenu button').trigger('click'); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });
  it("opens a side panel on hover without replacing the parent or stealing focus", async () => {
    const wrapper = setup();
    await wrapper.get('button').trigger('click'); await flushPromises();
    const file = menu().get('[role="menuitem"]');
    const skills = menu().get('[data-resource-menu="skills"]');
    const connectors = menu().get('[data-resource-menu="connectors"]');
    await skills.trigger('mouseenter'); await flushPromises();
    expect(menu().findAll('[role="menuitem"]')).toHaveLength(3);
    expect(skills.attributes('aria-expanded')).toBe('true');
    expect(menu().get('.composer-add-menu__submenu').attributes('aria-label')).toBe('技能');
    expect(document.activeElement).toBe(file.element);
    await menu().trigger('mouseleave');
    await menu().get('.composer-add-menu__submenu').trigger('mouseenter');
    await new Promise(resolve => setTimeout(resolve, 210));
    expect(skills.attributes('aria-expanded')).toBe('true');
    await connectors.trigger('mouseenter'); await flushPromises();
    expect(menu().get('.composer-add-menu__submenu').attributes('aria-label')).toBe('连接器');
    expect(skills.attributes('aria-expanded')).toBe('false');
    await file.trigger('mouseenter'); await flushPromises();
    expect(menu().find('.composer-add-menu__submenu').exists()).toBe(false);
    expect(wrapper.emitted('pick-attachments')).toBeUndefined();
  });
  it("supports entering a cascade from the keyboard and keeps a focused panel open on pointer leave", async () => {
    const wrapper = setup();
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' }); await flushPromises();
    const skills = menu().get('[data-resource-menu="skills"]');
    await skills.trigger('keydown', { key: 'ArrowRight' }); await flushPromises();
    expect(document.activeElement).toBe(menu().get('.composer-add-menu__submenu').element);
    await menu().trigger('mouseleave');
    await new Promise(resolve => setTimeout(resolve, 210));
    expect(menu().find('.composer-add-menu__submenu').exists()).toBe(true);
    await wrapper.setProps({ skillsAvailable: false }); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });
  it("closes when submission starts and does not expose disabled resources", async () => {
    const wrapper = setup();
    await wrapper.setProps({ skillsAvailable: false, connectorsAvailable: false });
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(menu().findAll('[role="menuitem"]:disabled')).toHaveLength(2);
    await wrapper.setProps({ disabled: true }); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.emitted('pick-attachments')).toBeUndefined();
  });
});
