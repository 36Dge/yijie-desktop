// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { NMessageProvider } from "naive-ui";
import { defineComponent, h } from "vue";
import ChatDocumentToolbar from "./ChatDocumentToolbar.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";

enableAutoUnmount(afterEach);
const tooltip = defineComponent({ props: ["show"], template: '<div><slot name="trigger"/><div v-if="show"><slot/></div></div>' });

it("keeps the path tooltip open for scrollbar focus and reads the full path with keyboard controls", async () => {
  const root = mount(NMessageProvider, {
    attachTo: document.body,
    slots: { default: () => h(ChatDocumentToolbar, {
      name: "report.xlsx", path: "/ordinary/workspace/reports/monthly-review/report.xlsx",
      pathState: "ready", pathOpen: true, saving: false, canSave: true, save: async () => "saved" as const,
    }) },
    global: { stubs: { NTooltip: tooltip, Tooltip: tooltip } },
  });
  const view = root.getComponent(ChatDocumentToolbar);
  await flushPromises();
  const viewport = view.get<HTMLElement>('.document-toolbar__path');
  Object.defineProperties(viewport.element, { clientHeight: { value: 48 }, scrollHeight: { value: 180 } });
  view.getComponent(ChatShortScrollbar).vm.sync();
  await flushPromises();
  const trigger = view.get<HTMLButtonElement>('[aria-label="文件路径"]');
  const thumb = view.get<HTMLElement>('[role="scrollbar"]');
  expect(thumb.attributes('aria-controls')).toBe(viewport.attributes('id'));
  trigger.element.focus();
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  expect(document.activeElement).toBe(viewport.element);
  thumb.element.focus();
  await flushPromises();
  view.findComponent(tooltip).vm.$emit('update:show', false);
  await flushPromises();
  expect(view.emitted('update:pathOpen')).not.toContainEqual([false]);
  await thumb.trigger('keydown', { key: 'End' });
  expect(viewport.element.scrollTop).toBe(132);
  expect(thumb.attributes('aria-valuenow')).toBe('132');
  await thumb.trigger('keydown', { key: 'Home' });
  expect(viewport.element.scrollTop).toBe(0);
  await thumb.trigger('keydown', { key: 'Escape' });
  expect(view.emitted('update:pathOpen')?.slice(-1)[0]).toEqual([false]);
  expect(document.activeElement).toBe(trigger.element);
  const beforeLeaving = view.emitted('update:pathOpen')?.length ?? 0;
  const saveButton = view.get<HTMLButtonElement>('[aria-label="另存为"]');
  saveButton.element.focus();
  await flushPromises();
  expect(view.emitted('update:pathOpen')).toHaveLength(beforeLeaving + 1);
  expect(view.emitted('update:pathOpen')?.slice(-1)[0]).toEqual([false]);
  await saveButton.trigger('click'); await flushPromises();
  expect(document.querySelector('.n-message__content')?.textContent).toBe('文件已保存');
});
