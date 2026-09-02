import { describe, expect, it, vi } from "vitest";
import { createChatPermissionLifecycle } from "./chat-permission-lifecycle";

const accepted = {
  ready: true,
  tenantId: "019c1a00-0000-7000-8000-000000000002",
  authorizationRevision: 7,
  expiresAt: "2026-08-24T00:00:00Z",
  canCreateTask: true,
  canReadTask: true,
};

describe("Chat permission lifecycle", () => {
  it("disposes the prior scope before binding a newly authorized scope", async () => {
    const calls: string[] = [];
    const lifecycle = createChatPermissionLifecycle({
      dispose: async () => { calls.push("dispose"); },
      bind: async (tenant) => { calls.push(`bind:${tenant}`); },
    }, true);

    await lifecycle.synchronize(accepted);
    expect(calls).toEqual(["dispose", `bind:${accepted.tenantId}`]);
  });

  it("keeps an unchanged authorized scope bound across permission refreshes", async () => {
    const store = {
      dispose: vi.fn(async () => undefined),
      bind: vi.fn(async () => undefined),
    };
    const lifecycle = createChatPermissionLifecycle(store, true);

    await lifecycle.synchronize(accepted);
    await lifecycle.synchronize({ ...accepted });

    expect(store.dispose).toHaveBeenCalledTimes(1);
    expect(store.bind).toHaveBeenCalledTimes(1);
  });

  it("retries the same authority after its previous bind failed", async () => {
    let bound = false;
    let bindAttempt = 0;
    const store = {
      dispose: vi.fn(async () => undefined),
      bind: vi.fn(async () => {
        bindAttempt += 1;
        bound = bindAttempt > 1;
      }),
      isAuthorityBound: () => bound,
    };
    const lifecycle = createChatPermissionLifecycle(store, true);

    await expect(lifecycle.synchronize(accepted)).resolves.toBe(false);
    await expect(lifecycle.synchronize({ ...accepted })).resolves.toBe(true);

    expect(store.dispose).toHaveBeenCalledTimes(2);
    expect(store.bind).toHaveBeenCalledTimes(2);
  });

  it("forces a same-authority rebind on an explicit retry", async () => {
    const store = {
      dispose: vi.fn(async () => undefined),
      bind: vi.fn(async () => true),
    };
    const lifecycle = createChatPermissionLifecycle(store, true);

    await lifecycle.synchronize(accepted);
    await expect(lifecycle.retry()).resolves.toBe(true);

    expect(store.dispose).toHaveBeenCalledTimes(2);
    expect(store.bind).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent retries for the same authority", async () => {
    let releaseBind!: (result: boolean) => void;
    const bindResult = new Promise<boolean>((resolve) => { releaseBind = resolve; });
    const store = {
      dispose: vi.fn(async () => undefined),
      bind: vi.fn(() => bindResult),
    };
    const lifecycle = createChatPermissionLifecycle(store, true);

    const initial = lifecycle.synchronize(accepted);
    await vi.waitFor(() => expect(store.bind).toHaveBeenCalledOnce());
    const retry = lifecycle.retry();
    expect(store.bind).toHaveBeenCalledOnce();
    expect(store.dispose).toHaveBeenCalledOnce();

    releaseBind(true);
    await expect(Promise.all([initial, retry])).resolves.toEqual([true, true]);
    expect(store.bind).toHaveBeenCalledOnce();
  });

  it("renews the Chat context when the permission projection expiry advances", async () => {
    const store = {
      dispose: vi.fn(async () => undefined),
      bind: vi.fn(async () => undefined),
    };
    const lifecycle = createChatPermissionLifecycle(store, true);

    await lifecycle.synchronize(accepted);
    await lifecycle.synchronize({ ...accepted, expiresAt: "2026-08-24T00:04:00Z" });

    expect(store.dispose).toHaveBeenCalledTimes(2);
    expect(store.bind).toHaveBeenCalledTimes(2);
  });

  it("never binds when default-off, signed out, revisionless, or capabilityless", async () => {
    const bind = vi.fn(async () => undefined);
    const store = { dispose: vi.fn(async () => undefined), bind };
    await createChatPermissionLifecycle(store, false).synchronize(accepted);
    const enabled = createChatPermissionLifecycle(store, true);
    await enabled.synchronize({ ...accepted, ready: false });
    await enabled.synchronize({ ...accepted, authorizationRevision: null });
    await enabled.synchronize({ ...accepted, canCreateTask: false, canReadTask: false });
    expect(bind).not.toHaveBeenCalled();
  });

  it("prevents an older disposal from publishing a stale tenant bind", async () => {
    let releaseFirst!: () => void;
    let disposeCount = 0;
    const bind = vi.fn(async () => undefined);
    const lifecycle = createChatPermissionLifecycle({
      bind,
      dispose: () => {
        disposeCount += 1;
        return disposeCount === 1
          ? new Promise<void>((resolve) => { releaseFirst = resolve; })
          : Promise.resolve();
      },
    }, true);

    const old = lifecycle.synchronize(accepted);
    const nextTenant = "019c1a00-0000-7000-8000-000000000003";
    await lifecycle.synchronize({ ...accepted, tenantId: nextTenant, authorizationRevision: 8 });
    releaseFirst();
    await old;

    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(nextTenant);
  });
});
