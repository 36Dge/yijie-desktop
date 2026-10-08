import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorClientError, type MarketConnectorClient } from "../api/market-connectors-client";
import type { CatalogEntry, Installation, MutationResult, Operation, Snapshot } from "../domain/market-connectors.generated";
import { createMarketConnectorStoreDefinition } from "./market-connectors.store";
import { connectorPrimaryAction } from "../domain/connector-ui";

const service: CatalogEntry = { serviceId: "sample", serverName: "sample", displayName: "普通合成服务", description: "普通合成返回，无外部请求", categoryId: "productivity", categoryLabel: "效率工具", iconAssetId: "cue", transport: "http", authMode: "oauth", availability: "available", blockerCodes: [] };
const installed: Installation = { installationId: "019c1a00-0000-7000-8000-000000000001", serviceId: service.serviceId, revision: 1, generation: 1, status: "installed", desiredEnabled: false, effectiveEnabled: false, configurationStatus: "configured", authorizationStatus: "authorized", connectionStatus: "disconnected" };
function snapshot(items: Installation[] = []): Snapshot { return { catalogRevision: 1, catalog: [service], installations: items, capabilities: ["connector.read", "connector.manage", "connector.credentials.manage", "connector.use"], executionAvailable: false }; }
function operation(id: string, status: Operation["status"] = "succeeded"): Operation { return { operationId: id, installationId: installed.installationId, serviceId: service.serviceId, action: "enable", status, revision: 2, cancellable: status === "pending" }; }
function setup(data: Snapshot) {
  const client = { snapshot: vi.fn().mockResolvedValue(data), install: vi.fn(), setEnabled: vi.fn(), uninstall: vi.fn(), configure: vi.fn(), authorize: vi.fn(), operation: vi.fn(), cancel: vi.fn(), reopen: vi.fn(), validateSelection: vi.fn() } satisfies MarketConnectorClient;
  const store = createMarketConnectorStoreDefinition(client, `connectors-test-${crypto.randomUUID()}`)();
  return { client, store };
}
beforeEach(() => setActivePinia(createPinia()));

