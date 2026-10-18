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
  it.each([
    ["ordinary daily", "false", "false", "daily", "", "true"],
    ["explicit daily enable", "false", "false", "daily", "true", "true"],
    ["explicit daily rollback", "false", "false", "daily", "false", "false"],
    ["stable", "true", "false", "daily", "", "false"],
    ["scheduled isolation", "false", "true", "daily", "", "false"],
    ["expert isolation", "false", "false", "default", "", "false"],
    ["expert content isolation", "false", "false", "content-v013", "", "false"],
  ])("selects the real workflow entry without manual flags: %s", async (_label, stable, scheduled, expertProfile, override, expected) => {
    const runner = await readFile(runnerPath, "utf8");
    const start = runner.indexOf('workflow_default="false"');
    const end = runner.indexOf('scheduled_daily_default="true"', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const { stdout } = await exec("/bin/bash", ["-c", `
      set -euo pipefail
      fail() { exit 1; }
      stable_api_only="$1"; scheduled_candidate="$2"; expert_profile="$3"; workflow_requested="$4"
      ${runner.slice(start, end)}
      printf '%s' "$workflow_requested"
    `, "workflow-default", stable, scheduled, expertProfile, override]);
    expect(stdout).toBe(expected);
  });

  it.each([
    ["daily default", "true", "true", "unset", "true"],
    ["daily explicit rollback", "true", "true", "false", "false"],
    ["legacy model rollback", "true", "false", "unset", "false"],
    ["isolated model candidate", "false", "true", "unset", "false"],
    ["stable entry", "false", "false", "unset", "false"],
    ["explicit candidate opt-in", "false", "true", "true", "true"],
  ])("keeps native and renderer connector selection aligned for %s", async (_label, daily, models, override, expected) => {
    const runner = await readFile(runnerPath, "utf8");
    const start = runner.indexOf('market_connectors_default="false"');
    const end = runner.indexOf('  [[ "$chat_models_enabled" == "true" && "$stable_api_only" == "false" ]]', start);
    const selectionEnd = runner.lastIndexOf('if [[ "$market_connectors_enabled" == "true" ]]; then', end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // Execute only the launcher's pure profile selection, without builds,
    // services, credentials, database access or changes to the running app.
    const { stdout } = await exec("/bin/bash", ["-c", `
      set -euo pipefail
      fail() { exit 1; }
      scheduled_daily="$1"
      chat_models_enabled="$2"
      image_generation_enabled="true"
      workflow_requested="false"
      experts_requested=""
      reopen_app="false"
      unset YIJIE_MARKET_CONNECTORS_ENABLED
      export VITE_YIJIE_MARKET_CONNECTORS_ENABLED=stale
      if [[ "$3" != "unset" ]]; then export YIJIE_MARKET_CONNECTORS_ENABLED="$3"; fi
      ${runner.slice(start, selectionEnd)}
      printf '%s:%s:%s' "$YIJIE_MARKET_CONNECTORS_ENABLED" "$VITE_YIJIE_MARKET_CONNECTORS_ENABLED" "$image_generation_enabled"
    `, "connector-profile", daily, models, override]);
    expect(stdout).toBe(`${expected}:${expected}:${expected === "true" ? "false" : "true"}`);
  });

  it.each([
    ["daily", "true", "true", "true", "false", "", "true"],
    ["explicit off", "true", "true", "true", "false", "false", "false"],
    ["market off", "true", "true", "false", "false", "", "false"],
    ["models off", "true", "false", "false", "false", "", "false"],
    ["stable or isolated scheduled", "false", "false", "false", "false", "", "false"],
    ["daily workflow and experts", "true", "true", "true", "true", "", "true"],
    ["explicit isolated experts", "false", "true", "true", "false", "true", "true"],
  ])("selects experts only for the supported deployment combination: %s", async (_label, daily, models, market, workflow, override, expected) => {
    const runner = await readFile(runnerPath, "utf8");
    const start = runner.indexOf('experts_default="false"');
    const end = runner.indexOf("# Host market admission", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const { stdout } = await exec("/bin/bash", ["-c", `
      set -euo pipefail
      fail() { exit 1; }
      scheduled_daily="$1"; chat_models_enabled="$2"; market_connectors_enabled="$3"
      workflow_requested="$4"; experts_requested="$5"; reopen_app="false"
      ${runner.slice(start, end)}
      printf '%s' "$experts_requested"
    `, "expert-default", daily, models, market, workflow, override]);
    expect(stdout).toBe(expected);
  });

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

  it("maps the exact stable argument to image=false while retaining the legacy image profile", async () => {
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
      'codex_runtime_root="${YIJIE_DEMO_FAST_RUNTIME_ROOT:-$host_root/.local/runtime-artifacts/feat-136-b2b20e2fc4a0}"',
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

  it("keeps exact retained artifact checks for the stable and explicit rollback entries", async () => {
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
    expect(runner).toContain('launch_command=(pnpm exec tauri dev --config src-tauri/tauri.demo-fast.conf.json "${experts_tauri_config[@]+"${experts_tauri_config[@]}"}")');
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

  it("keeps the expert candidate app, Host and Runtime state outside daily roots", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const config = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri/tauri.experts-local.conf.json"), "utf8"));
    const daily = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"));
    expect(config.identifier).not.toBe(daily.identifier);
    expect(config.productName).toBe("易界 AI FEAT-158");
    expect(runner).toContain('runtime_root="$desktop_root/.local/$expert_runtime_directory"');
    expect(runner).toContain('host_binary="$expert_host_binary"');
    expect(runner).toContain('host_port="$expert_host_port"');
    expect(runner).toContain("bundle/macos/$expert_product_name.app/Contents/MacOS/yijie-desktop");
    expect(runner).toContain('experts_requested="${YIJIE_EXPERTS_ENABLED:-}"');
  });

  it.each([
    ["default", "false", [], "false:daily:false:false"],
    ["expert daily packaged", "true", ["--packaged"], "true:daily:false:false"],
    ["isolated original candidate", "true", ["--packaged", "--experts-local"], "true:default:false:false"],
    ["content development", "true", ["--experts-content-v011"], "false:content-v011:false:false"],
    ["content packaged", "true", ["--packaged", "--experts-content-v011"], "true:content-v011:false:false"],
    ["new content packaged", "true", ["--packaged", "--experts-content-v012"], "true:content-v012:false:false"],
    ["repaired content packaged", "true", ["--packaged", "--experts-content-v013"], "true:content-v013:false:false"],
    ["repaired content reopen", "true", ["--packaged", "--experts-content-v013", "--reopen"], "true:content-v013:true:false"],
    ["same build reopen", "true", ["--packaged", "--experts-content-v012", "--reopen"], "true:content-v012:true:false"],
    ["daily expert reopen", "true", ["--packaged", "--reopen"], "true:daily:true:false"],
    ["daily default reopen", "", ["--packaged", "--reopen"], "true:daily:true:false"],
  ])("selects only explicit content isolation for %s", async (_label, experts, args, expected) => {
    const runner = await readFile(runnerPath, "utf8");
    const start = runner.indexOf('image_generation_enabled="true"');
    const end = runner.indexOf("# The normal local entry", start);
    const { stdout } = await exec("/bin/bash", ["-c", `
      set -euo pipefail
      fail() { exit 1; }
      experts_requested="$1"; shift
      ${runner.slice(start, end)}
      printf '%s:%s:%s:%s' "$packaged_app" "$expert_profile" "$reopen_app" "$stable_api_only"
    `, "expert-arguments", experts, ...args]);
    expect(stdout).toBe(expected);
  });

  it("rejects content isolation without expert opt-in before any preflight", async () => {
    await expect(exec(runnerPath, ["--packaged", "--experts-content-v011"], {
      cwd: repositoryRoot,
      env: { ...process.env, YIJIE_EXPERTS_ENABLED: "false" },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("content isolation requires explicit YIJIE_EXPERTS_ENABLED=true") });
  });

  it.each([
    ["true", ["--reopen"]],
    ["false", ["--packaged", "--reopen"]],
  ])("requires both explicit expert and packaged selection for reopen (%s)", async (enabled, args) => {
    await expect(exec(runnerPath, args, {
      cwd: repositoryRoot,
      env: { ...process.env, YIJIE_EXPERTS_ENABLED: enabled },
    })).rejects.toMatchObject({ stderr: expect.stringContaining("--reopen requires an enabled packaged expert profile") });
  });

  it.each([
    ["daily", "demo-fast", "18081", "tauri.experts-daily.conf.json"],
    ["default", "feat158-candidate", "18158", "tauri.experts-local.conf.json"],
    ["content-v011", "feat158-content-v011-candidate", "18159", "tauri.experts-content-v011.conf.json"],
    ["content-v012", "feat158-content-v012-candidate", "18160", "tauri.experts-content-v012.conf.json"],
    ["content-v013", "feat158-content-v013-candidate", "18161", "tauri.experts-content-v013.conf.json"],
  ])("uses reviewed roots with profile=%s and keeps current resource authority", async (content, directory, port, overlay) => {
    const runner = await readFile(runnerPath, "utf8");
    const start = runner.indexOf('  expert_profile_data=');
    const end = runner.indexOf('\nfi\n\n# Detached', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const { stdout } = await exec("/bin/bash", ["-c", `
      set -euo pipefail
      desktop_root="$1"
      expert_profile="$2"
      fail() { exit 1; }
      unset YIJIE_DEMO_FAST_HOST_PORT
      ${runner.slice(start, end)}
      printf '%s\n' "$runtime_root" "$host_home" "$codex_home" "$host_binary" "$host_port" "\${experts_tauri_config[*]}"
    `, "expert-roots", repositoryRoot, content]);
    const base = `${repositoryRoot}/.local/${directory}`;
    const host = content === "daily" ? path.resolve(repositoryRoot, "../yijie-agent-host/.local/bin/yijie-agent-host") : `${base}/bin/yijie-agent-host`;
    expect(stdout.trim().split("\n")).toEqual([base, `${base}/host-home`, `${base}/codex-home`, host, port, `--config src-tauri/${overlay}`]);
    const config = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri", overlay), "utf8"));
    const previous = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri/tauri.experts-local.conf.json"), "utf8"));
    expect(config.bundle.resources).toEqual(previous.bundle.resources);
    if (content === "daily") {
      const daily = JSON.parse(await readFile(path.join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"));
      expect(config.identifier).toBe(daily.identifier);
      expect(config.productName).toBe(daily.productName);
    } else if (content !== "default") {
      expect(config.identifier).toBe(`com.yijie.ai.feat158-${content}`);
      expect(config.identifier).not.toBe(previous.identifier);
      expect(config.productName).not.toBe(previous.productName);
    }
    expect(runner).toContain("bundle/macos/$expert_product_name.app/Contents/MacOS/yijie-desktop");
  });

  it("copies the current expert producer through the same checked resource installer", async () => {
    const source = await readFile(path.join(repositoryRoot, "scripts/sync-desktop-expert-resources.mjs"), "utf8");
    expect(source).toContain('const producerOutput = "dist/skills-experts-thirteen-overall-v013"');
    expect(source).toContain('verifyRetainedExpertResources(manifest,');
    expect(source).toContain('"contracts/experts-assets.candidate.json"');
    expect(source).toContain('"--output", producerOutput');
    expect(source).toContain('path.join(skillsRoot, producerOutput, "authority.json")');
    expect(source).toContain('else await installOutput(outputRoot, files)');
    expect(source).not.toContain('experts-assets-content-v011');
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
    expect(runner).toContain('provider_environment=(YIJIE_MODEL_PROVIDER=minimax "YIJIE_MINIMAX_API_KEY_FILE=$provider_key_file")');
    expect(envBoundary).toContain('"${provider_environment[@]+"${provider_environment[@]}"}"');
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

// The user-retired FEAT-144 entry cannot collect or export credentials.
it("retires Sorftime startup input while retaining environment scrubbing", async () => {
  const entry = await readFile(runnerPath, "utf8");
  expect(entry).toContain("unset YIJIE_FEAT144_SORFTIME_ACCOUNT_SK");
  expect(entry).not.toContain("sorftime_requested=");
  expect(entry).not.toContain("display dialog");
  expect(entry).not.toContain("export YIJIE_FEAT144");
});
