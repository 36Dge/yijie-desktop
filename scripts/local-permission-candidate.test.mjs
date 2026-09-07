import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isLocalPermissionCandidate, validatePermissionPins } from "./local-permission-candidate.mjs";
describe("local permission candidate admission", () => {
  it("requires both permission flags and the exact local scope without requiring a test meter", () => {
    const local = { YIJIE_ENV: "local", YIJIE_LOCAL_PROFILE: "demo_fast", YIJIE_RUNTIME_PERMISSIONS_ENABLED: "true", VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED: "true" };
    expect(isLocalPermissionCandidate({})).toBe(false);
    expect(isLocalPermissionCandidate(local)).toBe(true);
    for (const key of Object.keys(local)) expect(isLocalPermissionCandidate({ ...local, [key]: "" })).toBe(false);
    expect(isLocalPermissionCandidate({ ...local, YIJIE_ENV: "production" })).toBe(false);
    expect(isLocalPermissionCandidate({ ...local, YIJIE_ENV: "public" })).toBe(false);
    expect(isLocalPermissionCandidate({ ...local, YIJIE_LOCAL_PROFILE: "production_hardened" })).toBe(false);
    expect(isLocalPermissionCandidate({ ...local, YIJIE_PERMISSION_VERIFICATION_BASE_URL: "http://127.0.0.1:18083/v1" })).toBe(true);
    expect(isLocalPermissionCandidate({ ...local, YIJIE_PERMISSION_VERIFICATION_BASE_URL: "http://127.0.0.1:18084/v1" })).toBe(false);
  });
  it("links the Desktop pins to the committed Host contract lock", () => {
    const lock = JSON.parse(readFileSync(new URL("../contracts/runtime-permissions.lock.json", import.meta.url), "utf8"));
    const hostLock = JSON.parse(readFileSync(new URL("../../yijie-agent-host/api/runtime-permissions.lock.json", import.meta.url), "utf8"));
    expect(() => validatePermissionPins(lock, hostLock)).not.toThrow();
    const differentFamily = structuredClone(lock);
    differentFamily.contract_family_version = "0.2.0";
    expect(() => validatePermissionPins(differentFamily, hostLock)).toThrow("inconsistent");
    const differentContract = structuredClone(hostLock);
    differentContract.contracts.full_commit = lock.agent_host.full_commit;
    expect(() => validatePermissionPins(lock, differentContract)).toThrow("inconsistent");
    const missingHostLock = structuredClone(lock);
    delete missingHostLock.agent_host.sources["api/runtime-permissions.lock.json"];
    expect(() => validatePermissionPins(missingHostLock, hostLock)).toThrow("inconsistent");
  });
});
