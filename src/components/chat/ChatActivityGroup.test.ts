// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import ChatTurnGroup from "./ChatTurnGroup.vue";

enableAutoUnmount(afterEach);
it("keeps group and turn choices while final text arrives, with readable native detail", async () => {
  const items = [traceItem("u", "userMessage", {text: "Read the project"}), traceItem("p", "agentMessage", {phase: "commentary", text: "I will read the project."}), traceItem("c", "commandExecution", {status: "completed", exitCode: 0, commandActions: [{index: 0, kind: "read", label: "README.md"}]}), traceItem("r", "reasoning", {summary: ["Process detail"]})];
  const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: traceTurn(items, true), position: 1}});
  const group = wrapper.get(".chat-activity-group__toggle");
  expect(group.text()).toContain("1 次调用");
  expect(group.attributes("aria-expanded")).toBe("false");
  await group.trigger("click");
  expect(group.attributes("aria-expanded")).toBe("true");
  const final = traceItem("f", "agentMessage", {phase: "final_answer", text: "Final result"});
  await wrapper.setProps({turn: traceTurn([...items, final])});
  expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("true");
  expect(group.attributes("aria-expanded")).toBe("true");
  expect(wrapper.text()).toContain("Final result");
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  expect(wrapper.get(".chat-activity-group").isVisible()).toBe(false);
  expect(wrapper.text()).toContain("Final result");
});
it("folds ordinary cold history, preserves errors and shows retry intent without turning it into failure", () => {
  const turn = traceTurn([traceItem("s", "webSearch", {webSearch: {action: "search", queries: ["Annual statistics"]}}), traceItem("e", "commandExecution", {status: "failed", exitCode: 1}), traceItem("f", "agentMessage", {phase: "final_answer", text: "Result"})]);
  turn.traceNotices = [{eventId: "notice", sequence: "1", method: "error", code: "transport_error", scope: "turn", willRetry: true}];
  const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn, position: 1}});
  expect(wrapper.get(".chat-activity-group").isVisible()).toBe(false);
  expect(wrapper.findAll(".chat-timeline-item-shell__header").some(row => row.isVisible() && row.text().includes("执行失败"))).toBe(true);
  expect(wrapper.text()).toContain("运行时曾报告重试");
  expect(wrapper.text()).not.toContain("第 2 次搜索");
  expect(wrapper.find(".chat-archive-activity").exists()).toBe(false);
});

it("keeps notice scope readable without exposing opaque runtime codes", () => {
  const turn = traceTurn([traceItem("a", "agentMessage", {text: "Answer"})]);
  turn.traceNotices = [{eventId: "notice", sequence: "1", method: "warning", code: "runtime_notice", scope: "thread"}];
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  expect(wrapper.get(".chat-trace-notices summary").text()).toBe("对话运行提示");
  expect(wrapper.get(".chat-trace-notices details").attributes("open")).toBeUndefined();
  expect(wrapper.text()).not.toContain("runtime_notice");
});
