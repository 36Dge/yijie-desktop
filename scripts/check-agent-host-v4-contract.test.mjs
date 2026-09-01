import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentHostV4Contract,
  safeRelativePath,
  sha256,
  validateHostContractsLock,
  validateLock,
  validateRuntimeProjection,
  validateRuntimeProjectionV4Bytes,
  validateStableActivation,
  readPinnedGitFile,
  verifyImmutableGitObject,
} from "./check-agent-host-v4-contract.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "contracts/agent-host-v4-streaming.lock.json"), "utf8"),
);
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const runner = await readFile(path.join(repositoryRoot, lock.activation.launcher_script), "utf8");
const contractsRoot = path.resolve(repositoryRoot, "../yijie-contracts");
const agentHostRoot = path.resolve(repositoryRoot, "../yijie-agent-host");
const runtimeProjectionBytes = await readPinnedGitFile(
  contractsRoot,
  lock.contracts.full_commit,
  lock.contracts.sources.runtime_projection,
);
const runtimeProjection = JSON.parse(runtimeProjectionBytes.toString("utf8"));

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

  it("verifies immutable v4 objects while current clean siblings provide v6 execution", async () => {
    await expect(checkAgentHostV4Contract()).resolves.toBeUndefined();
    await expect(verifyImmutableGitObject(
      contractsRoot,
      lock.contracts.repository,
      "0".repeat(40),
      "Contracts",
    )).rejects.toThrow("immutable commit");
    await expect(verifyImmutableGitObject(
      agentHostRoot,
      "https://example.invalid/wrong-host.git",
      lock.agent_host.full_commit,
      "Agent Host",
    )).rejects.toThrow("origin");

    await expect(
      import("node:child_process").then(({ execFileSync }) =>
        execFileSync("git", ["-C", contractsRoot, "rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ),
    ).resolves.toBe("aeccf5d561bd4259389cdb325bae84ce3e0dea86");
    await expect(
      import("node:child_process").then(({ execFileSync }) =>
        execFileSync("git", ["-C", agentHostRoot, "rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ),
    ).resolves.toBe("078769a22d035c2921e315e5776185bed6f7feeb");
  });

  it("pins the Host consumption lock bytes and rejects any drift", async () => {
    const bytes = await readPinnedGitFile(
      agentHostRoot,
      lock.agent_host.full_commit,
      lock.agent_host.contracts_lock,
    );
    expect(validateHostContractsLock(bytes)).toMatchObject({
      CONTRACTS_VERSION: "0.7.0",
      CONTRACTS_COMMIT: "87f94c9aa6d4848cb67aa8a1265bd21474edb0bb",
      OPENAPI_SHA256: "bd53dfd84976c81b5154c587c72547a5b698b72d301a4850fd0b6338022f9c83",
      RUNTIME_COMPATIBILITY_SHA256:
        "6cef3f4ac60ec91b9f7f05b188dc677169fc11e0bedf34350f6342a6f50981bb",
      AGENT_SESSION_EVENT_V4_SCHEMA_SHA256:
        "d972806e59195c5e1f5fe810db6e1df80be349b77ecc4cf192ed0f391d9ed739",
    });
    expect(() => validateHostContractsLock(Buffer.concat([bytes, Buffer.from("# drift\n")])))
      .toThrow("digest");
  });

  it("keeps the v4 schema, proto, five fixtures and Runtime policy invariant at v0.7", () => {
    expect(lock.contract_version).toBe("0.7.0");
    expect(lock.contracts.sources.event_schema.sha256).toBe(
      "d972806e59195c5e1f5fe810db6e1df80be349b77ecc4cf192ed0f391d9ed739",
    );
    expect(lock.contracts.sources.protobuf.sha256).toBe(
      "7130ffad6f7d415bbaaf35a10bc380b2b75ecaaa4762dc871ce0a274472ecdea",
    );
    expect(lock.contracts.fixture_tree.git_tree_oid).toBe(
      "34c1d28d00a5693c408803bdf42ed742bbe1448a",
    );
    expect(lock.agent_host.fixture_tree.git_tree_oid).toBe(
      lock.contracts.fixture_tree.git_tree_oid,
    );
    expect(() => validateRuntimeProjectionV4Bytes(runtimeProjectionBytes)).not.toThrow();
    expect(() => validateRuntimeProjection(structuredClone(runtimeProjection))).not.toThrow();

    const oldRuntimeProvenance = structuredClone(runtimeProjection);
    oldRuntimeProvenance.runtime.repository_commit =
      "0ce5902ed400866be0196886bb78f693a004d68d";
    expect(() => validateRuntimeProjection(oldRuntimeProvenance)).toThrow(
      "Runtime compatibility projection drifted",
    );

    const changedRuntimeBytes = Buffer.from(
      runtimeProjectionBytes.toString("utf8").replace('"transport": "stdio"', '"transport": "STDIO"'),
    );
    expect(() => validateRuntimeProjectionV4Bytes(changedRuntimeBytes)).toThrow(
      "Runtime v4 byte baseline drifted",
    );

    const missingV4Notification = structuredClone(runtimeProjection);
    missingV4Notification.host_projection.runtime_notifications =
      missingV4Notification.host_projection.runtime_notifications.filter(
        (notification) => notification !== "turn/started",
      );
    expect(() => validateRuntimeProjection(missingV4Notification)).toThrow(
      "Runtime compatibility projection drifted",
    );

    const widenedSandbox = structuredClone(runtimeProjection);
    widenedSandbox.host_projection.sandbox = "workspace-write";
    expect(() => validateRuntimeProjection(widenedSandbox)).toThrow(
      "Runtime compatibility projection drifted",
    );
  });
});

describe("FEAT-134 stable-only launcher boundary", () => {
  it("accepts the exact local demo_fast stable launcher and package build", () => {
    expect(() => validateStableActivation(packageJson, runner, lock.activation)).not.toThrow();
  });

  it.each([
    ["missing runtime flag", runner.replace("      YIJIE_FEAT134_STREAMING_ENABLED=true\n", "")],
    ["missing compile flag", runner.replace("      VITE_YIJIE_FEAT134_STREAMING_ENABLED=true\n", "")],
    [
      "missing FEAT-136 runtime flag",
      runner.replace("      YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED=true\n", ""),
    ],
    [
      "missing FEAT-136 compile flag",
      runner.replace("      VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true\n", ""),
    ],
    ["production runtime", runner.replace("  YIJIE_ENV=local \\", "  YIJIE_ENV=production \\")],
    [
      "public profile",
      runner.replace("  YIJIE_LOCAL_PROFILE=demo_fast \\", "  YIJIE_LOCAL_PROFILE=public \\")
    ],
    [
      "Bash nounset-unsafe empty environment expansion",
      runner.replace(
        '"${feat134_environment[@]+"${feat134_environment[@]}"}"',
        '"${feat134_environment[@]}"',
      ),
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

    const feat136NonStable = structuredClone(packageJson);
    feat136NonStable.scripts["tauri:build:demo-fast"] +=
      " VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true";
    expect(() => validateStableActivation(feat136NonStable, runner, lock.activation)).toThrow(
      "non-stable package entry",
    );
  });
});
