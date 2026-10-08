// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { marketObservation, marketTestId as id } from "../../test/market-chat-fixture";
import MarketChatActivity from "./MarketChatActivity.vue";
describe("market review and result presentation", () => {
  it("shows the qualified review and requires an explicit decision", async () => {
    const wrapper = mount(MarketChatActivity, { props: { observation: marketObservation(), connected: true, refreshing: false, deciding: null, error: null, actionable: () => true } });
    expect(wrapper.text()).toContain("读取合成标的指定日期的一条行情数据。");
    expect(wrapper.text()).toContain("正在等待工具返回");
    const approve = wrapper.findAll("button").find(b => b.text() === "批准本次")!;
    await approve.trigger("click");
    expect(wrapper.emitted("decision")).toEqual([[id(2), "approve_once"]]);
    expect(wrapper.text()).not.toContain("已完成"); wrapper.unmount();
  });
  it("displays complete generic parameters as plain text before one-shot approval", async () => {
    const observation = marketObservation();
    const review = observation.approvals!.requests[0]!.review;
    review.risk = "write";
    review.title = "update-title";
    review.summary = "尚未确认只读，可能修改外部数据。";
    review.argumentsJson = JSON.stringify({ title: "新标题", description: "普通文本 & 标点", items: Array.from({ length: 32 }, (_, n) => `item-${n}`) });
    review.schemaDigest = "a".repeat(64);
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => true } });
    const parameters = wrapper.get('[aria-label="本次工具调用完整参数"]');
    expect(parameters.text()).toBe(review.argumentsJson);
    expect(parameters.findAll("*")).toHaveLength(0);
    expect(wrapper.text()).toContain("尚未确认只读，可能修改外部数据");
    expect(wrapper.emitted("decision")).toBeUndefined();
    await wrapper.findAll("button").find(button => button.text() === "拒绝")!.trigger("click");
    expect(wrapper.emitted("decision")).toEqual([[id(2), "reject"]]);
    wrapper.unmount();
  });
  it("keeps disconnected approvals disabled and offers read-only recovery", async () => {
    const wrapper = mount(MarketChatActivity, { props: { observation: marketObservation(), connected: false, refreshing: false, deciding: null, error: "暂时无法核对", actionable: () => false } });
    expect(wrapper.findAll("footer button").every(b => b.attributes("disabled") !== undefined)).toBe(true);
    await wrapper.get(".market-activity__notice button").trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1); expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it("shows original names in history while decisions stay on the live observation", async () => {
    const live = marketObservation(), history = marketObservation();
    history.selectionDisplay[0]!.displayName = "原轮次名称";
    history.approvals!.requests[0]!.review.title = "不应恢复的旧审批";
    const item = history.tools!.items[0]!;
    item.service = { serviceId: "tushareMcp", reference: history.selectionDisplay[0]!.reference, credentialRef: id(50) };
    item.state = "completed"; item.resultText = "原轮次的实际结果";
    live.availableTurns = [{ nativeTurnId: id(40), selectionDisplay: history.selectionDisplay }];
    const wrapper = mount(MarketChatActivity, { props: { observation: live, toolObservation: history, selectedTurnId: id(40), connected: true, refreshing: false, deciding: null, error: null, actionable: () => true } });
    expect(wrapper.text()).toContain("原轮次名称");
    expect(wrapper.text()).toContain("原轮次的实际结果");
    expect(wrapper.text()).not.toContain("不应恢复的旧审批");
    await wrapper.get("select").setValue("");
    expect(wrapper.emitted("selectTurn")).toEqual([[null]]);
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
});
