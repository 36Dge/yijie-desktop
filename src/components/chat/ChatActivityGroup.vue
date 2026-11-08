<script setup lang="ts">
import { computed, inject, ref, useId } from "vue";
import type { ConversationActivityGroup } from "../../domain/conversation-activity-presentation";
import { summarizeActivity } from "../../domain/conversation-activity-summary";
import { chatTracePresentationKey, createChatTracePresentationStore } from "../../stores/chat-trace-presentation.store";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";
import YjIcon from "../yijie/YjIcon.vue";
import ChatThinkingIndicator from "./ChatThinkingIndicator.vue";
import { useActivitySummary } from "./useActivitySummary";

const props = defineProps<{ group: ConversationActivityGroup; live: boolean; visible: boolean }>();
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const choices = inject(chatTracePresentationKey, null) ?? createChatTracePresentationStore();
const expanded = computed(() => choices.get(props.group.identity, false));
const singleton = computed(() => !props.live && props.group.state.kind === "summary" && props.group.entries.length === 1 &&
  props.group.entries[0]!.item.domainStatus === "completed" && !props.group.entries[0]!.item.busy && !choices.has(props.group.identity));
const summary = computed(() => summarizeActivity(props.group, props.live));
const header = useActivitySummary(summary, () => props.group.identity);
const contentId = `${useId()}-activity`;
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
function toggle() {
  choices.set(props.group.identity, !expanded.value);
  emit("disclosure-change", {itemIdentity: props.group.identity, expanded: expanded.value});
}
</script>

<template>
  <section class="chat-activity-group" aria-label="连续活动">
    <div v-if="singleton" :data-activity-item="group.entries[0]!.identity" :data-native-item="group.entries[0]!.item.identity" :class="`chat-turn-group__item--${group.entries[0]!.item.presentation}`">
      <slot name="item" :item="group.entries[0]!.item" :entry="group.entries[0]!" :visible="visible" />
    </div>
    <template v-else>
    <button class="chat-activity-group__toggle" type="button" :aria-expanded="expanded" :aria-controls="contentId" @click="toggle">
      <YjIcon :name="header.icon" size="sm" tone="muted" />
      <span class="chat-activity-group__title" ><ChatThinkingIndicator :label="header.title" :active="header.state !== 'summary' && live" :paused="!visible" /></span>
      <span v-if="summary.counts" class="chat-activity-group__counts">{{ summary.counts }}</span>
      <YjIcon :name="expanded ? 'chevronDown' : 'chevronRight'" size="xs" tone="muted" />
    </button>
    <div v-show="expanded" :id="contentId" class="chat-activity-group__frame">
      <div ref="viewport" class="chat-activity-group__viewport" tabindex="0" aria-label="活动记录">
        <ol ref="content" class="chat-activity-group__items">
          <li v-for="entry in group.entries" :key="entry.identity" :data-activity-item="entry.identity" :data-native-item="entry.item.identity" :class="`chat-turn-group__item--${entry.item.presentation}`">
            <slot name="item" :item="entry.item" :entry="entry" :visible="visible && expanded" />
          </li>
        </ol>
      </div>
      <ChatShortScrollbar :viewport="viewport" :content="content" :active="visible && expanded" :controls="contentId" label="滚动活动记录" />
    </div>
    </template>
  </section>
</template>

<style scoped>
.chat-activity-group { min-width: 0; color: var(--yj-color-chat-timing); }
.chat-activity-group__toggle { display: flex; align-items: center; gap: var(--yj-space-2); max-width: 100%; border: 0; padding: var(--yj-space-1) 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: var(--yj-radius-sm); }
.chat-activity-group__toggle:hover { color: var(--yj-color-text-primary); }
.chat-activity-group__toggle:focus-visible, .chat-activity-group__viewport:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-activity-group__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-activity-group__title :deep(.chat-thinking) { display: inline; }
.chat-activity-group__counts { flex: 0 0 auto; font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.chat-activity-group__frame { position: relative; padding: var(--yj-space-3); margin-top: var(--yj-space-2); border-radius: var(--yj-radius-lg); background: var(--yj-color-chat-search-sources-bg); }
.chat-activity-group__viewport { display: grid; max-height: var(--yj-layout-chat-activity-max-height); overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; }
.chat-activity-group__viewport::-webkit-scrollbar { display: none; }
.chat-activity-group__items { grid-area: 1 / 1; min-width: 0; list-style: none; margin: 0; padding: 0 var(--yj-space-3) 0 0; display: grid; gap: var(--yj-space-3); }
</style>
