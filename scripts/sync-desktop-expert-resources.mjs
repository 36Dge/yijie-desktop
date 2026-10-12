// Explicit local candidate only. Reuse the existing atomic managed-bundle copy
// and archive inventory checks; do not replace the immutable ordinary v2 slot.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { installOutput, readRegularFile, safeRelativePath, sha256, verifyBundleFiles, verifyOutput, validateResourceLock } from "./sync-desktop-skill-resources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const outputRoot = path.join(root, ".local/skill-packages-experts");
const producerOutput = "dist/skills-experts-candidate-v013";
const manifestPath = `${producerOutput}/bundle-manifest.json`;
const inventory = items => `${items.map(item => `${safeRelativePath(item.archive.path)} ${item.archive.sha256}`).sort().join("\n")}\n`;

export async function syncDesktopExpertResources({ check = false, packageProducer = false, environment = process.env } = {}) {
  assert.ok(environment.YIJIE_ENV === "local" && environment.YIJIE_LOCAL_PROFILE === "demo_fast", "Expert assets are restricted to explicit local/demo_fast candidates");
  const skillsRoot = path.resolve(root, environment.YIJIE_DESKTOP_SKILLS_DIR ?? "../yijie-skills");
  const contractsRoot = path.resolve(root, environment.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts");
  const pin = JSON.parse(await readRegularFile(path.join(root, "contracts/experts-assets.candidate.json"), 64 * 1024));
  assert.equal(pin.schema_version, 1); assert.equal(pin.feature, "FEAT-158"); assert.equal(pin.release, false);
  assert.equal(pin.source.repository, "https://github.com/36Dge/yijie-skills.git");
  assert.ok(["git-commit", "working-tree"].includes(pin.source.revision_kind));
  const sourceLockBytes = await readRegularFile(path.join(contractsRoot, "compatibility/experts/source.lock.json"), 1024 * 1024);
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
  if (packageProducer) {
    assert.equal(check, false, "A check never rebuilds producer assets");
    await exec(process.execPath, ["scripts/package-desktop-skills.mjs", "--source", "plugins/yijie-desktop-skills/experts/bundle-source.json", "--output", producerOutput], { cwd: skillsRoot, maxBuffer: 4 * 1024 * 1024 });
  }
  const bytes = await readRegularFile(path.join(skillsRoot, manifestPath), 2 * 1024 * 1024);
  const authorityBytes = await readRegularFile(path.join(skillsRoot, producerOutput, "authority.json"), 256 * 1024);
  assert.equal(sha256(bytes), pin.manifest_sha256, "Expert manifest differs from Native pin");
  assert.equal(sha256(authorityBytes), pin.authority_sha256, "Expert authority differs from Native pin");
  const manifest = JSON.parse(bytes), authority = JSON.parse(authorityBytes);
  assert.equal(manifest.schema_version, 3); assert.equal(manifest.distribution_channel, "local-development");
  assert.equal(manifest.bundle_version, pin.bundle_version); assert.deepEqual(manifest.source, pin.source);
  assert.equal(authority.release, false); assert.equal(authority.manifest_sha256, pin.manifest_sha256);
  assert.deepEqual(authority.source, pin.source);
  for (const item of [authority.source_definition, authority.contracts_candidate]) {
    assert.equal(sha256(await readRegularFile(path.join(skillsRoot, safeRelativePath(item.path)), 2 * 1024 * 1024)), item.sha256, "Expert source evidence changed");
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
  assert.equal(ordinary.length, 38); assert.equal(experts.length, 1); assert.equal(manifest.skills.length, 39);
  assert.equal(sha256(inventory(ordinary)), oldLock.catalog.archive_inventory_sha256, "Ordinary Skill archive inventory must remain unchanged");
  assert.equal(experts[0].expert.expert_id, "jd-ops-expert");
  const bundle = await verifyBundleFiles(skillsRoot, manifest, { manifest_path: manifestPath }, { catalog: { archive_inventory_sha256: sha256(inventory(manifest.skills)) } });
  const files = [{ relativePath: "bundle-manifest.json", bytes }, { relativePath: "authority.json", bytes: authorityBytes }, ...bundle.files];
  if (check) await verifyOutput(outputRoot, files); else await installOutput(outputRoot, files);
  return { outputRoot, files: files.length, ordinary: ordinary.length, experts: experts.length, manifestSha256: pin.manifest_sha256 };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  if (args.some(value => !["--check", "--package"].includes(value))) throw new Error("Expected only --check or --package");
  syncDesktopExpertResources({ check: args.includes("--check"), packageProducer: args.includes("--package") }).then(result => {
    process.stdout.write(`Expert local candidate ${args.includes("--check") ? "checked" : "synced"}: ${result.ordinary} unchanged Skills + ${result.experts} expert; not release provenance.\n`);
  }).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Expert resource sync failed"}\n`); process.exitCode = 1; });
}
