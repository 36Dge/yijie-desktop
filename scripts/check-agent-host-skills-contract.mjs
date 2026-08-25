import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { loadPinnedOpenApiParser } from "./check-agent-host-contract.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/agent-host-skills-v1.lock.json");
const PINNED_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const PINNED_COMMIT = "164b14f609537d727a52326832da04430aecc4ab";
const PINNED_VERSION = "0.5.1";
const SOURCE_PINS = Object.freeze({
  openapi: ["openapi/agent-host/agent-host.yaml", "f1aefb55285a12963a37e0cc008f90e7b081373d77623ce92127b06e1fbcdb31"],
  bundle_manifest_schema: ["jsonschema/skills/skill-bundle-manifest-v2.schema.json", "39a898111ba3dcae2f369fdcb571a2e892830d1d0a57c90ab6210a0ab897a649"],
  runtime_projection: ["compatibility/agent-host-runtime-v1.json", "5eadca026cdc8813cf529fa8e074de7532a2c78bebc5c89d9364180942869311"],
});
const PROVIDER_PINS = Object.freeze({
  agent_host: ["https://github.com/36Dge/yijie-agent-host.git", "1b7bfd1ce4323e52035b2ba1e62842c2d332d9ed"],
  skills: ["https://github.com/36Dge/yijie-skills.git", "10c45bec29603b002e861e1499d5b4e684251af5"],
});
const FIXTURE_TREE_PINS = new Map([
  ["tests/fixtures/agent/host-skills-v1", "ab2333f05fe5138fd7c32e6758ae4c6ed327c095"],
  ["tests/fixtures/skills/bundle-v2", "bbe9754ef64f99416e43b75fe2b60fc26d15f799"],
]);
const FIXTURE_SCHEMAS = new Map([
  ["enabled-request.json", "SkillEnabledRequest"],
  ["error-archive-unsafe.json", "SkillErrorResponse"],
  ["error-skill-not-installable.json", "SkillErrorResponse"],
  ["install-request.json", "SkillInstallRequest"],
  ["list-response.json", "SkillListResponse"],
  ["mutation-response.json", "SkillMutationResponse"],
  ["scan-request.json", "SkillScanRequest"],
  ["uninstall-request.json", "SkillUninstallRequest"],
]);
const OPERATIONS = new Map([
  ["get /v1/skills", ["listManagedSkills", "plugin.read"]],
  ["post /v1/skills/scan-operations", ["scanManagedSkills", "plugin.manage"]],
  ["post /v1/skills/{skill_id}/install-operations", ["installManagedSkill", "plugin.manage"]],
  ["put /v1/skills/{skill_id}/enabled", ["setManagedSkillEnabled", "plugin.manage"]],
  ["post /v1/skills/{skill_id}/uninstall-operations", ["uninstallManagedSkill", "plugin.manage"]],
]);
const IMPLEMENTATION_PATHS = Object.freeze([
  "src-tauri/src/skills/host.rs", "src-tauri/src/skills/mod.rs", "src-tauri/src/skills/catalog.rs",
  "src-tauri/src/skills/resources.rs", "src-tauri/src/local_profile.rs", "src-tauri/src/native_auth/runtime.rs",
  "src-tauri/src/chat/host_bridge.rs", "src-tauri/src/chat/host_domain.rs", "src-tauri/src/chat/sidecar.rs",
  "src-tauri/src/lib.rs",
]);
const EXPECTED_CATEGORIES = Object.freeze({
  "sourcing-selection": 5, "market-research": 9, "content-marketing": 7,
  "traffic-advertising": 9, "store-operations": 8,
});
const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export function safeRelativePath(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) throw new Error("contract path must be a non-empty relative path");
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error("contract path must stay inside its repository");
  }
  return normalized;
}

const isSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const normalizeRepository = (value) => value.trim().replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();

function samePinnedSources(sources) {
  return Object.entries(SOURCE_PINS).every(([name, [sourcePath, digest]]) =>
    sources?.[name]?.path === sourcePath && sources?.[name]?.sha256 === digest);
}

