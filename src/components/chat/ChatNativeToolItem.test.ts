// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatNativeToolItem from "./ChatNativeToolItem.vue";

function fixture(terminal=false) {
  const view: NativeConversationView={sessionId:"session",turnId:"turn",runtimeThreadId:"thread",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"4",availability:"available",status:terminal?"completed":"inProgress",statusSource:"runtime_notification",terminalObserved:terminal,items:[{ordinal:0,lastMethod:"item/started",item:{id:"tool-item",type:"mcpToolCall",status:"inProgress",availability:"available",argumentsSummary:"ASIN: B07H9PZDQW · 站点: US",mcp:{server:"sorftime",tool:"product_detail",resultKind:"text",texts:[{index:0,text:""},{index:2,text:"普通商品资料 https://example.test/product"}],diagnostics:[]}}}]};
  const state=composeConversationView({threads:[{threadId:"session",status:"ready"}],turns:[],items:[]},[view]);
  const item=selectConversationTimeline(state,"session",undefined,{liveTurnId:"turn",protectApprovalProcessContent:false})!.turns[0]!.items[0]!;
  if(item.execution?.kind!=="tool" || !("native" in item.execution)) throw new Error("native Tool missing");
  return {item,execution:item.execution};
}

describe("native Tool display",()=>{
  it("uses indexed plain native content with no legacy facts or active links",()=>{
    const props=fixture();
    expect(props.execution).not.toHaveProperty("startedSource");
    expect(props.execution).not.toHaveProperty("resultSummary");
    const wrapper=mount(ChatNativeToolItem,{props});
    expect(wrapper.text()).toContain("sorftime / product_detail");
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
