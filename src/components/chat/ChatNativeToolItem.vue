<script setup lang="ts">
import { computed } from "vue";
import { activityItemTitle } from "../../domain/conversation-activity-summary";
import { formatToolDuration } from "../../domain/chat-ui";
import { readDeepSearchPreview, readWebRetrievalResult } from "../../domain/web-retrieval-display";
import { useWebSources } from "../../composables/useWebSources";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import ChatCopyAction from "./ChatCopyAction.vue";
import WebRetrievalResult from "./WebRetrievalResult.vue";
import type { ConversationNativeToolExecution } from "../../domain/conversation-view";
import { activityItemIcon, activityNativeItem, deepSearchEvidence, deepSearchReceipt } from "../../domain/conversation-activity-entry";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatTimelineItemShell, { type ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";

const props = defineProps<{ item: ConversationTimelineItemViewModel; execution: ConversationNativeToolExecution; processPresentation?: boolean; searchCalls?: readonly ConversationTimelineItemViewModel[] }>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const evidence = computed(() => deepSearchEvidence(props.item, props.searchCalls));
const { open, openError } = useWebSources(() => evidence.value);
const native = computed(() => activityNativeItem(evidence.value) ?? props.execution.native.item);
const nativeOperation = computed(() => ["fileChange", "subAgentActivity"].includes(native.value.type));
const mcp = computed(() => native.value.mcp);
const builtinWeb = computed(() => mcp.value?.server === "yijie_web" && ["kimi_web_search", "kimi_web_search_pro", "kimi_web_fetch"].includes(mcp.value.tool ?? ""));
const deepSearch = computed(() => builtinWeb.value && mcp.value?.tool === "kimi_web_search_pro");
const webFetch = computed(() => builtinWeb.value && mcp.value?.tool === "kimi_web_fetch");
const fetchSite = computed(() => {
  const site = native.value.argumentsSummary;
  return webFetch.value && site && /^[a-z\d.-]{1,253}$/i.test(site) &&
    !mcp.value?.diagnostics.some(code => code === "arguments_unavailable") ? site : undefined;
});
const fetchDetails = computed(() => {
  const receipt = mcp.value;
  if (!webFetch.value || receipt?.resultKind !== "text" || receipt.texts.length !== 1 || receipt.texts[0]?.index !== 0) return;
  const text = receipt.texts[0].text.trim();
  if (!text) return;
  // Earlier readers also accepted a canonical tool result inside a text block.
  if (text.startsWith("{") || text.startsWith("[") || text.startsWith("Wall time:")) {
    const saved = readWebRetrievalResult("kimi_web_fetch", text);
    if (saved && "error" in saved) return {description: saved.error.message};
    if (saved && "markdown" in saved && props.execution.status === "completed") return {
      title: saved.title, description: saved.truncated ? "已读取部分正文，网页内容较长。" : "已读取网页正文。",
    };
    return;
  }
  return {description: text, title: props.execution.status === "completed" ? native.value.resultSummary : undefined};
});
const fetchDescription = computed(() => {
  if (fetchDetails.value) return fetchDetails.value.description;
  if (props.item.busy) return "正在读取网页内容…";
  if (props.item.activityLabel) return props.item.activityLabel;
  switch (props.execution.status) {
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
const title = computed(() => [activityItemTitle(props.item), query.value || fetchSite.value].filter(Boolean).join(" · "));
const elapsed = computed(() => native.value.durationMs == null ? null : formatToolDuration(native.value.durationMs));
const identity = computed(() => mcp.value?.server && mcp.value.tool ? `${mcp.value.server} / ${mcp.value.tool}` : "工具身份信息不完整");
const status = computed(() => {
  if (native.value.type === "subAgentActivity") return props.item.busy ? "处理中" : "已记录";
  switch (props.execution.status) {
    case "completed": return "已完成";
    case "failed": return webFetch.value ? "读取失败" : "调用失败";
    case "declined": return "已拒绝";
    case "in_progress": return props.item.busy ? "执行中" : "最后观察：执行中";
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
  if ((evidence.value.execution?.status === "completed") && result && "results" in result && (result.results.length || !result.truncated)) {
    return fact.value?.outcome === "partial"
      ? `${result.results.length} 条结果 · 部分资料`
      : `${result.results.length} 条结果`;
  }
  return status.value;
});
const headerStatus = computed(() => [summaryStatus.value, reuses.value ? `已复用 ${reuses.value} 次` : "", joins.value ? `并发合并 ${joins.value} 次` : ""].filter(Boolean).join(" · "));
const resultMessage = computed(() => {
  switch (mcp.value?.resultKind) {
    case "absent": return "原生记录未提供结果字段。";
    case "null": return "原生记录未提供结果对象。";
    case "empty": return "服务返回了空内容列表。";
    case "unsupported": return "结果中没有当前支持展示的文本。";
    case "omitted": return "结果内容已省略，请查看下方提示。";
    case "text": return null;
    default: return "该历史记录没有保存可展示的工具正文。";
  }
});
const diagnosticLabels = {
  identity_unavailable: "工具身份信息不可用。",
  arguments_unavailable: "参数不在当前可展示范围内。",
  unsupported_content: "结果包含当前未支持展示的内容类型。",
  content_redacted: "部分文本因安全规则已调整或隐藏。",
  content_truncated: "文本已达到显示长度限制。",
  content_limit: "部分内容超出显示数量或容量限制。",
  result_unavailable: "结果内容不可展示。",
  display_limit: "本轮显示容量已满，保留状态，省略正文。",
} as const;
</script>

<template>
  <ChatTimelineItemShell
    :class="{ 'deep-search-row': deepSearch, 'web-fetch-row': webFetch }"
    :process-presentation="processPresentation"
    :item="item" :label="title" :status-label="headerStatus" :icon="activityItemIcon(item, mcp)"
    collapsible :show-availability="!deepSearch && !webFetch" :default-expanded="!deepSearch && !webFetch && !processPresentation && item.busy"
    @disclosure-change="emit('disclosure-change', $event)"
  >
    <div class="native-tool" :aria-busy="item.busy">
      <template v-if="deepSearch">
        <p v-if="query" class="native-tool__query">搜索词 {{ query }}</p>
        <WebRetrievalResult v-if="searchResult" :key="item.identity" :preview="searchResult" @open-source="open" />
        <p v-else-if="item.activityLabel" role="note">{{ item.activityLabel }}</p>
        <p v-else-if="!item.busy" role="note">{{ execution.status === "completed" && !fact ? "本次搜索的结果详情不可用。" : summaryStatus }}</p>
        <details v-if="searchCalls && searchCalls.length > 1" class="native-tool__calls">
          <summary>调用明细（{{ searchCalls.length }} 次）</summary>
          <ol><li v-for="call in searchCalls" :key="call.identity">
            本轮第 {{ call.ordinal + 1 }} 项 · {{ callLabel(call) }} <code>{{ call.itemId }}</code>
          </li></ol>
        </details>
        <p v-if="openError" role="alert">{{ openError }}</p>
        <p class="native-tool__source">易界网页检索<span v-if="elapsed"> · 耗时 {{ elapsed }}</span></p>
      </template>
      <template v-else-if="webFetch">
        <strong v-if="fetchDetails?.title" class="native-tool__page-title">{{ fetchDetails.title }}</strong>
        <p v-if="fetchDescription">{{ fetchDescription }}</p>
        <p v-if="elapsed" class="native-tool__source">用时 {{ elapsed }}</p>
      </template>
      <template v-else-if="nativeOperation">
        <p v-if="native.text">{{ native.text }}</p>
        <pre v-if="native.outputText">{{ native.outputText }}</pre>
        <p v-if="native.availability !== 'available'" role="note">部分记录未完整展示。</p>
      </template>
      <template v-else>
      <strong>{{ builtinWeb ? '易界网页检索' : native.toolDisplay?.sourceLabel || identity }}</strong>
      <p v-if="mcp?.server === 'sorftime'" class="native-tool__source">这是旧版 Sorftime 工具记录，仅供查看。新调用请从连接器页面配置并在聊天中选择 Sorftime。</p>
      <p class="native-tool__source">{{ execution.native.source === 'native_observed' ? '已观察到的原生记录' : '原生历史读取' }}</p>
      <p v-if="item.activityLabel" role="note">{{ item.activityLabel }}</p>
      <section aria-label="工具参数"><h3>查询参数</h3><pre>{{ native.argumentsSummary ?? '参数信息不可用。' }}</pre></section>
      <section aria-label="服务返回文本">
        <h3>服务返回文本</h3>
        <p v-if="resultMessage" role="note">{{ resultMessage }}</p>
        <div v-for="block in mcp?.texts ?? []" :key="`${native.id}:mcp:${block.index}`" :data-native-content-index="block.index">
          <ChatCopyAction v-if="block.text !== ''" :adapter="browserChatClipboardAdapter" :text="block.text" />
          <WebRetrievalResult v-if="builtinWeb && block.text !== ''" :tool="mcp?.tool ?? ''" :text="block.text" />
          <pre v-else-if="block.text !== ''">{{ block.text }}</pre>
          <p v-else class="native-tool__source">服务返回了一个空文本块。</p>
        </div>
      </section>
      <p v-if="native.durationMs != null">耗时：{{ native.durationMs }} 毫秒</p>
      <ul v-if="mcp?.diagnostics.length" aria-label="内容可用性提示">
        <li v-for="code in mcp.diagnostics" :key="code">{{ diagnosticLabels[code] }}</li>
      </ul>
      <p v-else-if="native.availability !== 'available'" role="note">该项内容信息不完整；这不改变原生执行结果。</p>
      </template>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.native-tool { display:grid; gap:var(--yj-space-3); color:var(--yj-color-text-primary); }
.native-tool h3 { font-size:var(--yj-font-size-caption); margin:0 0 var(--yj-space-2); }
.native-tool p { margin:0; }
.native-tool__query { overflow-wrap: anywhere; white-space: pre-wrap; }
.deep-search-row .native-tool, .web-fetch-row .native-tool {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-weight: var(--yj-font-weight-regular);
}
.native-tool__page-title { color: var(--yj-color-text-primary); overflow-wrap: anywhere; }
.native-tool pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:28rem; overflow:auto; margin:0; font:inherit; }
.native-tool__source { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
.native-tool__calls code { overflow-wrap: anywhere; color: var(--yj-color-text-muted); }
</style>
