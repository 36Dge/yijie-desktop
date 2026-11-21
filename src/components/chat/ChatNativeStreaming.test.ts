// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { h } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView, type ConversationSnapshot } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { completedTurnAnswer } from "../../domain/conversation-process";
import { copyableTimelineItemText } from "../../domain/conversation-timeline-copy";
import ChatTimeline from "./ChatTimeline.vue";
import ChatDeepThinking from "./ChatDeepThinking.vue";
import ChatCopyAction from "./ChatCopyAction.vue";

const archive: ConversationSnapshot = {
  threads: [{threadId: "session", status: "ready"}],
  turns: [{threadId: "session", turnId: "turn", ordinal: 0, status: "completed", terminalStatus: "completed"}],
  items: [],
};
function native(overrides: Partial<NativeConversationView> = {}): NativeConversationView {
  return {sessionId: "session", turnId: "turn", runtimeThreadId: "native-thread", runtimeTurnId: "native-turn",
    source: "native_observed", revision: "1", availability: "partial", status: "inProgress", statusSource: "runtime_notification",
    terminalObserved: false, items: [{ordinal: 0, lastMethod: "item/started", item: {
      id: "reasoning", type: "reasoning", content: ["普通正文 **保持纯文本**"], summary: [], availability: "available",
    }}], ...overrides};
}

