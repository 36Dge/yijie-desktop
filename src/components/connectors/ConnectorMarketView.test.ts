// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { NModal } from "naive-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorClientError, type MarketConnectorClient } from "../../api/market-connectors-client";
import type { CatalogEntry, Installation, MutationResult, Operation, Snapshot } from "../../domain/market-connectors.generated";
import { createMarketConnectorStoreDefinition } from "../../stores/market-connectors.store";
import ConnectorMarketView from "./ConnectorMarketView.vue";
import ConnectorInstalledList from "./ConnectorInstalledList.vue";
import ConnectorDetailsDialog from "./ConnectorDetailsDialog.vue";
import catalog from "../../../contracts/market-catalog.json";
import { connectorIconUrl } from "../../icons/connector-icons";
import { connectorViews } from "../../domain/market-connectors-ui";

const service: CatalogEntry = { serviceId: "sample", serverName: "sample", displayName: "普通合成服务", description: "仅验证本地界面", categoryId: "productivity", categoryLabel: "效率工具", iconAssetId: "cue", transport: "http", authMode: "oauth", availability: "unverified", blockerCodes: ["provider_onboarding_required"] };
const installed: Installation = { installationId: "019c1a00-0000-7000-8000-000000000001", serviceId: service.serviceId, revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "unconfigured", authorizationStatus: "required", connectionStatus: "disconnected" };
function snapshot(items: Installation[] = [installed], capabilities: Snapshot["capabilities"] = ["connector.read", "connector.manage"]): Snapshot {
  return { catalogRevision: 1, catalog: [service], installations: items, capabilities, executionAvailable: false };
}
function operation(id: string, status: Operation["status"] = "pending"): Operation {
  return { operationId: id, installationId: installed.installationId, serviceId: service.serviceId, action: "uninstall", status, revision: 1, cancellable: status === "pending" };
}
const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; });
async function setup() {
  const client = { snapshot: vi.fn().mockResolvedValue(snapshot()), install: vi.fn(), setEnabled: vi.fn(), uninstall: vi.fn(), configure: vi.fn(), authorize: vi.fn(), operation: vi.fn(), cancel: vi.fn(), reopen: vi.fn(), validateSelection: vi.fn() } satisfies MarketConnectorClient;
  const store = createMarketConnectorStoreDefinition(client, `uninstall-test-${crypto.randomUUID()}`)();
  await store.bind("context-a", "local:scope-a");
  const wrapper = mount(defineComponent({ setup: () => () => h(ConnectorMarketView, { model: store.model, operationErrors: store.operationErrors, onAction: (action, id) => { void store.execute(action, id); } }) }), { attachTo: document.body });
  wrappers.push(wrapper);
  const installedTab = wrapper.findAll("button").find(button => button.text().startsWith("已安装"))!;
  await installedTab.trigger("click");
  wrapper.getComponent(ConnectorInstalledList).vm.$emit("uninstall", service.serviceId);
  await flushPromises();
  return { client, store, wrapper };
}
function button(label: string): DOMWrapper<HTMLButtonElement> {
  return new DOMWrapper([...document.querySelectorAll<HTMLButtonElement>("button")].find(candidate => candidate.textContent?.trim() === label)!);
}
function hasButton(label: string): boolean { return [...document.querySelectorAll("button")].some(candidate => candidate.textContent?.trim() === label); }

