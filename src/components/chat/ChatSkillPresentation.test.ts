// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { copyableTimelineItemText } from "../../domain/conversation-timeline-copy";
import { viewFromLegacySnapshot } from "../../domain/conversation-view";
import { compileSkillInput } from "../../domain/chat-skills";
import { installedSkill } from "../../test/skill-fixture";
import ChatTimeline from "./ChatTimeline.vue";

const invoice = { ...installedSkill, id: "yijie.store-operations.invoice-generator", runtimeName: "invoice-generator", displayName: "发票生成", category: "store-operations" as const };
function timeline() {
  const raw = compileSkillInput("生成一张发票\n请保留备注", [invoice]);
  const result = selectConversationTimeline(viewFromLegacySnapshot({
    threads: [{ threadId: "thread", status: "ready" }],
    turns: [{ threadId: "thread", turnId: "turn", ordinal: 0, status: "completed", terminalStatus: "completed" }],
    items: [
      { threadId: "thread", turnId: "turn", itemId: "user", ordinal: 0, kind: "user_message", status: "completed", contentBlocks: [{ blockIndex: 0, type: "text", text: raw }, { blockIndex: 1, type: "text", text: "额外信息" }] },
      { threadId: "thread", turnId: "turn", itemId: "assistant", ordinal: 1, kind: "assistant_message", agentMessagePhase: "final_answer", status: "completed", contentBlocks: [{ blockIndex: 0, type: "text", text: raw }] },
    ],
  }), "thread")!;
  return { ...result, turns: result.turns.map(turn => ({ ...turn, source: "native_rebuilt" as const })) };
}

describe("skill pills in sent messages", () => {
  it("rebuilds historical user mentions inline with body text without changing Runtime/copy data or assistant text", async () => {
    const input = timeline();
    const wrapper = mount(ChatTimeline, { props: { timeline: input, skillCatalog: [invoice], connectorNamesByTurn: { turn: ["Sorftime"] } } });
    const user = wrapper.get('.chat-timeline-item-shell--user');
    const first = user.get('.chat-safe-content__paragraph');
    expect(first.text()).toBe('/ Sorftime发票生成生成一张发票\n请保留备注');
    expect(first.get('[aria-label="本轮技能"] .chat-skill-pill').element.tagName).toBe('SPAN');
    expect(first.find('button').exists()).toBe(false);
    expect(user.findAll('[aria-label="本轮技能"]')).toHaveLength(1);
    expect(user.text()).not.toContain('$invoice-generator');
    expect(wrapper.get('.chat-timeline-item-shell--assistant').text()).toContain('$invoice-generator');
    expect(copyableTimelineItemText(input.turns[0]!.items[0]!)).toContain('$invoice-generator\n\n');
    // A later catalog read also upgrades a reloaded history; no draft selection is consulted.
    await wrapper.setProps({ skillCatalog: [] });
    expect(user.text()).toContain('$invoice-generator');
    await wrapper.setProps({ skillCatalog: [invoice] });
    expect(user.text()).not.toContain('$invoice-generator');
    wrapper.unmount();
  });
});
