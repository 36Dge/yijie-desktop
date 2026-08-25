import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { loadPinnedOpenApiParser } from "./check-agent-host-contract.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/agent-host-skills-v1.lock.json");
const PINNED_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const PINNED_COMMIT = "d6dff903e0c12b6a5e69599df1e33ef46d8bea6b";
const PINNED_VERSION = "0.5.0";
const ZERO_SHA256 = "0".repeat(64);
const SOURCE_PINS = Object.freeze({
  openapi: [
    "openapi/agent-host/agent-host.yaml",
    "406b55dad02d5a3d489955bcf29c973b94252c3e300f8ff853709a71d6874431",
  ],
  bundle_manifest_schema: [
    "jsonschema/skills/skill-bundle-manifest-v1.schema.json",
    "d86185a1d5f4d9a136c88b679d50ac3e83bcc2b722eee39cba674c5be3b88469",
  ],
  runtime_projection: [
    "compatibility/agent-host-runtime-v1.json",
    "6b7662d4237486300456f16abd0305fe1ea267b70a85e497ba7ab15a654939ee",
  ],
});
const FIXTURE_TREE_PINS = new Map([
  ["tests/fixtures/agent/host-skills-v1", "80138d31544965e6ccca142bfbd311e17906ea08"],
  ["tests/fixtures/skills/bundle-v1", "7afc9656d56523b929c85ffc9ba45f093a0e0e4a"],
]);
const OPERATIONS = new Map([
  ["get /v1/skills", ["listManagedSkills", "plugin.read"]],
  ["post /v1/skills/scan-operations", ["scanManagedSkills", "plugin.manage"]],
  [
    "post /v1/skills/{skill_id}/install-operations",
    ["installManagedSkill", "plugin.manage"],
  ],
  ["put /v1/skills/{skill_id}/enabled", ["setManagedSkillEnabled", "plugin.manage"]],
  [
    "post /v1/skills/{skill_id}/uninstall-operations",
    ["uninstallManagedSkill", "plugin.manage"],
  ],
]);
const FIXTURE_SCHEMAS = new Map([
  ["enabled-request.json", "SkillEnabledRequest"],
  ["error-archive-unsafe.json", "SkillErrorResponse"],
  ["install-request.json", "SkillInstallRequest"],
  ["list-response.json", "SkillListResponse"],
  ["mutation-response.json", "SkillMutationResponse"],
  ["scan-request.json", "SkillScanRequest"],
  ["uninstall-request.json", "SkillUninstallRequest"],
]);
const IMPLEMENTATION_PATHS = Object.freeze([
  "src-tauri/src/skills/host.rs",
  "src-tauri/src/skills/mod.rs",
  "src-tauri/src/skills/catalog.rs",
  "src-tauri/src/skills/resources.rs",
  "src-tauri/src/local_profile.rs",
  "src-tauri/src/native_auth/runtime.rs",
  "src-tauri/src/chat/host_bridge.rs",
  "src-tauri/src/chat/host_domain.rs",
  "src-tauri/src/chat/sidecar.rs",
  "src-tauri/src/lib.rs",
]);
const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    throw new Error("contract path must be a non-empty relative path");
  }
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error("contract path must stay inside its repository");
  }
  return normalized;
}

function samePinnedSources(sources) {
  return Object.entries(SOURCE_PINS).every(
    ([name, [sourcePath, digest]]) =>
      sources?.[name]?.path === sourcePath && sources?.[name]?.sha256 === digest,
  );
}

function sameFixtureTrees(entries) {
  return (
    Array.isArray(entries) &&
    entries.length === FIXTURE_TREE_PINS.size &&
    entries.every((entry) => FIXTURE_TREE_PINS.get(entry?.path) === entry?.git_tree_oid)
  );
}

function sameOperations(entries) {
  return (
    Array.isArray(entries) &&
    entries.length === OPERATIONS.size &&
    entries.every((entry) => {
      const expected = OPERATIONS.get(`${entry?.method} ${entry?.path}`);
      return (
        expected?.[0] === entry?.operation_id && expected?.[1] === entry?.required_capability
      );
    })
  );
}

