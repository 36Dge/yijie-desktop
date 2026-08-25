import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentHostV3Contract,
  safeRelativePath,
  sha256,
  validateLock,
} from "./check-agent-host-v3-contract.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "contracts/agent-host-v3-artifacts.lock.json"), "utf8"),
);

describe("Agent Host v3 Artifact contract pin", () => {
  it("accepts only the exact candidate, source digests, fixture trees and bounded exception", () => {
    expect(validateLock(structuredClone(lock))).toEqual(lock);
    expect(sha256("yijie-v3")).toBe(
      "68d3662172283464e44cf899afbc1f7aeaea24e7ea257e559fa0f1364bccf6bb",
    );
    expect(() => safeRelativePath("../agent-host.yaml")).toThrow();
    expect(() => validateLock({ ...lock, full_commit: "d6dff90" })).toThrow();
    expect(() => validateLock({
      ...lock,
      sources: {
        ...lock.sources,
        event_schema: { ...lock.sources.event_schema, sha256: "0".repeat(64) },
      },
    })).toThrow();
    expect(() => validateLock({
      ...lock,
      consumer: { ...lock.consumer, adapter_status: "not_started" },
    })).toThrow();
    expect(() => validateLock({
      ...lock,
      consumer: {
        ...lock.consumer,
        implementation_files: lock.consumer.implementation_files.slice(1),
      },
    })).toThrow();
  });

  it("verifies the exact clean Contracts checkout and canonical v3 fixtures", async () => {
    await expect(checkAgentHostV3Contract()).resolves.toBeUndefined();
  });
});
