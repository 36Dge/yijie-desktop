// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { NConfigProvider, NDialogProvider, NMessageProvider } from "naive-ui";
import { computed, defineComponent } from "vue";
import { createMemoryHistory, RouterView, useRouter } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import { createAppRouter } from "../../router";
import { expertNativeClient } from "../../api/expert-native-client";
import ChatExpertChip from "../../components/experts/ChatExpertChip.vue";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import { useExpertsStore } from "../../stores/experts.store";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId } from "../../test/expert-fixture";
import ExtensionsPage from "./ExtensionsPage.vue";

vi.mock("../../authorization/experts-ui-config", () => ({ expertsUiEnabled: true }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => ({ context: { contextId: "019c1a00-0000-7000-8000-000000000001" }, draftAttachments: [], sessions: [] }) }));
vi.mock("../../stores/permission.store", () => ({ usePermissionStore: () => ({ selectedTenantId: "test", phase: "ready", capabilities: ["plugin.read", "plugin.manage", "task.create", "task.read"], hasCapability: () => true }) }));
vi.mock("../../api/skill-native-client", async (original) => ({ ...await original<typeof import("../../api/skill-native-client")>(), skillNativeClient: {
  list: vi.fn(async () => ({ schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] })),
  scan: vi.fn(async () => ({ schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] })),
  subscribeDirectoryChanged: vi.fn(async () => () => {}),
} }));

let view: ReturnType<typeof mount> | undefined;
afterEach(() => { view?.unmount(); view = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

// The destination harness uses the real shared draft and chip, without starting
// Chat's Native/Host subscriptions. Extensions, summon, binding stores, router,
// detail modal and confirmation dialog remain real.
const DraftPage = defineComponent({
  components: { ChatExpertChip },
  setup() {
    const drafts = useChatComposerDraftStore(), router = useRouter();
    const selected = computed(() => drafts.expert("new"));
    function details() {
      if (selected.value) void router.push({ path: "/plugins", query: { tab: "experts", from: "/chat", expert: selected.value.expertId, expertVersion: selected.value.version } });
    }
    return { drafts, selected, details, open: () => router.push({ path: "/plugins", query: { tab: "experts", from: "/chat" } }) };
  },
  template: '<section><h1>对话草稿</h1><textarea aria-label="测试草稿" :value="drafts.texts.new" /><button type="button" @click="open">选择专家</button><ChatExpertChip v-if="selected" :expert="selected" @details="details" /></section>',
});

function button(text: string, selector = "button"): HTMLButtonElement {
  const matches = [...document.querySelectorAll<HTMLButtonElement>(selector)].filter(item => item.textContent?.trim() === text && getComputedStyle(item).display !== "none");
  const found = matches[matches.length - 1];
  expect(found, `visible ${text} action`).toBeDefined();
  return found!;
}

it("FEAT158 keeps an existing draft, then replaces it from the already-selected expert capsule using real nested dialogs and memory routing", async () => {
  setActivePinia(createPinia());
  const drafts = useChatComposerDraftStore();
  const original = "合成快捷问题验收草稿：保留这段文字。";
  drafts.texts = { new: original } as typeof drafts.texts;
  const ready = { ...expertEntry, state: "ready" as const, quickPrompts: ["整理上架前准备事项", "核对本周复盘资料"] };
  const resources = useExpertsStore();
  resources.contextId = expertTestId(1); resources.scope = "local:test";
  resources.snapshot = { ...expertSnapshot(ready), executionAvailable: true };
  const submit = vi.spyOn(expertNativeClient, "submit");
  const prepare = vi.spyOn(expertNativeClient, "prepare");
  const setBinding = vi.spyOn(expertNativeClient, "setBinding");
  const other = async () => defineComponent({ template: "<h1>其他页面</h1>" });
  const router = createAppRouter(createMemoryHistory(), { enabled: true, ready: true, ensureInitialized: async () => undefined, hasCapability: () => true }, {
    chat: async () => DraftPage, store: other, workflows: other, settings: other, accessDenied: other, plugins: async () => ExtensionsPage,
  }, true, true, true, true);
  await router.push("/chat");
  view = mount(defineComponent({ components: { NConfigProvider, NDialogProvider, NMessageProvider, RouterView }, template: "<NConfigProvider><NMessageProvider><NDialogProvider><main><RouterView /></main></NDialogProvider></NMessageProvider></NConfigProvider>" }), { attachTo: document.body, global: { plugins: [router], stubs: { transition: false } } });
  await flushPromises();

  button("选择专家").click(); await flushPromises();
  document.querySelector<HTMLButtonElement>(".expert-card__details")!.click(); await flushPromises();
  button(ready.quickPrompts[0]!, ".expert-detail button").click(); await flushPromises();
  expect(drafts.texts.new).toBe(original);
  button("保留当前草稿", ".n-dialog button").click(); await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/chat?focus=composer");
  expect(drafts.texts.new).toBe(original);
  expect(drafts.expert("new")).toEqual(expertDisplay);

  document.querySelector<HTMLButtonElement>(".chat-expert-chip__details")!.click(); await flushPromises();
  expect(router.currentRoute.value.query).toMatchObject({ from: "/chat", expert: expertDisplay.expertId, expertVersion: expertDisplay.version });
  button(ready.quickPrompts[1]!, ".expert-detail button").click(); await flushPromises();
  button("替换文字", ".n-dialog button").click(); await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/chat?focus=composer");
  expect(drafts.texts.new).toBe(ready.quickPrompts[1]);
  expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="测试草稿"]')?.value).toBe(ready.quickPrompts[1]);
  expect(drafts.expert("new")).toEqual(expertDisplay);
  expect(submit).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(setBinding).not.toHaveBeenCalled();
});
