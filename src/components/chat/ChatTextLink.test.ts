// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { computed } from "vue";
import { messageFileActionKey, messageFileLocationKey, type LocateMessageFile } from "../../composables/useChatMessageLink";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatArtifactDocumentCard from "./ChatArtifactDocumentCard.vue";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import { historyPageToConversationSnapshot } from "../../api/chat-conversation-adapter";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
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
  it("keeps a submitted URL bound to the same original across local, observed and rebuilt bubbles", async () => {
    const original = `${url} 请给出优化建议。`;
    const history = historyPageToConversationSnapshot(target.sessionId, {
      turns: [{turnId: target.turnId, status: "completed", terminalAt: 2, reasoningStatus: "unavailable",
        reasoningReasonCode: null, reasoning: [], messages: [{messageId: "saved", role: "user", content: original, status: "committed", ordinal: 0, createdAt: 1}]}],
      nextCursor: null,
    });
    const native: NativeConversationView = {sessionId: target.sessionId, turnId: target.turnId, runtimeThreadId: "native-thread",
      runtimeTurnId: "native-turn", source: "native_observed", revision: "1", terminalObserved: true, status: "completed", availability: "available",
      items: [{ordinal: 0, lastMethod: "item/completed", item: {id: "runtime-user", type: "userMessage", availability: "available", text: `${original}\n补充资料：https://example.net/reference`}}]};
    const turn = (views: NativeConversationView[], snapshot = history) =>
      selectConversationTimeline(composeConversationView(snapshot, views), target.sessionId)!.turns[0]!;
    const openUserMessageLink = vi.fn(async () => {});
    const wrapper = mount(ChatTurnGroup, {props: {turn: turn([]), position: 1},
      global: {provide: {[webSourceActionsKey as symbol]: {openUserMessageLink}}}});
    for (const views of [[], [{...native, items: []}], [native], [{...native, source: "native_rebuilt" as const}]]) {
      await wrapper.setProps({turn: turn(views)});
      const bubble = wrapper.get(".chat-turn-group__item--user_message .chat-safe-content__paragraph");
      expect(bubble.element.textContent).toBe(original);
      expect(bubble.findAll('[role="link"]')).toHaveLength(1);
      await bubble.get('[role="link"]').trigger("click"); await flushPromises();
      expect(openUserMessageLink).toHaveBeenLastCalledWith({...target, itemId: `${target.turnId}:user:0`, url});
    }
    await wrapper.setProps({turn: turn([native], {...history, items: []})});
    expect(wrapper.find('[role="link"]').exists()).toBe(false);
    expect(openUserMessageLink).toHaveBeenCalledTimes(4);
  });

  it("opens an exact user URL only on activation, without rendering a navigable external href", async () => {
    const userTarget = {...target, itemId: `${target.turnId}:user:0`};
    const address = "https://example.org/product?sku=42&ref=menu#details";
    const source = `比较（${address}）。\n**不要改写这段说明**`;
    const actions = { openUserMessageLink: vi.fn(async () => {}), openMessageLink: vi.fn(), icon: vi.fn(), open: vi.fn() };
    const wrapper = mount(ChatSafeContent, {attachTo: document.body,
      props: {blocks: blocks(source), mode: "plain", typography: "user", linkTarget: userTarget},
      global: {provide: {[webSourceActionsKey as symbol]: actions}},
    });
    const link = wrapper.get('a[role="link"]');
    expect(wrapper.get("p").element.textContent).toBe(source);
    expect(link.text()).toBe(address);
    expect(link.attributes("href")).toBeUndefined();
    expect(link.attributes("tabindex")).toBe("0");
    await link.trigger("mouseenter");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await link.trigger("mouseleave"); await link.trigger("focus");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(link.attributes("aria-describedby")).toBeUndefined();
    expect(link.attributes("title")).toBeUndefined();
    expect(actions.openUserMessageLink).not.toHaveBeenCalled();
    await link.trigger("click"); await flushPromises();
    expect(actions.openUserMessageLink).toHaveBeenCalledExactlyOnceWith({...userTarget, url: address});
    await link.trigger("keydown", {key: "Enter"}); await flushPromises();
    expect(actions.openUserMessageLink).toHaveBeenCalledTimes(2);
    expect(actions.open).not.toHaveBeenCalled(); expect(actions.icon).not.toHaveBeenCalled();
    expect(actions.openMessageLink).not.toHaveBeenCalled();
    await wrapper.setProps({linkTarget: undefined});
    expect(wrapper.find('[role="link"]').exists()).toBe(false);
    expect(wrapper.get("p").element.textContent).toBe(source);
  });

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
  it("does not repeat a Markdown link address when its label already displays the whole URL", async () => {
    const {wrapper} = render(`[${url}](${url})`);
    const link = wrapper.get("a");
    await link.trigger("mouseenter");
    expect(link.attributes("href")).toBe(url);
    expect(link.attributes("aria-describedby")).toBeUndefined();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await wrapper.setProps({blocks: blocks(`[相关说明](${url})`)});
    await wrapper.get("a").trigger("focus"); await flushPromises();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(url);
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
  function renderFile(text: string, streaming = false, typography: "compact" | "answer" = "compact", locate?: LocateMessageFile) {
    const open = vi.fn();
    const wrapper = mount(ChatSafeContent, { attachTo: document.body,
      props: {blocks: blocks(text), linkTarget: target, fileLinks: true, streaming, animate: false, typography},
      global: {provide: {[messageFileActionKey as symbol]: computed(() => open), [messageFileLocationKey as symbol]: computed(() => locate)}},
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
  it("resolves the path of a standalone answer link when its tooltip opens", async () => {
    const path = "/work/杭州3天行程.html";
    const locate = vi.fn(async () => path);
    const {wrapper} = renderFile("[行程](./杭州3天行程.html)", false, "answer", locate);
    const link = wrapper.get('[role="link"]');
    expect(wrapper.findComponent(ChatArtifactDocumentCard).exists()).toBe(false);
    expect(locate).not.toHaveBeenCalled();
    await link.trigger("mouseenter"); await flushPromises();
    expect(locate).toHaveBeenCalledExactlyOnceWith(target, expect.objectContaining({path: "杭州3天行程.html"}));
    expect(document.getElementById(link.attributes("aria-describedby")!)?.textContent).toBe(path);
    await link.trigger("mouseleave"); (link.element as HTMLButtonElement).focus(); await link.trigger("focusin");
    expect(document.getElementById(link.attributes("aria-describedby")!)?.textContent).toBe(path);
    expect(locate).toHaveBeenCalledTimes(1);
  });
  it("renders grouped, listed and inline files as ordinary links and preserves media targets and code", async () => {
    const answer = [
      "**[下载行程](./out/行程.html)**  \n[打印版](./out/行程.pdf)",
      "- [表格](./out/预算.xlsx)\n- [另一份行程](./archive/行程.html)",
      "[地图](./out/地图.png)\n[演示](./out/演示.mp4)",
      "参考 [备注](./notes.md)。",
      "```txt\n/work/example.docx\n```",
    ].join("\n\n");
    const { wrapper, open } = renderFile(answer, false, "answer");
    const links = wrapper.findAll(".chat-file-link");
    expect(wrapper.findComponent(ChatArtifactDocumentCard).exists()).toBe(false);
    expect(links.map(link => link.text())).toEqual([
      "《行程.html》", "《行程.pdf》", "《预算.xlsx》", "《行程.html》", "《地图.png》", "《演示.mp4》", "《notes.md》",
    ]);
    expect(links.filter(link => link.attributes("aria-controls") === "conversation-media-preview").map(link => link.text()))
      .toEqual(["《地图.png》", "《演示.mp4》"]);
    expect(wrapper.get("pre").text()).toBe("/work/example.docx");
    expect(open).not.toHaveBeenCalled();
    for (const link of links) await link.trigger("click");
    expect(open.mock.calls.map(([scope, file]) => [scope, file.path])).toEqual([
      [target, "out/行程.html"], [target, "out/行程.pdf"], [target, "out/预算.xlsx"], [target, "archive/行程.html"],
      [target, "out/地图.png"], [target, "out/演示.mp4"], [target, "notes.md"],
    ]);
    expect(wrapper.props("blocks")).toEqual(blocks(answer));
  });
  it("discards a late location after the answer switches to another file with the same name", async () => {
    let finish!: (path: string) => void;
    const locate = vi.fn<LocateMessageFile>()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const {wrapper, open} = renderFile("[报告](./a/报告.html)", false, "answer", locate);
    await wrapper.get('[role="link"]').trigger("mouseenter");
    await wrapper.setProps({blocks: blocks("[报告](./b/报告.html)")});
    finish("/work/a/报告.html");
    await flushPromises();
    const link = wrapper.get('[role="link"]');
    expect(link.attributes("data-yj-tooltip")).toBe("b/报告.html");
    await link.trigger("click");
    expect(open).toHaveBeenCalledExactlyOnceWith(target, expect.objectContaining({path: "b/报告.html"}));
  });
  it.each(["compact", "answer"] as const)("keeps selected file text without opening and preserves click and keyboard activation (%s)", async typography => {
    const { wrapper, open } = renderFile(source, false, typography);
    const link = wrapper.get('[role="link"]');
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(link.get("span").element);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      await link.trigger("pointerdown", { button: 0, clientX: 10, clientY: 10 });
      await link.trigger("click", { detail: 1, clientX: 100, clientY: 10 });
      expect(selection.toString()).toBe("《杭州旅游介绍 (初稿).md》");
      expect(open).not.toHaveBeenCalled();
      await link.trigger("pointerdown", { button: 0, clientX: 100, clientY: 10 });
      await link.trigger("click", { detail: 1, clientX: 100, clientY: 10 });
      expect(open).toHaveBeenCalledTimes(1);
      await link.trigger("click", { detail: 0 });
      expect(open).toHaveBeenCalledTimes(2);
      selection.removeAllRanges();
      await link.trigger("click", { detail: 1 });
      expect(open).toHaveBeenCalledTimes(3);
    } finally {
      selection.removeAllRanges();
    }
  });
  it.each(["compact", "answer"] as const)("activates a streamed bold output only after the destination closes (%s)", async typography => {
    const { wrapper } = renderFile("**[指南](file:///Users/example/Desk", true, typography);
    expect(wrapper.text()).toBe("指南");
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({blocks: blocks(source)});
    expect(wrapper.findAll('[role="link"]')).toHaveLength(1);
    expect(wrapper.findComponent(ChatArtifactDocumentCard).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("/Users/");
  });
});
