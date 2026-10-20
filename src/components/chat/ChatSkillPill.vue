<script setup lang="ts">
import type { SelectedChatSkill } from "../../domain/chat-skills";
import { skillCardArtwork } from "../../icons/skill-artwork";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  entry: SelectedChatSkill & { unavailableReason?: string | null };
  removable?: boolean;
  disabled?: boolean;
}>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <component
    :is="removable ? 'button' : 'span'"
    class="chat-skill-pill"
    :class="{ 'chat-skill-pill--removable': removable, 'chat-skill-pill--unavailable': entry.unavailableReason }"
    :type="removable ? 'button' : undefined"
    :disabled="removable ? disabled : undefined"
    :aria-label="removable ? `移除技能 ${entry.displayName}` : undefined"
    :title="removable ? `${entry.displayName}${entry.unavailableReason ? `：${entry.unavailableReason}` : ''}；点击移除` : entry.displayName"
    @click="removable && !disabled && $emit('remove', entry.id)"
  >
    <span class="chat-skill-pill__icon" aria-hidden="true">
      <img :src="skillCardArtwork(entry)" alt="" draggable="false" />
      <YjIcon v-if="removable" name="dismiss" size="sm" />
    </span>
    <span class="chat-skill-pill__name">{{ entry.displayName }}</span>
    <YjIcon v-if="entry.unavailableReason" name="warning" size="sm" />
  </component>
</template>

<style scoped>
.chat-skill-pill { display: inline-flex; box-sizing: border-box; max-width: min(100%, var(--yj-layout-connector-chip-max)); min-width: 0; align-items: center; vertical-align: middle; gap: var(--yj-space-1); height: var(--yj-chat-skill-chip-height); padding: 0 var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-skill-pill-border); border-radius: var(--yj-radius-full); background: var(--yj-color-skill-pill-message-bg); color: var(--yj-color-text-primary); font: inherit; font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-medium); line-height: var(--yj-line-height-caption); }
.chat-skill-pill--removable { background: var(--yj-color-skill-pill-bg); cursor: pointer; transition: background-color var(--yj-motion-fast) var(--yj-ease-standard); }
.chat-skill-pill__icon { display: inline-grid; flex: none; width: var(--yj-space-4); height: var(--yj-space-4); align-items: center; justify-items: center; }
.chat-skill-pill__icon > * { grid-area: 1 / 1; }
.chat-skill-pill__icon img { display: block; width: var(--yj-space-4); height: var(--yj-space-4); border-radius: var(--yj-radius-xs); }
.chat-skill-pill--removable .chat-skill-pill__icon > :last-child { visibility: hidden; }
.chat-skill-pill__name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chat-skill-pill--removable:is(:hover, :focus-visible):not(:disabled) { background: var(--yj-color-skill-pill-hover); }
.chat-skill-pill--removable:is(:hover, :focus-visible):not(:disabled) .chat-skill-pill__icon > :first-child { visibility: hidden; }
.chat-skill-pill--removable:is(:hover, :focus-visible):not(:disabled) .chat-skill-pill__icon > :last-child { visibility: visible; }
.chat-skill-pill:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
.chat-skill-pill--unavailable { color: var(--yj-color-semantic-warning-ink); background: var(--yj-color-warning-soft); }
.chat-skill-pill:disabled { color: var(--yj-color-text-disabled); cursor: default; }
@media (hover: none) { .chat-skill-pill--removable .chat-skill-pill__icon > :first-child { visibility: hidden; } .chat-skill-pill--removable .chat-skill-pill__icon > :last-child { visibility: visible; } }
@media (prefers-reduced-motion: reduce) { .chat-skill-pill--removable { transition: none; } }
</style>
