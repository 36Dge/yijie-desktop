// Keep the existing test engines, with explicit routing and the user-approved
// non-destructive validation boundary. Exclusions are recorded, never PASS.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const safety = JSON.parse(readFileSync(path.join(root, "scripts/test-safety-exclusions.json"), "utf8"));
const options = process.argv.slice(2);
if (options.some(option => !["--native", "--production-hardened"].includes(option))) {
  throw new Error("Use run-tests.mjs [--native] [--production-hardened]");
}
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
};
if (options.includes("--native")) {
  console.log(`Native validation: ${safety.native.excludeTests.length} explicit safety filters; see scripts/test-safety-exclusions.json.`);
  const filters = safety.native.excludeTests.flatMap(test => ["--skip", test.name]);
  const base = ["test", "--manifest-path", "src-tauri/Cargo.toml", "--no-fail-fast"];
  const ordinary = run("cargo", [...base, "--", ...filters]);
  // The fixed daily client uses this existing feature; qualify its migrations
  // and provider assembly as well as the ordinary rollback reader.
  const current = run("cargo", [...base, "--features", "kimi-k31-pro-candidate", "--", ...filters]);
  process.exitCode = ordinary || current;
} else {
  const nodeTests = readdirSync(path.join(root, "scripts"), { recursive: true })
    .filter(name => name.endsWith(".test.mjs"))
    .map(name => `scripts/${name}`)
    .filter(file => /from\s+["']node:test["']/.test(readFileSync(path.join(root, file), "utf8")))
    .sort();
  const excluded = [...safety.frontend.existingProjectExcludeFiles,
    ...safety.frontend.excludeFiles.map(entry => entry.path), ...nodeTests]
    .filter(file => !options.includes("--production-hardened") || file !== "scripts/check-feat128-s10d-h.test.mjs");
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `^(?!.*(?:${safety.frontend.excludeNames.map(entry => escape(entry.name)).join("|")})).*$`;
  console.log(`Frontend validation: ${safety.frontend.excludeFiles.length} safety-excluded files and ${safety.frontend.excludeNames.length} name filters; ${nodeTests.length} files routed to node:test.`);
  const vitest = run("pnpm", ["exec", "vitest", "run", "--maxWorkers=4",
    ...excluded.flatMap(file => ["--exclude", file]), "--testNamePattern", pattern]);
  const node = nodeTests.length ? run(process.execPath, ["--test", "--test-name-pattern", pattern, ...nodeTests]) : 0;
  process.exitCode = vitest || node;
}
