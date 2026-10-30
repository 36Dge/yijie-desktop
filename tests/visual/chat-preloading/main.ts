import { computed, createApp, defineComponent, h, onBeforeUnmount, ref } from "vue";
import type { NativeConversationView } from "../../../src/api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../../src/domain/conversation-view";
import { selectConversationTimeline } from "../../../src/domain/conversation-timeline";
import { turnTimingLabel } from "../../../src/domain/chat-turn-timing";
import ChatTurnGroup from "../../../src/components/chat/ChatTurnGroup.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "./preview.css";

// Normal synthetic content; uses the production projection, timing formatter and
// components without native IPC, model calls, saved sessions or app activation.
createApp(defineComponent({ setup() {
  const phase = ref<"waiting" | "reasoning" | "answer" | "completed">("waiting");
  const seconds = ref(0);
  const dark = ref(false);
  const playing = ref(false);
  const run = ref(0);
  const width = ref(window.innerWidth);
  function resize() { width.value = window.innerWidth; }
  window.addEventListener("resize", resize);
  const scale = computed(() => Math.min(1, (width.value - 32) / 1180));
  const interval = setInterval(() => {
    if (!playing.value) return;
    seconds.value++;
    if (seconds.value >= 9) { phase.value = "completed"; playing.value = false; }
    else if (seconds.value >= 6) phase.value = "answer";
    else if (seconds.value >= 3) phase.value = "reasoning";
  }, 1000);
  onBeforeUnmount(() => { clearInterval(interval); window.removeEventListener("resize", resize); });
  function setPhase(next: typeof phase.value, elapsed: number) {
    if (next === "waiting") run.value++;
    playing.value = false; phase.value = next; seconds.value = elapsed;
  }
  const turn = computed(() => {
    const done = phase.value === "completed";
    const items: NativeConversationView["items"][number][] = [
      { ordinal: 0, lastMethod: "item/completed", item: {
        id: "user", type: "userMessage", text: "新丰小吃推荐去哪家分店？有哪些必点的小吃？", availability: "available",
      } },
      { ordinal: 1, lastMethod: phase.value === "waiting" || phase.value === "reasoning" ? "item/started" : "item/completed", item: {
        id: "reasoning", type: "reasoning", content: [], summary: phase.value === "waiting" ? [] : ["先核对门店位置和招牌小吃。"], availability: "available",
      } },
    ];
    if (phase.value === "answer" || done) items.push({ ordinal: 2, lastMethod: done ? "item/completed" : "item/started", item: {
      id: "answer", type: "agentMessage", phase: "final_answer", availability: "available",
      text: "**第一次去，可以考虑庆春路分店。**\n\n虾肉小笼、牛肉粉丝汤和虾肉馄饨是经典搭配。一个人可以先点一笼小笼和一碗汤。",
    } });
    const native: NativeConversationView = { sessionId: "preview", turnId: "turn", runtimeThreadId: "preview", runtimeTurnId: "turn",
      source: "native_observed", revision: String(seconds.value), availability: "available", status: done ? "completed" : "inProgress",
      statusSource: "runtime_notification", terminalObserved: done, items };
    return selectConversationTimeline(composeConversationView({threads: [{threadId: "preview", status: "active"}], turns: [], items: []}, [native]),
      "preview", undefined, {liveTurnId: "turn", protectApprovalProcessContent: false})!.turns[0]!;
  });
  const timing = computed(() => turnTimingLabel({ schema_version: 1, agent_session_id: "preview", thread_id: "preview", turn_id: "turn", source: "runtime_read",
    started_at: { state: "known", value: 100 }, completed_at: phase.value === "completed" ? {state: "known", value: 109} : {state: "unknown"},
    duration_ms: phase.value === "completed" ? {state: "known", value: 9123} : {state: "unknown"},
  }, phase.value !== "completed", (100 + seconds.value) * 1000, turn.value.domainStatus));
  return () => h("main", [
    h("h1", "易界对话预加载验收"),
    h("p", "使用真实前端组件与普通演示数据；内容区域为 1180 × 760。"),
    h("nav", {class: "preview-controls", "aria-label": "验收场景"}, [
      h("button", {onClick: () => {setPhase("waiting", 0); playing.value = true;}}, "播放完整流程"),
      h("button", {onClick: () => setPhase("waiting", 0)}, "仅看扫光"),
      h("button", {onClick: () => setPhase("reasoning", 3)}, "首段思考"),
      h("button", {onClick: () => setPhase("answer", 6)}, "回答输出"),
      h("button", {onClick: () => setPhase("completed", 9)}, "输出完成"),
      h("button", {onClick: () => {dark.value = !dark.value; document.documentElement.dataset.theme = dark.value ? "dark" : "light";}}, dark.value ? "切换亮色" : "切换暗色"),
    ]),
    h("div", {class: "preview-fit", style: {width: `${1180 * scale.value}px`, height: `${760 * scale.value}px`}}, [
      h("section", {class: "preview-window", "aria-label": "1180 × 760 对话窗口", style: {transform: `scale(${scale.value})`}}, [
        h("header", {class: "preview-title"}, "杭州美食推荐"),
        h("div", {class: "preview-conversation"}, [h(ChatTurnGroup, {key: run.value, turn: turn.value, position: 1, timingLabel: timing.value})]),
        h("div", {class: "preview-composer"}, "继续输入任务需求…"),
      ]),
    ]),
  ]);
} })).mount("#app");
