// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { copyableTimelineItemText } from "../../domain/conversation-timeline-copy";
import { composeConversationView, viewFromLegacySnapshot } from "../../domain/conversation-view";
import { historyPageToConversationSnapshot } from "../../api/chat-conversation-adapter";
import { historyPageV6ToConversationSnapshot } from "../../api/chat-approval-adapter";
import { createChatClient, type ChatClientTransport } from "../../api/chat-client";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { webSourceActionsKey } from "../../composables/useWebSources";
import { compileSkillInput } from "../../domain/chat-skills";
import { installedSkill } from "../../test/skill-fixture";
import ChatTimeline from "./ChatTimeline.vue";
import savedBlocks from "../../../tests/fixtures/user-message-skill-history.json";

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
  it("rehydrates saved identities through both history read commands without submitting a turn", async () => {
    const sessionId = "10000000-0000-4000-8000-000000000001", turnId = "10000000-0000-4000-8000-000000000002";
    const contextId = "10000000-0000-4000-8000-000000000003", subscriptionId = "10000000-0000-4000-8000-000000000004";
    const body = savedBlocks.map(block => block.text).join("\n");
    const message = {messageId: "10000000-0000-4000-8000-000000000005", role: "user", content: body, contentBlocks: savedBlocks, status: "committed", ordinal: 2, createdAt: 1};
    const history = {turns: [{turnId, status: "completed", terminalAt: 2, reasoningStatus: "unavailable", reasoningReasonCode: null,
      messages: [message], reasoning: [], artifacts: [], projectionAuthority: "legacy", terminalCode: null, timelineItems: [], notices: [], plan: null}],
      nextCursor: null, sessionNotices: [], durableSequenceCut: "0", approvals: []};
    const invoke = vi.fn<ChatClientTransport["invoke"]>(async (command, args) => {
      expect(args?.includeUserMessageSkills).toBe(true);
      expect((args?.request as {contextId: string}).contextId).toBe(contextId);
      const data = command === "chat_load_history_v3" ? history : {
        session: {sessionId, projectId: null, title: "商品讨论", titleSource: "user", pinnedAt: null, lastActivityAt: 2, latestTurnStatus: "completed", projectAvailable: true},
        history, cleanup: null, pendingApprovalSnapshot: {schemaVersion: 6, streamId: subscriptionId, snapshotAt: "2026-11-01T00:00:00Z", pending: []},
      };
      return {schemaVersion: 6, requestId: (args?.request as {requestId: string}).requestId, data};
    });
    const client = createChatClient({invoke, listen: async () => () => {}});
    const catalog = [{...installedSkill, id: "listing-skill", version: "1.0.0", displayName: "Amazon-listing-analysis"},
      {...installedSkill, id: "copy-review", version: "2.0.0", displayName: "文案复核"},
      {...installedSkill, id: "title-review", version: "2.0.0", displayName: "不同版本"}];
    for (const page of [(await client.resyncSessionV6(contextId, sessionId, subscriptionId)).history, await client.loadHistoryV6(contextId, sessionId)]) {
      expect(page.turns[0]!.messages[0]!.contentBlocks).toEqual(savedBlocks);
      const timeline = selectConversationTimeline(viewFromLegacySnapshot(historyPageV6ToConversationSnapshot(sessionId, page)), sessionId)!;
      const wrapper = mount(ChatTimeline, {props: {timeline, skillCatalog: catalog},
        global: {provide: {[webSourceActionsKey as symbol]: {openUserMessageLink: async () => {}}}}});
      const user = wrapper.get(".chat-timeline-item-shell--user");
      expect(user.findAll(".chat-skill-pill").map(label => label.text())).toEqual(["Amazon-listing-analysis", "文案复核", "title-review"]);
      expect(user.get('[role="link"]').text()).toBe(savedBlocks[0]!.text.split(" ")[0]);
      expect(page.turns[0]!.messages[0]!.content).toBe(body);
      wrapper.unmount();
    }
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["chat_resync_session_v2", "chat_load_history_v3"]);
  });

  it.each([true, false])("shows the accepted selection only on the sending bubble (product URL: %s)", async withUrl => {
    const listing = { ...installedSkill, id: "listing-skill", displayName: "Amazon-listing-analysis" };
    const url = "https://example.org/product?sku=42&th=1";
    const body = withUrl ? `${url} 给出这个商品的优化建议。` : "给出这个商品的优化建议。";
    const snapshot = historyPageToConversationSnapshot("thread", {
      nextCursor: null,
      turns: ["first", "second"].map(turnId => ({ turnId, status: "completed", terminalAt: 2, reasoningStatus: "unavailable", reasoningReasonCode: null, reasoning: [],
        messages: [{messageId: turnId, role: "user", status: "committed", createdAt: 1, ordinal: 0, content: body,
          contentBlocks: [{type: "text", text: body, ...(turnId === "second" && {skills: [{id: listing.id, version: listing.version}]})}]}] })),
    });
    const native: NativeConversationView = {sessionId: "thread", turnId: "second", runtimeThreadId: "rt", runtimeTurnId: "turn",
      source: "native_observed", revision: "1", availability: "available", terminalObserved: true,
      items: [{ordinal: 0, lastMethod: "item/completed", item: {id: "runtime-user", type: "userMessage", text: body, availability: "available"}}]};
    const project = (views: NativeConversationView[]) => selectConversationTimeline(composeConversationView(snapshot, views), "thread")!;
    const wrapper = mount(ChatTimeline, {props: {timeline: project([]), skillCatalog: [listing]},
      global: {provide: {[webSourceActionsKey as symbol]: {openUserMessageLink: async () => {}}}}});
    for (const views of [[], [{...native, items: []}], [native], [{...native, source: "native_rebuilt" as const}]]) {
      await wrapper.setProps({timeline: project(views)});
      const bubbles = wrapper.findAll(".chat-timeline-item-shell--user");
      expect(bubbles).toHaveLength(2);
      expect(bubbles[0]!.find('[aria-label="本轮技能"]').exists()).toBe(false);
      const paragraph = bubbles[1]!.get(".chat-safe-content__paragraph");
      expect(paragraph.element.firstElementChild?.getAttribute("aria-label")).toBe("本轮技能");
      expect(paragraph.get(".chat-skill-pill").text()).toBe(listing.displayName);
      expect(paragraph.get(".chat-skill-pill svg").attributes("aria-hidden")).toBe("true");
      if (withUrl) expect(paragraph.get('[role="link"]').text()).toBe(url);
      else expect(paragraph.find('[role="link"]').exists()).toBe(false);
      expect(paragraph.element.textContent).toBe(listing.displayName + body);
    }
    wrapper.unmount();
  });

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
