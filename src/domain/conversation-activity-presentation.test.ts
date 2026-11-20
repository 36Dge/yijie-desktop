import { traceItem, traceTurn } from "./conversation-activity-fixtures";
import { describe, expect, it } from "vitest";
import { conversationActivityPresentation, traceCurrentStatus } from "./conversation-activity-presentation";
import { activityItemTitle, summarizeActivity } from "./conversation-activity-summary";

describe("execution trace reading contract", () => {
  it("hides only generic waiting after delivery without inventing a terminal turn", () => {
    const live = traceTurn([traceItem("opening", "agentMessage", { text: "开始处理。", phase: "commentary" })], true);
    const before = JSON.stringify(live);
    expect(traceCurrentStatus(live)).toBe("等待模型继续输出");
    expect(traceCurrentStatus(live, true)).toBeNull();
    expect(JSON.stringify(live)).toBe(before);
    expect(traceCurrentStatus({ ...live, domainStatus: "waiting_approval" }, true)).toBe("等待你的确认");
  });

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
  it.each([true, false])("filters tool outcomes before grouping in a live or saved turn (live=%s)", live => {
    const records = [
      traceItem("success", "mcpToolCall", {availability: "partial"}),
      traceItem("failed", "mcpToolCall", {status: "failed"}),
      traceItem("unknown", "mcpToolCall", {status: null}),
      traceItem("unavailable", "mcpToolCall", {availability: "unavailable"}),
      traceItem("declined", "fileChange", {status: "declined"}),
      traceItem("agent-failed", "subAgentActivity", {status: "failed"}),
      traceItem("image-failed", "imageView", {status: "failed"}),
      traceItem("missing-exit", "commandExecution", {exitCode: null}),
      traceItem("nonzero", "commandExecution", {exitCode: 7}),
      traceItem("ok-exit", "commandExecution", {exitCode: 0}),
      traceItem("running", "commandExecution", {status: "inProgress"}),
      traceItem("web-failed", "webSearch", {status: "failed"}),
      traceItem("web-finished", "webSearch"),
      traceItem("old-image", "unknown", {availability: "unavailable"}),
      traceItem("last-failed", "commandExecution", {status: "failed", exitCode: 2}),
    ];
    const turn = traceTurn(records, live);
    const before = JSON.stringify(turn);
    const nodes = conversationActivityPresentation(turn);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    if (node?.kind !== "activity") throw new Error("expected visible tools in the process");
    const expected = ["success", "ok-exit", ...(live ? ["running"] : []), "web-finished", "old-image"];
    expect(node.group.items.map(item => item.itemId)).toEqual(expected);
    expect(node.group.entries.map(entry => entry.item.itemId)).toEqual(expected);
    expect(summarizeActivity(node.group, live).counts).not.toMatch(/失败|待确认/);
    expect(JSON.stringify(turn)).toBe(before);
  });

  it.each(["completed", "interrupted", "failed"] as const)("filters the first and last failures independently of the turn result (%s)", status => {
    const turn = traceTurn([
      traceItem("first", "commandExecution", {status: "failed", exitCode: 2}),
      traceItem("answer", "agentMessage", {phase: "final_answer", text: "处理结果。"}),
      traceItem("last", "mcpToolCall", {status: "failed"}),
    ]);
    turn.domainStatus = turn.terminalStatus = status;
    const nodes = conversationActivityPresentation(turn);
    expect(nodes.map(node => node.identity)).toEqual([turn.items[1]!.identity]);
    expect(conversationActivityPresentation({...turn, items: [turn.items[0]!, turn.items[2]!]})).toEqual([]);
  });

  it("keeps display-only unknown items separate from failed execution records", () => {
    const base = traceTurn([traceItem("old", "unknown", {availability: "unavailable"})]);
    expect(conversationActivityPresentation(base)[0]?.kind).toBe("activity");
    const item = base.items[0]!;
    for (const record of [
      {...item, domainStatus: "streaming" as const},
      {...item, domainStatus: "incomplete" as const, availability: "partial" as const},
      {...item, activityLabel: "结束状态待确认"},
    ]) expect(conversationActivityPresentation({...base, items: [record]})[0]?.kind).toBe("attention");
    const failed = traceTurn([traceItem("command", "commandExecution", {status: "failed", exitCode: 2})]).items[0]!;
    expect(conversationActivityPresentation({...base, items: [{...item, execution: failed.execution}]})).toEqual([]);
  });

  it("uses structured web errors even when the tool envelope says completed", () => {
    const error = JSON.stringify({error: {code: "upstream_unavailable", message: "网页检索服务暂不可用。"}});
    const tool = (id: string, text: string) => traceItem(id, "mcpToolCall", {mcp: {
      server: "yijie_web", tool: "kimi_web_fetch", resultKind: "text", texts: [{index: 0, text}], diagnostics: [],
    }});
    const turn = traceTurn([tool("error", error), tool("readable", "页面正文包含“失败原因”这个标题。")]);
    const [node] = conversationActivityPresentation(turn);
    expect(node?.kind === "activity" && node.group.items.map(item => item.itemId)).toEqual(["readable"]);
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
