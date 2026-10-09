<script setup lang="ts">
import { NButton, NInput } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import { chatSearchTheme } from "../../design/theme/chat-search-theme";
defineProps<{ title: string; query: string; loading?: boolean }>();
defineEmits<{ manage: []; "update:query": [value: string] }>();

</script>

<template>
  <section class="chat-resource-panel" :aria-label="title" :aria-busy="loading">
    <div class="chat-resource-panel__search"><NInput :value="query" size="small" clearable :placeholder="`搜索${title}`" :theme-overrides="chatSearchTheme" :input-props="{ 'aria-label': `搜索已安装的${title}` }" @update:value="$emit('update:query', $event)"><template #prefix><YjIcon name="search" size="sm" tone="muted" /></template></NInput></div>
    <div class="chat-resource-panel__body"><slot /></div>
    <footer><NButton class="chat-resource-panel__manage" type="primary" size="small" :bordered="false" block @click="$emit('manage')">管理{{ title }}</NButton></footer>
  </section>
</template>

<style scoped>
.chat-resource-panel { display: flex; flex-direction: column; min-height: 0; border-radius: inherit; overflow: hidden; }
.chat-resource-panel__search { padding: var(--yj-space-3) var(--yj-space-3) var(--yj-space-2); flex: none; }
.chat-resource-panel__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; max-height: var(--yj-layout-connector-list-max); }
footer { flex: none; padding: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
.chat-resource-panel__manage:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
</style>
