<script setup lang="ts">
import "./chat-execution-details.css";
import { computed } from "vue";
import { activityItemTitle } from "../../domain/conversation-activity-summary";
import { formatToolDuration } from "../../domain/chat-ui";
import { completedMcpOutcome } from "../../domain/native-mcp-display";
import { readSorftimeCategoryResult } from "../../domain/sorftime-category-result";
import { readDeepSearchPreview, readWebRetrievalResult } from "../../domain/web-retrieval-display";
import { useWebSources } from "../../composables/useWebSources";
import ChatToolCallStatus from "./ChatToolCallStatus.vue";
import SorftimeCategoryResult from "./SorftimeCategoryResult.vue";
import WebRetrievalResult from "./WebRetrievalResult.vue";
import type { ConversationNativeToolExecution } from "../../domain/conversation-view";
import { activityItemIcon, activityNativeItem, activityToolSourceLabel, deepSearchEvidence, deepSearchReceipt } from "../../domain/conversation-activity-entry";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatTimelineItemShell, { type ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";

const props = defineProps<{ item: ConversationTimelineItemViewModel; execution: ConversationNativeToolExecution; processPresentation?: boolean; searchCalls?: readonly ConversationTimelineItemViewModel[]; imageViewNumber?: number; repeatCallTimeMs?: number }>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const evidence = computed(() => deepSearchEvidence(props.item, props.searchCalls));
const { open, openError } = useWebSources(() => evidence.value);
const native = computed(() => activityNativeItem(evidence.value) ?? props.execution.native.item);
const executionStatus = computed(() => evidence.value.execution?.status ?? props.execution.status);
const fileChange = computed(() => native.value.type === "fileChange");
const imageView = computed(() => native.value.type === "imageView");
const mcpCall = computed(() => native.value.type === "mcpToolCall");
const mcp = computed(() => native.value.mcp);
const builtinWeb = computed(() => mcp.value?.server === "yijie_web" && ["kimi_web_search", "kimi_web_search_pro", "kimi_web_fetch"].includes(mcp.value.tool ?? ""));
const deepSearch = computed(() => builtinWeb.value && mcp.value?.tool === "kimi_web_search_pro");
const webFetch = computed(() => builtinWeb.value && mcp.value?.tool === "kimi_web_fetch");
const fetchDetails = computed(() => {
  const receipt = mcp.value;
  if (!webFetch.value || receipt?.resultKind !== "text" || receipt.texts.length !== 1 || receipt.texts[0]?.index !== 0) return;
  const text = receipt.texts[0].text.trim();
  if (!text) return;
  // Earlier readers also accepted a canonical tool result inside a text block.
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("Wall time:")) {
    const saved = readWebRetrievalResult("kimi_web_fetch", text);
    if (saved && "error" in saved) return {description: saved.error.message};
    if (saved && "markdown" in saved && executionStatus.value === "completed") return {
      title: saved.title, description: saved.truncated ? "已读取部分正文，网页内容较长。" : "已读取网页正文。",
    };
    return;
  }
  return {description: text, title: executionStatus.value === "completed" ? native.value.resultSummary : undefined};
});
const fetchDescription = computed(() => {
  if (fetchDetails.value) return fetchDetails.value.description;
  if (evidence.value.busy) return "正在读取网页内容…";
  if (evidence.value.activityLabel) return evidence.value.activityLabel;
  switch (executionStatus.value) {
    case "completed": return "读取已完成。这条记录没有保存页面详情。";
    case "failed": return "网页读取失败。这条记录没有保存具体原因。";
    case "declined": return "本次读取未获批准。";
    default: return "尚未确认这次读取的结果。";
  }
});
const query = computed(() => deepSearch.value && !mcp.value?.diagnostics.some(code => code === "arguments_unavailable")
  ? native.value.argumentsSummary?.trim() : undefined);
