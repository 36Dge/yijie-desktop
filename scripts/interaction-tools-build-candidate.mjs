// Explicit FEAT-169 local-development inputs. Existing release/image pins remain intact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hash = value => createHash("sha256").update(value).digest("hex");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockName = "contracts/interaction-tools-build.candidate.json";
const hostPaths = ["cmd", "internal", "api", "go.mod", "go.sum", "artifact-mcp/Cargo.toml", "artifact-mcp/Cargo.lock", "artifact-mcp/src", "scripts/build-artifact-adapter.sh", "scripts/artifact_build_output.py"];

function snapshot(desktop, contracts, host) {
  execFileSync(process.execPath, ["scripts/generate-runtime-interaction-tools.mjs", "--check"], { cwd: contracts, stdio: "pipe" });
  const runtime = readFileSync(path.join(contracts, "compatibility/runtime-interaction-tools/source.lock.json"));
  assert.deepEqual(runtime, readFileSync(path.join(desktop, "contracts/runtime-interaction-tools.candidate.json")));
  execFileSync(process.execPath, ["scripts/sync-native-process.mjs", "--candidate", "--check"], { cwd: contracts, stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/generate-user-input.mjs", "--check"], { cwd: contracts, stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/generate-context-window.mjs", "--check"], { cwd: contracts, stdio: "pipe" });
  const contextWindow = readFileSync(path.join(contracts, "compatibility/context-window/source.lock.json"));
  const input = readFileSync(path.join(contracts, "compatibility/user-input/source.lock.json"));
  const display = readFileSync(path.join(desktop, "contracts/native-process.candidate.json"));
  const names = [...new Set(execFileSync("git", ["-C", host, "ls-files", "-co", "--exclude-standard", "--", ...hostPaths], { encoding: "utf8" }).trim().split("\n"))].sort();
  const sources = {};
  for (const name of names) {
    assert(!path.isAbsolute(name) && !name.split("/").includes(".."));
    assert(lstatSync(path.join(host, name)).isFile());
    sources[name] = hash(readFileSync(path.join(host, name)));
  }
  return { schema_version: 1, feature: "FEAT-169", mode: "local_worktree_candidate", release: false,
    runtime_lock_sha256: hash(runtime), user_input_lock_sha256: hash(input), context_window_lock_sha256: hash(contextWindow), native_display_sha256: hash(display), host_base_commit: execFileSync("git", ["-C", host, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), host_sources: sources };
}

export function verifyInteractionToolsBuildCandidate(desktop, contracts, host, env) {
  assert.equal(env.YIJIE_FEAT169_NATIVE_TOOLS, "true");
  assert.equal(env.YIJIE_FEAT169_INTERACTION_TOOLS, "true");
  assert.equal(env.YIJIE_ENV, "local");
  assert.equal(env.YIJIE_LOCAL_PROFILE, "demo_fast");
  assert.equal(env.YIJIE_KIMI_K31_PRO_CANDIDATE, "true");
  assert.equal(env.YIJIE_RUNTIME_PERMISSIONS_ENABLED, "true");
  assert.equal(env.YIJIE_KIMI_K31_CALL_SURFACES, "media");
  assert.equal(env.YIJIE_DEVELOPMENT_CLIENT, "true");
  assert.equal(env.YIJIE_FEAT164_DAILY, "true");
  const expected = JSON.parse(readFileSync(path.join(desktop, lockName)));
  assert.deepEqual(expected, snapshot(desktop, contracts, host), "interaction tool build inputs changed; prepare the reviewed local candidate again");
  return expected.host_sources;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.deepEqual(args, ["--freeze"]);
  const result = snapshot(root, path.resolve(root, "../yijie-contracts"), path.resolve(root, "../yijie-agent-host"));
  writeFileSync(path.join(root, lockName), JSON.stringify(result, null, 2) + "\n");
  console.log("FEAT-169 local development source snapshot written; not a release or live acceptance.");
}
