<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatReasoningItem, ChatReasoningMetadata } from "../../domain/chat-ipc";
import { reasoningStatusLabel } from "../../domain/chat-ui";
import type { LiveReasoningPart } from "../../stores/chat.store";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{
  disclosureId: string;
  metadata?: readonly ChatReasoningMetadata[];
  items?: readonly ChatReasoningItem[];
  liveParts?: readonly LiveReasoningPart[];
  live?: boolean;
  loading?: boolean;
  defaultExpanded?: boolean;
}>(), {
  metadata: () => [],
  items: () => [],
  liveParts: () => [],
  live: false,
  loading: false,
  defaultExpanded: false,
});

const emit = defineEmits<{
  load: [];
}>();

const expanded = ref(props.defaultExpanded);
const contentId = computed(() => `${props.disclosureId}-content`);
const itemCount = computed(() => props.live
  ? new Set(props.liveParts.map((part) => part.itemOrdinal)).size
  : props.metadata.length,
);
const byteCount = computed(() => props.live
  ? new TextEncoder().encode(props.liveParts.map((part) => part.text).join("")).length
  : props.metadata.reduce((total, item) => total + item.totalBytes, 0),
);
const overallStatus = computed(() => {
  if (props.live) return "streaming";
  if (props.metadata.some((item) => item.status === "unavailable")) return "unavailable";
  if (props.metadata.some((item) => item.status === "incomplete")) return "incomplete";
  return "complete";
});
const statusText = computed(() => {
  if (props.live) return "正在记录";
  const first = props.metadata.find((item) => item.status !== "complete") ?? props.metadata[0];
  return first ? reasoningStatusLabel(first.status, first.reasonCode) : "没有推理记录";
});
const hasLoadedText = computed(() => props.items.some((item) => item.parts.some((part) => part.text.length > 0)));

function toggle(): void {
  expanded.value = !expanded.value;
  if (expanded.value && !props.live && !hasLoadedText.value && props.metadata.length > 0) emit("load");
}

watch(() => props.defaultExpanded, (value) => {
  if (props.live) expanded.value = value;
});
</script>

<template>
  <section class="reasoning" :class="`reasoning--${overallStatus}`" aria-label="模型推理记录">
    <button
      class="reasoning__trigger"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="contentId"
      @click="toggle"
    >
      <span class="reasoning__title">
        <YjIcon name="assistant" size="sm" tone="muted" />
        模型推理记录
      </span>
      <span class="reasoning__summary">
        {{ statusText }}<template v-if="itemCount > 0"> · {{ itemCount }} 项 · {{ byteCount }} 字节</template>
      </span>
      <YjIcon :name="expanded ? 'chevronDown' : 'chevronRight'" size="sm" tone="muted" />
    </button>

    <div v-if="expanded" :id="contentId" class="reasoning__content">
      <p v-if="loading" class="reasoning__state" role="status">正在读取本地推理记录…</p>
      <template v-else-if="live">
        <div
          v-for="part in liveParts"
          :key="`${part.itemOrdinal}:${part.contentIndex}`"
          class="reasoning__part"
        >{{ part.text }}</div>
        <p v-if="liveParts.length === 0" class="reasoning__state">正在等待推理文字…</p>
      </template>
      <template v-else-if="hasLoadedText">
        <article v-for="item in items" :key="item.itemOrdinal" class="reasoning__item">
          <p v-if="item.status !== 'complete'" class="reasoning__warning">
            <YjIcon name="warning" size="sm" tone="warning" />
            {{ reasoningStatusLabel(item.status, item.reasonCode) }}
          </p>
          <div v-for="part in item.parts" :key="part.contentIndex" class="reasoning__part">{{ part.text }}</div>
        </article>
      </template>
      <p v-else class="reasoning__state" :class="{ 'reasoning__state--error': overallStatus === 'unavailable' }">
        {{ statusText }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.reasoning {
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-subtle);
}

.reasoning--incomplete { border-color: color-mix(in srgb, var(--yj-color-warning) 32%, transparent); }
.reasoning--unavailable { border-color: color-mix(in srgb, var(--yj-color-error) 32%, transparent); }

.reasoning__trigger {
  display: grid;
  width: 100%;
  min-height: var(--yj-space-10);
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-3) var(--yj-space-4);
  border: 0;
  border-radius: inherit;
  color: var(--yj-color-text-primary);
  background: transparent;
  text-align: left;
}

.reasoning__trigger:hover { background: color-mix(in srgb, var(--yj-color-bg-card) 44%, transparent); }
.reasoning__trigger:focus-visible { outline: var(--yj-space-1) solid var(--yj-color-brand-border); outline-offset: var(--yj-space-1); }

.reasoning__title {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  font-weight: var(--yj-font-weight-semibold);
}

.reasoning__summary {
  min-width: 0;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reasoning__content {
  padding: var(--yj-space-4);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.reasoning__item + .reasoning__item { margin-top: var(--yj-space-4); }

.reasoning__part {
  color: var(--yj-color-text-secondary);
  font-family: var(--yj-font-family-sans);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reasoning__part + .reasoning__part { margin-top: var(--yj-space-3); }

.reasoning__warning,
.reasoning__state {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.reasoning__warning { margin-bottom: var(--yj-space-3); color: var(--yj-color-warning); }
.reasoning__state--error { color: var(--yj-color-error); }
</style>
