import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "vite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(os.tmpdir(), "feat132-native-exchange-"));
const env = {...process.env, YIJIE_FEAT132_TEST_EXCHANGE: path.join(scratch, "host-output.json"), YIJIE_FEAT132_TEST_VIEW_OUTPUT: path.join(scratch, "native-view.json")};
function run(command, args, cwd) {
  // Each bounded test exits normally. No process-kill timeout or fake executable.
  const result = spawnSync(command, args, {cwd, env, stdio: "inherit"});
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
try {
  run("go", ["test", "./internal/session", "-run", "^TestFEAT132NativeCrossRepoExport$", "-count=1", "-v"], path.join(root, "../yijie-agent-host"));
  run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "chat::database::tests::feat132_cross_repo_host_bytes_reach_native_storage_without_identity_rewriting", "--", "--ignored", "--exact", "--nocapture"], root);
  const server = await createServer({root, configFile: false, logLevel: "error", server: {middlewareMode: true, watch: {ignored: ["**/*"]}}});
  try {
    const {composeConversationView} = await server.ssrLoadModule("/src/domain/conversation-view.ts");
    const {selectConversationTimeline} = await server.ssrLoadModule("/src/domain/conversation-timeline.ts");
    const {conversationActivityPresentation} = await server.ssrLoadModule("/src/domain/conversation-activity-presentation.ts");
    const {summarizeActivity} = await server.ssrLoadModule("/src/domain/conversation-activity-summary.ts");
    const view = JSON.parse(readFileSync(env.YIJIE_FEAT132_TEST_VIEW_OUTPUT, "utf8"));
    const original = JSON.stringify(view);
    const state = composeConversationView({threads: [{threadId: view.sessionId, status: "ready"}], turns: [], items: []}, [view]);
    const turn = selectConversationTimeline(state, view.sessionId).turns[0];
    const groups = conversationActivityPresentation(turn).filter(node => node.kind === "activity").map(node => node.group);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 3);
    assert.equal(groups[0].entries.length, 4);
    assert.equal(groups[0].entries.filter(entry => entry.item.itemId === "host-command").length, 2);
    assert.equal(groups[0].entries.some(entry => entry.item.presentation === "reasoning"), false);
    assert(groups[0].entries.some(entry => entry.title === "运行 tail -n 5 README.md"));
    assert(groups[0].entries.some(entry => entry.title === "查看公开资料"));
    assert.equal(summarizeActivity(groups[0], false).callCount, 3);
    assert(summarizeActivity(groups[0], false).title.includes("浏览器"));

    const publicMessages = turn.items.filter(item => item.presentation === "commentary");
    assert.equal(publicMessages.length, 2);
    assert.deepEqual(publicMessages.map(item => item.contentBlocks.filter(block => block.type === "text").map(block => block.text).join("")), [
      "我会比较城市产业与生活体验。",
      "现有资料分别覆盖产业与生活成本，结论将保持同一比较口径。",
    ]);
    assert.equal(JSON.stringify(view), original);
  } finally { await server.close(); }
  console.log("Actual Host projection → Native SSE/display/SQLCipher → normal reopen → frontend activity rows: PASS. No Runtime/model call.");
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
