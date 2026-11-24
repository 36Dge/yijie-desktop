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
  it.each(["in_progress", "completed", "interrupted", "unknown"] as const)("keeps the %s update in its original position within the turn process", state => {
    const original = JSON.stringify(native);
    const timeline = selectConversationTimeline(composeConversationView(local, [native]), "local-session")!;
    const turn = withContextWindowTimeline(timeline, { ...snapshot, compactions: [{ ...snapshot.compactions[0]!, state }] })!.turns[0]!;
    const originalItems = timeline.turns[0]!.items;
    expect(turn.items[1]).toMatchObject({ kind: "unknown", presentation: "context_update", contextUpdateState: state, role: "assistant", assistantPhase: null, itemId: "native-context-item", ordinal: 1, copyPolicy: "none" });
    expect(conversationActivityPresentation(turn)).toMatchObject([
      { identity: originalItems[0]!.identity },
      { identity: originalItems[1]!.identity, kind: "message", process: true },
      { identity: originalItems[2]!.identity },
    ]);
    expect(JSON.stringify(native)).toBe(original);
  });
  it("does not match another native thread/turn or reinterpret arbitrary unknown items", () => {
    const timeline = selectConversationTimeline(composeConversationView(local, [native]), "local-session");
    for (const wrong of [{ ...snapshot, thread_id: "another-thread" }, { ...snapshot, compactions: [{ ...snapshot.compactions[0]!, turn_id: "another-turn" }] }]) {
      expect(withContextWindowTimeline(timeline, wrong)!.turns[0]!.items[1]!.presentation).toBe("unknown");
    }
  });
});
