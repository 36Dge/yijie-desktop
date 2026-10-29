import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalogEntry } from "../src/api/generated/market-connectors-validator.gen.js";
// Isolated FEAT-164 provenance for the existing source-owned catalog.
const feat164=true;
assert(process.argv.slice(2).every(arg=>arg==="--check"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(root, "../yijie-connectors");
const source = "catalog/market-catalog.v1.json";
const bytes = readFileSync(path.join(sourceRoot, source));
const feat164Commit="ab1f8328ff50dab256b23f51d49157278421fd35";
if(feat164){
 assert.equal(execFileSync("git",["-C",sourceRoot,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),feat164Commit);
 assert.deepEqual(bytes,execFileSync("git",["-C",sourceRoot,"show",`${feat164Commit}:${source}`]));
}
const catalog = JSON.parse(bytes);
assert.equal(catalog.catalogRevision, 11);
assert.equal(catalog.catalog.length, 61);
assert.equal(new Set(catalog.catalog.map(item => item.serviceId)).size, 61);
for (const entry of catalog.catalog) {
  assert.ok(validateCatalogEntry(entry), "Invalid catalog entry");
  assert.equal(entry.serviceId, entry.serverName);
  assert.equal(entry.serviceId, entry.iconAssetId);
  assert.equal(entry.availability === "available", false, "Unqualified service cannot be activated");
  assert.ok(entry.blockerCodes.length > 0);
}
const output = "contracts/market-catalog.json";
const manifest = JSON.stringify({
  schema_version: 1, mode: feat164 ? "immutable_local_candidate" : "local_worktree_candidate", release: false,
  ...(feat164 ? {feature:"FEAT-164",source_commit:feat164Commit} : {}),
  authority: "yijie-connectors/" + source,
  base_commit: execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source_sha256: createHash("sha256").update(bytes).digest("hex"),
  generated: output,
}, null, 2) + "\n";
for (const [name, data] of [[output, bytes], [feat164 ? "contracts/market-catalog-feat164.candidate.json" : "contracts/market-catalog.candidate.json", Buffer.from(manifest)]]) {
  const file = path.join(root, name);
  if (process.argv.includes("--check")) assert.deepEqual(readFileSync(file), data, name);
  else writeFileSync(file, data);
}
console.log("61-entry non-secret Connectors catalog " + (process.argv.includes("--check") ? "verified" : "synchronized") + "; no provider activation.");
