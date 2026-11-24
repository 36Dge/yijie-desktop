// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import ChatTraceNotices from "./ChatTraceNotices.vue";

enableAutoUnmount(afterEach);
it("shows one row per visible MCP call, with a separate original clock for repeated titles", async () => {
  const start = Date.UTC(2026, 0, 4, 10, 0);
  const view: NativeConversationView = {
    sessionId: "s", turnId: "t", runtimeThreadId: "r", runtimeTurnId: "rt", ordinal: 0,
    revision: "1", source: "native_observed", availability: "available", status: "completed",
    statusSource: "runtime_notification", terminalObserved: true,
    items: ["青岛", "上海", "青岛", "上海"].map((city, ordinal) => ({
      ordinal, lastMethod: "item/completed", callStartedAtMs: start + ordinal * 500,
      item: traceItem("call-" + ordinal, "mcpToolCall", {
        status: ordinal === 3 ? "failed" : "completed", durationMs: 2400, resultSummary: "已返回天气观测。",
        toolDisplay: {provenance: "registeredTool", title: "查询天气 · " + city},
        mcp: {server: "weather", tool: "get_weather", resultKind: "text", texts: [{index: 0, text: "记录"}], diagnostics: []},
      }),
    })),
  };
  const state = composeConversationView({threads: [{threadId: "s", status: "ready"}], turns: [], items: []}, [view]);
  const turn = selectConversationTimeline(state, "s")!.turns[0]!;
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  await wrapper.get(".chat-activity-group__toggle").trigger("click");
  const rows = wrapper.findAll(".mcp-tool-row");
  expect(rows.map(row => row.get("button strong").text())).toEqual(["查询天气 · 青岛", "查询天气 · 上海", "查询天气 · 青岛"]);
  expect(rows.map(row => row.element.querySelector("button time")?.getAttribute("datetime"))).toEqual([
    new Date(start).toISOString(), undefined, new Date(start + 1000).toISOString(),
  ]);
  expect(wrapper.find(".chat-tool-call-status").exists()).toBe(false);
  await rows[0]!.get("button").trigger("click");
  expect(rows[0]!.get(".chat-execution-details__footer").text()).toBe("调用成功 · 用时 2.4 秒");
  expect(rows[0]!.get(".chat-execution-details").text()).toContain("已返回天气观测。");
  expect(wrapper.findAll(".chat-tool-call-status")).toHaveLength(1);
  await rows[0]!.get("button").trigger("click");
  expect(wrapper.find(".chat-tool-call-status").exists()).toBe(false);
  expect(rows[0]!.find(".chat-execution-details time").exists()).toBe(false);
});
it("numbers visible image views across groups and shows their own result after an interrupted turn", async () => {
  const image = (id: string) => traceItem(id, "imageView", {
    toolLabel: "查看图片", toolDisplay: {provenance: "registeredTool", title: "查看图片", sourceLabel: "原生工具"},
  });
  const turn = traceTurn([
    image("first"), traceItem("command", "commandExecution", {exitCode: 0}), image("second"),
    traceItem("opening", "agentMessage", {phase: "commentary", text: "接下来检查窄屏效果。"}),
    traceItem("failed", "imageView", {status: "failed"}), image("third"),
  ]);
  turn.domainStatus = turn.terminalStatus = "interrupted";
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  const mixed = wrapper.get(".chat-activity-group__toggle");
  expect(mixed.text()).toBe("查看图片 2 次，运行了命令");
  expect(mixed.get("svg").classes()).toContain("lucide-scan-eye");
  await mixed.trigger("click");
  const rows = wrapper.findAll("button.chat-timeline-item-shell__disclosure").filter(row => row.text() === "查看图片");
  expect(rows).toHaveLength(3);
  for (const [index, row] of rows.entries()) {
    expect(row.get("svg").classes()).toContain("lucide-scan-eye");
    expect(row.attributes("aria-description")).toBe("已读取图片");
    await row.trigger("click");
    const detail = wrapper.get(`[id="${row.attributes("aria-controls")}"]`);
    expect(detail.text()).toBe(`已读取图片 · 本轮第 ${index + 1} 次查看`);
    expect(detail.find("pre, h3").exists()).toBe(false);
  }
});

