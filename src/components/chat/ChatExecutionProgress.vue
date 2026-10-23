<script setup lang="ts">
defineProps<{text: string}>();
</script>

<template>
  <div class="chat-execution-progress" aria-label="执行进度（系统根据实际执行记录提供）" data-progress-source="runtime_records">
    <span class="chat-execution-progress__source">执行进度</span>
    <p>{{ text }}</p>
  </div>
</template>

<style scoped>
.chat-execution-progress { display: grid; min-width: 0; gap: var(--yj-space-1); }
.chat-execution-progress__source { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.chat-execution-progress p { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); overflow-wrap: anywhere; }
</style>
