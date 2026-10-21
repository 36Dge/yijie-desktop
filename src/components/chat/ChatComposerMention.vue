<script setup lang="ts">
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  name: string;
  icon: YjIconName;
  removeLabel: string;
  unavailableReason?: string | null;
  disabled?: boolean;
}>();
defineEmits<{ remove: [] }>();
</script>

<template>
  <button
    type="button"
    class="chat-composer-mention"
    :aria-label="removeLabel"
    :title="unavailableReason ? `${name}：${unavailableReason}；点击移除` : `点击移除 ${name}`"
    :disabled="disabled"
    @click="!disabled && $emit('remove')"
  >
    <span class="chat-composer-mention__icon" aria-hidden="true">
      <YjIcon :name="icon" size="sm" />
      <YjIcon name="dismiss" size="sm" />
    </span>
    <span class="chat-composer-mention__copy">
      <span>{{ name }}</span>
      <span v-if="unavailableReason" class="chat-composer-mention__reason">{{ unavailableReason }}</span>
    </span>
  </button>
</template>

<style scoped>
.chat-composer-mention { display: inline-flex; min-width: 0; align-items: flex-start; gap: var(--yj-space-1); padding: 0; border: 0; border-radius: var(--yj-radius-sm); color: var(--yj-color-connector-composer-mention); background: transparent; font: inherit; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-regular); line-height: var(--yj-line-height-body); cursor: pointer; }
.chat-composer-mention__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.chat-composer-mention__copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-composer-mention__reason { font-size: var(--yj-font-size-caption); color: var(--yj-color-semantic-warning-ink); }
.chat-composer-mention__icon { display: inline-grid; flex: none; align-items: center; height: var(--yj-line-height-body); }
.chat-composer-mention__icon > * { grid-area: 1 / 1; }
.chat-composer-mention__icon > :last-child { visibility: hidden; }
.chat-composer-mention:is(:hover, :focus-visible):not(:disabled) .chat-composer-mention__icon > :first-child { visibility: hidden; }
.chat-composer-mention:is(:hover, :focus-visible):not(:disabled) .chat-composer-mention__icon > :last-child { visibility: visible; }
.chat-composer-mention:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
.chat-composer-mention:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-composer-mention :deep(.yj-icon) { color: inherit; }
</style>
