<script setup lang="ts">
import { computed } from "vue";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import { toolActivityStatus } from "../../domain/conversation-tool-visibility";

const props = defineProps<{ item: ConversationTimelineItemViewModel }>();
const status = computed(() => toolActivityStatus(props.item));
const labels = {
  success: "调用成功",
  running: "执行中",
  failed: "调用失败",
  declined: "已拒绝",
  not_dispatched: "未派发",
  incomplete: "未完整结束",
  unknown: "结果待确认",
};
</script>

<template>
  <span class="chat-tool-call-status" :class="{ 'chat-tool-call-status--success': status === 'success' }">{{ labels[status] }}</span>
</template>

<style scoped>
.chat-tool-call-status { white-space: nowrap; }
.chat-tool-call-status--success { color: var(--yj-color-chat-link); }
</style>
