import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Desktop may retain unrelated local edits. Its permission dependencies must
// match the independently committed Contracts/Host pins, even without a meter.
export function isLocalPermissionCandidate(env = process.env) {
  return env.YIJIE_ENV === "local" && env.YIJIE_LOCAL_PROFILE === "demo_fast" &&
    env.YIJIE_RUNTIME_PERMISSIONS_ENABLED === "true" &&
    env.VITE_YIJIE_RUNTIME_PERMISSIONS_ENABLED === "true" &&
    (!env.YIJIE_PERMISSION_VERIFICATION_BASE_URL ||
      env.YIJIE_PERMISSION_VERIFICATION_BASE_URL === "http://127.0.0.1:18083/v1");
}

export function validatePermissionPins(lock, hostLock) {
  if (lock?.schema_version !== 1 || lock.feature !== "FEAT-152" ||
      lock.contract_family_version !== "0.1.0" ||
      hostLock?.schema_version !== 1 || hostLock.feature !== "FEAT-152" ||
      hostLock.contract_family_version !== lock.contract_family_version ||
      lock.contracts?.repository !== "https://github.com/36Dge/yijie-contracts.git" ||
      lock.agent_host?.repository !== "https://github.com/36Dge/yijie-agent-host.git" ||
      !/^[a-f0-9]{40}$/.test(lock.contracts?.full_commit ?? "") ||
      !/^[a-f0-9]{40}$/.test(lock.agent_host?.full_commit ?? "") ||
      hostLock.contracts?.full_commit !== lock.contracts.full_commit ||
      JSON.stringify(hostLock.contracts.sources) !== JSON.stringify(lock.contracts.sources) ||
      !lock.agent_host.sources?.["api/runtime-permissions.lock.json"] ||
      !lock.agent_host.sources?.["internal/contracts/runtimepermissions/types.gen.go"]) {
    throw new Error("FEAT-152 Contracts/Host pins are incomplete or inconsistent");
  }
}

async function verifyPinnedFiles(root, pin, label) {
  const { stdout: resolved } = await exec("git", ["-C", root, "rev-parse", "--verify", `${pin.full_commit}^{commit}`]);
  if (resolved.trim() !== pin.full_commit || !Object.keys(pin.sources ?? {}).length) {
    throw new Error(`${label} committed source is unavailable`);
  }
  for (const [source, digest] of Object.entries(pin.sources)) {
    if (!source || path.isAbsolute(source) || source.includes("\\") ||
        source.split("/").some((part) => !part || part === "." || part === "..") ||
        !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`${label} source pin is invalid`);
    }
    const [{ stdout: committed }, working] = await Promise.all([
      exec("git", ["-C", root, "show", `${pin.full_commit}:${source}`], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }),
      readFile(path.join(root, source)),
    ]);
    if (createHash("sha256").update(committed).digest("hex") !== digest || !committed.equals(working)) {
      throw new Error(`${label} source differs from its committed pin: ${source}`);
    }
  }
}

export async function verifyLocalPermissionCandidate(desktopRoot, contractsRoot, hostRoot) {
  const [lock, hostLock] = await Promise.all([
    readFile(path.join(desktopRoot, "contracts/runtime-permissions.lock.json"), "utf8").then(JSON.parse),
    readFile(path.join(hostRoot, "api/runtime-permissions.lock.json"), "utf8").then(JSON.parse),
  ]);
  validatePermissionPins(lock, hostLock);
  await Promise.all([
    verifyPinnedFiles(contractsRoot, lock.contracts, "FEAT-152 Contracts"),
    verifyPinnedFiles(hostRoot, lock.agent_host, "FEAT-152 Host"),
  ]);
  // The launcher builds the Host from this checkout. Include all its build
  // sources and embedded resources, rather than validating only the DTO files.
  const hostPaths = ["cmd", "internal", "go.mod", "go.sum"];
  try {
    await exec("git", ["-C", hostRoot, "diff", "--quiet", lock.agent_host.full_commit, "--", ...hostPaths]);
    const { stdout } = await exec("git", ["-C", hostRoot, "ls-files", "--others", "--exclude-standard", "--", ...hostPaths]);
    if (stdout.trim()) throw new Error("Uncommitted Host build input");
  } catch {
    throw new Error("FEAT-152 Host build inputs differ from the pinned commit");
  }
  const pairs = [
    [path.join(contractsRoot, "sdks/go/openapi/runtime-permissions/source.bundle.yaml"), path.join(hostRoot, "api/openapi/runtime-permissions.yaml")],
    [path.join(contractsRoot, "sdks/typescript/src/openapi/runtime-permissions.gen.ts"), path.join(desktopRoot, "src/api/generated/runtime-permissions.gen.ts")],
  ];
  for (const [source, consumer] of pairs) {
    const [expected, actual] = await Promise.all([readFile(source), readFile(consumer)]);
    if (!expected.equals(actual)) throw new Error(`Local permission contract differs: ${consumer}`);
  }
  const [{ stdout }, hostTypes] = await Promise.all([
    exec("go", ["tool", "oapi-codegen", "-generate", "types", "-package", "runtimepermissions", "api/openapi/runtime-permissions.yaml"], { cwd: hostRoot }),
    readFile(path.join(hostRoot, "internal/contracts/runtimepermissions/types.gen.go"), "utf8"),
  ]);
  if (stdout !== hostTypes) throw new Error("Local permission Host types differ from the contract");
  await exec(process.execPath, ["scripts/sync-runtime-permissions.mjs", "--check"], { cwd: desktopRoot });
}
