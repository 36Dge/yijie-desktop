import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contracts = process.env.YIJIE_DESKTOP_CONTRACTS_DIR || path.resolve(root, "../yijie-contracts");
const commit = "4d3f967938dde1c86ca34003a0a5628717f96262";
const content = execFileSync("git", ["-C", contracts, "show", `${commit}:docs/retirements/FEAT-137.json`]);
assert.equal(createHash("sha256").update(content).digest("hex"),
  "67d7dfe8d539668a366ed744d92483d39597208259fe929d32d6d811c79ffbb8");
const authority = JSON.parse(content.toString("utf8"));
assert.equal(authority.status, "terminated");
assert.equal(authority.permanent, true);
assert.equal(authority.acceptance_passed, false);
assert.equal(authority.activation.approval_policy, "never");
const runner = readFileSync(path.join(root, "scripts/run-local-demo-fast.sh"), "utf8");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
assert.ok(runner.includes(`runtime-artifacts/${authority.runtime.artifact_directory}`));
assert.ok(runner.includes(`runtime_binary_sha256="${authority.runtime.binary_sha256}"`));
assert.ok(runner.includes(`runtime_manifest_sha256="${authority.runtime.manifest_sha256}"`));
assert.ok(!runner.includes("check-agent-host-v6-contract.mjs"));
for (const source of [runner, ...Object.values(scripts)]) {
  assert.doesNotMatch(source, /(?:YIJIE_FEAT137_COMMAND_APPROVAL_ENABLED|VITE_YIJIE_FEAT137_APPROVAL_ENABLED)=true/);
}
console.log(`FEAT-137 permanent retirement authority verified: ${commit}; acceptance remains NOT PASSED`);
