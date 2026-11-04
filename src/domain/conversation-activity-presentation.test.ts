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
  it("does not report a cold history or completed turn as active", () => {
    expect(traceCurrentStatus(traceTurn([traceItem("s", "webSearch")]))).toBeNull();
    const live = traceTurn([traceItem("s", "webSearch")], true);
    expect(traceCurrentStatus(live)).toBeNull();
    const group = conversationActivityPresentation(live)[0];
    if (group?.kind !== "activity") throw new Error("expected activity");
    expect(summarizeActivity(group.group, true)).toMatchObject({state: "thinking", title: "正在思考"});
  });
});
