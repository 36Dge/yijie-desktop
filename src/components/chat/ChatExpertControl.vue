<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton } from "naive-ui";
import type { CatalogEntry, ExpertSelection } from "../../domain/experts.generated";
import { expertResourceLabels } from "../../domain/expert-ui";
import ExpertAvatar from "../experts/ExpertAvatar.vue";
import ChatResourcePanel from "./ChatResourcePanel.vue";
import ChatResourceCheck from "./ChatResourceCheck.vue";

const props = defineProps<{
  entries: readonly CatalogEntry[];
  selected: ExpertSelection | null;
  disabled: boolean;
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  executionAvailable: boolean;
  canManage: boolean;
  busyKeys: ReadonlySet<string>;
  operationErrors: Readonly<Record<string, string>>;
  pendingKeys: readonly string[];
}>();
const emit = defineEmits<{ select: [entry: CatalogEntry]; refresh: []; manage: []; close: [] }>();
const query = ref("");
const defaultExpertLimit = 7;
const key = (entry: CatalogEntry) => `${entry.display.expertId}@${entry.display.version}`;
const selected = (entry: CatalogEntry) => props.selected?.expertId === entry.display.expertId && props.selected.version === entry.display.version;
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  if (!search) return props.entries.slice(0, defaultExpertLimit);
  return props.entries.filter(entry => [entry.display.displayName, entry.display.subtitle, entry.description, entry.platform, ...entry.tags].join(" ").toLocaleLowerCase().includes(search));
});
function unavailable(entry: CatalogEntry): boolean {
  return props.disabled || !props.executionAvailable || props.busyKeys.has(key(entry)) || props.pendingKeys.includes(key(entry)) ||
    !["ready", "available"].includes(entry.state) || (entry.state === "available" && !props.canManage);
}
function status(entry: CatalogEntry): string {
  if (props.busyKeys.has(key(entry))) return "正在准备…";
  if (props.operationErrors[key(entry)]) return props.operationErrors[key(entry)]!;
  if (props.pendingKeys.includes(key(entry))) return "状态待确认";
  if (entry.state === "ready") return "";
  return expertResourceLabels[entry.state] ?? "状态待确认";
}
function choose(entry: CatalogEntry): void { if (!unavailable(entry)) emit("select", entry); }
function navigate(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  if (!buttons.length) return;
  event.preventDefault(); event.stopPropagation();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[target]?.focus();
}
function manage(): void { emit("close"); emit("manage"); }
onMounted(() => emit("refresh"));
</script>

<template>
  <ChatResourcePanel class="expert-menu" title="专家" search-label="搜索专家" v-model:query="query" :loading="loading || refreshing" @manage="manage">
    <p v-if="loading" class="expert-menu__notice" role="status">正在读取专家列表…</p>
    <p v-else-if="refreshing" class="expert-menu__refresh-status" role="status">正在更新专家状态…</p>
    <div v-if="error" class="expert-menu__notice" role="alert"><p>{{ error }}</p><NButton size="small" :disabled="loading || refreshing" @click="$emit('refresh')">重试</NButton></div>
    <p v-else-if="!loading && !executionAvailable" class="expert-menu__notice" role="status">专家服务尚未就绪，请前往管理页检查。</p>
    <ul v-if="filtered.length" class="expert-menu__list" role="radiogroup" aria-label="选择当前专家" @keydown="navigate">
      <li v-for="entry in filtered" :key="key(entry)" role="none" :aria-busy="busyKeys.has(key(entry))">
        <button type="button" class="expert-menu__option" role="radio" :aria-checked="selected(entry)" :disabled="unavailable(entry)" :title="entry.description" @click="choose(entry)">
          <ExpertAvatar :expert-id="entry.display.expertId" :icon-key="entry.display.iconKey" compact />
          <span class="expert-menu__copy"><span :title="entry.display.displayName">{{ entry.display.displayName }}</span><span v-if="status(entry)" class="expert-menu__status">{{ status(entry) }}</span></span>
          <ChatResourceCheck :selected="selected(entry)" />
        </button>
      </li>
    </ul>
    <div v-else-if="!loading && !error" class="expert-menu__empty"><span>{{ entries.length ? '没有找到匹配的专家' : '暂无可用专家' }}</span><NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton></div>
  </ChatResourcePanel>
</template>

<style scoped>
.expert-menu { --yj-resource-list-max: var(--yj-layout-skill-list-max); }
.expert-menu :deep(.chat-resource-panel__body) { height: var(--yj-resource-list-max); flex: 1 1 auto; scrollbar-width: thin; scrollbar-gutter: stable; scrollbar-color: var(--yj-color-border-strong) transparent; }
.expert-menu :deep(.chat-resource-panel__body::-webkit-scrollbar) { width: var(--yj-space-1); }
.expert-menu :deep(.chat-resource-panel__body::-webkit-scrollbar-thumb) { border-radius: var(--yj-radius-full); background: var(--yj-color-border-strong); }
.expert-menu__refresh-status { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; margin: -1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
.expert-menu__notice { margin: 0; padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.expert-menu__notice p { margin: 0 0 var(--yj-space-2); }
.expert-menu__list { list-style: none; padding: var(--yj-space-1) var(--yj-space-2); margin: 0; }
.expert-menu__option { display: flex; width: 100%; min-width: 0; align-items: center; gap: var(--yj-space-2); min-height: var(--yj-control-height-lg); padding: var(--yj-space-2); border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-primary); font: inherit; text-align: left; cursor: pointer; }
.expert-menu__option:is(:hover, [aria-checked="true"]):not(:disabled) { background: var(--yj-color-control-hover); }
.expert-menu__option:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(var(--yj-border-width) * -1); }
.expert-menu__option:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.expert-menu__copy { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: var(--yj-space-1); font-size: var(--yj-font-size-body); }
.expert-menu__copy > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.expert-menu__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.expert-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-5) var(--yj-space-3); text-align: center; }
.expert-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
</style>
