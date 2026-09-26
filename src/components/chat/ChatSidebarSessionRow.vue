<script setup lang="ts">
import { NDropdown, type DropdownOption } from "naive-ui";
import type { ChatSession } from "../../domain/chat-ipc";
import { turnStatusLabel } from "../../domain/chat-ui";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  session: ChatSession;
  currentPath: string;
  options: DropdownOption[];
  actionPending: boolean;
}>();

defineEmits<{
  open: [session: ChatSession];
  action: [session: ChatSession, key: string];
  rememberTrigger: [event: MouseEvent];
}>();
</script>

<template>
  <li class="chat-tree__session">
    <button
      class="chat-tree__session-link"
      :class="{ 'chat-tree__session-link--active': currentPath === `/chat/${session.sessionId}` }"
      type="button"
      :aria-current="currentPath === `/chat/${session.sessionId}` ? 'page' : undefined"
      @click="$emit('open', session)"
    >
      <span class="chat-tree__session-title">{{ session.title }}</span>
      <span v-if="session.latestTurnStatus" class="chat-tree__session-status">
        {{ turnStatusLabel(session.latestTurnStatus) }}
      </span>
    </button>
    <YjIcon v-if="session.pinnedAt !== null" name="pin" size="xs" tone="muted" />
    <n-dropdown
      v-if="currentPath === `/chat/${session.sessionId}` && options.length > 0"
      trigger="click"
      placement="bottom-end"
      :options="options"
      :disabled="actionPending"
      @select="$emit('action', session, String($event))"
    >
      <button
        class="chat-tree__more chat-tree__more--session"
        type="button"
        :aria-label="`任务 ${session.title} 的操作菜单`"
        @click.stop="$emit('rememberTrigger', $event)"
      >
        <YjIcon name="more" size="sm" />
      </button>
    </n-dropdown>
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
.chat-tree__session:hover { background: var(--yj-color-bg-subtle); }

.chat-tree__more {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  flex: 0 0 var(--yj-space-8);
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: auto;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-icon-muted);
  background: transparent;
  opacity: 0;
}
.chat-tree__session:hover .chat-tree__more,
.chat-tree__more:focus-visible { opacity: 1; }
.chat-tree__more:hover { color: var(--yj-color-text-primary); background: var(--yj-color-bg-card); }
.chat-tree__more:focus-visible,
.chat-tree__session-link:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }

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
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-primary);
  background: transparent;
  text-align: left;
}
.chat-tree__session-link--active { color: var(--yj-color-text-primary); background: var(--yj-color-bg-nav);
  box-shadow: inset 3px 0 0 var(--yj-color-brand-primary);
}
.chat-tree__session-link:hover { background: var(--yj-color-control-hover); }
.chat-tree__session-link:active { background: var(--yj-color-control-pressed); }
.chat-tree__session-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-tree__session-status { flex: none; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }

@media (prefers-reduced-motion: reduce) {
  .chat-tree__more { transition: none; }
}
</style>
