<script setup lang="ts">
import { computed } from "vue";
import YjIcon from "../yijie/YjIcon.vue";
const props = defineProps<{ state: "in_progress" | "completed" | "interrupted" | "unknown" }>();
const message = computed(() => ({
  in_progress: "正在整理上下文 · 可能需要几分钟",
  completed: "上下文已更新",
  interrupted: "上下文整理已中断",
  unknown: "上下文更新状态待确认",
})[props.state]);
</script>

<template>
  <div class="chat-context-update" role="status" aria-live="polite" aria-atomic="true" data-source="native-context-compaction">
    <YjIcon name="contextUpdate" size="sm" tone="muted" :stroke-width="1.5" />
    <span>{{ message }}</span>
  </div>
</template>

<style scoped>
.chat-context-update {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}
</style>
