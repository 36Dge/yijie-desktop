import { describe, expect, it } from "vitest";
import { traceItem, traceTurn } from "./conversation-activity-fixtures";
import { conversationReasoningSummary, reasoningSummaryIsCurrent } from "./conversation-reasoning-summary";
import { conversationActivityPresentation } from "./conversation-activity-presentation";

const reasoning = (id: string, summary: string[], content: string[] = []) => traceItem(id, "reasoning", {summary, content});

describe("native reasoning summary reading", () => {
  it.each([
    ["## 城市定位\n\n先整理资料。\n\n### 城市生活\n\n继续整理。", "城市生活"],
    ["第一部分\n\n**交通与生活**\n\n分析生活半径。", "交通与生活"],
    ["第一行\n最后的 **可读摘要**", "最后的 可读摘要"],
    ["```text\n# 代码中的标题\n```\n\n正常说明", "正常说明"],
  ])("derives a readable heading from allowed summary: %s", (summary, heading) => {
    expect(conversationReasoningSummary(traceTurn([reasoning("r", [summary])], true), true)?.title).toBe(`正在思考 · ${heading}`);
  });

  it("keeps raw content out and preserves separate native identities and equal summary text", () => {
    const turn = traceTurn([reasoning("a", ["相同摘要"], ["仅原始内容"]), reasoning("b", ["相同摘要"])]);
    const before = JSON.stringify(turn), summary = conversationReasoningSummary(turn, false)!;
    expect(summary.items.map(item => item.itemId)).toEqual(["a", "b"]);
    expect(summary.items.flatMap(item => item.contentBlocks).map(block => "text" in block && block.text)).toEqual(["相同摘要", "相同摘要"]);
    expect(summary.items[0]!.contentBlocks[0]).toBe(turn.items[0]!.contentBlocks[0]);
    expect(JSON.stringify(turn)).toBe(before);
  });

  it("does not invent summaries for empty, raw-only, unavailable or diagnostic records", () => {
    const turn = traceTurn([reasoning("empty", [" "]), reasoning("raw", [], ["原始内容"]), {...reasoning("hidden", ["不可用记录"]), availability: "unavailable"}]);
    expect(conversationReasoningSummary(turn, true)).toBeNull();
    const diagnostic = traceTurn([reasoning("r", ["部分摘要"])]);
    diagnostic.items = diagnostic.items.map(item => ({...item, reasoning: {status: "incomplete", reasonCode: "stream_gap"}}));
    expect(conversationReasoningSummary(diagnostic, false)).toBeNull();
    expect(conversationActivityPresentation(diagnostic)[0]?.kind).toBe("attention");
  });

  it("keeps reasoning out of tool boundaries and counts while retaining one turn summary", () => {
    const turn = traceTurn(Array.from({length: 32}, (_, i) => [traceItem(`s${i}`, "webSearch", {webSearch: {action: "search", queries: ["普通资料"]}}), reasoning(`r${i}`, [`阶段 ${i}`])]).flat(), true);
    const nodes = conversationActivityPresentation(turn);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind === "activity" && nodes[0].group.entries.length).toBe(32);
    expect(conversationReasoningSummary(turn, true)?.items).toHaveLength(32);
    expect(nodes[0]?.kind === "activity" && nodes[0].group.state.kind).toBe("summary");
  });

  it("gives tools, retries, public messages and answer text their current-state precedence", () => {
    const records = [traceItem("c", "commandExecution", {status: "inProgress"}), reasoning("r", ["整理信息"])];
    expect(reasoningSummaryIsCurrent(traceTurn(records, true))).toBe(false);
    for (const phase of ["commentary", "final_answer", undefined] as const) {
      const turn = traceTurn([reasoning("r", ["整理信息"]), traceItem("a", "agentMessage", {text: "公开内容", ...(phase ? {phase} : {})})], true);
      expect(conversationReasoningSummary(turn, true)?.state).toBe("summary");
    }
    const retry = {...traceTurn([reasoning("r", ["整理信息"])], true), traceSequence: "2", traceNotices: [{eventId: "retry", sequence: "2", method: "error" as const, scope: "turn" as const, code: "runtime_notice", willRetry: true}]};
    expect(reasoningSummaryIsCurrent(retry)).toBe(false);
    expect(conversationReasoningSummary(traceTurn([reasoning("r", ["已保存内容"])], true), false)?.state).toBe("summary");
  });

  it("bounds heading length while keeping full summary content", () => {
    const text = "城市生活".repeat(100);
    const summary = conversationReasoningSummary(traceTurn([reasoning("r", [text])]), false)!;
    expect(Array.from(summary.title.replace("思考摘要 · ", ""))).toHaveLength(81);
    expect(summary.items[0]!.contentBlocks[0]).toMatchObject({text});
  });
});
