import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createPermissionClient,
  PermissionClientError,
  type PermissionOperationIntent,
} from "./permission-client";

const NOW = Date.parse("2026-08-01T12:00:00Z");
const TENANT_A = "019c0123-4567-7abc-8123-456789abcdef";

function fixture(name: string): Record<string, unknown> {
  const contractsRoot = path.resolve(
    process.cwd(),
    process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  return JSON.parse(
    readFileSync(path.join(contractsRoot, "tests/fixtures/public/access", name), "utf8"),
  ) as Record<string, unknown>;
}

function envelope(status: number, body: unknown): Record<string, unknown> {
  return {
    status,
    cacheControl: "no-store",
    ...(status === 401 ? { wwwAuthenticate: "Bearer" } : {}),
    ...(status === 503 ? { retryAfter: "1" } : {}),
    body,
  };
}

function clientFor(response: unknown) {
  const invocations: Array<{ command: string; arguments_?: Record<string, unknown> }> = [];
  const client = createPermissionClient(async <T>(command: string, arguments_?: Record<string, unknown>) => {
    invocations.push({ command, arguments_ });
    return response as T;
  });
  return { client, invocations };
}

async function expectFailure(
  promise: Promise<unknown>,
  kind: PermissionClientError["kind"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "PermissionClientError", kind });
}

