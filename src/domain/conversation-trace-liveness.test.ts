import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";
import { composeConversationView } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
import { conversationActivityPresentation, traceIsLive } from "./conversation-activity-presentation";

function savedView(diagnostic?: string, availability: "available" | "partial" | "unavailable" = "available"): NativeConversationView {
  return {sessionId: "session", turnId: "turn", runtimeThreadId: "runtime", runtimeTurnId: "runtime-turn", revision: "8", source: "native_observed", availability: "partial", statusSource: "runtime_notification", status: "inProgress", terminalObserved: false,
    ...(diagnostic ? {diagnostic} : {}), items: [{ordinal: 0, lastMethod: "item/started", item: {id: "tool", type: "mcpToolCall", status: "inProgress", availability, argumentsSummary: "参数不可展示", mcp: {server: "ordinary", tool: "read", resultKind: "absent", texts: [], diagnostics: ["arguments_unavailable"]}}}]};
}
function project(view: NativeConversationView, live = true) {
  return selectConversationTimeline(composeConversationView({threads: [{threadId: "session", status: "active"}], turns: [], items: []}, [view]), "session", undefined, live ? {liveTurnId: "turn", protectApprovalProcessContent: false} : undefined)!.turns[0]!;
}

describe("trace lifecycle authority is independent of content visibility", () => {
  it("reads existing format6 output-policy diagnostics without changing the saved facts", () => {
    const view = savedView("command_output_pending_final"), original = JSON.stringify(view);
    const turn = project(view);
    expect(traceIsLive(turn)).toBe(true);
    expect(turn.items[0]).toMatchObject({busy: true, activityLabel: undefined});
    expect(conversationActivityPresentation(turn)[0]?.kind).toBe("activity");
    expect(JSON.stringify(view)).toBe(original);
  });
  it("keeps a native inProgress tool active when only its parameters are hidden", () => {
    const turn = project(savedView(undefined, "partial"));
    expect(traceIsLive(turn)).toBe(true);
    expect(turn.items[0]).toMatchObject({busy: true, availability: "partial", activityLabel: undefined});
    expect(conversationActivityPresentation(turn)[0]?.kind).toBe("activity");
  });
  it("does not promote a saved discontinuity or unavailable item into live work", () => {
    const turn = project(savedView("stream_gap"));
    expect(traceIsLive(turn)).toBe(false);
    expect(turn.items[0]?.busy).toBe(false);
    expect(project(savedView(undefined, "unavailable")).items[0]?.busy).toBe(false);
  });
  it("does not animate cold history just because its latest saved status was inProgress", () => {
    const turn = project(savedView("command_output_pending_final"), false);
    expect(traceIsLive(turn)).toBe(false);
    expect(turn.items[0]?.busy).toBe(false);
  });
});
