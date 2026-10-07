// @vitest-environment happy-dom
import { defineComponent, h, nextTick, ref } from "vue";
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatShopPreview, type ChatShopPreview } from "../../composables/useChatShopPreview";
import { PREVIEW_SHOPS, SHOP_PREVIEW_TIMING } from "../../domain/chat-shop-preview";
import ChatShopControl from "./ChatShopControl.vue";

const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });
function setup() {
  let model!: ChatShopPreview; const disabled = ref(false);
  const wrapper = mount(defineComponent({ setup() { model = useChatShopPreview(() => "demo", () => "new"); return () => h(ChatShopControl, { model, disabled: disabled.value }); } }), { attachTo: document.body });
  wrappers.push(wrapper); return { wrapper, get model() { return model; }, disabled };
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('.shop-panel button')].find(b => b.textContent?.trim() === text)!; }
describe("shop picker UI", () => {
  it("uses a storefront trigger, guides authorization and confirms a single shop", async () => {
    const view = setup(); const trigger = view.wrapper.get('.shop-trigger');
    expect(trigger.find('svg.lucide-store').exists()).toBe(true);
    await trigger.trigger('click'); await flushPromises();
    expect(document.body.textContent).toContain('还没有授权店铺');
    expect(document.body.textContent).toContain('不连接真实店铺与数据');
    button('授权店铺').click(); await nextTick(); expect(document.body.textContent).toContain('正在准备店铺授权');
    await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.authorization); await flushPromises();
    const choices = document.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(choices).toHaveLength(5); expect(button('关联店铺').disabled).toBe(true);
    choices[0]!.click(); await nextTick(); expect(document.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
    expect(view.model.current.value).toBeNull(); button('关联店铺').click();
    await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.linking); await flushPromises();
    expect(document.body.textContent).toContain('店铺关联成功'); expect(trigger.text()).toContain('拾光家居');
    expect(trigger.find('.shop-trigger-check').exists()).toBe(true);
    button('继续对话').click(); await flushPromises(); expect(trigger.attributes('aria-expanded')).toBe('false');
  });
  it("filters the list, supports arrow selection and discards an unconfirmed choice with Escape", async () => {
    const view = setup(); view.model.authorize(); await vi.runAllTimersAsync();
    await view.wrapper.get('.shop-trigger').trigger('keydown', { key: 'ArrowDown' }); await flushPromises();
    const input = new DOMWrapper(document.querySelector<HTMLInputElement>('[aria-label="搜索店铺"]')!);
    await input.setValue('找不到'); expect(document.body.textContent).toContain('没有找到匹配的店铺');
    await input.setValue(''); const options = document.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    options[0]!.focus(); options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await nextTick();
    expect(view.model.draftId.value).toBe(PREVIEW_SHOPS[1]!.id);
    options[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flushPromises();
    expect(view.model.current.value).toBeNull(); expect(view.wrapper.get('.shop-trigger').attributes('aria-expanded')).toBe('false');
  });
  it("closes and cancels pending changes when the composer becomes busy", async () => {
    const view = setup(); await view.wrapper.get('.shop-trigger').trigger('click'); await flushPromises();
    button('授权店铺').click(); await nextTick(); view.disabled.value = true; await nextTick(); await vi.runAllTimersAsync();
    expect(view.model.authorized.value).toBe(false); expect(view.wrapper.get('.shop-trigger').attributes('disabled')).toBeDefined();
  });
});
