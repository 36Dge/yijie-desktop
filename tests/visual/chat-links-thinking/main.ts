import { computed, createApp, defineComponent, h, provide, ref } from "vue";
import { NConfigProvider, darkTheme } from "naive-ui";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { composeConversationView } from "../../../src/domain/conversation-view";
import { selectConversationTimeline } from "../../../src/domain/conversation-timeline";
import type { NativeConversationView } from "../../../src/api/generated/native-conversation-private.gen";
import { webSourceActionsKey } from "../../../src/composables/useWebSources";
import ChatTurnGroup from "../../../src/components/chat/ChatTurnGroup.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../chat-preloading/preview.css";

// Ordinary local examples. Native opening is verified separately in the real
// client; this page records clicks without sending requests or saving history.
const answer = "全程建议预留 **1—1.5小时**，具体取决于候车和步行情况。[路线来源：城市交通说明](https://example.org/route?from=station&to=park#guide)\n\n## 建议这样安排\n\n- **出发前准备**：留意现场指引。[相关说明](https://www.iana.org/help/example-domains)\n- **慢慢走**：留出休息时间。\n\n> [参考资料](https://example.org/reference)\n\n| 地点 | 资料 |\n| --- | --- |\n| 示例公园 | [地点介绍](https://example.org/Guide_(city)) |";
createApp(defineComponent({setup() {
  const phase = ref<"thinking" | "answer" | "completed" | "tool">("completed");
  const dark = ref(false); const opened = ref("");
  provide(webSourceActionsKey, {icon: async () => null, open: async () => {}, openMessageLink: async target => {opened.value = target.url;}});
  const turn = computed(() => {
    const items: NativeConversationView["items"][number][] = [
      {ordinal: 0, lastMethod: "item/completed", item: {id:"user",type:"userMessage",text:"介绍一条城市步行路线，并附上参考链接。",availability:"available"}},
      {ordinal: 1, lastMethod: phase.value === "completed" ? "item/completed" : "item/started", item: {id:"thinking",type:"reasoning",summary:["正在整理介绍与参考资料。"],availability:"available"}},
    ];
    if (phase.value === "tool") items.push({ordinal:2,lastMethod:"item/started",item:{id:"search",type:"webSearch",availability:"available",webSearch:{action:"search",queries:["城市步行路线"]}}});
    else if (phase.value !== "thinking") items.push({ordinal:2,lastMethod:phase.value === "completed" ? "item/completed" : "item/started",item:{id:"answer",type:"agentMessage",phase:"final_answer",text:answer,availability:"available"}});
    const view: NativeConversationView = {sessionId:"preview",turnId:"turn",runtimeThreadId:"preview",runtimeTurnId:"turn",source:"native_observed",revision:phase.value,status:phase.value === "completed" ? "completed" : "inProgress",statusSource:"runtime_notification",terminalObserved:phase.value === "completed",availability:"available",items};
    return selectConversationTimeline(composeConversationView({threads:[{threadId:"preview",status:"active"}],turns:[],items:[]},[view]),"preview",undefined,{liveTurnId:"turn",protectApprovalProcessContent:false})!.turns[0]!;
  });
  function theme() { dark.value = !dark.value; document.documentElement.dataset.theme = dark.value ? "dark" : "light"; }
  const overrides = computed(() => { void dark.value; return createNaiveThemeOverrides(name => getComputedStyle(document.documentElement).getPropertyValue(name)); });
  return () => h(NConfigProvider, {theme:dark.value ? darkTheme : null, themeOverrides:overrides.value}, () => h("main", [
    h("h1", "文本超链与深度思考"),
    h("nav", {class:"preview-controls"}, [
      ...([['thinking','实时深度思考'],['answer','回答开始'],['completed','完整回答'],['tool','工具活动']] as const).map(([value,label]) => h("button",{onClick:()=>{phase.value=value;}},label)),
      h("button",{onClick:theme},"切换亮暗色"),
    ]),
    h("section",{class:"preview-window",style:{width:"min(1180px, 100%)",height:"760px"}},[
      h("header",{class:"preview-title"},"普通本地样例 · 生产组件与原生进度投影"),
      h("div",{class:"preview-conversation"},[h(ChatTurnGroup,{turn:turn.value,position:1,timingLabel:phase.value === "completed" ? "已完成 8s" : "已处理 8s"})]),
      h("div",{class:"preview-composer"},"输入区域"),
    ]),
    h("p",{"aria-label":"打开记录"},opened.value ? `已请求打开：${opened.value}` : "尚未点击链接"),
  ]));
}})).mount("#app");
