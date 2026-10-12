// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, defineComponent, reactive } from "vue";
import { createMemoryHistory, useRouter } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import App from "../../App.vue";
import { createAppRouter } from "../../router";
import { expertNativeClient } from "../../api/expert-native-client";
import { createPermissionStoreDefinition } from "../../stores/permission.store";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import { useExpertsStore } from "../../stores/experts.store";
import ChatExpertChip from "../../components/experts/ChatExpertChip.vue";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId as id } from "../../test/expert-fixture";
import ExtensionsPage from "./ExtensionsPage.vue";

const boundaries = vi.hoisted(() => ({ permission: null as unknown, chat: null as unknown }));
vi.mock("../../authorization/experts-ui-config", () => ({ expertsUiEnabled: true }));
vi.mock("../../authorization/permission-ui-config", () => ({ authoritativePermissionUiEnabled: true }));
vi.mock("../../authorization/chat-ui-config", () => ({ localChatUiEnabled: true }));
vi.mock("../../authorization/skill-marketplace-ui-config", () => ({ skillMarketplaceUiEnabled: true }));
// App's CSS entrypoint is not loaded by this DOM test; theme tokens are unrelated
// to the permission lifecycle or the real Naive modal/dialog interaction.
vi.mock("../../design/theme/naive-theme", () => ({ createNaiveThemeOverrides: () => ({}) }));
vi.mock("../../authorization/local-profile", async original => ({ ...await original<typeof import("../../authorization/local-profile")>(), demoFastLocalProfileEnabled: true }));
vi.mock("../../stores/chat.store", () => ({ useChatStore: () => boundaries.chat }));
vi.mock("../../stores/permission.store", async original => ({ ...await original<typeof import("../../stores/permission.store")>(), usePermissionStore: () => boundaries.permission }));
vi.mock("../../components/yijie/YjAppShell.vue", () => ({ default: { template: "<main><slot /></main>" } }));
vi.mock("../../components/schedules/ScheduledUpdates.vue", () => ({ default: { template: "<span />" } }));
vi.mock("../../components/chat/ChatDeletionUpdates.vue", () => ({ default: { template: "<span />" } }));
vi.mock("../../api/skill-native-client", async original => ({ ...await original<typeof import("../../api/skill-native-client")>(), skillNativeClient: {
  list: vi.fn(async () => ({ schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] })),
  scan: vi.fn(async () => ({ schemaVersion: 1, scannedAt: "2026-10-11T00:00:00Z", skills: [] })),
  subscribeDirectoryChanged: vi.fn(async () => () => {}),
} }));

