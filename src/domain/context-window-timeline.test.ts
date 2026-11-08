import { describe, expect, it } from "vitest";
import { composeConversationView, type ConversationSnapshot } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
import { conversationActivityPresentation } from "./conversation-activity-presentation";
import { withContextWindowTimeline } from "./context-window-timeline";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";
import type { ContextWindowSnapshot } from "../api/context-window-client";

const local: ConversationSnapshot = { threads: [{ threadId: "local-session", status: "ready" }], turns: [], items: [] };
const native: NativeConversationView = { sessionId: "local-session", turnId: "local-turn", runtimeThreadId: "native-thread", runtimeTurnId: "native-turn", source: "native_observed", revision: "2", availability: "partial", status: "inProgress", statusSource: "runtime_notification", terminalObserved: false, items: [
  { item: { id: "before", type: "agentMessage", phase: "commentary", text: "前一条公开回复", availability: "available" }, ordinal: 0, lastMethod: "item/completed" },
  { item: { id: "native-context-item", type: "unknown", availability: "unavailable" }, ordinal: 1, lastMethod: "item/started" },
  { item: { id: "after", type: "agentMessage", phase: "commentary", text: "后一条公开回复", availability: "available" }, ordinal: 2, lastMethod: "item/completed" },
] };
const snapshot: ContextWindowSnapshot = { schema_version: 1, thread_id: "native-thread", model_profile: "ordinary", model_revision: 1, sample: null, compactions: [{ turn_id: "native-turn", item_id: "native-context-item", state: "in_progress" }] };
describe("native public context update row", () => {
  it("keeps original position and native identity and remains outside collapsed tools", () => {
    const original = JSON.stringify(native);
    const timeline = selectConversationTimeline(composeConversationView(local, [native]), "local-session");
    const enriched = withContextWindowTimeline(timeline, snapshot)!;
    const item = enriched.turns[0]!.items[1]!;
    expect(item).toMatchObject({ kind: "unknown", presentation: "context_update", role: "assistant", assistantPhase: null, itemId: "native-context-item", ordinal: 1, copyPolicy: "none" });
    const node = conversationActivityPresentation(enriched.turns[0]!).find(node => node.identity === item.identity);
    expect(node).toMatchObject({ kind: "message", process: false });
    const done = withContextWindowTimeline(timeline, { ...snapshot, compactions: [{ ...snapshot.compactions[0]!, state: "completed" }] })!;
    expect(done.turns[0]!.items[1]!.identity).toBe(item.identity);
    expect(done.turns[0]!.items[1]!.contextUpdateState).toBe("completed");
    expect(JSON.stringify(native)).toBe(original);
  });
  it("does not match another native thread/turn or reinterpret arbitrary unknown items", () => {
    const timeline = selectConversationTimeline(composeConversationView(local, [native]), "local-session");
    for (const wrong of [{ ...snapshot, thread_id: "another-thread" }, { ...snapshot, compactions: [{ ...snapshot.compactions[0]!, turn_id: "another-turn" }] }]) {
      expect(withContextWindowTimeline(timeline, wrong)!.turns[0]!.items[1]!.presentation).toBe("unknown");
    }
  });
});
