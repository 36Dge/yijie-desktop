import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMarketCatalog } from "./market-catalog-source.mjs";
import { developmentCatalogSource } from "./development-catalog-source.mjs";

// Preserve the qualified profile and its exact source requirement.
assert(process.argv.slice(2).every(arg => arg === "--check"));
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const immutableCommit = "2d2351b49bc7ca7bfe53e6dfe090c2bc0d949d65";
const sibling = path.resolve(desktopRoot, "../yijie-connectors");
const connectorsRoot = process.env.YIJIE_DEVELOPMENT_CLIENT === "true"
  ? developmentCatalogSource(desktopRoot, sibling, immutableCommit)
  : sibling;
syncMarketCatalog({ desktopRoot, connectorsRoot, check, immutableCommit });
console.log(`61-entry non-secret Connectors catalog ${check ? "verified" : "synchronized"}; no provider activation.`);
