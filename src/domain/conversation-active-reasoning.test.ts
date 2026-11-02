import { describe, expect, it } from "vitest";
import { composeConversationView } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
import { activeReasoningIdentity } from "./conversation-process";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";

function turn(extra: NativeConversationView["items"] = []) {
  const native: NativeConversationView = {sessionId: "session", turnId: "turn", runtimeThreadId: "thread", runtimeTurnId: "turn",
    source: "native_observed", revision: "1", availability: "available", status: "inProgress", statusSource: "runtime_notification", terminalObserved: false,
    items: [{ordinal: 0, lastMethod: "item/started", item: {id: "reasoning", type: "reasoning", summary: ["核对普通信息。"], availability: "available"}}, ...extra]};
  return selectConversationTimeline(composeConversationView({threads: [{threadId: "session", status: "active"}], turns: [], items: []}, [native]), "session", undefined, {liveTurnId: "turn", protectApprovalProcessContent: false})!.turns[0]!;
}
describe("active reasoning sweep", () => {
  it("follows the latest observed reasoning and stops once an answer or tool starts", () => {
    const current = turn(); expect(activeReasoningIdentity(current)).toBe(current.items[0]!.identity);
    for (const type of ["agentMessage", "webSearch"] as const) {
      expect(activeReasoningIdentity(turn([{ordinal: 1, lastMethod: "item/started", item: {id: "next", type, text: "已开始后续活动。", availability: "available"}}]))).toBeNull();
    }
  });
  it("does not animate historical, terminal, waiting or unconfirmed states", () => {
    const current = turn();
    for (const update of [{liveObserved: false}, {statusSource: "runtime_read"}, {availability: "unavailable"},
      {domainStatus: "completed"}, {domainStatus: "waiting_approval"}, {domainStatus: "failed"}, {domainStatus: "interrupted"}] as const) {
      expect(activeReasoningIdentity({...current, ...update})).toBeNull();
    }
  });
});
