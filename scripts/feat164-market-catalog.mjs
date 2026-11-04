import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMarketCatalog } from "./market-catalog-source.mjs";

// Preserve the qualified profile and its exact source requirement.
assert(process.argv.slice(2).every(arg => arg === "--check"));
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
syncMarketCatalog({ desktopRoot, connectorsRoot: path.resolve(desktopRoot, "../yijie-connectors"), check,
  immutableCommit: "2e43a72ca39c36dd9b1fc60250e190b38a821f26" });
console.log(`61-entry non-secret Connectors catalog ${check ? "verified" : "synchronized"}; no provider activation.`);
