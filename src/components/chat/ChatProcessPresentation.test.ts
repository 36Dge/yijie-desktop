// @vitest-environment happy-dom
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";
import {provideChatDisclosureChoices} from "../../composables/useChatDisclosureChoice";
import type {NativeConversationView} from "../../api/generated/native-conversation-private.gen";
import {composeConversationView, type ConversationSnapshot} from "../../domain/conversation-view";
import {selectConversationTimeline} from "../../domain/conversation-timeline";
import {processActivityGroups, observedProgressMessages, isCollapsibleProcessItem, processDetailItems} from "../../domain/conversation-process";
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

it("retains turn, segment and item reading choices through a same-session timeline remount", async () => {
  const mounted = ref(true), scope = ref("tenant:session");
  const view = native(); view.status = "inProgress"; view.terminalObserved = false;
  view.items[3]=record({id:'patch',type:'fileChange',status:'completed',availability:'available',fileChange:{changes:[{index:0,kind:'add',pathLabel:'result.md',diffText:'Ordinary result',addedLines:1,removedLines:0}]}},3);
  const current = ref(selectConversationTimeline(composeConversationView(snapshot,[view]),"session",undefined,{protectApprovalProcessContent:false,liveTurnId:"turn"})!);
  const Page = defineComponent({setup() {
    provideChatDisclosureChoices(() => scope.value);
    return () => mounted.value ? h(ChatTimeline,{timeline:current.value}) : null;
  }});
  const wrapper = mount(Page,{attachTo:document.body});
  await wrapper.get('.chat-turn-group__activity button').trigger('click');
  await wrapper.get('.chat-turn-group__item--web_search button').trigger('click');
  (wrapper.get('.chat-file-change details').element as HTMLDetailsElement).open = true;
  await wrapper.get('.chat-file-change details').trigger('toggle');
  mounted.value = false; await nextTick();
  view.status = "completed"; view.terminalObserved = true;
  current.value = selectConversationTimeline(composeConversationView(snapshot,[view]),"session")!;
  mounted.value = true; await nextTick();
  expect(wrapper.get('.chat-turn-group__activity button').attributes('aria-expanded')).toBe('true');
  expect(wrapper.get('.chat-turn-group__item--web_search button').attributes('aria-expanded')).toBe('true');
  expect(wrapper.get('.chat-turn-group__item--web_search').isVisible()).toBe(true);
  expect((wrapper.get('.chat-file-change details').element as HTMLDetailsElement).open).toBe(true);
  scope.value = "different-tenant:session"; await nextTick();
  expect(wrapper.get('.chat-turn-group__item--web_search').isVisible()).toBe(false);
  wrapper.unmount();
});

it("keeps long command labels compact while preserving the safe command in details", async () => {
  const view=native();
  const command = `cat > result.csv <<'EOF'\n${'ordinary local data\n'.repeat(20)}EOF`;
  view.items=[view.items[0]!,record({id:'command',type:'commandExecution',status:'completed',availability:'available',commandPreview:command,commandActions:[{index:0,type:'unknown',commandPreview:command}]},1),view.items[view.items.length - 1]!];
  const wrapper=mount(ChatTurnGroup,{props:{turn:turn(view),position:1}});
  await wrapper.get('.chat-turn-group__timing button').trigger('click');
  const button=wrapper.get('.chat-turn-group__item--command button');
  expect(button.text()).toContain("cat > result.csv <<'EOF'…");
  expect(button.text()).not.toContain('ordinary local data');
  await button.trigger('click');
  expect(wrapper.get('.chat-turn-group__item--command').text()).toContain('ordinary local data');
  wrapper.unmount();
});

