import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPinnedOpenApiParser,
  projectCanonicalFixture,
  safeRelativePath,
  sha256,
  validateContractDocument,
  validateConsumerPins,
  validateExceptionWindow,
  validateLock,
  verifyContractsCheckout,
} from "./check-agent-host-contract.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const contractsRoot = path.resolve(repositoryRoot, "../yijie-contracts");
const temporaryDirectories = [];

const validLock = {
  schema_version: 1,
  contract_version: "0.4.0-candidate",
  repository: "https://github.com/36Dge/yijie-contracts.git",
  full_commit: "ea48fe190e18afba728712d1e2cc79cda57f581b",
  source: {
    path: "openapi/agent-host/agent-host.yaml",
    sha256: "cf72ba8dd6910e8454ad60feeffa5e82583303b441dad78e49910fbdb9f5420f",
  },
  operation: {
    method: "post",
    path: "/v2/agent-sessions/{agent_session_id}/turns",
    operation_id: "startAgentTurnV2",
    request_schema: "#/components/schemas/StartTurnV2Request",
  },
  canonical_fixture: {
    source_path: "tests/fixtures/agent/host-v2/turn-request.json",
    source_sha256: "ec464ce56f749852e65be8d1472d8f5d8cccc82c89d2dd16fab33fbdbe62decc",
    snapshot_path: "src-tauri/fixtures/agent-host-v2/turn-request.json",
    snapshot_sha256: "ec464ce56f749852e65be8d1472d8f5d8cccc82c89d2dd16fab33fbdbe62decc",
  },
  parser: {
    package: "@redocly/openapi-core",
    version: "1.34.18",
    api: "parseYaml",
    provided_by: "openapi-typescript@7.13.0",
  },
  consumer: {
    mode: "hand-written-rust-adapter",
    adapter_path: "src-tauri/src/chat/host_bridge.rs",
    adapter_sha256: "c6e90e0e8eff736101fd2cf9eea39cf70064f9c59ab0bcd90b2e2fc9286e221d",
    readiness_path: "src-tauri/src/chat/mod.rs",
    readiness_sha256: "9041d9bbf62d6f03661ba0eeb110e02156eae6ea544829fd67d39874e3134085",
    public_lock_path: "contracts/public-api.lock.json",
    serialization_test:
      "chat::host_bridge::tests::start_turn_v2_adapter_serializes_canonical_contract_projection",
    approved_rust_generator: "N/A",
    generator_rationale: "No approved Rust generator; pinned conformance is required.",
    canonical_projection_omits_optional_fields: [
      "trace_id",
      "request_id",
      "tenant_id",
      "user_id",
      "reasoning_effort",
    ],
  },
  exception: {
    id: "EXC-127-002",
    scope: "Pinned hand-written adapter.",
    owner: "段成威",
    approved_on: "2026-08-19",
    expires_on: "2026-11-17",
    status: "active",
    removal_trigger: "Approved Rust generator or schema change.",
  },
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

async function git(root, ...arguments_) {
  return exec("git", ["-C", root, ...arguments_]);
}

describe("Agent Host v2 turn contract pin", () => {
  it("accepts only the complete candidate pin, exception and safe paths", () => {
    expect(validateLock(structuredClone(validLock))).toEqual(validLock);
    expect(sha256("yijie")).toBe(
      "8c02bb5a59c6def6ab883dc47f7b6eac9c022a0c005c6f083ad8a22778633bb6",
    );
    expect(() => safeRelativePath("../agent-host.yaml")).toThrow();
    expect(() => validateLock({ ...validLock, full_commit: "ebdd30f" })).toThrow();
    expect(() => validateLock({
      ...validLock,
      consumer: { ...validLock.consumer, approved_rust_generator: "unreviewed" },
    })).toThrow();
    expect(() => validateLock({
      ...validLock,
      exception: { ...validLock.exception, expires_on: "never" },
    })).toThrow();
  });

  it("closes the temporary adapter exception after its inclusive expiry boundary", () => {
    expect(() => validateExceptionWindow(validLock.exception, "2026-11-17")).not.toThrow();
    expect(() => validateExceptionWindow(validLock.exception, "2026-11-18"))
      .toThrow("expired on 2026-11-17");
    expect(() => validateExceptionWindow(validLock.exception, "2026-02-30"))
      .toThrow("ISO calendar dates");
  });

  it("rejects tracked and untracked drift in an otherwise pinned checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yijie-agent-host-pin-"));
    temporaryDirectories.push(root);
    await git(root, "init", "--quiet");
    await git(root, "config", "user.name", "Contract Test");
    await git(root, "config", "user.email", "contract-test@example.invalid");
    await writeFile(path.join(root, "tracked.txt"), "pinned\n");
    await git(root, "add", "tracked.txt");
    await git(root, "commit", "--quiet", "-m", "pinned");
    await git(root, "remote", "add", "origin", validLock.repository);
    const { stdout } = await git(root, "rev-parse", "HEAD");
    const checkoutLock = { ...validLock, full_commit: stdout.trim() };

    await expect(verifyContractsCheckout(checkoutLock, root)).resolves.toBeUndefined();
    await expect(verifyContractsCheckout({
      ...checkoutLock,
      full_commit: "0".repeat(40),
    }, root)).rejects.toThrow("contracts HEAD");
    await expect(verifyContractsCheckout({
      ...checkoutLock,
      repository: "https://example.invalid/wrong-contracts.git",
    }, root)).rejects.toThrow("origin");
    await writeFile(path.join(root, "tracked.txt"), "drift\n");
    await expect(verifyContractsCheckout(checkoutLock, root)).rejects.toThrow("not clean");
    await writeFile(path.join(root, "tracked.txt"), "pinned\n");
    await writeFile(path.join(root, "untracked.txt"), "drift\n");
    await expect(verifyContractsCheckout(checkoutLock, root)).rejects.toThrow("not clean");
  });

  it("pins exact source/fixture bytes and validates canonical plus Rust projection", async () => {
    const lock = validateLock(structuredClone(validLock));
    const [source, fixtureSource, snapshot, parseYaml] = await Promise.all([
      readFile(path.join(contractsRoot, lock.source.path)),
      readFile(path.join(contractsRoot, lock.canonical_fixture.source_path)),
      readFile(path.join(repositoryRoot, lock.canonical_fixture.snapshot_path)),
      loadPinnedOpenApiParser(lock),
    ]);
    expect(sha256(source)).toBe(lock.source.sha256);
    expect(sha256(fixtureSource)).toBe(lock.canonical_fixture.source_sha256);
    expect(sha256(snapshot)).toBe(lock.canonical_fixture.snapshot_sha256);
    expect(snapshot.equals(fixtureSource)).toBe(true);

    const fixture = JSON.parse(fixtureSource.toString("utf8"));
    const projection = validateContractDocument(
      parseYaml(source.toString("utf8")),
      lock,
      fixture,
    );
    expect(projection).toEqual(projectCanonicalFixture(fixture));
    expect(projection.content_blocks.map(({ type }) => type)).toEqual(["text", "file", "image"]);

    const invalid = structuredClone(fixture);
    invalid.content_blocks[1].media_type = "application/zip";
    expect(() => validateContractDocument(
      parseYaml(source.toString("utf8")),
      lock,
      invalid,
    )).toThrow("does not match");
  });

  it("requires Public, Host-wire and Rust readiness pins to remain identical", async () => {
    const lock = validateLock(structuredClone(validLock));
    const [publicLock, readinessSource] = await Promise.all([
      readFile(path.join(repositoryRoot, lock.consumer.public_lock_path), "utf8").then(JSON.parse),
      readFile(path.join(repositoryRoot, lock.consumer.readiness_path), "utf8"),
    ]);
    expect(() => validateConsumerPins(lock, publicLock, readinessSource)).not.toThrow();
    expect(() => validateConsumerPins(
      lock,
      { ...publicLock, full_commit: "0".repeat(40) },
      readinessSource,
    )).toThrow("different commits");
    expect(() => validateConsumerPins(
      lock,
      publicLock,
      readinessSource.replace(lock.full_commit, "0".repeat(40)),
    )).toThrow("reviewed digest");
    expect(() => validateConsumerPins(
      lock,
      publicLock,
      `/*\nconst CONTRACT_COMMIT: &str = "${lock.full_commit}";\n*/\n` +
        readinessSource.replace(lock.full_commit, "0".repeat(40)),
    )).toThrow("reviewed digest");
  });
});
