// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView, type ConversationSnapshot } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { copyableTimelineItemText } from "../../domain/conversation-timeline-copy";
import ChatTimeline from "./ChatTimeline.vue";

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
function timeline(view: NativeConversationView, liveTurnId: string | null = null) {
  return selectConversationTimeline(composeConversationView(archive, [view]), "session", undefined,
    {protectApprovalProcessContent: false, liveTurnId})!;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

describe("FEAT-134 native streaming presentation", () => {
  it.each([undefined, "final_answer", "commentary"] as const)("follows CLI phase %s handling while keeping Item and Turn completion separate", async phase => {
    const started = frozen(native({availability: "available", items: [{
      ordinal: 0, lastMethod: "item/started",
      item: {id: "answer", type: "agentMessage", text: "**原始正文**", availability: "available", ...(phase ? {phase} : {})},
    }]}));
    const first = timeline(started, "turn");
    const wrapper = mount(ChatTimeline, {props: {timeline: first}});
    expect(first.turns[0]!.items[0]).toMatchObject({busy: true, domainStatus: "streaming", assistantPhase: phase ?? "unknown"});
    if (phase === "commentary") expect(wrapper.text()).toContain("处理过程");
    else {
      expect(wrapper.get("article").attributes("aria-label")).toBe("模型回答");
      expect(wrapper.find(".chat-timeline-item-shell__identity").exists()).toBe(false);
    }
    expect(wrapper.text()).not.toMatch(/未分类模型消息|未标注阶段/);
    expect(wrapper.get("article").attributes("aria-busy")).toBe("true");

    const messageCompleted = {...started, revision: "2", items: started.items.map(entry => ({...entry, lastMethod: "item/completed" as const}))};
    const messageDone = timeline(messageCompleted, "turn");
    await wrapper.setProps({timeline: messageDone});
    expect(messageDone.turns[0]).toMatchObject({domainStatus: "in_progress", terminalStatus: null, progress: {phase: "active"}});
    expect(messageDone.turns[0]!.items[0]).toMatchObject({busy: false, domainStatus: "completed", assistantPhase: phase ?? "unknown"});
    expect(copyableTimelineItemText(messageDone.turns[0]!.items[0]!)).toBe("**原始正文**");
    expect(wrapper.get(".chat-turn-group__progress").text()).toContain("本轮正在处理中");

    const turnDone = timeline({...messageCompleted, revision: "3", status: "completed", terminalObserved: true}, "turn");
    await wrapper.setProps({timeline: turnDone});
    expect(turnDone.turns[0]).toMatchObject({domainStatus: "completed", terminalStatus: "completed", progress: null});
    expect(turnDone.turns[0]!.items[0]!.assistantPhase).toBe(phase ?? "unknown");
    expect(wrapper.find(".chat-turn-group__progress").exists()).toBe(false);
    expect(started.items[0]!.item.phase).toBe(phase);
    expect(started.terminalObserved).toBe(false);
    wrapper.unmount();
  });

  it("keeps raw segment identity and DOM when a summary is inserted", async () => {
    const view = frozen(native());
    const before = timeline(view, "turn");
    const wrapper = mount(ChatTimeline, {props: {timeline: before}});
    const raw = wrapper.get('[aria-label="模型推理记录"] .chat-safe-content__paragraph').element;
    const item = view.items[0]!;
    const next = timeline({...view, revision: "2", items: [{...item, item: {...item.item, summary: ["普通摘要"]}}]}, "turn");
    await wrapper.setProps({timeline: next});
    expect(wrapper.get('[aria-label="模型推理记录"] .chat-safe-content__paragraph').element).toBe(raw);
    expect(wrapper.get('[aria-label="推理摘要"]').text()).toContain("普通摘要");
    expect(wrapper.find('.chat-safe-content strong').exists()).toBe(false);
    expect(wrapper.find('a, [aria-label="复制"]').exists()).toBe(false);
    const blocks = next.turns[0]!.items[0]!.contentBlocks;
    expect(new Set(blocks.map(b => b.identity)).size).toBe(2);
    expect(blocks.map(b => b.blockIndex)).toEqual([0, 0]);
    expect(view.items[0]!.item.summary).toEqual([]);
  });

  it("labels summary-only completion without claiming raw reasoning exists", async () => {
    const view = native({status: "completed", terminalObserved: true, items: [{ordinal: 0, lastMethod: "item/completed",
      item: {id: "reasoning", type: "reasoning", summary: ["只有摘要"], content: [], availability: "available"}}]});
    const wrapper = mount(ChatTimeline, {props: {timeline: timeline(view)}});
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(wrapper.text()).toContain("仅提供推理摘要，未提供原始模型推理正文");
    expect(wrapper.find('[aria-label="模型推理记录"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="推理摘要"]').text()).toContain("只有摘要");
  });

  it.each(["completed", "interrupted", "failed"] as const)("stops busy UI after %s without sealing the Item", status => {
    const view = frozen(native({status, terminalObserved: true}));
    const projected = timeline(view, "turn");
    expect(projected.turns[0]!.items[0]).toMatchObject({domainStatus: "streaming", reasoning: {status: "in_progress"}, busy: false});
    const wrapper = mount(ChatTimeline, {props: {timeline: projected}});
    expect(wrapper.get('article').attributes('aria-busy')).toBe("false");
    expect(wrapper.text()).toContain("本轮已结束，未观察到该项结束记录");
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

  it("preserves Item availability and displays diagnostics without guessing Turn scope", () => {
    const base = native();
    const projected = timeline({...base, diagnostic: "display_limit", items: [{...base.items[0]!, item: {...base.items[0]!.item, availability: "partial"}}]}, "turn");
    expect(projected.turns[0]!.notices).toEqual([]);
    expect(projected.notices[0]).toMatchObject({source: "thread_notice", diagnostic: "display_limit"});
    const wrapper = mount(ChatTimeline, {props: {timeline: projected}});
    expect(wrapper.text()).toContain("显示内容达到容量限制");
    expect(wrapper.text()).toContain("此项信息不完整");
    expect(wrapper.get('article').attributes('aria-busy')).toBe("false");
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
