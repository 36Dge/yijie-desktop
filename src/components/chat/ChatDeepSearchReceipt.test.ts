// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import type { NativeItem } from "../../api/generated/native-conversation-private.gen";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import { conversationActivityPresentation } from "../../domain/conversation-activity-presentation";
import { summarizeActivity } from "../../domain/conversation-activity-summary";
import ChatTurnGroup from "./ChatTurnGroup.vue";

type Fact = NonNullable<NonNullable<NativeItem["mcp"]>["searchReceipt"]>;
const original = "019a8811-0000-7000-8000-000000000175";
function search(id: string, change: Partial<Fact> = {}) {
  return traceItem(id, "mcpToolCall", {
    argumentsSummary: "杭州", mcp: { server: "yijie_web", tool: "kimi_web_search_pro",
      resultKind: "text", texts: [{index: 0, text: JSON.stringify({results: [], truncated: false})}], diagnostics: [],
      searchReceipt: {version: 2, relation: "reused", operation_id: original, dispatch: "responded", outcome: "empty", availability: "available", ...change},
    },
  });
}
const separator = traceItem("progress", "agentMessage", {phase: "commentary", text: "已核对预约。"});
it("places eleven calls in two batches on one primary card and restores all logical IDs", async () => {
  const calls = Array.from({length: 11}, (_, n) => search("call-" + n, {relation: n ? "reused" : "first"}));
  const changed = search("filtered", {operation_id: "019a8811-0000-7000-8000-000000000176", relation: "first"});
  const items = [...calls.slice(0, 8), separator, ...calls.slice(8), changed];
  for (const input of [items, JSON.parse(JSON.stringify(items)) as NativeItem[]]) {
    const wrapper = mount(ChatTurnGroup, {props: {turn: traceTurn(input), position: 1}});
    for (const row of wrapper.findAll(".chat-activity-group__toggle")) await row.trigger("click");
    const cards = wrapper.findAll(".deep-search-row");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.text()).toContain("0 条结果 · 已复用 10 次");
    await cards[0]!.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(cards[0]!.findAll(".native-tool__calls li")).toHaveLength(11);
    for (const call of calls) expect(cards[0]!.text()).toContain(call.id);
    wrapper.unmount();
  }
});

it("uses a settled logical receipt when the earliest observed item has incomplete facts", async () => {
  const pending = search("first", {relation: "first", dispatch: "uncertain", outcome: "pending", availability: "pending"});
  const later = search("waiter", {relation: "joined"});
  const wrapper = mount(ChatTurnGroup, {props: {turn: traceTurn([pending, separator, later]), position: 1}});
  await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
  expect(wrapper.get(".deep-search-row").text()).toContain("0 条结果 · 并发合并 1 次");
  const [node] = conversationActivityPresentation(traceTurn([pending, separator, later]));
  expect(node?.kind === "activity" && summarizeActivity(node.group, false).counts).toContain("1 次实际搜索");
  await wrapper.setProps({turn: traceTurn([pending, separator, later, later])});
  expect(wrapper.findAll(".deep-search-row")).toHaveLength(1);
  expect(wrapper.text()).toContain("并发合并 1 次");
  wrapper.unmount();
});

// Optional fixed-log acceptance. The native items are projected by the Host
// from actual recorded business responses and newly generated gateway receipts.
it.runIf(Boolean(process.env.SCOPED_REPLAY_DIRECTORY))("replays both Hangzhou model runs through the desktop and history projection", async () => {
  const {readFileSync} = await import("node:fs");
  for (const [name, physical, busy] of [["three",3,0], ["kimi",10,0], ["minimax",19,5]] as const) {
    const records: NativeItem[] = JSON.parse(readFileSync(process.env.SCOPED_REPLAY_DIRECTORY + "/native-" + name + ".json", "utf8"));
    const items = [...records.slice(0,8), separator, ...records.slice(8)];
    const counts = (input: NativeItem[]) => {
      const refs = input.map(item => item.mcp!.searchReceipt!);
      expect(new Set(refs.filter(fact => fact.dispatch === "responded").map(fact => fact.operation_id)).size).toBe(physical);
      expect(refs.filter(fact => fact.dispatch === "not_dispatched")).toHaveLength(busy);
    };
    counts(records);
    for (const snapshot of [items, JSON.parse(JSON.stringify(items)) as NativeItem[]]) {
      const wrapper = mount(ChatTurnGroup,{props:{turn:traceTurn(snapshot),position:1}});
      for (const disclosure of wrapper.findAll(".chat-activity-group__toggle")) await disclosure.trigger("click");
      const visible = wrapper.findAll(".deep-search-row");
      expect(visible).toHaveLength(physical + busy);
      if (name === "kimi") {
        const card = visible.find(row => row.text().includes("0 条结果 · 已复用 10 次"))!;
        await card.get(".chat-timeline-item-shell__disclosure").trigger("click");
        expect(card.findAll(".native-tool__calls li")).toHaveLength(11);
      }
      if (name === "three") expect(visible.every(row => row.text().includes("5 条结果 · 已复用 2 次"))).toBe(true);
      if (name === "minimax") expect(visible.filter(row => row.text().includes("搜索失败"))).toHaveLength(1);
      wrapper.unmount();
    }
  }
});
