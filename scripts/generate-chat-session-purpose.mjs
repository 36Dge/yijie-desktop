import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(path.join(root, "src-tauri/schemas/chat-ipc-v1.schema.json"), "utf8"));
const view = source.$defs.sessionPurpose;
if (JSON.stringify(view.required) !== JSON.stringify(["sessionId", "purpose"]) ||
    view.additionalProperties !== false || Object.keys(view.properties).length !== 2 ||
    view.properties.sessionId.$ref !== "#/$defs/uuid" || view.properties.purpose.type !== "string") {
  throw Error("Session purpose leaf shape changed; review generation before consuming it");
}
const variants = view.properties.purpose.enum;
const pascal = value => value.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join("");
const rust = `// Generated from chat-ipc-v1.schema.json sessionPurpose. DO NOT EDIT.
use serde::{Serialize, Deserialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionPurpose {
${variants.map(value => `#[serde(rename=${JSON.stringify(value)})] ${pascal(value)},`).join("\n")}
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SessionPurposeView { pub session_id: uuid::Uuid, pub purpose: SessionPurpose }
`;
const formatted = spawnSync("rustfmt", ["--edition", "2021"], { input: rust, encoding: "utf8" });
if (formatted.status !== 0) throw Error(formatted.stderr);
const ts = `// Generated from chat-ipc-v1.schema.json sessionPurpose. DO NOT EDIT.
export const sessionPurposes = ${JSON.stringify(variants)} as const;
export type SessionPurpose = typeof sessionPurposes[number];
export interface SessionPurposeView { readonly sessionId: string; readonly purpose: SessionPurpose }
export function isSessionPurposeView(value: unknown): value is SessionPurposeView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).length === 2 && typeof object.sessionId === "string" &&
    new RegExp(${JSON.stringify(source.$defs.uuid.pattern)}).test(object.sessionId) &&
    sessionPurposes.some(purpose => purpose === object.purpose);
}
`;
for (const [file, content] of Object.entries({
  "src-tauri/src/chat/session_purpose_generated.rs": formatted.stdout,
  "src/domain/chat-session-purpose.generated.ts": ts,
})) {
  const target = path.join(root, file);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== content) throw Error(`Session purpose drift: ${file}`);
  } else writeFileSync(target, content);
}
console.log("Private session purpose source generation verified.");