const searchResult = computed(() => {
  const receipt = mcp.value;
  if (!deepSearch.value || receipt?.resultKind !== "text" || receipt.texts.length !== 1 || receipt.texts[0]?.index !== 0) return null;
  return readDeepSearchPreview(receipt.texts[0].text);
});
const title = computed(() => activityItemTitle(evidence.value));
const elapsed = computed(() => native.value.durationMs == null ? null : formatToolDuration(native.value.durationMs));
const sourceAndDuration = computed(() => {
  const source = webFetch.value ? undefined : activityToolSourceLabel(evidence.value);
  const duration = elapsed.value && `${deepSearch.value ? "耗时" : "用时"} ${elapsed.value}`;
  return [source, duration].filter(Boolean).join(" · ");
});
const status = computed(() => {
  if (imageView.value) {
    switch (props.execution.status) {
      case "completed": return "已读取图片";
      case "failed": return "图片读取失败";
      case "declined": return "未获准读取图片";
      case "in_progress": return props.item.busy ? "正在读取图片" : "图片读取结果待确认";
      default: return "图片读取结果待确认";
    }
  }
  if (native.value.type === "subAgentActivity") return props.item.busy ? "处理中" : "已记录";
  switch (executionStatus.value) {
    case "completed": return "已完成";
    case "failed": return webFetch.value ? "读取失败" : "调用失败";
    case "declined": return "已拒绝";
    case "in_progress": return evidence.value.busy ? "执行中" : "最后观察：执行中";
    default: return "状态信息不完整";
  }
});
const fact = computed(() => deepSearchReceipt(evidence.value));
const reuses = computed(() => (props.searchCalls ?? [props.item]).filter(item => deepSearchReceipt(item)?.relation === "reused").length);
const joins = computed(() => (props.searchCalls ?? [props.item]).filter(item => deepSearchReceipt(item)?.relation === "joined").length);
function callLabel(item: ConversationTimelineItemViewModel) {
  const r = deepSearchReceipt(item);
  if (r?.dispatch === "not_dispatched") return "未派发";
  if (r?.relation === "joined") return "并发合并";
  if (r?.relation === "reused") return "复用原结果";
  return r?.dispatch === "responded" ? "已收到服务响应" : "派发状态待确认";
}
const summaryStatus = computed(() => {
  if (!deepSearch.value) return status.value;
  if (fact.value?.dispatch === "not_dispatched") return fact.value.error_code === "busy" ? "未派发 · 繁忙" : "未派发";
  if (fact.value?.availability === "unavailable") {
    return fact.value.dispatch === "responded" ? "原搜索已执行，结果详情不可用" : "结果详情不可用";
  }
  if (fact.value?.outcome === "failed") return "搜索失败";
  if (fact.value?.outcome === "unknown") return "结果待确认";
  if (fact.value?.outcome === "empty") return "0 条结果";
  const result = searchResult.value;
  if (executionStatus.value === "completed" && result && "results" in result && (result.results.length || !result.truncated)) {
    return fact.value?.outcome === "partial"
      ? `${result.results.length} 条结果 · 部分资料`
      : `${result.results.length} 条结果`;
  }
  return status.value;
});
const headerStatus = computed(() => [summaryStatus.value, reuses.value ? `已复用 ${reuses.value} 次` : "", joins.value ? `并发合并 ${joins.value} 次` : ""].filter(Boolean).join(" · "));
const basicSearchResults = computed(() => {
  const receipt = mcp.value;
  if (receipt?.server !== "yijie_web" || receipt.tool !== "kimi_web_search" || receipt.resultKind !== "text" ||
      props.execution.status !== "completed" || props.item.activityLabel) return [];
  return receipt.texts.flatMap(block => {
    const result = readWebRetrievalResult("kimi_web_search", block.text);
    return result ? [{index: block.index, result}] : [];
  });
});
const categoryResult = computed(() => props.execution.status === "completed" && !props.item.activityLabel
  ? readSorftimeCategoryResult(mcp.value) : undefined);
const toolOutcome = computed(() => {
  if (props.item.activityLabel) return props.item.activityLabel;
  switch (props.execution.status) {
    case "completed": return completedMcpOutcome(native.value);
    case "failed": return "工具执行失败。";
    case "declined": return "这次操作未获批准。";
    case "in_progress": return props.item.busy ? "正在等待工具返回结果…" : "执行结果待确认。";
    default: return "执行结果待确认。";
  }
});
</script>

