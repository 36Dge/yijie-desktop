#!/usr/bin/env node
// Canonical FEAT-153 dev entry: the same App and Vite config, with normal close.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateRoot = path.join(root, ".local/demo-fast/workflow-dev");
const statePath = path.join(stateRoot, "processes.json");
const require = (valid, message) => { if (!valid) throw new Error(message); };

async function record(value) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const directory = await lstat(stateRoot);
  require(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.geteuid() && (directory.mode & 0o777) === 0o700, "workflow dev state directory is not owner-only");
  const temporary = statePath + "." + process.pid + ".tmp";
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, statePath);
}

export async function runWorkflowDev() {
  const nativeEnvironment = { ...process.env };
  require(process.argv.length === 2 && nativeEnvironment.YIJIE_ENV === "local" && nativeEnvironment.YIJIE_LOCAL_PROFILE === "demo_fast" && nativeEnvironment.YIJIE_WORKFLOW_ENABLED === "true", "use the canonical exact local workflow launcher");
  require(!nativeEnvironment.TAURI_CONFIG, "ambient Tauri config is not supported by this workflow entry");
  require(path.isAbsolute(nativeEnvironment.YIJIE_WORKFLOW_CREDENTIAL_FILE ?? ""), "native workflow credential file path is required");
  process.env.VITE_YIJIE_WORKFLOW_ENABLED = "true";
  nativeEnvironment.VITE_YIJIE_WORKFLOW_ENABLED = "true";
  // Vite sees public VITE_* flags only. The native CLI receives the FILE path,
  // never K_NA itself; Host later uses its separate explicit env allowlist.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("YIJIE_WORKFLOW_") || key === "VITE_YIJIE_WORKFLOW_CREDENTIAL_FILE" || key === "VITE_YIJIE_WORKFLOW_COZE_CREDENTIAL_FILE") delete process.env[key];
  }
  delete nativeEnvironment.TAURI_DEV_HOST;
  delete nativeEnvironment.YIJIE_WORKFLOW_COZE_CREDENTIAL_FILE;
  delete nativeEnvironment.VITE_YIJIE_WORKFLOW_CREDENTIAL_FILE;
  delete nativeEnvironment.VITE_YIJIE_WORKFLOW_COZE_CREDENTIAL_FILE;
  const state = { schema_version: 1, mode: "canonical-workflow-dev", launcher_pid: process.pid, cli_pid: null, origin: "http://localhost:1420", phase: "preparing", started_at: new Date().toISOString() };
  await record(state);
  let server;
  let child;
  let childFinished = false;
  const pending = () => process.stderr.write("WORKFLOW DEV PENDING: quit the App normally; CLI and Vite remain owned without signal forwarding.\n");
  process.on("SIGINT", pending);
  process.on("SIGTERM", pending);
  try {
    const { createServer } = await import("vite");
    server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { host: "localhost", port: 1420, strictPort: true } });
    await server.listen();
    const arguments_ = ["exec", "tauri", "dev", "--config", "src-tauri/tauri.demo-fast.conf.json", "--config", "src-tauri/tauri.workflow-local.conf.json", "--no-watch"];
    child = spawn("pnpm", arguments_, { cwd: root, env: nativeEnvironment, stdio: "inherit", detached: true, shell: false });
    const finished = new Promise((resolve, reject) => {
      child.once("error", error => { childFinished = true; reject(error); });
      child.once("exit", (code, signal) => { childFinished = true; resolve({ code, signal }); });
    });
    finished.catch(() => {}); // Attach promptly while the process record is being written.
    state.cli_pid = child.pid ?? null;
    state.phase = "cli_running";
    // Never abandon a live child merely because its nonsecret record failed.
    try { await record(state); } catch { pending(); }
    const result = await finished;
    state.phase = "closing_vite";
    state.cli_exit_code = result.code;
    state.cli_signal = result.signal;
    await server.close();
    server = undefined;
    state.phase = result.code === 0 && result.signal === null ? "stopped" : "cli_exited_review_required";
    await record(state);
    require(state.phase === "stopped", "workflow dev CLI did not exit normally; inspect its retained process record");
  } finally {
    if (!child || childFinished) {
      if (server) await server.close();
      process.off("SIGINT", pending);
      process.off("SIGTERM", pending);
    }
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  runWorkflowDev().catch(() => {
    process.stderr.write("WORKFLOW DEV: normal startup or cleanup is incomplete; no process was force-stopped.\n");
    process.exitCode = 1;
  });
}
