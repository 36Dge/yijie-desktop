// @vitest-environment happy-dom
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { h, ref } from "vue";
import ChatSkillControl from "./ChatSkillControl.vue";
import { installedSkill } from "../../test/skill-fixture";
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
      experts: ({ close }: { close: () => void }) => h("section", [h("input", { "aria-label": "搜索专家" }), h("button", { onClick: close }, "关闭专家")]),
    },
  });
}
function menu() { return new DOMWrapper(document.querySelector<HTMLElement>('.composer-add-menu')!); }

describe("composer add menu", () => {
  it("closes the entire menu after a skill selection and retains the checkmark when reopened", async () => {
    const selected = ref<string[]>([]);
    const wrapper = mount(ChatAddControl, {
      attachTo: document.body,
      props: { disabled: false, attachmentDisabled: false, skillsAvailable: true, connectorsAvailable: false },
      slots: { skills: ({ close }: { close: () => void }) => h(ChatSkillControl, {
        entries: [installedSkill], selectedIds: selected.value, disabled: false, loading: false, error: null,
        operations: {}, operationErrors: {}, onClose: close,
        onSelect: (id: string) => { selected.value = selected.value.includes(id) ? [] : [id]; },
      }) },
    });
    const openSkills = async () => {
      await wrapper.get('button').trigger('click'); await flushPromises();
      await menu().get('[data-resource-menu="skills"]').trigger('click'); await flushPromises();
    };
    await openSkills();
    await menu().get('[role="checkbox"]').trigger('click'); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(selected.value).toEqual([installedSkill.id]);
    await openSkills();
    expect(menu().get('[role="checkbox"]').attributes('aria-checked')).toBe('true');
    await menu().get('[role="checkbox"]').trigger('click'); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
    expect(selected.value).toEqual([]);
  });
  it("opens experts on hover and keyboard entry without navigation or stealing hover focus", async () => {
    const wrapper = setup();
    await wrapper.setProps({ expertsAvailable: true });
    await wrapper.get('button').trigger('click'); await flushPromises();
    const experts = menu().findAll('[role="menuitem"]').find(item => item.text() === "选择专家")!;
    const focused = document.activeElement;
    await experts.trigger('mouseenter'); await flushPromises();
    expect(menu().get('.composer-add-menu__submenu').attributes('aria-label')).toBe('专家');
    expect(menu().find('[aria-label="搜索专家"]').exists()).toBe(true);
    expect(document.activeElement).toBe(focused);
    await experts.trigger('keydown', { key: 'ArrowRight' }); await flushPromises();
    expect(document.activeElement).toBe(menu().get('.composer-add-menu__submenu').element);
    await menu().trigger('keydown', { key: 'Escape' }); await flushPromises();
    expect(document.activeElement).toBe(experts.element);
    expect(menu().find('.composer-add-menu__submenu').exists()).toBe(false);
    await experts.trigger('click'); await flushPromises();
    expect(wrapper.emitted('browse-experts')).toBeUndefined();
    expect(wrapper.emitted('pick-attachments')).toBeUndefined();
    await wrapper.setProps({ expertsAvailable: false }); await flushPromises();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });
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
  it("only reveals and focuses the latest resource when switching during initial layout", async () => {
    const wrapper = setup();
    await wrapper.get('button').trigger('click'); await flushPromises();
    const skills = menu().get('[data-resource-menu="skills"]');
    const connectors = menu().get('[data-resource-menu="connectors"]');
    skills.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    connectors.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const panel = menu().get<HTMLElement>('.composer-add-menu__submenu');
    expect(panel.attributes('aria-label')).toBe('连接器');
    expect(panel.element.style.visibility).toBe('visible');
    expect(document.activeElement).toBe(panel.element);
    skills.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.setProps({ disabled: true }); await flushPromises();
    expect(document.querySelector('.composer-add-menu__submenu')).toBeNull();
  });
});
