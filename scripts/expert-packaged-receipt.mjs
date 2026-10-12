// Local QA provenance for one canonical build. Not a release signature, cache,
// installation receipt, or authority to execute a conversation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { desktopRoot, expertLocalProfile, expertHostBinary } from "./expert-local-profile.mjs";
import { sha256, readRegularFile } from "./sync-desktop-skill-resources.mjs";

const sourceInputs = ["src", "src-tauri", "scripts", "contracts", "public", "patches", "tools", "sidecars", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "rust-toolchain.toml", "index.html", "vite.config.*", "vitest.config.*", "tsconfig*.json", "eslint.config.js", ".cargo", ".npmrc", ".gitignore", ".gitattributes"];
const buildEnvironmentKeys = ["YIJIE_ENV", "YIJIE_LOCAL_PROFILE", "YIJIE_EXPERTS_ENABLED", "YIJIE_CHAT_MODELS_ENABLED", "YIJIE_MARKET_CONNECTORS_ENABLED", "YIJIE_RUNTIME_PERMISSIONS_ENABLED", "YIJIE_FEAT155_SCHEDULED_CANDIDATE", "YIJIE_FEAT155_SCHEDULED_DAILY", "YIJIE_MARKET_PROVIDER_ONLY", "YIJIE_PERMISSION_VERIFICATION_BASE_URL", "NODE_ENV", "NODE_OPTIONS", "CC", "CXX", "CFLAGS", "CXXFLAGS", "LDFLAGS", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET", "PKG_CONFIG_PATH"];

export async function workerBuildInputs(root = path.resolve(desktopRoot, "../yijie-connectors")) {
  // main.rs and provider_registry.rs include the two catalog JSON files. The
  // worker subtree also contains Cargo locks, local assets and generated types.
  const inputs = ["worker", "catalog", "scripts/build-market-worker.sh", "scripts/check-worker-source.py", ".cargo", "rust-toolchain", "rust-toolchain.toml", ".gitignore"];
  const listed = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z", "--", ...inputs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const sources = {};
  for (const file of [...new Set(listed.split("\0").filter(Boolean))].sort()) {
    assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."));
    sources[file] = sha256(await readRegularFile(path.join(root, file), 32 * 1024 * 1024));
  }
  return sources;
}

function requireExpertEnvironment(environment) {
  assert.equal(environment.YIJIE_ENV, "local");
  assert.equal(environment.YIJIE_LOCAL_PROFILE, "demo_fast");
  for (const key of ["YIJIE_EXPERTS_ENABLED", "YIJIE_CHAT_MODELS_ENABLED", "YIJIE_MARKET_CONNECTORS_ENABLED", "YIJIE_RUNTIME_PERMISSIONS_ENABLED"]) assert.equal(environment[key], "true", `Packaged expert build requires ${key}`);
  assert.ok(!environment.TAURI_CONFIG, "Ambient Tauri configuration is not supported");
}

export async function desktopBuildInputs(root = desktopRoot, environment = process.env) {
  requireExpertEnvironment(environment);
  const listed = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z", "--", ...sourceInputs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const files = [...new Set(listed.split("\0").filter(Boolean))].sort();
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    try { await lstat(path.join(root, file)); if (!files.includes(file)) files.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  files.sort();
  const sources = {};
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."));
    sources[file] = sha256(await readRegularFile(path.join(root, file), 32 * 1024 * 1024));
  }
  // Record only value digests, including public Vite build flags. No credentials
  // or raw ambient environment values are written to the QA receipt.
  const keys = [...new Set([...buildEnvironmentKeys, ...Object.keys(environment).filter(key => /^(YIJIE_|VITE_|TAURI_|CARGO_|RUST)/.test(key))])].sort();
  const environmentSha256 = Object.fromEntries(keys.map(key => [key, sha256(JSON.stringify(environment[key] ?? null))]));
  return { sources, workerSources: await workerBuildInputs(path.resolve(root, "../yijie-connectors")), environmentSha256 };
}

async function artifactFile(file) {
  const metadata = await lstat(file);
  assert.ok(metadata.isFile(), "Packaged artifact must be a regular file");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return { path: file, bytes: metadata.size, mode: metadata.mode & 0o777, sha256: hash.digest("hex") };
}

async function artifactTree(root) {
  assert.ok((await lstat(root)).isDirectory(), "App bundle directory is missing");
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else {
        assert.ok(entry.isFile(), "App bundle must contain only normal files/directories");
        files.push(await artifactFile(file));
      }
    }
  }
  await visit(root);
  return files;
}

export function comparePackagedReceipt(saved, current) {
  assert.equal(saved.schema_version, 1, "Unsupported local packaged receipt");
  assert.equal(saved.feature, "FEAT-158");
  assert.equal(saved.release, false);
  assert.equal(saved.kind, "canonical_local_qa_build");
  for (const field of ["profile", "inputs", "artifacts"]) assert.ok(isDeepStrictEqual(saved[field], current[field]), `Packaged ${field} drift; rebuild through the canonical launcher`);
}

