import { expect, it } from "vitest";
import { conversationDiagnosticMessage, safeConversationDiagnostic } from "./conversation-diagnostics";
import { composeConversationView, type ConversationSnapshot } from "./conversation-view";
import { selectConversationTimeline } from "./conversation-timeline";
import type { NativeConversationView } from "../api/generated/native-conversation-private.gen";

it("keeps a saved runtime notice distinct from unknown while preserving the failed turn", () => {
  const snapshot: ConversationSnapshot = {
    threads: [{ threadId: "session", status: "ready" }], turns: [], items: [],
  };
  const saved: NativeConversationView = {
    sessionId: "session", turnId: "turn", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn",
    source: "native_observed", revision: "5", availability: "partial", status: "failed",
    terminalObserved: true, terminalErrorCode: "other", diagnostic: "runtime_notice",
    items: [{ ordinal: 0, lastMethod: "item/completed", item: {
      id: "user", type: "userMessage", text: "普通问题", availability: "available",
    } }],
  };
  const original = JSON.stringify(saved);
  for (const view of [saved, JSON.parse(original) as NativeConversationView]) {
    const timeline = selectConversationTimeline(composeConversationView(snapshot, [view]), "session");
    expect(timeline?.notices[0]?.diagnostic).toBe("runtime_notice");
    expect(timeline?.turns[0]?.domainStatus).toBe("failed");
    expect(conversationDiagnosticMessage(timeline!.notices[0]!.diagnostic!))
      .toBe("运行时返回了提示，但未提供可显示的详细原因。已保留现有内容。");
    expect(JSON.stringify(view)).toBe(original);
  }
});

it("never displays an unrecognized upstream diagnostic as raw text", () => {
  expect(safeConversationDiagnostic("ordinary_future_notice")).toBe("unknown");
  expect(conversationDiagnosticMessage("ordinary_future_notice"))
    .toBe("会话存在未分类提示，已保留可用内容。");
});
