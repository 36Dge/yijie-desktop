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

it("displays the existing native budget failure without changing the terminal fact", () => {
  const saved: NativeConversationView = {
    sessionId: "session", turnId: "turn", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn",
    source: "native_observed", revision: "5", availability: "available", status: "failed",
    terminalObserved: true, terminalErrorCode: "sessionBudgetExceeded", diagnostic: "runtime_notice", items: [],
  };
  const original = JSON.stringify(saved);
  const snapshot: ConversationSnapshot = { threads: [{ threadId: "session", status: "ready" }], turns: [], items: [] };
  const timeline = selectConversationTimeline(composeConversationView(snapshot, [saved]), "session")!;
  expect(timeline.turns[0]?.domainStatus).toBe("failed");
  expect(timeline.notices[0]?.diagnostic).toBe("session_budget_exceeded");
  expect(conversationDiagnosticMessage("session_budget_exceeded")).toContain("预算已用尽");
  expect(JSON.stringify(saved)).toBe(original);
  const running = {...saved, status: "inProgress" as const, terminalObserved: false};
  const live = selectConversationTimeline(composeConversationView(snapshot, [running]), "session")!;
  expect(live.notices[0]?.diagnostic).toBe("runtime_notice");
});

it("shows execution guard reasons through the existing diagnostic allowlist", () => {
  for (const code of ["web_retrieval_local_fetch_blocked", "operation_duplicate_pending", "operation_retry_unchanged", "operation_retry_dns_unchanged", "operation_retry_network_unchanged", "operation_retry_access_unchanged", "operation_guard_capacity"]) {
    expect(safeConversationDiagnostic(code)).toBe(code);
    expect(conversationDiagnosticMessage(code)).not.toContain("未分类");
    expect(conversationDiagnosticMessage(code)).not.toContain("YIJIE_");
  }
  expect(conversationDiagnosticMessage("operation_retry_dns_unchanged")).toContain("域名解析错误");
  expect(conversationDiagnosticMessage("web_retrieval_local_fetch_blocked")).toContain("本地脚本");
});

it("keeps a guard reason visible without inventing an executed command or failed answer", () => {
  const saved: NativeConversationView = {
    sessionId: "session", turnId: "turn", runtimeThreadId: "runtime-thread", runtimeTurnId: "runtime-turn",
    source: "native_observed", revision: "5", availability: "available", status: "completed",
    terminalObserved: true, terminalErrorCode: null, diagnostic: "web_retrieval_local_fetch_blocked", items: [],
  };
  const snapshot: ConversationSnapshot = { threads: [{ threadId: "session", status: "ready" }], turns: [], items: [] };
  const timeline = selectConversationTimeline(composeConversationView(snapshot, [saved]), "session")!;
  expect(timeline.notices[0]?.diagnostic).toBe("web_retrieval_local_fetch_blocked");
  expect(timeline.turns[0]?.domainStatus).toBe("completed");
  expect(timeline.turns[0]?.items).toEqual([]);
});
