import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(os.tmpdir(), "feat132-native-exchange-"));
const env = {...process.env, YIJIE_FEAT132_TEST_EXCHANGE: path.join(scratch, "host-output.json")};
function run(command, args, cwd) {
  // Each bounded test exits normally. No process-kill timeout or fake executable.
  const result = spawnSync(command, args, {cwd, env, stdio: "inherit"});
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
try {
  run("go", ["test", "./internal/session", "-run", "^TestFEAT132NativeCrossRepoExport$", "-count=1", "-v"], path.join(root, "../yijie-agent-host"));
  run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "chat::database::tests::feat132_cross_repo_host_bytes_reach_native_storage_without_identity_rewriting", "--", "--ignored", "--exact", "--nocapture"], root);
  console.log("FEAT-132 actual Host projection → Native SSE decoder/display/SQLCipher → normal reopen: PASS. No Runtime/model call.");
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
