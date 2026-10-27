<script setup lang="ts">
defineProps<{text: string}>();
</script>

<template>
  <div class="chat-execution-progress" aria-label="正在处理" data-progress-source="runtime_records">
    <p>{{ text }}</p>
  </div>
</template>

<style scoped>
.chat-execution-progress { display: grid; min-width: 0; gap: var(--yj-space-1); }
.chat-execution-progress__source { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.chat-execution-progress p { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); overflow-wrap: anywhere; }
</style>
