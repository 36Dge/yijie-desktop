// @vitest-environment happy-dom
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import type {NativeConversationView} from "../../api/generated/native-conversation-private.gen";
import {composeConversationView, type ConversationSnapshot} from "../../domain/conversation-view";
import {selectConversationTimeline} from "../../domain/conversation-timeline";
import {executionProgressDescriptions, observedProgressMessages, isCollapsibleProcessItem, processDetailItems} from "../../domain/conversation-process";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import ChatTimeline from "./ChatTimeline.vue";

const snapshot: ConversationSnapshot = {threads:[{threadId:"session",status:"ready"}],turns:[],items:[]};
const record = (item: NativeConversationView["items"][number]["item"], ordinal: number): NativeConversationView["items"][number] => ({item, ordinal, lastMethod:"item/completed"});
function native(): NativeConversationView {
  return {sessionId:"session",turnId:"turn",runtimeThreadId:"runtime",runtimeTurnId:"runtime-turn",source:"native_observed",
    revision:"1",availability:"available",status:"completed",statusSource:"runtime_notification",terminalObserved:true,
    items:[
      record({id:"user",type:"userMessage",text:"比较两座城市",availability:"available"},0),
      record({id:"search-a",type:"webSearch",webSearch:{action:"search",queries:["城市产业","生活成本"]},availability:"available"},1),
      record({id:"reason-a",type:"reasoning",summary:["先核对两地公开资料。"],content:[],availability:"available"},2),
      record({id:"command",type:"commandExecution",status:"completed",commandLabel:"执行命令",cwdLabel:"当前项目",exitCode:0,durationMs:0,availability:"available"},3),
      record({id:"reason-b",type:"reasoning",summary:["先核对两地公开资料。"],content:[],availability:"available"},4),
      record({id:"progress",type:"agentMessage",text:"继续核对公开资料。",availability:"available"},5),
      record({id:"search-b",type:"webSearch",webSearch:{action:"openPage",queries:[],pageLabel:"example.org"},availability:"available"},6),
      record({id:"answer",type:"agentMessage",text:"两地各有优势。",availability:"available"},7),
    ]};
}
function turn(view = native(), protect = false) {
  return selectConversationTimeline(composeConversationView(snapshot,[view]),"session",undefined,{protectApprovalProcessContent:protect})!.turns[0]!;
}

