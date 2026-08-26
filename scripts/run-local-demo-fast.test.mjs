import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(repositoryRoot, "scripts/run-local-demo-fast.sh");

describe("local demo launcher profiles", () => {
  it("keeps the default commands and adds one explicit stable API entry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

    expect(packageJson.scripts["tauri:dev"]).toBe("./scripts/run-local-demo-fast.sh");
    expect(packageJson.scripts["tauri:demo-fast"]).toBe("./scripts/run-local-demo-fast.sh");
    expect(packageJson.scripts["tauri:demo-fast:stable"]).toBe(
      "./scripts/run-local-demo-fast.sh --stable-api-only",
    );
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).toContain(
      "--config src-tauri/tauri.feat131-stable.conf.json",
    );
  });

  it("maps the exact stable argument to image=false while retaining image=true by default", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const argumentBoundary = runner.slice(
      runner.indexOf('image_generation_enabled="true"'),
      runner.indexOf('[[ -x "$codex_binary" ]]'),
    );

    expect(argumentBoundary).toContain('image_generation_enabled="true"');
    expect(argumentBoundary).toContain('[[ "$1" == "--stable-api-only" ]]');
    expect(argumentBoundary).toContain('image_generation_enabled="false"');
    expect(argumentBoundary).toContain('stable_api_only="true"');
    expect(argumentBoundary).toContain('case "$#" in');
  });

  it("builds and launches the registered debug app only for the stable UI entry", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain('if [[ "$stable_api_only" == "true" ]]; then');
    expect(runner).toContain("pnpm tauri:build:demo-fast:stable");
    expect(runner).toContain("src-tauri/target/debug/bundle/macos/易界 AI FEAT-131.app/Contents/MacOS/yijie-desktop");
    expect(runner).toContain("launch_command=(pnpm exec tauri dev --config src-tauri/tauri.demo-fast.conf.json)");
    expect(runner).toContain('"${launch_command[@]}"');
  });

  it("isolates stable app identity and durable local state from the default demo", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const stableConfig = JSON.parse(
      await readFile(path.join(repositoryRoot, "src-tauri/tauri.feat131-stable.conf.json"), "utf8"),
    );
    const librarySource = await readFile(path.join(repositoryRoot, "src-tauri/src/lib.rs"), "utf8");

    expect(stableConfig.productName).toBe("易界 AI FEAT-131");
    expect(stableConfig.identifier).toBe("com.yijie.ai.feat131-stable");
    expect(runner).toContain('runtime_root="$desktop_root/.local/feat131-stable"');
    expect(librarySource).toContain('std::env::var("YIJIE_FEAT131_STABLE_ENTRY")');
    expect(librarySource).toContain('eprintln!("yijie desktop instance is already running")');
    expect(librarySource).toContain("std::process::exit(1);");
    expect(librarySource).toContain("Err(single_instance::AcquireError::AlreadyRunning) => return");
    expect(runner).toContain("-u YIJIE_FEAT131_STABLE_ENTRY \\");
    expect(runner).toContain('YIJIE_FEAT131_STABLE_ENTRY="$stable_api_only" \\');
  });

  it("clears ambient provider inputs before setting the exact parent profile", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const envBoundary = runner.slice(runner.indexOf("exec env \\"));

    for (const name of [
      "YIJIE_MODEL_PROVIDER",
      "YIJIE_MINIMAX_API_KEY",
      "YIJIE_MINIMAX_API_KEY_FILE",
      "YIJIE_FEAT128_IMAGE_GENERATION_ENABLED",
    ]) {
      expect(envBoundary).toContain(`-u ${name} \\`);
    }
    expect(envBoundary).toContain("YIJIE_MODEL_PROVIDER=minimax \\");
    expect(envBoundary).toContain('YIJIE_MINIMAX_API_KEY_FILE="$provider_key_file" \\');
    expect(envBoundary).toContain('YIJIE_FEAT128_IMAGE_GENERATION_ENABLED="$image_generation_enabled" \\');
    expect(envBoundary).not.toContain("YIJIE_MINIMAX_API_KEY=\"");
  });

  it("rejects unsupported arguments before filesystem preflight", async () => {
    await expect(exec(runnerPath, ["--unsupported-profile"], { cwd: repositoryRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "local demo startup failed: unsupported arguments; expected no arguments or --stable-api-only",
      ),
    });
    await expect(exec(runnerPath, ["--stable-api-only", "unexpected"], { cwd: repositoryRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "local demo startup failed: unsupported arguments; expected no arguments or --stable-api-only",
      ),
    });
  });
});
