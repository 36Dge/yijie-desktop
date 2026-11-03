import { computed, createApp, defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { NConfigProvider, NDialogProvider, darkTheme } from "naive-ui";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { APP_NAVIGATION } from "../../../src/navigation/app-nav";
import { useChatStore } from "../../../src/stores/chat.store";
import { uiZoomCssValue, uiZoomedViewportCss, uiZoomedWindowMinimumCss } from "../../../src/domain/ui-zoom";
import type { NativeConversationView } from "../../../src/api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../../src/domain/conversation-view";
import { selectConversationTimeline } from "../../../src/domain/conversation-timeline";
import YjSidebar from "../../../src/components/yijie/YjSidebar.vue";
import YjIcon from "../../../src/components/yijie/YjIcon.vue";
import ChatTurnGroup from "../../../src/components/chat/ChatTurnGroup.vue";
import ChatComposer from "../../../src/components/chat/ChatComposer.vue";
import ChatAnswerActions from "../../../src/components/chat/ChatAnswerActions.vue";
import ChatDocumentWorkspace from "../../../src/components/chat/ChatDocumentWorkspace.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "./preview.css";

const prose = `### 城市气质

北京是一座在宏大与日常之间不断切换的城市。宽阔的中轴线、庄严的宫殿与纪念性建筑，赋予它开阔、端正的气象；拐进胡同，灰墙、树影和门前闲谈，又让节奏骤然慢下来。这里既有首都的秩序感，也有北方城市直爽、幽默的人情味。古老与新潮并不总是和谐，却在碰撞中形成北京特有的厚重与包容。

### 历史文化

北京的城市记忆层叠而清晰。故宫、天坛、颐和园等遗存，展现礼制、园林与建筑艺术的精妙；长城和运河相关遗迹，则让人看到军事防御与南北交流留下的深远印迹。元大都以来的街巷格局，仍在部分城区留下痕迹。京剧、曲艺、景泰蓝等传统艺术和技艺，与文学、话剧、电影及当代艺术共同生长。

### 日常生活

北京人的一天，常从一碗豆浆、焦圈或煎饼开始，也可以是一杯咖啡配面包。通勤距离较长，地铁与骑行支撑城市运转；天气晴朗时，去公园散步、在景山看日落、沿什刹海边闲逛，都是朴素的放松方式。生活在这里，既要适应大城市的忙碌，也能在街角、馆舍与邻里中，找到属于自己的尺度。`;
const structured = [
  "# 阅读样例",
  "",
  "这是普通布局样例。正文包含**强调文字**、English words 和行内代码 `const city = \"北京\"`。",
  "",
  "## 标题与列表",
  "### 出发前",
  "",
  "请按顺序准备：",
  "",
  "1. 核对开放时间，预留步行与休息时间。",
  "2. 选择路线。",
  "   - 先确认交通安排。",
  "   - 长条目换行后与第一行正文对齐，不与序号或圆点对齐。",
  "",
  "> 引用段落保持同一阅读节奏。",
  ">",
  "> 第二段引用仍使用真实段落分隔。",
  "",
  "## 表格与代码",
  "",
  "| 项目 | 说明 | 备注 |",
  "| --- | --- | --- |",
  "| 公交 | 提前核对路线与站名 | 普通说明 |",
  "| 步行 | 给城市街巷留出足够时间 | 小屏表格可独立横向滚动 |",
  "",
  "```ts",
  "const city = \"北京\";",
  "const plan = [\"历史文化\", \"日常生活\"];",
  "```"
].join("\n");

const router = createRouter({ history:createMemoryHistory(), routes:[
  {path:'/',redirect:'/chat/preview'},
  ...APP_NAVIGATION.filter(entry=>entry.kind==='item').map(entry=>({path:entry.to,component:{render:()=>null}})),
  {path:'/chat/:id',component:{render:()=>null}},
] });

createApp(defineComponent({setup() {
  const dark=ref(false), collapsed=ref(false), zoom=ref(100), scene=ref('prose');
  const draft=ref('保留在当前对话中的普通草稿'), expanded=ref(false);
  const workspace=ref<InstanceType<typeof ChatDocumentWorkspace>>();
  const streaming=ref(false), streamed=ref(''), run=ref(0);
  const chatStore = useChatStore();
  chatStore.phase = "ready";
  // UI-only menu fixture. This preview never binds a Native chat context.
  chatStore.context = { contextId: "019c1a00-0000-7000-8000-000000000010", expiresAtEpochSeconds: 2_000_000_000,
    allowedActions: ["read_sessions", "rename_session", "pin_session", "delete_session"] };
  chatStore.sessions = [
    { sessionId: "preview", title: "北京介绍 · 城市气质与日常生活", latestTurnStatus: "completed", pinnedAt: null },
    { sessionId: "completed-pinned", title: "一条较长的已完成任务标题，用来检查省略、青柠圆点与置顶标记", latestTurnStatus: "completed", pinnedAt: 1 },
    { sessionId: "running", title: "路线整理 · 正在输出", latestTurnStatus: "streaming", pinnedAt: null },
    { sessionId: "interrupted", title: "另一条未完成的任务", latestTurnStatus: "interrupted", pinnedAt: null },
  ].map((session, index) => ({ ...session, projectId: null, titleSource: "user", lastActivityAt: 4 - index, projectAvailable: true }));
  watch(streaming, value => {
    chatStore.sessions = chatStore.sessions.map(session => session.sessionId === "preview"
      ? { ...session, latestTurnStatus: value ? "streaming" : "completed" }
      : session);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let fileNumber=0;
  const body=computed(()=>scene.value==='prose'?prose:structured);
  watch(zoom,value=>{
    const viewport=uiZoomedViewportCss(value),minimum=uiZoomedWindowMinimumCss(value);
    const html=document.documentElement;
    html.style.zoom=uiZoomCssValue(value); html.style.setProperty('--yj-ui-scale',uiZoomCssValue(value));
    html.style.setProperty('--yj-ui-viewport-width',viewport.width);html.style.setProperty('--yj-ui-viewport-height',viewport.height);
    html.style.setProperty('--yj-layout-window-min-width',minimum.width);html.style.setProperty('--yj-layout-window-min-height',minimum.height);
    html.dataset.uiZoomPercent=String(value);
  },{immediate:true});
  const theme=computed(()=>{void dark.value;return createNaiveThemeOverrides(name=>getComputedStyle(document.documentElement).getPropertyValue(name));});
  function play() {
    clearInterval(timer);run.value++;streamed.value='';streaming.value=true;
    timer=setInterval(()=>{streamed.value=body.value.slice(0,streamed.value.length+20);if(streamed.value.length===body.value.length){clearInterval(timer);streaming.value=false;}},100);
  }
  onBeforeUnmount(()=>clearInterval(timer));
  const turn=computed(()=>{
    const native: NativeConversationView={sessionId:'preview',turnId:'turn',runtimeThreadId:'preview',runtimeTurnId:'turn',source:'native_observed',revision:String(streamed.value.length),availability:'available',status:streaming.value?'inProgress':'completed',statusSource:'runtime_notification',terminalObserved:!streaming.value,items:[{ordinal:0,lastMethod:streaming.value?'item/started':'item/completed',item:{id:'answer',type:'agentMessage',phase:'final_answer',availability:'available',text:streaming.value?streamed.value:body.value}}]};
    return selectConversationTimeline(composeConversationView({threads:[{threadId:'preview',status:'active'}],turns:[],items:[]},[native]),'preview',undefined,{liveTurnId:'turn',protectApprovalProcessContent:false})!.turns[0]!;
  });
  function addFile() {
    fileNumber++;
    workspace.value?.openFile({source:{kind:'artifact',sessionId:'preview',turnId:'turn',artifactId:String(fileNumber)},name:`布局示例-${fileNumber}-较长的文件名称用于验证标签滚动与省略.md`,mediaType:'text/markdown',status:'ready',expiresAt:null});
  }
  return()=>h(NConfigProvider,{theme:dark.value?darkTheme:null,themeOverrides:theme.value},()=>h(NDialogProvider,null,()=>h('div',{class:'audit-shell'},[
    h('nav',{class:'audit-controls','aria-label':'布局验收控件'},[
      h('span','普通布局样例'),
      h('button',{onClick:()=>{collapsed.value=!collapsed.value;}},collapsed.value?'展开左栏':'收起左栏'),
      h('button',{onClick:()=>{dark.value=!dark.value;document.documentElement.dataset.theme=dark.value?'dark':'light';}},'切换亮暗'),
      h('select',{'aria-label':'界面缩放',value:zoom.value,onChange:(event:Event)=>{zoom.value=Number((event.target as HTMLSelectElement).value);}},[80,100,120,140,160,180,200].map(value=>h('option',{value},`${value}%`))),
      h('select',{'aria-label':'文本场景',value:scene.value,onChange:(event:Event)=>{scene.value=(event.target as HTMLSelectElement).value;}},[h('option',{value:'prose'},'北京介绍'),h('option',{value:'structured'},'列表表格代码')]),
      h('button',{onClick:play},'流式样例'),h('button',{onClick:addFile},'长文件标签'),
    ]),
    h('div',{class:'audit-body'},[
      h(YjSidebar,{entries:APP_NAVIGATION,collapsed:collapsed.value,currentPath:'/chat/preview',showChatTree:true}),
      h('main',{class:'audit-main'},[
        h(ChatDocumentWorkspace,{ref:workspace,contextId:null,scopeKey:'layout-sample',enabled:true,onExpanded:(value:boolean)=>{expanded.value=value;}},()=>h('section',{class:'chat-workspace'},[
          h('header',{class:'chat-workspace__header'},[h('strong','北京介绍 · 阅读与分栏'),h('button',{class:'yj-control yj-control--icon','aria-label':expanded.value?'收起右侧文件预览':'展开右侧文件预览',onClick:()=>workspace.value?.toggle()},[h(YjIcon,{name:'previewSidebar',size:'sm',tone:'muted',strokeWidth:1.5})])]),
          h('div',{class:'chat-workspace__conversation'},[h('div',{class:'chat-workspace__column'},[
            h(ChatTurnGroup,{key:`${scene.value}:${run.value}`,turn:turn.value,position:1,timingLabel:streaming.value?'正在输出':'已完成 31s'},{'item-actions':()=>h(ChatAnswerActions,{identity:'layout-answer',text:body.value,adapter:{writeText:async()=>{}},modelProfileId:'kimi-k3-1-pro-max-v1',completedAt:1804111200})}),
          ])]),
          h('footer',{class:'chat-workspace__composer'},[h(ChatComposer,{modelValue:draft.value,'onUpdate:modelValue':(value:string)=>{draft.value=value;},mode:'reply',projects:[],selectedProjectId:null,readiness:{title:'普通组件预览',detail:'不发送任务、不连接 Native 文件内容',actionLabel:null,tone:'success'},canSend:true,canAttach:false,submissionState:'idle',streaming:false,recoveryAvailable:false},{'model-control':()=>h('span',{class:'audit-model'},[h(YjIcon,{name:'modelKimi',size:'sm'}),'Kimi K3.1 Pro'])})]),
        ])),
      ]),
    ]),
  ])));
}})).use(createPinia()).use(router).mount('#app');
