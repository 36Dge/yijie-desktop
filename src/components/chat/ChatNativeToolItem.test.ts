// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
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

describe("native Tool display",()=>{
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
