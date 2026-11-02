<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import { hasReadableProcessContent } from "../../domain/conversation-process";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import ChatSafeContent from "./ChatSafeContent.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";
import ChatThinkingIndicator from "./ChatThinkingIndicator.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  item: ConversationTimelineItemViewModel;
  visible: boolean;
  live: boolean;
  thinking?: boolean;
  stateMessage: string | null;
}>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const expanded = ref(false);
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const scrollbar = ref<InstanceType<typeof ChatShortScrollbar> | null>(null);
const contentId = `${useId()}-thinking`;
const hasContent = computed(() => hasReadableProcessContent(props.item));
const contentSections = computed(() => props.item.contentBlocks.map(block => ({ block, blocks: [block] })));
let followLatest = true;
let frame: number | null = null;

function cancelScroll() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}
function pauseFollowing() {
  followLatest = false;
  cancelScroll();
}
function followOutput(finalUpdate = false) {
  if (!expanded.value || !props.visible || !followLatest || scrollbar.value?.isDragging || (!props.live && !finalUpdate)) return;
  cancelScroll();
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!expanded.value || !props.visible || !followLatest || scrollbar.value?.isDragging) return;
    const element = viewport.value;
    if (element) element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    scrollbar.value?.sync();
  });
}
function trackScroll(position: number, maximum: number, previous: number) {
  if (!expanded.value || !props.visible) return;
  if (position < previous) pauseFollowing();
  else if (maximum - position <= 1) followLatest = true;
}
function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && props.live) followLatest = true;
  emit("disclosure-change", { itemIdentity: props.item.identity, expanded: expanded.value });
}
watch(() => props.item.identity, () => { expanded.value = false; followLatest = true; scrollbar.value?.reset(); cancelScroll(); });
watch([() => props.item.contentBlocks, () => props.live, () => props.visible, expanded], (_current, previous) => {
  scrollbar.value?.sync();
  if (!expanded.value || !props.visible) { scrollbar.value?.reset(); cancelScroll(); }
  else followOutput(previous?.[1] === true);
}, { flush: "post" });
onBeforeUnmount(cancelScroll);
</script>

<template>
  <article class="chat-deep-thinking" aria-label="深度思考" :aria-busy="live ? 'true' : 'false'">
    <button class="chat-deep-thinking__toggle" type="button" :aria-expanded="expanded" :aria-controls="contentId"
      :aria-label="`深度思考，${expanded ? '收起' : '展开'}`" @click="toggle">
      <ChatThinkingIndicator label="深度思考" :active="live && thinking === true" :paused="!visible" />
      <YjIcon class="chat-deep-thinking__chevron" :name="expanded ? 'chevronDown' : 'chevronRight'"
        size="xs" :stroke-width="1.5" tone="muted" />
    </button>
    <p v-if="item.availability && item.availability !== 'available'" class="chat-deep-thinking__notice" role="note">
      {{ item.availability === 'unavailable' ? '此项内容暂不可用' : '此项信息不完整' }}；不代表执行失败。
    </p>
    <p v-if="stateMessage" class="chat-deep-thinking__notice" role="note">{{ stateMessage }}</p>
    <div v-show="expanded" class="chat-deep-thinking__scroll-frame">
      <div :id="contentId" ref="viewport" class="chat-deep-thinking__viewport"
        role="region" aria-label="深度思考内容" tabindex="0">
        <div ref="content" class="chat-deep-thinking__content" @chat-content-progress="followOutput(true)">
          <section v-for="{ block, blocks } in contentSections" :key="block.identity"
            :aria-label="block.type === 'text' && block.reasoningSource === 'summary' ? '思考摘要' : '思考原文'">
            <ChatSafeContent :blocks="blocks" mode="rich" :streaming="live" :animate="expanded && visible"
              :link-target="{sessionId: item.threadId, turnId: item.turnId, itemId: item.itemId}" />
          </section>
          <p v-if="!hasContent" class="chat-deep-thinking__empty">{{ stateMessage || (live ? '正在等待思考内容…' : '暂无可显示的思考内容。') }}</p>
        </div>
      </div>
      <ChatShortScrollbar ref="scrollbar" :viewport="viewport" :content="content" :active="expanded && visible"
        :controls="contentId" label="滚动深度思考内容" @scroll="trackScroll" @reading-start="pauseFollowing" @resize="followOutput()" />
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
.chat-deep-thinking__scroll-frame {
  position: relative;
  margin-top: var(--yj-space-2);
}
.chat-deep-thinking__viewport {
  display: grid;
  max-height: var(--yj-layout-chat-thinking-max-height);
  border-inline-start: var(--yj-border-width) dashed var(--yj-color-border-subtle);
  overflow-y: auto;
  overscroll-behavior-y: contain;
  overflow-anchor: none;
  scroll-behavior: auto;
  scrollbar-width: none;
}
.chat-deep-thinking__viewport::-webkit-scrollbar { display: none; }
.chat-deep-thinking__content {
  grid-area: 1 / 1;
  display: grid;
  gap: var(--yj-space-3);
  min-width: 0;
  padding-inline: var(--yj-space-3) calc(var(--yj-space-2) + var(--yj-layout-chat-scrollbar-width));
}
.chat-deep-thinking__content :deep(.chat-safe-content) { color: inherit; }
.chat-deep-thinking__notice,
.chat-deep-thinking__empty { margin: 0; }
.chat-deep-thinking__notice { color: var(--yj-color-text-secondary); margin-top: var(--yj-space-1); }
@media (hover: none) {
  .chat-deep-thinking__toggle .chat-deep-thinking__chevron { opacity: 1; }
}
</style>