describe("connector uninstall recovery", () => {
  it("lets a pending authorization reopen its page while keeping close, query and cancel available", async () => {
    const receipt = { ...operation("original-auth"), action: "authorize" as const };
    const data = snapshot([{ ...installed, activeOperation: receipt }], ["connector.read", "connector.manage", "connector.credentials.manage"]);
    const view = connectorViews(data)[0]!;
    const wrapper = mount(ConnectorDetailsDialog, { props: { show: true, connector: view, canManage: true }, attachTo: document.body });
    wrappers.push(wrapper); await flushPromises();
    await button("重新打开连接页面").trigger("click");
    expect(wrapper.emitted("action")).toEqual([["reopen", "sample"]]);
    expect(hasButton("重新确认状态")).toBe(true);
    expect(hasButton("取消操作")).toBe(true);
    data.capabilities = ["connector.read"];
    await wrapper.setProps({ connector: connectorViews(data)[0], canManage: false });
    expect(hasButton("重新打开连接页面")).toBe(false);
    expect(hasButton("重新确认状态")).toBe(true);
  });
  it("allows closing a normally pending IPC without cancelling or repeating its operation", async () => {
    const { client, store, wrapper } = await setup();
    let resolve!: (result: MutationResult) => void;
    client.uninstall.mockImplementation(() => new Promise<MutationResult>(done => { resolve = done; }));
    await button("确认卸载").trigger("click"); await flushPromises();
    expect(document.body.textContent).toContain("关闭窗口不会取消操作");
    expect(button("关闭窗口").element.disabled).toBe(false);
    expect(wrapper.getComponent(NModal).props()).toMatchObject({ maskClosable: true, closeOnEsc: true });
    await button("关闭窗口").trigger("click"); await flushPromises();
    expect(wrapper.findComponent(NModal).exists()).toBe(false);
    expect(client.cancel).not.toHaveBeenCalled(); expect(client.uninstall).toHaveBeenCalledTimes(1);
    const id = client.uninstall.mock.calls[0]![2];
    client.snapshot.mockResolvedValue(snapshot([]));
    resolve({ installation: { ...installed, status: "removed", revision: 2, generation: 2 }, operation: operation(id, "succeeded") });
    await flushPromises();
    expect(store.installation(service.serviceId)).toBeUndefined();
    expect(client.uninstall).toHaveBeenCalledTimes(1);
  });
  it("queries and cancels the original pending receipt from the open dialog", async () => {
    const { client } = await setup();
    client.uninstall.mockImplementation(async (_context, item, id) => ({ installation: item, operation: operation(id) }));
    await button("确认卸载").trigger("click"); await flushPromises();
    const id = client.uninstall.mock.calls[0]![2];
    client.operation.mockResolvedValue(operation(id));
    await button("重新确认状态").trigger("click"); await flushPromises();
    expect(client.operation).toHaveBeenCalledWith("context-a", id);
    client.cancel.mockResolvedValue(operation(id, "cancelled"));
    await button("取消操作").trigger("click"); await flushPromises();
    expect(client.cancel).toHaveBeenCalledWith("context-a", id, 1);
    expect(client.uninstall).toHaveBeenCalledTimes(1);
  });
  it("allows a read-only receipt query but never cancellation or mutation replay", async () => {
    const { client, store } = await setup();
    client.uninstall.mockImplementation(async (_context, item, id) => ({ installation: item, operation: operation(id) }));
    await button("确认卸载").trigger("click"); await flushPromises();
    client.snapshot.mockResolvedValue(snapshot([installed], ["connector.read"]));
    await store.bind("context-read-only", "local:scope-a"); await flushPromises();
    expect(hasButton("取消操作")).toBe(false); expect(hasButton("确认卸载")).toBe(false);
    client.operation.mockRejectedValue(new ConnectorClientError("not_found"));
    await button("重新确认状态").trigger("click"); await flushPromises();
    expect(client.operation).toHaveBeenCalledWith("context-read-only", client.uninstall.mock.calls[0]![2]);
    expect(hasButton("重新确认状态")).toBe(false);
    expect(button("关闭窗口").element.disabled).toBe(false);
    expect(client.uninstall).toHaveBeenCalledTimes(1); expect(client.cancel).not.toHaveBeenCalled();
  });
  it("keeps a pending uninstall queryable and cancellable after reopening its details", async () => {
    const { client, wrapper } = await setup();
    client.uninstall.mockImplementation(async (_context, item, id) => ({ installation: item, operation: operation(id) }));
    await button("确认卸载").trigger("click"); await flushPromises();
    const id = client.uninstall.mock.calls[0]![2];
    await button("关闭窗口").trigger("click");
    wrapper.getComponent(ConnectorInstalledList).vm.$emit("open", service.serviceId);
    await flushPromises();
    expect(hasButton("取消连接")).toBe(false);
    expect(hasButton("取消操作")).toBe(true);
    client.operation.mockResolvedValue(operation(id));
    await button("重新确认状态").trigger("click"); await flushPromises();
    expect(client.operation).toHaveBeenCalledWith("context-a", id);
    client.cancel.mockResolvedValue(operation(id, "cancelled"));
    await button("取消操作").trigger("click"); await flushPromises();
    expect(client.cancel).toHaveBeenCalledWith("context-a", id, 1);
    expect(client.uninstall).toHaveBeenCalledTimes(1);
  });
  it("keeps an unknown outcome queryable without submitting another uninstall", async () => {
    const { client } = await setup();
    client.uninstall.mockRejectedValue(new ConnectorClientError("outcome_unknown"));
    await button("确认卸载").trigger("click"); await flushPromises();
    const id = client.uninstall.mock.calls[0]![2];
    client.operation.mockResolvedValue(operation(id, "unknown"));
    await button("重新确认状态").trigger("click"); await flushPromises();
    expect(client.operation).toHaveBeenCalledWith("context-a", id);
    expect(client.uninstall).toHaveBeenCalledTimes(1);
    expect(hasButton("重新确认状态")).toBe(true);
    expect(button("关闭窗口").element.disabled).toBe(false);
  });
});


