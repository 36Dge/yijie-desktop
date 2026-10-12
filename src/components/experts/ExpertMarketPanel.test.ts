// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NConfigProvider, NDialogProvider } from "naive-ui";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExpertsStore } from "../../stores/experts.store";
import { createExpertNativeClient, expertNativeClient } from "../../api/expert-native-client";
import { expertEntry, expertSnapshot, expertTestId as id } from "../../test/expert-fixture";
import ExpertMarketPanel from "./ExpertMarketPanel.vue";

let wrapper: ReturnType<typeof mount> | undefined;
const navigation = vi.hoisted(() => ({ route: { fullPath: "/plugins?tab=experts" } }));
vi.mock("vue-router", () => ({ useRoute: () => navigation.route }));
beforeEach(() => { setActivePinia(createPinia()); navigation.route = reactive({ fullPath: "/plugins?tab=experts" }); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ""; });
function render(show = ref(true), active = ref(true), openVersion = ref<string | undefined>(undefined)) {
  wrapper = mount(defineComponent({ components: { NConfigProvider, NDialogProvider, ExpertMarketPanel }, setup: () => ({ show, active, openVersion, expertId: expertEntry.display.expertId }), template: "<NConfigProvider><NDialogProvider><ExpertMarketPanel v-if='show' :active='active' :open-expert-id='openVersion ? expertId : undefined' :open-expert-version='openVersion' /></NDialogProvider></NConfigProvider>" }), { attachTo: document.body });
  return wrapper;
}
describe("expert candidate panel", () => {
  it.each(["close", "escape"] as const)("FEAT158 restores the actual card trigger after details %s without depending on mouse focus", async (action) => {
    const store = useExpertsStore(); store.contextId = id(1); store.scope = "scope-one";
    store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
    const view = render();
    const trigger = view.get<HTMLButtonElement>(".expert-card__details");
    // A mouse click in macOS WebKit need not focus the button before opening.
    expect(document.activeElement).not.toBe(trigger.element);
    await trigger.trigger("click"); await flushPromises();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    if (action === "close") document.querySelector<HTMLButtonElement>(".expert-detail .n-card-header__close")!.click();
    else document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger.element);
  });
  it.each(["navigate", "context", "inactive", "unmount"] as const)("FEAT158 does not restore a stale detail trigger after %s", async (change) => {
    const store = useExpertsStore(); store.contextId = id(1); store.scope = "scope-one";
    store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
    const show = ref(true), active = ref(true), view = render(show, active);
    const trigger = view.get<HTMLButtonElement>(".expert-card__details");
    await trigger.trigger("click"); await flushPromises();
    const focus = vi.spyOn(trigger.element, "focus");
    document.querySelector<HTMLButtonElement>(".expert-detail .n-card-header__close")!.click();
    if (change === "navigate") navigation.route.fullPath = "/chat";
    else if (change === "context") store.contextId = id(2);
    else if (change === "inactive") active.value = false;
    else show.value = false;
    await flushPromises();
    expect(focus).not.toHaveBeenCalled();
  });
  it("shows unavailable without filling the catalog with synthetic experts", () => {
    const view = render();
    expect(view.text()).toContain("专家服务暂不可用");
    expect(view.findAll(".expert-card")).toHaveLength(0);
  });
  it("keeps summon disabled when resource preparation is complete but execution is unavailable", () => {
    const store = useExpertsStore();
    store.contextId = id(1); store.snapshot = expertSnapshot({ ...expertEntry, state: "ready" });
    const view = render();
    expect(view.text()).toContain("资源已准备");
    expect(view.text()).toContain("当前执行环境暂不支持专家会话");
    const summon = view.findAll("button").find(button => button.text() === "召唤专家");
    expect(summon?.attributes("disabled")).toBeDefined();
  });
  it("emits summon only when the Native execution projection is available", async () => {
    const store = useExpertsStore(); store.contextId = id(1);
    store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
    const view = render(); const panel = view.findComponent(ExpertMarketPanel);
    const summon = view.findAll("button").find(button => button.text() === "召唤专家")!;
    await summon.trigger("click");
    expect(panel.emitted("summon")?.[0]).toEqual([{ ...expertEntry, state: "ready" }]);
    expect(document.body.textContent).not.toContain("可以这样提问");
  });
  it("opens the exact selected version from the chat chip", async () => {
    const store = useExpertsStore(); store.contextId = id(1);
    store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
    render(ref(true), ref(true), ref(expertEntry.display.version)); await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`${expertEntry.display.subtitle} · ${expertEntry.display.version}`);
    expect(document.body.textContent).not.toContain("所选专家版本详情不可用");
  });
  it("does not replace unavailable selected-version details with a newer catalog version", async () => {
    const store = useExpertsStore(); store.contextId = id(1);
    const newer = { ...expertEntry, display: { ...expertEntry.display, version: "0.2.0" }, state: "ready" as const };
    store.snapshot = { ...expertSnapshot(newer), executionAvailable: true };
    const view = render(ref(true), ref(true), ref(expertEntry.display.version)); await flushPromises();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("所选专家版本详情不可用");
    expect(dialog.textContent).toContain(`所选版本 ${expertEntry.display.version}`);
    expect(dialog.textContent).not.toContain("0.2.0");
    expect(view.findComponent(ExpertMarketPanel).emitted("summon")).toBeUndefined();
    [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === "返回专家目录")!.click(); await flushPromises();
    await view.get(".expert-card__details").trigger("click"); await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`${expertEntry.display.subtitle} · 0.2.0`);
  });
  it.each(["navigate", "context", "scope", "inactive", "unmount"] as const)("closes the original removal dialog on %s without removing resources", async (change) => {
    const store = useExpertsStore(); store.contextId = id(1); store.scope = "scope-one";
    store.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
    const remove = vi.spyOn(store, "execute").mockResolvedValue(true), show = ref(true), active = ref(true);
    try {
      const view = render(show, active);
      await view.find(".expert-card__details").trigger("click"); await flushPromises();
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === "移除资源")!.click();
      await flushPromises();
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('.n-dialog button')].find(button => button.textContent?.trim() === "移除")!;
      expect(confirm).toBeDefined();
      if (change === "navigate") navigation.route.fullPath = "/plugins?tab=skills";
      else if (change === "context") store.contextId = id(2);
      else if (change === "scope") store.scope = "scope-two";
      else if (change === "inactive") active.value = false;
      else show.value = false;
      await flushPromises();
      // Naive retains the hidden node until its normal leave transition finishes.
      const dismissed = document.querySelector<HTMLElement>('.n-dialog');
      expect(!dismissed || getComputedStyle(dismissed).display === "none").toBe(true);
      confirm.click(); await flushPromises();
      expect(remove).not.toHaveBeenCalled();
    } finally { remove.mockRestore(); }
  });
  it("explicit recovery confirms once and invokes only the original recovery command plus catalog read", async () => {
    const store = useExpertsStore(); store.contextId = id(1); store.scope = "scope-one";
    const expert = { expertId: expertEntry.display.expertId, version: expertEntry.display.version };
    const original = { operationId: id(8), expert, action: "prepare" as const, state: "unknown" as const, errorCode: "outcome_unknown" as const };
    const ended = { ...original, state: "rejected" as const, errorCode: "request_conflict" as const };
    const key = `${expert.expertId}@${expert.version}`;
    store.snapshot = expertSnapshot({ ...expertEntry, state: "unavailable", operation: original });
    store.operations = { [key]: original };
    const transport = vi.fn(async (command, { request }) => ({ schemaVersion: 1, requestId: request.requestId, data: command === "experts_snapshot_v1" ? expertSnapshot({ ...expertEntry, operation: ended }) : ended }));
    const client = createExpertNativeClient(transport);
    const recover = vi.spyOn(expertNativeClient, "recoverOperation").mockImplementation(client.recoverOperation);
    const snapshot = vi.spyOn(expertNativeClient, "snapshot").mockImplementation(client.snapshot);
    try {
      const view = render();
      expect(view.text()).toContain("查询状态");
      await view.findAll("button").find(button => button.text() === "处理未完成操作")!.trigger("click"); await flushPromises();
      expect(transport).not.toHaveBeenCalled();
      [...document.querySelectorAll<HTMLButtonElement>('.n-dialog button')].find(button => button.textContent?.trim() === "处理未完成操作")!.click();
      await flushPromises();
      expect(transport.mock.calls.map(call => call[0])).toEqual(["experts_operation_recover_v1", "experts_snapshot_v1"]);
      expect(transport.mock.calls[0]![1].request.payload).toEqual({ operationId: id(8) });
      expect(store.operations[key]).toEqual(ended);
      expect(view.text()).toContain("原操作已结束，可重新准备或移除资源");
    } finally { recover.mockRestore(); snapshot.mockRestore(); }
  });
});
