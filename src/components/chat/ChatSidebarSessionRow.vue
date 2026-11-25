<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";
import type { ChatSession } from "../../domain/chat-ipc";
import { isChatSessionRunning, scheduledSidebarLabels, type ScheduledSidebarState } from "../../domain/chat-sidebar-history";
import YjIcon from "../yijie/YjIcon.vue";
import ChatSidebarSessionTitle from "./ChatSidebarSessionTitle.vue";

const props = defineProps<{
  session: ChatSession;
  completionUnread: boolean;
  scheduledState?: ScheduledSidebarState;
  currentPath: string;
  options: DropdownOption[];
  actionPending: boolean;
  activeMenuId: string | null;
  menuTarget: HTMLElement | false;
}>();

const emit = defineEmits<{
  open: [session: ChatSession];
  action: [session: ChatSession, key: string];
  rememberTrigger: [event: MouseEvent | KeyboardEvent];
}>();

const selected = computed(() => props.currentPath === `/chat/${props.session.sessionId}`);
const status = computed(() => {
  if (props.scheduledState) {
    if (props.scheduledState === "running") return "running";
    return props.scheduledState === "completed" && props.completionUnread ? "completed" : null;
  }
  if (isChatSessionRunning(props.session.latestTurnStatus)) return "running";
  return props.completionUnread && props.session.latestTurnStatus === "completed" ? "completed" : null;
});
const description = computed(() => props.scheduledState ? `定时任务${scheduledSidebarLabels[props.scheduledState]}${status.value === "completed" ? "，尚未查看" : ""}`
  : status.value === "running" ? "任务执行中" : status.value === "completed" ? "任务已完成，尚未查看" : "");
const statusDescriptionId = useId();
const hasMenu = computed(() => props.options.length > 0);
const trigger = ref<HTMLButtonElement | null>(null);
const menuVisible = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const titleHovered = ref(false);
const titleFocused = ref(false);

function focusTitle(event: FocusEvent): void {
  titleFocused.value = (event.currentTarget as HTMLElement).matches(":focus-visible");
}

watch([() => props.currentPath, () => props.actionPending, () => props.options.map(option => option.key).join(",")], () => {
  menuVisible.value = false;
});
watch(() => props.activeMenuId, id => { if (id !== props.session.sessionId) menuVisible.value = false; });

function openMenu(event: MouseEvent | KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (!hasMenu.value || props.actionPending || !trigger.value) return;
  const selection = window.getSelection();
  if (selection && trigger.value.contains(selection.anchorNode) && trigger.value.contains(selection.focusNode)) selection.removeAllRanges();
  const bounds = trigger.value.getBoundingClientRect();
  menuX.value = event instanceof MouseEvent ? event.clientX : bounds.left;
  menuY.value = event instanceof MouseEvent ? event.clientY : bounds.bottom;
  trigger.value.focus({ preventScroll: true });
  emit("rememberTrigger", event);
  menuVisible.value = true;
}

function openSession(event: MouseEvent): void {
  // macOS Control-click is a context-menu gesture, not a task navigation.
  if (event.button !== 0 || event.ctrlKey) return;
  emit("open", props.session);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    openMenu(event);
  } else if (menuVisible.value) {
    // Let Naive UI handle menu navigation without activating the session button.
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
    if (event.key === "Tab") menuVisible.value = false;
  }
}

function selectAction(key: string | number): void {
  menuVisible.value = false;
  if (hasMenu.value && !props.actionPending) emit("action", props.session, String(key));
}
</script>

<template>
  <li class="chat-tree__session" @contextmenu="openMenu" @selectstart.prevent @mouseenter="titleHovered = true" @mouseleave="titleHovered = false">
    <button
      ref="trigger"
      class="chat-tree__session-link"
      :class="{ 'chat-tree__session-link--active': selected }"
      type="button"
      :aria-current="selected ? 'page' : undefined"
      :aria-describedby="description ? statusDescriptionId : undefined"
      :aria-haspopup="hasMenu ? 'menu' : undefined"
      :aria-expanded="hasMenu ? menuVisible : undefined"
      :aria-keyshortcuts="hasMenu ? 'Shift+F10' : undefined"
      @click="openSession"
      @keydown="handleKeydown"
      @focus="focusTitle"
      @blur="titleFocused = false"
      @mousedown="titleFocused = false"
    >
      <ChatSidebarSessionTitle class="chat-tree__session-title" :text="session.title" :active="(titleHovered || titleFocused) && !menuVisible && !actionPending" />
      <span class="chat-tree__session-status" aria-hidden="true">
        <!-- At 16px, the 1.2px filled spokes plus the 0.5px stroke are 1.7px wide. -->
        <YjIcon
          v-if="status === 'running'"
          class="chat-tree__session-running"
          name="taskRunning"
          size="sm"
          stroke="currentColor"
          :stroke-width="0.5"
        />
        <span v-else-if="status === 'completed'" class="chat-tree__session-completed" />
      </span>
    </button>
    <span v-if="description" :id="statusDescriptionId" class="chat-tree__session-description">{{ description }}</span>
    <YjIcon v-if="session.pinnedAt !== null" name="pin" size="xs" tone="muted" />
    <n-dropdown
      v-if="hasMenu"
      v-model:show="menuVisible"
      trigger="manual"
      placement="bottom-start"
      :to="menuTarget"
      :style="{ zoom: 'var(--yj-ui-scale, 1)', width: 'min(var(--yj-layout-chat-context-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)))' }"
      :x="menuX"
      :y="menuY"
      :options="options"
      :disabled="actionPending"
      @clickoutside="menuVisible = false"
      @select="selectAction"
    />
  </li>
</template>

<style scoped>
.chat-tree__session {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  align-items: center;
  gap: var(--yj-space-1);
  padding-left: var(--yj-space-1);
  border-radius: var(--yj-radius-md);
  -webkit-user-select: none;
  user-select: none;
}

.chat-tree__session-link:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: calc(var(--yj-space-1) * -1);
}

.chat-tree__session-link {
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) var(--yj-space-2);
  border: 0;
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: transparent;
  text-align: left;
}
.chat-tree__session-link--active { color: var(--yj-color-text-primary); background: var(--yj-color-control-hover); }
.chat-tree__session-link:hover { background: var(--yj-color-control-hover); }
.chat-tree__session-title { min-width: 0; flex: 1; }

.chat-tree__session-status {
  display: flex;
  width: var(--yj-space-4);
  height: var(--yj-space-4);
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--yj-color-chat-task-indicator);
}

.chat-tree__session-status .chat-tree__session-running { color: inherit; }
@media (prefers-reduced-motion: no-preference) {
  /* Rotate the SVG artwork so WebKit repaints the spokes inside the stationary status slot. */
  .chat-tree__session-running :deep(use) {
    transform-box: view-box;
    transform-origin: center;
    animation: chat-task-spin var(--yj-motion-chat-task-spin) linear infinite;
  }
}
@keyframes chat-task-spin { to { transform: rotate(360deg); } }

.chat-tree__session-completed {
  display: block;
  width: var(--yj-size-chat-completion-dot);
  height: var(--yj-size-chat-completion-dot);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-chat-completion-dot);
}

.chat-tree__session-description {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip: rect(0 0 0 0);
  overflow: hidden;
  white-space: nowrap;
}
</style>