let view: ReturnType<typeof mount> | undefined;
let permission: ReturnType<ReturnType<typeof createPermissionStoreDefinition>> | undefined;
afterEach(async () => {
  view?.unmount(); view = undefined;
  permission?.$dispose(); permission = undefined;
  await flushPromises();
  vi.useRealTimers(); vi.restoreAllMocks();
  document.body.innerHTML = "";
});

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
  template: '<section><h1>对话草稿</h1><textarea aria-label="测试草稿" :value="drafts.texts.new" /><button @click="open">选择专家</button><ChatExpertChip v-if="selected" :expert="selected" @details="details" /></section>',
});

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (getComputedStyle(current).display === "none") return false;
  }
  return true;
}
function button(text: string, selector = "button"): HTMLButtonElement {
  const matches = [...document.querySelectorAll<HTMLButtonElement>(selector)].filter(item => item.textContent?.trim() === text && visible(item));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

it("FEAT158 explains normal same-scope permission renewal cancelling a quick-prompt confirmation and accepts a fresh explicit selection", async () => {
  // Advance only ordinary projection time: actual demo_fast TTL is 240 s and
  // the production permission store renews 30 s early. No fault is introduced.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(Date.parse("2026-10-11T12:00:00Z"));
  const pinia = createPinia(); setActivePinia(pinia);
  const getMyCapabilities = vi.fn(async () => ({ tenantId: id(9), authorizationRevision: 1, expiresAt: new Date(Date.now() + 240_000).toISOString(), expiresAtEpochMs: Date.now() + 240_000, capabilities: ["plugin.manage", "plugin.read", "task.create", "task.read"] as const }));
  permission = createPermissionStoreDefinition({ listMyTenants: async () => [{ tenantId: id(9), displayName: "合成租户" }], getMyCapabilities }, "expert-prefill-permission-renewal")();
  boundaries.permission = permission;
  await permission.ensureInitialized();

  // Normal Native context replies only: real App, permission store, timer,
  // chat permission lifecycle and both expert binding composables run unchanged.
  let contextSequence = 0;
  const chat = reactive({
    context: null as { contextId: string } | null, phase: "idle", isReady: true,
    selectedSessionId: null, draftTarget: { type: "new" }, draftTargetReady: true,
    draftAttachments: [], sessions: [], deleteDisposition: null,
    bind: vi.fn(async () => { await Promise.resolve(); chat.context = { contextId: id(++contextSequence) }; chat.phase = "ready"; }),
    dispose: vi.fn(async () => { chat.context = null; chat.phase = "idle"; }),
    isAuthorityBound: () => chat.context !== null,
  });
  boundaries.chat = chat;
  const ready = { ...expertEntry, state: "ready" as const, quickPrompts: ["整理上架前准备事项", "核对本周复盘资料"] };
  const snapshot = vi.spyOn(expertNativeClient, "snapshot").mockResolvedValue({ ...expertSnapshot(ready), executionAvailable: true });
  const submit = vi.spyOn(expertNativeClient, "submit"), prepare = vi.spyOn(expertNativeClient, "prepare"), binding = vi.spyOn(expertNativeClient, "setBinding");
  const drafts = useChatComposerDraftStore();
  const original = "合成快捷问题验收草稿：保留这段文字。";
  drafts.texts = { new: original } as typeof drafts.texts;
  const other = async () => defineComponent({ template: "<h1>其他页面</h1>" });
  const router = createAppRouter(createMemoryHistory(), { enabled: true, get ready() { return permission!.isReady; }, ensureInitialized: () => permission!.ensureInitialized(), hasCapability: key => permission!.hasCapability(key) }, {
    chat: async () => DraftPage, store: other, workflows: other, settings: other, accessDenied: other, plugins: async () => ExtensionsPage,
  }, true, true, true, true);
  await router.push("/chat");
  view = mount(App, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  expect(chat.bind).toHaveBeenCalledOnce();

  button("选择专家").click(); await flushPromises();
  document.querySelector<HTMLButtonElement>(".expert-card__details")!.click(); await flushPromises();
  button(ready.quickPrompts[0]!, ".expert-detail button").click(); await flushPromises();
  button("保留当前草稿", ".n-dialog button").click(); await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/chat?focus=composer");
  expect(drafts.texts.new).toBe(original);
  expect(drafts.expert("new")).toEqual(expertDisplay);

  document.querySelector<HTMLButtonElement>(".chat-expert-chip__details")!.click(); await flushPromises();
  button(ready.quickPrompts[1]!, ".expert-detail button").click(); await flushPromises();
  const originalReplace = button("替换文字", ".n-dialog button");
  const originalContext = chat.context!.contextId;
  await vi.advanceTimersByTimeAsync(210_000); await flushPromises();
  expect(getMyCapabilities).toHaveBeenCalledTimes(2);
  expect(chat.bind).toHaveBeenCalledTimes(2);
  expect(chat.context!.contextId).not.toBe(originalContext);
  expect(useExpertsStore().scope).toBe(`local:${id(9)}`);
  expect(permission.authorizationRevision).toBe(1);
  expect(visible(originalReplace)).toBe(false);
  originalReplace.click(); await flushPromises();
  expect(router.currentRoute.value.path).toBe("/plugins");
  expect(drafts.texts.new).toBe(original);
  expect(document.querySelector(".expert-detail")?.textContent).toContain("授权状态已更新，本次操作未执行");

  // A new explicit click captures the renewed context; the stale confirmation
  // never gets rebased, retried or allowed to mutate the draft.
  button(ready.quickPrompts[1]!, ".expert-detail button").click(); await flushPromises();
  button("替换文字", ".n-dialog button").click(); await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/chat?focus=composer");
  expect(drafts.texts.new).toBe(ready.quickPrompts[1]);
  expect(snapshot).toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(binding).not.toHaveBeenCalled();
});
