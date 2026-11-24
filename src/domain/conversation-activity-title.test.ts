import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NativeItem, NativeMcpDisplay } from "../api/generated/native-conversation-private.gen";
import { traceItem, traceTurn } from "./conversation-activity-fixtures";
import { conversationActivityPresentation } from "./conversation-activity-presentation";
import { summarizeActivity } from "./conversation-activity-summary";
import { createActivityTitleSelector } from "./conversation-activity-title";
import { nativeMcpRowTitle } from "./native-mcp-display";
import type { ConversationToolExecution } from "./conversation-view";

function call(id: string, method: string, data?: unknown, title?: string, diagnostics: NativeMcpDisplay["diagnostics"] = []) {
  const tool = "m_" + createHash("sha256").update("sorftime\n" + method).digest("hex").slice(0, 60);
  return traceItem(id, "mcpToolCall", {
    ...(title ? {toolDisplay: {provenance: "registeredTool", title}} : {}),
    mcp: {server: "yijie_market", tool, resultKind: data === undefined ? "omitted" : "text", diagnostics,
      texts: data === undefined ? [] : [{index: 0, text: JSON.stringify({data})}]},
  });
}
function summaries(items: NativeItem[], live = false) {
  return conversationActivityPresentation(traceTurn(items, live)).flatMap(node =>
    node.kind === "activity" ? [summarizeActivity(node.group, live)] : []);
}
const heading = (items: NativeItem[]) => summaries(items)[0]?.title;
const page = (id: string, number: number, asins?: string[], node = "123") => call(id, "category_products_extended",
  asins?.map(asin => ({asin})), `查询类目商品 · ${node} · 第 ${number} 页`);
const sales = (id: string, asin: string, daily = true) => call(id, "product_trend",
  {asin, type: daily ? "DailySalesVolume" : "SalesVolume", data: [daily ? "20261101" : "202611", "0"]});
const category = (id: string) => ({node_id: id, category_name: "Category " + id});
const boundary = traceItem("stage", "agentMessage", {phase: "commentary", text: "继续核对。"});

