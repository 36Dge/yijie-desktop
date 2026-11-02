// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";

function view(): NativeConversationView {
  return {sessionId:"session",turnId:"turn",runtimeThreadId:"runtime",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"1",availability:"available",status:"completed",statusSource:"runtime_notification",terminalObserved:true,items:[
    {ordinal:0,lastMethod:"item/completed",item:{id:"empty",type:"reasoning",summary:["", "  \n"],content:[],availability:"available"}},
    {ordinal:1,lastMethod:"item/completed",item:{id:"tool",type:"mcpToolCall",status:"completed",availability:"available",argumentsSummary:"查询所有已连接服务的可用资源",mcp:{server:"codex",tool:"list_mcp_resources",resultKind:"text",texts:[{index:0,text:"未发现可用资源"}],diagnostics:[]}}},
    {ordinal:2,lastMethod:"item/completed",item:{id:"thought",type:"reasoning",summary:["已有资料足以说明历史。"],content:[],availability:"available"}},
    {ordinal:3,lastMethod:"item/completed",item:{id:"answer",type:"agentMessage",text:"这里是正文。",availability:"available"}},
  ]};
}
const turn = (value: NativeConversationView) => selectConversationTimeline(composeConversationView({threads:[{threadId:"session",status:"ready"}],turns:[],items:[]},[value]),"session",undefined,{protectApprovalProcessContent:false,liveTurnId:"turn"})!.turns[0]!;

describe("answer completion reading layout", () => {
  it("omits only empty ended thinking and preserves saved records and the real tool result", async () => {
    const value=view(), original=JSON.stringify(value);
    const wrapper=mount(ChatTurnGroup,{props:{turn:turn(value),position:1}});
    await wrapper.get('.chat-turn-group__process-toggle').trigger('click');
    expect(wrapper.findAll('.chat-deep-thinking')).toHaveLength(1);
    expect(wrapper.get('.chat-execution-progress').text()).toContain('已完成资源检查');
    await wrapper.get('.chat-turn-group__item--tool button').trigger('click');
    expect(wrapper.get('.native-tool').text()).toContain('未发现可用资源');
    expect(wrapper.text()).not.toContain('结果内容已省略');
    expect(JSON.stringify(value)).toBe(original);
    wrapper.unmount();
  });
  it("keeps the live empty waiting state, then removes it when its item or turn ends", async () => {
    const value=view();value.items=[value.items[0]!];value.status='inProgress';value.terminalObserved=false;value.items[0]!.lastMethod='item/started';
    const wrapper=mount(ChatTurnGroup,{props:{turn:turn(value),position:1}});
    expect(wrapper.find('.chat-deep-thinking').exists()).toBe(true);
    expect(wrapper.text()).toContain('正在等待思考内容');
    value.status='completed';value.terminalObserved=true;
    await wrapper.setProps({turn:turn(value)});
    expect(wrapper.find('.chat-deep-thinking').exists()).toBe(false);
    expect(wrapper.find('.chat-turn-group__process-toggle').exists()).toBe(false);
    wrapper.unmount();
  });
  it("keeps a factual tool progress summary even when only the result display is partial", async () => {
    const value=view();const tool=value.items[1]!.item;tool.availability='partial';tool.mcp!.resultKind='omitted';tool.mcp!.texts=[];tool.mcp!.diagnostics=['result_unavailable'];
    const wrapper=mount(ChatTurnGroup,{props:{turn:turn(value),position:1}});
    await wrapper.get('.chat-turn-group__process-toggle').trigger('click');
    expect(wrapper.get('.chat-execution-progress').text()).toContain('已完成资源检查');
    tool.status='failed';await wrapper.setProps({turn:turn(value)});
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    wrapper.unmount();
  });
});
