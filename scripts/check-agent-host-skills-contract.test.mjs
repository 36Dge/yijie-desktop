import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentHostSkillsContract,
  safeRelativePath,
  sha256,
  validateBundleFixture,
  validateExceptionWindow,
  validateLock,
  validateRuntimeProjection,
  verifyImplementationPins,
} from "./check-agent-host-skills-contract.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "contracts/agent-host-skills-v1.lock.json"), "utf8"),
);

describe("Agent Host Skills v1 API / Manifest v2 contract pin", () => {
  it("pins Contracts 0.5.1, exact providers, operations and source fixtures", async () => {
    expect(validateLock(structuredClone(lock))).toEqual(lock);
    expect(sha256("yijie-skills-v1")).toBe(
      "7d797b359d4d5ade6c16ba1d6dec78f5be3f057d05c2b5691da65eb32ff4cef0",
    );
    await expect(
      checkAgentHostSkillsContract({ requireImplementation: false }),
    ).resolves.toBeUndefined();
  });

  it("rejects traversal, source drift, capability drift and expired exceptions", () => {
    expect(() => safeRelativePath("../agent-host.yaml")).toThrow();
    expect(() =>
      validateLock({
        ...lock,
        sources: {
          ...lock.sources,
          openapi: { ...lock.sources.openapi, sha256: "0".repeat(64) },
        },
      }),
    ).toThrow();
    expect(() =>
      validateLock({
        ...lock,
        operations: lock.operations.map((operation) =>
          operation.operation_id === "installManagedSkill"
            ? { ...operation, required_capability: "plugin.read" }
            : operation,
        ),
      }),
    ).toThrow();
    expect(() => validateExceptionWindow(lock.exception, "2026-11-24")).toThrow(
      "expired on 2026-11-23",
    );
  });

  it("keeps Runtime Skills method and notification projection closed", () => {
    const projection = {
      contracts_version: "0.5.1",
      runtime: {
        repository_commit: "0ce5902ed400866be0196886bb78f693a004d68d",
        upstream_tag: "rust-v0.144.6",
      },
      host_projection: {
        authentication: "owner-only-bearer",
        runtime_methods: ["skills/config/write", "skills/extraRoots/set", "skills/list"],
        runtime_notifications: ["skills/changed"],
      },
    };
    expect(() => validateRuntimeProjection(projection)).not.toThrow();
    projection.host_projection.runtime_methods.pop();
    expect(() => validateRuntimeProjection(projection)).toThrow("Runtime Skills projection drifted");
  });

  it("keeps the synthetic catalog at 38 entries and 5/9/7/9/8", async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve(repositoryRoot, "../yijie-contracts", lock.bundle_fixture.manifest_path), "utf8"),
    );
    expect(() => validateBundleFixture(manifest, lock)).not.toThrow();
    manifest.skills.pop();
    expect(() => validateBundleFixture(manifest, lock)).toThrow("exactly 38");
  });

  it("fails closed unless every reviewed native implementation digest matches", async () => {
    await expect(verifyImplementationPins(lock)).resolves.toBeUndefined();
  });
});
