// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatStreamText from "./ChatStreamText.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
let time = 0; let id = 0;
const callbacks = new Map<number, FrameRequestCallback>();
const wrappers: { unmount(): void }[] = [];
beforeEach(() => {
  time = 0; callbacks.clear();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.set(++id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
});
afterEach(() => { document.getSelection()?.removeAllRanges(); wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function advance(ms = 16) {
  const until = time + ms;
  while (time < until) {
    time = Math.min(until, time + 16);
    const work = [...callbacks.values()]; callbacks.clear(); work.forEach(cb => cb(time)); await nextTick();
  }
}
async function drain() {
  for (let i = 0; callbacks.size && i < 1000; i++) await advance();
  expect(callbacks.size).toBe(0);
}
const block = (text: string) => [{identity: "body", blockIndex: 0, type: "text" as const, text}];
describe("message-wide stream presentation", () => {
  it.each(["final_answer", undefined] as const)("folds the process at the first answer text and waits for the last fade before showing actions (%s)", async phase => {
    const processItems = [
      traceItem("opening", "agentMessage", {phase: "commentary", text: "先整理资料。"}),
      traceItem("summary", "reasoning", {summary: ["整理重点"]}),
      traceItem("tool", "webSearch", {webSearch: {action: "search", queries: ["资料"]}}),
    ];
    const text = "这是正式回答。".repeat(25);
    const answerTurn = (body: string, live: boolean) => traceTurn([...processItems,
      traceItem("answer", "agentMessage", {text: body, phase, status: live ? "inProgress" : "completed"}),
    ], live);
    const wrapper = mount(ChatTurnGroup, {
      attachTo: document.body, props: {turn: answerTurn("", true), position: 1},
      slots: {"item-actions": () => h("button", "回答操作")},
    });
    wrappers.push(wrapper);
    const toggle = wrapper.get(".chat-turn-group__process-toggle");
    await toggle.trigger("click");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await wrapper.setProps({turn: answerTurn(text, true)});
    expect(toggle.attributes("aria-expanded")).toBe("false");
    for (const selector of [".chat-turn-group__reasoning-summary", ".chat-activity-group", ".chat-turn-group__item--commentary"]) {
      expect(wrapper.get(selector).isVisible()).toBe(false);
    }
    await advance(48);
    const body = wrapper.get(".chat-safe-content--answer");
    expect(body.text().length).toBeGreaterThan(0);
    expect(body.text().length).toBeLessThan(text.length);
    await toggle.trigger("click");
    await wrapper.setProps({turn: answerTurn(text, false)});
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const footer = ".chat-timeline-item-shell__answer-actions";
    expect(wrapper.find(footer).exists()).toBe(false);
    for (let i = 0; i < 500 && body.text() !== text; i++) await advance();
    expect(body.text()).toBe(text);
    expect(body.find(".chat-stream-text__fresh").exists()).toBe(true);
    expect(wrapper.find(footer).exists()).toBe(false);
    await drain();
    expect(wrapper.get(footer).text()).toBe("回答操作");
  });
  it("reveals a burst progressively, keeps its prefix and settles without animation events", async () => {
    const wrapper = mount(ChatStreamText, {props: {text: "前文", streaming: false}}); wrappers.push(wrapper);
    await wrapper.setProps({streaming: true});
    await wrapper.setProps({text: "前文" + "新增文字。".repeat(30)});
    await advance(32);
    expect(wrapper.text().startsWith("前文")).toBe(true);
    expect(wrapper.text().length).toBeLessThan(wrapper.props("text").length);
    await wrapper.setProps({streaming: false}); await advance(128);
    expect(wrapper.text().length).toBeLessThan(wrapper.props("text").length);
    await drain();
    expect(wrapper.text()).toBe(wrapper.props("text"));
    await advance(250); expect(wrapper.find(".chat-stream-text__fresh").exists()).toBe(false);
  });
  it("continues revealing later arrivals inside the same Markdown paragraph", async () => {
    const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: block("稳定前文")}}); wrappers.push(wrapper);
    await drain();
    for (let i = 1; i <= 3; i++) {
      const next = "稳定前文" + "追加文字".repeat(i * 20);
      await wrapper.setProps({blocks: block(next)});
      await advance(32);
      expect(wrapper.text().length).toBeLessThan(next.length);
      expect(next.startsWith(wrapper.text())).toBe(true);
      await drain(); expect(wrapper.text()).toBe(next);
    }
  });
  it("does not replay history, replacements, hidden or reopened process content", async () => {
    const wrapper = mount(ChatSafeContent, {props: {blocks: block("已有内容"), streaming: false}}); wrappers.push(wrapper);
    expect(wrapper.text()).toBe("已有内容");
    await wrapper.setProps({streaming: true}); expect(wrapper.text()).toBe("已有内容");
    await wrapper.setProps({blocks: block("修订内容")}); expect(wrapper.text()).toBe("修订内容");
    await wrapper.setProps({animate: false, blocks: block("修订内容与隐藏期间新增")});
    expect(wrapper.text()).toBe("修订内容与隐藏期间新增");
    await wrapper.setProps({animate: true}); expect(callbacks.size).toBe(0);
  });
  it("advances in source order across paragraphs and nested Markdown, preserving stable DOM", async () => {
    const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: block("稳定的前文。")}}); wrappers.push(wrapper);
    await drain(); const paragraph = wrapper.get("p").element;
    await wrapper.setProps({blocks: block("稳定的前文。\n\n## 标题\n\n- **强调**\n\n| 类型 | 结果 |\n| --- | --- |\n| 普通 | 完整 |\n\n```js\nconst value = 1;\n```")});
    await advance(16); expect(wrapper.find('pre').exists()).toBe(false);
    await drain();
    expect(wrapper.get("p").element).toBe(paragraph);
    expect(wrapper.get("h2").text()).toBe("标题"); expect(wrapper.get("li strong").text()).toBe("强调");
    expect(wrapper.findAll("td").map(cell => cell.text())).toEqual(["普通", "完整"]);
    expect(wrapper.get("pre code").text()).toBe("const value = 1;");
  });
  it("keeps provisional Markdown formatted and uses the original terminal fallback", async () => {
    const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: block("**重点")}}); wrappers.push(wrapper);
    await drain(); const strong = wrapper.get('strong').element;
    await wrapper.setProps({blocks: block("**重点内容**")}); await drain();
    expect(wrapper.get('strong').element).toBe(strong); expect(wrapper.text()).toBe("重点内容");
    await wrapper.setProps({blocks: block("```js\nconst value =")}); const code = wrapper.get('pre code').element;
    await wrapper.setProps({blocks: block("```js\nconst value = 1;\n```")}); await drain();
    expect(wrapper.get('pre code').element).toBe(code);
    await wrapper.setProps({blocks: block("**未闭合"), streaming: false}); expect(wrapper.text()).toBe("**未闭合");
  });
  it("does not flush the queued paragraph when an unseen Markdown table becomes complete", async () => {
    const prefix = "仍在均匀展开的正文。".repeat(20) + "\n\n";
    const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: block(prefix + "| 地点 | 特色 |\n")}}); wrappers.push(wrapper);
    await advance(160); const shown = wrapper.text();
    await wrapper.setProps({blocks: block(prefix + "| 地点 | 特色 |\n| --- | --- |\n| 苏州 | 园林 |\n"), streaming: false});
    expect(wrapper.text()).toBe(shown);
    await advance(32); expect(wrapper.text().length - shown.length).toBeLessThanOrEqual(3);
    expect(wrapper.find("table").exists()).toBe(false);
    await drain(); expect(wrapper.findAll("td").map(cell => cell.text())).toEqual(["苏州", "园林"]);
  });
  it("freezes the actual text nodes while the reader selects content", async () => {
    const wrapper = mount(ChatSafeContent, {attachTo: document.body, props: {blocks: block("正在阅读的文字"), streaming: true}}); wrappers.push(wrapper);
    await advance(64); const shown = wrapper.text();
    const range = document.createRange(); range.selectNodeContents(wrapper.get("p").element);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await advance(400); expect(wrapper.text()).toBe(shown); expect(selection.toString()).toBe(shown);
    selection.removeAllRanges(); document.dispatchEvent(new Event("selectionchange")); await drain();
    expect(wrapper.text()).toBe("正在阅读的文字");
  });
});
