// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { defineComponent } from "vue";
import ChatDocumentToolbar from "./ChatDocumentToolbar.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";

enableAutoUnmount(afterEach);
const tooltip = defineComponent({ props: ["show"], template: '<div><slot name="trigger"/><div v-if="show"><slot/></div></div>' });

it("keeps the path tooltip open for scrollbar focus and reads the full path with keyboard controls", async () => {
  const view = mount(ChatDocumentToolbar, {
    attachTo: document.body,
    props: { name: "report.xlsx", path: "/ordinary/workspace/reports/monthly-review/report.xlsx", pathState: "ready", pathOpen: true, saving: false, canSave: true },
    global: { stubs: { NTooltip: tooltip, Tooltip: tooltip } },
  });
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
  view.get<HTMLButtonElement>('[aria-label="另存为"]').element.focus();
  await flushPromises();
  expect(view.emitted('update:pathOpen')).toHaveLength(beforeLeaving + 1);
  expect(view.emitted('update:pathOpen')?.slice(-1)[0]).toEqual([false]);
});