describe("market connector management authority", () => {
  it("keeps installation disabled until a real authoritative mutation receipt arrives", async () => {
    const { client, store } = setup(snapshot());
    await store.bind("context-a");
    let resolve!: (value: MutationResult) => void;
    client.install.mockImplementation(() => new Promise<MutationResult>(done => { resolve = done; }));
    const pending = store.execute("install", "sample");
    expect(store.entries[0]?.installed).toBe(false); expect(store.entries[0]?.enabled).toBe(false);
    const id = client.install.mock.calls[0]![2];
    client.snapshot.mockResolvedValue(snapshot([installed]));
    resolve({ installation: installed, operation: { ...operation(id), action: "install" } });
    expect(await pending).toBe(true);
    expect(store.entries[0]).toMatchObject({ installed: true, enabled: false, selectable: false });
  });
  it("shows known OAuth pending progress and queries the same authorization operation", async () => {
    const item = { ...installed, configurationStatus: "unconfigured" as const, authorizationStatus: "required" as const };
    const data = snapshot([item]); data.catalog = [{ ...service, authorizationAvailable: true }];
    const { client, store } = setup(data); await store.bind("context-a");
    client.authorize.mockImplementation(async (_context, installation, id) => ({ installation, operation: { ...operation(id, "pending"), action: "authorize" } }));
    await store.execute("authorize", "sample");
    const id = client.authorize.mock.calls[0]![2];
    expect(store.entries[0]).toMatchObject({ busy: true, status: { label: "正在授权，请在浏览器中完成", tone: "neutral" }, actions: ["retry", "cancel", "reopen"], selectable: false });
    client.operation.mockResolvedValue({ ...operation(id, "pending"), action: "authorize" });
    await store.execute("retry", "sample");
    expect(client.operation).toHaveBeenCalledExactlyOnceWith("context-a", id);
    expect(client.authorize).toHaveBeenCalledTimes(1);
    expect(store.entries[0]?.status.label).toBe("正在授权，请在浏览器中完成");
    client.operation.mockResolvedValue({ ...operation(id, "unknown"), action: "authorize" });
    await store.execute("retry", "sample");
    expect(store.entries[0]?.status).toEqual({ label: "操作结果待确认", tone: "warning" });
    expect(client.authorize).toHaveBeenCalledTimes(1);
  });
  it("retains pending operation identity and cancels the exact receipt revision", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a");
    client.setEnabled.mockImplementation(async (_context, item, _enabled, id) => ({ installation: item, operation: operation(id, "pending") }));
    expect(await store.execute("enable", "sample")).toBe(false);
    const id = client.setEnabled.mock.calls[0]![3];
    expect(store.entries[0]?.actions).toContain("cancel");
    client.cancel.mockResolvedValue(operation(id, "cancelled"));
    await store.execute("cancel", "sample");
    expect(client.cancel).toHaveBeenCalledWith("context-a", id, 2);
    expect(client.setEnabled).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown install recovery reachable before an installation appears in the snapshot", async () => {
    const { client, store } = setup(snapshot());
    await store.bind("context-a");
    client.install.mockRejectedValue(new ConnectorClientError("outcome_unknown"));
    await store.execute("install", "sample");
    expect(store.entries[0]?.installed).toBe(false);
    expect(store.entries[0]?.status).toEqual({ label: "操作结果待确认", tone: "warning" });
    expect(connectorPrimaryAction(store.entries[0]!)).toEqual({ action: "retry", label: "重新确认状态" });
    client.operation.mockResolvedValue({ ...operation(client.install.mock.calls[0]![2], "pending"), action: "install" });
    await store.execute("retry", "sample");
    expect(client.install).toHaveBeenCalledTimes(1);
    expect(client.operation).toHaveBeenCalledWith("context-a", client.install.mock.calls[0]![2]);
  });
  it("queries an unknown operation before explicitly replaying the same immutable request", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a");
    client.setEnabled.mockRejectedValueOnce(new ConnectorClientError("temporarily_unavailable", true));
    await store.execute("enable", "sample");
    const first = client.setEnabled.mock.calls[0]!;
    client.operation.mockRejectedValueOnce(new ConnectorClientError("not_found"));
    await store.execute("retry", "sample");
    expect(client.setEnabled).toHaveBeenCalledTimes(1);
    expect(store.operationErrors.sample).toContain("再次点击重试");
    // A newer snapshot cannot rewrite the original attempt's expected revision.
    client.snapshot.mockResolvedValue(snapshot([{ ...installed, revision: 3 }]));
    await store.refresh();
    client.setEnabled.mockResolvedValue({ installation: { ...installed, revision: 4 }, operation: operation(first[3]) });
    await store.execute("retry", "sample");
    expect(client.setEnabled).toHaveBeenNthCalledWith(2, ...first);
  });
  it("never turns a network query failure into a second mutation", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a");
    client.setEnabled.mockRejectedValue(new ConnectorClientError("temporarily_unavailable", true));
    await store.execute("enable", "sample");
    client.operation.mockRejectedValue(new ConnectorClientError("temporarily_unavailable", true));
    await store.execute("retry", "sample"); await store.execute("retry", "sample");
    expect(client.setEnabled).toHaveBeenCalledTimes(1);
    expect(client.operation.mock.calls[0]?.[1]).toBe(client.operation.mock.calls[1]?.[1]);
  });
  it("permits receipt reads but hides mutation replay after management permission is removed", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a", "local:tenant-a");
    client.setEnabled.mockRejectedValue(new ConnectorClientError("outcome_unknown"));
    await store.execute("enable", "sample");
    client.snapshot.mockResolvedValue({ ...snapshot([installed]), capabilities: ["connector.read"] });
    await store.bind("context-read-only", "local:tenant-a");
    expect(store.entries[0]?.actions).toContain("retry");
    client.operation.mockRejectedValue(new ConnectorClientError("not_found"));
    await store.execute("retry", "sample");
    expect(client.operation).toHaveBeenCalledWith("context-read-only", client.setEnabled.mock.calls[0]![3]);
    expect(store.entries[0]?.actions).not.toContain("retry");
    expect(await store.execute("retry", "sample")).toBe(false);
    expect(client.setEnabled).toHaveBeenCalledTimes(1);
  });
  it("retains the original intent across context renewal and ignores a late old-context receipt", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a", "local:tenant-a");
    let resolve!: (value: MutationResult) => void;
    client.setEnabled.mockImplementationOnce(() => new Promise<MutationResult>(done => { resolve = done; }));
    const first = store.execute("enable", "sample"), id = client.setEnabled.mock.calls[0]![3];
    await store.bind(null, "local:tenant-a");
    expect(store.entries[0]?.actions).toEqual([]);
    await store.bind("context-renewed", "local:tenant-a");
    resolve({ installation: { ...installed, revision: 9, effectiveEnabled: true, desiredEnabled: true, connectionStatus: "ready" }, operation: operation(id) });
    expect(await first).toBe(false);
    expect(store.installation("sample")?.revision).toBe(1);
    expect(store.pending.has("sample")).toBe(false);
    expect(store.entries[0]?.actions).toContain("retry");
    client.operation.mockResolvedValue(operation(id, "pending"));
    await store.execute("retry", "sample");
    expect(client.operation).toHaveBeenCalledWith("context-renewed", id);
    await store.bind("context-third", "local:tenant-a");
    client.cancel.mockResolvedValue(operation(id, "cancelled"));
    await store.execute("cancel", "sample");
    expect(client.cancel).toHaveBeenCalledWith("context-third", id, 2);
    expect(client.setEnabled).toHaveBeenCalledTimes(1);
  });
  it("clears retained operations on a different tenant or explicit revocation", async () => {
    const { client, store } = setup(snapshot([installed]));
    await store.bind("context-a", "local:tenant-a");
    client.setEnabled.mockRejectedValue(new ConnectorClientError("outcome_unknown"));
    await store.execute("enable", "sample");
    await store.bind("context-b", "local:tenant-b");
    expect(store.entries[0]?.actions).not.toContain("retry");
    await store.execute("enable", "sample");
    expect(store.entries[0]?.actions).toContain("retry");
    await store.bind(null, null);
    await store.bind("context-c", "local:tenant-b");
    expect(store.entries[0]?.actions).not.toContain("retry");
  });
  it("discards stale reads after scope changes and removes projections after permission denial", async () => {
    const { client, store } = setup(snapshot());
    let resolve!: (value: Snapshot) => void;
    client.snapshot.mockImplementationOnce(() => new Promise<Snapshot>(done => { resolve = done; }));
    const first = store.bind("context-a");
    client.snapshot.mockResolvedValue({ ...snapshot(), catalog: [] });
    await store.bind("context-b"); resolve(snapshot([installed])); await first;
    expect(store.entries).toEqual([]);
    client.snapshot.mockRejectedValue(new ConnectorClientError("permission_denied"));
    await store.refresh();
    expect(store.phase).toBe("permission-denied"); expect(store.snapshot).toBeNull();
  });
});


