// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { marketCallReceipt, marketDecisionFact, marketObservation, marketTestId as id } from "../../test/market-chat-fixture";
import MarketChatActivity from "./MarketChatActivity.vue";
describe("market review and result presentation", () => {
  it("uses append order after clock correction and preserves stronger acknowledgement evidence", async () => {
    const observation = marketObservation(); observation.approvals!.requests = []; observation.tools!.items = [];
    const latest = marketDecisionFact("unconfirmed"); latest.observedAtUnixMs = 1_794_800_001_000;
    const older = marketDecisionFact("requested"); older.observedAtUnixMs = 1_794_800_002_000;
    observation.decisionFacts = [latest, older];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: false, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.get('[aria-label="只读决定记录"] .market-activity__meta').text()).toContain(new Date(latest.observedAtUnixMs).toLocaleString('zh-CN'));
    const acknowledged = marketDecisionFact("acknowledged"); acknowledged.observedAtUnixMs = 1_794_800_000_500;
    await wrapper.setProps({ observation: { ...observation, decisionFacts: [latest, acknowledged, older] } });
    expect(wrapper.get('[aria-label="只读决定记录"]').text()).toContain("已确认允许一次");
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it("flags legacy second-valued timestamps without rewriting or authorizing the fact", () => {
    const observation = marketObservation(); observation.approvals!.requests = []; observation.tools!.items = [];
    const fact = marketDecisionFact(); fact.observedAtUnixMs = 1_794_886_903;
    observation.decisionFacts = [fact];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: false, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.get('[aria-label="只读决定记录"]').text()).toContain("旧记录时间单位异常");
    expect(fact.observedAtUnixMs).toBe(1_794_886_903);
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it("shows structured-only and distinct JSON without claiming omitted data", () => {
    const observation = marketObservation(); observation.approvals!.requests = [];
    const item = observation.tools!.items[0]!; item.state = "completed";
    item.resultText = "one ordinary row"; item.structuredResultText = '{"rows":[1]}'; item.truncated = false;
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.text()).toContain("one ordinary row");
    expect(wrapper.get('[aria-label="结构化工具结果"]').text()).toBe('{"rows":[1]}');
    expect(wrapper.text()).not.toContain("部分内容已省略"); wrapper.unmount();
  });
  it.each(["requested", "acknowledged", "unconfirmed"] as const)("keeps a %s decision without a tool result read-only", (kind) => {
    const observation = marketObservation(); observation.approvals!.requests = []; observation.tools!.items = [];
    observation.decisionFacts = [marketDecisionFact(kind)];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: false, refreshing: false, deciding: null, error: null, actionable: () => false } });
    const record = wrapper.get('[aria-label="只读决定记录"]');
    expect(record.text()).toContain(kind === "acknowledged" ? "已确认允许一次" : "已请求允许一次");
    expect(record.findAll("button")).toHaveLength(0);
    expect(record.text()).not.toContain("本次未开始执行");
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it("uses a linked native result instead of duplicating its decision as an unlinked record", () => {
    const observation = marketObservation(); observation.approvals!.requests = [];
    observation.decisionFacts = [marketDecisionFact("requested"), marketDecisionFact("acknowledged")];
    const item = observation.tools!.items[0]!; item.correlation = marketCallReceipt(); item.callRef = item.correlation.callRef; item.state = "failed";
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.find('[aria-label="只读决定记录"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("已允许一次"); expect(wrapper.text()).toContain("执行失败"); wrapper.unmount();
  });
  it("links a historical decision without promoting admission to execution success", () => {
    const observation = marketObservation();
    observation.approvals!.requests = [];
    const item = observation.tools!.items[0]!;
    item.state = "failed"; item.correlation = marketCallReceipt(); item.callRef = item.correlation.callRef;
    observation.availableTurns = [{ nativeTurnId: item.nativeTurnId, selectionDisplay: observation.selectionDisplay }];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.text()).toContain("Tushare·金融数据");
    expect(wrapper.get('[aria-label="本次调用的批准记录"]').text()).toContain("已允许一次");
    expect(wrapper.text()).toContain("执行失败");
    expect(wrapper.text()).not.toContain("已完成");
    expect(wrapper.find(".approval-prompt").exists()).toBe(false);
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it.each(["empty", "new-generation"])("keeps the original result name while a %s submission is unbound", (next) => {
    const observation = marketObservation();
    observation.approvals!.requests = [];
    const item = observation.tools!.items[0]!;
    item.state = "completed"; item.resultText = "原轮次结果";
    item.correlation = marketCallReceipt(); item.callRef = item.correlation.callRef;
    const original = structuredClone(observation.selectionDisplay);
    original[0]!.displayName = "原轮次连接器名称";
    observation.availableTurns = [{ nativeTurnId: item.nativeTurnId, selectionDisplay: original }];
    observation.selectionDisplay = next === "empty" ? [] : [{ ...original[0]!, displayName: "新提交名称", reference: { ...original[0]!.reference, generation: 2 } }];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    const result = wrapper.get('[aria-label="连接器工具结果"]');
    expect(result.get("strong").text()).toBe("原轮次连接器名称");
    expect(result.text()).toContain("原轮次结果");
    expect(result.text()).not.toContain("新提交名称");
    expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it.each(["other-turn", "other-generation", "legacy-latest"])("does not borrow a result title from %s display facts", (source) => {
    const observation = marketObservation();
    observation.approvals!.requests = [];
    const item = observation.tools!.items[0]!;
    item.state = "failed"; item.resultText = "保留原生结果";
    item.correlation = marketCallReceipt(); item.callRef = item.correlation.callRef;
    observation.availableTurns = source === "legacy-latest" ? undefined : [{
      nativeTurnId: source === "other-turn" ? id(40) : item.nativeTurnId,
      selectionDisplay: [{ ...observation.selectionDisplay[0]!, reference: { ...item.correlation.reference, generation: source === "other-generation" ? 2 : 1 } }],
    }];
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    const result = wrapper.get('[aria-label="连接器工具结果"]');
    expect(result.get("strong").text()).toBe("tushareMcp");
    expect(result.text()).toContain("保留原生结果");
    expect(result.text()).toContain("执行失败"); wrapper.unmount();
  });
  it("shows the qualified review and requires an explicit decision", async () => {
    const wrapper = mount(MarketChatActivity, { props: { observation: marketObservation(), connected: true, refreshing: false, deciding: null, error: null, actionable: () => true } });
    expect(wrapper.text()).toContain("读取合成标的指定日期的一条行情数据。");
    expect(wrapper.text()).toContain("正在等待工具返回");
    expect(wrapper.text()).not.toContain("审批与结果关联未确认");
    const approve = wrapper.get('button[aria-keyshortcuts="Enter"]');
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
    await wrapper.get('button[aria-keyshortcuts="Escape"]').trigger("click");
    expect(wrapper.emitted("decision")).toEqual([[id(2), "reject"]]);
    wrapper.unmount();
  });
  it("keeps disconnected approvals disabled and offers read-only recovery", async () => {
    const wrapper = mount(MarketChatActivity, { props: { observation: marketObservation(), connected: false, refreshing: false, deciding: null, error: "暂时无法核对", actionable: () => false } });
    expect(wrapper.findAll("footer button").every(b => b.attributes("disabled") !== undefined)).toBe(true);
    await wrapper.get(".market-activity__notice button").trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1); expect(wrapper.emitted("decision")).toBeUndefined(); wrapper.unmount();
  });
  it("removes resolved approval cards while preserving the tool result", async () => {
    const observation = marketObservation();
    observation.approvals!.requests[0]!.state = "approved";
    const item = observation.tools!.items[0]!;
    item.state = "completed"; item.resultText = "本次查询结果";
    const wrapper = mount(MarketChatActivity, { props: { observation, connected: true, refreshing: false, deciding: null, error: null, actionable: () => false } });
    expect(wrapper.find(".approval-prompt").exists()).toBe(false);
    expect(wrapper.text()).toContain("本次查询结果");
    expect(wrapper.text()).toContain("审批与结果关联未确认");
    wrapper.unmount();
  });
  it("shows original names in history while decisions stay on the live observation", async () => {
    const live = marketObservation(), history = marketObservation();
    history.selectionDisplay[0]!.displayName = "原轮次名称";
    history.approvals!.requests[0]!.review.title = "不应恢复的旧审批";
    const item = history.tools!.items[0]!;
    history.tools!.nativeTurnId = id(40); item.nativeTurnId = id(40);
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
