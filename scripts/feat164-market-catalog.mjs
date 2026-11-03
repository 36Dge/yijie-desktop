import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMarketCatalog } from "./market-catalog-source.mjs";

// Preserve the qualified profile and its exact source requirement.
assert(process.argv.slice(2).every(arg => arg === "--check"));
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
syncMarketCatalog({ desktopRoot, connectorsRoot: path.resolve(desktopRoot, "../yijie-connectors"), check,
  immutableCommit: "203544a9e371916db4928f9771e362f282c5be65" });
console.log(`61-entry non-secret Connectors catalog ${check ? "verified" : "synchronized"}; no provider activation.`);
