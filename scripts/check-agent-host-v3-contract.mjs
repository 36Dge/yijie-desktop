import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { loadPinnedOpenApiParser } from "./check-agent-host-contract.mjs";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repositoryRoot, "contracts/agent-host-v3-artifacts.lock.json");
const PINNED_REPOSITORY = "https://github.com/36Dge/yijie-contracts.git";
const PINNED_COMMIT = "ea48fe190e18afba728712d1e2cc79cda57f581b";
const PINNED_VERSION = "0.4.0-candidate";
const SOURCE_PINS = Object.freeze({
  openapi: [
    "openapi/agent-host/agent-host.yaml",
    "cf72ba8dd6910e8454ad60feeffa5e82583303b441dad78e49910fbdb9f5420f",
  ],
  event_schema: [
    "jsonschema/agent/session-event-v3.schema.json",
    "87b1284056529bde8314e6cfa6ad1fb27ffefef50ea86033875fda795330939f",
  ],
  report_schema: [
    "jsonschema/report/report-document-v1.schema.json",
    "94715e5b821cca686405d06004b805e9eac6d39dc61e19c9fc38925102f79556",
  ],
  protobuf: [
    "protobuf/yijie/events/v3/agent_session.proto",
    "5021a0342b84cdea0e1dd773728e4c8f013ce7d03377ade18f06f6716a81b70d",
  ],
});
const FIXTURE_TREE_PINS = new Map([
  ["tests/fixtures/agent/session-event-v3", "21de31ceb65900bcf38bc7fe171de8238dfa30dc"],
  ["tests/fixtures/agent/resources-v3", "f447129c08b9b39231e33698afc3f2fd875d6b14"],
  ["tests/fixtures/agent/host-v3", "8afbe7e88cc89401d9990e08b4b332096b53934e"],
  ["tests/fixtures/report/report-document-v1", "3fafff6d702504f7a8a1cd44b4c717f024c88ae8"],
]);
const IMPLEMENTATION_PINS = new Map([
  ["src-tauri/src/chat/artifact.rs", ["wire_and_storage_adapter", "a8c3128bbc647fb99db516f60627952d0d5cb4d2923fa12ff4756f5ebd6de285"]],
  ["src-tauri/src/chat/host_bridge.rs", ["host_resource_transport", "e6fcdf3a823122e3c42c27b758d7a7454bf66f3fef0511a4ed3bd756d10652c2"]],
  ["src-tauri/src/chat/database.rs", ["database_lifecycle", "f68222c9251e44bc72ef0c044e4d4d31bc47bc6903fc95155b0438c22e3f59b6"]],
  ["src-tauri/src/chat/worker.rs", ["database_worker", "7cf74c094e735ff26fd17c4252dc693224cd237ba9ada5809bd12aa66b4128c0"]],
  ["src-tauri/src/chat/ipc.rs", ["private_ipc_adapter", "d3c0da508abb8f20118bf089f74211e33f922af223006e7111b69cf81282786a"]],
  ["src-tauri/src/chat/application.rs", ["interrupt_lifecycle", "d3290063de27db9c9da967d5eb26506a5ddd551ead67cc68611513d95838803d"]],
  ["src-tauri/src/chat/mod.rs", ["runtime_gate", "134d878b2955e9ca3f0ad0afebdf2d8a550737288e35bed0c125556465d03e20"]],
  ["src-tauri/migrations/chat/0008_chat_output_artifacts.sql", ["sqlcipher_schema_v8", "bec50a16583b216380f5f19728342772ff211ca2ebb88c0ff83b2e44d3fa9a15"]],
  ["src-tauri/schemas/chat-ipc-v3.schema.json", ["private_ipc_v3_schema", "ac61e2f1377e8a5ea44fd8611b05bdbb39e5188f42c142342d7de8401375f3f2"]],
  ["src/domain/chat-ipc.ts", ["typescript_private_ipc_adapter", "2fbec6e363ab75733efdfde538392423248a4c23d4460e7669f9e666fa51ac64"]],
]);
const CONFORMANCE_TESTS = Object.freeze([
  "chat::artifact::tests::v3_wire_adapter_is_closed_scope_bound_and_never_accepts_provider_drift",
  "chat::artifact::tests::report_adapter_accepts_unknown_optional_and_rejects_required_or_markup",
  "chat::artifact::tests::sqlcipher_commit_ack_reopen_expiry_receipt_and_delete_are_atomic",
  "chat::host_bridge::tests::artifact_download_and_post_commit_ack_use_exact_owner_only_v3_resources",
  "chat::ipc::tests::private_v3_schema_is_metadata_only_and_version_negotiated",
]);

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

