import { computed, createApp, defineComponent, h, provide, ref } from "vue";
import { NConfigProvider, darkTheme } from "naive-ui";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import { historyPageToConversationSnapshot } from "../../../src/api/chat-conversation-adapter";
import { composeConversationView } from "../../../src/domain/conversation-view";
import { selectConversationTimeline } from "../../../src/domain/conversation-timeline";
import { turnTimingLabel } from "../../../src/domain/chat-turn-timing";
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
  const params = new URLSearchParams(location.search);
  const previewSkill = params.has("user-skill");
  const previewUserLink = previewSkill || params.has("user-links");
  const listing = { id: "listing-skill", version: "1.0.0", runtimeName: "listing-analysis", category: "content-marketing" as const, displayName: "Amazon-listing-analysis" };
  const question = previewUserLink
    ? "https://www.example.org/catalog/mini-camera/dp/B01234/?_encoding=UTF8&product=pan-tilt-camera&campaign=seasonal-offers&ref_=store_home_recommendations&color=white&th=1#details 给出这个商品的优化建议。"
    : "介绍一条城市步行路线，并附上参考链接。";
  const original = historyPageToConversationSnapshot("preview", {turns: [{turnId:"turn",status:"completed",terminalAt:2,reasoning:[],reasoningStatus:"unavailable",reasoningReasonCode:null,
    messages:[{messageId:"saved",role:"user",content:question,status:"committed",ordinal:0,createdAt:1,
      ...(previewSkill && { contentBlocks: [{ type: "text", text: question, skills: [{ id: listing.id, version: listing.version }] }] })}]}],nextCursor:null});
  const phase = ref<"thinking" | "answer" | "completed" | "tool">(previewUserLink ? "thinking" : "completed");
  const dark = ref(false); const opened = ref("");
  provide(webSourceActionsKey, {icon: async () => null, open: async () => {}, openMessageLink: async target => {opened.value = target.url;}, openUserMessageLink: async target => {opened.value = target.url;}});
  const turn = computed(() => {
    const items: NativeConversationView["items"][number][] = [
      {ordinal: 0, lastMethod: "item/completed", item: {id:"user",type:"userMessage",text:question,availability:"available"}},
      {ordinal: 1, lastMethod: phase.value === "completed" ? "item/completed" : "item/started", item: {id:"thinking",type:"reasoning",summary:["正在整理介绍与参考资料。"],availability:"available"}},
    ];
    if (phase.value === "tool") items.push({ordinal:2,lastMethod:"item/started",item:{id:"search",type:"webSearch",availability:"available",webSearch:{action:"search",queries:["城市步行路线"]}}});
    else if (phase.value !== "thinking") items.push({ordinal:2,lastMethod:phase.value === "completed" ? "item/completed" : "item/started",item:{id:"answer",type:"agentMessage",phase:"final_answer",text:answer,availability:"available"}});
    const view: NativeConversationView = {sessionId:"preview",turnId:"turn",runtimeThreadId:"preview",runtimeTurnId:"turn",source:"native_observed",revision:phase.value,status:phase.value === "completed" ? "completed" : "inProgress",statusSource:"runtime_notification",terminalObserved:phase.value === "completed",availability:"available",items};
    return selectConversationTimeline(composeConversationView(original,[view]),"preview",undefined,{liveTurnId:"turn",protectApprovalProcessContent:false})!.turns[0]!;
  });
  const timing = computed(() => {
    const completed = phase.value === "completed";
    return turnTimingLabel({
      schema_version: 1, agent_session_id: "preview", thread_id: "preview", turn_id: "turn", source: "runtime_read",
      started_at: { state: "known", value: 100 },
      completed_at: completed ? { state: "known", value: 490 } : { state: "unknown" },
      duration_ms: completed ? { state: "known", value: 390_000 } : { state: "unknown" },
    }, !completed, 490_000, turn.value.domainStatus);
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
      h("div",{class:"preview-conversation"},[h(ChatTurnGroup,{turn:turn.value,position:1,timingLabel:timing.value,skillCatalog:previewSkill?[listing]:[]})]),
      h("div",{class:"preview-composer"},"输入区域"),
    ]),
    h("p",{"aria-label":"打开记录"},opened.value ? `已请求打开：${opened.value}` : "尚未点击链接"),
  ]));
}})).mount("#app");
