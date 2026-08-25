import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionClientError, type PermissionClient } from "../api/permission-client";
import type { PermissionProjection, TenantOption } from "../domain/permissions";
import { createPermissionStoreDefinition } from "./permission.store";

const NOW = Date.parse("2026-08-01T12:00:00Z");
const TENANT_A = "019c0123-4567-7abc-8123-456789abcdef";
const TENANT_B = "019c0123-4567-7abc-8123-456789abcdee";
const TENANTS: readonly TenantOption[] = [
  { tenantId: TENANT_A, displayName: "Synthetic US Tenant" },
  { tenantId: TENANT_B, displayName: "Synthetic EU Tenant" },
];

let storeSequence = 0;

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }
}

function projection(
  tenantId: string,
  authorizationRevision: number,
  capabilities: PermissionProjection["capabilities"] = ["task.read"],
  expiresAtEpochMs = NOW + 5 * 60_000,
): PermissionProjection {
  return {
    tenantId,
    authorizationRevision,
    expiresAt: new Date(expiresAtEpochMs).toISOString(),
    expiresAtEpochMs,
    capabilities,
  };
}

function createStore(client: PermissionClient) {
  const useStore = createPermissionStoreDefinition(client, `permissions-test-${storeSequence++}`);
  return useStore();
}

