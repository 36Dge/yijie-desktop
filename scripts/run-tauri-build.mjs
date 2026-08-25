import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDesktopSkillReleaseBoundary } from "./check-desktop-skill-release-boundary.mjs";

const arguments_ = process.argv.slice(2);

function hasConfigOverride(arguments_) {
  return arguments_.some(
    (argument) =>
      argument === "--config" ||
      argument.startsWith("--config=") ||
      (argument.startsWith("-c") && !argument.startsWith("--")),
  );
}

export async function runDefaultTauriBuild(arguments_ = [], environment = process.env) {
  if (hasConfigOverride(arguments_) || environment.TAURI_CONFIG) {
    throw new Error(
      "default Desktop build rejects CLI and TAURI_CONFIG overrides; local Skill resources are dev-only",
    );
  }
  await checkDesktopSkillReleaseBoundary();
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tauri", "build", ...arguments_], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      env: environment,
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
