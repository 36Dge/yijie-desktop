// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed } from "vue";
import { messageFileActionKey } from "../../composables/useChatMessageLink";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatSafeContent from "./ChatSafeContent.vue";
import { webSourceActionsKey } from "../../composables/useWebSources";

enableAutoUnmount(afterEach);
const target = {sessionId: "session", turnId: "turn", itemId: "answer"};
const url = "https://example.org/guide?q=city#overview";
const blocks = (text: string) => [{identity: "body", blockIndex: 0, type: "text" as const, text}];
function render(text: string, openMessageLink = vi.fn(async () => {})) {
  return {openMessageLink, wrapper: mount(ChatSafeContent, {attachTo: document.body,
    props: {blocks: blocks(text), linkTarget: target},
    global: {provide: {[webSourceActionsKey as symbol]: {openMessageLink, open: vi.fn(), icon: vi.fn()}}},
  })};
}
describe("conversation text hyperlinks", () => {
  it("shows only the label, reveals the exact URL on hover/focus, and opens through the native scope", async () => {
    const {wrapper, openMessageLink} = render(`详情见[相关说明](${url})。`);
    const link = wrapper.get("a");
    expect(wrapper.text()).toBe("详情见相关说明。");
    expect(link.attributes("href")).toBe(url);
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    expect(openMessageLink).not.toHaveBeenCalled();
    await link.trigger("mouseenter"); await flushPromises();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(url);
    expect(link.attributes("aria-describedby")).toBeTruthy();
    await link.trigger("mouseleave"); await link.trigger("focus"); await flushPromises();
    expect(link.attributes("aria-describedby")).toBeTruthy();
    await link.trigger("keydown", {key: "Escape"});
    expect(link.attributes("aria-describedby")).toBeUndefined();
    await link.trigger("click"); await flushPromises();
    expect(openMessageLink).toHaveBeenCalledExactlyOnceWith({...target, url});
  });
  it("inherits the original message scope in headings, nested lists, quotes and tables", async () => {
    const {wrapper, openMessageLink} = render(`## [标题](${url})\n\n- [路线来源](${url})\n  - [补充](${url})\n\n> [引用](${url})\n\n| [地点](${url}) | 特色 |\n| --- | --- |\n| [资料](${url}) | 普通内容 |`);
    const links = wrapper.findAll("a");
    expect(links.map(link => link.text())).toEqual(["标题", "路线来源", "补充", "引用", "地点", "资料"]);
    await links[links.length - 1]!.trigger("auxclick", {button: 1}); await flushPromises();
    expect(openMessageLink).toHaveBeenCalledExactlyOnceWith({...target, url});
  });
  it("keeps a partial streamed destination out of the body and activates only the completed link", async () => {
    const {wrapper, openMessageLink} = render("");
    await wrapper.setProps({streaming: true, animate: false, blocks: blocks("见[路线来源](https://example.org/")});
    expect(wrapper.text()).toBe("见路线来源"); expect(wrapper.find("a").exists()).toBe(false);
    await wrapper.setProps({blocks: blocks(`见[路线来源](${url})`)});
    expect(wrapper.text()).toBe("见路线来源"); expect(wrapper.get("a").attributes("href")).toBe(url);
    expect(openMessageLink).not.toHaveBeenCalled();
  });
  it("reports a normal open failure, retries on explicit click, and does not rewrite the source", async () => {
    const text = `[相关说明](${url})`;
    const open = vi.fn(async () => {}).mockRejectedValueOnce(new Error("temporarily unavailable"));
    const {wrapper} = render(text, open);
    await wrapper.get("a").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("再次点击重试");
    await wrapper.get("a").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
    expect(wrapper.props("blocks")).toEqual(blocks(text));
  });
  it("preserves plain user messages and code as source text", () => {
    const text = `[相关说明](${url})`;
    const wrapper = mount(ChatSafeContent, {props: {blocks: blocks(text), mode: "plain", linkTarget: target}});
    expect(wrapper.text()).toBe(text); expect(wrapper.find("a").exists()).toBe(false);
    const {wrapper: code} = render(`\`\`\`md\n${text}\n\`\`\``);
    expect(code.get("code").text()).toBe(text); expect(code.find("a").exists()).toBe(false);
  });
});

describe("conversation output file links", () => {
  const path = "/Users/example/Desktop/杭州旅游介绍 (初稿).md";
  const uri = "file://" + encodeURI(path);
  const source = `已生成并保存到你的电脑桌面：\n\n**[杭州旅游介绍.md](${uri})**\n\n路径：\`${path}\``;
  function renderFile(text: string, streaming = false) {
    const open = vi.fn();
    const wrapper = mount(ChatSafeContent, { attachTo: document.body,
      props: {blocks: blocks(text), linkTarget: target, fileLinks: true, streaming, animate: false},
      global: {provide: {[messageFileActionKey as symbol]: computed(() => open)}},
    });
    return { wrapper, open };
  }
  it("folds the duplicate path, shows the decoded location on hover/focus and opens only on activation", async () => {
    const { wrapper, open } = renderFile(source);
    const links = wrapper.findAll('[role="link"]');
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.text()).toBe("《杭州旅游介绍 (初稿).md》");
    expect(link.find("svg").exists()).toBe(true);
    expect(wrapper.text()).toBe("已生成并保存到你的电脑桌面：《杭州旅游介绍 (初稿).md》");
    expect(wrapper.find("[href]").exists()).toBe(false);
    await link.trigger("mouseenter"); await flushPromises();
    expect(document.getElementById(link.attributes("aria-describedby")!)?.textContent).toBe(path);
    await link.trigger("mouseleave"); (link.element as HTMLButtonElement).focus(); await link.trigger("focusin");
    expect(link.attributes("aria-describedby")).toBeTruthy();
    await link.trigger("keydown", {key: "Escape"});
    expect(link.attributes("aria-describedby")).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    await link.trigger("click");
    expect(open).toHaveBeenCalledExactlyOnceWith(target, { raw: uri, path, name: "杭州旅游介绍 (初稿).md" });
    expect(wrapper.props("blocks")).toEqual(blocks(source));
  });
  it("recognizes different formats, preserves same-name files in other directories and skips fenced examples", () => {
    const text = "- **[预览](/work/a/报告.pdf)**\n\n路径：/work/b/报告.pdf\n\n> [表格](</work/计划 (1).xlsx>)\n\n| 海报 | 视频 |\n| --- | --- |\n| `/work/封面.png` | [观看](/work/演示.mp4) |\n\n```txt\n/work/例子.html\n```";
    const { wrapper } = renderFile(text);
    expect(wrapper.findAll('[role="link"]').map(link => link.attributes("data-yj-tooltip"))).toEqual([
      "/work/a/报告.pdf", "/work/b/报告.pdf", "/work/计划 (1).xlsx", "/work/封面.png", "/work/演示.mp4",
    ]);
    expect(wrapper.get("pre").text()).toBe("/work/例子.html");
  });
  it("activates a streamed bold output only after the destination closes", async () => {
    const { wrapper } = renderFile("**[指南](file:///Users/example/Desk", true);
    expect(wrapper.text()).toBe("指南");
    expect(wrapper.find('[role="link"]').exists()).toBe(false);
    await wrapper.setProps({blocks: blocks(source)});
    expect(wrapper.findAll('[role="link"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain("/Users/");
  });
});