describe("permission contract consumer", () => {
  it("consumes canonical tenant fixtures for zero, one and multiple memberships", async () => {
    const empty = clientFor(envelope(200, fixture("tenant-list-v1-empty.json"))).client;
    const single = clientFor(envelope(200, fixture("tenant-list-v1-single.json"))).client;
    const multiple = clientFor(envelope(200, fixture("tenant-list-v1-multiple.json"))).client;

    await expect(empty.listMyTenants()).resolves.toEqual([]);
    await expect(single.listMyTenants()).resolves.toEqual([
      { tenantId: TENANT_A, displayName: "Synthetic Tenant" },
    ]);
    await expect(multiple.listMyTenants()).resolves.toHaveLength(2);
  });

  it("uses only the two approved operation intents and canonical tenant argument", async () => {
    const tenants = clientFor(envelope(200, fixture("tenant-list-v1-single.json")));
    await tenants.client.listMyTenants();
    expect(tenants.invocations).toEqual([{ command: "list_my_tenants", arguments_: undefined }]);

    const capabilities = clientFor(envelope(200, fixture("capability-v1-ready.json")));
    await capabilities.client.getMyCapabilities(TENANT_A.toUpperCase(), undefined, NOW);
    expect(capabilities.invocations).toEqual([
      { command: "get_my_capabilities", arguments_: { tenantId: TENANT_A } },
    ]);
    const intents: PermissionOperationIntent[] = [
      { kind: "listMyTenants" },
      { kind: "getMyCapabilities", tenantId: TENANT_A },
    ];
    expect(intents.map((intent) => intent.kind)).toEqual([
      "listMyTenants",
      "getMyCapabilities",
    ]);
  });

  it("accepts canonical ready and empty projections and ignores unknown valid capabilities", async () => {
    const ready = clientFor(envelope(200, fixture("capability-v1-ready.json"))).client;
    const empty = clientFor(envelope(200, fixture("capability-v1-empty.json"))).client;
    const unknown = clientFor(envelope(200, fixture("capability-v1-unknown.json"))).client;

    await expect(ready.getMyCapabilities(TENANT_A, undefined, NOW)).resolves.toMatchObject({
      tenantId: TENANT_A,
      authorizationRevision: 42,
      capabilities: ["schedule.read", "task.create", "task.read"],
    });
    await expect(empty.getMyCapabilities(TENANT_A, undefined, NOW)).resolves.toMatchObject({
      capabilities: [],
    });
    await expect(unknown.getMyCapabilities(TENANT_A, undefined, NOW)).resolves.toMatchObject({
      authorizationRevision: 44,
      capabilities: ["task.read"],
    });
  });

  it("tolerates additive response fields without creating permissions", async () => {
    const tenantBody = {
      ...fixture("tenant-list-v1-single.json"),
      future_metadata: { ignored: true },
    };
    const projectionBody = {
      ...fixture("capability-v1-unknown.json"),
      future_metadata: { ignored: true },
    };
    const tenants = clientFor(envelope(200, tenantBody)).client;
    const projection = clientFor(envelope(200, projectionBody)).client;

    await expect(tenants.listMyTenants()).resolves.toHaveLength(1);
    await expect(projection.getMyCapabilities(TENANT_A, undefined, NOW)).resolves.toMatchObject({
      capabilities: ["task.read"],
    });
  });

  it.each([
    [401, "error-unauthorized.json", "unauthorized"],
    [403, "error-user-access-denied.json", "user-access-denied"],
    [500, "error-internal-error.json", "unavailable"],
    [503, "error-authorization-unavailable.json", "unavailable"],
  ] as const)("maps tenant status %i to %s", async (status, name, kind) => {
    const client = clientFor(envelope(status, fixture(name))).client;
    await expectFailure(client.listMyTenants(), kind);
  });

  it.each([
    [400, "error-invalid-tenant-context.json", "invalid-tenant-context"],
    [401, "error-unauthorized.json", "unauthorized"],
    [403, "error-tenant-access-denied.json", "tenant-access-denied"],
    [500, "error-internal-error.json", "unavailable"],
    [503, "error-authorization-unavailable.json", "unavailable"],
  ] as const)("maps capability status %i to %s", async (status, name, kind) => {
    const client = clientFor(envelope(status, fixture(name))).client;
    await expectFailure(client.getMyCapabilities(TENANT_A, undefined, NOW), kind);
  });

  it("rejects mismatched error codes, missing no-store and forbidden credential keys", async () => {
    await expectFailure(
      clientFor(envelope(403, fixture("error-user-access-denied.json"))).client.getMyCapabilities(
        TENANT_A,
        undefined,
        NOW,
      ),
      "invalid-projection",
    );
    await expectFailure(
      clientFor({ status: 200, cacheControl: "public", body: fixture("capability-v1-ready.json") })
        .client.getMyCapabilities(TENANT_A, undefined, NOW),
      "invalid-projection",
    );
    await expectFailure(
      clientFor(
        envelope(200, {
          ...fixture("capability-v1-ready.json"),
          nested: { accessToken: "synthetic-must-not-cross-ipc" },
        }),
      ).client.getMyCapabilities(TENANT_A, undefined, NOW),
      "invalid-projection",
    );
  });

  it.each([
    { schema_version: 2 },
    { tenant_id: "019c0123-4567-7abc-8123-456789abcdee" },
    { authorization_revision: 0 },
    { authorization_revision: Number.MAX_SAFE_INTEGER + 1 },
    { expires_at: "2026-08-01T11:59:59Z" },
    { expires_at: "2026-08-01" },
    { expires_at: "2026-02-30T12:00:00Z" },
    { expires_at: "2026-08-01T24:00:00Z" },
    { expires_at: "2026-08-01T12:05:00.001Z" },
    { capabilities: ["task.read", "task.create"] },
    { capabilities: ["task.read", "task.read"] },
    { capabilities: ["Task.Read"] },
  ])("rejects malformed projection field set %#", async (override) => {
    const body = { ...fixture("capability-v1-ready.json"), ...override };
    await expectFailure(
      clientFor(envelope(200, body)).client.getMyCapabilities(TENANT_A, undefined, NOW),
      "invalid-projection",
    );
  });

  it("rejects duplicate tenant context and invalid operation tenant IDs", async () => {
    const repeated = fixture("tenant-list-v1-single.json").tenants as unknown[];
    await expectFailure(
      clientFor(envelope(200, { tenants: [...repeated, ...repeated] })).client.listMyTenants(),
      "invalid-projection",
    );
    await expectFailure(
      clientFor(envelope(200, fixture("capability-v1-ready.json"))).client.getMyCapabilities(
        "not-a-uuid",
        undefined,
        NOW,
      ),
      "invalid-tenant-context",
    );
  });

  it("abandons an in-flight native response when the operation is aborted", async () => {
    let resolveResponse: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => {
      resolveResponse = resolve;
    });
    const client = createPermissionClient(async <T>() => pending as Promise<T>);
    const controller = new AbortController();
    const request = client.listMyTenants(controller.signal);

    controller.abort();
    await expectFailure(request, "aborted");
    resolveResponse?.(envelope(200, fixture("tenant-list-v1-single.json")));
  });

  it("does not invoke native transport for an already-aborted intent", async () => {
    const nativeInvoke = vi.fn();
    const client = createPermissionClient(nativeInvoke);
    const controller = new AbortController();
    controller.abort();

    await expectFailure(client.listMyTenants(controller.signal), "aborted");
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("maps bounded native command failures without exposing their message", async () => {
    const client = createPermissionClient(async () => {
      throw { code: "native_auth_signed_out", message: "synthetic detail" };
    });
    await expectFailure(client.listMyTenants(), "unauthorized");
  });
});
