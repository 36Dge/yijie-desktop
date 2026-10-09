// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { viewFromLegacySnapshot } from "../../domain/conversation-view";
import ChatTimeline from "./ChatTimeline.vue";

function timeline() {
  const result = selectConversationTimeline(viewFromLegacySnapshot({
    threads: [{ threadId: "thread", status: "ready" }],
    turns: ["first", "second", "plain"].map((turnId, ordinal) => ({ threadId: "thread", turnId, ordinal, status: "completed", terminalStatus: "completed" })),
    items: ["first", "second", "plain"].flatMap(turnId => [
      { threadId: "thread", turnId, itemId: `${turnId}-user`, ordinal: 0, kind: "user_message" as const, status: "completed" as const, contentBlocks: [{ blockIndex: 0, type: "text" as const, text: "今天数据如何\n请保留换行" }, { blockIndex: 1, type: "text" as const, text: "补充信息" }] },
      { threadId: "thread", turnId, itemId: `${turnId}-assistant`, ordinal: 1, kind: "assistant_message" as const, agentMessagePhase: "final_answer" as const, status: "completed" as const, contentBlocks: [{ blockIndex: 0, type: "text" as const, text: "普通回复" }] },
    ]),
  }), "thread")!;
  return { ...result, turns: result.turns.map((turn, index) => ({ ...turn, source: index === 0 ? "native_rebuilt" as const : "native_observed" as const })) };
}

describe("connector names in sent messages", () => {
  it("binds original names to each native turn and prefixes only its first user paragraph", () => {
    const input = timeline();
    const wrapper = mount(ChatTimeline, { props: { timeline: input, connectorNamesByTurn: { first: ["原名称 & 数据"], second: ["Sorftime", "Tushare·金融数据"] } } });
    const first = wrapper.get('[data-turn-id="first"]');
    expect(first.get('.chat-safe-content__paragraph').text()).toBe('/ 原名称 & 数据今天数据如何\n请保留换行');
    expect(first.findAll('[aria-label="本轮连接器"]')).toHaveLength(1);
    expect(first.text()).not.toContain('Sorftime');
    expect(wrapper.get('[data-turn-id="second"]').findAll('.chat-turn-group__connector-mention').map(n => n.text())).toEqual(['/ Sorftime', '/ Tushare·金融数据']);
    expect(wrapper.get('[data-turn-id="plain"]').find('[aria-label="本轮连接器"]').exists()).toBe(false);
    expect(input.turns[0]!.items[0]!.contentBlocks[0]).toMatchObject({ text: "今天数据如何\n请保留换行" });
    wrapper.unmount();
  });
  it("does not borrow a matching native selection for a legacy turn", () => {
    const input = timeline();
    const wrapper = mount(ChatTimeline, { props: { timeline: { ...input, turns: input.turns.map(turn => ({ ...turn, source: "legacy_archive" as const })) }, connectorNamesByTurn: { first: ["Sorftime"] } } });
    expect(wrapper.find('[aria-label="本轮连接器"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
