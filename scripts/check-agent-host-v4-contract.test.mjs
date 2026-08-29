import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentHostV4Contract,
  safeRelativePath,
  sha256,
  validateHostContractsLock,
  validateLock,
  validateStableActivation,
  verifyExactCheckout,
} from "./check-agent-host-v4-contract.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "contracts/agent-host-v4-streaming.lock.json"), "utf8"),
);
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const runner = await readFile(path.join(repositoryRoot, lock.activation.launcher_script), "utf8");

describe("FEAT-134 Agent Host v4 exact pin", () => {
  it("accepts only the complete immutable Contracts, Host and activation lock", () => {
    expect(validateLock(structuredClone(lock))).toEqual(lock);
    expect(sha256("feat134-v4")).toBe(
      "321dc127dbd8a5ea010fb7393f200951237e61e77974630c260fb341b0ce4b70",
    );
    expect(() => safeRelativePath("../agent-host.yaml")).toThrow();
    expect(() => validateLock({
      ...lock,
      contracts: { ...lock.contracts, full_commit: "0".repeat(40) },
    })).toThrow();
    expect(() => validateLock({
      ...lock,
      agent_host: { ...lock.agent_host, full_commit: "0".repeat(40) },
    })).toThrow();
    expect(() => validateLock({
      ...lock,
      activation: { ...lock.activation, environment: "production" },
    })).toThrow();
  });

  it("verifies both exact clean sibling commits and their synchronized v4 sources", async () => {
    await expect(checkAgentHostV4Contract()).resolves.toBeUndefined();
    await expect(verifyExactCheckout(
      path.resolve(repositoryRoot, "../yijie-contracts"),
      lock.contracts.repository,
      "0".repeat(40),
      "Contracts",
    )).rejects.toThrow("HEAD");
    await expect(verifyExactCheckout(
      path.resolve(repositoryRoot, "../yijie-agent-host"),
      "https://example.invalid/wrong-host.git",
      lock.agent_host.full_commit,
      "Agent Host",
    )).rejects.toThrow("origin");
  });

  it("pins the Host consumption lock bytes and rejects any drift", async () => {
    const bytes = await readFile(path.resolve(repositoryRoot, "../yijie-agent-host/api/contracts.lock"));
    expect(validateHostContractsLock(bytes)).toMatchObject({
      CONTRACTS_VERSION: "0.6.0",
      CONTRACTS_COMMIT: "3832a6c5e99b2a6365f193280fdb887c8fdbc2de",
      AGENT_SESSION_EVENT_V4_SCHEMA_SHA256:
        "d972806e59195c5e1f5fe810db6e1df80be349b77ecc4cf192ed0f391d9ed739",
    });
    expect(() => validateHostContractsLock(Buffer.concat([bytes, Buffer.from("# drift\n")])))
      .toThrow("digest");
  });
});

describe("FEAT-134 stable-only launcher boundary", () => {
  it("accepts the exact local demo_fast stable launcher and package build", () => {
    expect(() => validateStableActivation(packageJson, runner, lock.activation)).not.toThrow();
  });

  it.each([
    ["missing runtime flag", runner.replace("      YIJIE_FEAT134_STREAMING_ENABLED=true\n", "")],
    ["missing compile flag", runner.replace("      VITE_YIJIE_FEAT134_STREAMING_ENABLED=true\n", "")],
    ["production runtime", runner.replace("  YIJIE_ENV=local \\", "  YIJIE_ENV=production \\")],
    [
      "public profile",
      runner.replace("  YIJIE_LOCAL_PROFILE=demo_fast \\", "  YIJIE_LOCAL_PROFILE=public \\")
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(() => validateStableActivation(packageJson, candidate, lock.activation)).toThrow(
      "exact local/demo_fast/stable",
    );
  });

  it("rejects FEAT-134 injection from a non-stable or production package entry", () => {
    const nonStable = structuredClone(packageJson);
    nonStable.scripts["tauri:build:demo-fast"] +=
      " VITE_YIJIE_FEAT134_STREAMING_ENABLED=true";
    expect(() => validateStableActivation(nonStable, runner, lock.activation)).toThrow(
      "non-stable package entry",
    );

    const production = structuredClone(packageJson);
    production.scripts["tauri:build"] += ' YIJIE_FEAT134_STREAMING_ENABLED="true"';
    expect(() => validateStableActivation(production, runner, lock.activation)).toThrow(
      "non-stable package entry",
    );
  });
});
