import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = file => readFileSync(path.join(root, file), "utf8");
for (const removed of ["src/domain/conversation-state.ts", "src/authorization/chat-timeline-ui-config.ts"]) {
  assert.equal(existsSync(path.join(root, removed)), false, `Retired engine returned: ${removed}`);
}
for (const file of ["src/stores/chat.store.ts", "src/api/chat-conversation-adapter.ts", "src-tauri/src/chat/application.rs", "src-tauri/src/chat/feat134.rs", "src-tauri/src/chat/feat136.rs", "src-tauri/src/chat/native_conversation.rs", "src-tauri/src/chat/native_conversation_storage.rs"]) {
  assert.doesNotMatch(source(file), /\b(?:TurnEventReducer|ReasoningAccumulator|reduceConversationEvent|hydrateConversationState|reconcileConversationSnapshot|finalizeInterruptedReasoning)\b/, file);
}
assert.doesNotMatch(source("src/vite-env.d.ts") + source("src/pages/chat/ChatPage.vue"), /LEGACY_CHAT_TIMELINE_ROLLBACK/);
assert.match(source("src-tauri/src/chat/application.rs"), /open_native_event_stream/);
assert.match(source("src-tauri/src/chat/host_bridge.rs"), /native-thread/);
assert.match(source("src-tauri/src/lib.rs"), /chat_load_native_history_v1/);
assert.match(source("src-tauri/src/chat/migrations.rs"), /0014_chat_native_conversation/);
const committed = existsSync(path.join(root, "contracts/native-conversation.lock.json"));
const manifest = JSON.parse(source(`contracts/native-conversation.${committed ? "lock" : "candidate"}.json`));
assert.equal(manifest.published, false);
assert.equal(manifest.provenance, committed ? "git-commit" : "local-working-tree-candidate");
if (process.argv.includes("--require-committed")) assert.equal(committed, true, "Native Contracts source must be pinned before canonical startup");
execFileSync(process.execPath, ["scripts/sync-native-conversation.mjs", "--check", ...(committed ? ["--require-committed"] : [])], {cwd: path.join(root, "../yijie-contracts"), stdio: "inherit"});
console.log("FEAT-132 native sources, generated consumer snapshots and retired-engine boundary verified.");
