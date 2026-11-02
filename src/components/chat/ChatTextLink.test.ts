// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
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
