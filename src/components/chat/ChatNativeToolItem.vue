<script setup lang="ts">
import { computed } from "vue";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import ChatCopyAction from "./ChatCopyAction.vue";
import type { ConversationNativeToolExecution } from "../../domain/conversation-view";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import ChatTimelineItemShell, { type ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";

const props = defineProps<{ item: ConversationTimelineItemViewModel; execution: ConversationNativeToolExecution }>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const native = computed(() => props.execution.native.item);
const mcp = computed(() => native.value.mcp);
const identity = computed(() => mcp.value?.server && mcp.value.tool ? `${mcp.value.server} / ${mcp.value.tool}` : "工具身份信息不完整");
const status = computed(() => {
  switch (props.execution.status) {
    case "completed": return "已完成";
    case "failed": return "调用失败";
    case "declined": return "已拒绝";
    case "in_progress": return props.item.busy ? "执行中" : "最后观察：执行中";
    default: return "状态信息不完整";
  }
});
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
    :item="item" label="工具调用" :status-label="status" icon="skillOperations"
    :status-icon="item.busy ? 'pending' : execution.status === 'completed' ? 'check' : 'warning'"
    :status-tone="item.busy ? 'primary' : execution.status === 'completed' ? 'success' : 'muted'"
    collapsible :default-expanded="item.busy"
    @disclosure-change="emit('disclosure-change', $event)"
  >
    <div class="native-tool" :aria-busy="item.busy">
      <strong>{{ identity }}</strong>
      <p class="native-tool__source">Sorftime 仅在“请求批准”模式可用。切换其他权限模式后，需要正常退出并重新启动应用才能再次启用。</p>
      <p class="native-tool__source">{{ execution.native.source === 'native_observed' ? '已观察到的原生记录' : '原生历史读取' }}</p>
      <p v-if="item.activityLabel" role="note">{{ item.activityLabel }}</p>
      <section aria-label="工具参数"><h3>查询参数</h3><pre>{{ native.argumentsSummary ?? '参数信息不可用。' }}</pre></section>
      <section aria-label="服务返回文本">
        <h3>服务返回文本</h3>
        <p v-if="resultMessage" role="note">{{ resultMessage }}</p>
        <div v-for="block in mcp?.texts ?? []" :key="`${native.id}:mcp:${block.index}`" :data-native-content-index="block.index">
          <ChatCopyAction v-if="block.text !== ''" :adapter="browserChatClipboardAdapter" :text="block.text" />
          <pre v-if="block.text !== ''">{{ block.text }}</pre>
          <p v-else class="native-tool__source">服务返回了一个空文本块。</p>
        </div>
      </section>
      <p v-if="native.durationMs != null">耗时：{{ native.durationMs }} 毫秒</p>
      <ul v-if="mcp?.diagnostics.length" aria-label="内容可用性提示">
        <li v-for="code in mcp.diagnostics" :key="code">{{ diagnosticLabels[code] }}</li>
      </ul>
      <p v-else-if="native.availability !== 'available'" role="note">该项内容信息不完整；这不改变原生执行结果。</p>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.native-tool { display:grid; gap:var(--yj-space-3); color:var(--yj-color-text-primary); }
.native-tool h3 { font-size:var(--yj-font-size-caption); margin:0 0 var(--yj-space-2); }
.native-tool p { margin:0; }
.native-tool pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:28rem; overflow:auto; margin:0; font:inherit; }
.native-tool__source { color:var(--yj-color-text-secondary); font-size:var(--yj-font-size-caption); }
</style>
