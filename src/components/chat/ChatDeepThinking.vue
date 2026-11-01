<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  item: ConversationTimelineItemViewModel;
  visible: boolean;
  live: boolean;
  stateMessage: string | null;
}>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const expanded = ref(false);
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const contentId = `${useId()}-thinking`;
const hasContent = computed(() => props.item.contentBlocks.length > 0);
let followLatest = true;
let frame: number | null = null;
let observer: ResizeObserver | undefined;

function cancelScroll() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}
function followOutput(finalUpdate = false) {
  if (!expanded.value || !props.visible || !followLatest || (!props.live && !finalUpdate)) return;
  cancelScroll();
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!expanded.value || !props.visible || !followLatest) return;
    const element = viewport.value;
    if (element) element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  });
}
function trackScroll() {
  const element = viewport.value;
  if (!element || !expanded.value || !props.visible) return;
  followLatest = element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
}
function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && props.live) followLatest = true;
  emit("disclosure-change", { itemIdentity: props.item.identity, expanded: expanded.value });
}
watch(() => props.item.identity, () => { expanded.value = false; followLatest = true; cancelScroll(); });
watch([() => props.item.contentBlocks, () => props.live, () => props.visible, expanded], (_current, previous) => {
  if (!expanded.value || !props.visible) cancelScroll();
  else followOutput(previous?.[1] === true);
}, { flush: "post" });
onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && content.value) {
    observer = new ResizeObserver(() => followOutput());
    observer.observe(content.value);
  }
});
onBeforeUnmount(() => { cancelScroll(); observer?.disconnect(); });
</script>

<template>
  <article class="chat-deep-thinking" aria-label="深度思考" :aria-busy="live ? 'true' : 'false'">
    <button class="chat-deep-thinking__toggle" type="button" :aria-expanded="expanded" :aria-controls="contentId"
      :aria-label="`深度思考，${expanded ? '收起' : '展开'}`" @click="toggle">
      <span>深度思考</span>
      <YjIcon class="chat-deep-thinking__chevron" :name="expanded ? 'chevronDown' : 'chevronRight'"
        size="xs" :stroke-width="1.5" tone="muted" />
    </button>
    <p v-if="item.availability && item.availability !== 'available'" class="chat-deep-thinking__notice" role="note">
      {{ item.availability === 'unavailable' ? '此项内容暂不可用' : '此项信息不完整' }}；不代表执行失败。
    </p>
    <p v-if="stateMessage" class="chat-deep-thinking__notice" role="note">{{ stateMessage }}</p>
    <div v-show="expanded" :id="contentId" ref="viewport" class="chat-deep-thinking__viewport"
      role="region" aria-label="深度思考内容" tabindex="0" @scroll.passive="trackScroll">
      <div ref="content" class="chat-deep-thinking__content">
        <section v-for="block in item.contentBlocks" :key="block.identity"
          :aria-label="block.type === 'text' && block.reasoningSource === 'summary' ? '思考摘要' : '思考原文'">
          <ChatSafeContent :blocks="[block]" mode="plain" />
        </section>
        <p v-if="!hasContent" class="chat-deep-thinking__empty">{{ stateMessage || (live ? '正在等待思考内容…' : '暂无可显示的思考内容。') }}</p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.chat-deep-thinking {
  min-width: 0;
  color: var(--yj-color-chat-timing);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  font-weight: var(--yj-font-weight-regular);
}
.chat-deep-thinking__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-1);
  padding: var(--yj-space-1) 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.chat-deep-thinking__toggle:hover { color: var(--yj-color-text-primary); }
.chat-deep-thinking__toggle .chat-deep-thinking__chevron { color: inherit; opacity: 0; }
.chat-deep-thinking__toggle:hover .chat-deep-thinking__chevron,
.chat-deep-thinking__toggle:focus-visible .chat-deep-thinking__chevron,
.chat-deep-thinking__toggle[aria-expanded="true"] .chat-deep-thinking__chevron { opacity: 1; }
.chat-deep-thinking__toggle:focus-visible,
.chat-deep-thinking__viewport:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-deep-thinking__viewport {
  max-height: var(--yj-layout-chat-thinking-max-height);
  margin-top: var(--yj-space-2);
  padding-inline: var(--yj-space-3) var(--yj-space-2);
  border-inline-start: var(--yj-border-width) dashed var(--yj-color-border-subtle);
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
}
.chat-deep-thinking__viewport::-webkit-scrollbar { width: var(--yj-layout-chat-thinking-scrollbar-width); }
.chat-deep-thinking__viewport::-webkit-scrollbar-track { background: transparent; }
.chat-deep-thinking__viewport::-webkit-scrollbar-thumb {
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-border-strong);
}
.chat-deep-thinking__content { display: grid; gap: var(--yj-space-3); }
.chat-deep-thinking__content :deep(.chat-safe-content) { color: inherit; }
.chat-deep-thinking__notice,
.chat-deep-thinking__empty { margin: 0; }
.chat-deep-thinking__notice { color: var(--yj-color-text-secondary); margin-top: var(--yj-space-1); }
@media (hover: none) {
  .chat-deep-thinking__toggle .chat-deep-thinking__chevron { opacity: 1; }
}
</style>
