<script setup lang="ts">
import { NButton, NInput } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import { chatSearchTheme } from "../../design/theme/chat-search-theme";
defineProps<{ title: string; query: string; loading?: boolean; searchLabel?: string }>();
defineEmits<{ manage: []; "update:query": [value: string] }>();

function navigateOptions(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="checkbox"]:not(:disabled)')];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[target]?.focus();
}
</script>

<template>
  <section class="chat-resource-panel" :aria-label="title" :aria-busy="loading">
    <div class="chat-resource-panel__search"><NInput :value="query" size="small" clearable :placeholder="`搜索${title}`" :theme-overrides="chatSearchTheme" :input-props="{ 'aria-label': searchLabel ?? `搜索已安装的${title}` }" @update:value="$emit('update:query', $event)"><template #prefix><YjIcon name="search" size="sm" tone="muted" /></template></NInput></div>
    <div class="chat-resource-panel__body" @keydown="navigateOptions"><slot /></div>
    <footer><NButton class="chat-resource-panel__manage" type="primary" size="small" :bordered="false" block @click="$emit('manage')">管理{{ title }}</NButton></footer>
  </section>
</template>

<style scoped>
.chat-resource-panel { display: flex; flex-direction: column; min-height: 0; border-radius: inherit; overflow: hidden; }
.chat-resource-panel__search { padding: var(--yj-space-3) var(--yj-space-3) var(--yj-space-2); flex: none; }
.chat-resource-panel__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; max-height: var(--yj-resource-list-max, var(--yj-layout-skill-list-max)); scrollbar-width: thin; scrollbar-gutter: stable; scrollbar-color: var(--yj-color-border-strong) transparent; }
.chat-resource-panel__body::-webkit-scrollbar { width: var(--yj-space-1); }
.chat-resource-panel__body::-webkit-scrollbar-thumb { border-radius: var(--yj-radius-full); background: var(--yj-color-border-strong); }
footer { flex: none; padding: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
.chat-resource-panel__manage:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
</style>
