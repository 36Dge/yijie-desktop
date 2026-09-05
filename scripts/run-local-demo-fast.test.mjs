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
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).toContain(
      "node scripts/check-agent-host-v4-contract.mjs",
    );
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).toContain(
      "VITE_YIJIE_FEAT134_STREAMING_ENABLED=true",
    );
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).toContain(
      "VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true",
    );
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).toContain(
      "node scripts/check-approval-retirement.mjs",
    );
    expect(packageJson.scripts["tauri:build:demo-fast:stable"]).not.toContain(
      "VITE_YIJIE_FEAT137_APPROVAL_ENABLED=true",
    );
  });

  it("maps the exact stable argument to image=false while retaining image=true by default", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const argumentStart = runner.indexOf('image_generation_enabled="true"');
    const argumentEnd = runner.indexOf(
      '[[ -f "$codex_binary" && -x "$codex_binary" && ! -L "$codex_binary" ]]',
    );
    expect(argumentStart).toBeGreaterThanOrEqual(0);
    expect(argumentEnd).toBeGreaterThan(argumentStart);
    const argumentBoundary = runner.slice(argumentStart, argumentEnd);

    expect(argumentBoundary).toContain('image_generation_enabled="true"');
    expect(argumentBoundary).toContain('[[ "$1" == "--stable-api-only" ]]');
    expect(argumentBoundary).toContain('image_generation_enabled="false"');
    expect(argumentBoundary).toContain('stable_api_only="true"');
    expect(runner).toContain(
      'codex_runtime_root="$host_root/.local/runtime-artifacts/feat-136-b2b20e2fc4a0"',
    );
    expect(runner).toContain('codex_binary="$codex_runtime_root/codex"');
    expect(runner).toContain('codex_manifest="$codex_runtime_root/runtime-manifest.json"');
    expect(argumentBoundary).toContain("feat134_environment=(");
    expect(argumentBoundary).toContain("YIJIE_FEAT134_STREAMING_ENABLED=true");
    expect(argumentBoundary).toContain("VITE_YIJIE_FEAT134_STREAMING_ENABLED=true");
    expect(argumentBoundary).toContain("YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED=true");
    expect(argumentBoundary).toContain("VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true");
    expect(argumentBoundary).not.toContain("YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED=true");
    expect(argumentBoundary).not.toContain("VITE_YIJIE_FEAT137_APPROVAL_ENABLED=true");
    expect(argumentBoundary).toContain('case "$#" in');
  });

  it("pins both entries to the retained FEAT-136 Runtime provenance artifact pair", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain(
      'runtime_binary_sha256="4efe16d2848680752cf9aacf4c17741ab2eeb7415894a66c2bb03652b00a322d"',
    );
    expect(runner).toContain(
      'runtime_manifest_sha256="1cfa2e0a139b2213f4d29b1efeed71d4810110ac865f0bcbd931ff33b0062c1b"',
    );
    expect(runner).toContain('if [[ "$stable_api_only" == "true" ]]; then');
    expect(runner).toContain(
      '[[ -f "$codex_binary" && -x "$codex_binary" && ! -L "$codex_binary" ]]',
    );
    expect(runner).toContain('[[ "$(sha256_file "$codex_binary")" == "$runtime_binary_sha256" ]]');
    expect(runner).toContain('[[ "$(sha256_file "$codex_manifest")" == "$runtime_manifest_sha256" ]]');
    expect(runner.match(/\.local\/runtime-artifacts\/feat-136-b2b20e2fc4a0/g)).toHaveLength(1);
  });

  it("retains FEAT-134 and FEAT-136 in stable mode without reactivating FEAT-137", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const stableBranch = runner.slice(runner.indexOf("  1)"), runner.indexOf("    ;;"));
    const execBoundary = runner.slice(runner.indexOf("exec env \\"));

    expect(stableBranch).toContain('[[ "$1" == "--stable-api-only" ]]');
    expect(stableBranch).toContain("YIJIE_FEAT134_STREAMING_ENABLED=true");
    expect(stableBranch).toContain("VITE_YIJIE_FEAT134_STREAMING_ENABLED=true");
    expect(stableBranch).toContain("YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED=true");
    expect(stableBranch).toContain("VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true");
    expect(stableBranch).not.toContain("YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED=true");
    expect(stableBranch).not.toContain("VITE_YIJIE_FEAT137_APPROVAL_ENABLED=true");
    expect(runner.match(/^\s+YIJIE_FEAT134_STREAMING_ENABLED=true$/gm)).toHaveLength(1);
    expect(runner.match(/^\s+VITE_YIJIE_FEAT134_STREAMING_ENABLED=true$/gm)).toHaveLength(1);
    expect(runner.match(/^\s+YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED=true$/gm)).toHaveLength(1);
    expect(runner.match(/^\s+VITE_YIJIE_FEAT136_EXECUTION_ENABLED=true$/gm)).toHaveLength(1);
    expect(runner.match(/^\s+YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED=true$/gm)).toBeNull();
    expect(runner.match(/^\s+VITE_YIJIE_FEAT137_APPROVAL_ENABLED=true$/gm)).toBeNull();
    expect(execBoundary).toContain("-u YIJIE_FEAT134_STREAMING_ENABLED \\");
    expect(execBoundary).toContain("-u VITE_YIJIE_FEAT134_STREAMING_ENABLED \\");
    expect(execBoundary).toContain("-u YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED \\");
    expect(execBoundary).toContain("-u VITE_YIJIE_FEAT136_EXECUTION_ENABLED \\");
    expect(execBoundary).toContain("-u YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED \\");
    expect(execBoundary).toContain("-u VITE_YIJIE_FEAT137_APPROVAL_ENABLED \\");
    expect(execBoundary).toContain('"${feat134_environment[@]+"${feat134_environment[@]}"}"');
    expect(execBoundary).toContain("YIJIE_ENV=local \\");
    expect(execBoundary).toContain("YIJIE_LOCAL_PROFILE=demo_fast \\");
  });

  it("checks permanent retirement at the shared runner boundary", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const check = "node scripts/check-approval-retirement.mjs";
    const stableGuardStart = runner.indexOf(check);
    const stableGuard = runner.slice(stableGuardStart);
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

    expect(stableGuardStart).toBeGreaterThanOrEqual(0);
    expect(stableGuard).toContain(check);
    expect(runner.match(/node scripts\/check-approval-retirement\.mjs/g)).toHaveLength(1);
    expect(runner).not.toContain("check-agent-host-v6-contract.mjs");
    expect(packageJson.scripts.generate).not.toContain(check);
    expect(packageJson.scripts["generate:check"]).not.toContain(check);
  });

  it("clears ambient FEAT-136 activation from every non-stable package entry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    const nativeFlag = "YIJIE_FEAT136_COMMAND_TOOL_ITEMS_ENABLED";
    const webFlag = "VITE_YIJIE_FEAT136_EXECUTION_ENABLED";

    for (const name of ["tauri:dev:raw", "tauri:build", "tauri:build:demo-fast"]) {
      const command = packageJson.scripts[name];
      expect(command).toContain(`-u ${nativeFlag}`);
      expect(command).toContain(`-u ${webFlag}`);
      expect(command).not.toContain(`${nativeFlag}=true`);
      expect(command).not.toContain(`${webFlag}=true`);
    }

    const stableBuild = packageJson.scripts["tauri:build:demo-fast:stable"];
    expect(stableBuild).toContain(`-u ${nativeFlag}`);
    expect(stableBuild).toContain(`-u ${webFlag}`);
    expect(stableBuild).not.toContain(`${nativeFlag}=true`);
    expect(stableBuild.match(new RegExp(`${webFlag}=true`, "g"))).toHaveLength(1);
  });

  it("clears ambient FEAT-137 activation from every package entry", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    const nativeFlag = "YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED";
    const webFlag = "VITE_YIJIE_FEAT137_APPROVAL_ENABLED";

    for (const name of ["tauri:dev:raw", "tauri:build", "tauri:build:demo-fast"]) {
      const command = packageJson.scripts[name];
      expect(command).toContain(`-u ${nativeFlag}`);
      expect(command).toContain(`-u ${webFlag}`);
      expect(command).not.toContain(`${nativeFlag}=true`);
      expect(command).not.toContain(`${webFlag}=true`);
    }

    const stableBuild = packageJson.scripts["tauri:build:demo-fast:stable"];
    expect(stableBuild).toContain(`-u ${nativeFlag}`);
    expect(stableBuild).toContain(`-u ${webFlag}`);
    expect(stableBuild).not.toContain(`${nativeFlag}=true`);
    expect(stableBuild).not.toContain(`${webFlag}=true`);
  });

  it("builds and launches the registered debug app only for the stable UI entry", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain('if [[ "$stable_api_only" == "true" ]]; then');
    expect(runner).toContain("pnpm tauri:build:demo-fast:stable");
    expect(runner).toContain("src-tauri/target/debug/bundle/macos/易界 AI FEAT-131.app/Contents/MacOS/yijie-desktop");
    expect(runner).toContain("launch_command=(pnpm exec tauri dev --config src-tauri/tauri.demo-fast.conf.json)");
    expect(runner).toContain('"${launch_command[@]}"');
  });

  it("expands an empty profile environment safely under macOS Bash nounset", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const { stdout } = await exec("/bin/bash", [
      "-c",
      'set -u; values=(); set -- "${values[@]+"${values[@]}"}"; printf "%s" "$#"',
    ]);

    expect(runner).toContain('"${feat134_environment[@]+"${feat134_environment[@]}"}"');
    expect(stdout).toBe("0");
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
