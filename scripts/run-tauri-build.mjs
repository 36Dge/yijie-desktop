import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDesktopSkillReleaseBoundary } from "./check-desktop-skill-release-boundary.mjs";
import { syncDesktopSkillResources } from "./sync-desktop-skill-resources.mjs";

const arguments_ = process.argv.slice(2);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasConfigOverride(arguments_) {
  return arguments_.some(
    (argument) =>
      argument === "--config" ||
      argument.startsWith("--config=") ||
      (argument.startsWith("-c") && !argument.startsWith("--")),
  );
}

export function releaseBuildEnvironment(environment = process.env) {
  return {
    ...environment,
    VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED: "true",
    VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED: "true",
  };
}

export async function runDefaultTauriBuild(arguments_ = [], environment = process.env) {
  if (hasConfigOverride(arguments_) || environment.TAURI_CONFIG) {
    throw new Error(
      "default Desktop build rejects CLI and TAURI_CONFIG overrides; the reviewed desktop-release overlay is mandatory",
    );
  }
  const resourceRoots = {
    channel: "desktop-release",
    skillsRoot: path.resolve(repositoryRoot, environment.YIJIE_DESKTOP_SKILLS_DIR ?? "../yijie-skills"),
    contractsRoot: path.resolve(repositoryRoot, environment.YIJIE_DESKTOP_CONTRACTS_DIR ?? "../yijie-contracts"),
    agentHostRoot: path.resolve(repositoryRoot, environment.YIJIE_DESKTOP_AGENT_HOST_DIR ?? "../yijie-agent-host"),
  };
  await syncDesktopSkillResources({
    ...resourceRoots,
    packageProducer: true,
  });
  await checkDesktopSkillReleaseBoundary(resourceRoots);
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", [
      "exec",
      "tauri",
      "build",
      "--config",
      "src-tauri/tauri.desktop-release.conf.json",
      ...arguments_,
    ], {
      cwd: repositoryRoot,
      env: releaseBuildEnvironment(environment),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Tauri build failed (${signal ?? `exit ${code}`})`));
    });
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  runDefaultTauriBuild(arguments_).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Tauri build failed"}\n`);
    process.exitCode = 1;
  });
}
