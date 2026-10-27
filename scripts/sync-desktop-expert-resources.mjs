// Explicit local candidate only. Reuse the existing atomic managed-bundle copy
// and archive inventory checks; do not replace the immutable ordinary v2 slot.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { installOutput, readRegularFile, safeRelativePath, sha256, verifyBundleFiles, verifyOutput, validateResourceLock } from "./sync-desktop-skill-resources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const outputRoot = path.join(root, ".local/skill-packages-experts");
const producerOutput = "dist/skills-experts-thirteen-overall-v013";
const inventory = items => `${items.map(item => `${safeRelativePath(item.archive.path)} ${item.archive.sha256}`).sort().join("\n")}\n`;

export function verifyRetainedExpertResources(manifest, baselineBytes) {
  assert.equal(sha256(baselineBytes), "9d41fa9835616a0bb9b4e72b2656a8fdff0fa631faca32ca0c7a97de94a29970", "Retained 73-resource baseline changed");
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.skills.length, 73);
  for (const previous of baseline.skills) {
    const matches = manifest.skills.filter(item => item.id === previous.id && item.version === previous.version);
    assert.equal(matches.length, 1, "Every prior resource version must be retained exactly once");
    assert.deepEqual(matches[0], previous, `Existing resource metadata/archive changed: ${previous.id}@${previous.version}`);
  }
}

async function verifyExpertSource({ contractsRoot, pin, sourceLockBytes }) {
  assert.equal(pin.schema_version, 1); assert.equal(pin.feature, "FEAT-158"); assert.equal(pin.release, false);
  assert.equal(pin.source.repository, "https://github.com/36Dge/yijie-skills.git");
  assert.ok(["git-commit", "working-tree"].includes(pin.source.revision_kind));
  assert.equal(sha256(sourceLockBytes), pin.contracts_source_lock_sha256, "Contracts candidate pin changed");
  const sourceLock = JSON.parse(sourceLockBytes);
  assert.equal(sourceLock.release, false);
  const schemas = {};
  for (const version of [2, 3]) {
    const schemaPath = `jsonschema/skills/skill-bundle-manifest-v${version}.schema.json`;
    const bytes = await readRegularFile(path.join(contractsRoot, schemaPath), 2 * 1024 * 1024);
    assert.equal(sha256(bytes), sourceLock.sources.find(item => item.path === schemaPath)?.sha256, "Bundle schema differs from source lock");
    schemas[version] = JSON.parse(bytes);
  }
  return schemas;
}

