// @vitest-environment happy-dom
import {mount} from "@vue/test-utils";
import {describe,expect,it} from "vitest";
import {h} from "vue";
import type {NativeConversationView,NativeDisplayItem} from "../../api/generated/native-conversation-private.gen";
import {composeConversationView} from "../../domain/conversation-view";
import {selectConversationTimeline} from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";

const entry=(item:NativeDisplayItem["item"],ordinal:number):NativeDisplayItem=>({item,ordinal,lastMethod:"item/completed"});
function view(items:NativeDisplayItem[]):NativeConversationView {
  return {sessionId:"session",turnId:"turn",runtimeThreadId:"runtime",runtimeTurnId:"runtime-turn",source:"native_observed",revision:"1",availability:"available",status:"completed",statusSource:"runtime_notification",terminalObserved:true,items};
}
function render(v:NativeConversationView) {
  const state=composeConversationView({threads:[{threadId:"session",status:"ready"}],turns:[],items:[]},[v]);
  return mount(ChatTurnGroup,{props:{turn:selectConversationTimeline(state,"session")!.turns[0]!,position:1}});
}
function timeline(v:NativeConversationView) {
  return selectConversationTimeline(composeConversationView({threads:[{threadId:"session",status:"ready"}],turns:[],items:[]},[v]),"session")!.turns[0]!;
}
const user=entry({id:"user",type:"userMessage",text:"更新本地说明文件。",availability:"available"},0);

describe("FEAT-163 re-audit: result delivery",()=>{
  it.each(['failed','interrupted'] as const)("keeps partial phase-less text as a message after %s without calling it an answer",status=>{
    const v=view([user,entry({id:'partial',type:'agentMessage',text:'我会继续核对附件。',availability:'available'},1)]);v.status=status;
    const wrapper=render(v);
    expect(wrapper.find('[aria-label="模型回答"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('我会继续核对附件。');
    expect(v.items[1]!.item.phase).toBeUndefined();wrapper.unmount();
  });
  it.each(['available','partial'] as const)("does not report a missing deliverable for a %s completed native file change without assistant prose",availability=>{
    const v=view([user,entry({id:"edit",type:"fileChange",status:"completed",availability,fileChange:{changes:[{index:0,kind:"update",pathLabel:"note.md",diffText:"@@ -1 +1 @@\n-old\n+new\n",addedLines:1,removedLines:1}]}},1)]);
    const before=JSON.stringify(v);const wrapper=render(v);
    expect(wrapper.find('.chat-turn-group__empty-result').exists()).toBe(false);
    expect(JSON.stringify(v)).toBe(before);
    wrapper.unmount();
  });
  it.each(["failed","declined","inProgress"] as const)("does not promote a %s file change into a delivered result",status=>{
    const wrapper=render(view([user,entry({id:"edit",type:"fileChange",status,availability:"available",fileChange:{changes:[{index:0,kind:"update",pathLabel:"note.md"}]}},1)]));
    expect(wrapper.find('.chat-turn-group__empty-result').exists()).toBe(true);wrapper.unmount();
  });
  it("does not count commentary alone as the answer",()=>{
    const wrapper=render(view([user,entry({id:"progress",type:"agentMessage",phase:"commentary",text:"我会先检查现有文件。",availability:"available"},1)]));
    expect(wrapper.find('.chat-turn-group__empty-result').exists()).toBe(true);wrapper.unmount();
  });
});

describe("FEAT-163 re-audit: structured output and normal reopen",()=>{
  it("keeps progress prose free of answer action bars while retaining final answer actions",()=>{
    const v=view([
      entry({id:"progress",type:"agentMessage",phase:"commentary",text:"先核对本地资料。",availability:"available"},0),
      entry({id:"answer",type:"agentMessage",phase:"final_answer",text:"核对完成。",availability:"available"},1)]);
    const wrapper=mount(ChatTurnGroup,{props:{turn:timeline(v),position:1},slots:{"item-actions":()=>h("button",{"data-answer-action":""},"复制")}});
    expect(wrapper.findAll('[data-answer-action]')).toHaveLength(1);wrapper.unmount();
  });
  it("renders one validated draft for a turn with multiple model messages and preserves explicit commentary",async()=>{
    const v=view([user,
      entry({id:"progress",type:"agentMessage",phase:"commentary",text:"我会检查计划所需的信息。",availability:"available"},1),
      entry({id:"candidate",type:"agentMessage",text:'{"raw":"first"}',availability:"available"},2),
      entry({id:"result",type:"agentMessage",phase:"final_answer",text:'{"raw":"last"}',availability:"available"},3)]);
    const before=JSON.stringify(v);
    const wrapper=mount(ChatTurnGroup,{props:{turn:timeline(v),position:1},slots:{"structured-answer":()=>h("div",{"data-draft":""},"已校验的草案")}});
    expect(wrapper.findAll('[data-draft]')).toHaveLength(1);
    await wrapper.get('.chat-turn-group__process-toggle').trigger('click');
    expect(wrapper.text()).toContain("我会检查计划所需的信息。");
    expect(wrapper.text()).not.toContain('{"raw":');
    expect(JSON.stringify(v)).toBe(before);wrapper.unmount();
  });
  it("uses confirmed historical tool facts for the same reading groups without inventing live completion",async()=>{
    const v=view([user,
      entry({id:"progress",type:"agentMessage",phase:"commentary",text:"我会检查本地说明。",availability:"available"},1),
      entry({id:"read",type:"commandExecution",status:"completed",commandPreview:"cat note.md",exitCode:0,availability:"available",commandActions:[{index:0,type:"read",pathLabel:"note.md"}]},2),
      entry({id:"edit",type:"fileChange",status:"completed",availability:"available",fileChange:{changes:[{index:0,kind:"update",pathLabel:"note.md",addedLines:1,removedLines:1}]}},3),
      entry({id:"result",type:"agentMessage",phase:"final_answer",text:"说明已更新。",availability:"available"},4)]);
    v.source="native_rebuilt";v.statusSource="runtime_read";v.terminalObserved=false;
    v.items.forEach(i=>{i.lastMethod="thread/read"});
    const before=JSON.stringify(v);const wrapper=render(v);
    expect(wrapper.findAll('.chat-turn-group__activity')).toHaveLength(1);
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    await wrapper.get('.chat-turn-group__process-toggle').trigger('click');
    expect(wrapper.text()).toContain("我会检查本地说明。");
    await wrapper.get('.chat-turn-group__activity button').trigger('click');
    expect(wrapper.get('.chat-turn-group__item--command').isVisible()).toBe(true);
    const read=timeline(v).items.find(i=>i.execution && 'native' in i.execution && i.execution.native.item.id==="read");
    expect(read?.domainStatus).toBe("incomplete");
    expect(JSON.stringify(v)).toBe(before);wrapper.unmount();
  });
});
