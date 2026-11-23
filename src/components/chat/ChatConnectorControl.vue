<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton } from "naive-ui";
import { filterConnectors, type ConnectorView } from "../../domain/connector-ui";
import ConnectorIcon from "../connectors/ConnectorIcon.vue";
import ChatResourceOption from "./ChatResourceOption.vue";
import ChatResourcePanel from "./ChatResourcePanel.vue";

const props = defineProps<{
  entries: readonly ConnectorView[];
  selectedIds: readonly string[];
  disabled?: boolean;
  selectionAvailable: boolean;
  loading?: boolean;
  error?: string | null;
  operationErrors?: Readonly<Record<string, string>>;
}>();
const emit = defineEmits<{
  close: [reason?: "selection"];
  "selection-change": [id: string, selected: boolean];
  manage: [];
  refresh: [];
  retry: [id: string];
}>();

const query = ref("");
const enabled = computed(() => props.entries.filter(entry => entry.installed && entry.enabled));
const filtered = computed(() => filterConnectors(enabled.value, query.value));
const initialLoading = computed(() => props.loading && !props.entries.length);

function selected(entry: ConnectorView): boolean {
  return props.selectedIds.includes(entry.id);
}
function selectionDisabled(entry: ConnectorView): boolean {
  return Boolean(props.disabled) || (!selected(entry) && (!props.selectionAvailable || !entry.selectable));
}
function choose(entry: ConnectorView): void {
  if (selectionDisabled(entry)) return;
  emit("selection-change", entry.id, !selected(entry));
  emit("close", "selection");
}
function manage(): void { emit("close"); emit("manage"); }
watch(() => props.disabled, disabled => { if (disabled) emit("close"); });
onMounted(() => emit("refresh"));
</script>

<template>
  <ChatResourcePanel title="连接器" v-model:query="query" :loading="loading" search-label="搜索已启用的连接器" @manage="manage">
    <p v-if="initialLoading" class="connector-menu__notice" role="status">正在读取连接器状态…</p>
    <div v-if="error" class="connector-menu__notice" role="alert">
      <p>{{ error }}</p>
      <NButton size="small" :disabled="loading" @click="$emit('refresh')">重试</NButton>
    </div>
    <p v-else-if="!selectionAvailable && !loading && enabled.length" class="connector-menu__notice" role="status">当前无法选用，请前往管理页检查。</p>
    <ul v-if="filtered.length" class="connector-menu__list" aria-label="已启用的连接器">
      <li v-for="entry in filtered" :key="entry.id" :aria-busy="entry.busy">
        <ChatResourceOption :name="entry.name" :selected="selected(entry)" :disabled="selectionDisabled(entry)" @click="choose(entry)">
          <template #icon><ConnectorIcon :asset-id="entry.iconAssetId" size="sm" /></template>
          <span v-if="entry.busy || (selectionAvailable && !entry.selectable)" class="connector-menu__status">{{ entry.status.label }}</span>
        </ChatResourceOption>
        <div v-if="operationErrors?.[entry.id]" class="connector-menu__operation-error" role="alert">
          <p>{{ operationErrors[entry.id] }}</p>
          <NButton v-if="entry.actions.includes('retry')" size="tiny" :disabled="disabled" @click="$emit('retry', entry.id)">重新确认状态</NButton>
        </div>
      </li>
    </ul>
    <div v-else-if="!initialLoading && !error" class="connector-menu__empty">
      <span>{{ enabled.length ? '没有找到匹配的连接器' : '暂无已安装且启用的连接器' }}</span>
      <NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton>
    </div>
  </ChatResourcePanel>
</template>

<style scoped>
.connector-menu__list { list-style: none; padding: var(--yj-space-1) var(--yj-space-2); margin: 0; }
.connector-menu__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.connector-menu__operation-error { padding: 0 var(--yj-space-2) var(--yj-space-2); color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); overflow-wrap: anywhere; }
.connector-menu__operation-error p { margin: 0 0 var(--yj-space-1); }
.connector-menu__notice { margin: 0; padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-menu__notice p { margin: 0 0 var(--yj-space-2); }
.connector-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-5) var(--yj-space-3); text-align: center; }
.connector-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
</style>
