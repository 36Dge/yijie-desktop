import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidate = process.argv.includes("--candidate");
assert(!(candidate && process.argv.includes("--require-committed")), "Candidate source cannot activate MCP");
execFileSync(process.execPath, ["scripts/sync-native-mcp.mjs", "--check", ...(candidate ? ["--candidate"] : ["--require-committed"])], {cwd:path.join(root,"../yijie-contracts"),stdio:"inherit"});
execFileSync(process.execPath,["scripts/generate-native-conversation.mjs","--check"],{cwd:root,stdio:"inherit"});
const view=readFileSync(path.join(root,"src/domain/conversation-view.ts"),"utf8");
assert.doesNotMatch(view.slice(view.indexOf("function nativeExecution"),view.indexOf("export function composeConversationView")),/sourceOccurredAt|startedSource|sourceSequence|resultSummary:\s*safeText/);
assert.match(readFileSync(path.join(root,"src-tauri/src/chat/native_conversation_storage.rs"),"utf8"),/record_diagnostics/);
console.log("FEAT-144 native sources and single display adapter checked; candidate checks do not authorize activation.");
