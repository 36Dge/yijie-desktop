// @vitest-environment happy-dom
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { afterEach, expect, it } from "vitest";
import ChatConnectorChips from "./ChatConnectorChips.vue";

enableAutoUnmount(afterEach);
const entries = [
  { id: "shopify", name: "Shopify MCP", iconAssetId: "shopify" },
  { id: "tushare", name: "Tushare·金融数据", iconAssetId: "tushareMcp" },
];
function setup() {
  return mount(ChatConnectorChips, { attachTo: document.body, props: { entries }, slots: {
    default: ({ close }: { close: () => Promise<void> }) => h('button', { onClick: close }, '管理连接器'),
  } });
}
it("opens the shared connector popup from each logo and restores keyboard focus with Escape", async () => {
  const wrapper = setup();
  expect(wrapper.findAll('img')).toHaveLength(2);
  for (const button of wrapper.findAll('button')) {
    await button.trigger('keydown', { key: 'ArrowDown' }); await flushPromises();
    const panel = new DOMWrapper(document.querySelector<HTMLElement>('.chat-connector-popup')!);
    expect(document.activeElement).toBe(panel.element);
    expect(button.attributes('aria-expanded')).toBe('true');
    expect(panel.text()).toContain('管理连接器');
    await panel.trigger('keydown', { key: 'Escape' }); await flushPromises();
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button.element);
  }
});
it("shows each connector name on hover and closes when the composer becomes busy", async () => {
  const wrapper = setup();
  const button = wrapper.get('button[aria-label="连接器：Tushare·金融数据"]');
  await button.trigger('mouseenter');
  await new Promise(resolve => setTimeout(resolve, 150)); await flushPromises();
  expect(document.querySelector('.n-tooltip')?.textContent).toContain('连接器：Tushare·金融数据');
  await button.trigger('mouseleave');
  await button.trigger('click'); await flushPromises();
  expect(button.attributes('aria-expanded')).toBe('true');
  await wrapper.setProps({ disabled: true }); await flushPromises();
  expect(button.attributes('aria-expanded')).toBe('false');
  expect(button.attributes('disabled')).toBeDefined();
});
