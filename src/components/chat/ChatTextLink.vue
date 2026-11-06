<script setup lang="ts">
import { computed, inject, ref, useId, watch } from "vue";
import { NTooltip } from "naive-ui";
import { chatTextRevealKey } from "../../composables/useChatTextReveal";
import { isSidebarFile } from "../../domain/conversation-file-preview";
import ChatFileLink from "./ChatFileLink.vue";
import type { MessageFileReference } from "../../domain/message-file-reference";
import { messageFileActionKey, messageFileLocationKey, messageFileWorkspaceKey, messageLinkTargetKey, useChatMessageLink } from "../../composables/useChatMessageLink";
import ChatStreamText from "./ChatStreamText.vue";

const props = defineProps<{ text: string; file?: MessageFileReference; destination: string | null; offset: number; streaming: boolean }>();
const {href, pending, error, open} = useChatMessageLink(() => props.destination);
const fileAction = inject(messageFileActionKey, null);
const target = inject(messageLinkTargetKey, () => undefined);
function openFile() {
  const scope = target();
  if (scope && props.file) fileAction?.value?.(scope, props.file);
}
const fileLocation = inject(messageFileLocationKey, null);
const workspace = inject(messageFileWorkspaceKey, null);
const absoluteHint = ref("");
const fileHint = computed(() => {
  const path = props.file?.path ?? "";
  return workspace?.value && !path.startsWith("/") ? workspace.value + "/" + path : absoluteHint.value || path;
});
let locationRequest: Promise<void> | undefined;
let generation = 0;
watch([() => props.file?.path, target, () => fileLocation?.value], () => {
  generation++;
  locationRequest = undefined;
  absoluteHint.value = "";
}, { flush: "sync" });
function locateFile() {
  const scope = target(), file = props.file, locate = fileLocation?.value;
  if (!scope || !file || file.path.startsWith("/") || workspace?.value || !locate || absoluteHint.value || locationRequest) return;
  const request = generation;
  locationRequest = locate(scope, file).then(path => {
    if (request === generation) absoluteHint.value = path;
  }).catch(() => {}).finally(() => { if (request === generation) locationRequest = undefined; });
}
const reveal = inject(chatTextRevealKey, null);
const shown = computed(() => !reveal || reveal.frame.value.cursor > props.offset);
const hovered = ref(false), focused = ref(false);
const tooltipId = `${useId()}-link-address`;
const tooltipVisible = computed(() => Boolean(props.destination) && shown.value && (hovered.value || focused.value));
function dismiss() { hovered.value = false; focused.value = false; }
watch(() => props.destination, dismiss);
</script>

<template>
  <ChatFileLink v-if="shown && file" :disabled="!fileAction || !target()" :tooltip="fileHint" @hint="locateFile" :controls="isSidebarFile('', file.name) ? 'conversation-file-preview' : 'conversation-media-preview'" @open="openFile">
    <ChatStreamText :text="text" :streaming="streaming" :offset="offset" />
  </ChatFileLink>
  <NTooltip arrow-point-to-center v-else-if="shown" :show="tooltipVisible" trigger="manual" placement="top">
    <template #trigger>
      <component :is="href ? 'a' : 'span'" class="chat-text-link" :class="{'chat-text-link--enabled': href}"
        :href="href" :target="href ? '_blank' : undefined" :rel="href ? 'noopener noreferrer' : undefined"
        :aria-describedby="tooltipVisible ? tooltipId : undefined" :aria-busy="pending ? 'true' : undefined"
        @mouseenter="hovered = true" @mouseleave="hovered = false" @focus="focused = true" @blur="focused = false"
        @keydown.esc="dismiss" @click.prevent="open" @auxclick.middle.prevent="open">
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