it("uses the same book icon on a completed fetch group and its rows", async () => {
  const items = ["home", "board"].map(id => traceItem(id, "mcpToolCall", {
    mcp: {server: "yijie_web", tool: "kimi_web_fetch", resultKind: "omitted", texts: [], diagnostics: []},
  }));
  const wrapper = mount(ChatTurnGroup, {props: {turn: traceTurn(items), position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  const group = wrapper.get(".chat-activity-group__toggle");
  expect(group.get("svg").classes()).toContain("lucide-book-open-text");
  expect(group.text()).toBe("读取指定网页 2 次");
  expect(group.find(".chat-activity-chevron.lucide-chevron-right").exists()).toBe(true);
  await group.trigger("click");
  expect(group.find(".chat-activity-chevron.lucide-chevron-down").exists()).toBe(true);
  expect(wrapper.findAll(".web-fetch-row .lucide-book-open-text")).toHaveLength(2);
  expect(wrapper.findAll(".web-fetch-row button").map(button => button.text())).toEqual(["读取指定网页", "读取指定网页"]);
});

it.each([
  {last: traceItem("command", "commandExecution", {exitCode: 0}), glyph: "lucide-square-terminal"},
  {last: traceItem("plugin", "mcpToolCall", {mcp: {
    server: "external", tool: "kimi_web_search_pro", resultKind: "empty", texts: [], diagnostics: [],
  }}), glyph: "lucide-cable"},
])("matches the final row's $glyph icon after a web search", async ({last, glyph}) => {
  const turn = traceTurn([traceItem("web", "webSearch"), last]);
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  const group = wrapper.get(".chat-activity-group__toggle");
  expect(group.get("svg").classes()).toContain(glyph);
  await group.trigger("click");
  const rows = wrapper.findAll("[data-activity-item]");
  expect(rows[rows.length - 1]!.get("button svg").classes()).toContain(glyph);
});

it("switches the header icon immediately between parallel tools and restores the last visible tool in history", async () => {
  vi.useFakeTimers({now: 0});
  try {
    const deep = (id: string, status: "inProgress" | "completed" = "completed") => traceItem(id, "mcpToolCall", {
      status, mcp: {server: "yijie_web", tool: "kimi_web_search_pro", resultKind: "omitted", texts: [], diagnostics: []},
    });
    const web = (status: "inProgress" | "completed") => traceItem("web", "webSearch", {
      status, webSearch: {action: "search", queries: ["杭州统计公报"]},
    });
    const active = [deep("one"), deep("two"), deep("three", "inProgress")];
    const wrapper = mount(ChatTurnGroup, {props: {turn: traceTurn(active, true), position: 1}});
    const group = () => wrapper.get(".chat-activity-group__toggle");
    expect(group().get("svg").classes()).toContain("lucide-scan-search");
    await group().trigger("click");

    await wrapper.setProps({turn: traceTurn([...active, web("inProgress")], true)});
    expect(group().get("svg").classes()).toContain("lucide-globe");
    expect(group().attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".chat-web-search__toggle svg").classes()).toContain("lucide-globe");

    // The later search has finished while the earlier deep search is still running.
    const remaining = traceTurn([...active, web("completed")], true);
    await wrapper.setProps({turn: remaining});
    expect(group().get("svg").classes()).toContain("lucide-scan-search");
    await wrapper.setProps({turn: {...remaining, traceSequence: "8", traceNotices: [
      {eventId: "retry", sequence: "8", scope: "turn", method: "error", code: "transport_error", willRetry: true},
    ]}});
    expect(group().get("svg").classes()).toContain("lucide-scan-search");

    const history = [deep("one"), deep("two"), deep("three"), web("completed")];
    await wrapper.setProps({turn: traceTurn(history, true)});
    expect(group().get("svg").classes()).toContain("lucide-globe");
    await wrapper.setProps({turn: traceTurn(history)});
    expect(group().get("svg").classes()).toContain("lucide-globe");
    expect(group().text()).toBe("网页深度搜索 3 次，搜索网页 杭州统计公报");
    const reopened = mount(ChatTurnGroup, {props: {turn: traceTurn(history), position: 1}});
    expect(reopened.get(".chat-activity-group__toggle svg").classes()).toContain("lucide-globe");

    await wrapper.setProps({turn: traceTurn([web("completed"), deep("last"), traceItem("other", "unknown")])});
    expect(group().get("svg").classes()).toContain("lucide-scan-search");
  } finally {
    vi.useRealTimers();
  }
});

it("folds the process at the first answer and restores the chosen inner group on reopening", async () => {
  const items = [traceItem("u", "userMessage", {text: "Read the project"}), traceItem("p", "agentMessage", {phase: "commentary", text: "I will read the project."}), traceItem("c", "commandExecution", {status: "completed", exitCode: 0, commandActions: [{index: 0, kind: "read", label: "README.md"}]}), traceItem("r", "reasoning", {summary: ["Process detail"]})];
  const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: traceTurn(items, true), position: 1}});
  const group = wrapper.get(".chat-activity-group__toggle");
  expect(group.attributes("aria-description")).toBe("1 次调用 · 1 个命令动作");
  expect(group.text()).not.toContain("1 次调用");
  expect(group.attributes("aria-expanded")).toBe("false");
  await group.trigger("click");
  expect(group.attributes("aria-expanded")).toBe("true");
  const final = traceItem("f", "agentMessage", {phase: "final_answer", text: "Final result"});
  await wrapper.setProps({turn: traceTurn([...items, final])});
  expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
  expect(group.isVisible()).toBe(false);
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  expect(group.isVisible()).toBe(true);
  expect(group.attributes("aria-expanded")).toBe("true");
  expect(wrapper.text()).toContain("Final result");
});
it("folds ordinary cold history without replaying failed tools or past retries", () => {
  const turn = traceTurn([traceItem("s", "webSearch", {webSearch: {action: "search", queries: ["Annual statistics"]}}), traceItem("e", "commandExecution", {status: "failed", exitCode: 1}), traceItem("f", "agentMessage", {phase: "final_answer", text: "Result"})]);
  turn.traceNotices = [{eventId: "notice", sequence: "1", method: "error", code: "transport_error", scope: "turn", willRetry: true}];
  const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn, position: 1}});
  expect(wrapper.get(".chat-activity-group").isVisible()).toBe(false);
  expect(wrapper.find(".chat-turn-group__item--command").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("运行时曾报告重试");
  expect(wrapper.text()).not.toContain("第 2 次搜索");
  expect(wrapper.find(".chat-archive-activity").exists()).toBe(false);
});

