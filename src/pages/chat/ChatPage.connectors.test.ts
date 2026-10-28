// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { marketConnectorClient } from "../../api/market-connectors-client";
import type { Installation, Snapshot } from "../../domain/market-connectors.generated";
import { CHAT_NEW_DRAFT_TARGET, chatSessionDraftTarget, type ChatAttachment } from "../../domain/chat-ipc";
import { useChatComposerDraftStore } from "../../stores/chat-composer-drafts.store";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import { useMarketConnectorStore } from "../../stores/market-connectors.store";
import ChatPage from "./ChatPage.vue";

vi.mock("../../api/market-connectors-client", async original => {
  const actual = await original<typeof import("../../api/market-connectors-client")>();
  return { ...actual, marketConnectorsEnabled: true };
});
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }) }));
vi.mock("../../authorization/experts-ui-config", () => ({ expertsUiEnabled: false }));
const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const READY_ATTACHMENT: ChatAttachment = { attachmentId: "019c1a00-0000-7000-8000-000000000010", type: "file", name: "synthetic-brief.pdf", mediaType: "application/pdf", sizeBytes: 4096, status: "ready", expiresAt: 2_000_000_000 };
const connectorInstallation: Installation = { installationId: "019c1a00-0000-7000-8000-000000000030", serviceId: "sample", revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "configured", authorizationStatus: "authorized", connectionStatus: "disconnected" };
function connectorSnapshot(item = connectorInstallation): Snapshot {
  return { catalogRevision: 1, catalog: [{ serviceId: "sample", serverName: "sample", displayName: "普通合成连接器", description: "普通合成资料，无外部请求", categoryId: "productivity", categoryLabel: "效率工具", iconAssetId: "cue", transport: "http", authMode: "oauth", availability: "available", blockerCodes: [] }], installations: [item], capabilities: ["connector.read", "connector.manage", "connector.credentials.manage", "connector.use"], executionAvailable: true };
}