it.each([
  {status: "failed", statusSource: "runtime_notification", diagnostic: "runtime_notice"},
  {status: "interrupted", statusSource: "runtime_notification", diagnostic: "runtime_notice"},
  {status: "interrupted", statusSource: "runtime_read", diagnostic: "native_history_partial"},
] as const)("shows one turn note on delivery and reopen ($status / $statusSource)", ({status, statusSource, diagnostic}) => {
  const saved = native({
    status, statusSource, diagnostic, terminalObserved: statusSource === "runtime_notification",
    terminalErrorCode: status === "failed" ? "sessionBudgetExceeded" : null,
    items: [{ ordinal: 0, lastMethod: "item/completed", item: { id: "u", type: "userMessage", text: "城市对比报告", availability: "available" } }],
    notices: [{ eventId: "end", sequence: "2", method: "error", code: "runtime_notice", scope: "turn", willRetry: false }],
  });
  for (const view of [saved, JSON.parse(JSON.stringify(saved)) as NativeConversationView]) {
    const wrapper = mount(ChatTimeline, { props: { timeline: timeline(view) } });
    const note = wrapper.get(".chat-turn-group__turn-state");
    expect(note.text()).toBe(status === "failed" ? "这次回复未能完成。你可以在新对话中继续。" : "这次回复已停止。");
    expect(wrapper.findAll('[role="note"]')).toHaveLength(1);
    expect(wrapper.text().indexOf("城市对比报告")).toBeLessThan(wrapper.text().indexOf(note.text()));
    expect(wrapper.text()).not.toMatch(/conversation_warning|runtime_notice|预算|未安排重试/);
    wrapper.unmount();
  }
});
function timeline(view: NativeConversationView, liveTurnId: string | null = null) {
  return selectConversationTimeline(composeConversationView(archive, [view]), "session", undefined,
    {protectApprovalProcessContent: false, liveTurnId})!;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

describe("FEAT-134 native streaming presentation", () => {
  it.each(["completed", "failed", "interrupted"] as const)("omits start-only web rows when a turn is %s and restores a late completion by ID", async status => {
    const starts: NativeConversationView["items"] = (["search", "openPage", "findInPage"] as const).map((action, ordinal) => ({
      ordinal, lastMethod: "item/started", item: {
        id: `start-${action}`, type: "webSearch", availability: "available", webSearch: {action, queries: []},
      },
    }));
    const items: NativeConversationView["items"] = [...starts,
      {ordinal: 3, lastMethod: "item/completed", item: {id: "finished-search", type: "webSearch", availability: "available", webSearch: {action: "search", queries: []}}},
      {ordinal: 4, lastMethod: "item/completed", item: {id: "failed-fetch", type: "mcpToolCall", status: "failed", availability: "partial",
        mcp: {server: "yijie_web", tool: "kimi_web_fetch", resultKind: "omitted", texts: [], diagnostics: []}}},
    ];
    const view = frozen(native({items}));
    const wrapper = mount(ChatTimeline, {props: {timeline: timeline(view, "turn")}});
    expect(wrapper.findAll(".chat-web-search")).toHaveLength(4);

    const ended = frozen({...view, status, terminalObserved: true});
    for (const liveTurnId of ["turn", null]) {
      const projection = timeline(ended, liveTurnId);
      expect(projection.turns[0]!.items.map(item => item.itemId)).toEqual(items.map(entry => entry.item.id));
      await wrapper.setProps({timeline: projection});
      expect(wrapper.findAll(".chat-web-search")).toHaveLength(1);
      expect(wrapper.html()).not.toContain("未观察到该项结束记录");
      expect(wrapper.find(".web-fetch-row").exists()).toBe(false);
    }

    const later = [...items];
    later[0] = {...items[0]!, lastMethod: "item/completed"};
    await wrapper.setProps({timeline: timeline({...ended, revision: "2", items: later})});
    expect(wrapper.findAll(".chat-web-search")).toHaveLength(2);
    expect(ended.items[0]!.lastMethod).toBe("item/started");
    wrapper.unmount();
  });

  it("removes a running tool and its notice on failure, and keeps independent turn notices", async () => {
    const initial = native({items: [{ordinal: 0, lastMethod: "item/started", item: {
      id: "tool", type: "mcpToolCall", status: "inProgress", availability: "available", toolLabel: "查询资料",
    }}]});
    const wrapper = mount(ChatTimeline, {props: {timeline: timeline(initial, "turn")}});
    expect(wrapper.find(".chat-activity-group").exists()).toBe(true);
    const next = frozen(native({items: [{ordinal: 0, lastMethod: "item/completed", item: {
      ...initial.items[0]!.item, status: "failed",
    }}], notices: [
      {eventId: "per-item", sequence: "2", method: "error", code: "transport_error", scope: "turn", itemId: "tool"},
      {eventId: "per-turn", sequence: "3", method: "warning", code: "answer_completion_continuing", scope: "turn"},
    ]}));
    await wrapper.setProps({timeline: timeline(next, "turn")});
    expect(wrapper.find(".chat-activity-group, .chat-turn-group__item--tool").exists()).toBe(false);
    expect(wrapper.get(".chat-trace-notices").text()).toContain("正在根据已有结果补全回答");
    expect(wrapper.get(".chat-trace-notices").text()).not.toContain("运行错误");
    const record = next.items[0]!;
    await wrapper.setProps({timeline: timeline({...next, items: [{...record, item: {...record.item, status: "completed"}}]}, "turn")});
    expect(wrapper.find(".chat-turn-group__item--tool").exists()).toBe(true);
    expect(wrapper.get(".chat-trace-notices").text()).not.toContain("运行错误");
    expect(next.notices).toHaveLength(2);
    wrapper.unmount();
  });

  it("omits the empty activity group and preserves the meaning of the message preceding a web start", () => {
    const view = native({status: "completed", terminalObserved: true, items: [
      {ordinal: 0, lastMethod: "item/completed", item: {id: "opening", type: "agentMessage", text: "我来查看网页。", availability: "available"}},
      {ordinal: 1, lastMethod: "item/started", item: {id: "web", type: "webSearch", availability: "available"}},
    ]});
    const projection = timeline(view);
    const wrapper = mount(ChatTimeline, {props: {timeline: projection}});
    expect(wrapper.text()).toContain("我来查看网页。");
    expect(wrapper.find(".chat-web-search, .chat-activity-group, .chat-turn-group__process-toggle").exists()).toBe(false);
    expect(completedTurnAnswer(projection.turns[0]!)).toBeUndefined();
    wrapper.unmount();
  });

  it("uses recorded tool outcomes when rebuilding a turn from thread/read", async () => {
    const view = native({source: "native_rebuilt", statusSource: "runtime_read", status: "completed", terminalObserved: false,
      items: [
        {ordinal: 0, lastMethod: "thread/read", item: {id: "failed", type: "mcpToolCall", status: "failed", availability: "available"}},
        {ordinal: 1, lastMethod: "thread/read", item: {id: "stale", type: "commandExecution", status: "inProgress", availability: "available"}},
        {ordinal: 2, lastMethod: "thread/read", item: {id: "unknown", type: "webSearch", availability: "available"}},
        {ordinal: 3, lastMethod: "thread/read", item: {id: "known", type: "webSearch", status: "completed", availability: "partial",
          webSearch: {action: "openPage", queries: [], pageLabel: "example.org"}}},
      ]});
    const wrapper = mount(ChatTimeline, {props: {timeline: timeline(view)}});
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    const group = wrapper.find(".chat-activity-group__toggle");
    if (group.exists()) await group.trigger("click");
    expect(wrapper.findAll(".chat-web-search")).toHaveLength(1);
    expect(wrapper.get(".chat-web-search").isVisible()).toBe(true);
    expect(wrapper.get(".chat-web-search button").attributes("aria-label")).toContain("已完成");
    expect(wrapper.get(".chat-web-search").text()).toContain("example.org");
    expect(wrapper.find(".chat-turn-group__item--tool, .chat-turn-group__item--command").exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([undefined, "final_answer", "commentary"] as const)("follows CLI phase %s handling while keeping Item and Turn completion separate", async phase => {
    const started = frozen(native({availability: "available", items: [{
      ordinal: 0, lastMethod: "item/started",
      item: {id: "answer", type: "agentMessage", text: "**原始正文**", availability: "available", ...(phase ? {phase} : {})},
    }]}));
    const first = timeline(started, "turn");
    const copied: string[] = [];
    const wrapper = mount(ChatTimeline, {
      props: {timeline: first},
      slots: {"item-actions": ({item}) => h(ChatCopyAction, {
        text: copyableTimelineItemText(item) ?? "",
        adapter: {writeText: async (text: string) => { copied.push(text); }},
      })},
    });
    expect(first.turns[0]!.items[0]).toMatchObject({busy: true, domainStatus: "streaming", assistantPhase: phase ?? "unknown"});
    if (phase === "commentary") expect(wrapper.get("article").attributes("aria-label")).toBe("模型消息");
    else {
      expect(wrapper.get("article").attributes("aria-label")).toBe("模型回答");
      expect(wrapper.find(".chat-timeline-item-shell__identity").exists()).toBe(false);
    }
    expect(wrapper.text()).not.toMatch(/未分类模型消息|未标注阶段/);
    expect(wrapper.get("article").attributes("aria-busy")).toBe("true");
    expect(wrapper.find('[aria-label="复制文本"]').exists()).toBe(false);
    expect(wrapper.find('.chat-timeline-item-shell__answer-actions').exists()).toBe(false);

    const messageCompleted = {...started, revision: "2", items: started.items.map(entry => ({...entry, lastMethod: "item/completed" as const}))};
    const messageDone = timeline(messageCompleted, "turn");
    await wrapper.setProps({timeline: messageDone});
    expect(messageDone.turns[0]).toMatchObject({domainStatus: "in_progress", terminalStatus: null, progress: {phase: "active"}});
    expect(messageDone.turns[0]!.items[0]).toMatchObject({busy: false, domainStatus: "completed", assistantPhase: phase ?? "unknown"});
    expect(copyableTimelineItemText(messageDone.turns[0]!.items[0]!)).toBe("**原始正文**");
    expect(wrapper.find('[aria-label="复制文本"]').exists()).toBe(false);
    if (phase === "commentary") expect(wrapper.get(".chat-turn-group__progress").text()).toContain("等待模型继续输出");
    else expect(wrapper.find(".chat-turn-group__progress").exists()).toBe(false);

    const turnDone = timeline({...messageCompleted, revision: "3", status: "completed", terminalObserved: true}, "turn");
    await wrapper.setProps({timeline: turnDone});
    expect(turnDone.turns[0]).toMatchObject({domainStatus: "completed", terminalStatus: "completed", progress: null});
    expect(turnDone.turns[0]!.items[0]!.assistantPhase).toBe(phase ?? "unknown");
    expect(wrapper.find(".chat-turn-group__progress").exists()).toBe(false);
    if (phase === "commentary") {
      expect(wrapper.find('[aria-label="复制文本"]').exists()).toBe(false);
    } else {
      await vi.waitFor(() => expect(wrapper.find('[aria-label="复制文本"]').exists()).toBe(true), {timeout: 2_000});
      await wrapper.get('[aria-label="复制文本"]').trigger("click");
      expect(copied).toEqual(["**原始正文**"]);
    }
    expect(started.items[0]!.item.phase).toBe(phase);
    expect(started.terminalObserved).toBe(false);
    wrapper.unmount();
  });

  it.each(["item/started", "thread/read"] as const)("does not show unfinished reply copy for %s after the Turn ends, while user copy remains available", lastMethod => {
    const view = native({status: "completed", terminalObserved: true, availability: "available", items: [
      {ordinal: 0, lastMethod: "item/completed", item: {id: "user", type: "userMessage", text: "问题", availability: "available"}},
      {ordinal: 1, lastMethod, item: {id: "answer", type: "agentMessage", text: "未确认完成的回答", availability: "available"}},
    ]});
    const projected = timeline(view);
    expect(projected.turns[0]!.items[1]!.busy).toBe(false);
    const wrapper = mount(ChatTimeline, {
      props: {timeline: projected},
      slots: {"item-actions": () => h("button", {"aria-label": "复制文本"}, "复制")},
    });
    expect(wrapper.get('[aria-label="用户消息"]').find('[aria-label="复制文本"]').exists()).toBe(true);
    expect(wrapper.get('[aria-label="模型回答"]').find('[aria-label="复制文本"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps diagnostic detail segment identity when a summary is inserted", async () => {
    const view = frozen(native());
    const before = timeline(view, "turn");
    const wrapper = mount(ChatDeepThinking, {props: {item: before.turns[0]!.items[0]!, visible: true, live: true, stateMessage: null}});
    const raw = wrapper.get('[aria-label="思考原文"] .chat-safe-content__paragraph').element;
    const item = view.items[0]!;
    const next = timeline({...view, revision: "2", items: [{...item, item: {...item.item, summary: ["普通摘要"]}}]}, "turn");
    await wrapper.setProps({item: next.turns[0]!.items[0]!});
    expect(wrapper.get('[aria-label="思考原文"] .chat-safe-content__paragraph').element).toBe(raw);
    expect(wrapper.get('[aria-label="思考摘要"]').text()).toContain("普通摘要");
    expect(wrapper.get('.chat-safe-content strong').text()).toBe("保持纯文本");
    expect(wrapper.find('a, [aria-label="复制"]').exists()).toBe(false);
    const blocks = next.turns[0]!.items[0]!.contentBlocks;
    expect(new Set(blocks.map(b => b.identity)).size).toBe(2);
    expect(blocks.map(b => b.blockIndex)).toEqual([0, 0]);
    expect(view.items[0]!.item.summary).toEqual([]);
  });

  it("labels summary-only completion without claiming raw reasoning exists", async () => {
    const view = native({status: "completed", terminalObserved: true, items: [{ordinal: 0, lastMethod: "item/completed",
      item: {id: "reasoning", type: "reasoning", summary: ["只有摘要"], content: [], availability: "available"}}]});
    const wrapper = mount(ChatDeepThinking, {props: {item: timeline(view).turns[0]!.items[0]!, visible: true, live: false, stateMessage: null}});
    expect(wrapper.text()).not.toContain("仅提供推理摘要，未提供原始模型推理正文");
    await wrapper.get(".chat-deep-thinking__toggle").trigger("click");
    expect(wrapper.find('[aria-label="思考原文"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="思考摘要"]').text()).toContain("只有摘要");
  });

  it.each(["completed", "interrupted", "failed"] as const)("stops busy UI after %s without sealing the Item", status => {
    const view = frozen(native({status, terminalObserved: true}));
    const projected = timeline(view, "turn");
    expect(projected.turns[0]!.items[0]).toMatchObject({domainStatus: "streaming", reasoning: {status: "in_progress"}, busy: false});
    const wrapper = mount(ChatTimeline, {props: {timeline: projected}});
    expect(wrapper.find('.chat-deep-thinking').exists()).toBe(false);
    expect(projected.turns[0]!.items[0]!.activityLabel).toContain("本轮已结束，未观察到该项结束记录");
    expect(view.items[0]!.lastMethod).toBe("item/started");
  });

  it("requires a current live observation, not just saved in-progress state", () => {
    const view = native();
    expect(timeline(view).turns[0]!.items[0]!.busy).toBe(false);
    expect(timeline(view).turns[0]!.progress).toBeNull();
    expect(timeline(view, "turn").turns[0]!.items[0]!.busy).toBe(true);
    expect(timeline({...view, source: "native_rebuilt", statusSource: "runtime_read"}, "turn").turns[0]!.items[0]!.busy).toBe(false);
    expect(timeline({...view, availability: "partial", diagnostic: "stream_gap"}, "turn").turns[0]!.items[0]!.busy).toBe(false);
  });

  it("preserves item availability and thread diagnostics without displaying a thread warning", () => {
    const base = native();
    const projected = timeline({...base, diagnostic: "display_limit", items: [{...base.items[0]!, item: {...base.items[0]!.item, availability: "partial"}}]}, "turn");
    expect(projected.turns[0]!.notices).toEqual([]);
    expect(projected.notices[0]).toMatchObject({source: "thread_notice", diagnostic: "display_limit"});
    const wrapper = mount(ChatTimeline, {props: {timeline: projected}});
    expect(wrapper.text()).not.toContain("显示内容达到容量限制");
    expect(projected.turns[0]!.items[0]!.availability).toBe("partial");
    expect(wrapper.find('.chat-deep-thinking').exists()).toBe(false);
    const unknown = timeline({...base, diagnostic: "unrecognized-provider-detail"});
    expect(JSON.stringify(unknown)).not.toContain("unrecognized-provider-detail");
  });

  it.each(["x", "", "完全不同的最终正文"])("renders the native final verbatim: %j", text => {
    const view = native({items: [{ordinal: 0, lastMethod: "item/completed", item: {id: "answer", type: "agentMessage", phase: "final_answer", text, availability: "available"}}]});
    const item = timeline(view).turns[0]!.items[0]!;
    expect(item.contentBlocks).toMatchObject([{type: "text", text}]);
    expect(item.collapsible).toBe(false);
    expect(item.reconciliation).toBe("not_applicable");
  });
});

it.each([undefined, "final_answer"] as const)("moves from thinking to timed streamed phase %s output without waiting for Turn completion", async phase => {
  const view = native({availability: "available", items: [
    {ordinal: 0, lastMethod: "item/completed", item: {id: "user", type: "userMessage", text: "请介绍一下", availability: "available"}},
  ]});
  const wrapper = mount(ChatTimeline, {attachTo: document.body, props: {timeline: timeline(view, "turn"), turnTimingLabels: {turn: "执行 2s"}}});
  expect(wrapper.get('.chat-thinking').text()).toBe("正在思考");
  expect(wrapper.get('.chat-turn-group__timing').text()).toBe("正在思考");
  expect(wrapper.find('.chat-turn-group__header').exists()).toBe(false);
  expect(wrapper.find('.chat-turn-group__progress').exists()).toBe(false);

  const process: NativeConversationView = {...view, revision: "2", items: [...view.items, {
    ordinal: 1, lastMethod: "item/started", item: {id: "reasoning", type: "reasoning", content: ["检查已有信息"], summary: [], availability: "available"},
  }]};
  await wrapper.setProps({timeline: timeline(process, "turn")});
  expect(wrapper.find('.chat-turn-group__thinking .chat-thinking').exists()).toBe(false);
  expect(wrapper.find('.chat-activity-group').exists()).toBe(false);
  expect(wrapper.get('.chat-turn-group__timing').text()).toBe("执行 2s");
  expect(wrapper.find('.chat-turn-group__process-toggle').exists()).toBe(false);
  expect(wrapper.get('.chat-turn-group__progress').text()).toBe('正在思考');
  const answer: NativeConversationView = {...process, revision: "3", items: [...process.items.map(entry => ({...entry, lastMethod: "item/completed" as const})), {
    ordinal: 2, lastMethod: "item/started", item: {id: "answer", type: "agentMessage", text: "**开始回答**", availability: "available", ...(phase ? {phase} : {})},
  }]};
  await wrapper.setProps({timeline: timeline(answer, "turn")});
  expect(wrapper.find('.chat-deep-thinking').exists()).toBe(false);
  expect(wrapper.find('.chat-turn-group__progress .chat-execution-progress').exists()).toBe(false);
  expect(wrapper.find('.chat-turn-group__timing button').exists()).toBe(false);
  await vi.waitFor(() => expect(wrapper.get('[aria-label="模型回答"] strong').text()).toBe("开始回答"));
  expect(wrapper.find('.chat-timeline-item-shell__header').exists()).toBe(false);
  expect(wrapper.get('[aria-label="模型回答"]').attributes('aria-busy')).toBe("true");
  await wrapper.setProps({timeline: timeline({...answer, revision: "4", status: "completed", terminalObserved: true}, "turn")});
  expect(wrapper.find('.chat-turn-group__item--reasoning').exists()).toBe(false);
  expect(timeline(answer).turns[0]!.items[1]!.contentBlocks[0]).toMatchObject({text: '检查已有信息'});
  expect(wrapper.text()).toContain("本轮已结束，未观察到该项结束记录");
  await vi.waitFor(() => expect(wrapper.find('.chat-stream-text__fresh').exists()).toBe(false));
  wrapper.unmount();
});

it("does not claim to wait for a model during historical, disconnected, terminal or tool execution states", () => {
  const tool: NativeConversationView["items"][number] = {ordinal: 0, lastMethod: "item/started", item: {
    id: "tool", type: "commandExecution", status: "inProgress", availability: "available",
  }};
  const cases: [NativeConversationView, string | null][] = [
    [native(), null],
    [native({status: "completed", terminalObserved: true}), "turn"],
    [native({status: "failed", terminalObserved: true}), "turn"],
    [native({status: "interrupted", terminalObserved: true}), "turn"],
    [native({diagnostic: "stream_gap"}), "turn"],
    [native({source: "native_rebuilt", statusSource: "runtime_read"}), "turn"],
    [native({items: [tool]}), "turn"],
  ];
  for (const [view, live] of cases) {
    const wrapper = mount(ChatTimeline, {props: {timeline: timeline(view, live)}});
    expect(wrapper.find('.chat-turn-group__progress .chat-execution-progress').exists()).toBe(false);
    wrapper.unmount();
  }
});