function sameImplementationPaths(entries) {
  return (
    Array.isArray(entries) &&
    entries.length === IMPLEMENTATION_PATHS.length &&
    entries.every(
      (entry, index) =>
        entry?.path === IMPLEMENTATION_PATHS[index] && /^[a-f0-9]{64}$/.test(entry?.sha256 ?? ""),
    )
  );
}

function calendarDate(value) {
  if (typeof value !== "string" || !ISO_CALENDAR_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateExceptionWindow(exception, currentDate = new Date().toISOString().slice(0, 10)) {
  if (!calendarDate(currentDate) || !calendarDate(exception?.expires_on)) {
    throw new Error("Agent Host Skills adapter exception dates must be ISO calendar dates");
  }
  if (currentDate > exception.expires_on) {
    throw new Error(`Agent Host Skills adapter exception expired on ${exception.expires_on}`);
  }
}

export function validateLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.contract_version !== PINNED_VERSION ||
    lock.repository !== PINNED_REPOSITORY ||
    lock.full_commit !== PINNED_COMMIT ||
    !samePinnedSources(lock.sources) ||
    !sameFixtureTrees(lock.fixture_trees) ||
    !sameOperations(lock.operations) ||
    lock.parser?.package !== "@redocly/openapi-core" ||
    lock.parser?.version !== "1.34.18" ||
    lock.parser?.api !== "parseYaml" ||
    lock.parser?.provided_by !== "openapi-typescript@7.13.0" ||
    lock.validator?.package !== "ajv" ||
    lock.validator?.version !== "8.17.1" ||
    lock.consumer?.owner !== "段成威" ||
    lock.consumer?.mode !== "hand-written-rust-adapter" ||
    !["pending_digest_refresh", "implemented"].includes(lock.consumer?.implementation_status) ||
    !sameImplementationPaths(lock.consumer?.implementation_files) ||
    lock.consumer?.approved_rust_generator !== "N/A" ||
    typeof lock.consumer?.generator_rationale !== "string" ||
    lock.consumer.generator_rationale.length === 0 ||
    lock.exception?.id !== "EXC-129-001" ||
    lock.exception?.owner !== "段成威" ||
    lock.exception?.approved_on !== "2026-08-25" ||
    lock.exception?.expires_on !== "2026-11-23" ||
    lock.exception?.status !== "active" ||
    typeof lock.exception?.scope !== "string" ||
    lock.exception.scope.length === 0 ||
    typeof lock.exception?.removal_trigger !== "string" ||
    lock.exception.removal_trigger.length === 0 ||
    !Array.isArray(lock.fixtures) ||
    lock.fixtures.length !== FIXTURE_SCHEMAS.size
  ) {
    throw new Error("Agent Host Skills v1 contract lock is incomplete or invalid");
  }
  const fixtureNames = new Set();
  for (const fixture of lock.fixtures) {
    safeRelativePath(fixture?.source_path);
    safeRelativePath(fixture?.snapshot_path);
    const name = path.basename(fixture.source_path);
    if (
      !FIXTURE_SCHEMAS.has(name) ||
      path.basename(fixture.snapshot_path) !== name ||
      fixtureNames.has(name) ||
      !/^[a-f0-9]{64}$/.test(fixture?.sha256 ?? "")
    ) {
      throw new Error("Agent Host Skills fixture pin is invalid");
    }
    fixtureNames.add(name);
  }
  for (const { path: sourcePath } of Object.values(lock.sources)) safeRelativePath(sourcePath);
  for (const fixture of lock.fixture_trees) safeRelativePath(fixture.path);
  for (const implementation of lock.consumer.implementation_files) {
    safeRelativePath(implementation.path);
  }
  validateExceptionWindow(lock.exception);
  return lock;
}

function normalizeRepository(value) {
  return value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();
}