describe("permission store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes zero memberships to recovery without loading a projection", async () => {
    const getMyCapabilities = vi.fn();
    const store = createStore({
      listMyTenants: async () => [],
      getMyCapabilities,
    });

    await store.discoverTenants();

    expect(store.phase).toBe("recovery");
    expect(store.tenants).toEqual([]);
    expect(store.selectedTenantId).toBeNull();
    expect(store.capabilities).toEqual([]);
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });

  it("coalesces concurrent startup discovery into one request", async () => {
    const response = new Deferred<readonly TenantOption[]>();
    const listMyTenants = vi.fn(async () => response.promise);
    const store = createStore({
      listMyTenants,
      getMyCapabilities: async () => projection(TENANT_A, 1),
    });

    const first = store.ensureInitialized();
    const second = store.ensureInitialized();
    response.resolve([]);
    await Promise.all([first, second]);

    expect(listMyTenants).toHaveBeenCalledTimes(1);
    expect(store.phase).toBe("recovery");
  });

  it("starts a fresh discovery after logout invalidates pending initialization", async () => {
    const firstResponse = new Deferred<readonly TenantOption[]>();
    let calls = 0;
    const store = createStore({
      listMyTenants: async () => {
        calls += 1;
        return calls === 1 ? firstResponse.promise : [TENANTS[0]];
      },
      getMyCapabilities: async () => projection(TENANT_A, 1),
    });

    const staleInitialization = store.ensureInitialized();
    store.clearForLogout();
    const currentInitialization = store.ensureInitialized();
    await currentInitialization;
    firstResponse.resolve(TENANTS);
    await staleInitialization;

    expect(calls).toBe(2);
    expect(store.phase).toBe("ready");
    expect(store.selectedTenantId).toBe(TENANT_A);
  });

  it("automatically selects the only membership and commits one atomic snapshot", async () => {
    const store = createStore({
      listMyTenants: async () => [TENANTS[0]],
      getMyCapabilities: async () => projection(TENANT_A, 42, ["task.create", "task.read"]),
    });

    await store.discoverTenants();

    expect(store.phase).toBe("ready");
    expect(store.selectedTenantId).toBe(TENANT_A);
    expect(store.authorizationRevision).toBe(42);
    expect(store.capabilities).toEqual(["task.create", "task.read"]);
    expect(store.hasCapability("task.create")).toBe(true);
    expect(store.hasCapability("store.read")).toBe(false);

    vi.setSystemTime(NOW + 5 * 60_000 + 1);
    expect(store.hasCapability("task.create")).toBe(false);
  });

  it("requires an explicit choice for multiple memberships", async () => {
    const getMyCapabilities = vi.fn(
      async (tenantId: string) => projection(tenantId, 7, []),
    );
    const store = createStore({
      listMyTenants: async () => TENANTS,
      getMyCapabilities,
    });

    await store.discoverTenants();
    expect(store.phase).toBe("tenant-selection-required");
    expect(store.selectedTenantId).toBeNull();
    expect(getMyCapabilities).not.toHaveBeenCalled();

    await store.selectTenant(TENANT_B);
    expect(store.phase).toBe("ready-empty");
    expect(store.selectedTenantId).toBe(TENANT_B);
    expect(store.capabilities).toEqual([]);
    expect(getMyCapabilities).toHaveBeenCalledTimes(1);
    expect(getMyCapabilities.mock.calls[0]).toEqual([TENANT_B, expect.any(AbortSignal)]);
  });

  it("rejects a tenant that was not returned by discovery", async () => {
    const getMyCapabilities = vi.fn();
    const store = createStore({
      listMyTenants: async () => TENANTS,
      getMyCapabilities,
    });
    await store.discoverTenants();

    await store.selectTenant("019c0123-4567-7abc-8123-456789abcd00");

    expect(store.phase).toBe("invalid-tenant-context");
    expect(store.selectedTenantId).toBeNull();
    expect(store.capabilities).toEqual([]);
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });

  it("drops a late tenant A response after switching to tenant B", async () => {
    const tenantAResponse = new Deferred<PermissionProjection>();
    const tenantBResponse = new Deferred<PermissionProjection>();
    const store = createStore({
      listMyTenants: async () => TENANTS,
      getMyCapabilities: async (tenantId) =>
        tenantId === TENANT_A ? tenantAResponse.promise : tenantBResponse.promise,
    });
    await store.discoverTenants();

    const loadA = store.selectTenant(TENANT_A);
    const loadB = store.selectTenant(TENANT_B);
    expect(store.phase).toBe("loading");
    expect(store.selectedTenantId).toBe(TENANT_B);
    expect(store.capabilities).toEqual([]);

    tenantBResponse.resolve(projection(TENANT_B, 12, ["store.read"]));
    await loadB;
    expect(store.phase).toBe("ready");
    expect(store.capabilities).toEqual(["store.read"]);

    tenantAResponse.resolve(projection(TENANT_A, 99, ["task.create"]));
    await loadA;
    expect(store.selectedTenantId).toBe(TENANT_B);
    expect(store.authorizationRevision).toBe(12);
    expect(store.capabilities).toEqual(["store.read"]);
  });

  it("refreshes early without dropping the current authorized view", async () => {
    const refreshed = new Deferred<PermissionProjection>();
    let capabilityCalls = 0;
    const store = createStore({
      listMyTenants: async () => [TENANTS[0]],
      getMyCapabilities: async () => {
        capabilityCalls += 1;
        return capabilityCalls === 1
          ? projection(TENANT_A, 1, ["task.read"], NOW + 1_000)
          : refreshed.promise;
      },
    });
    await store.discoverTenants();
    expect(store.capabilities).toEqual(["task.read"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.phase).toBe("ready");
    expect(store.capabilities).toEqual(["task.read"]);
    expect(store.authorizationRevision).toBe(1);
    expect(store.hasCapability("task.read")).toBe(false);

    refreshed.resolve(projection(TENANT_A, 2, ["task.create"], NOW + 60_000));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.phase).toBe("ready");
    expect(store.authorizationRevision).toBe(2);
    expect(store.capabilities).toEqual(["task.create"]);
  });

  it("rejects a lower authorization revision for the same in-memory context", async () => {
    let revision = 9;
    const store = createStore({
      listMyTenants: async () => [TENANTS[0]],
      getMyCapabilities: async () => projection(TENANT_A, revision, ["task.read"]),
    });
    await store.discoverTenants();
    revision = 8;

    await store.refresh();

    expect(store.phase).toBe("invalid-projection");
    expect(store.lastFailure).toBe("invalid-projection");
    expect(store.capabilities).toEqual([]);
  });

  it("rejects changed permissions when the authorization revision does not change", async () => {
    let capabilities: PermissionProjection["capabilities"] = ["task.read"];
    const store = createStore({
      listMyTenants: async () => [TENANTS[0]],
      getMyCapabilities: async () => projection(TENANT_A, 9, capabilities),
    });
    await store.discoverTenants();
    capabilities = ["task.create"];

    await store.refresh();

    expect(store.phase).toBe("invalid-projection");
    expect(store.lastFailure).toBe("invalid-projection");
    expect(store.capabilities).toEqual([]);
  });

  it("keeps every failure state fail-closed and recoverable", async () => {
    let failure: PermissionClientError | null = new PermissionClientError("unavailable", 503);
    const store = createStore({
      listMyTenants: async () => {
        if (failure) {
          throw failure;
        }
        return [TENANTS[0]];
      },
      getMyCapabilities: async () => projection(TENANT_A, 1),
    });

    await store.discoverTenants();
    expect(store.phase).toBe("unavailable");
    expect(store.isReady).toBe(false);
    expect(store.hasCapability("task.read")).toBe(false);

    failure = null;
    await store.refresh();
    expect(store.phase).toBe("ready");
  });

  it("aborts pending work and clears all context on logout", async () => {
    const response = new Deferred<readonly TenantOption[]>();
    const store = createStore({
      listMyTenants: async () => response.promise,
      getMyCapabilities: async () => projection(TENANT_A, 1),
    });
    const discovery = store.discoverTenants();

    store.clearForLogout();
    response.resolve(TENANTS);
    await discovery;

    expect(store.phase).toBe("idle");
    expect(store.tenants).toEqual([]);
    expect(store.selectedTenantId).toBeNull();
    expect(store.capabilities).toEqual([]);
  });
});
