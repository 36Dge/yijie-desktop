<script lang="ts">
export interface SubmissionNotice {
  message: string;
  tone: "error" | "warning" | "neutral";
  actionLabel: string;
  action: () => void;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
defineProps<{ notice: SubmissionNotice; disabled: boolean; recoverable: boolean; recoveryDisabled: boolean }>();
defineEmits<{ recover: [] }>();
</script>

<template>
  <p class="chat-submission-notice" :class="`chat-submission-notice--${notice.tone}`" :role="notice.tone === 'error' ? 'alert' : 'status'">
    {{ notice.message }}
    <button type="button" class="yj-control" :disabled="disabled || notice.disabled" @click="notice.action()">{{ notice.actionLabel }}</button>
    <template v-if="recoverable">
      恢复会重新应用原选择，不发送消息。
      <button type="button" class="yj-control" :disabled="recoveryDisabled" @click="$emit('recover')">恢复原操作</button>
    </template>
  </p>
</template>

<style scoped>
.chat-submission-notice { width: min(100%, var(--yj-layout-chat-composer-max)); margin: 0 0 var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-submission-notice--warning { color: var(--yj-color-semantic-warning-ink); }
.chat-submission-notice--error { color: var(--yj-color-semantic-error-ink); }
.chat-submission-notice button { padding: 0; border: 0; color: inherit; background: transparent; font-weight: var(--yj-font-weight-semibold); text-decoration: underline; }
</style>
