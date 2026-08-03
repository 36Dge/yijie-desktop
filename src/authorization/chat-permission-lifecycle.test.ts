import { describe, expect, it, vi } from "vitest";
import { createChatPermissionLifecycle } from "./chat-permission-lifecycle";

const accepted = {
  ready: true,
  tenantId: "019c1a00-0000-7000-8000-000000000002",
  authorizationRevision: 7,
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