async function git(root, ...arguments_) {
  const { stdout } = await exec("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

export async function verifyContractsCheckout(lock, contractsRoot) {
  const [head, status, origin] = await Promise.all([
    git(contractsRoot, "rev-parse", "HEAD"),
    git(contractsRoot, "status", "--porcelain"),
    git(contractsRoot, "remote", "get-url", "origin"),
  ]);
  if (head !== lock.full_commit) throw new Error(`contracts HEAD is ${head}, expected ${lock.full_commit}`);
  if (status !== "") throw new Error("contracts checkout is not clean");
  if (normalizeRepository(origin) !== normalizeRepository(lock.repository)) {
    throw new Error("contracts origin does not match the pinned repository");
  }
}

async function verifyBytes(root, relativePath, expectedDigest) {
  const bytes = await readFile(path.join(root, safeRelativePath(relativePath)));
  const actual = sha256(bytes);
  if (actual !== expectedDigest) {
    throw new Error(`${relativePath} digest is ${actual}, expected ${expectedDigest}`);
  }
  return bytes;
}

function dereferenceSchema(document, value, stack = []) {
  if (Array.isArray(value)) return value.map((item) => dereferenceSchema(document, item, stack));
  if (value === null || typeof value !== "object") return value;
  if (typeof value.$ref === "string") {
    const prefix = "#/components/schemas/";
    if (!value.$ref.startsWith(prefix)) throw new Error(`unsupported schema reference ${value.$ref}`);
    const name = value.$ref.slice(prefix.length);
    if (stack.includes(name)) throw new Error(`circular schema reference ${[...stack, name].join(" -> ")}`);
    const schema = document.components?.schemas?.[name];
    if (!schema) throw new Error(`missing schema ${name}`);
    return dereferenceSchema(document, schema, [...stack, name]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, dereferenceSchema(document, item, stack)]),
  );
}

function compileSchema(document, name) {
  const schema = document.components?.schemas?.[name];
  if (!schema) throw new Error(`missing schema ${name}`);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: {
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "date-time": true,
      int32: { type: "number", validate: Number.isInteger },
    },
  });
  return ajv.compile(dereferenceSchema(document, schema, [name]));
}

function referencedResponse(document, operation, status) {
  const response = operation.responses?.[status];
  if (!response?.$ref) return response;
  const prefix = "#/components/responses/";
  if (!response.$ref.startsWith(prefix)) throw new Error(`unsupported response reference ${response.$ref}`);
  return document.components?.responses?.[response.$ref.slice(prefix.length)];
}

export function validateOpenApi(document, lock) {
  if (
    document.info?.version !== PINNED_VERSION ||
    JSON.stringify(document.security) !== JSON.stringify([{ localBearer: [] }]) ||
    document.components?.securitySchemes?.localBearer?.scheme !== "bearer"
  ) {
    throw new Error("Agent Host owner-only security projection drifted");
  }
  for (const expected of lock.operations) {
    const operation = document.paths?.[expected.path]?.[expected.method];
    if (
      operation?.operationId !== expected.operation_id ||
      operation?.["x-yijie-required-capability"] !== expected.required_capability
    ) {
      throw new Error(`${expected.operation_id} operation or capability drifted`);
    }
    for (const status of Object.keys(operation.responses ?? {})) {
      const response = referencedResponse(document, operation, status);
      if (response?.headers?.["Cache-Control"]?.$ref !== "#/components/headers/NoStore") {
        throw new Error(`${expected.operation_id} ${status} does not require no-store`);
      }
    }
  }
  const install = document.paths?.["/v1/skills/{skill_id}/install-operations"]?.post;
  const requestReference = install?.requestBody?.content?.["application/json"]?.schema?.$ref;
  const installSchema = document.components?.schemas?.SkillInstallRequest;
  if (
    requestReference !== "#/components/schemas/SkillInstallRequest" ||
    JSON.stringify(installSchema?.required) !==
      JSON.stringify(["operation_id", "expected_version", "expected_archive_sha256", "catalog_revision"]) ||
    /(?:destination_|source_)?path|skill_content|instructions|token/i.test(JSON.stringify(installSchema))
  ) {
    throw new Error("Skill install request is not the pinned pathless operation");
  }
}

