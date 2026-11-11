// Cargo's supported target runner launches the just-built dev executable in its
// real macOS application bundle. Tauri still owns compilation and Vite HMR.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipeKey = "YIJIE_DEVELOPMENT_BUNDLE_ARGUMENTS";
export function bundleArguments(devArguments) {
  assert.deepEqual(devArguments.slice(0, 3), ["exec", "tauri", "dev"]);
  const result = ["exec", "tauri", "bundle", "--debug", "--bundles", "app", "--no-sign"];
  for (let i = 3; i < devArguments.length; i++) {
    const option = devArguments[i];
    if (option === "--no-watch") continue;
    assert.ok(["--config", "--features"].includes(option), "unsupported development argument");
    const value = devArguments[++i];
    assert.equal(typeof value, "string");
    result.push(option, value);
  }
  return result;
}

export function runnerEnvironment(environment, devArguments, project = root, platform = process.platform, arch = process.arch, node = process.execPath) {
  if (platform !== "darwin" || environment.YIJIE_DEVELOPMENT_CLIENT !== "true") return { ...environment };
  assert.ok(["arm64", "x64"].includes(arch), "unsupported macOS architecture");
  const runner = path.join(project, "scripts/development-app-runner.mjs");
  assert.ok(!/\s/u.test(node + runner), "Cargo runner paths must not contain whitespace");
  const triple = arch === "arm64" ? "AARCH64_APPLE_DARWIN" : "X86_64_APPLE_DARWIN";
  const key = `CARGO_TARGET_${triple}_RUNNER`;
  assert.ok(!environment[key] && !environment[recipeKey], "development runner is already configured");
  return { ...environment, [key]: `${node} ${runner}`, [recipeKey]: JSON.stringify(bundleArguments(devArguments)) };
}

export function withoutDevelopmentRunner(environment) {
  const result = { ...environment };
  delete result.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER;
  delete result.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER;
  delete result[recipeKey];
  return result;
}

async function digest(file) {
  assert.equal(await realpath(file), file, "development output must be canonical");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && !(stat.mode & 0o022), "unexpected development output");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex");
  } finally { await handle.close(); }
}

async function treeDigest(directory) {
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  const rows = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name);
    rows.push([name, (await lstat(file)).isDirectory() ? await treeDigest(file) : await digest(file)]);
  }
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function run(executable, args, environment, cwd = root) {
  const child = spawn(executable, args, { cwd, env: environment, stdio: "inherit", shell: false });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  assert.ok(result.code === 0 && result.signal === null, "development child did not exit normally");
}

async function main() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.YIJIE_DEVELOPMENT_CLIENT, "true");
  const target = path.join(root, ".local/development/target");
  assert.equal(process.env.CARGO_TARGET_DIR, target);
  const source = path.join(target, "debug/yijie-desktop");
  assert.equal(path.resolve(process.argv[2] ?? ""), source, "runner only accepts the canonical Cargo output");
  const { developmentArguments } = await import("./run-workflow-dev.mjs");
  const args = bundleArguments(developmentArguments(process.env));
  assert.deepEqual(JSON.parse(process.env[recipeKey] ?? "null"), args);
  const environment = withoutDevelopmentRunner(process.env);
  const inputs = ["src-tauri/tauri.conf.json", "src-tauri/icons/icon.icns", "pnpm-lock.yaml", "scripts/development-app-runner.mjs",
    "contracts/desktop-skill-bundle-local.lock.json", "contracts/experts-assets-feat164.candidate.json"];
  for (let i = 0; i < args.length; i++) if (args[i] === "--config") inputs.push(args[++i]);
  const binaryHash = await digest(source);
  const helper = path.join(target, "debug/yijie-document-render");
  const pins = await Promise.all(inputs.map(async file => [file, await digest(path.join(root, file))]));
  const recipeFor = helperHash => createHash("sha256").update(JSON.stringify([args, binaryHash, helperHash, pins])).digest("hex");
  const optionalDigest = async file => { try { return await digest(file); } catch (error) { if (error.code !== "ENOENT") throw error; return null; } };
  let recipe = recipeFor(await optionalDigest(helper));
  const app = path.join(target, "debug/bundle/macos/易界 AI.app");
  const executable = path.join(app, "Contents/MacOS/yijie-desktop");
  const receipt = path.join(root, ".local/development/dev-app-build.json");
  let previous;
  try { previous = JSON.parse(await readFile(receipt, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let reuse = false;
  if (previous?.recipe === recipe && previous?.project === root) {
    try { reuse = previous.bundle_sha256 === await treeDigest(app); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!reuse) {
    // Build the normal project helper only when the native recipe changes.
    // Frontend HMR and unchanged reopens do not rebuild either native binary.
    await run("cargo", ["build", "--locked", "--no-default-features", "--bin", "yijie-document-render", "--features", "kimi-k31-pro-candidate"], environment, path.join(root, "src-tauri"));
    recipe = recipeFor(await digest(helper));
    // Fixed project build output only; no installed, signed or released app is
    // updated. This bundles the dev binary without switching to a release build.
    const bundlerEnvironment = { ...environment };
    delete bundlerEnvironment.TAURI_CONFIG;
    await run("pnpm", args, bundlerEnvironment);
    assert.equal(await digest(executable), binaryHash, "bundler did not preserve the current dev binary");
    const temporary = receipt + `.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ schema_version: 1, project: root, recipe, binary_sha256: binaryHash, bundle_sha256: await treeDigest(app) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, receipt);
  }
  assert.equal(await digest(executable), binaryHash);
  process.stdout.write(`Development App verified: ${binaryHash}; ${reuse ? "reused" : "bundled"}; Vite HMR retained.\n`);
  await run(executable, process.argv.slice(3), environment);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const pending = () => process.stderr.write("Quit 易界 normally; the development runner does not forward termination signals.\n");
  process.on("SIGINT", pending);
  process.on("SIGTERM", pending);
  main().catch(error => { process.stderr.write(`Development App: ${error.message}\n`); process.exitCode = 1; });
}