async function currentRecord(key, runtimeBinary, runtimeManifest, workerManifest) {
  const profile = await expertLocalProfile(key);
  const bundleRoot = path.join(desktopRoot, "src-tauri/target/debug/bundle/macos", `${profile.productName}.app`);
  assert.ok(path.isAbsolute(runtimeBinary) && path.isAbsolute(runtimeManifest));
  const expectedWorker = path.resolve(desktopRoot, "../yijie-connectors/bin/market-worker/current.json");
  assert.equal(workerManifest, expectedWorker, "Only the canonical worker manifest is supported");
  const worker = JSON.parse(await readRegularFile(workerManifest, 64 * 1024));
  assert.equal(worker.schemaVersion, 2);
  assert.equal(worker.candidateOnly, true);
  assert.match(worker.sha256, /^[a-f0-9]{64}$/);
  assert.equal(worker.binary, path.join(path.dirname(workerManifest), worker.sha256, "yijie-mcp-worker"));
  const workerBinary = await artifactFile(worker.binary);
  assert.equal(workerBinary.sha256, worker.sha256);
  assert.equal(workerBinary.bytes, worker.sizeBytes);
  const bundleFiles = await artifactTree(bundleRoot);
  const identifier = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(bundleRoot, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  assert.equal(identifier, profile.identifier, "App bundle identity differs from the reviewed profile");
  for (const slot of ["skill-packages", "skill-packages-experts"]) {
    const generatedRoot = path.join(desktopRoot, ".local", slot);
    const packagedRoot = path.join(bundleRoot, "Contents/Resources", slot);
    const expected = await artifactTree(generatedRoot);
    const actual = bundleFiles.filter(file => file.path.startsWith(`${packagedRoot}/`));
    const project = (files, base) => files.map(file => ({ path: path.relative(base, file.path), bytes: file.bytes, sha256: file.sha256 }));
    assert.ok(isDeepStrictEqual(project(actual, packagedRoot), project(expected, generatedRoot)), "App bundled resources differ from the checked generated slot");
  }
  assert.ok(bundleFiles.some(file => file.path === path.join(bundleRoot, "Contents/MacOS/yijie-desktop") && (file.mode & 0o111)), "Canonical App executable is missing");
  const host = await artifactFile(expertHostBinary(profile));
  assert.ok(host.mode & 0o111, "Canonical Host executable is missing");
  const runtime = await artifactFile(runtimeBinary);
  assert.ok(runtime.mode & 0o111, "Pinned Runtime executable is missing");
  return {
    schema_version: 1,
    feature: "FEAT-158",
    kind: "canonical_local_qa_build",
    release: false,
    profile,
    inputs: await desktopBuildInputs(),
    artifacts: { bundleFiles, host, runtime, runtimeManifest: await artifactFile(runtimeManifest), workerManifest: await artifactFile(workerManifest), workerBinary },
  };
}

async function main() {
  const [action, key, runtimeBinary, runtimeManifest, workerManifest, expectedInputsDigest, expectedWorkerDigest] = process.argv.slice(2);
  if (action === "--worker-inputs-digest") {
    assert.equal(process.argv.length, 3);
    process.stdout.write(sha256(JSON.stringify(await workerBuildInputs())) + "\n");
    return;
  }
  if (action === "--inputs-digest") {
    assert.equal(process.argv.length, 3);
    process.stdout.write(sha256(JSON.stringify(await desktopBuildInputs())) + "\n");
    return;
  }
  assert.ok(["--record", "--check"].includes(action));
  assert.equal(process.argv.length, action === "--record" ? 9 : 7);
  const record = await currentRecord(key, runtimeBinary, runtimeManifest, workerManifest);
  const receiptPath = path.join(desktopRoot, ".local", record.profile.runtimeDirectory, "packaged-launch-receipt.json");
  if (action === "--check") {
    const saved = JSON.parse(await readRegularFile(receiptPath, 4 * 1024 * 1024));
    comparePackagedReceipt(saved, record);
    process.stdout.write("Same-build expert reopen verified; local QA provenance only.\n");
  } else {
    assert.match(expectedInputsDigest, /^[a-f0-9]{64}$/);
    assert.match(expectedWorkerDigest, /^[a-f0-9]{64}$/);
    assert.equal(sha256(JSON.stringify(record.inputs.workerSources)), expectedWorkerDigest, "Worker build inputs changed during build; no reopen receipt recorded");
    assert.equal(sha256(JSON.stringify(record.inputs)), expectedInputsDigest, "Desktop build inputs changed during build; no reopen receipt recorded");
    const temporary = `${receiptPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, receiptPath);
    process.stdout.write("Canonical expert packaged build recorded; local QA provenance only.\n");
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
