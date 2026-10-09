<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";
import type { ChatSession } from "../../domain/chat-ipc";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  session: ChatSession;
  currentPath: string;
  options: DropdownOption[];
  actionPending: boolean;
}>();

const emit = defineEmits<{
  open: [session: ChatSession];
  action: [session: ChatSession, key: string];
  rememberTrigger: [event: MouseEvent | KeyboardEvent];
}>();

const selected = computed(() => props.currentPath === `/chat/${props.session.sessionId}`);
const hasMenu = computed(() => selected.value && props.options.length > 0);
const menuVisible = ref(false);
const menuX = ref(0);
const menuY = ref(0);

watch([selected, () => props.actionPending, () => props.options.map(option => option.key).join(",")], () => {
  menuVisible.value = false;
});

function openMenu(event: MouseEvent | KeyboardEvent): void {
  if (!hasMenu.value || props.actionPending) return;
  event.preventDefault();
  const trigger = event.currentTarget as HTMLButtonElement;
  const bounds = trigger.getBoundingClientRect();
  menuX.value = event instanceof MouseEvent ? event.clientX : bounds.left;
  menuY.value = event instanceof MouseEvent ? event.clientY : bounds.bottom;
  trigger.focus({ preventScroll: true });
  emit("rememberTrigger", event);
  menuVisible.value = true;
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
  <li class="chat-tree__session">
    <button
      class="chat-tree__session-link"
      :class="{ 'chat-tree__session-link--active': selected }"
      type="button"
      :aria-current="selected ? 'page' : undefined"
      :aria-haspopup="hasMenu ? 'menu' : undefined"
      :aria-expanded="hasMenu ? menuVisible : undefined"
      :aria-keyshortcuts="hasMenu ? 'Shift+F10' : undefined"
      @click="$emit('open', session)"
      @contextmenu="openMenu"
      @keydown="handleKeydown"
    >
      <span class="chat-tree__session-title">{{ session.title }}</span>
    </button>
    <YjIcon v-if="session.pinnedAt !== null" name="pin" size="xs" tone="muted" />
    <n-dropdown
      v-if="hasMenu"
      v-model:show="menuVisible"
      trigger="manual"
      placement="bottom-start"
      :style="{ width: 'min(var(--yj-layout-chat-context-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)))' }"
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
  display: flex;
  min-width: 0;
  min-height: var(--yj-space-8);
  align-items: center;
  gap: var(--yj-space-1);
  padding-left: var(--yj-space-1);
  border-radius: var(--yj-radius-md);
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
.chat-tree__session-link:active { background: var(--yj-color-control-pressed); }
.chat-tree__session-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
