import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { NativeConversationView } from "../../../src/api/generated/native-conversation-private.gen";
import { createConversationComposer, type ConversationSnapshot } from "../../../src/domain/conversation-view";
import { createConversationTimelineSelector } from "../../../src/domain/conversation-timeline";
import { createChatMarkdownParser } from "../../../src/domain/chat-markdown";
import { chatRenderMeasurements, measureChatRender, setChatRenderMeasurementEnabled } from "../../../src/domain/chat-render-performance";
import { useChatScroll } from "../../../src/composables/useChatScroll";
import ChatTimeline from "../../../src/components/chat/ChatTimeline.vue";
import ChatScrollToBottomButton from "../../../src/components/chat/ChatScrollToBottomButton.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../chat-preloading/preview.css";

// Ordinary local demonstration data. No native bridge, model requests or saved tasks.
const answer = "**灵隐寺位于杭州西湖以西，是了解杭州佛教文化的重要地点。** 👨‍👩‍👧‍👦\n\n寺院与周围山林相连，参观时可以把建筑、石刻与自然景观结合起来。这里用普通演示文字检查连续显示、段落稳定与自动滚动。\n\n## 可以这样安排参观\n\n- **寺院建筑**：按中轴线了解主要殿堂。\n  - 留意屋檐、匾额和院落布局。\n  - 预留步行与休息时间。\n- **石刻艺术**：观察不同年代造像的形态。\n- **山林环境**：沿步道慢行，注意现场指引。\n\n> 以下为界面演示，不包含实时开放或门票信息。\n\n| 观察方向 | 关注内容 |\n| --- | --- |\n| 建筑 | 殿堂与院落 |\n| 艺术 | 石刻与造像 |\n\n```txt\n入口 → 殿堂 → 步道 → 出口\n```\n\n**演示结束，全部文字已到达。**";
const expected = createChatMarkdownParser()([{identity: "body", blockIndex: 0, type: "text", text: answer}], "rich", false).text.replace(/\s/g, "");
createApp(defineComponent({setup() {
  const stream = ref(""); const live = ref(false); const run = ref(0); const dark = ref(false); const long = ref(false);
  const scroller = ref<HTMLElement | null>(null); const { update, showBottomButton, scrollToBottom } = useChatScroll(scroller);
  const stats = ref(""); let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | null = null; let lastPaint = 0; let lastLength = 0; let visibleSteps = 0; let maxStep = 0; let maxFrame = 0; let completedAt = 0; let drain = 0;
  const snapshot: ConversationSnapshot = { threads: [{threadId: "preview", status: "active"}], turns: [], items: [] };
  const history: NativeConversationView[] = Array.from({length: 30}, (_, index) => ({sessionId: "preview", turnId: `old-${index}`, runtimeThreadId: "preview", runtimeTurnId: `old-${index}`, ordinal: index, source: "native_observed", revision: "1", availability: "available", status: "completed", statusSource: "runtime_notification", terminalObserved: true,
    items: [{ordinal: 0, lastMethod: "item/completed", item: {id: `old-answer-${index}`, type: "agentMessage", text: `第 ${index + 1} 轮已完成的内容。\n\n` + answer, availability: "available", phase: "final_answer"}}]}));
  const compose = createConversationComposer(); const select = createConversationTimelineSelector();
  const native = computed<NativeConversationView>(() => ({sessionId: "preview", turnId: "live", runtimeThreadId: "preview", runtimeTurnId: "live", ordinal: 31, source: "native_observed", revision: String(stream.value.length), availability: "available", status: live.value ? "inProgress" : "completed", statusSource: "runtime_notification", terminalObserved: !live.value,
    items: [
      {ordinal: 0, lastMethod: "item/completed", item: {id: "user", type: "userMessage", text: "全面介绍一下灵隐寺", availability: "available"}},
      {ordinal: 1, lastMethod: live.value ? "item/started" : "item/completed", item: {id: "thinking", type: "reasoning", summary: [stream.value], availability: "available"}},
      {ordinal: 2, lastMethod: live.value ? "item/started" : "item/completed", item: {id: "answer", type: "agentMessage", phase: "final_answer", text: stream.value, availability: "available"}},
    ]}));
  const timeline = computed(() => {
    const view = measureChatRender("conversation", () => compose(snapshot, [...(long.value ? history : []), native.value]));
    return measureChatRender("timeline", () => select(view, "preview", undefined, {liveTurnId: live.value ? "live" : null}))!;
  });
  watch(timeline, () => void nextTick(update));
  function sample() {
    const now = performance.now();
    const text = [...(scroller.value?.querySelectorAll('[data-turn-id="live"] [aria-label="模型回答"] .chat-stream-text') ?? [])].map(node => node.textContent).join("").replace(/\s/g, "");
    if (live.value || text !== expected) {
      if (text.length > lastLength) { visibleSteps++; maxStep = Math.max(maxStep, text.length - lastLength); lastLength = text.length; }
    }
    if (lastPaint && live.value) maxFrame = Math.max(maxFrame, now - lastPaint);
    if (completedAt && text === expected && !drain) drain = now - completedAt;
    lastPaint = now;
    stats.value = JSON.stringify({received: stream.value.length, visible: text.length, visibleSteps, maxStep, maxFrameMs: Math.round(maxFrame), terminalCatchupMs: Math.round(drain), exactRenderedText: text === expected, metrics: chatRenderMeasurements()}, null, 2);
    frame = requestAnimationFrame(sample);
  }
  function play(chunk: number, gap: number, paused = false) {
    clearTimeout(timer); stream.value = ""; live.value = true; run.value++;
    visibleSteps = 0; maxStep = 0; maxFrame = 0; lastLength = 0; completedAt = 0; drain = 0; lastPaint = 0;
    setChatRenderMeasurementEnabled(true);
    let index = 0;
    const graphemes = [...new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(answer)].map(part => part.segment);
    function tick() {
      index += chunk; stream.value = graphemes.slice(0, index).join("");
      if (index >= graphemes.length) { live.value = false; completedAt = performance.now(); return; }
      timer = setTimeout(tick, paused && index > 120 && index < 120 + chunk ? 1200 : gap);
    }
    timer = setTimeout(tick, 100);
    void nextTick(() => scrollToBottom());
  }
  frame = requestAnimationFrame(sample);
  onBeforeUnmount(() => { clearTimeout(timer); if (frame !== null) cancelAnimationFrame(frame); });
  return () => h("main", [h("h1", "易界连续流式渲染验收"), h("nav", {class: "preview-controls"}, [
    h("button", {onClick: () => play(5, 50)}, "小块流式"), h("button", {onClick: () => play(80, 300)}, "大块突发"),
    h("button", {onClick: () => play(20, 50, true)}, "中途停顿"), h("button", {onClick: () => {long.value = !long.value;}}, long.value ? "清除历史演示" : "加载 30 轮历史"),
    h("button", {onClick: () => {clearTimeout(timer); live.value = false; stream.value = answer; completedAt = performance.now();}}, "完整历史"),
    h("button", {onClick: () => {clearTimeout(timer); live.value = false;}}, "停止"),
    h("button", {onClick: () => {dark.value = !dark.value; document.documentElement.dataset.theme = dark.value ? "dark" : "light";}}, "切换亮暗色"),
  ]), h("section", {class: "preview-window", style: {width: "min(1180px, 100%)", height: "760px"}}, [
    h("header", {class: "preview-title"}, "普通本地演示 · 与生产共用投影、组件、滚动和渐显"),
    h("div", {class: "preview-conversation-frame"}, [h("div", {ref: scroller, class: "preview-conversation", tabindex: 0, onScroll: update}, [h(ChatTimeline, {key: run.value, timeline: timeline.value, turnTimingLabels: {live: live.value ? "已处理 8s" : "已完成 8s"}})]), showBottomButton.value ? h(ChatScrollToBottomButton, {class: "preview-bottom-button", onClick: () => scrollToBottom(true)}) : null]),
    h("div", {class: "preview-composer"}, "输入区域（演示）"),
  ]), h("pre", {"aria-label": "性能采样", style: {whiteSpace: "pre-wrap", fontSize: "var(--yj-font-size-caption)"}}, stats.value)]);
}})).mount("#app");
