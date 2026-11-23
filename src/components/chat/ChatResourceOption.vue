<script setup lang="ts">
import ChatResourceCheck from "./ChatResourceCheck.vue";

defineProps<{ name: string; selected: boolean; disabled: boolean }>();
</script>

<template>
  <button type="button" class="chat-resource-option" role="checkbox" :aria-checked="selected" :disabled="disabled">
    <slot name="icon" />
    <span class="chat-resource-option__copy">
      <span class="chat-resource-option__name">{{ name }}</span>
      <slot />
    </span>
    <ChatResourceCheck :selected="selected" />
  </button>
</template>

<style scoped>
.chat-resource-option {
  --yj-resource-check-color: var(--yj-color-chat-skill-mention);
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  min-height: var(--yj-control-height-lg);
  padding: var(--yj-space-2);
  border: 0;
  border-radius: var(--yj-radius-md);
  background: transparent;
  color: var(--yj-color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.chat-resource-option:is(:hover, [aria-checked="true"]):not(:disabled) { background: var(--yj-color-control-hover); }
.chat-resource-option:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(var(--yj-border-width) * -1); }
.chat-resource-option:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-resource-option__copy { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: var(--yj-space-1); font-size: var(--yj-font-size-body); }
.chat-resource-option__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