describe("completed activity titles", () => {
  it("uses registered methods, complete category identities and the existing message boundaries", () => {
    const tree = call("tree", "category_tree", [{...category("toys"), children: []}], "category tree", ["arguments_unavailable"]);
    const results = [category("10"), category("20")];
    const lookup = (id: string, rows: unknown[]) => call(id, "category_search_from_top_node", rows, "category search from top node");
    const items = [call("clock", "get_time"), tree, call("quota", "common_usage_query"), boundary,
      lookup("a", results), lookup("b", [...results].reverse()), lookup("c", results)];
    expect(summaries(items).map(s => s.title)).toEqual(["读取类目树（1 个一级类目）", "3 次查询返回相同的 2 个类目"]);
    expect(nativeMcpRowTitle(tree)).toBe("读取类目树");
    expect(nativeMcpRowTitle(lookup("d", results))).toBe("按上级类目查询");
    expect(heading([lookup("a", results), lookup("b", [category("30"), category("40")])])).toBe("按上级类目查询 2 次");
    expect(heading([lookup("a", results), lookup("b", [{...results[0], category_name: "Different"}, results[1]])])).toBe("按上级类目查询 2 次");
    expect(heading([lookup("a", []), lookup("b", [])])).toBe("2 次类目查询均未返回匹配项");
  });

  it("counts distinct product identities and folds only explicit same-node page labels", () => {
    const items = [page("p3", 3, ["B000000001", "B000000002"]), page("p1", 1, ["B000000002"]), page("p2", 2, [])];
    expect(heading(items)).toBe("读取 2 款类目商品（第 1–3 页）");
    expect(heading([page("1", 1), page("repeat", 1), page("3", 3)])).toBe("查询类目商品（第 1、3 页）");
    expect(heading([page("1", 1), page("repeat", 1)])).toBe("查询类目商品（第 1 页，2 次）");
    expect(heading([page("1", 1), page("2", 2, undefined, "987")])).toBe("查询类目商品 2 次");
    expect(heading([page("1", 1, ["B000000001"]), page("2", 2)])).toBe("查询类目商品（第 1–2 页）");
  });

  it("counts only complete observed sales results across calls and separates daily and monthly metrics", () => {
    const a = sales("daily", "B000000001");
    const other = sales("other", "B000000002");
    const failed = {...sales("failed", "B000000003"), status: "failed" as const};
    const items = [a, {...a, id: "repeat"}, failed, other];
    expect(summaries(items)[0]).toMatchObject({title: "取得 2 款商品的日销量", callCount: 3});
    expect(heading([a, sales("m", "B000000002", false), call("q", "common_usage_query")])).toBe("查询商品日销量和月销量");
    for (const data of [[], ["20261101", -1], ["20261101"], ["20261101", null]]) {
      const missing = call("empty", "product_trend", {asin: "B000000003", type: "DailySalesVolume", data}, "查询商品日销量");
      expect(heading([missing])).toBe("查询商品日销量");
    }
    const requested = (id: string, asin: string) => call(id, "product_trend", undefined, "查询商品日销量 · " + asin);
    expect(heading([requested("a", "B000000001"), requested("b", "B000000001"), requested("c", "B000000002")]))
      .toBe("查询 2 款商品的日销量");
    const different = call("d", "product_trend", {asin: "B000000009", type: "DailySalesVolume", data: ["20261101", 5]}, "查询商品日销量 · B000000001");
    expect(heading([different])).toBe("查询商品日销量 · B000000001");
    const monthly = call("m", "product_trend", {asin: "B000000001", type: "SalesVolume", data: ["202611", 5]}, "查询商品日销量 · B000000001");
    expect(heading([monthly])).toBe("查询商品日销量 · B000000001");
  });

  it("does not promote partial results or running calls into completed quantities", () => {
    for (const reason of ["content_redacted", "content_truncated", "unsupported_content", "display_limit"] as const) {
      const partial = call("p", "category_tree", [{...category("a"), children: []}], undefined, [reason]);
      expect(heading([partial])).toBe("读取类目树");
    }
    expect(heading([{...call("old", "category_tree", [{...category("a"), children: []}]), availability: "partial"}])).toBe("读取类目树");
    const current = {...sales("s", "B000000001"), status: "inProgress" as const};
    expect(summaries([current, boundary], true)[0]).toMatchObject({state: "summary", title: "查询商品趋势"});
    const direct = call("tree", "category_tree", [{...category("a"), children: []}]);
    direct.mcp!.server = "another";
    expect(heading([direct])).toBe("工具调用 1 次");
  });

  it("selects two substantial actions, identifies ambiguous sources, and describes old records", () => {
    const tool = (id: string, sourceLabel: string, title?: string) => traceItem(id, "mcpToolCall", {
      toolDisplay: {sourceLabel, title, provenance: "registeredTool"},
    });
    expect(heading([tool("one", "甲", "查询天气"), tool("two", "乙", "查询天气")])).toBe("甲 · 查询天气，乙 · 查询天气");
    expect(heading([tool("one", "甲", "查询天气 · 青岛"), tool("two", "甲", "查询天气 · 上海")])).toBe("查询天气（青岛、上海）");
    expect(heading([tool("one", "甲"), tool("two", "甲")])).toBe("调用 甲 工具 2 次");
    expect(heading([call("q", "common_usage_query"), call("t", "get_time")])).toBe("查询 Sorftime 剩余额度，查询 Sorftime 服务时间");
    expect(heading([call("report", "category_report"), call("r2", "category_report"), page("p", 1), tool("old", "旧服务")]))
      .toBe("查询类目报告 2 次，查询类目商品（第 1 页）");
  });

  it("reopening an interrupted turn keeps the result and counts each native item once", () => {
    const first = page("one", 1, ["B000000001", "B000000002"]);
    const items = [first, {...first}, page("two", 2, ["B000000002", "B000000003"]), {...sales("late", "B000000003"), status: "failed" as const}];
    const before = JSON.stringify(items);
    const observed = traceTurn(items);
    const reopened = {...traceTurn(JSON.parse(before) as NativeItem[]), source: "native_rebuilt" as const, statusSource: "runtime_read" as const};
    for (const turn of [observed, reopened]) {
      const [node] = conversationActivityPresentation({...turn, domainStatus: "interrupted", terminalStatus: "interrupted"});
      expect(node?.kind === "activity" && summarizeActivity(node.group, false)).toMatchObject({
        state: "summary", title: "读取 3 款类目商品（第 1–2 页）", callCount: 2,
      });
    }
    expect(JSON.stringify(items)).toBe(before);
  });

  it("updates the same mounted header on complete snapshots, corrections and newly partial evidence", () => {
    const select = createActivityTitleSelector();
    const viewTitle = (item: NativeItem) => {
      const [node] = conversationActivityPresentation(traceTurn([item]));
      return node?.kind === "activity" && summarizeActivity(node.group, false, select).title;
    };
    const received = page("same-item", 1, ["B000000001"]);
    expect(viewTitle(received)).toBe("读取 1 款类目商品（第 1 页）");
    expect(viewTitle(JSON.parse(JSON.stringify(received)) as NativeItem)).toBe("读取 1 款类目商品（第 1 页）");
    expect(viewTitle(page("same-item", 1, ["B000000001", "B000000002"]))).toBe("读取 2 款类目商品（第 1 页）");
    expect(viewTitle({...received, mcp: {...received.mcp!, diagnostics: ["display_limit"]}})).toBe("查询类目商品（第 1 页）");
  });

  it("keeps command-action counts separate from calls and names the public targets", () => {
    const command = traceItem("read", "commandExecution", {exitCode: 0, commandActions: [
      {index: 0, kind: "read", label: "README.md"}, {index: 1, kind: "read", label: "LICENSE"},
    ]});
    expect(summaries([command])[0]).toMatchObject({title: "读取文件（README.md、LICENSE）", callCount: 1, actionCount: 2});
  });

  it("uses the original identity in legacy archives without treating old summaries as result records", () => {
    const base = traceTurn([traceItem("a", "mcpToolCall"), traceItem("b", "mcpToolCall")]);
    const saved = {sourceEventId: "event", sourceSequence: "1", sourceOccurredAt: "2026-01-01T09:00:00Z"};
    const note = {text: "已收到结果", truncated: false, truncationReason: null};
    const execution: ConversationToolExecution = {
      kind: "tool", status: "completed", identity: {resolution: "known", serverName: "sorftime", toolName: "category_report"},
      startedSource: saved, lastSource: saved, argumentsSummary: note, resultSummary: note, progress: [], durationMs: null, error: null,
    };
    const [node] = conversationActivityPresentation({...base, items: base.items.map(item => ({...item, execution}))});
    expect(node?.kind === "activity" && summarizeActivity(node.group, false).title).toBe("查询类目报告 2 次");
  });
});