function sameEntries(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.size &&
    actual.every((entry) => expected.get(entry?.path) === entry?.git_tree_oid)
  );
}

function sameImplementationFiles(actual) {
  return (
    Array.isArray(actual) &&
    actual.length === IMPLEMENTATION_PINS.size &&
    actual.every((entry) => {
      const expected = IMPLEMENTATION_PINS.get(entry?.path);
      return expected?.[0] === entry?.role && expected?.[1] === entry?.sha256;
    })
  );
}

function sameStrings(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

export function validateLock(lock) {
  if (
    !lock ||
    lock.schema_version !== 1 ||
    lock.contract_version !== PINNED_VERSION ||
    lock.repository !== PINNED_REPOSITORY ||
    lock.full_commit !== PINNED_COMMIT ||
    Object.entries(SOURCE_PINS).some(([name, [sourcePath, digest]]) =>
      lock.sources?.[name]?.path !== sourcePath || lock.sources?.[name]?.sha256 !== digest
    ) ||
    !sameEntries(lock.fixture_trees, FIXTURE_TREE_PINS) ||
    lock.parser?.package !== "@redocly/openapi-core" ||
    lock.parser?.version !== "1.34.18" ||
    lock.parser?.api !== "parseYaml" ||
    lock.parser?.provided_by !== "openapi-typescript@7.13.0" ||
    lock.validator?.package !== "ajv" ||
    lock.validator?.version !== "8.17.1" ||
    lock.consumer?.owner !== "段成威" ||
    lock.consumer?.mode !== "hand-written-rust-adapter" ||
    lock.consumer?.adapter_status !== "implemented" ||
    !sameImplementationFiles(lock.consumer?.implementation_files) ||
    !sameStrings(lock.consumer?.conformance_tests, CONFORMANCE_TESTS) ||
    lock.consumer?.approved_rust_generator !== "N/A" ||
    typeof lock.consumer?.generator_rationale !== "string" ||
    lock.consumer.generator_rationale.length === 0 ||
    lock.exception?.id !== "EXC-128-001" ||
    lock.exception?.owner !== "段成威" ||
    lock.exception?.approved_on !== "2026-08-20" ||
    lock.exception?.expires_on !== "2026-11-20" ||
    lock.exception?.status !== "active" ||
    typeof lock.exception?.removal_trigger !== "string" ||
    lock.exception.removal_trigger.length === 0
  ) {
    throw new Error("Agent Host v3 Artifact contract lock is incomplete or invalid");
  }
  for (const { path: entryPath } of Object.values(lock.sources)) safeRelativePath(entryPath);
  for (const { path: entryPath } of lock.fixture_trees) safeRelativePath(entryPath);
  for (const { path: entryPath } of lock.consumer.implementation_files) safeRelativePath(entryPath);
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

async function verifySource(contractsRoot, source) {
  const bytes = await readFile(path.join(contractsRoot, safeRelativePath(source.path)));
  if (sha256(bytes) !== source.sha256) throw new Error(`${source.path} digest differs from its pin`);
  return bytes;
}

function compileSchema(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: { uuid: true, "date-time": true },
  });
  return ajv.compile(schema);
}

function validateOpenApi(document) {
  const events = document.paths?.["/v3/agent-sessions/{agent_session_id}/events"]?.get;
  if (
    events?.operationId !== "streamAgentSessionEventsV3" ||
    !events.parameters?.some(({ $ref }) => $ref === "#/components/parameters/EventAfter") ||
    document.components?.parameters?.EventAfter?.name !== "after" ||
    document.components?.parameters?.after_sequence !== undefined
  ) {
    throw new Error("v3 event negotiation/cursor contract drifted");
  }
  for (const suffix of ["content", "poster"]) {
    const resource = document.paths?.[
      `/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/${suffix}`
    ];
    if (!resource?.get || !resource?.head) throw new Error(`${suffix} GET/HEAD contract is missing`);
  }
  const ack = document.paths?.["/v3/agent-sessions/{agent_session_id}/artifacts/{artifact_id}/ack"]?.post;
  if (ack?.operationId !== "acknowledgeAgentArtifactV3" || !/idempotent/i.test(ack.description ?? "")) {
    throw new Error("v3 Artifact ACK contract drifted");
  }
}