const wrappers: ReturnType<typeof mount>[] = [];
async function mountPage(path: string, active = false, initialSnapshot = connectorSnapshot()) {
  const pinia = createPinia(); setActivePinia(pinia);
  const permission = usePermissionStore(pinia);
  vi.spyOn(permission, "hasCapability").mockImplementation(capability => permission.capabilities.includes(capability));
  permission.selectedTenantId = PROJECT_ID;
  permission.capabilities = ["task.read", "task.create", ...connectorSnapshot().capabilities];
  permission.phase = "ready";
  vi.spyOn(marketConnectorClient, "snapshot").mockResolvedValue(initialSnapshot);
  const store = useChatStore(pinia);
  store.phase = "ready";
  store.context = { contextId: "019c1a00-0000-7000-8000-000000000006", expiresAtEpochSeconds: 2_000_000_000, allowedActions: ["read_sessions", "create_session", "submit_turn", "read_projects", "use_project"] };
  store.projects = [{ projectId: PROJECT_ID, safeName: "Synthetic Workspace", pinnedAt: null, lastUsedAt: 1, available: true }];
  store.sessions = active ? [{ sessionId: SESSION_ID, projectId: PROJECT_ID, title: "普通合成对话", titleSource: "fallback", pinnedAt: null, lastActivityAt: 3, latestTurnStatus: "completed", projectAvailable: true }] : [];
  store.selectedSessionId = active ? SESSION_ID : null;
  store.selectedAccessMode = active ? "live" : null;
  store.selectedSessionPurpose = active ? "ordinary" : null;
  store.draftTarget = active ? chatSessionDraftTarget(SESSION_ID) : CHAT_NEW_DRAFT_TARGET;
  store.draftTargetReady = true;
  store.history = active ? { turns: [], nextCursor: null } : null;
  store.localReadiness = { lifecycle: "ready", host: "ready", runtime: "ready", storage: "ready", canSend: true, issueCode: null, retryable: false, recovery: "none" };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/chat", component: ChatPage },
    { path: "/chat/:sessionId", component: ChatPage },
    { path: "/connectors", component: { template: "<div>连接器管理</div>" } },
  ] });
  await router.push(path); await router.isReady();
  const wrapper = mount(ChatPage, { attachTo: document.body, global: { plugins: [pinia, router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, store };
}
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => { if (wrapper.exists()) wrapper.unmount(); });
  vi.useRealTimers(); vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function openConnectorMenu(wrapper: Awaited<ReturnType<typeof mountPage>>["wrapper"]) {
  await wrapper.get('[aria-label="可添加文件、技能、连接器"]').trigger("click");
  await flushPromises();
  await new DOMWrapper(document.querySelector<HTMLElement>('[data-resource-menu="connectors"]')!).trigger("mouseenter");
  await flushPromises();
  return new DOMWrapper(document.querySelector<HTMLElement>('.connector-menu__list [role="switch"]')!);
}

const ready = { ...connectorInstallation, desiredEnabled: true, effectiveEnabled: true, connectionStatus: "ready" as const };

it.each([false, true])("changes only this conversation selection and keeps the draft (existing session=%s)", async active => {
  const path = active ? `/chat/${SESSION_ID}` : "/chat";
  const { wrapper, router, store } = await mountPage(path, active, connectorSnapshot(ready));
  const global = vi.spyOn(marketConnectorClient, "setEnabled");
  const configure = vi.spyOn(marketConnectorClient, "configure");
  await wrapper.get("textarea").setValue("保留当前未发送内容"); store.draftAttachments = [READY_ATTACHMENT];
  const control = await openConnectorMenu(wrapper);
  expect(control.attributes("aria-checked")).toBe("false");
  await control.trigger("click"); await flushPromises();
  expect(control.attributes("aria-checked")).toBe("true");
  expect(wrapper.findAll(".chat-connector-chip__button")).toHaveLength(1);
  const drafts = useChatComposerDraftStore(), target = active ? `session:${SESSION_ID}` as const : "new";
  expect(drafts.selection(target)).toHaveLength(1);
  drafts.setSelection("session:other-conversation", drafts.selection(target));
  await control.trigger("click"); await flushPromises();
  await useMarketConnectorStore().refresh(); await flushPromises();
  expect(drafts.selection(target)).toEqual([]);
  expect(drafts.selection("session:other-conversation")).toHaveLength(1);
  expect(useMarketConnectorStore().installation("sample")?.desiredEnabled).toBe(true);
  expect(control.attributes("aria-checked")).toBe("false");
  expect(wrapper.findAll(".chat-connector-chip__button")).toHaveLength(0);
  expect(global).not.toHaveBeenCalled(); expect(configure).not.toHaveBeenCalled();
  expect(router.currentRoute.value.path).toBe(path);
  expect(wrapper.get("textarea").element.value).toBe("保留当前未发送内容");
  expect(store.draftAttachments).toEqual([READY_ATTACHMENT]);
});

it("preserves an explicit deselection across navigation back to the conversation", async () => {
  const { wrapper, router } = await mountPage("/chat", false, connectorSnapshot(ready));
  const control = await openConnectorMenu(wrapper);
  await control.trigger("click"); await flushPromises();
  await control.trigger("click"); await flushPromises();
  await router.push("/connectors"); await router.push("/chat"); await flushPromises();
  await useMarketConnectorStore().refresh(); await flushPromises();
  expect(useChatComposerDraftStore().selection("new")).toEqual([]);
  expect(useMarketConnectorStore().installation("sample")?.desiredEnabled).toBe(true);
});

it("takes unready connectors to management without a configuration side effect", async () => {
  const { wrapper, router } = await mountPage("/chat");
  const configure = vi.spyOn(marketConnectorClient, "configure"), enable = vi.spyOn(marketConnectorClient, "setEnabled");
  const control = await openConnectorMenu(wrapper);
  expect(control.attributes("aria-disabled")).toBe("true");
  await new DOMWrapper(document.querySelector<HTMLElement>('[data-connector-option]')!).trigger("click"); await flushPromises();
  expect(router.currentRoute.value.path).toBe("/connectors");
  expect(configure).not.toHaveBeenCalled(); expect(enable).not.toHaveBeenCalled();
  expect(useChatComposerDraftStore().selection("new")).toEqual([]);
});

it("warns for a selected connection loss and refreshes only its reference after recovery", async () => {
  const { wrapper } = await mountPage("/chat", false, connectorSnapshot(ready));
  await (await openConnectorMenu(wrapper)).trigger("click"); await flushPromises();
  vi.mocked(marketConnectorClient.snapshot).mockResolvedValue(connectorSnapshot({ ...ready, effectiveEnabled: false, connectionStatus: "failed", errorCode: "temporarily_unavailable" }));
  await useMarketConnectorStore().refresh(); await flushPromises();
  expect(wrapper.findAll(".chat-connector-chip__button--unavailable")).toHaveLength(1);
  expect(useChatComposerDraftStore().selection("new")).toHaveLength(1);
  vi.mocked(marketConnectorClient.snapshot).mockResolvedValue(connectorSnapshot({ ...ready, revision: 2 }));
  await useMarketConnectorStore().refresh(); await flushPromises();
  expect(useChatComposerDraftStore().selection("new")[0]?.reference.revision).toBe(2);
  expect(wrapper.findAll(".chat-connector-chip__button--unavailable")).toHaveLength(0);
});
