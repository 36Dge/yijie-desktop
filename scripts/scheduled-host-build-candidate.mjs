import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
const sha = value => createHash("sha256").update(value).digest("hex");
const inputs = ["cmd", "internal", "api", "go.mod", "go.sum"];
export function isScheduledHostCandidate(env = process.env) {
  return env.YIJIE_FEAT155_SCHEDULED_CANDIDATE === "true" && env.YIJIE_ENV === "local" && env.YIJIE_LOCAL_PROFILE === "demo_fast";
}
// A committed local source snapshot, never an arbitrary dirty-tree exception
// or release qualification. FEAT-152 wire pins are checked separately.
export async function verifyScheduledHostCandidate(desktopRoot, contractsRoot, hostRoot) {
  const lock = JSON.parse(await readFile(path.join(desktopRoot, "contracts/scheduled-host-build.candidate.json"), "utf8"));
  const [{stdout: head}, {stdout: origin}, {stdout: names}] = await Promise.all([
    exec("git", ["-C", hostRoot, "rev-parse", "HEAD"]),
    exec("git", ["-C", hostRoot, "remote", "get-url", "origin"]),
    exec("git", ["-C", hostRoot, "ls-files", "-co", "--exclude-standard", "--", ...inputs]),
  ]);
  if (lock.schema_version !== 1 || lock.release !== false || lock.feature !== "FEAT-155" || lock.mode !== "local_candidate" || !/^[a-f0-9]{40}$/.test(lock.full_commit ?? "") || lock.full_commit !== head.trim() || lock.repository !== origin.trim()) throw Error("Scheduled Host candidate identity differs");
  const files = [...new Set(names.trim().split("\n"))].sort();
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(lock.sources).sort())) throw Error("Scheduled Host build input set differs");
  for (const file of files) {
    if (path.isAbsolute(file) || file.split("/").some(part => !part || part === "." || part === "..")) throw Error("Invalid scheduled Host source path");
    const target = path.join(hostRoot, file);
    if (!(await lstat(target)).isFile() || sha(await readFile(target)) !== lock.sources[file]) throw Error(`Scheduled Host build source differs: ${file}`);
    const { stdout: committed } = await exec("git", ["-C", hostRoot, "show", `${lock.full_commit}:${file}`], {encoding: "buffer", maxBuffer: 16 * 1024 * 1024});
    if (sha(committed) !== lock.sources[file]) throw Error(`Scheduled Host committed source differs: ${file}`);
  }
  for (const family of ["scheduled-plan", "scheduled-execution", "scheduled-draft", "scheduled-task-recovery", "runtime-input-only", "native-turn-timing"]) {
    const consumer = JSON.parse(await readFile(path.join(desktopRoot, `contracts/${family}.candidate.json`), "utf8"));
    if (consumer.source_commit !== lock.contracts_commit) throw Error(`Scheduled Contracts commit differs: ${family}`);
    if (["scheduled-draft", "runtime-input-only", "native-turn-timing"].includes(family)) await exec(process.execPath, [`scripts/generate-${family}.mjs`, "--check"], {cwd: contractsRoot});
    await exec(process.execPath, [`scripts/sync-${family}.mjs`, "--check"], {cwd: contractsRoot});
  }
  return lock.sources;
}

// Explicit local freeze after the Host commit exists. Never derive the source
// digests from an uncommitted working tree or rewrite the historical base field.
export async function freezeScheduledHostCandidate(desktopRoot, contractsRoot, hostRoot, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Full Host commit required");
  const target = path.join(desktopRoot, "contracts/scheduled-host-build.candidate.json");
  const lock = JSON.parse(await readFile(target, "utf8"));
  const { stdout: names } = await exec("git", ["-C", hostRoot, "ls-tree", "-r", "--name-only", commit, "--", ...inputs]);
  const sources = {};
  for (const file of names.trim().split("\n").sort()) {
    const { stdout } = await exec("git", ["-C", hostRoot, "show", `${commit}:${file}`], {encoding: "buffer", maxBuffer: 16 * 1024 * 1024});
    sources[file] = sha(stdout);
  }
  const { stdout: provenance } = await exec("git", ["-C", hostRoot, "show", `${commit}:api/scheduled-task-recovery.candidate.json`]);
  const contractsCommit = JSON.parse(provenance).source_commit;
  if (!/^[a-f0-9]{40}$/.test(contractsCommit ?? "")) throw Error("Committed Contracts source required");
  await writeFile(target, JSON.stringify({...lock, full_commit: commit, contracts_commit: contractsCommit, sources}, null, 2) + "\n");
  await verifyScheduledHostCandidate(desktopRoot, contractsRoot, hostRoot);
}