async function validateEventFixtures(contractsRoot, validateEvent) {
  const root = path.join(contractsRoot, "tests/fixtures/agent/session-event-v3");
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  if (names.length !== 16) throw new Error(`expected 16 v3 event fixtures, found ${names.length}`);
  for (const name of names) {
    const fixture = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (!validateEvent(fixture)) {
      throw new Error(`${name} does not validate: ${JSON.stringify(validateEvent.errors)}`);
    }
    if (fixture.payload?.provenance !== "synthetic") {
      throw new Error(`${name} is not an exact-local synthetic fixture`);
    }
  }
}

async function validateReportFixtures(contractsRoot, validateReport) {
  const root = path.join(contractsRoot, "tests/fixtures/report/report-document-v1");
  for (const name of ["known-valid.json", "unknown-optional-valid.json"]) {
    const fixture = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (!validateReport(fixture)) throw new Error(`${name} does not validate`);
  }
  for (const name of ["unknown-required-invalid.json", "injection-invalid.json"]) {
    const fixture = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (validateReport(fixture)) throw new Error(`${name} unexpectedly validates`);
  }
}

async function validateFixtureTrees(lock, contractsRoot) {
  for (const fixture of lock.fixture_trees) {
    const actual = await git(contractsRoot, "rev-parse", `${lock.full_commit}:${fixture.path}`);
    if (actual !== fixture.git_tree_oid) throw new Error(`${fixture.path} tree differs from its pin`);
  }
}

async function verifyImplementationPins(lock) {
  for (const implementation of lock.consumer.implementation_files) {
    const bytes = await readFile(path.join(repositoryRoot, safeRelativePath(implementation.path)));
    if (sha256(bytes) !== implementation.sha256) {
      throw new Error(`${implementation.path} digest differs from its implementation pin`);
    }
  }
}

export async function checkAgentHostV3Contract() {
  const lock = validateLock(JSON.parse(await readFile(lockPath, "utf8")));
  const contractsRoot = path.resolve(
    repositoryRoot,
    process.env.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts",
  );
  await verifyContractsCheckout(lock, contractsRoot);
  const [openApiBytes, eventBytes, reportBytes, protoBytes, parseYaml] = await Promise.all([
    verifySource(contractsRoot, lock.sources.openapi),
    verifySource(contractsRoot, lock.sources.event_schema),
    verifySource(contractsRoot, lock.sources.report_schema),
    verifySource(contractsRoot, lock.sources.protobuf),
    loadPinnedOpenApiParser(lock),
    validateFixtureTrees(lock, contractsRoot),
    verifyImplementationPins(lock),
  ]);
  validateOpenApi(parseYaml(openApiBytes.toString("utf8")));
  const validateEvent = compileSchema(JSON.parse(eventBytes));
  const validateReport = compileSchema(JSON.parse(reportBytes));
  await Promise.all([
    validateEventFixtures(contractsRoot, validateEvent),
    validateReportFixtures(contractsRoot, validateReport),
  ]);
  for (const symbol of [
    "AGENT_EVENT_TYPE_ITEM_ARTIFACT_STARTED",
    "AGENT_EVENT_TYPE_ITEM_ARTIFACT_PROGRESS",
    "AGENT_EVENT_TYPE_ITEM_ARTIFACT_COMPLETED",
    "AGENT_EVENT_TYPE_ITEM_ARTIFACT_FAILED",
  ]) {
    if (!protoBytes.includes(Buffer.from(symbol))) throw new Error(`v3 Protobuf is missing ${symbol}`);
  }
  process.stdout.write(
    `Agent Host v3 Artifact contract and ${lock.consumer.implementation_files.length} Desktop ` +
      `implementation pins verified at ${lock.full_commit}; adapter is ${lock.consumer.adapter_status}.\n`,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  checkAgentHostV3Contract().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "v3 contract check failed"}\n`);
    process.exitCode = 1;
  });
}
