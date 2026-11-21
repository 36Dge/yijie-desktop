<script setup lang="ts">
import { computed, inject, ref, useId, watch } from "vue";
import { NTooltip } from "naive-ui";
import { chatTextRevealKey } from "../../composables/useChatTextReveal";
import ChatFileLink from "./ChatFileLink.vue";
import type { MessageFileReference } from "../../domain/message-file-reference";
import { useChatMessageLink } from "../../composables/useChatMessageLink";
import ChatStreamText from "./ChatStreamText.vue";

const props = defineProps<{ text: string; file?: MessageFileReference; destination: string | null; offset: number; streaming: boolean; userUrl?: boolean; standalone?: boolean }>();
const {href, pending, error, open} = useChatMessageLink(() => props.destination, () => !!props.userUrl);
const reveal = inject(chatTextRevealKey, null);
const shown = computed(() => !reveal || reveal.frame.value.cursor > props.offset);
const hovered = ref(false), focused = ref(false);
const tooltipId = `${useId()}-link-address`;
const tooltipVisible = computed(() => Boolean(props.destination) && props.text.trim() !== props.destination &&
  shown.value && (hovered.value || focused.value));
function dismiss() { hovered.value = false; focused.value = false; }
function activateWithEnter(event: KeyboardEvent) {
  if (!props.userUrl || !href.value) return;
  event.preventDefault();
  if (!event.repeat) void open();
}
function activate(event: MouseEvent) {
  if (props.userUrl && event.detail > 0) {
    const selection = (event.currentTarget as HTMLElement).ownerDocument.getSelection();
    if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget as HTMLElement, true)) return;
  }
  void open();
}
watch(() => props.destination, dismiss);
</script>

<template>
  <ChatFileLink v-if="shown && file" :file="file" :standalone="standalone" :streaming="streaming">
    <ChatStreamText :text="text" :streaming="streaming" :offset="offset" />
  </ChatFileLink>
  <NTooltip arrow-point-to-center v-else-if="shown" :show="tooltipVisible" trigger="manual" placement="top">
    <template #trigger>
      <component :is="href ? 'a' : 'span'" class="chat-text-link" :class="{'chat-text-link--enabled': href}"
        :href="userUrl ? undefined : href" :target="href && !userUrl ? '_blank' : undefined" :rel="href && !userUrl ? 'noopener noreferrer' : undefined"
        :role="userUrl && href ? 'link' : undefined" :tabindex="userUrl && href ? 0 : undefined"
        :aria-describedby="tooltipVisible ? tooltipId : undefined" :aria-busy="pending ? 'true' : undefined"
        @mouseenter="hovered = true" @mouseleave="hovered = false" @focus="focused = true" @blur="focused = false"
        @keydown.esc="dismiss" @keydown.enter="activateWithEnter" @click.prevent="activate" @auxclick.middle.prevent="activate">
        <ChatStreamText :text="text" :streaming="streaming" :offset="offset" />
      </component>
    </template>
    <span :id="tooltipId" role="tooltip" class="chat-text-link__address">{{ destination }}</span>
  </NTooltip>
  <span v-if="error" class="chat-text-link__error" role="alert">{{ error }}</span>
</template>

<style scoped>
.chat-text-link { color: inherit; }
.chat-text-link--enabled {
  color: var(--yj-color-chat-link);
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--yj-radius-xs);
}
.chat-text-link--enabled:hover,
.chat-text-link--enabled:focus-visible {
  text-decoration: underline;
  text-underline-offset: var(--yj-space-1);
}
.chat-text-link--enabled:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-text-link__address { white-space: normal; overflow-wrap: anywhere; }
.chat-text-link__error { margin-inline-start: var(--yj-space-2); color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
</style>
