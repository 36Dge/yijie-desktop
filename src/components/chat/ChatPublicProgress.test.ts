// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import type { NativeItem } from "../../api/generated/native-conversation-private.gen";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import { conversationActivityPresentation } from "../../domain/conversation-activity-presentation";
import ChatTurnGroup from "./ChatTurnGroup.vue";

enableAutoUnmount(afterEach);
const message = (id: string, text: string, phase?: "commentary" | "final_answer") => traceItem(id, "agentMessage", {text, ...(phase ? {phase} : {})});
const reasoning = (id: string) => traceItem(id, "reasoning", {summary: ["## 比较范围\n\n普通摘要内容。"]});
const command = (id: string) => traceItem(id, "commandExecution", {commandLabel: "pwd", exitCode: 0});
const render = (items: NativeItem[], live = false) => mount(ChatTurnGroup, {attachTo: document.body, props: {turn: traceTurn(items, live), position: 1, timingLabel: "已用时 12 秒"}});
const summary = ".chat-turn-group__reasoning-summary";
const opening = ".chat-turn-group__item--commentary";
function before(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("native public progress reading", () => {
  it("leads with the public opening and keeps reasoning from splitting continuous tools", async () => {
    const items = [reasoning("r0"), message("opening", "我会先比较范围。", "commentary"), command("c1"), reasoning("r1"), command("c2"), message("interim", "已明确两种不同范围。", "commentary"), command("c3"), message("final", "分别评价这两种范围。", "final_answer")];
    const saved = JSON.stringify(items), wrapper = render(items);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(before(wrapper.findAll(opening)[0]!.element, wrapper.get(summary).element)).toBe(true);
    expect(wrapper.findAll(".chat-activity-group")).toHaveLength(2);
    // Single-call groups intentionally omit a redundant count label.
    expect(wrapper.findAll(".chat-activity-group__counts").map(node => node.text())).toEqual(["2 次调用"]);
    const groups = conversationActivityPresentation(traceTurn(items)).filter(node => node.kind === "activity");
    expect(groups.map(node => node.group.items.length)).toEqual([2, 1]);
    expect(wrapper.findAll(opening).map(node => node.get(".chat-safe-content").text())).toEqual(["我会先比较范围。", "已明确两种不同范围。"]);
    expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
    expect(JSON.stringify(items)).toBe(saved);
  });

  it("moves an existing summary entry after a newly streamed opening without resetting its disclosure", async () => {
    const wrapper = render([reasoning("r")], true);
    await wrapper.get(`${summary} button`).trigger("click");
    const button = wrapper.get(`${summary} button`).element;
    const items = [reasoning("r"), message("opening", "我会先区分城市体验的范围。", "commentary")];
    await wrapper.setProps({turn: traceTurn(items, true)});
    expect(before(wrapper.get(opening).element, wrapper.get(summary).element)).toBe(true);
    expect(wrapper.get(`${summary} button`).element).toBe(button);
    expect(wrapper.get(`${summary} button`).attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(opening).isVisible()).toBe(true);
    expect(wrapper.find(".chat-turn-group__item--final_answer").exists()).toBe(false);
  });

  it("preserves separate public messages and history through final start and remount", async () => {
    const records = [message("opening", "我会区分范围。", "commentary"), reasoning("r"), message("interim", "两种评价标准需要分别使用。", "commentary")];
    const wrapper = render(records, true);
    const finalRecords = [...records, message("answer", "这是完整的比较结果。", "final_answer")];
    const saved = JSON.stringify(finalRecords);
    await wrapper.setProps({turn: traceTurn(finalRecords, true)});
    expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(wrapper.findAll(opening).every(node => node.isVisible())).toBe(true);
    wrapper.unmount();
    const reopened = render(JSON.parse(saved));
    await reopened.get(".chat-turn-group__process-toggle").trigger("click");
    expect(before(reopened.findAll(opening)[0]!.element, reopened.get(summary).element)).toBe(true);
    expect(reopened.findAll(opening)).toHaveLength(2);
    expect(JSON.stringify(finalRecords)).toBe(saved);
  });

  it("keeps all no-tool unknown-phase messages readable without inventing phases or folding answers", async () => {
    const items = [reasoning("r"), message("first", "第一段公开消息。"), message("second", "第二段公开消息。"), message("last", "第三段公开消息。")];
    const original = JSON.stringify(items), wrapper = render(items);
    const nodes = conversationActivityPresentation(traceTurn(items));
    expect(nodes.every(node => node.kind !== "message" || !node.process)).toBe(true);
    expect(wrapper.findAll(".chat-turn-group__item--assistant_unclassified").every(node => node.isVisible())).toBe(true);
    expect(wrapper.findAll(".chat-turn-group__item--assistant_unclassified")).toHaveLength(3);
    expect(wrapper.find(".chat-turn-group__item--final_answer").exists()).toBe(false);
    expect(JSON.stringify(items)).toBe(original);
  });

  it.each([undefined, "final_answer"] as const)("preserves the existing final-only history layout for phase=%s", phase => {
    const wrapper = render([reasoning("r"), message("answer", "杭州这轮已有的可读正文。", phase)]);
    const answer = wrapper.get(phase ? ".chat-turn-group__item--final_answer" : ".chat-turn-group__item--assistant_unclassified");
    expect(before(wrapper.get(summary).element, answer.element)).toBe(true);
    expect(answer.isVisible()).toBe(true);
  });

  it("uses an observed tool continuation only for reading placement, preserving missing native phase", async () => {
    const items = [reasoning("r"), message("opening", "我会核对这个工作目录。"), command("c"), message("answer", "工作目录已核对。")];
    const original = JSON.stringify(items), wrapper = render(items);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    const messages = wrapper.findAll(".chat-turn-group__item--assistant_unclassified");
    expect(before(messages[0]!.element, wrapper.get(summary).element)).toBe(true);
    expect(messages[1]!.isVisible()).toBe(true);
    expect(JSON.stringify(items)).toBe(original);
  });
});