describe("native process reading layout", () => {
  it("shows only supplied search sources as inert text, distinct from answer citations", async () => {
    const view=native();
    view.items[1]!.item.webSearch!.sources=[{url:"https://example.org/statistics/2025",title:"Annual statistics"}];
    const before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    const search=wrapper.findAll(".chat-turn-group__item--web_search")[0]!;
    await search.get("button").trigger("click");
    expect(search.get('[aria-label="搜索来源"]').text()).toContain("https://example.org/statistics/2025");
    expect(search.text()).toContain("不代表回答已逐项引用或核验");
    expect(search.find("a").exists()).toBe(false);
    expect(JSON.stringify(view)).toBe(before);
    expect(wrapper.findAll(".chat-turn-group__item--assistant_unclassified")[1]!.text()).not.toContain("example.org");
    wrapper.unmount();
  });

  it("keeps completed search detail limitations inside the disclosure without hiding unavailable records", async () => {
    const view=native(); view.items[1]!.item.availability="partial";
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    const search=wrapper.findAll(".chat-turn-group__item--web_search")[0]!;
    expect(search.find('[role="note"]').exists()).toBe(false);
    await search.get("button").trigger("click");
    expect(search.get('[role="note"]').text()).toContain("信息不完整");
    view.items[1]!.item.availability="unavailable";
    await wrapper.setProps({turn:turn(view)});
    await search.get("button").trigger("click");
    expect(search.get('[role="note"]').text()).toContain("内容暂不可用");
    wrapper.unmount();
  });

  it("shows search and progress naturally, keeps empty commands and duplicate summaries in inspectable details", async () => {
    const view=native(), before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1,timingLabel:"已完成 72s"}});
    const nodes=wrapper.findAll(".chat-turn-group__item");
    expect(nodes).toHaveLength(8);
    expect(nodes[7]!.isVisible()).toBe(true);
    expect(nodes[5]!.isVisible()).toBe(false);
    expect(wrapper.find(".chat-turn-group__unknown").exists()).toBe(false);
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    expect(nodes[1]!.isVisible()).toBe(true);
    expect(nodes[1]!.text()).toContain("已搜索网页");
    expect(nodes[6]!.text()).toContain("已阅读网页");
    expect(nodes[5]!.isVisible()).toBe(true);
    expect(nodes[5]!.get("article").classes()).toContain("chat-timeline-item-shell--process-inline");
    expect(nodes[2]!.isVisible()).toBe(false);
    expect(nodes[3]!.isVisible()).toBe(false);
    await wrapper.get(".chat-turn-group__details-control button").trigger("click");
    expect(nodes[2]!.isVisible()).toBe(true);
    expect(nodes[3]!.isVisible()).toBe(true);
    expect(nodes[4]!.text()).toContain("重复摘要（原始记录）");
    expect(nodes[4]!.get("button").attributes("aria-expanded")).toBe("false");
    await nodes[4]!.get("button").trigger("click");
    expect(nodes[4]!.text()).toContain("先核对两地公开资料。");
    await nodes[3]!.get("button").trigger("click");
    expect(nodes[3]!.text()).toContain("命令已结束，无可显示输出。");
    expect(nodes[3]!.text()).toContain("0 毫秒");
    expect(wrapper.text()).not.toContain("未提供原始模型推理正文");
    expect(JSON.stringify(view)).toBe(before);
    expect(turn(view).items[5]!.assistantPhase).toBe("unknown");
    wrapper.unmount();
  });

  it("keeps old unsupported records available in details without claiming they were searches", async () => {
    const view=native();view.items=[record({id:"old",type:"unknown",availability:"unavailable"},0),view.items[7]!];
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    expect(wrapper.get(".chat-turn-group__item--unknown").isVisible()).toBe(false);
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    expect(wrapper.get(".chat-turn-group__item--unknown").isVisible()).toBe(false);
    await wrapper.get(".chat-turn-group__details-control button").trigger("click");
    expect(wrapper.get(".chat-turn-group__item--unknown").isVisible()).toBe(true);
    expect(wrapper.text()).toContain("unsupported_content");
    expect(wrapper.text()).not.toContain("已搜索网页");
    wrapper.unmount();
  });

  it("does not hide failures or cross explicit final and user-input boundaries", () => {
    const view=native();view.items[3]!.item.status="failed";view.items[3]!.item.exitCode=1;
    view.items.splice(6,0,record({id:"explicit",type:"agentMessage",phase:"final_answer",text:"明确回答",availability:"available"},6));
    const projected=turn(view);
    expect(observedProgressMessages(projected.items).has(projected.items[5]!.identity)).toBe(false);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:projected,position:1}});
    expect(wrapper.get(".chat-turn-group__item--command").isVisible()).toBe(true);
    expect(wrapper.get(".chat-turn-group__item--command").text()).toContain("执行失败");
    const barrier={...projected.items[6]!,presentation:"user_message" as const};
    expect(observedProgressMessages([...projected.items.slice(0,6),barrier,...projected.items.slice(7)]).has(projected.items[5]!.identity)).toBe(false);
    wrapper.unmount();
  });

  it("keeps protected process text protected when the reading placement changes", async () => {
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(native(),true),position:1}});
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    await wrapper.get(".chat-turn-group__details-control button").trigger("click");
    expect(wrapper.text()).not.toContain("继续核对公开资料。");
    expect(wrapper.text()).not.toContain("先核对两地公开资料。");
    expect(wrapper.text()).toContain("模型过程内容已隐藏");
    wrapper.unmount();
  });

  it("does not rewrite live unclassified messages and preserves the manual disclosure choice", async () => {
    const view=native();view.status="inProgress";view.terminalObserved=false;view.items=view.items.slice(0,6);
    const projected=()=>selectConversationTimeline(composeConversationView(snapshot,[view]),"session",undefined,{protectApprovalProcessContent:false,liveTurnId:"turn"})!.turns[0]!;
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:projected(),position:1}});
    expect(wrapper.get(".chat-turn-group__timing button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll(".chat-turn-group__item--assistant_unclassified")[0]!.isVisible()).toBe(true);
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    view.items.push(record({id:"later",type:"webSearch",webSearch:{action:"findInPage",queries:[],pattern:"收入"},availability:"available"},6));
    await wrapper.setProps({turn:projected()});
    expect(wrapper.get(".chat-turn-group__timing button").attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll(".chat-turn-group__item--assistant_unclassified")[0]!.isVisible()).toBe(false);
    expect(view.items[5]!.item.phase).toBeUndefined();
    wrapper.unmount();
  });

  it("collapses a summary when completion proves it is an exact repeat", async () => {
    const view=native();view.status="inProgress";view.terminalObserved=false;
    view.items=view.items.slice(0,5);view.items[4]!.lastMethod="item/started";
    const projected=()=>selectConversationTimeline(composeConversationView(snapshot,[view]),"session",undefined,{protectApprovalProcessContent:false,liveTurnId:"turn"})!.turns[0]!;
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:projected(),position:1}});
    await wrapper.get(".chat-turn-group__details-control button").trigger("click");
    view.items[4]!.lastMethod="item/completed";
    await wrapper.setProps({turn:projected()});
    const duplicate=wrapper.findAll(".chat-turn-group__item--reasoning")[1]!;
    expect(duplicate.get("button").attributes("aria-expanded")).toBe("false");
    await duplicate.get("button").trigger("click");
    expect(duplicate.text()).toContain("先核对两地公开资料。");
    wrapper.unmount();
  });

  it.each([false,true])("keeps the last readable phase-less answer with trailing work (empty tail: %s)", emptyTail => {
    const view=native();view.items.push(record({id:"trailing",type:"reasoning",summary:["已整理资料。"],content:[],availability:"available"},8));
    if(emptyTail)view.items.push(record({id:"empty-tail",type:"agentMessage",text:"",availability:"available"},9));
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    const messages=wrapper.findAll(".chat-turn-group__item--assistant_unclassified");
    expect(messages[0]!.isVisible()).toBe(false);
    expect(messages[1]!.isVisible()).toBe(true);
    expect(messages[1]!.text()).toContain("两地各有优势。");
    wrapper.unmount();
  });
});