<template>
  <ChatTimelineItemShell
    :class="{ 'mcp-tool-row': mcpCall, 'deep-search-row': deepSearch, 'web-fetch-row': webFetch }"
    :process-presentation="processPresentation"
    :item="item" :label="title" :call-time-ms="repeatCallTimeMs" :status-label="headerStatus" :icon="activityItemIcon(item, mcp)"
    collapsible :show-availability="!mcpCall && !fileChange && !imageView" :default-expanded="!mcpCall && !processPresentation && item.busy"
    @disclosure-change="emit('disclosure-change', $event)"
  >
    <div class="native-tool" :class="{ 'chat-execution-details': mcpCall }" :aria-busy="evidence.busy">
      <template v-if="deepSearch">
        <p v-if="query" class="native-tool__query">搜索词 {{ query }}</p>
        <WebRetrievalResult v-if="searchResult" :key="item.identity" :preview="searchResult" @open-source="open" />
        <p v-else-if="evidence.activityLabel" role="note">{{ evidence.activityLabel }}</p>
        <p v-else-if="!evidence.busy" role="note">{{ executionStatus === "completed" && !fact ? "本次搜索的结果详情不可用。" : summaryStatus }}</p>
        <p v-if="openError" role="alert">{{ openError }}</p>
      </template>
      <template v-else-if="webFetch">
        <strong v-if="fetchDetails?.title" class="native-tool__page-title">{{ fetchDetails.title }}</strong>
        <p v-if="fetchDescription">{{ fetchDescription }}</p>
      </template>
      <p v-else-if="fileChange" class="native-tool__file-change">{{ native.text || "文件变更明细不可用。" }}</p>
      <p v-else-if="imageView" class="native-tool__image-view">{{ status }}<span v-if="imageViewNumber"> · 本轮第 {{ imageViewNumber }} 次查看</span><span v-if="elapsed"> · 用时 {{ elapsed }}</span></p>
      <template v-else-if="native.type === 'subAgentActivity'">
        <p v-if="native.text">{{ native.text }}</p>
        <pre v-if="native.outputText">{{ native.outputText }}</pre>
        <p v-if="native.availability !== 'available'" role="note">部分记录未完整展示。</p>
      </template>
      <template v-else-if="mcpCall">
        <template v-if="basicSearchResults.length">
          <WebRetrievalResult v-for="block in basicSearchResults" :key="block.index" :parsed="block.result" />
        </template>
        <SorftimeCategoryResult v-else-if="categoryResult" :key="item.identity" :result="categoryResult" />
        <p v-else>{{ toolOutcome }}</p>
      </template>
      <p v-if="mcpCall" class="native-tool__source chat-execution-details__footer">
        <ChatToolCallStatus :item="evidence" /><span v-if="sourceAndDuration"> · {{ sourceAndDuration }}</span>
      </p>
      <details v-if="searchCalls && searchCalls.length > 1" class="native-tool__calls">
        <summary>调用明细（{{ searchCalls.length }} 次）</summary>
        <ol><li v-for="call in searchCalls" :key="call.identity">
          本轮第 {{ call.ordinal + 1 }} 项 · {{ callLabel(call) }} · <ChatToolCallStatus :item="call" />
        </li></ol>
      </details>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.native-tool:not(.chat-execution-details) { display:grid; gap:var(--yj-space-3); color:var(--yj-color-text-primary); }
.native-tool p { margin:0; }
.native-tool__query, .native-tool__file-change { overflow-wrap: anywhere; white-space: pre-wrap; }
.mcp-tool-row .native-tool {
  overflow-wrap: anywhere;
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-weight: var(--yj-font-weight-regular);
}
.native-tool__page-title { color: var(--yj-color-text-primary); overflow-wrap: anywhere; }
.native-tool pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:28rem; overflow:auto; margin:0; font:inherit; }
.native-tool__source, .native-tool__image-view { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
</style>
