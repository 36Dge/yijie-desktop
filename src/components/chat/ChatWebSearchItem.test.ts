// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeConversationView, NativeWebSearchDisplay } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { webSourceActionsKey } from "../../composables/useWebSources";
import ChatWebSearchItem from "./ChatWebSearchItem.vue";

enableAutoUnmount(afterEach);
function item(search: NativeWebSearchDisplay = {action: "search", queries: ["杭州 河坊街", "清河坊 历史"], sources: [
  {title: "清河坊历史文化街区", url: "https://example.org/hefang"}, {url: "https://example.org/history"},
]}, active = false, id = "search", live = active) {
  const view: NativeConversationView = {sessionId: "session", turnId: "turn", runtimeThreadId: "thread", runtimeTurnId: "turn",
    source: "native_observed", revision: "1", availability: "available", status: active ? "inProgress" : "completed", statusSource: "runtime_notification",
    terminalObserved: !active, items: [{ordinal: 0, lastMethod: active ? "item/started" : "item/completed", item: {id, type: "webSearch", webSearch: search, availability: "available"}}]};
  return selectConversationTimeline(composeConversationView({threads: [{threadId: "session", status: "ready"}], turns: [], items: []}, [view]),
    "session", undefined, {liveTurnId: live ? "turn" : null, protectApprovalProcessContent: false})!.turns[0]!.items[0]!;
}

describe("compact native web search disclosure", () => {
  it("keeps batch queries and supplied sources together, with title/URL fallback and no requests", async () => {
    const record = item(), before = JSON.stringify(record);
    const wrapper = mount(ChatWebSearchItem, {props: {item: record}});
    const button = wrapper.get("button");
    expect(button.text()).toBe("网页搜索杭州 河坊街 / 清河坊 历史");
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[aria-label="搜索来源"]').exists()).toBe(false);
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get('[role="region"]').attributes("id")).toBe(button.attributes("aria-controls"));
    expect(wrapper.findAll(".chat-web-search__source-title").map(row => row.text())).toEqual(["清河坊历史文化街区", "https://example.org/history"]);
    expect(wrapper.get(".chat-web-search__source").attributes("title")).toBeUndefined();
    expect(wrapper.find("img, iframe").exists()).toBe(false);
    expect(wrapper.get("a").attributes("href")).toBe("https://example.org/hefang");
    expect(wrapper.emitted("disclosure-change")?.[0]?.[0]).toEqual({itemIdentity: record.identity, expanded: true});
    expect(JSON.stringify(record)).toBe(before);
  });

  it("uses a concise topic title while keeping the exact provider query inspectable", () => {
    const query = "新丰小吃 推荐分店 新丰小吃 必点小吃 新丰小吃 分店 人气";
    const record = item({action: "search", queries: [query]});
    const wrapper = mount(ChatWebSearchItem, {props: {item: record, searchOccurrence: 2}});
    expect(wrapper.get("button").text()).toBe("再次搜索新丰小吃 · 推荐分店、必点小吃、分店人气");
    expect(wrapper.get(".chat-web-search__query").attributes("title")).toBe(query);
    expect(record.webSearch?.queries).toEqual([query]);
  });

  it("loads icons lazily, reuses them after folding and opens exactly the selected source", async () => {
    const icon = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const open = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(ChatWebSearchItem, {props: {item: item()}, global: {provide: {[webSourceActionsKey as symbol]: {icon, open}}}});
    expect(icon).not.toHaveBeenCalled();
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(icon).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll("img")).toHaveLength(2);
    await wrapper.get("a").trigger("click");
    expect(open).toHaveBeenCalledWith({sessionId: "session", turnId: "turn", itemId: "search", url: "https://example.org/hefang"});
    await wrapper.get("a").trigger("auxclick", {button: 1});
    expect(open).toHaveBeenCalledTimes(2);
    await wrapper.get("button").trigger("click"); await wrapper.get("button").trigger("click"); await flushPromises();
    expect(icon).toHaveBeenCalledTimes(2);
    open.mockRejectedValueOnce(new Error("temporarily_unavailable"));
    await wrapper.get("a").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("再次点击重试");
    await wrapper.get("a").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("preserves the disclosure when results arrive and the turn completes, resets for another record", async () => {
    const empty: NativeWebSearchDisplay = {action: "search", queries: ["杭州"]};
    const wrapper = mount(ChatWebSearchItem, {props: {item: item(empty, true)}});
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("正在等待网页搜索结果");
    expect(wrapper.get("article").attributes("aria-busy")).toBe("true");
    await wrapper.setProps({item: item()});
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.findAll(".chat-web-search__source")).toHaveLength(2);
    await wrapper.setProps({item: item(empty, false, "next")});
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("false");
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("未提供可展示的搜索来源");
  });

  it("keeps unavailable, interrupted, and permission notes visible while collapsed", async () => {
    const wrapper = mount(ChatWebSearchItem, {props: {item: {...item(), availability: "unavailable"}}});
    expect(wrapper.get('[role="note"]').text()).toContain("内容暂不可用");
    await wrapper.setProps({item: item({action: "search", queries: ["杭州"]}, true, "search", false)});
    expect(wrapper.get("article").attributes("aria-busy")).toBe("false");
    expect(wrapper.text()).toContain("当前进度待确认");
    await wrapper.setProps({item: {...item(), activityLabel: "当前权限不允许读取此记录"}});
    expect(wrapper.get('[role="note"]').text()).toContain("当前权限不允许读取此记录");
  });

  it.each([
    [{action: "openPage", queries: [], pageLabel: "example.org"}, "阅读网页example.org"],
    [{action: "findInPage", queries: [], pageLabel: "example.org", pattern: "文化"}, "查找网页内容example.org · 文化"],
    [{action: "other", queries: []}, "网页活动"],
  ] as const)("preserves non-search activity semantics: %s", async (search, title) => {
    const wrapper = mount(ChatWebSearchItem, {props: {item: item({...search, queries: []})}});
    expect(wrapper.get("button").text()).toBe(title);
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).not.toContain("未提供可展示的搜索来源");
  });
});
