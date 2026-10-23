import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpertNativeClient, ExpertClientError, type ExpertNativeClient } from "../api/expert-native-client";
import type { CatalogSnapshot, ResourceOperation } from "../domain/experts.generated";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId as id } from "../test/expert-fixture";
import { createExpertsStoreDefinition } from "./experts.store";

function setup() {
  const client = { developer: vi.fn(), snapshot: vi.fn().mockResolvedValue(expertSnapshot()), prepare: vi.fn(), remove: vi.fn(), operation: vi.fn(), recoverOperation: vi.fn(), binding: vi.fn(), setBinding: vi.fn(), bindingOperation: vi.fn(), recoverBinding: vi.fn(), submit: vi.fn() } satisfies ExpertNativeClient;
  const store = createExpertsStoreDefinition(client, `expert-test-${crypto.randomUUID()}`)();
  return { client, store };
}
beforeEach(() => setActivePinia(createPinia()));

describe("scoped expert resource state", () => {
  it("freezes display selection and prepares through the generated request and response validators", async () => {
    const selection = { expertId: expertDisplay.expertId, version: expertDisplay.version };
    let finish!: () => void;
    const transport = vi.fn(async (command, { request }) => {
      if (command === "experts_snapshot_v1") return { schemaVersion: 1, requestId: request.requestId, data: expertSnapshot() };
      expect(command).toBe("experts_prepare_v1");
      expect(request.payload.expert).toEqual(selection);
      await new Promise<void>(resolve => { finish = resolve; });
      return { schemaVersion: 1, requestId: request.requestId, data: { ...request.payload, action: "prepare", state: "succeeded" } };
    });
    const store = createExpertsStoreDefinition(createExpertNativeClient(transport), "expert-source-validated-prepare")();
    await store.bind(id(1), "local:one");
    const preparing = store.execute(expertDisplay, "prepare");
    expect(store.operations[`${expertDisplay.expertId}@${expertDisplay.version}`]?.expert).toEqual(selection);
    expect(transport.mock.calls[transport.mock.calls.length - 1]?.[0]).toBe("experts_prepare_v1");
    finish();
    expect(await preparing).toBe(true);
    expect(store.operationErrors).toEqual({});
  });
  it("restores Native persisted resource operations on a fresh catalog read", async () => {
    const { client, store } = setup();
    const operation: ResourceOperation = { operationId: id(8), expert: expertDisplay, action: "prepare", state: "pending" };
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "preparing", operation }));
    await store.bind(id(1), "local:one");
    client.operation.mockResolvedValue(operation);
    await store.execute(expertDisplay, "prepare");
    expect(client.operation).toHaveBeenCalledWith(id(1), id(8));
    expect(client.prepare).not.toHaveBeenCalled();
  });
  it("waits for an authoritative catalog after preparation rather than guessing ready", async () => {
    const { client, store } = setup();
    await store.bind(id(1), "local:one");
    client.prepare.mockImplementation(async (_context, expert, operationId) => ({ operationId, expert, action: "prepare", state: "succeeded" }));
    expect(await store.execute(expertDisplay, "prepare")).toBe(true);
    expect(store.entries[0]?.state).toBe("available");
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "ready" }));
    await store.refresh();
    expect(store.entries[0]?.state).toBe("ready");
    expect(store.snapshot?.executionAvailable).toBe(false);
    expect(client.setBinding).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });
  it("retains and queries a pending operation across a same-scope context renewal", async () => {
    const { client, store } = setup();
    await store.bind(id(1), "local:one");
    let receipt: ResourceOperation;
    client.prepare.mockImplementation(async (_context, expert, operationId) => receipt = { operationId, expert, action: "prepare", state: "pending" });
    expect(await store.execute(expertDisplay, "prepare")).toBe(false);
    await store.bind(id(2), "local:one");
    client.operation.mockImplementation(async () => ({ ...receipt, state: "succeeded" }));
    expect(await store.execute(expertDisplay, "prepare")).toBe(true);
    expect(client.prepare).toHaveBeenCalledTimes(1);
    expect(client.operation).toHaveBeenCalledWith(id(2), receipt!.operationId);
  });
  it("clears the old pending notice only when a catalog confirms that same operation succeeded", async () => {
    const { client, store } = setup();
    await store.bind(id(1), "local:one");
    let original!: ResourceOperation;
    client.prepare.mockImplementation(async (_context, expert, operationId) => original = { operationId, expert, action: "prepare", state: "pending" });
    await store.execute(expertDisplay, "prepare");
    const key = `${expertDisplay.expertId}@${expertDisplay.version}`;
    expect(store.operationErrors[key]).toContain("待确认");
    // A normally returned earlier catalog receipt cannot settle this request.
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "ready", operation: { ...original, operationId: id(9), state: "succeeded" } }));
    await store.refresh();
    expect(store.operations[key]?.operationId).toBe(original.operationId);
    expect(store.operationErrors[key]).toContain("待确认");
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "ready", operation: { ...original, state: "succeeded" } }));
    await store.refresh();
    expect(store.operations[key]?.state).toBe("succeeded");
    expect(store.operationErrors[key]).toBeUndefined();
    expect(client.prepare).toHaveBeenCalledOnce(); expect(client.operation).not.toHaveBeenCalled();
  });
  it("explicitly closes the original unstarted resource operation and preserves it on a busy recovery", async () => {
    const { client, store } = setup();
    const original: ResourceOperation = { operationId: id(8), expert: { expertId: expertDisplay.expertId, version: expertDisplay.version }, action: "prepare", state: "unknown", errorCode: "outcome_unknown" };
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "unavailable", operation: original }));
    await store.bind(id(1), "local:one");
    client.recoverOperation.mockRejectedValueOnce(new ExpertClientError("busy"));
    const key = `${expertDisplay.expertId}@${expertDisplay.version}`;
    expect(await store.recover(expertDisplay, original.operationId)).toBe(false);
    expect(store.operations[key]).toEqual(original);
    const ended = { ...original, state: "rejected" as const, errorCode: "request_conflict" as const };
    client.recoverOperation.mockResolvedValue(ended);
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, operation: ended }));
    expect(await store.recover(expertDisplay, original.operationId)).toBe(true);
    expect(store.operations[key]).toEqual(ended);
    expect(store.operationErrors[key]).toBe("原操作已结束，可重新准备或移除资源。");
    expect(client.recoverOperation).toHaveBeenLastCalledWith(id(1), id(8));
    expect(client.prepare).not.toHaveBeenCalled(); expect(client.remove).not.toHaveBeenCalled(); expect(client.operation).not.toHaveBeenCalled();
  });
  it.each(["prepare", "recover"] as const)("does not publish a catalog read that started before the %s result settled", async (action) => {
    const { client, store } = setup(); await store.bind(id(1), "local:one");
    const key = `${expertDisplay.expertId}@${expertDisplay.version}`;
    let original: ResourceOperation = { operationId: id(8), expert: { expertId: expertDisplay.expertId, version: expertDisplay.version }, action: "prepare", state: "pending" };
    let finish!: (value: ResourceOperation) => void;
    if (action === "recover") {
      store.operations = { [key]: original };
      client.recoverOperation.mockImplementation(() => new Promise<ResourceOperation>(resolve => { finish = resolve; }));
    } else client.prepare.mockImplementation((_context, expert, operationId) => {
      original = { ...original, expert, operationId };
      return new Promise<ResourceOperation>(resolve => { finish = resolve; });
    });
    const running = action === "recover" ? store.recover(expertDisplay, original.operationId) : store.execute(expertDisplay, "prepare");
    let finishRead!: (value: CatalogSnapshot) => void;
    client.snapshot.mockImplementationOnce(() => new Promise<CatalogSnapshot>(resolve => { finishRead = resolve; }));
    const earlierRead = store.refresh();
    const completed = { ...original, state: "succeeded" as const };
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "ready", operation: completed }));
    finish(completed); expect(await running).toBe(true);
    finishRead(expertSnapshot({ ...expertEntry, state: "preparing", operation: original })); await earlierRead;
    expect(store.operations[key]).toEqual(completed); expect(store.entries[0]?.state).toBe("ready");
    expect(store.operationErrors[key]).toBeUndefined(); expect(store.refreshing).toBe(false);
  });
  it("keeps a catalog-confirmed terminal receipt when the original recovery reply arrives later", async () => {
    const { client, store } = setup(); await store.bind(id(1), "local:one");
    const key = `${expertDisplay.expertId}@${expertDisplay.version}`;
    const original: ResourceOperation = { operationId: id(8), expert: { expertId: expertDisplay.expertId, version: expertDisplay.version }, action: "prepare", state: "pending" };
    store.operations = { [key]: original };
    let finish!: (value: ResourceOperation) => void;
    client.recoverOperation.mockImplementation(() => new Promise<ResourceOperation>(resolve => { finish = resolve; }));
    const recovering = store.recover(expertDisplay, original.operationId), completed = { ...original, state: "succeeded" as const };
    client.snapshot.mockResolvedValue(expertSnapshot({ ...expertEntry, state: "ready", operation: completed }));
    await store.refresh();
    client.snapshot.mockImplementationOnce(async () => {
      expect(store.operations[key]).toEqual(completed);
      return expertSnapshot({ ...expertEntry, state: "ready", operation: completed });
    });
    finish(original); expect(await recovering).toBe(true);
    expect(store.operations[key]).toEqual(completed); expect(store.operationErrors[key]).toBeUndefined();
  });
  it("discards a former tenant's in-flight catalog and operations", async () => {
    const { client, store } = setup();
    let resolve!: (value: CatalogSnapshot) => void;
    client.snapshot.mockImplementationOnce(() => new Promise<CatalogSnapshot>(done => { resolve = done; }));
    const previous = store.bind(id(1), "local:one");
    await store.bind(null, null);
    resolve(expertSnapshot()); await previous;
    expect(store.entries).toEqual([]);
    expect(store.operations).toEqual({});
    expect(store.contextId).toBeNull();
  });
  it("allows read-only catalog access without preparation calls", async () => {
    const { client, store } = setup();
    client.snapshot.mockResolvedValue({ ...expertSnapshot(), canManage: false });
    await store.bind(id(1), "local:one");
    expect(store.entries).toHaveLength(1);
    expect(await store.execute(expertDisplay, "prepare")).toBe(false);
    expect(client.prepare).not.toHaveBeenCalled();
  });
});