describe("model and runtime progress have distinct provenance", () => {
  it("keeps routine output policy inspectable without presenting it as an execution warning", () => {
    const base = selectConversationTimeline(composeConversationView(snapshot,[native()]),'session')!;
    const routine = {identity:'output-policy', source:'thread_notice' as const, role:'system' as const, severity:'warning' as const, code:'conversation_warning' as const, diagnostic:'command_output_pending_final', count:1};
    const conflict = {...routine, identity:'conflict', diagnostic:'history_source_conflict'};
    const timeline = {...base,notices:[routine,conflict]};
    const before = JSON.stringify(timeline);
    const wrapper = mount(ChatTimeline, {props:{timeline}});
    expect(wrapper.get('details summary').text()).toBe('命令输出说明');
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.get('details').text()).toContain('安全输出以各命令的结束记录为准');
    expect(wrapper.get('[aria-label="对话通知"]').text()).toContain('历史读取与已观察事实不同');
    expect(wrapper.get('[aria-label="对话通知"]').text()).not.toContain('安全输出');
    expect(JSON.stringify(timeline)).toBe(before);
    wrapper.unmount();
  });

  it("renders a quiet provider's actual web work as system prose without creating a model message", async () => {
    const view = native();
    view.items = [view.items[0]!, view.items[1]!, view.items[2]!, view.items[7]!];
    const before = JSON.stringify(view);
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    const description = wrapper.get('.chat-turn-group__execution-description');
    expect(description.isVisible()).toBe(false);
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(description.isVisible()).toBe(true);
    expect(description.text()).toContain('执行进度');
    expect(description.text()).toContain('已完成网页搜索');
    expect(wrapper.find('[data-progress-source="model"]').exists()).toBe(false);
    expect(wrapper.findAll('.chat-turn-group__item--assistant_unclassified')).toHaveLength(1);
    expect(wrapper.get('.chat-turn-group__item--assistant_unclassified').text()).toContain('两地各有优势。');
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("keeps genuine commentary in order and labels it as model progress", async () => {
    const view = native();
    view.items = [view.items[0]!, record({id:'comment', type:'agentMessage', phase:'commentary', text:'我会先核对两地资料。', availability:'available'}, 1), view.items[1]!, view.items[7]!];
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(wrapper.get('[data-progress-source="model"]').text()).toBe('模型进度');
    expect(wrapper.get('.chat-turn-group__item--commentary .chat-safe-content').text()).toBe('我会先核对两地资料。');
    const children = [...wrapper.get('.chat-turn-group__items').element.children];
    const model = children.findIndex(node => node.classList.contains('chat-turn-group__item--commentary'));
    const system = children.findIndex(node => node.classList.contains('chat-turn-group__execution-description'));
    const web = children.findIndex(node => node.classList.contains('chat-turn-group__item--web_search'));
    expect(model).toBeLessThan(system);
    expect(system).toBeLessThan(web);
    wrapper.unmount();
  });

  it("does not label an unclassified model message as explicit progress", async () => {
    const view = native();
    view.items[5]!.item.text = "初步对比：[统计资料](https://example.org/statistics/2025)。";
    const before = JSON.stringify(view);
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    const message = wrapper.findAll('.chat-turn-group__item--assistant_unclassified')[0]!;
    expect(message.isVisible()).toBe(true);
    expect(message.get('[data-message-source="model"]').text()).toBe('模型消息');
    expect(wrapper.find('[data-progress-source="model"]').exists()).toBe(false);
    expect(message.text()).toContain('https://example.org/statistics/2025');
    expect(message.find('a').exists()).toBe(false);
    expect(view.items[5]!.item.phase).toBeUndefined();
    expect(turn(view).items[5]!.assistantPhase).toBe('unknown');
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("allows a short answer with neither progress nor citations", () => {
    const view = native();
    view.items = [view.items[0]!, view.items[7]!];
    const before = JSON.stringify(view);
    const wrapper = mount(ChatTurnGroup, {props: {turn: turn(view), position: 1}});
    expect(wrapper.find('[data-progress-source]').exists()).toBe(false);
    expect(wrapper.find('.chat-turn-group__process-toggle').exists()).toBe(false);
    expect(wrapper.text()).toContain('两地各有优势。');
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("retains source associations in answer tables and lists across process folding", async () => {
    const view = native();
    const answer = "| 指标 | 合成示例 |\n| --- | --- |\n| 2025 年指标 | 100 [统计资料](https://example.org/statistics/2025) |\n\n- 2024 年另一指标：80 [另一来源](https://example.org/statistics/2024)\n\n这是解释性文字。";
    view.items[7]!.item.text = answer;
    const before = JSON.stringify(view);
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    const message = wrapper.findAll('.chat-turn-group__item--assistant_unclassified')[1]!;
    const row = message.get('tbody tr');
    expect(row.text()).toContain('2025 年指标');
    expect(row.text()).toContain('100');
    expect(row.get('.chat-safe-content__inert-link').text()).toContain('https://example.org/statistics/2025');
    expect(message.get('li').text()).toContain('80 另一来源（https://example.org/statistics/2024）');
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(message.isVisible()).toBe(true);
    expect(message.findAll('.chat-safe-content__inert-link')).toHaveLength(2);
    expect(message.find('a, [href]').exists()).toBe(false);
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("coalesces adjacent work across hidden details but never across a model message", () => {
    const view = native();
    const extra = record({id:'extra', type:'webSearch', webSearch:{action:'search',queries:['公开数据']}, availability:'available'},4);
    view.items = [view.items[0]!, view.items[1]!, view.items[2]!, view.items[3]!, extra, view.items[5]!, view.items[6]!, view.items[7]!];
    const t = turn(view);
    const keys = new Set(t.items.filter(i => isCollapsibleProcessItem(i)).map(i => i.identity));
    const descriptions = executionProgressDescriptions(t, keys, processDetailItems(t.items));
    expect(descriptions.size).toBe(2);
    expect([...descriptions.values()][0]!.text).toContain('已完成 2 次网页搜索');
    expect([...descriptions.values()][0]!.itemIdentities).toHaveLength(2);
    expect([...descriptions.values()].some(v => v.text.includes('命令'))).toBe(false);
  });

  it("shows active work only while the native observation is live", async () => {
    const view = native();
    view.status = 'inProgress'; view.terminalObserved = false;
    view.items = [view.items[0]!, {...view.items[1]!, lastMethod:'item/started'}];
    const project = (live: boolean) => selectConversationTimeline(composeConversationView(snapshot,[view]),'session',undefined,
      {protectApprovalProcessContent:false,liveTurnId:live?'turn':null})!.turns[0]!;
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props:{turn:project(true),position:1}});
    expect(wrapper.get('.chat-execution-progress').text()).toContain('正在进行网页搜索');
    expect(wrapper.text()).not.toContain('已完成网页搜索');
    await wrapper.setProps({turn:project(false)});
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    expect(wrapper.text()).toContain('当前进度待确认');
    wrapper.unmount();
  });

  it("does not promote cold history, unknown kinds, failures or pending approval into progress", () => {
    const projected = turn();
    const command = {...projected.items[3]!, approval: {status:'pending'} as NonNullable<typeof projected.items[3]>['approval']};
    const bad = {...projected.items[1]!, availability:'unavailable' as const};
    const base = {...projected,items:[command,bad]};
    const keys = new Set(base.items.map(i=>i.identity));
    expect(executionProgressDescriptions(base,keys,new Set()).size).toBe(0);
    expect(executionProgressDescriptions({...projected,source:'native_rebuilt'},new Set(projected.items.map(i=>i.identity)),new Set()).size).toBe(0);
    const read = native();read.items[1]!.lastMethod='thread/read';read.items=[read.items[1]!];
    const t = turn(read);
    expect(executionProgressDescriptions(t,new Set(t.items.map(i=>i.identity)),new Set()).size).toBe(0);
  });

  it("keeps the source labels out of original model content and preserves the protected text boundary", async () => {
    const wrapper = mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(native(),true),position:1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(wrapper.findAll('[data-progress-source="runtime_records"]').length).toBeGreaterThan(0);
    expect(wrapper.text()).not.toContain('继续核对公开资料。');
    expect(wrapper.text()).not.toContain('先核对两地公开资料。');
    expect(wrapper.text()).toContain('模型过程内容已隐藏');
    wrapper.unmount();
  });
});
