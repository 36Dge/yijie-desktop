// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatStreamText from "./ChatStreamText.vue";
import ChatSafeContent from "./ChatSafeContent.vue";

describe("stream text arrival", () => {
  it("renders every character immediately and only fades newly appended text", async () => {
    const wrapper = mount(ChatStreamText, {props: {text: "前文", streaming: true}});
    const first = wrapper.get("span");
    await wrapper.setProps({text: "前文，下一句 🌍"});
    expect(wrapper.text()).toBe("前文，下一句 🌍");
    expect(wrapper.findAll("span").map(node => node.text())).toEqual(["前文", "，下一句 🌍"]);
    expect(wrapper.findAll("span")[0]!.element).toBe(first.element);
    const next = wrapper.findAll("span")[1]!.element;
    await first.trigger("animationend");
    expect(wrapper.text()).toBe("前文，下一句 🌍");
    expect(wrapper.get("span").element).toBe(next);
    await wrapper.setProps({streaming: false});
    expect(wrapper.text()).toBe("前文，下一句 🌍");
    expect(wrapper.find("span").exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not replay historical text, replacements or a reopened process", async () => {
    const wrapper = mount(ChatStreamText, {props: {text: "已有内容", streaming: false}});
    expect(wrapper.find("span").exists()).toBe(false);
    await wrapper.setProps({streaming: true});
    expect(wrapper.find("span").exists()).toBe(false);
    await wrapper.setProps({text: "替换后的内容"});
    expect(wrapper.text()).toBe("替换后的内容");
    expect(wrapper.find("span").exists()).toBe(false);
    await wrapper.setProps({text: ""});
    expect(wrapper.text()).toBe("");
    wrapper.unmount();
  });

  it("bounds decorative ranges even when animation events are disabled", async () => {
    const wrapper = mount(ChatStreamText, {props: {text: "", streaming: true}});
    for (let i = 1; i <= 100; i++) await wrapper.setProps({text: "字".repeat(i)});
    expect(wrapper.text()).toBe("字".repeat(100));
    expect(wrapper.findAll("span").length).toBeLessThanOrEqual(32);
    wrapper.unmount();
  });

  it("keeps Markdown, nested lists, tables and code complete during streaming", async () => {
    const block = (text: string) => [{identity: "body", blockIndex: 0, type: "text" as const, text}];
    const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: block("稳定的前文。")}});
    const paragraph = wrapper.get("p").element;
    await wrapper.setProps({blocks: block("稳定的前文。\n\n## 标题\n\n- **强调**\n\n| 类型 | 结果 |\n| --- | --- |\n| 普通 | 完整 |\n\n```js\nconst value = 1;\n```")});
    expect(wrapper.get("p").element).toBe(paragraph);
    expect(wrapper.get("h2").text()).toBe("标题");
    expect(wrapper.get("li strong").text()).toBe("强调");
    expect(wrapper.findAll("td").map(cell => cell.text())).toEqual(["普通", "完整"]);
    expect(wrapper.get("pre code").text()).toBe("const value = 1;");
    await wrapper.setProps({streaming: false});
    expect(wrapper.find(".chat-stream-text__fresh").exists()).toBe(false);
    wrapper.unmount();
  });
});

it("keeps open Markdown emphasis/code formatted while their delimiters are still arriving", async () => {
  const blocks = (text: string) => [{identity: "stream", blockIndex: 0, type: "text" as const, text}];
  const wrapper = mount(ChatSafeContent, {props: {streaming: true, blocks: blocks("**重点")}});
  const strong = wrapper.get('strong').element;
  expect(wrapper.text()).toBe("重点");
  await wrapper.setProps({blocks: blocks("**重点内容**")});
  expect(wrapper.get('strong').element).toBe(strong);
  expect(wrapper.text()).toBe("重点内容");
  await wrapper.setProps({blocks: blocks("正文 `value")});
  expect(wrapper.get('code').text()).toBe("value");
  await wrapper.setProps({blocks: blocks("```js\nconst value =")});
  const code = wrapper.get('pre code').element;
  expect(wrapper.get('pre').text()).toBe("const value =");
  await wrapper.setProps({blocks: blocks("```js\nconst value = 1;\n```")});
  expect(wrapper.get('pre code').element).toBe(code);
  expect(wrapper.get('pre').text()).toBe("const value = 1;");
  await wrapper.setProps({blocks: blocks("**未闭合"), streaming: false});
  expect(wrapper.text()).toBe("**未闭合");
  expect(wrapper.find('strong').exists()).toBe(false);
  await wrapper.setProps({blocks: blocks("**原始用户输入"), streaming: true, mode: "plain"});
  expect(wrapper.text()).toBe("**原始用户输入");
  expect(wrapper.find('strong').exists()).toBe(false);
  wrapper.unmount();
});

it("does not replace text nodes while the reader is selecting streamed content", async () => {
  const wrapper = mount(ChatStreamText, {attachTo: document.body, props: {text: "正在阅读的文字", streaming: true}});
  const span = wrapper.get('span');
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(span.element);
  selection.addRange(range);
  await span.trigger('animationend');
  expect(wrapper.get('span').element).toBe(span.element);
  expect(selection.toString()).toBe("正在阅读的文字");
  selection.removeAllRanges();
  wrapper.unmount();
});