export function validateRuntimeProjection(projection) {
  const methods = new Set(projection?.host_projection?.runtime_methods ?? []);
  const notifications = new Set(projection?.host_projection?.runtime_notifications ?? []);
  if (
    projection?.contracts_version !== PINNED_VERSION ||
    projection?.runtime?.repository_commit !== "0ce5902ed400866be0196886bb78f693a004d68d" ||
    projection?.runtime?.upstream_tag !== "rust-v0.144.6" ||
    projection?.host_projection?.authentication !== "owner-only-bearer" ||
    !["skills/config/write", "skills/extraRoots/set", "skills/list"].every((method) => methods.has(method)) ||
    !notifications.has("skills/changed")
  ) {
    throw new Error("Runtime Skills projection drifted");
  }
}

async function verifyFixtures(document, lock, contractsRoot) {
  for (const fixture of lock.fixtures) {
    const [source, snapshot] = await Promise.all([
      verifyBytes(contractsRoot, fixture.source_path, fixture.sha256),
      verifyBytes(repositoryRoot, fixture.snapshot_path, fixture.sha256),
    ]);
    if (!source.equals(snapshot)) throw new Error(`${fixture.snapshot_path} differs from its source`);
    const name = path.basename(fixture.source_path);
    const validate = compileSchema(document, FIXTURE_SCHEMAS.get(name));
    const value = JSON.parse(source.toString("utf8"));
    if (!validate(value)) throw new Error(`${name} is invalid: ${JSON.stringify(validate.errors)}`);
  }
}

async function verifyFixtureTrees(lock, contractsRoot) {
  for (const fixture of lock.fixture_trees) {
    const actual = await git(contractsRoot, "rev-parse", `${lock.full_commit}:${fixture.path}`);
    if (actual !== fixture.git_tree_oid) throw new Error(`${fixture.path} tree differs from its pin`);
  }
}

export async function verifyImplementationPins(lock) {
  if (lock.consumer.implementation_status !== "implemented") {
    throw new Error("Agent Host Skills consumer implementation digest refresh is pending");
  }
  for (const implementation of lock.consumer.implementation_files) {
    if (implementation.sha256 === ZERO_SHA256) {
      throw new Error(`${implementation.path} still has a placeholder digest`);
    }
    await verifyBytes(repositoryRoot, implementation.path, implementation.sha256);
  }
}

export async function checkAgentHostSkillsContract({ requireImplementation = true } = {}) {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  const contractsRoot = path.resolve(
    repositoryRoot,
    process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  await verifyContractsCheckout(lock, contractsRoot);
  const [openApiBytes, runtimeBytes, parseYaml] = await Promise.all([
    verifyBytes(contractsRoot, lock.sources.openapi.path, lock.sources.openapi.sha256),
    verifyBytes(
      contractsRoot,
      lock.sources.runtime_projection.path,
      lock.sources.runtime_projection.sha256,
    ),
    loadPinnedOpenApiParser(lock),
    verifyBytes(
      contractsRoot,
      lock.sources.bundle_manifest_schema.path,
      lock.sources.bundle_manifest_schema.sha256,
    ),
    verifyFixtureTrees(lock, contractsRoot),
  ]);
  const document = parseYaml(openApiBytes.toString("utf8"));
  validateOpenApi(document, lock);
  validateRuntimeProjection(JSON.parse(runtimeBytes));
  await verifyFixtures(document, lock, contractsRoot);
  if (requireImplementation) await verifyImplementationPins(lock);
  process.stdout.write(
    `Agent Host Skills v1 contract sources and fixtures verified at ${lock.full_commit}` +
      `${requireImplementation ? "; native consumer pins are complete" : "; native consumer pins were not checked"}.\n`,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkAgentHostSkillsContract().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Skills contract check failed"}\n`);
    process.exitCode = 1;
  });
}
