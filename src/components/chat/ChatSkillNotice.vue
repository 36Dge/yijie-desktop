<script setup lang="ts">
import { NButton } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{ message: string }>();
defineEmits<{ manage: [] }>();
</script>

<template>
  <div class="chat-skill-notice" role="status" aria-label="技能使用提示">
    <YjIcon name="skillOperations" size="sm" tone="muted" />
    <span>{{ message }}</span>
    <NButton quaternary size="small" @click="$emit('manage')">管理技能</NButton>
  </div>
</template>

<style scoped>
.chat-skill-notice { display: flex; align-items: center; gap: var(--yj-space-2); padding-block: var(--yj-space-3); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); }
.chat-skill-notice span { min-width: 0; white-space: pre-line; overflow-wrap: anywhere; }
.chat-skill-notice button { flex: none; }
</style>
