import { describe, expect, it } from "vitest";
import { userInputDraftScope } from "./user-input-draft-scope";
import type { KnownCapability } from "./permissions";
const projection = () => ({ ready: true, tenantId: "ordinary-native-tenant", authorizationRevision: 7, expiresAt: new Date(Date.now() + 300_000).toISOString(), capabilities: ["task.read", "task.create"] as KnownCapability[] });
describe("question draft scope derived from Native projection", () => {
  it("treats only expiry extension and capability ordering as ordinary renewal", () => {
    const a = projection(), old = userInputDraftScope(a)!;
    const renewed = userInputDraftScope({ ...a, expiresAt: new Date(Date.now() + 400_000).toISOString(), capabilities: [...a.capabilities].reverse() })!;
    expect(renewed.key).toBe(old.key);
    expect(renewed.expiresAt).toBeGreaterThan(old.expiresAt);
    expect(userInputDraftScope({ ...a, authorizationRevision: 8 })?.key).not.toBe(old.key);
    expect(userInputDraftScope({ ...a, capabilities: ["task.read"] })?.key).not.toBe(old.key);
    expect(userInputDraftScope({ ...a, tenantId: "another-tenant" })?.key).not.toBe(old.key);
  });
  it("has no retention scope for unknown, expired or unreadable authority", () => {
    const a = projection();
    for (const change of [{ ready: false }, { tenantId: null }, { authorizationRevision: null }, { authorizationRevision: 0 }, { expiresAt: null }, { expiresAt: new Date(Date.now() - 1).toISOString() }, { capabilities: ["task.create"] as KnownCapability[] }]) expect(userInputDraftScope({ ...a, ...change })).toBeNull();
  });
});
