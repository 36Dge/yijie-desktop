// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import ChatTraceNotices from "./ChatTraceNotices.vue";

enableAutoUnmount(afterEach);
it("shows a hammer on the tool group and a book on each web fetch", async () => {
  const items = ["home", "board"].map(id => traceItem(id, "mcpToolCall", {
    mcp: {server: "yijie_web", tool: "kimi_web_fetch", resultKind: "omitted", texts: [], diagnostics: []},
  }));
  const wrapper = mount(ChatTurnGroup, {props: {turn: traceTurn(items), position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  const group = wrapper.get(".chat-activity-group__toggle");
  expect(group.get("svg").classes()).toContain("lucide-hammer");
  expect(group.text()).toBe("已使用 易界网页检索");
  expect(group.find(".chat-activity-chevron.lucide-chevron-right").exists()).toBe(true);
  await group.trigger("click");
  expect(group.find(".chat-activity-chevron.lucide-chevron-down").exists()).toBe(true);
  expect(wrapper.findAll(".web-fetch-row .lucide-book-open-text")).toHaveLength(2);
  expect(wrapper.findAll(".web-fetch-row button").map(button => button.text())).toEqual(["读取指定网页", "读取指定网页"]);
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
it("folds ordinary cold history, filters failed tools and still reports turn-level retries", () => {
  const turn = traceTurn([traceItem("s", "webSearch", {webSearch: {action: "search", queries: ["Annual statistics"]}}), traceItem("e", "commandExecution", {status: "failed", exitCode: 1}), traceItem("f", "agentMessage", {phase: "final_answer", text: "Result"})]);
  turn.traceNotices = [{eventId: "notice", sequence: "1", method: "error", code: "transport_error", scope: "turn", willRetry: true}];
  const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn, position: 1}});
  expect(wrapper.get(".chat-activity-group").isVisible()).toBe(false);
  expect(wrapper.find(".chat-turn-group__item--command").exists()).toBe(false);
  expect(wrapper.text()).toContain("运行时曾报告重试");
  expect(wrapper.text()).not.toContain("第 2 次搜索");
  expect(wrapper.find(".chat-archive-activity").exists()).toBe(false);
});

it("keeps notice scope readable without exposing opaque runtime codes", () => {
  const turn = traceTurn([traceItem("a", "agentMessage", {text: "Answer"})]);
  turn.traceNotices = [{eventId: "notice", sequence: "1", method: "warning", code: "answer_completion_continuing", scope: "thread"}];
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  expect(wrapper.get(".chat-trace-notices summary").text()).toBe("对话运行提示");
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
  expect(wrapper.text()).toContain("运行时曾报告重试");
  expect(wrapper.text()).toContain("运行错误，未安排重试");
  expect(wrapper.text()).not.toContain("未提供可显示的详细原因");
  expect(JSON.stringify(warnings)).toBe(before);
});