describe("independent OAuth authorization entry", () => {
  it("sends authorize from the detail dialog without enabling unqualified tools", async () => {
    const data = snapshot([installed], ["connector.read", "connector.manage", "connector.credentials.manage"]);
    data.catalog = [{ ...service, authorizationAvailable: true }];
    const client = { snapshot: vi.fn().mockResolvedValue(data), install: vi.fn(), setEnabled: vi.fn(), uninstall: vi.fn(), configure: vi.fn(), authorize: vi.fn(), operation: vi.fn(), cancel: vi.fn(), reopen: vi.fn(), validateSelection: vi.fn() } satisfies MarketConnectorClient;
    client.authorize.mockImplementation(async (_context, item, id) => ({ installation: item, operation: { ...operation(id), action: "authorize" } }));
    const store = createMarketConnectorStoreDefinition(client, `authorize-test-${crypto.randomUUID()}`)();
    await store.bind("context-a", "local:scope-a");
    const wrapper = mount(defineComponent({ setup: () => () => h(ConnectorMarketView, { model: store.model, operationErrors: store.operationErrors, openServiceId: service.serviceId, onAction: (action, id) => { void store.execute(action, id); } }) }), { attachTo: document.body });
    wrappers.push(wrapper); await flushPromises();
    expect(hasButton("授权连接")).toBe(true); expect(hasButton("授权并启用")).toBe(false);
    expect(document.body.textContent).toContain("支持工具尚待验证，暂不能启用或用于对话");
    await button("授权连接").trigger("click"); await flushPromises();
    expect(client.authorize).toHaveBeenCalledExactlyOnceWith("context-a", installed, expect.any(String));
    expect(client.setEnabled).not.toHaveBeenCalled(); expect(store.entries[0]?.enabled).toBe(false); expect(store.entries[0]?.selectable).toBe(false);
  });
});


describe("cross-border catalog", () => {
  it("renders ten cross-border icons with category search and the existing detail entry", async () => {
    const data: Snapshot = { ...snapshot([]), catalogRevision: catalog.catalogRevision, catalog: catalog.catalog as CatalogEntry[] };
    const entries = connectorViews(data);
    const cross = entries.filter(entry => entry.categoryId === "cross_border_ecommerce");
    expect(entries).toHaveLength(58);
    expect(cross.map(entry => entry.id)).toEqual(["lingxing", "sif", "keepa", "pangolinfo", "datahawk", "seller-labs", "shopify", "sellersprite", "sorftime", "FastMoss"]);
    const wrapper = mount(ConnectorMarketView, { props: { model: { phase: "ready", entries, canManage: true, refreshing: false, error: null } }, attachTo: document.body });
    wrappers.push(wrapper);
    expect(wrapper.findAll(".connector-card")).toHaveLength(58);
    await wrapper.get("input").setValue("跨境电商");
    expect(wrapper.findAll(".connector-card")).toHaveLength(10);
    for (const entry of cross) {
      expect(connectorIconUrl(entry.iconAssetId)).toBeTruthy();
      expect(wrapper.findAll(".connector-card img").some(img => img.attributes("src") === connectorIconUrl(entry.iconAssetId))).toBe(true);
    }
    await wrapper.get("input").setValue("领星");
    expect(wrapper.findAll(".connector-card")).toHaveLength(1);
    await wrapper.get(".connector-card").trigger("click"); await flushPromises();
    expect(document.body.textContent).toContain("安装 领星 ERP");
  });
});
