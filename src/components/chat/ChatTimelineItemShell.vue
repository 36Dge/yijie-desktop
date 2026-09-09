<script setup lang="ts">
import { computed, ref, useId } from "vue";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

export type ChatTimelineDisclosureChange = Readonly<{
  itemIdentity: string;
  expanded: boolean;
}>;

const props = withDefaults(defineProps<{
  item: ConversationTimelineItemViewModel;
  label: string;
  statusLabel: string;
  icon: YjIconName;
  statusIcon?: YjIconName;
  statusTone?: "default" | "muted" | "primary" | "success" | "warning" | "error";
  collapsible?: boolean;
  defaultExpanded?: boolean;
}>(), {
  statusTone: "muted",
  collapsible: false,
  defaultExpanded: true,
});

const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
}>();

const slots = defineSlots<{
  default(): unknown;
  actions(): unknown;
}>();

const expanded = ref(props.defaultExpanded);
const id = useId();
const titleId = `${id}-title`;
const statusId = `${id}-status`;
const contentId = `${id}-content`;
const busy = computed(() => props.item.busy === true);
const iconTone = computed(() => props.item.role === "system"
  ? "warning" as const
  : busy.value
    ? "primary" as const
    : "muted" as const);

function toggle(): void {
  if (!props.collapsible) return;
  expanded.value = !expanded.value;
  emit("disclosure-change", Object.freeze({
    itemIdentity: props.item.identity,
    expanded: expanded.value,
  }));
}

</script>

<template>
  <article
    class="chat-timeline-item-shell"
    :class="[
      `chat-timeline-item-shell--${item.role}`,
      `chat-timeline-item-shell--${item.phase === 'active' && !busy ? 'incomplete' : item.phase}`,
    ]"
    :aria-labelledby="titleId"
    :aria-describedby="statusId"
    :aria-busy="busy ? 'true' : 'false'"
  >
    <p v-if="item.availability && item.availability !== 'available'" class="chat-timeline-item-shell__availability" role="note">
      {{ item.availability === "unavailable" ? "此项内容暂不可用" : "此项信息不完整" }}；不代表执行失败。
    </p>
    <header class="chat-timeline-item-shell__header">
      <button
        v-if="collapsible"
        class="chat-timeline-item-shell__disclosure"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="toggle"
      >
        <span class="chat-timeline-item-shell__identity">
          <YjIcon :name="icon" size="sm" :tone="iconTone" />
          <strong :id="titleId">{{ label }}</strong>
        </span>
        <span :id="statusId" class="chat-timeline-item-shell__status">
          <YjIcon
            v-if="statusIcon"
            :name="statusIcon"
            size="xs"
            :tone="statusTone"
          />
          <span>{{ item.activityLabel ?? statusLabel }}</span>
        </span>
        <YjIcon :name="expanded ? 'chevronDown' : 'chevronRight'" size="sm" tone="muted" />
      </button>

      <div v-else class="chat-timeline-item-shell__static-header">
        <span class="chat-timeline-item-shell__identity">
          <YjIcon :name="icon" size="sm" :tone="iconTone" />
          <strong :id="titleId">{{ label }}</strong>
        </span>
        <span :id="statusId" class="chat-timeline-item-shell__status">
          <YjIcon
            v-if="statusIcon"
            :name="statusIcon"
            size="xs"
            :tone="statusTone"
          />
          <span>{{ item.activityLabel ?? statusLabel }}</span>
        </span>
      </div>

      <div
        v-if="slots.actions"
        class="chat-timeline-item-shell__actions"
        role="group"
        :aria-label="`${label}操作`"
      >
        <slot name="actions" />
      </div>
    </header>

    <div
      v-if="!collapsible || expanded"
      :id="contentId"
      class="chat-timeline-item-shell__body"
    >
      <slot />
    </div>
  </article>
</template>

<style scoped>
.chat-timeline-item-shell__availability {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.chat-timeline-item-shell {
  min-width: 0;
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
}

.chat-timeline-item-shell--user {
  margin-inline-start: auto;
  background: var(--yj-color-bg-subtle);
}

.chat-timeline-item-shell--assistant {
  background: transparent;
}

.chat-timeline-item-shell--process,
.chat-timeline-item-shell--system {
  border-color: var(--yj-color-border-subtle);
  background: var(--yj-color-bg-subtle);
}

.chat-timeline-item-shell--active {
  border-color: var(--yj-color-info);
}

.chat-timeline-item-shell__header {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
}

.chat-timeline-item-shell__disclosure,
.chat-timeline-item-shell__static-header {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: 0;
  border-radius: inherit;
  color: inherit;
  background: transparent;
  text-align: left;
}

.chat-timeline-item-shell__static-header {
  grid-template-columns: auto minmax(0, 1fr);
}

.chat-timeline-item-shell__disclosure {
  cursor: pointer;
  transition: background var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-timeline-item-shell__disclosure:hover {
  background: var(--yj-color-control-hover);
}

.chat-timeline-item-shell__disclosure:focus-visible,
.chat-timeline-item-shell__actions :deep(:focus-visible) {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.chat-timeline-item-shell__identity {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-timeline-item-shell__identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-timeline-item-shell__status {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-timeline-item-shell__status span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-timeline-item-shell__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--yj-space-1);
  padding-inline-end: var(--yj-space-2);
}

.chat-timeline-item-shell__body {
  min-width: 0;
  padding: var(--yj-space-2) var(--yj-space-3) var(--yj-space-3);
}

.chat-timeline-item-shell--assistant .chat-timeline-item-shell__body {
  padding-inline: var(--yj-space-0);
}

@media (prefers-reduced-motion: reduce) {
  .chat-timeline-item-shell__disclosure {
    transition: none;
  }
}
</style>
