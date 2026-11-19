// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { webSourceActionsKey, type WebSourceActions } from "../../composables/useWebSources";
import type { NativeConversationView, NativeItem } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatNativeToolItem from "./ChatNativeToolItem.vue";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import { activityToolTitle, activityToolSourceLabel } from "../../domain/conversation-activity-entry";

function fixture(terminal=false) {
  const view: NativeConversationView={sessionId:"session",turnId:"turn",runtimeThreadId:"thread",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"4",availability:"available",status:terminal?"completed":"inProgress",statusSource:"runtime_notification",terminalObserved:terminal,items:[{ordinal:0,lastMethod:"item/started",item:{id:"tool-item",type:"mcpToolCall",status:"inProgress",availability:"available",argumentsSummary:"ASIN: B07H9PZDQW · 站点: US",mcp:{server:"sorftime",tool:"product_detail",resultKind:"text",texts:[{index:0,text:""},{index:2,text:"普通商品资料 https://example.test/product"}],diagnostics:[]}}}]};
  const state=composeConversationView({threads:[{threadId:"session",status:"ready"}],turns:[],items:[]},[view]);
  const item=selectConversationTimeline(state,"session",undefined,{liveTurnId:"turn",protectApprovalProcessContent:false})!.turns[0]!.items[0]!;
  if(item.execution?.kind!=="tool" || !("native" in item.execution)) throw new Error("native Tool missing");
  return {item,execution:item.execution};
}

function renderDeepSearch(mcp: NonNullable<NativeItem["mcp"]>, fields: Partial<NativeItem> = {}, actions?: WebSourceActions) {
  const item = traceTurn([traceItem("deep-search", "mcpToolCall", {
    argumentsSummary: "杭州天气", durationMs: 8333, ...fields,
    mcp: { ...mcp, server: "yijie_web", tool: "kimi_web_search_pro" },
  })]).items[0]!;
  if (item.execution?.kind !== "tool" || !("native" in item.execution)) throw new Error("missing native execution");
  return mount(ChatNativeToolItem, { props: { item, execution: item.execution, processPresentation: true },
    global: {provide: actions ? {[webSourceActionsKey as symbol]: actions} : {}} });
}

