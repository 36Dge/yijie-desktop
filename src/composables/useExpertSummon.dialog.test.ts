// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { NConfigProvider, NDialogProvider } from "naive-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatComposerDraftStore } from "../stores/chat-composer-drafts.store";
import { useExpertsStore } from "../stores/experts.store";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId as id } from "../test/expert-fixture";
import { useExpertSummon } from "./useExpertSummon";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), useRouter: () => router }));
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => { setActivePinia(createPinia()); router.push.mockReset(); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ""; });

async function openConfirmation() {
  const drafts = useChatComposerDraftStore();
  drafts.texts = { new: "保留原来的准备清单" } as typeof drafts.texts;
  const resources = useExpertsStore();
  resources.contextId = id(1); resources.scope = "scope-one";
  resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  let summon!: ReturnType<typeof useExpertSummon>["summon"];
  const Child = defineComponent({ setup() { summon = useExpertSummon().summon; return () => h("button", "快捷问题"); } });
  wrapper = mount(defineComponent({ setup: () => () => h(NConfigProvider, null, { default: () => h(NDialogProvider, null, { default: () => h(Child) }) }) }), { attachTo: document.body, global: { stubs: { transition: false } } });
  await summon({ ...expertEntry, state: "ready" }, "新的参考问题");
  await flushPromises(); await nextTick();
  return drafts;
}

describe("expert prefill confirmation with the real Naive dialog", () => {
  it("initially focuses the primary keep action and preserves the draft on activation", async () => {
    const drafts = await openConfirmation();
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.tagName).toBe("BUTTON");
    expect(focused.textContent).toContain("保留当前草稿");
    expect(focused.classList.contains("n-button--primary-type")).toBe(true);
    // happy-dom does not synthesize the browser's Enter -> button click default.
    const down = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    focused.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    focused.click(); focused.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(drafts.texts.new).toBe("保留原来的准备清单");
    expect(drafts.expert("new")).toEqual(expertDisplay);
    expect(router.push).toHaveBeenCalledWith({ path: "/chat", query: { focus: "composer" } });
  });
  it("replaces text only through the explicit replace action", async () => {
    const drafts = await openConfirmation();
    expect(document.activeElement?.textContent).toContain("保留当前草稿");
    const replace = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent?.includes("替换文字"));
    expect(replace).toBeDefined();
    replace!.focus(); replace!.click(); await flushPromises();
    expect(drafts.texts.new).toBe("新的参考问题");
    expect(router.push).toHaveBeenCalledOnce();
  });
});