describe("native activity v5", () => {
  it("interleaves public prose and file/action/App summaries using original identities", async () => {
    const view=native();
    view.items=[view.items[0]!,
      record({id:'progress',type:'agentMessage',phase:'commentary',text:'已核对输入，现在更新说明。',availability:'available'},1),
      record({id:'read',type:'commandExecution',status:'completed',availability:'available',commandPreview:'cat note.md',commandActions:[{index:0,type:'read',pathLabel:'note.md',name:'note.md',commandPreview:'cat note.md'}]},2),
      record({id:'edit',type:'fileChange',status:'completed',availability:'available',fileChange:{changes:[{index:0,kind:'update',pathLabel:'note.md',addedLines:2,removedLines:1,diffText:'ordinary diff'},{index:1,kind:'update',pathLabel:'guide.md',addedLines:1,removedLines:0}]}},3),
      record({id:'app',type:'mcpToolCall',status:'completed',availability:'available',appContext:{connectorId:'example',appName:'Example App',actionName:'Read report'},toolLabel:'example / read_report'},4),
      view.items[7]!];
    const before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    const group=wrapper.get('.chat-turn-group__activity');
    expect(group.text()).toContain('读取了文件、编辑了多个文件、已使用 Example App');
    expect(group.text()).not.toMatch(/\d+ (次|条)/);
    await group.get('button').trigger('click');
    expect(wrapper.get('.chat-turn-group__item--command button').text()).toContain('已读取 note.md');
    expect(wrapper.findAll('.chat-file-change details')).toHaveLength(2);
    expect(wrapper.findAll('.chat-file-change summary')[0]!.text()).toContain('+2 −1');
    expect(wrapper.findAll('.chat-file-change summary')[1]!.text()).toContain('guide.md');
    expect(wrapper.text()).toContain('已使用 Example App · Read report');
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("does not infer multiple files from repeated paths or replace unknown statistics with zero", async () => {
    const view=native();
    view.items=[view.items[0]!,record({id:'edit',type:'fileChange',status:'completed',availability:'partial',fileChange:{changes:[{index:0,kind:'update',pathLabel:'same.md'},{index:1,kind:'update',pathLabel:'same.md'}]}},1),view.items[3]!,view.items[7]!];
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(wrapper.get('.chat-turn-group__activity').text()).toContain('编辑了文件');
    expect(wrapper.get('.chat-turn-group__activity').text()).not.toContain('多个文件');
    await wrapper.get('.chat-turn-group__activity button').trigger('click');
    expect(wrapper.get('.chat-file-change').text()).not.toContain('+0');
    expect(wrapper.get('.chat-file-change').text()).toContain('增删行统计不可用');
    wrapper.unmount();
  });

  it("preserves an inspected single Item when another activity joins its segment", async () => {
    const view=native();view.status='inProgress';view.terminalObserved=false;view.items=view.items.slice(0,2);
    const project=()=>selectConversationTimeline(composeConversationView(snapshot,[view]),'session',undefined,{protectApprovalProcessContent:false,liveTurnId:'turn'})!.turns[0]!;
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:project(),position:1}});
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    await wrapper.get('.chat-turn-group__item--web_search button').trigger('pointerdown');
    await wrapper.get('.chat-turn-group__item--web_search button').trigger('click');
    view.items.push(record({id:'command',type:'commandExecution',status:'completed',availability:'available'},2));
    await wrapper.setProps({turn:project()});
    expect(wrapper.get('.chat-turn-group__activity button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-turn-group__item--web_search button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-turn-group__item--web_search').isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("keeps a single failed activity visible after turn folding", () => {
    const view=native();view.items=[view.items[0]!,record({id:'failed',type:'commandExecution',status:'failed',exitCode:1,availability:'available'},1),view.items[7]!];
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    expect(wrapper.get('.chat-turn-group__item--command').isVisible()).toBe(true);
    expect(wrapper.get('.chat-turn-group__item--command').text()).toContain('执行失败');
    wrapper.unmount();
  });
});

describe("native process reading layout", () => {
  it("shows only supplied search sources as inert text, distinct from answer citations", async () => {
    const view=native();
    view.items[1]!.item.webSearch!.sources=[{url:"https://example.org/statistics/2025",title:"Annual statistics"}];
    const before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    await wrapper.findAll(".chat-turn-group__activity button")[0]!.trigger("click");
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
    await wrapper.findAll(".chat-turn-group__activity button")[0]!.trigger("click");
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
    const messages=wrapper.findAll(".chat-turn-group__item--assistant_unclassified");
    const searches=wrapper.findAll(".chat-turn-group__item--web_search");
    const reasons=wrapper.findAll(".chat-turn-group__item--reasoning");
    const command=wrapper.get(".chat-turn-group__item--command");
    expect(messages[1]!.isVisible()).toBe(true);
    expect(messages[0]!.isVisible()).toBe(false);
    expect(wrapper.find(".chat-turn-group__unknown").exists()).toBe(false);
    await wrapper.get(".chat-turn-group__timing button").trigger("click");
    expect(searches[0]!.isVisible()).toBe(false);
    await wrapper.get(".chat-turn-group__activity button").trigger("click");
    expect(searches[0]!.isVisible()).toBe(true);
    expect(searches[0]!.text()).toContain("已搜索网页");
    expect(searches[1]!.text()).toContain("已阅读网页");
    expect(messages[0]!.isVisible()).toBe(true);
    expect(messages[0]!.get("article").classes()).toContain("chat-timeline-item-shell--process-inline");
    expect(reasons[0]!.isVisible()).toBe(false);
    expect(command.isVisible()).toBe(true);
    await wrapper.get(".chat-turn-group__details-control button").trigger("click");
    expect(reasons[0]!.isVisible()).toBe(true);
    expect(reasons[1]!.text()).toContain("重复摘要（原始记录）");
    expect(reasons[1]!.get("button").attributes("aria-expanded")).toBe("false");
    await reasons[1]!.get("button").trigger("click");
    expect(reasons[1]!.text()).toContain("先核对两地公开资料。");
    await command.get("button").trigger("click");
    expect(command.text()).toContain("命令已结束，无可显示输出。");
    expect(command.text()).toContain("0 毫秒");
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

  it("keeps a failure marker visible and respects final and user-input boundaries", async () => {
    const view=native();view.items[3]!.item.status="failed";view.items[3]!.item.exitCode=1;
    view.items.splice(6,0,record({id:"explicit",type:"agentMessage",phase:"final_answer",text:"明确回答",availability:"available"},6));
    const projected=turn(view);
    expect(observedProgressMessages(projected.items).has(projected.items[5]!.identity)).toBe(false);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:projected,position:1}});
    expect(wrapper.get(".chat-turn-group__item--command").isVisible()).toBe(false);
    const activity=wrapper.findAll(".chat-turn-group__activity").find(node=>node.text().includes("1 项失败"))!;
    expect(activity.isVisible()).toBe(true);
    await activity.get("button").trigger("click");
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
  it("compresses a long mixed tool run without losing failure, empty output or source records", async () => {
    const view = native();
    const work: NativeConversationView['items'] = [];
    for (let i=0;i<6;i++) {
      work.push(record({id:`search-${i}`,type:'webSearch',availability:'available',webSearch:{action:'search',queries:['公开统计'],sources:[{title:'统计资料',url:'https://example.org/statistics'}]}},work.length+1));
      if (i<5) for (let j=0;j<2;j++) work.push(record({id:`command-${i}-${j}`,type:'commandExecution',status:i===0&&j===0?'failed':'completed',exitCode:i===0&&j===0?1:0,commandLabel:'执行命令',cwdLabel:'当前项目',outputText:j===0?'普通验收输出':'',availability:'available'},work.length+1));
      if (i<3) work.push(record({id:`reason-${i}`,type:'reasoning',summary:['公开摘要'],content:[],availability:'available'},work.length+1));
    }
    view.items=[view.items[0]!,...work,record({...view.items[7]!.item},work.length+1)];
    const before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1,timingLabel:'已完成 282s'}});
    expect(wrapper.findAll('.chat-turn-group__activity')).toHaveLength(1);
    const group=wrapper.get('.chat-turn-group__activity');
    expect(group.isVisible()).toBe(true); // Failure remains visible when the Turn is folded.
    expect(group.text()).toContain('搜索网页、运行命令');
    expect(group.text()).toContain('1 项失败');
    expect(wrapper.findAll('.chat-turn-group__item--command')).toHaveLength(10);
    expect(wrapper.findAll('.chat-turn-group__item--command').every(node=>!node.isVisible())).toBe(true);
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('具体情况可展开下方记录查看');
    await group.get('button').trigger('click');
    expect(wrapper.findAll('.chat-turn-group__item--command').every(node=>node.isVisible())).toBe(true);
    expect(wrapper.findAll('.chat-turn-group__item--web_search').every(node=>node.isVisible())).toBe(true);
    const failed=wrapper.findAll('.chat-turn-group__item--command')[0]!;
    expect(failed.text()).toContain('执行失败');
    expect(failed.get('button').attributes('aria-expanded')).toBe('false');
    await failed.get('button').trigger('click');
    expect(failed.text()).toContain('普通验收输出');
    const empty=wrapper.findAll('.chat-turn-group__item--command')[1]!;
    await empty.get('button').trigger('click');
    expect(empty.text()).toContain('命令已结束，没有输出内容');
    const search=wrapper.findAll('.chat-turn-group__item--web_search')[0]!;
    await search.get('button').trigger('click');
    expect(search.text()).toContain('https://example.org/statistics');
    expect(wrapper.findAll('.chat-turn-group__item--reasoning').every(node=>!node.isVisible())).toBe(true);
    await wrapper.get('.chat-turn-group__details-control button').trigger('click');
    expect(wrapper.findAll('.chat-turn-group__item--reasoning').every(node=>node.isVisible())).toBe(true);
    expect(wrapper.findAll('.chat-turn-group__item--reasoning')[1]!.text()).toContain('重复摘要');
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(group.isVisible()).toBe(true);
    expect(group.get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.findAll('.chat-turn-group__item--command').every(node=>!node.isVisible())).toBe(true);
    await group.get('button').trigger('click');
    expect(wrapper.findAll('.chat-turn-group__item--command').every(node=>node.isVisible())).toBe(true);
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("keeps genuine model updates between tool groups and preserves the original order", async () => {
    const view=native();
    const comment=(id:string,text:string,n:number)=>record({id,type:'agentMessage',phase:'commentary',text,availability:'available'},n);
    view.items=[view.items[0]!,comment('before','先核对公开资料。',1),view.items[1]!,view.items[3]!,comment('after','已经找到公开资料，继续检查口径。',4),view.items[6]!,view.items[7]!];
    const before=JSON.stringify(view);
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:turn(view),position:1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    const visible=[...wrapper.get('.chat-turn-group__items').element.children].filter(node=>(node as HTMLElement).style.display!=='none');
    const sequence=visible.filter(node=>node.classList.contains('chat-turn-group__activity')||node.classList.contains('chat-turn-group__item--commentary')||node.classList.contains('chat-turn-group__item--web_search'));
    expect(sequence.map(node=>node.textContent)).toEqual([
      expect.stringContaining('先核对公开资料。'),expect.stringContaining('搜索了网页、运行了命令'),
      expect.stringContaining('已经找到公开资料'),expect.stringContaining('已阅读网页'),
    ]);
    expect(wrapper.findAll('[data-progress-source="model"]')).toHaveLength(2);
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("does not group across pending decisions, unavailable records, final answers or user input", () => {
    const projected=turn();
    const first=projected.items[1]!;
    const last={...first,identity:'last'};
    const barriers=[
      {...projected.items[3]!,approval:{status:'pending'} as NonNullable<typeof first>['approval']},
      {...first,identity:'unavailable',availability:'unavailable' as const},
      {...projected.items[7]!,presentation:'final_answer' as const},
      projected.items[0]!,
    ];
    for(const barrier of barriers) {
      const t={...projected,items:[first,{...first,identity:'first-b'},barrier,last,{...last,identity:'last-b'}]};
      const groups=processActivityGroups(t,new Set(t.items.map(i=>i.identity)),new Set());
      expect(groups.size).toBe(2);
      expect([...groups.values()].map(g=>g.itemIdentities)).toEqual([[first.identity,'first-b'],['last','last-b']]);
    }
  });

  it("retains a chosen disclosure during streaming, stops active claims at termination and resets per turn", async () => {
    const view=native();view.status='inProgress';view.terminalObserved=false;
    view.items=[view.items[0]!,{...view.items[1]!,lastMethod:'item/started'},record({id:'initial-command',type:'commandExecution',status:'completed',availability:'available'},2)];
    const project=()=>selectConversationTimeline(composeConversationView(snapshot,[view]),'session',undefined,{protectApprovalProcessContent:false,liveTurnId:'turn'})!.turns[0]!;
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:project(),position:1}});
    await wrapper.get('.chat-turn-group__activity button').trigger('click');
    view.items[1]!.lastMethod='item/completed';
    view.items.push(record({id:'another',type:'commandExecution',status:'completed',exitCode:0,availability:'available'},2));
    await wrapper.setProps({turn:project()});
    expect(wrapper.findAll('.chat-turn-group__activity')).toHaveLength(1);
    expect(wrapper.get('.chat-turn-group__activity button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-turn-group__activity').text()).toContain('搜索了网页、运行了命令');
    view.status='completed';view.terminalObserved=true;
    await wrapper.setProps({turn:project()});
    expect(wrapper.text()).not.toContain('项进行中');
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    expect(wrapper.get('.chat-turn-group__activity button').attributes('aria-expanded')).toBe('true');
    await wrapper.setProps({turn:{...project(),identity:'other-turn'}});
    expect(wrapper.get('.chat-turn-group__activity button').attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it("keeps failures visible when activity grouping is unavailable", () => {
    const view=native();view.items[3]!.item.status='failed';view.items[3]!.item.exitCode=1;
    const t={...turn(view),source:'native_rebuilt' as const};
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:t,position:1}});
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    expect(wrapper.get('.chat-turn-group__item--command').isVisible()).toBe(true);
    expect(wrapper.get('.chat-turn-group__item--command').text()).toContain('执行失败');
    wrapper.unmount();
  });

  it("does not collapse focused activity controls when the final answer starts", async () => {
    const view=native();view.status='inProgress';view.terminalObserved=false;view.items=[...view.items.slice(0,2), view.items[3]!];
    const project=()=>selectConversationTimeline(composeConversationView(snapshot,[view]),'session',undefined,{protectApprovalProcessContent:false,liveTurnId:'turn'})!.turns[0]!;
    const wrapper=mount(ChatTurnGroup,{attachTo:document.body,props:{turn:project(),position:1}});
    await wrapper.get('.chat-turn-group__activity button').trigger('focusin');
    view.items.push(record({id:'final',type:'agentMessage',phase:'final_answer',text:'回答开始',availability:'available'},4));
    await wrapper.setProps({turn:project()});
    expect(wrapper.get('.chat-turn-group__timing button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.chat-turn-group__activity').isVisible()).toBe(true);
    wrapper.unmount();
  });

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

  it("renders a quiet provider's actual web work as a compact record without creating a model message", async () => {
    const view = native();
    view.items = [view.items[0]!, view.items[1]!, view.items[2]!, view.items[7]!];
    const before = JSON.stringify(view);
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    const description = wrapper.get('.chat-turn-group__item--web_search');
    expect(description.isVisible()).toBe(false);
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(description.isVisible()).toBe(true);
    expect(description.text()).toContain('已搜索网页');
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    expect(wrapper.get('.chat-turn-group__item--web_search').isVisible()).toBe(true);
    expect(wrapper.find('[data-progress-source="model"]').exists()).toBe(false);
    expect(wrapper.findAll('.chat-turn-group__item--assistant_unclassified')).toHaveLength(1);
    expect(wrapper.get('.chat-turn-group__item--assistant_unclassified').text()).toContain('两地各有优势。');
    expect(JSON.stringify(view)).toBe(before);
    wrapper.unmount();
  });

  it("keeps genuine commentary as plain public prose in order", async () => {
    const view = native();
    view.items = [view.items[0]!, record({id:'comment', type:'agentMessage', phase:'commentary', text:'我会先核对两地资料。', availability:'available'}, 1), view.items[1]!, view.items[7]!];
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(view), position: 1}});
    await wrapper.get('.chat-turn-group__timing button').trigger('click');
    expect(wrapper.get('[data-progress-source="model"]').text()).toContain('我会先核对两地资料。');
    expect(wrapper.find('.chat-turn-group__progress-source').exists()).toBe(false);
    expect(wrapper.get('.chat-turn-group__item--commentary .chat-safe-content').text()).toBe('我会先核对两地资料。');
    const children = [...wrapper.get('.chat-turn-group__items').element.children];
    const model = children.findIndex(node => node.classList.contains('chat-turn-group__item--commentary'));
    const system = children.findIndex(node => node.classList.contains('chat-turn-group__activity'));
    const web = children.findIndex(node => node.classList.contains('chat-turn-group__item--web_search'));
    expect(system).toBe(-1); // One web Item uses its own disclosure.
    expect(model).toBeLessThan(web);
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
    expect(message.attributes('data-message-source')).toBe('model');
    expect(message.text()).not.toContain('模型消息');
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
    const descriptions = processActivityGroups(t, keys, processDetailItems(t.items));
    expect(descriptions.size).toBe(2);
    expect([...descriptions.values()][0]!.text).toBe('搜索了网页、运行了命令');
    expect([...descriptions.values()][0]!.itemIdentities).toHaveLength(3);
  });

  it("shows active work only while the native observation is live", async () => {
    const view = native();
    view.status = 'inProgress'; view.terminalObserved = false;
    view.items = [view.items[0]!, {...view.items[1]!, lastMethod:'item/started'}];
    const project = (live: boolean) => selectConversationTimeline(composeConversationView(snapshot,[view]),'session',undefined,
      {protectApprovalProcessContent:false,liveTurnId:live?'turn':null})!.turns[0]!;
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props:{turn:project(true),position:1}});
    expect(wrapper.get('.chat-turn-group__item--web_search').text()).toContain('进行中');
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('已完成网页搜索');
    await wrapper.setProps({turn:project(false)});
    expect(wrapper.find('.chat-turn-group__activity').exists()).toBe(false);
    expect(wrapper.find('.chat-execution-progress').exists()).toBe(false);
    expect(wrapper.text()).toContain('当前进度待确认');
    wrapper.unmount();
  });

  it("does not promote cold history, unknown kinds or pending approval into progress", () => {
    const projected = turn();
    const command = {...projected.items[3]!, approval: {status:'pending'} as NonNullable<typeof projected.items[3]>['approval']};
    const bad = {...projected.items[1]!, availability:'unavailable' as const};
    const base = {...projected,items:[command,bad]};
    const keys = new Set(base.items.map(i=>i.identity));
    expect(processActivityGroups(base,keys,new Set()).size).toBe(0);
    const recovered=processActivityGroups({...projected,source:'native_rebuilt'},new Set(projected.items.map(i=>i.identity)),new Set());
    expect([...recovered.values()].every(group=>group.active===0)).toBe(true);
    expect([...recovered.values()].flatMap(group=>group.itemIdentities)).not.toContain(projected.items[1]!.identity);
    const read = native();read.items[1]!.lastMethod='thread/read';read.items=[read.items[1]!];
    const t = turn(read);
    expect(processActivityGroups(t,new Set(t.items.map(i=>i.identity)),new Set()).size).toBe(0);
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
