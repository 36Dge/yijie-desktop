<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NButton, NSwitch } from "naive-ui";
import ChatResourcePanel from "./ChatResourcePanel.vue";
import { connectorSwitchDisabled, filterConnectors, type ConnectorView } from "../../domain/connector-ui";
import ConnectorIcon from "../connectors/ConnectorIcon.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{
  entries: readonly ConnectorView[];
  selectedIds: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
  selectionAvailable: boolean;
  canManage: boolean;
  loading?: boolean;
  error?: string | null;
}>(), { disabled: false, disabledReason: "任务进行中，暂时不能选择连接器", loading: false, error: null });
const emit = defineEmits<{
  close: [];
  select: [id: string];
  configure: [id: string];
  "enabled-change": [id: string, enabled: boolean];
  manage: [];
  refresh: [];
}>();
const query = ref("");
const panel = ref<HTMLElement | null>(null);
const installed = computed(() => props.entries.filter(entry => entry.installed));
const filtered = computed(() => filterConnectors(installed.value, query.value));
function choose(entry: ConnectorView): void {
  if (props.disabled || entry.busy) return;
  if (props.selectedIds.includes(entry.id) || (props.selectionAvailable && entry.selectable)) emit("select", entry.id);
  else emit("configure", entry.id);
}
function navigate(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...panel.value?.querySelectorAll<HTMLButtonElement>("[data-connector-option]:not(:disabled)") ?? []];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (!buttons.length || index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
  buttons[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
function manage(): void { emit("close"); emit("manage"); }
watch(() => props.disabled, disabled => { if (disabled) emit("close"); });
onMounted(() => { emit("refresh"); });
</script>

<template>
  <ChatResourcePanel title="连接器" v-model:query="query" :loading="loading" @manage="manage">
    <div ref="panel" @keydown="navigate">
      <p v-if="loading" class="connector-menu__notice" role="status">正在读取连接器状态…</p>
      <div v-if="error" class="connector-menu__notice" role="alert"><p>{{ error }}</p><NButton size="small" :disabled="loading" @click="$emit('refresh')">重试</NButton></div>
      <p v-if="!selectionAvailable && !loading && installed.some(entry => entry.enabled)" class="connector-menu__notice">当前无法选用，请前往管理页检查。</p>
      <ul v-if="filtered.length" class="connector-menu__list" aria-label="选择本轮连接器">
        <li v-for="entry in filtered" :key="entry.id" :aria-busy="entry.busy">
          <button type="button" data-connector-option class="connector-menu__option" :disabled="disabled || entry.busy" :aria-pressed="selectedIds.includes(entry.id)" :aria-label="`${entry.selectable && selectionAvailable ? '本轮使用' : '配置'} ${entry.name}，${entry.status.label}`" @click="choose(entry)">
            <ConnectorIcon :asset-id="entry.iconAssetId" size="xs" /><span class="connector-menu__copy"><span :title="entry.name">{{ entry.name }}</span><span v-if="!entry.selectable || entry.busy" class="connector-menu__status" :class="`connector-menu__status--${entry.status.tone}`">{{ entry.status.label }}</span></span><YjIcon v-if="selectedIds.includes(entry.id)" name="permissionCheck" size="sm" />
          </button>
          <NSwitch size="small" :value="entry.enabled" :loading="entry.busy" :disabled="(disabled || connectorSwitchDisabled(entry, canManage))" :aria-disabled="(disabled || connectorSwitchDisabled(entry, canManage))" :aria-label="`${entry.enabled ? '停用' : '启用'} ${entry.name}`" @update:value="$emit('enabled-change', entry.id, $event)" />
        </li>
      </ul>
      <div v-else-if="!loading && !error" class="connector-menu__empty"><span>{{ installed.length ? '没有找到匹配的连接器' : '还没有安装连接器' }}</span><NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton></div>
    </div>
  </ChatResourcePanel>
</template>

<style scoped>
.connector-menu__list { list-style: none; padding: var(--yj-space-1) var(--yj-space-3); margin: 0; overflow-y: auto; overscroll-behavior: contain; min-height: 0; max-height: var(--yj-layout-connector-list-max); }
.connector-menu__list li { display: flex; align-items: center; gap: var(--yj-space-2); }
.connector-menu__option { display: flex; align-items: center; min-width: 0; flex: 1; gap: var(--yj-space-2); min-height: var(--yj-control-height-sm); padding: var(--yj-space-1); border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-text-primary); background: transparent; text-align: left; font: inherit; cursor: pointer; }
.connector-menu__option:hover:not(:disabled), .connector-menu__option[aria-pressed="true"] { background: var(--yj-color-control-hover); }
.connector-menu__option:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.connector-menu__option:disabled { cursor: default; }
.connector-menu__copy { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: var(--yj-space-1); font-size: var(--yj-font-size-body); }
.connector-menu__copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connector-menu__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-menu__status--warning { color: var(--yj-color-semantic-warning-ink); }
.connector-menu__status--error { color: var(--yj-color-semantic-error-ink); }
.connector-menu__notice { margin: 0; padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); flex: none; }
.connector-menu__notice p { margin: 0 0 var(--yj-space-2); }
.connector-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-5) var(--yj-space-3); text-align: center; min-height: 0; overflow-y: auto; }
.connector-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
</style>
