import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src-tauri/schemas/chat-document-preview-v1.schema.json"), "utf8");
const schema = JSON.parse(source);
function type(node) {
  if (node.$ref) return node.$ref.split("/").at(-1);
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map(value => JSON.stringify(value)).join(" | ");
  if (node.oneOf) return node.oneOf.map(type).join(" | ");
  if (node.type === "array") return `readonly (${type(node.items)})[]`;
  if (node.type === "object") return `Readonly<{ ${Object.entries(node.properties).map(([key, value]) => `${key}${node.required?.includes(key) ? "" : "?"}: ${type(value)}`).join("; ")} }>`;
  return ({ integer: "number", number: "number", string: "string", boolean: "boolean", null: "null" })[node.type] ?? "never";
}
const output = `// Generated from chat-document-preview-v1.schema.json; do not edit.\n// SHA256 ${crypto.createHash("sha256").update(source).digest("hex")}\n\n${Object.entries(schema.definitions).map(([name, value]) => `export type ${name} = ${type(value)};`).join("\n")}\n`;
const target = path.join(root, "src/domain/document-preview.generated.ts");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) throw new Error("Document preview generated types are stale");
} else fs.writeFileSync(target, output);
