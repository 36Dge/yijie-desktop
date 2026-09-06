<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import YjIcon from "../yijie/YjIcon.vue";

type CopyOutcome = "idle" | "pending" | "success" | "error";

const props = withDefaults(defineProps<{
  adapter: ChatClipboardAdapter;
  text: string;
  kind?: "text" | "code";
}>(), {
  kind: "text",
});

const outcome = ref<CopyOutcome>("idle");
const announcement = ref("");
let operationEpoch = 0;

const actionLabel = computed(() => props.kind === "code" ? "复制代码" : "复制文本");
const feedback = computed(() => {
  switch (outcome.value) {
    case "pending":
      return "正在复制…";
    case "success":
      return "已复制";
    case "error":
      return "复制失败，请重试。";
    case "idle":
    default:
      return "";
  }
});
const icon = computed(() => {
  if (outcome.value === "success") return "check" as const;
  if (outcome.value === "error") return "warning" as const;
  return "copy" as const;
});
const iconTone = computed(() => {
  if (outcome.value === "success") return "success" as const;
  if (outcome.value === "error") return "error" as const;
  return "muted" as const;
});
const unavailable = computed(() => props.text.length === 0 || outcome.value === "pending");

watch(
  () => [props.text, props.adapter] as const,
  () => {
    operationEpoch += 1;
    outcome.value = "idle";
    announcement.value = "";
  },
);

async function copy(): Promise<void> {
  if (unavailable.value) return;
  const epoch = ++operationEpoch;
  const text = props.text;
  outcome.value = "pending";
  announcement.value = "";
  try {
    await props.adapter.writeText(text);
    if (epoch !== operationEpoch) return;
    outcome.value = "success";
    announcement.value = props.kind === "code" ? "代码已复制。" : "文本已复制。";
  } catch {
    if (epoch !== operationEpoch) return;
    outcome.value = "error";
    announcement.value = "复制失败，请重试。";
  }
}
</script>

<template>
  <div
    class="chat-copy-action"
    :class="`chat-copy-action--${outcome}`"
  >
    <button
      class="chat-copy-action__button"
      type="button"
      :aria-label="actionLabel"
      :title="actionLabel"
      :aria-disabled="unavailable ? 'true' : undefined"
      :aria-busy="outcome === 'pending' ? 'true' : undefined"
      @pointerdown.prevent
      @mousedown.prevent
      @click="copy"
    >
      <YjIcon :name="icon" size="sm" :tone="iconTone" />
    </button>
    <span
      v-if="feedback"
      class="chat-copy-action__feedback"
      aria-hidden="true"
    >{{ feedback }}</span>
    <span
      class="chat-copy-action__announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ announcement }}</span>
  </div>
</template>

<style scoped>
.chat-copy-action {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-1);
}

.chat-copy-action__button {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: var(--yj-space-0);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-secondary);
  background: transparent;
  cursor: pointer;
}

.chat-copy-action__button:hover:not([aria-disabled="true"]) {
  border-color: var(--yj-color-border-subtle);
  background: var(--yj-color-control-hover);
}

.chat-copy-action__button:active:not([aria-disabled="true"]) {
  background: var(--yj-color-control-pressed);
}

.chat-copy-action__button[aria-disabled="true"] {
  color: var(--yj-color-text-disabled);
  cursor: default;
}

.chat-copy-action__button:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.chat-copy-action__feedback {
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  white-space: nowrap;
}

.chat-copy-action--success .chat-copy-action__feedback {
  color: var(--yj-color-semantic-success-ink);
}

.chat-copy-action--error .chat-copy-action__feedback {
  color: var(--yj-color-semantic-error-ink);
}

.chat-copy-action__announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: var(--yj-space-0);
  border: 0;
  margin: -1px;
  clip: rect(0 0 0 0);
  overflow: hidden;
  white-space: nowrap;
}
</style>
