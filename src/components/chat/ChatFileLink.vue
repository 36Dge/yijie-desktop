<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

defineProps<{ tooltip: string; controls?: string; disabled?: boolean }>();
defineEmits<{ open: [event: MouseEvent]; hint: [] }>();
</script>

<template>
  <YjTooltip :text="tooltip" @show="$emit('hint')">
    <button type="button" role="link" class="chat-file-link" :aria-controls="disabled ? undefined : controls" :aria-disabled="disabled || undefined" @click="!disabled && $emit('open', $event)">
      <YjIcon name="file" size="xs" :stroke-width="1.5" /><span><slot /></span>
    </button>
  </YjTooltip>
</template>

<style scoped>
.chat-file-link {
  display: inline; max-width: 100%; padding: 0; border: 0; border-radius: var(--yj-radius-xs);
  background: transparent; color: var(--yj-color-chat-file-link); font: inherit;
  text-align: start; overflow-wrap: anywhere; cursor: pointer; user-select: text;
}
.chat-file-link :deep(.yj-icon) { margin-inline-end: var(--yj-space-1); color: inherit; vertical-align: -0.12em; }
.chat-file-link[aria-disabled="true"] { color: var(--yj-color-text-secondary); cursor: default; }
.chat-file-link:not([aria-disabled]):hover > span, .chat-file-link:focus-visible > span {
  text-decoration: underline dotted; text-underline-offset: var(--yj-space-1);
}
.chat-file-link:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