describe("visible management operation observation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const pendingOperation = () => ({ ...operation("original-oauth-operation", "pending"), action: "authorize" as const });
  const pendingSnapshot = () => snapshot([{ ...installed, activeOperation: pendingOperation() }]);
  it("reopens only the original pending page and never starts a second authorization", async () => {
    const { client, store } = setup(pendingSnapshot());
    client.reopen.mockResolvedValue(pendingOperation());
    await store.bind("context-a");
    await store.execute("reopen", "sample");
    expect(client.reopen).toHaveBeenCalledExactlyOnceWith("context-a", "original-oauth-operation", 2);
    expect(client.authorize).not.toHaveBeenCalled(); expect(client.configure).not.toHaveBeenCalled();
    client.reopen.mockRejectedValueOnce(new ConnectorClientError("temporarily_unavailable"));
    await store.execute("reopen", "sample");
    expect(store.entries[0]?.actions).toContain("reopen");
    client.snapshot.mockResolvedValue({ ...pendingSnapshot(), capabilities: ["connector.read"] });
    await store.refresh();
    expect(store.entries[0]?.actions).not.toContain("reopen");
    await store.execute("reopen", "sample");
    expect(client.reopen).toHaveBeenCalledTimes(2);
  });
  it("polls only the original active operation while management is visible", async () => {
    const { client, store } = setup(pendingSnapshot());
    client.operation.mockResolvedValue(pendingOperation());
    await store.bind("context-a");
    await vi.advanceTimersByTimeAsync(5000); expect(client.operation).not.toHaveBeenCalled();
    store.setOperationObservation(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.operation).toHaveBeenCalledExactlyOnceWith("context-a", "original-oauth-operation");
    client.operation.mockResolvedValue({ ...pendingOperation(), status: "succeeded", cancellable: false, revision: 3 });
    client.snapshot.mockResolvedValue(snapshot([installed]));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.operation).toHaveBeenCalledTimes(2); expect(client.authorize).not.toHaveBeenCalled();
    store.setOperationObservation(false);
  });
  it("stops future polls when the page hides or closes", async () => {
    const { client, store } = setup(pendingSnapshot()); client.operation.mockResolvedValue(pendingOperation());
    await store.bind("context-a"); store.setOperationObservation(true); store.setOperationObservation(false);
    await vi.advanceTimersByTimeAsync(20_000); expect(client.operation).not.toHaveBeenCalled();
  });
  it("does not apply a late operation result across a scope change", async () => {
    const { client, store } = setup(pendingSnapshot());
    let resolve!: (receipt: Operation) => void;
    client.operation.mockReturnValue(new Promise<Operation>(done => { resolve = done; }));
    await store.bind("context-a", "tenant-a"); store.setOperationObservation(true);
    await vi.advanceTimersByTimeAsync(1000);
    client.snapshot.mockResolvedValue(snapshot()); await store.bind("context-b", "tenant-b");
    resolve({ ...pendingOperation(), status: "failed", errorCode: "authorization_required" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.operationErrors).toEqual({}); expect(store.entries[0]?.installed).toBe(false);
    expect(client.operation).toHaveBeenCalledTimes(1); store.setOperationObservation(false);
  });
  it("backs off normal unavailable reads and stops its bounded observation window", async () => {
    const { client, store } = setup(pendingSnapshot());
    client.operation.mockRejectedValue(new ConnectorClientError("temporarily_unavailable"));
    await store.bind("context-a"); store.setOperationObservation(true);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(client.operation.mock.calls.length).toBeGreaterThan(1); expect(client.operation.mock.calls.length).toBeLessThan(120);
    const calls = client.operation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); expect(client.operation).toHaveBeenCalledTimes(calls);
    expect(store.operationErrors.sample).toContain("自动核对已暂停"); expect(client.authorize).not.toHaveBeenCalled();
    store.setOperationObservation(false);
  });
});
