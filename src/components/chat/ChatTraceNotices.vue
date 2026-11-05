<script setup lang="ts">
import { computed } from "vue";
import type { NativeTraceNotice } from "../../api/generated/native-conversation-private.gen";
import { conversationDiagnosticMessage, showConversationNotice } from "../../domain/conversation-diagnostics";

const props = defineProps<{ notices: readonly NativeTraceNotice[] }>();
const visibleNotices = computed(() => props.notices.filter((notice, index, all) => {
  if (!showConversationNotice(notice.method, notice.code)) return false;
  const previous = all[index - 1];
  // Collapse only consecutive equivalent display notices, never saved facts.
  return !previous || previous.scope !== notice.scope || previous.method !== notice.method || previous.code !== notice.code || (previous.willRetry ?? null) !== (notice.willRetry ?? null) || previous.itemId !== notice.itemId;
}));
function title(notice: NativeTraceNotice) {
  const scope = notice.scope === "thread" ? "对话" : "本轮";
  if (notice.method === "warning") return `${scope}运行提示`;
  if (notice.willRetry === true) return `${scope}运行时曾报告重试`;
  if (notice.willRetry === false) return `${scope}运行错误，未安排重试`;
  return `${scope}运行错误，重试状态未提供`;
}
</script>

<template>
  <aside v-if="visibleNotices.length" class="chat-trace-notices" aria-label="运行通知">
    <template v-for="notice in visibleNotices" :key="notice.eventId">
    <p v-if="notice.code === 'runtime_notice'" role="note">{{ title(notice) }}</p>
    <details v-else>
      <summary>{{ title(notice) }}</summary>
      <p role="note">本轮记录的提示：{{ conversationDiagnosticMessage(notice.code) }}</p>
    </details>
    </template>
  </aside>
</template>

<style scoped>
.chat-trace-notices { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); display: grid; gap: var(--yj-space-2); }
.chat-trace-notices summary { cursor: pointer; padding-block: var(--yj-space-1); border-radius: var(--yj-radius-sm); }
.chat-trace-notices summary:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-trace-notices p { margin: var(--yj-space-2) 0 0; overflow-wrap: anywhere; }
</style>
