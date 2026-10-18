<script setup lang="ts">
import type { ChatUiNotice } from "../../domain/chat-ui";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  notice: ChatUiNotice;
  recoveryAvailable: boolean;
  busy: boolean;
}>();

defineEmits<{ recover: [] }>();
</script>

<template>
  <div
    v-if="notice.tone !== 'success' || notice.actionLabel !== null"
    class="chat-composer__readiness"
    :class="`chat-composer__readiness--${notice.tone}`"
    role="status"
  >
    <span class="chat-composer__readiness-dot" aria-hidden="true" />
    <span class="chat-composer__readiness-copy">
      <strong>{{ notice.title }}</strong>
      <span>{{ notice.detail }}</span>
    </span>
    <button
      v-if="recoveryAvailable && notice.actionLabel"
      class="chat-composer__recovery yj-control"
      type="button"
      :disabled="busy"
      @click="$emit('recover')"
    >
      <YjIcon name="refresh" size="xs" />
      {{ notice.actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.chat-composer__readiness {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  margin-top: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
}

.chat-composer__readiness--success { background: var(--yj-color-success-soft); }
.chat-composer__readiness--warning { background: var(--yj-color-warning-soft); }
.chat-composer__readiness--error { background: var(--yj-color-error-soft); }

.chat-composer__readiness-dot {
  width: var(--yj-space-2);
  height: var(--yj-space-2);
  flex: 0 0 var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-icon-muted);
}

.chat-composer__readiness--success .chat-composer__readiness-dot { background: var(--yj-color-success); }
.chat-composer__readiness--warning .chat-composer__readiness-dot { background: var(--yj-color-warning); }
.chat-composer__readiness--error .chat-composer__readiness-dot { background: var(--yj-color-error); }

.chat-composer__readiness-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 0 var(--yj-space-2);
}

.chat-composer__readiness-copy strong { color: var(--yj-color-text-primary); }

.chat-composer__recovery {
  flex: none;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.chat-composer__recovery:hover {
  background: var(--yj-color-bg-subtle);
}

.chat-composer__recovery:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
</style>
