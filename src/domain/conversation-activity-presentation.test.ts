import { traceItem, traceTurn } from "./conversation-activity-fixtures";
import { describe, expect, it } from "vitest";
import { conversationActivityPresentation, traceCurrentStatus } from "./conversation-activity-presentation";
import { activityItemTitle, summarizeActivity } from "./conversation-activity-summary";

describe("execution trace reading contract", () => {
  it("groups 32 searches, 32 reasoning records and 8 commands into 40 calls", () => {
    const records = Array.from({length: 32}, (_, i) => [traceItem(`s${i}`, "webSearch", {webSearch: {action: "search", queries: ["Suzhou 2026"]}}), traceItem(`r${i}`, "reasoning", {summary: ["Process record"]}), ...(i % 4 === 0 ? [traceItem(`c${i}`, "commandExecution", {status: "completed", exitCode: 0})] : [])]).flat();
    const turn = traceTurn(records);
    const before = JSON.stringify(turn);
    const nodes = conversationActivityPresentation(turn);
    expect(nodes).toHaveLength(1);
    if (nodes[0]?.kind !== "activity") throw new Error("expected activity");
    expect(turn.items).toHaveLength(72);
    expect(nodes[0].group.items).toHaveLength(40);
    expect(nodes[0].group.entries).toHaveLength(40);
    expect(nodes[0].group.entries.every(entry => entry.item.presentation !== "reasoning")).toBe(true);
    expect(summarizeActivity(nodes[0].group, false).callCount).toBe(40);
    expect(JSON.stringify(turn)).toBe(before);
  });
  it("uses commentary and every unknown-phase message as boundaries without inferring final", () => {
    const turn = traceTurn([traceItem("a", "agentMessage", {phase: "commentary", text: "First stage"}), traceItem("c", "commandExecution"), traceItem("r", "reasoning"), traceItem("s", "webSearch"), traceItem("b", "agentMessage", {phase: "commentary", text: "Second stage"}), traceItem("t", "mcpToolCall"), traceItem("u", "agentMessage", {text: "Unclassified message"})]);
    expect(conversationActivityPresentation(turn).map(node => node.kind)).toEqual(["message", "activity", "message", "activity", "message"]);
    expect(turn.items[6]?.presentation).toBe("assistant_unclassified");
  });
  it("counts command actions independently and uses only native actions for labels", () => {
    const turn = traceTurn([traceItem("c", "commandExecution", {status: "completed", exitCode: 0, commandActions: [{index: 0, kind: "read", label: "README.md"}, {index: 1, kind: "read", label: "package.json"}]}), traceItem("s", "webSearch", {webSearch: {action: "search", queries: ["Statistics"], sources: [{url: "https://example.org", title: "Statistics"}]}})]);
    expect(activityItemTitle(turn.items[0]!)).toBe("运行命令");
    const group = conversationActivityPresentation(turn)[0];
    if (group?.kind !== "activity") throw new Error("expected activity");
    expect(group.group.entries.map(entry => entry.title).slice(0, 2)).toEqual(["读取 README.md", "读取 package.json"]);
    expect(group.group.entries[0]!.item).toBe(group.group.entries[1]!.item);
    expect(summarizeActivity(group.group, false)).toMatchObject({callCount: 2, actionCount: 2, sourceCount: 1});
    const fallback = traceTurn([traceItem("c", "commandExecution", {commandLabel: "cat README.md"})]);
    expect(activityItemTitle(fallback.items[0]!)).toBe("运行 cat README.md");
    expect(fallback.items[0]!.execution && "native" in fallback.items[0]!.execution && fallback.items[0]!.execution.native.item.commandActions).toBeUndefined();
  });
  it("keeps failed items and transient approvals outside collapsible groups", () => {
    const turn = traceTurn([traceItem("a", "commandExecution", {status: "completed", exitCode: 0}), traceItem("b", "commandExecution", {status: "failed", exitCode: 1}), traceItem("c", "commandExecution", {status: "completed", exitCode: 0})]);
    expect(conversationActivityPresentation(turn).map(node => node.kind)).toEqual(["activity", "attention", "activity"]);
    expect(conversationActivityPresentation(turn, new Set([turn.items[2]!.identity]))[2]?.kind).toBe("attention");
  });
  it.each([undefined, "final_answer"] as const)("retains historical failures and unsupported items in process details after successful continuation and an answer (%s)", phase => {
    const turn = traceTurn([
      traceItem("failed", "commandExecution", {status: "failed", exitCode: 2, availability: "partial", commandLabel: "zsh · 参数已隐藏"}),
      traceItem("old-image", "unknown", {availability: "unavailable"}),
      traceItem("continued", "commandExecution", {status: "completed", exitCode: 0}),
      traceItem("answer", "agentMessage", {text: "文件已交付。", ...(phase ? {phase} : {})}),
    ]);
    const before = JSON.stringify(turn);
    const nodes = conversationActivityPresentation(turn);
    expect(nodes.map(node => node.kind)).toEqual(["activity", "message"]);
    const group = nodes[0];
    if (group?.kind !== "activity") throw new Error("expected historical activity");
    expect(group.group.items).toEqual(turn.items.slice(0, 3));
    expect(group.group.items[0]).toBe(turn.items[0]);
    expect(group.group.items[0]?.execution?.status).toBe("failed");
    expect(summarizeActivity(group.group, false).counts).toBe("2 次调用 · 1 次失败 · 1 项暂不支持展示");
    expect(JSON.stringify(turn)).toBe(before);
    expect(conversationActivityPresentation(turn, new Set([turn.items[0]!.identity]))[0]?.kind).toBe("attention");
  });
  it("requires successful execution and a subsequent complete answer, not just a completed turn or matching display labels", () => {
    const failed = traceItem("failed", "commandExecution", {status: "failed", exitCode: 2, commandLabel: "zsh · 参数已隐藏"});
    const success = traceItem("success", "commandExecution", {status: "completed", exitCode: 0, commandLabel: "zsh · 参数已隐藏"});
    const answer = traceItem("answer", "agentMessage", {phase: "final_answer", text: "处理结果。"});
    for (const items of [
      [failed, answer], [failed, success], [success, failed, answer],
      [failed, success, {...answer, phase: "commentary" as const}],
      [failed, success, {...answer, text: ""}],
      [failed, success, {...answer, availability: "partial" as const}],
      [failed, {...success, exitCode: 2}, answer],
      [failed, answer, success],
      [failed, answer, success, {...answer, id: "second-answer"}],
      [failed, traceItem("user", "userMessage", {text: "下一项任务"}), success, answer],
    ]) {
      const node = conversationActivityPresentation(traceTurn(items)).find(node => node.kind !== "activity" && node.item.itemId === "failed");
      expect(node?.kind).toBe("attention");
    }
  });
  it.each(["failed", "interrupted", "in_progress"] as const)("keeps failures prominent while a turn is %s even with later successful work and an answer", domainStatus => {
    const turn = traceTurn([
      traceItem("failed", "commandExecution", {status: "failed", exitCode: 2}),
      traceItem("success", "commandExecution", {status: "completed", exitCode: 0}),
      traceItem("answer", "agentMessage", {phase: "final_answer", text: "当前结果。"}),
    ]);
    turn.domainStatus = domainStatus;
    turn.terminalStatus = domainStatus === "in_progress" ? null : domainStatus;
    expect(conversationActivityPresentation(turn)[0]?.kind).toBe("attention");
  });
  it("folds only completed unsupported display records and retains missing lifecycle and actual execution errors", () => {
    const base = traceTurn([traceItem("old", "unknown", {availability: "unavailable"})]);
    expect(conversationActivityPresentation(base)[0]?.kind).toBe("activity");
    const item = base.items[0]!;
    const failed = traceTurn([traceItem("command", "commandExecution", {status: "failed", exitCode: 2})]).items[0]!;
    for (const record of [
      {...item, domainStatus: "streaming" as const},
      {...item, domainStatus: "incomplete" as const, availability: "partial" as const},
      {...item, activityLabel: "结束状态待确认"},
      {...item, execution: failed.execution},
    ]) expect(conversationActivityPresentation({...base, items: [record]})[0]?.kind).toBe("attention");
  });
  it("keeps pending decisions, unavailable results and diagnostics prominent after successful continuation", () => {
    const base = traceTurn([
      traceItem("failed", "commandExecution", {status: "failed", exitCode: 2}),
      traceItem("success", "mcpToolCall", {status: "completed"}),
      traceItem("answer", "agentMessage", {phase: "final_answer", text: "处理结果。"}),
    ]);
    const first = base.items[0]!;
    const approval: NonNullable<typeof first.approval> = {
      approvalRequestId: "pending", threadId: first.threadId, turnId: first.turnId, itemId: first.itemId,
      revision: 1, status: "pending" as const, actionId: "git_repository_check", workspaceScope: "current_workspace" as const,
      decisions: {primary: "accept_once" as const, secondary: "cancel_current_turn" as const},
      requestedAt: "2026-11-10T04:00:00Z", expiresAt: "2026-11-10T04:02:00Z", resolvedAt: null,
      decisionId: null, decision: null, outcome: null, authority: "actionable" as const, authorityStreamId: "stream",
      source: {sourceEventId: "approval-event", sourceSequence: "1", sourceOccurredAt: "2026-11-10T04:00:00Z"},
    };
    for (const record of [
      {...first, approval}, {...first, activityLabel: "需要确认执行状态"},
      {...first, availability: "unavailable" as const},
    ]) expect(conversationActivityPresentation({...base, items: [record, ...base.items.slice(1)]})[0]?.kind).toBe("attention");
    expect(conversationActivityPresentation({...base, diagnostic: "stream_gap"})[0]?.kind).toBe("attention");
    expect(conversationActivityPresentation({...base, terminalStatus: null})[0]?.kind).toBe("attention");
    expect(conversationActivityPresentation({...base, diagnostic: "command_output_pending_final"})[0]?.kind).toBe("activity");
  });
  it("does not report a cold history or completed turn as active", () => {
    expect(traceCurrentStatus(traceTurn([traceItem("s", "webSearch")]))).toBeNull();
    const live = traceTurn([traceItem("s", "webSearch")], true);
    expect(traceCurrentStatus(live)).toBeNull();
    const group = conversationActivityPresentation(live)[0];
    if (group?.kind !== "activity") throw new Error("expected activity");
    expect(summarizeActivity(group.group, true)).toMatchObject({state: "thinking", title: "正在思考"});
  });
});