function sameFixtureTrees(entries) {
  return Array.isArray(entries) && entries.length === FIXTURE_TREE_PINS.size &&
    entries.every((entry) => FIXTURE_TREE_PINS.get(entry?.path) === entry?.git_tree_oid);
}

function sameOperations(entries) {
  return Array.isArray(entries) && entries.length === OPERATIONS.size && entries.every((entry) => {
    const expected = OPERATIONS.get(`${entry?.method} ${entry?.path}`);
    return expected?.[0] === entry?.operation_id && expected?.[1] === entry?.required_capability;
  });
}

function sameImplementationPaths(entries) {
  return Array.isArray(entries) && entries.length === IMPLEMENTATION_PATHS.length &&
    entries.every((entry, index) => entry?.path === IMPLEMENTATION_PATHS[index] && isSha256(entry?.sha256));
}

function calendarDate(value) {
  if (typeof value !== "string" || !ISO_CALENDAR_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateExceptionWindow(exception, currentDate = new Date().toISOString().slice(0, 10)) {
  if (!calendarDate(currentDate) || !calendarDate(exception?.expires_on)) throw new Error("Agent Host Skills adapter exception dates must be ISO calendar dates");
  if (currentDate > exception.expires_on) throw new Error(`Agent Host Skills adapter exception expired on ${exception.expires_on}`);
}

export function validateLock(lock) {
  if (!lock || lock.schema_version !== 2 || lock.contract_version !== PINNED_VERSION ||
      lock.repository !== PINNED_REPOSITORY || lock.full_commit !== PINNED_COMMIT || !samePinnedSources(lock.sources) ||
      lock.providers?.agent_host?.repository !== PROVIDER_PINS.agent_host[0] ||
      lock.providers?.agent_host?.full_commit !== PROVIDER_PINS.agent_host[1] ||
      lock.providers?.agent_host?.contracts_lock_path !== "api/contracts.lock" ||
      lock.providers?.agent_host?.skills_lock_path !== "api/skills.lock" ||
      lock.providers?.skills?.repository !== PROVIDER_PINS.skills[0] ||
      lock.providers?.skills?.full_commit !== PROVIDER_PINS.skills[1] || lock.providers?.skills?.version !== "0.3.0" ||
      lock.providers?.skills?.source_tree_sha256 !== "3247a14004c76170cf41a2d854e2ceffa1fd43de6e0ca8bb596f1d61d9be1029" ||
      lock.providers?.skills?.contracts_lock_path !== "contracts/lock.json" ||
      lock.providers?.skills?.local_manifest_sha256 !== "cc2b9be4d0e640e0888e97f6f7a09149a248386931786a7a089c8094304d94a5" ||
      lock.providers?.skills?.desktop_release_manifest_sha256 !== "9f8459077615514183fdd4c81ff3b6b2ef1ea735257b04c040399d4c91c1daa2" ||
      lock.providers?.skills?.archive_inventory_sha256 !== "0bfb2d66b484b281cc7e22667d611dda81c6ab862ece5b78da4e8301fc497715" ||
      !sameFixtureTrees(lock.fixture_trees) || !sameOperations(lock.operations) ||
      lock.bundle_fixture?.manifest_path !== "tests/fixtures/skills/bundle-v2/manifest-catalog-38.json" ||
      lock.bundle_fixture?.manifest_sha256 !== "407d0760e1d06ef3446955fba19b39da26d1f740b2f63b601edae903b1664c18" ||
      lock.bundle_fixture?.archive_path !== "tests/fixtures/skills/bundle-v2/packages/fixture-copywriting-0.1.0.zip" ||
      lock.bundle_fixture?.archive_sha256 !== "0be8fb3745a32207c6dedb46090044763d47aa64ccf0147653591cb1c9171032" ||
      lock.bundle_fixture?.skill_count !== 38 || lock.bundle_fixture?.category_counts !== "5/9/7/9/8" ||
      lock.bundle_fixture?.installable_count !== 1 || lock.bundle_fixture?.blocked_count !== 37 ||
      lock.bundle_fixture?.blocked_install_error !== "skill_not_installable" ||
      lock.parser?.package !== "@redocly/openapi-core" || lock.parser?.version !== "1.34.18" ||
      lock.parser?.api !== "parseYaml" || lock.parser?.provided_by !== "openapi-typescript@7.13.0" ||
      lock.validator?.package !== "ajv" || lock.validator?.version !== "8.17.1" ||
      lock.consumer?.owner !== "段成威" || lock.consumer?.mode !== "hand-written-rust-adapter" ||
      lock.consumer?.implementation_status !== "implemented" || !sameImplementationPaths(lock.consumer?.implementation_files) ||
      lock.consumer?.approved_rust_generator !== "N/A" || typeof lock.consumer?.generator_rationale !== "string" ||
      !lock.consumer.generator_rationale || lock.exception?.id !== "EXC-129-001" || lock.exception?.owner !== "段成威" ||
      lock.exception?.approved_on !== "2026-08-25" || lock.exception?.expires_on !== "2026-11-23" ||
      lock.exception?.status !== "active" || typeof lock.exception?.scope !== "string" || !lock.exception.scope ||
      typeof lock.exception?.removal_trigger !== "string" || !lock.exception.removal_trigger ||
      !Array.isArray(lock.fixtures) || lock.fixtures.length !== FIXTURE_SCHEMAS.size) {
    throw new Error("Agent Host Skills v1 / Manifest v2 contract lock is incomplete or invalid");
  }
  const names = new Set();
  for (const fixture of lock.fixtures) {
    safeRelativePath(fixture?.source_path);
    const name = path.basename(fixture.source_path);
    if (!FIXTURE_SCHEMAS.has(name) || fixture.schema !== FIXTURE_SCHEMAS.get(name) || names.has(name) || !isSha256(fixture.sha256)) {
      throw new Error("Agent Host Skills fixture pin is invalid");
    }
    names.add(name);
  }
  Object.values(lock.sources).forEach(({ path: sourcePath }) => safeRelativePath(sourcePath));
  lock.fixture_trees.forEach(({ path: sourcePath }) => safeRelativePath(sourcePath));
  lock.consumer.implementation_files.forEach(({ path: sourcePath }) => safeRelativePath(sourcePath));
  [lock.bundle_fixture.manifest_path, lock.bundle_fixture.archive_path,
    lock.providers.agent_host.contracts_lock_path, lock.providers.agent_host.skills_lock_path,
    lock.providers.skills.contracts_lock_path].forEach(safeRelativePath);
  validateExceptionWindow(lock.exception);
  return lock;
}

async function git(root, ...arguments_) { return (await exec("git", ["-C", root, ...arguments_])).stdout.trim(); }

async function verifyCheckout(root, repository, commit, label) {
  const [head, status, origin] = await Promise.all([
    git(root, "rev-parse", "HEAD"), git(root, "status", "--porcelain"),
    git(root, "remote", "get-url", "origin"),
  ]);
  if (head !== commit) throw new Error(`${label} HEAD is ${head}, expected ${commit}`);
  if (status) throw new Error(`${label} checkout is not clean`);
  if (normalizeRepository(origin) !== normalizeRepository(repository)) throw new Error(`${label} origin differs from its pin`);
}

export async function verifyContractsCheckout(lock, contractsRoot) {
  return verifyCheckout(contractsRoot, lock.repository, lock.full_commit, "contracts");
}

async function verifyBytes(root, relativePath, expectedDigest) {
  const target = path.join(root, safeRelativePath(relativePath));
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${relativePath} is not a regular file`);
  const bytes = await readFile(target);
  const actual = sha256(bytes);
  if (expectedDigest !== undefined && actual !== expectedDigest) {
    throw new Error(`${relativePath} digest is ${actual}, expected ${expectedDigest}`);
  }
  return bytes;
}

function parseKeyValue(bytes) {
  return Object.fromEntries(bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    if (index < 1) throw new Error("provider lock has an invalid line");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

async function verifyProviders(lock, agentHostRoot, skillsRoot) {
  await Promise.all([
    verifyCheckout(agentHostRoot, lock.providers.agent_host.repository, lock.providers.agent_host.full_commit, "Agent Host"),
    verifyCheckout(skillsRoot, lock.providers.skills.repository, lock.providers.skills.full_commit, "Skills"),
  ]);
  const [hostContractsBytes, hostSkillsBytes, producerBytes, packageBytes] = await Promise.all([
    verifyBytes(agentHostRoot, lock.providers.agent_host.contracts_lock_path),
    verifyBytes(agentHostRoot, lock.providers.agent_host.skills_lock_path),
    verifyBytes(skillsRoot, lock.providers.skills.contracts_lock_path),
    verifyBytes(skillsRoot, "package.json"),
  ]);
  const hostContracts = parseKeyValue(hostContractsBytes);
  const hostSkills = parseKeyValue(hostSkillsBytes);
  const producer = JSON.parse(producerBytes);
  const packageJson = JSON.parse(packageBytes);
  if (hostContracts.CONTRACTS_VERSION !== PINNED_VERSION || hostContracts.CONTRACTS_COMMIT !== PINNED_COMMIT ||
      hostContracts.OPENAPI_SHA256 !== SOURCE_PINS.openapi[1] || hostContracts.SKILL_BUNDLE_MANIFEST_V2_SCHEMA_SHA256 !== SOURCE_PINS.bundle_manifest_schema[1] ||
      hostContracts.RUNTIME_COMPATIBILITY_SHA256 !== SOURCE_PINS.runtime_projection[1] ||
      hostSkills.CONTRACTS_COMMIT !== PINNED_COMMIT || hostSkills.MANIFEST_V2_SHA256 !== SOURCE_PINS.bundle_manifest_schema[1] ||
      hostSkills.SKILLS_VERSION !== lock.providers.skills.version || hostSkills.SKILLS_COMMIT !== lock.providers.skills.full_commit ||
      hostSkills.SKILLS_SOURCE_TREE_SHA256 !== lock.providers.skills.source_tree_sha256 ||
      hostSkills.LOCAL_DEVELOPMENT_MANIFEST_SHA256 !== lock.providers.skills.local_manifest_sha256 ||
      hostSkills.DESKTOP_RELEASE_MANIFEST_SHA256 !== lock.providers.skills.desktop_release_manifest_sha256 ||
      hostSkills.ARCHIVE_INVENTORY_SHA256 !== lock.providers.skills.archive_inventory_sha256 || hostSkills.SKILL_COUNT !== "38" ||
      hostSkills.INSTALLABLE_COUNT !== "38" || hostSkills.BLOCKED_COUNT !== "0" || hostSkills.CATEGORY_COUNTS !== "5/9/7/9/8" ||
      producer.contracts_version !== PINNED_VERSION || producer.source_revision !== PINNED_COMMIT ||
      producer.artifacts?.skill_bundle_manifest_v2?.sha256 !== SOURCE_PINS.bundle_manifest_schema[1] ||
      packageJson.name !== "@yijie/skills" || packageJson.version !== lock.providers.skills.version) {
    throw new Error("Agent Host or Skills provider lock differs from the reviewed exact consumption chain");
  }
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
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dereferenceSchema(document, item, stack)]));
}

function ajv() {
  const validator = new Ajv2020({ allErrors: true, strict: false });
  validator.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  validator.addFormat("date-time", (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  validator.addFormat("uri", (value) => { try { return new URL(value).protocol.length > 1; } catch { return false; } });
  validator.addFormat("int32", { type: "number", validate: Number.isInteger });
  return validator;
}

function compileSchema(document, name) {
  const schema = document.components?.schemas?.[name];
  if (!schema) throw new Error(`missing schema ${name}`);
  return ajv().compile(dereferenceSchema(document, schema, [name]));
}

function referencedResponse(document, operation, status) {
  const response = operation.responses?.[status];
  if (!response?.$ref) return response;
  const prefix = "#/components/responses/";
  if (!response.$ref.startsWith(prefix)) throw new Error(`unsupported response reference ${response.$ref}`);
  return document.components?.responses?.[response.$ref.slice(prefix.length)];
}

export function validateOpenApi(document, lock) {
  if (document.info?.version !== PINNED_VERSION || JSON.stringify(document.security) !== JSON.stringify([{ localBearer: [] }]) ||
      document.components?.securitySchemes?.localBearer?.scheme !== "bearer") throw new Error("Agent Host owner-only security projection drifted");
  for (const expected of lock.operations) {
    const operation = document.paths?.[expected.path]?.[expected.method];
    if (operation?.operationId !== expected.operation_id || operation?.["x-yijie-required-capability"] !== expected.required_capability) {
      throw new Error(`${expected.operation_id} operation or capability drifted`);
    }
    for (const status of Object.keys(operation.responses ?? {})) {
      if (referencedResponse(document, operation, status)?.headers?.["Cache-Control"]?.$ref !== "#/components/headers/NoStore") {
        throw new Error(`${expected.operation_id} ${status} does not require no-store`);
      }
    }
  }
  const install = document.paths?.["/v1/skills/{skill_id}/install-operations"]?.post;
  const installSchema = document.components?.schemas?.SkillInstallRequest;
  if (install?.requestBody?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/SkillInstallRequest" ||
      JSON.stringify(installSchema?.required) !== JSON.stringify(["operation_id", "expected_version", "expected_archive_sha256", "catalog_revision"]) ||
      /(?:destination_|source_)?path|skill_content|instructions|token/i.test(JSON.stringify(installSchema)) ||
      !JSON.stringify(install).includes("skill_not_installable")) throw new Error("Skill install API lost its pathless or blocked-entry semantics");
}

export function validateRuntimeProjection(projection) {
  const methods = new Set(projection?.host_projection?.runtime_methods ?? []);
  const notifications = new Set(projection?.host_projection?.runtime_notifications ?? []);
  if (projection?.contracts_version !== PINNED_VERSION || projection?.runtime?.repository_commit !== "0ce5902ed400866be0196886bb78f693a004d68d" ||
      projection?.runtime?.upstream_tag !== "rust-v0.144.6" || projection?.host_projection?.authentication !== "owner-only-bearer" ||
      !["skills/config/write", "skills/extraRoots/set", "skills/list"].every((method) => methods.has(method)) ||
      !notifications.has("skills/changed")) throw new Error("Runtime Skills projection drifted");
}

async function verifyFixtures(document, lock, contractsRoot) {
  for (const fixture of lock.fixtures) {
    const source = await verifyBytes(contractsRoot, fixture.source_path, fixture.sha256);
    const validate = compileSchema(document, fixture.schema);
    const value = JSON.parse(source.toString("utf8"));
    if (!validate(value)) throw new Error(`${path.basename(fixture.source_path)} is invalid: ${JSON.stringify(validate.errors)}`);
    if (fixture.source_path.endsWith("error-skill-not-installable.json") && value.error?.code !== "skill_not_installable") {
      throw new Error("synthetic blocked fixture lost skill_not_installable");
    }
  }
}

async function verifyFixtureTrees(lock, contractsRoot) {
  for (const fixture of lock.fixture_trees) {
    const actual = await git(contractsRoot, "rev-parse", `${lock.full_commit}:${fixture.path}`);
    if (actual !== fixture.git_tree_oid) throw new Error(`${fixture.path} tree differs from its pin`);
  }
}

export function validateBundleFixture(manifest, lock) {
  const counts = Object.fromEntries(Object.keys(EXPECTED_CATEGORIES).map((category) => [category, 0]));
  let installable = 0;
  let blocked = 0;
  if (manifest?.schema_version !== 2 || !Array.isArray(manifest.skills) || manifest.skills.length !== 38) {
    throw new Error("Manifest v2 synthetic catalog must contain exactly 38 entries");
  }
  for (const skill of manifest.skills) {
    if (!(skill.category in counts)) throw new Error(`unexpected Skill category ${skill.category}`);
    counts[skill.category] += 1;
    if (skill.release?.catalog_status === "installable") {
      installable += 1;
      if (skill.catalog_entry_mode !== "bundled" || !skill.archive) throw new Error("installable fixture entry requires an archive");
    } else if (skill.release?.catalog_status === "blocked") {
      blocked += 1;
      if (skill.catalog_entry_mode !== "catalog-only" || skill.archive) throw new Error("blocked fixture entry must remain catalog-only");
    } else throw new Error("fixture entry has an unsupported catalog status");
  }
  if (JSON.stringify(counts) !== JSON.stringify(EXPECTED_CATEGORIES) || installable !== lock.bundle_fixture.installable_count ||
      blocked !== lock.bundle_fixture.blocked_count) throw new Error("Manifest v2 fixture counts differ from 5/9/7/9/8 and 1/37");
}

async function verifyBundleFixture(lock, contractsRoot, schemaBytes) {
  const [manifestBytes] = await Promise.all([
    verifyBytes(contractsRoot, lock.bundle_fixture.manifest_path, lock.bundle_fixture.manifest_sha256),
    verifyBytes(contractsRoot, lock.bundle_fixture.archive_path, lock.bundle_fixture.archive_sha256),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const validate = ajv().compile(JSON.parse(schemaBytes.toString("utf8")));
  if (!validate(manifest)) throw new Error(`Manifest v2 fixture is invalid: ${JSON.stringify(validate.errors)}`);
  validateBundleFixture(manifest, lock);
}

export async function verifyImplementationPins(lock) {
  for (const implementation of lock.consumer.implementation_files) await verifyBytes(repositoryRoot, implementation.path, implementation.sha256);
}

export async function checkAgentHostSkillsContract({ requireImplementation = true } = {}) {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  const contractsRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts");
  const agentHostRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host");
  const skillsRoot = path.resolve(repositoryRoot, process.env.YIJIE_DESKTOP_SKILLS_DIR ?? "../yijie-skills");
  await Promise.all([verifyContractsCheckout(lock, contractsRoot), verifyProviders(lock, agentHostRoot, skillsRoot)]);
  const [openApiBytes, runtimeBytes, manifestSchemaBytes, parseYaml] = await Promise.all([
    verifyBytes(contractsRoot, lock.sources.openapi.path, lock.sources.openapi.sha256),
    verifyBytes(contractsRoot, lock.sources.runtime_projection.path, lock.sources.runtime_projection.sha256),
    verifyBytes(contractsRoot, lock.sources.bundle_manifest_schema.path, lock.sources.bundle_manifest_schema.sha256),
    loadPinnedOpenApiParser(lock), verifyFixtureTrees(lock, contractsRoot),
  ]);
  const document = parseYaml(openApiBytes.toString("utf8"));
  validateOpenApi(document, lock);
  validateRuntimeProjection(JSON.parse(runtimeBytes));
  await Promise.all([verifyFixtures(document, lock, contractsRoot), verifyBundleFixture(lock, contractsRoot, manifestSchemaBytes)]);
  if (requireImplementation) await verifyImplementationPins(lock);
  process.stdout.write(`Agent Host Skills v1 API, Manifest v2, Runtime projection and exact providers verified at ${lock.full_commit}` +
    `${requireImplementation ? "; native consumer pins are complete" : "; native consumer pins were not checked"}.\n`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkAgentHostSkillsContract().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Skills contract check failed"}\n`);
    process.exitCode = 1;
  });
}
