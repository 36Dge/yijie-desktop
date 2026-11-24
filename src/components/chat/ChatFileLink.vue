<script setup lang="ts">
import { computed, inject } from "vue";
import { messageFileActionKey, messageLinkTargetKey } from "../../composables/useChatMessageLink";
import { isSidebarFile } from "../../domain/conversation-file-preview";
import type { LocatedMessageFile } from "../../domain/message-file-reference";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

const props = defineProps<{ file: LocatedMessageFile }>();
const target = inject(messageLinkTargetKey, () => undefined);
const preview = inject(messageFileActionKey, null);
const sidebarFile = computed(() => isSidebarFile("", props.file.name));
const disabled = computed(() => !preview?.value || !target());
let pointerStart: { x: number; y: number } | null = null;

function rememberPointer(event: PointerEvent) {
  pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
}

function open(event: MouseEvent) {
  const start = pointerStart;
  pointerStart = null;
  const scope = target();
  if (disabled.value || !scope) return;
  const link = event.currentTarget as HTMLElement;
  const selection = link.ownerDocument.getSelection();
  const dragged = start && (Math.abs(event.clientX - start.x) > 3 || Math.abs(event.clientY - start.y) > 3);
  // A drag selection also produces a click; keep it available for copying.
  if (event.detail > 0 && dragged && selection && !selection.isCollapsed) {
    for (let index = 0; index < selection.rangeCount; index++) {
      if (selection.getRangeAt(index).intersectsNode(link)) return;
    }
  }
  preview?.value?.(scope, props.file);
}
</script>

<template>
  <YjTooltip :text="file.location">
    <button type="button" role="link" class="chat-file-link" :aria-controls="disabled ? undefined : sidebarFile ? 'conversation-file-preview' : 'conversation-media-preview'" :aria-disabled="disabled || undefined" @pointerdown="rememberPointer" @pointercancel="pointerStart = null" @click="open">
      <YjIcon name="file" size="xs" :stroke-width="1.5" /><span><slot /></span>
    </button>
  </YjTooltip>
</template>

<style scoped>
.chat-file-link {
  display: inline; max-width: 100%; padding: 0; border: 0; border-radius: var(--yj-radius-xs);
  background: transparent; color: var(--yj-color-chat-file-link); font: inherit;
  text-align: start; overflow-wrap: anywhere; cursor: pointer; -webkit-user-select: text; user-select: text;
}
.chat-file-link :deep(.yj-icon) { margin-inline-end: var(--yj-space-1); color: inherit; vertical-align: -0.12em; }
.chat-file-link[aria-disabled="true"] { color: var(--yj-color-text-secondary); cursor: default; }
.chat-file-link:not([aria-disabled]):hover > span, .chat-file-link:focus-visible > span {
  text-decoration: underline dotted; text-underline-offset: var(--yj-space-1);
}
.chat-file-link:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