it("shows only the turn-scoped copy of a native warning", () => {
  const turn = traceTurn([traceItem("a", "agentMessage", {text: "Answer"})]);
  turn.traceNotices = [
    {eventId: "thread-notice", sequence: "1", method: "warning", code: "answer_completion_continuing", scope: "thread"},
    {eventId: "turn-notice", sequence: "2", method: "warning", code: "answer_completion_continuing", scope: "turn"},
  ];
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  expect(wrapper.findAll(".chat-trace-notices details")).toHaveLength(1);
  expect(wrapper.get(".chat-trace-notices summary").text()).toBe("本轮提示");
  expect(wrapper.get(".chat-trace-notices details").attributes("open")).toBeUndefined();
  expect(wrapper.text()).not.toContain("answer_completion_continuing");
});

it("hides generic warning-only notices without removing facts, meaningful notices or error state", async () => {
  const warnings = [1, 2, 3, 4].map(i => ({eventId: `warning-${i}`, sequence: String(i), method: "warning" as const, code: "runtime_notice", scope: "thread" as const}));
  const before = JSON.stringify(warnings);
  const wrapper = mount(ChatTraceNotices, {props: {notices: warnings}});
  expect(wrapper.find(".chat-trace-notices").exists()).toBe(false);
  await wrapper.setProps({notices: [...warnings,
    {eventId: "known", sequence: "5", method: "warning", code: "answer_completion_continuing", scope: "turn"},
    {eventId: "retry", sequence: "6", method: "error", code: "runtime_notice", scope: "turn", willRetry: true},
    {eventId: "failed", sequence: "7", method: "error", code: "runtime_notice", scope: "turn", willRetry: false},
  ]});
  expect(wrapper.findAll("details")).toHaveLength(1);
  expect(wrapper.text()).toContain("正在根据已有结果补全回答");
  expect(wrapper.text()).not.toContain("运行时曾报告重试");
  expect(wrapper.text()).not.toContain("运行错误，未安排重试");
  expect(wrapper.text()).not.toContain("未提供可显示的详细原因");
  expect(JSON.stringify(warnings)).toBe(before);
});
