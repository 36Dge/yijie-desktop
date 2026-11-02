import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(path.join(root, "src-tauri/schemas/chat-turn-model-v1.schema.json"), "utf8");
const source = JSON.parse(raw);
const header = `// Generated from chat-turn-model-v1.schema.json. Do not edit.\n// SHA256 ${createHash("sha256").update(raw).digest("hex")}\n`;
function tsType(value) {
  if (value.anyOf) return value.anyOf.map(tsType).join(" | ");
  if (value.type === "string") return "string";
  if (value.type === "null") return "null";
  throw Error("Review new turn-model leaf before generation");
}
function rustType(value) {
  if (value.type === "string" && value.format === "uuid") return "uuid::Uuid";
  if (value.anyOf?.length === 2 && value.anyOf[0].type === "string" && value.anyOf[1].type === "null") return "Option<String>";
  throw Error("Review new turn-model Rust leaf before generation");
}
const ts = header + Object.entries(source.$defs).map(([name, def]) => `export interface ${name} {\n${Object.entries(def.properties).map(([key, value]) => `  readonly ${key}: ${tsType(value)};`).join("\n")}\n}`).join("\n") + "\n";
const rust = header + Object.entries(source.$defs).map(([name, def]) => {
  if (def.additionalProperties !== false || def.required.length !== Object.keys(def.properties).length) throw Error("Turn model objects must remain closed and required");
  return `#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]\n#[serde(rename_all="camelCase", deny_unknown_fields)]\npub struct ${name} {\n${Object.entries(def.properties).map(([key, value]) => `pub ${key.replace(/[A-Z]/g, c => "_" + c.toLowerCase())}: ${rustType(value)},`).join("\n")}\n}`;
}).join("\n");
const formatted = spawnSync("rustfmt", ["--edition", "2021"], {input: rust, encoding: "utf8"});
if (formatted.status !== 0) throw Error(formatted.stderr);
const require = createRequire(path.join(root, "package.json"));
const Ajv = require("ajv/dist/2020").default;
const standalone = require("ajv/dist/standalone").default;
const ajv = new Ajv({code: {source: true, esm: true}, formats: {uuid: true}});
ajv.addSchema(source.$defs.TurnModelView, "turn-model");
const outputs = {
  "src/domain/chat-turn-model.generated.ts": ts,
  "src/api/generated/chat-turn-model-validator.gen.js": header + 'import ucs2lengthModule from "ajv/dist/runtime/ucs2length.js";\nconst ucs2length = typeof ucs2lengthModule === "function" ? ucs2lengthModule : ucs2lengthModule.default;\n' +
    standalone(ajv, {validateTurnModelView: "turn-model"}).replaceAll('require("ajv/dist/runtime/ucs2length").default', "ucs2length"),
  "src/api/generated/chat-turn-model-validator.gen.d.ts": header + 'import type { TurnModelView } from "../../domain/chat-turn-model.generated";\nexport declare function validateTurnModelView(value: unknown): value is TurnModelView;\n',
  "src-tauri/src/chat/turn_model_generated.rs": formatted.stdout,
};
for (const [name, content] of Object.entries(outputs)) {
  const target = path.join(root, name);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== content) throw Error(`Turn model generation drift: ${name}`);
  } else writeFileSync(target, content);
}