describe("native Tool display",()=>{
  it("shows only recorded status and duration for a metadata-only deep search", () => {
    const wrapper = renderDeepSearch({resultKind: "omitted", texts: [], diagnostics: ["arguments_unavailable", "result_unavailable"]},
      {availability: "partial", argumentsSummary: "参数不可展示"});
    expect(wrapper.text()).toBe("网页深度搜索已完成 · 8.3 秒");
    expect(wrapper.find("button, [role=note], .chat-timeline-item-shell__body").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps source order across expansion and opens the selected result's recorded URL", async () => {
    const results = Array.from({length: 5}, (_, index) => ({
      title: `天气资料 ${index + 1}`, url: `https://example.org/${index}`, snippet: `摘要 ${index + 1}`,
    }));
    const actions = {open: vi.fn(async () => {}), icon: vi.fn(async () => null)};
    const wrapper = renderDeepSearch({resultKind: "text", diagnostics: [],
      texts: [{index: 0, text: JSON.stringify({results, truncated: false})}]}, {}, actions);
    const toggle = wrapper.get(".chat-timeline-item-shell__disclosure");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).toContain("网页深度搜索 · 杭州天气");
    expect(toggle.text()).toContain("5 条结果");
    await toggle.trigger("click");
    expect(wrapper.get(".native-tool__query").text()).toContain("杭州天气");
    expect(wrapper.findAll(".web-result__rows li")).toHaveLength(3);
    const more = wrapper.get(".web-result__more");
    expect(more.text()).toBe("查看另外 2 条");
    await more.trigger("click");
    expect(wrapper.findAll(".native-tool strong").map(row => row.text())).toEqual(results.map(row => row.title));
    const links = wrapper.findAll(".web-result__rows a");
    expect(links.map(link => link.attributes("href"))).toEqual(results.map(row => row.url));
    expect(links[4]!.text()).toBe("example.org");
    expect(actions.open).not.toHaveBeenCalled();
    expect(actions.icon).not.toHaveBeenCalled();
    await links[4]!.trigger("click");
    expect(actions.open).toHaveBeenCalledExactlyOnceWith({
      sessionId: "trace-session", turnId: "trace-turn", itemId: "deep-search", url: results[4]!.url,
    });
    expect(wrapper.text()).toContain("摘要 5");
    expect(wrapper.text()).toContain("耗时 8.3 秒");
    expect(wrapper.find("img, iframe, pre, .chat-copy-action").exists()).toBe(false);
    await more.trigger("click");
    expect(wrapper.findAll(".web-result__rows li")).toHaveLength(3);
    wrapper.unmount();
  });

  it.each([
    ['{"results":[],"truncated":false}', "未找到相关网页。", true],
    ['{"results":[],"truncated":true}', "部分搜索结果未完整展示。", false],
    ['{"error":{"code":"quota_exceeded","message":"网页检索额度已用尽。"}}', "网页检索额度已用尽。", false],
    ["历史结果详情不可用", "本次搜索的结果详情不可用。", false],
  ] as const)("distinguishes real empty results, partial results, errors and missing content (%s)", async (text, expected, empty) => {
    const wrapper = renderDeepSearch({resultKind: "text", texts: [{index: 0, text}], diagnostics: []},
      {status: text.includes("quota_exceeded") ? "failed" : "completed"});
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(wrapper.text()).toContain(expected);
    expect(wrapper.text().includes("0 条结果")).toBe(empty);
    expect(wrapper.find("pre").exists()).toBe(false);
    wrapper.unmount();
  });

  it("reuses the retrieval presentation for builtin native MCP results",async()=>{
    const text=JSON.stringify({results:[{title:"公开资料",url:"https://example.com/docs",snippet:"普通检索材料"}],truncated:false});
    const raw=traceItem("builtin-web","mcpToolCall",{status:"completed",toolLabel:"yijie_web / kimi_web_search",mcp:{server:"yijie_web",tool:"kimi_web_search",resultKind:"text",texts:[{index:0,text}],diagnostics:[]}});
    const item=traceTurn([raw]).items[0]!;
    if(item.execution?.kind!=="tool" || !("native" in item.execution))throw new Error("missing native execution");
    const wrapper=mount(ChatNativeToolItem,{props:{item,execution:item.execution}});
    const toggle=wrapper.get("button.chat-timeline-item-shell__disclosure");
    if(toggle.attributes("aria-expanded")!=="true")await toggle.trigger("click");
    expect(wrapper.text()).toContain("采集网页资料");expect(wrapper.text()).toContain("公开资料");
    expect(wrapper.get("[aria-label='网页检索材料']").text()).toContain("普通检索材料");
    expect(activityToolSourceLabel(item)).toBe("易界网页检索");wrapper.unmount();
  });
  it("shows native file changes and child activity without inventing an MCP result or child completion", async()=>{
    for (const raw of [
      traceItem("patch169", "fileChange", {status:"completed",toolLabel:"修改文件",text:"新增 note.txt",outputText:"+ordinary note"}),
      traceItem("spawn169", "subAgentActivity", {toolLabel:"启动子任务",text:"启动子任务 /root/report"}),
    ]) {
      const original=JSON.stringify(raw);const item=traceTurn([raw]).items[0]!;
      if(item.execution?.kind!=="tool"||!("native" in item.execution))throw new Error("native operation missing");
      const wrapper=mount(ChatNativeToolItem,{props:{item,execution:item.execution}});
      const button=wrapper.get("button.chat-timeline-item-shell__disclosure");
      if(button.attributes("aria-expanded")!=="true")await button.trigger("click");
      expect(wrapper.text()).toContain(raw.text);
      expect(wrapper.text()).not.toContain("工具身份信息不完整");
      expect(wrapper.text()).not.toContain("服务返回文本");
      if(raw.type==="subAgentActivity") {expect(wrapper.text()).toContain("已记录");expect(wrapper.text()).not.toContain("子任务已完成");}
      expect(JSON.stringify(raw)).toBe(original);wrapper.unmount();
    }
  });
  it("shows a readable broker tool name without contradicting a real failed status or rewriting facts", async()=>{
    const raw=traceItem("fetch", "mcpToolCall", {status:"failed",availability:"partial",toolLabel:"yijie_market / kimi_web_fetch",mcp:{server:"yijie_market",tool:"kimi_web_fetch",resultKind:"text",texts:[{index:0,text:"普通失败说明"}],diagnostics:["content_truncated"]}});
    const before=JSON.stringify(raw); const item=traceTurn([raw]).items[0]!;
    if(item.execution?.kind!=="tool" || !("native" in item.execution)) throw new Error("missing execution");
    const wrapper=mount(ChatNativeToolItem,{props:{item,execution:item.execution}});
    expect(wrapper.get("button.chat-timeline-item-shell__disclosure").text()).toContain("读取网页（Kimi）");
    expect(wrapper.text()).toContain("调用失败"); expect(wrapper.text()).toContain("此项信息不完整");
    expect(wrapper.text()).not.toContain("不代表执行失败");
    await wrapper.get("button.chat-timeline-item-shell__disclosure").trigger("click");
    expect(wrapper.text()).toContain("yijie_market / kimi_web_fetch");
    expect(wrapper.text()).toContain("普通失败说明"); expect(wrapper.text()).toContain("文本已达到显示长度限制");
    expect(activityToolSourceLabel(item)).toBe("Kimi 网页检索"); expect(JSON.stringify(raw)).toBe(before);wrapper.unmount();
    const named=traceTurn([{...raw,toolDisplay:{provenance:"registeredTool",title:"已登记的具体名称",sourceLabel:"已登记的服务"}}]).items[0]!;
    expect(activityToolTitle(named)).toBe("已登记的具体名称"); expect(activityToolSourceLabel(named)).toBe("已登记的服务");
    const other=traceTurn([{...raw,toolLabel:"ordinary-service / kimi_web_fetch",mcp:{...raw.mcp!,server:"ordinary-service"}}]).items[0]!;
    expect(activityToolTitle(other)).toBe("ordinary-service / kimi_web_fetch"); expect(activityToolSourceLabel(other)).toBeUndefined();
  });
  it("uses indexed plain native content with no legacy facts or active links",()=>{
    const props=fixture();
    expect(props.execution).not.toHaveProperty("startedSource");
    expect(props.execution).not.toHaveProperty("resultSummary");
    const wrapper=mount(ChatNativeToolItem,{props});
    expect(wrapper.text()).toContain("sorftime / product_detail");
    expect(wrapper.text()).toContain("仅供查看");
    expect(wrapper.text()).not.toContain("重新启动");
    expect(wrapper.text()).toContain("空文本块");
    expect(wrapper.findAll("[data-native-content-index]").map(v=>v.attributes("data-native-content-index"))).toEqual(["0","2"]);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.get(".native-tool").attributes("aria-busy")).toBe("true");
    wrapper.unmount();
  });
  it("stops busy feedback after Turn completion without changing the unfinished Item",async()=>{
    const props=fixture(true); expect(props.execution.native.item.status).toBe("inProgress");
    const wrapper=mount(ChatNativeToolItem,{props});
    await wrapper.get(".chat-timeline-item-shell__disclosure").trigger("click");
    expect(wrapper.text()).toContain("本轮已结束，未观察到该项结束记录");
    expect(wrapper.get(".native-tool").attributes("aria-busy")).toBe("false");
    wrapper.unmount();
  });
});
