// @vitest-environment happy-dom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_SHOPS, SHOP_PREVIEW_TIMING } from "../domain/chat-shop-preview";
import { useChatShopPreview, type ChatShopPreview } from "./useChatShopPreview";

const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); });
function setup() {
  const context = ref("preview-owner"), target = ref("new"); let model!: ChatShopPreview;
  const wrapper = mount(defineComponent({ setup() { model = useChatShopPreview(() => context.value, () => target.value); return () => h("div"); } }));
  wrappers.push(wrapper); return { model, context, target, wrapper };
}
async function authorize(model: ChatShopPreview) { model.authorize(); await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.authorization); }
async function link(model: ChatShopPreview, id = PREVIEW_SHOPS[0]!.id) { model.choose(id); model.link(); await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.linking); }
describe("shop association interaction preview", () => {
  it("starts empty and simulates authorization before returning exactly five shops", async () => {
    const { model } = setup(); expect(model.available.value).toHaveLength(0);
    model.authorize(); expect(model.stage.value).toBe("authorizing");
    await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.authorizationStep); expect(model.authorizationStep.value).toBe(1);
    await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.authorization);
    expect(model.available.value).toHaveLength(5); expect(model.current.value).toBeNull();
    expect(model.available.value.filter(shop => shop.platform === "TikTok Shop")).toHaveLength(3);
    expect(model.available.value.filter(shop => shop.platform === "Amazon")).toHaveLength(2);
  });
  it("requires confirmation, retains the old association on cancel, and switches one shop at a time", async () => {
    const { model } = setup(); await authorize(model); await link(model);
    expect(model.current.value?.id).toBe(PREVIEW_SHOPS[0]!.id); expect(model.stage.value).toBe("success");
    model.openPanel(); model.choose(PREVIEW_SHOPS[3]!.id); model.cancel();
    expect(model.current.value?.id).toBe(PREVIEW_SHOPS[0]!.id);
    await link(model, PREVIEW_SHOPS[3]!.id); expect(model.current.value?.id).toBe(PREVIEW_SHOPS[3]!.id);
    model.unlink(); expect(model.current.value).toBeNull(); expect(model.available.value).toHaveLength(5);
  });
  it("cancels delayed authorization and linking when the popup is dismissed", async () => {
    const { model } = setup(); model.authorize(); model.cancel(); await vi.runAllTimersAsync();
    expect(model.authorized.value).toBe(false); await authorize(model);
    model.choose(PREVIEW_SHOPS[0]!.id); model.link(); model.cancel(); await vi.runAllTimersAsync();
    expect(model.current.value).toBeNull(); expect(model.stage.value).toBe("list");
  });
  it("carries the new-chat UI selection only to its created conversation and resets on account changes", async () => {
    const { model, target, context } = setup(); await authorize(model); await link(model);
    model.adoptNewChat("conversation-one"); target.value = "conversation-one"; await nextTick();
    expect(model.current.value?.id).toBe(PREVIEW_SHOPS[0]!.id);
    target.value = "conversation-two"; await nextTick(); expect(model.current.value).toBeNull();
    target.value = "new"; await nextTick(); expect(model.current.value).toBeNull();
    context.value = "another-owner"; await nextTick(); expect(model.authorized.value).toBe(false);
    target.value = "conversation-one"; await nextTick(); expect(model.current.value).toBeNull();
  });
  it("searches and filters shops and refreshes without clearing the current association", async () => {
    const { model } = setup(); await authorize(model); await link(model);
    model.openPanel(); model.platform.value = "Amazon"; expect(model.filtered.value).toHaveLength(2);
    model.query.value = "德国"; expect(model.filtered.value.map(shop => shop.name)).toEqual(["Luma Living"]);
    model.refresh(); await vi.advanceTimersByTimeAsync(SHOP_PREVIEW_TIMING.refresh);
    expect(model.current.value?.id).toBe(PREVIEW_SHOPS[0]!.id); expect(model.notice.value).toContain("已更新");
  });
  it("shows recoverable expired and error preview states without making real authorization changes", async () => {
    const { model } = setup(); await authorize(model); await link(model);
    model.previewScenario("expired-current"); expect(model.current.value).toBeNull(); expect(model.stage.value).toBe("expired");
    expect(model.available.value).toHaveLength(4); await authorize(model); expect(model.available.value).toHaveLength(5);
    model.previewScenario("expired-others"); expect(model.available.value).toHaveLength(3);
    model.previewScenario("authorization-error"); expect(model.stage.value).toBe("error");
    model.retry(); await vi.runAllTimersAsync(); expect(model.stage.value).toBe("list");
  });
  it("cleans up pending UI timers on unmount", async () => {
    const { model, wrapper } = setup(); model.authorize(); wrapper.unmount(); await vi.runAllTimersAsync();
    expect(model.authorized.value).toBe(false);
  });
});