async function verifyExpertBundle({ skillsRoot, contractsRoot, pin, sourceLockBytes, bundleDirectory = producerOutput, pinnedCandidateBytes }) {
  const schemas = await verifyExpertSource({ contractsRoot, pin, sourceLockBytes });
  const bundleManifestPath = `${safeRelativePath(bundleDirectory)}/bundle-manifest.json`;
  const bytes = await readRegularFile(path.join(skillsRoot, bundleManifestPath), 2 * 1024 * 1024);
  const authorityBytes = await readRegularFile(path.join(skillsRoot, bundleDirectory, "authority.json"), 256 * 1024);
  assert.equal(sha256(bytes), pin.manifest_sha256, "Expert manifest differs from Native pin");
  assert.equal(sha256(authorityBytes), pin.authority_sha256, "Expert authority differs from Native pin");
  const manifest = JSON.parse(bytes), authority = JSON.parse(authorityBytes);
  verifyRetainedExpertResources(manifest, await readRegularFile(path.join(skillsRoot, "docs/provenance/FEAT-158-retained-resources-v0.24.0.json"), 256 * 1024));
  assert.equal(manifest.schema_version, 3); assert.equal(manifest.distribution_channel, "local-development");
  assert.equal(manifest.bundle_version, pin.bundle_version); assert.deepEqual(manifest.source, pin.source);
  assert.equal(authority.release, false); assert.equal(authority.manifest_sha256, pin.manifest_sha256);
  assert.deepEqual(authority.source, pin.source);
  assert.equal(authority.contracts_candidate.path, "contracts/experts.candidate.json");
  for (const item of [authority.source_definition, authority.contracts_candidate]) {
    const evidence = pinnedCandidateBytes && item === authority.contracts_candidate
      ? pinnedCandidateBytes
      : await readRegularFile(path.join(skillsRoot, safeRelativePath(item.path)), 2 * 1024 * 1024);
    assert.equal(sha256(evidence), item.sha256, "Expert source evidence changed");
  }
  for (const expert of authority.experts) {
    assert.equal(expert.local_use_authorization.status, "local-use-authorized");
    for (const item of [{ path: expert.local_use_authorization.evidence_reference, sha256: expert.local_use_authorization.evidence_sha256 }, expert.content_review]) {
      assert.equal(sha256(await readRegularFile(path.join(skillsRoot, safeRelativePath(item.path)), 2 * 1024 * 1024)), item.sha256, "Local expert authorization/review evidence changed");
    }
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("uri", value => { try { return new URL(value).protocol.length > 1; } catch { return false; } });
  ajv.addFormat("date-time", value => !Number.isNaN(Date.parse(value)));
  ajv.addSchema(schemas[2]);
  assert.ok(ajv.compile(schemas[3])(manifest), "Expert bundle violates its versioned schema");
  const ordinary = manifest.skills.filter(item => item.asset_kind !== "expert_resources");
  const experts = manifest.skills.filter(item => item.asset_kind === "expert_resources");
  const oldLock = validateResourceLock(JSON.parse(await readRegularFile(path.join(root, "contracts/desktop-skill-bundle-local.lock.json"), 256 * 1024)));
  assert.equal(ordinary.length, 38);
  assert.ok(experts.length >= 1 && experts.length <= 64, "Expert catalog must stay within the Native catalog bound");
  assert.equal(manifest.skills.length, ordinary.length + experts.length);
  assert.equal(sha256(inventory(ordinary)), oldLock.catalog.archive_inventory_sha256, "Ordinary Skill archive inventory must remain unchanged");
  assert.deepEqual(experts.map(item => item.expert.expert_id).sort(), authority.experts.map(item => item.expert_id).sort(), "Every expert must have matching reviewed source authority");
  const retainedExpert = experts.find(item => item.expert.expert_id === "jd-ops-expert");
  assert.equal(retainedExpert?.version, "0.1.3", "Retain the original expert version for existing conversations");
  const bundle = await verifyBundleFiles(skillsRoot, manifest, { manifest_path: bundleManifestPath }, { catalog: { archive_inventory_sha256: sha256(inventory(manifest.skills)) } });
  const files = [{ relativePath: "bundle-manifest.json", bytes }, { relativePath: "authority.json", bytes: authorityBytes }, ...bundle.files];
  return { manifest, authority, files, ordinary: ordinary.length, experts: experts.length };
}

// A provenance refresh can record a newer producer revision and Contracts
// evidence. It cannot authorize even a metadata-only resource change.
export function verifyExpertProvenanceOnly(previous, next) {
  assert.deepEqual(next.manifest.source.repository, previous.manifest.source.repository);
  assert.equal(next.manifest.source.tree_sha256, previous.manifest.source.tree_sha256, "Expert content tree changed");
  assert.deepEqual({ ...next.manifest, source: previous.manifest.source }, previous.manifest, "Expert bundle metadata or resources changed");
  assert.deepEqual(next.authority.contracts_candidate.path, previous.authority.contracts_candidate.path);
  assert.deepEqual({ ...next.authority, source: previous.authority.source,
    manifest_sha256: previous.authority.manifest_sha256,
    contracts_candidate: previous.authority.contracts_candidate }, previous.authority, "Expert content authorization or review changed");
  const archives = bundle => bundle.files.filter(file => file.relativePath !== "bundle-manifest.json" && file.relativePath !== "authority.json");
  const oldArchives = archives(previous), newArchives = archives(next);
  assert.deepEqual(newArchives.map(file => file.relativePath), oldArchives.map(file => file.relativePath), "Expert archive set changed");
  for (let i = 0; i < oldArchives.length; i++) {
    assert.ok(oldArchives[i].bytes.equals(newArchives[i].bytes), `Expert archive bytes changed: ${oldArchives[i].relativePath}`);
  }
}

async function replacePin(filePath, bytes) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function refreshExpertProvenance({ skillsRoot, contractsRoot, pinPath, pinBytes, pin, sourceLockBytes, previousSourceLock, previousSkillsCandidate }) {
  // Authenticate Git evidence or an explicitly retained previous local snapshot
  // against the existing pin/authority. New worktree hashes cannot self-authorize.
  const [oldLock, oldCandidate] = previousSourceLock
    ? await Promise.all([previousSourceLock, previousSkillsCandidate].map(async file => ({ stdout: await readRegularFile(path.resolve(file), 2 * 1024 * 1024) })))
    : await Promise.all([
    exec("git", ["show", "HEAD:compatibility/experts/source.lock.json"], { cwd: contractsRoot, encoding: "buffer", maxBuffer: 2 * 1024 * 1024 }),
    exec("git", ["show", "HEAD:contracts/experts.candidate.json"], { cwd: skillsRoot, encoding: "buffer", maxBuffer: 2 * 1024 * 1024 }),
  ]);
  const previous = await verifyExpertBundle({ skillsRoot, contractsRoot, pin, sourceLockBytes: oldLock.stdout, pinnedCandidateBytes: oldCandidate.stdout });
  await verifyOutput(outputRoot, previous.files);
  await exec(process.execPath, ["scripts/sync-experts.mjs", "--consumer=skills", "--check"], { cwd: contractsRoot, maxBuffer: 4 * 1024 * 1024 });
  const currentCandidateBytes = await readRegularFile(path.join(skillsRoot, "contracts/experts.candidate.json"), 2 * 1024 * 1024);
  assert.deepEqual(JSON.parse(sourceLockBytes).generated, JSON.parse(oldLock.stdout).generated, "Expert generated contracts changed; content-only provenance refresh is not applicable");
  assert.deepEqual(JSON.parse(currentCandidateBytes).consumer_generated, JSON.parse(oldCandidate.stdout).consumer_generated, "Expert consumer schemas changed");

  const stagedRoot = await mkdtemp(path.join(skillsRoot, "dist/.expert-provenance-"));
  const stagedDirectory = path.relative(skillsRoot, stagedRoot).split(path.sep).join("/");
  let promoted = false;
  try {
    await exec(process.execPath, ["scripts/package-desktop-skills.mjs", "--source", "plugins/yijie-desktop-skills/experts/bundle-source.json", "--output", stagedDirectory], { cwd: skillsRoot, maxBuffer: 4 * 1024 * 1024 });
    const nextManifestBytes = await readRegularFile(path.join(stagedRoot, "bundle-manifest.json"), 2 * 1024 * 1024);
    const nextAuthorityBytes = await readRegularFile(path.join(stagedRoot, "authority.json"), 256 * 1024);
    const nextPin = { ...pin, manifest_sha256: sha256(nextManifestBytes), source: JSON.parse(nextManifestBytes).source,
      authority_sha256: sha256(nextAuthorityBytes), contracts_source_lock_sha256: sha256(sourceLockBytes) };
    const next = await verifyExpertBundle({ skillsRoot, contractsRoot, pin: nextPin, sourceLockBytes, bundleDirectory: stagedDirectory });
    verifyExpertProvenanceOnly(previous, next);
    assert.ok((await readRegularFile(pinPath, 64 * 1024)).equals(pinBytes), "Expert pin changed during refresh");
    assert.ok((await readRegularFile(path.join(contractsRoot, "compatibility/experts/source.lock.json"), 1024 * 1024)).equals(sourceLockBytes), "Contracts source changed during refresh");
    assert.ok((await readRegularFile(path.join(skillsRoot, "contracts/experts.candidate.json"), 2 * 1024 * 1024)).equals(currentCandidateBytes), "Skills candidate changed during refresh");
    await verifyOutput(path.join(skillsRoot, producerOutput), previous.files);
    await verifyOutput(outputRoot, previous.files);
    promoted = true;
    await installOutput(path.join(skillsRoot, producerOutput), next.files);
    await installOutput(outputRoot, next.files);
    await replacePin(pinPath, Buffer.from(`${JSON.stringify(nextPin, null, 2)}\n`));
    const verified = await verifyExpertBundle({ skillsRoot, contractsRoot, pin: nextPin, sourceLockBytes });
    await verifyOutput(outputRoot, verified.files);
    return nextPin;
  } catch (error) {
    if (promoted) {
      const recovery = await Promise.allSettled([
        installOutput(path.join(skillsRoot, producerOutput), previous.files),
        installOutput(outputRoot, previous.files),
        replacePin(pinPath, pinBytes),
      ]);
      const failures = recovery.filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError([error, ...failures.map(result => result.reason)], "Expert provenance refresh failed; original resource recovery is incomplete", { cause: error });
    }
    throw error;
  } finally {
    await rm(stagedRoot, { recursive: true, force: true });
  }
}

function hostAuthoritySource(pin, pinBytes) {
  assert.match(pin.manifest_sha256, /^[0-9a-f]{64}$/);
  return Buffer.from(`// Code generated by yijie-desktop/scripts/sync-desktop-expert-resources.mjs --sync-host-authority; DO NOT EDIT.

package skills

// ReviewedExpertCatalogDigest binds the Host to the fully verified local candidate.
// Desktop pin SHA-256: ${sha256(pinBytes)}
// Skills authority SHA-256: ${pin.authority_sha256}
// Contracts source lock SHA-256: ${pin.contracts_source_lock_sha256}
// This source projection is local-only and is not release provenance.
const ReviewedExpertCatalogDigest = "${pin.manifest_sha256}"
`);
}

export async function syncDesktopExpertResources({ check = false, packageProducer = false, refreshProvenance = false, syncHostAuthority = false, previousSourceLock, previousSkillsCandidate, environment = process.env } = {}) {
  assert.ok(environment.YIJIE_ENV === "local" && environment.YIJIE_LOCAL_PROFILE === "demo_fast", "Expert assets are restricted to explicit local/demo_fast candidates");
  assert.ok(!refreshProvenance || (!check && !packageProducer), "Provenance refresh cannot be combined with check or package");
  assert.ok(!check || !packageProducer, "A check never rebuilds producer assets");
  assert.ok(!syncHostAuthority || (!check && !packageProducer && !refreshProvenance), "Host authority sync must be explicit and cannot be combined with other modes");
  assert.ok((previousSourceLock === undefined && previousSkillsCandidate === undefined) || (refreshProvenance && typeof previousSourceLock === "string" && previousSourceLock.length > 0 && typeof previousSkillsCandidate === "string" && previousSkillsCandidate.length > 0), "Previous evidence requires an explicit pair and provenance refresh");
  const skillsRoot = path.resolve(root, environment.YIJIE_DESKTOP_SKILLS_DIR ?? "../yijie-skills");
  const contractsRoot = path.resolve(root, environment.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts");
  const hostRoot = path.resolve(root, environment.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host");
  const pinPath = path.join(root, "contracts/experts-assets.candidate.json");
  const pinBytes = await readRegularFile(pinPath, 64 * 1024);
  let pin = JSON.parse(pinBytes);
  const sourceLockBytes = await readRegularFile(path.join(contractsRoot, "compatibility/experts/source.lock.json"), 1024 * 1024);
  if (refreshProvenance) pin = await refreshExpertProvenance({ skillsRoot, contractsRoot, pinPath, pinBytes, pin, sourceLockBytes, previousSourceLock, previousSkillsCandidate });
  if (packageProducer) {
    await verifyExpertSource({ contractsRoot, pin, sourceLockBytes });
    await exec(process.execPath, ["scripts/package-desktop-skills.mjs", "--source", "plugins/yijie-desktop-skills/experts/bundle-source.json", "--output", producerOutput], { cwd: skillsRoot, maxBuffer: 4 * 1024 * 1024 });
  }
  const { files, ordinary, experts } = await verifyExpertBundle({ skillsRoot, contractsRoot, pin, sourceLockBytes });
  if (check || refreshProvenance || syncHostAuthority) await verifyOutput(outputRoot, files); else await installOutput(outputRoot, files);
  // A provenance refresh updates only its original producer/resource transaction.
  // The separate explicit source sync is required before check/freeze/build pass.
  if (!refreshProvenance) {
    const hostSourcePath = path.join(hostRoot, "internal/skills/experts_assets.gen.go");
    const expected = hostAuthoritySource(pin, pinBytes);
    if (syncHostAuthority) {
      assert.ok((await readRegularFile(pinPath, 64 * 1024)).equals(pinBytes), "Expert pin changed during Host authority sync");
      assert.ok((await readRegularFile(path.join(contractsRoot, "compatibility/experts/source.lock.json"), 1024 * 1024)).equals(sourceLockBytes), "Contracts source changed during Host authority sync");
      await replacePin(hostSourcePath, expected);
    }
    assert.ok((await readRegularFile(hostSourcePath, 64 * 1024)).equals(expected), "Host expert authority differs from verified assets; run explicit --sync-host-authority before freeze/build");
  }
  return { outputRoot, files: files.length, ordinary, experts, manifestSha256: pin.manifest_sha256 };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const previousOptions = ["--previous-source-lock=", "--previous-skills-candidate="];
  for (const prefix of previousOptions) assert.ok(args.filter(value => value.startsWith(prefix)).length <= 1, "Duplicate previous evidence option");
  if (args.some(value => !previousOptions.some(prefix => value.startsWith(prefix)) && !["--check", "--package", "--refresh-provenance", "--sync-host-authority"].includes(value))) throw new Error("Expected only --check, --package, --refresh-provenance or --sync-host-authority, with an explicit previous-evidence pair for a repeated refresh");
  syncDesktopExpertResources({ check: args.includes("--check"), packageProducer: args.includes("--package"), refreshProvenance: args.includes("--refresh-provenance"), syncHostAuthority: args.includes("--sync-host-authority"), previousSourceLock: args.find(value => value.startsWith(previousOptions[0]))?.slice(previousOptions[0].length), previousSkillsCandidate: args.find(value => value.startsWith(previousOptions[1]))?.slice(previousOptions[1].length) }).then(result => {
    process.stdout.write(`Expert local candidate ${args.includes("--check") ? "checked" : "synced"}: ${result.ordinary} unchanged Skills + ${result.experts} expert; not release provenance.\n`);
  }).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Expert resource sync failed"}\n`); process.exitCode = 1; });
}
