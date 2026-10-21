// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ConnectorClientError, marketConnectorClient } from "../../api/market-connectors-client";
import type { Installation, MutationResult, Snapshot } from "../../domain/market-connectors.generated";
import { CHAT_NEW_DRAFT_TARGET, chatSessionDraftTarget, type ChatAttachment } from "../../domain/chat-ipc";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import { useMarketConnectorStore } from "../../stores/market-connectors.store";
import ChatPage from "./ChatPage.vue";

vi.mock("../../api/market-connectors-client", async original => {
  const actual = await original<typeof import("../../api/market-connectors-client")>();
  return { ...actual, marketConnectorsEnabled: true };
});
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => undefined }) }));
vi.mock("../../authorization/experts-ui-config", () => ({ expertsUiEnabled: false }));
const PROJECT_ID = "019c1a00-0000-7000-8000-000000000001";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000002";
const READY_ATTACHMENT: ChatAttachment = { attachmentId: "019c1a00-0000-7000-8000-000000000010", type: "file", name: "synthetic-brief.pdf", mediaType: "application/pdf", sizeBytes: 4096, status: "ready", expiresAt: 2_000_000_000 };
const connectorInstallation: Installation = { installationId: "019c1a00-0000-7000-8000-000000000030", serviceId: "sample", revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "configured", authorizationStatus: "authorized", connectionStatus: "disconnected" };
function connectorSnapshot(item = connectorInstallation): Snapshot {
  return { catalogRevision: 1, catalog: [{ serviceId: "sample", serverName: "sample", displayName: "普通合成连接器", description: "普通合成资料，无外部请求", categoryId: "productivity", categoryLabel: "效率工具", iconAssetId: "cue", transport: "http", authMode: "oauth", availability: "available", blockerCodes: [] }], installations: [item], capabilities: ["connector.read", "connector.manage", "connector.credentials.manage", "connector.use"], executionAvailable: true };
}

const wrappers: ReturnType<typeof mount>[] = [];
async function mountPage(path: string, active = false) {
  const pinia = createPinia(); setActivePinia(pinia);
  const permission = usePermissionStore(pinia);
  vi.spyOn(permission, "hasCapability").mockImplementation(capability => permission.capabilities.includes(capability));
  permission.selectedTenantId = PROJECT_ID;
  permission.capabilities = ["task.read", "task.create", ...connectorSnapshot().capabilities];
  permission.phase = "ready";
  vi.spyOn(marketConnectorClient, "snapshot").mockResolvedValue(connectorSnapshot());
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

it.each([false, true])("enables a connector in place and preserves the chat draft (existing session: %s)", async active => {
  const path = active ? `/chat/${SESSION_ID}` : "/chat";
  const { wrapper, router, store } = await mountPage(path, active);
  const push = vi.spyOn(router, "push");
  await wrapper.get("textarea").setValue("保留当前未发送内容");
  store.draftAttachments = [READY_ATTACHMENT];
  const control = await openConnectorMenu(wrapper);
  let finish!: (result: MutationResult) => void;
  const enable = vi.spyOn(marketConnectorClient, "setEnabled").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await control.trigger("click"); await flushPromises();
  expect(enable).toHaveBeenCalledTimes(1);
  expect(enable.mock.calls[0]?.[2]).toBe(true);
  expect(control.attributes("aria-checked")).toBe("false");
  expect(control.attributes("aria-disabled")).toBe("true");
  expect(document.body.textContent).toContain("处理中");
  const installed = { ...connectorInstallation, revision: 2, desiredEnabled: true, effectiveEnabled: true, connectionStatus: "ready" as const };
  vi.mocked(marketConnectorClient.snapshot).mockResolvedValue(connectorSnapshot(installed));
  finish({ installation: installed, operation: { operationId: enable.mock.calls[0]![3], installationId: installed.installationId, serviceId: "sample", action: "enable", status: "succeeded", revision: 2, cancellable: false } });
  await flushPromises();
  expect(control.attributes("aria-checked")).toBe("true");
  expect(push).not.toHaveBeenCalled();
  expect(router.currentRoute.value.path).toBe(path);
  expect(wrapper.get("textarea").element.value).toBe("保留当前未发送内容");
  expect(store.draftAttachments).toEqual([READY_ATTACHMENT]);
  expect(document.querySelector('[aria-label="选择本轮连接器"] [data-connector-option]')?.getAttribute("aria-checked")).toBe("false");
  expect(wrapper.get('[aria-label="可添加文件、技能、连接器"]').attributes("aria-expanded")).toBe("true");
  wrapper.unmount();
});

it("keeps a connector activation failure in the menu without navigating or pretending it is enabled", async () => {
  const { wrapper, router } = await mountPage("/chat");
  const control = await openConnectorMenu(wrapper);
  const enable = vi.spyOn(marketConnectorClient, "setEnabled").mockRejectedValue(new ConnectorClientError("not_configured"));
  await control.trigger("click"); await flushPromises();
  expect(enable).toHaveBeenCalledTimes(1);
  expect(router.currentRoute.value.path).toBe("/chat");
  expect(control.attributes("aria-checked")).toBe("false");
  expect(document.querySelector('.connector-menu__operation-error[role="alert"]')?.textContent).toContain("配置");
  wrapper.unmount();
});

it("starts configuration in place and observes the original operation until completion", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { wrapper, router } = await mountPage("/chat");
  const installed = { ...connectorInstallation, configurationStatus: "unconfigured" as const };
  vi.mocked(marketConnectorClient.snapshot).mockResolvedValue(connectorSnapshot(installed));
  const connectors = useMarketConnectorStore();
  await connectors.refresh();
  const control = await openConnectorMenu(wrapper);
  const configure = vi.spyOn(marketConnectorClient, "configure").mockImplementation(async (_context, item, id) => ({ installation: item, operation: { operationId: id, installationId: item.installationId, serviceId: "sample", action: "configure", status: "pending", revision: 2, cancellable: true } }));
  await control.trigger("click"); await flushPromises();
  expect(configure).toHaveBeenCalledTimes(1);
  expect(router.currentRoute.value.path).toBe("/chat");
  expect(control.attributes("aria-checked")).toBe("false");
  const id = configure.mock.calls[0]![2];
  const operation = vi.spyOn(marketConnectorClient, "operation").mockResolvedValue({ operationId: id, installationId: installed.installationId, serviceId: "sample", action: "configure", status: "succeeded", revision: 3, cancellable: false });
  vi.mocked(marketConnectorClient.snapshot).mockResolvedValue(connectorSnapshot({ ...connectorInstallation, revision: 3, desiredEnabled: true, effectiveEnabled: true, connectionStatus: "ready" }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1100);
  expect(operation).not.toHaveBeenCalled();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1100); await flushPromises();
  expect(operation).toHaveBeenCalledExactlyOnceWith(expect.any(String), id);
  expect(configure).toHaveBeenCalledTimes(1);
  expect(control.attributes("aria-checked")).toBe("true");
  const observe = vi.spyOn(connectors, "setOperationObservation");
  wrapper.unmount();
  expect(observe).toHaveBeenLastCalledWith(false);
  await vi.advanceTimersByTimeAsync(3000);
  expect(operation).toHaveBeenCalledTimes(1);
});
