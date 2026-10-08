<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { NButton, NInput, NPopover, NSwitch } from "naive-ui";
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
  select: [id: string];
  configure: [id: string];
  "enabled-change": [id: string, enabled: boolean];
  manage: [];
  refresh: [];
}>();
const open = ref(false), query = ref("");
const trigger = ref<HTMLButtonElement | null>(null), panel = ref<HTMLElement | null>(null), overlay = ref<HTMLElement | null>(null);
const titleId = useId();
const panelHeight = ref(0), panelShift = ref(0), panelShiftX = ref(0);
const placement = ref<"top-start" | "bottom-start">("top-start");
const installed = computed(() => props.entries.filter(entry => entry.installed));
const filtered = computed(() => filterConnectors(installed.value, query.value));
function measureAvailableSpace(): void {
  if (!open.value || !trigger.value) return;
  const style = getComputedStyle(document.documentElement);
  const scale = Number.parseFloat(style.getPropertyValue("--yj-ui-scale")) || 1;
  const inset = Number.parseFloat(style.getPropertyValue("--yj-space-4")) || 16;
  const preferred = Number.parseFloat(style.getPropertyValue("--yj-layout-connector-list-max")) || 320;
  const preferredWidth = Number.parseFloat(style.getPropertyValue("--yj-layout-connector-menu-width")) || 400;
  const bounds = trigger.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth / scale, menuWidth = Math.min(preferredWidth, viewportWidth - inset * 2);
  panelShiftX.value = Math.max(inset - bounds.left / scale, Math.min(0, viewportWidth - inset - bounds.left / scale - menuWidth));
  const above = bounds.top / scale - inset, below = (window.innerHeight - bounds.bottom) / scale - inset;
  placement.value = above >= below ? "top-start" : "bottom-start";
  const available = Math.max(above, below);
  panelHeight.value = Math.max(0, Math.floor(available < preferred ? window.innerHeight / scale - inset * 2 : available));
  panelShift.value = Math.max(0, panelHeight.value - available) * (placement.value === "top-start" ? 1 : -1);
}
async function setOpen(value: boolean): Promise<void> {
  if (value && props.disabled) return;
  open.value = value;
  if (value) { measureAvailableSpace(); emit("refresh"); await nextTick(); panel.value?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }
  else { await nextTick(); if (!props.disabled) trigger.value?.focus({ preventScroll: true }); }
}
function choose(entry: ConnectorView): void {
  if (entry.busy) return;
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
async function manage(): Promise<void> { open.value = false; emit("manage"); }
watch(() => props.disabled, disabled => { if (disabled) void setOpen(false); });
onMounted(() => { window.addEventListener("resize", measureAvailableSpace); window.addEventListener("scroll", measureAvailableSpace, true); });
onBeforeUnmount(() => { window.removeEventListener("resize", measureAvailableSpace); window.removeEventListener("scroll", measureAvailableSpace, true); });
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover :show="open" :to="overlay ?? false" trigger="click" :placement="placement" :flip="false" :disabled="disabled" :show-arrow="false" raw @update:show="setOpen">
    <template #trigger>
      <button ref="trigger" class="connector-trigger yj-control" type="button" :disabled="disabled" :aria-label="selectedIds.length ? `连接器，本轮已选择 ${selectedIds.length} 个` : '连接器'" :title="disabled ? disabledReason : '选择本轮使用的连接器'" aria-haspopup="dialog" :aria-expanded="open" @keydown.down.prevent="setOpen(true)" @keydown.esc.stop.prevent="setOpen(false)">
        <YjIcon name="connector" size="sm" :stroke-width="1.5" /><span class="connector-trigger__label">连接器</span><span v-if="selectedIds.length" class="connector-trigger__count">{{ selectedIds.length }}</span>
      </button>
    </template>
    <div ref="panel" class="connector-menu chat-control-menu" role="dialog" :aria-labelledby="titleId" :aria-busy="loading" :style="{ '--connector-menu-available-height': `${panelHeight}px`, '--connector-menu-offset': `${panelShift}px`, '--connector-menu-offset-x': `${panelShiftX}px` }" @keydown.esc.stop.prevent="setOpen(false)" @keydown="navigate">
      <header><h2 :id="titleId">连接器</h2><span>{{ installed.length }} 个已安装</span><button type="button" class="connector-menu__close" aria-label="关闭连接器菜单" @click="setOpen(false)"><YjIcon name="dismiss" size="sm" /></button></header>
      <div v-if="installed.length" class="connector-menu__search"><NInput v-model:value="query" clearable placeholder="搜索已安装的连接器" :input-props="{ 'aria-label': '搜索已安装的连接器' }"><template #prefix><YjIcon name="search" size="sm" tone="muted" /></template></NInput></div>
      <p v-if="loading" class="connector-menu__notice" role="status">正在读取连接器状态…</p>
      <div v-if="error" class="connector-menu__notice" role="alert"><p>{{ error }}</p><NButton size="small" :disabled="loading" @click="$emit('refresh')">重试</NButton></div>
      <p v-if="!selectionAvailable && !loading && installed.length" class="connector-menu__notice">{{ installed.some(entry => entry.enabled) ? '当前暂时无法选用连接器，请刷新状态或前往管理页检查。' : '启用可用的连接器后，即可在这里选择本轮使用。' }}</p>
      <ul v-if="filtered.length" class="connector-menu__list" aria-label="选择本轮连接器">
        <li v-for="entry in filtered" :key="entry.id" :aria-busy="entry.busy">
          <button type="button" data-connector-option class="connector-menu__option" :disabled="entry.busy" :aria-pressed="selectedIds.includes(entry.id)" :aria-label="`${entry.selectable && selectionAvailable ? '本轮使用' : '配置'} ${entry.name}，${entry.status.label}`" @click="choose(entry)">
            <ConnectorIcon :asset-id="entry.iconAssetId" size="sm" /><span class="connector-menu__copy"><span :title="entry.name">{{ entry.name }}</span><span v-if="!entry.selectable || entry.busy" class="connector-menu__status" :class="`connector-menu__status--${entry.status.tone}`">{{ entry.status.label }}</span></span><YjIcon v-if="selectedIds.includes(entry.id)" name="permissionCheck" size="sm" />
          </button>
          <NSwitch :value="entry.enabled" :loading="entry.busy" :disabled="connectorSwitchDisabled(entry, canManage)" :aria-disabled="connectorSwitchDisabled(entry, canManage)" :aria-label="`${entry.enabled ? '停用' : '启用'} ${entry.name}`" @update:value="$emit('enabled-change', entry.id, $event)" />
        </li>
      </ul>
      <div v-else-if="!loading && !error" class="connector-menu__empty"><YjIcon :name="installed.length ? 'search' : 'connector'" size="xl" tone="muted" /><strong>{{ installed.length ? '没有找到匹配的连接器' : '还没有安装连接器' }}</strong><span>{{ installed.length ? '试试其他名称。' : '前往市场安装并启用后，即可在对话中选择。' }}</span><NButton v-if="query" quaternary @click="query = ''">清空搜索</NButton></div>
      <footer><NButton block @click="manage">管理连接器</NButton></footer>
    </div>
  </NPopover>
</template>

<style scoped>
.connector-trigger { flex: none; border: 0; border-radius: var(--yj-radius-full); color: var(--yj-color-text-primary); background: transparent; }
.connector-trigger:hover:not(:disabled), .connector-trigger[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.connector-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.connector-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.connector-trigger:focus-visible, .connector-menu__close:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.connector-trigger > .yj-icon { color: inherit; }
.connector-trigger__count { min-width: var(--yj-space-4); border-radius: var(--yj-radius-full); text-align: center; font-size: var(--yj-font-size-caption); background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); }
.connector-menu { display: flex; flex-direction: column; width: min(var(--yj-layout-connector-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: min(var(--connector-menu-available-height), calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8))); padding: 0; overflow: hidden; translate: var(--connector-menu-offset-x) var(--connector-menu-offset); }
.connector-menu header { display: flex; align-items: center; gap: var(--yj-space-2); flex: none; padding: var(--yj-space-3) var(--yj-space-4); }
.connector-menu h2 { flex: 1; margin: 0; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); }
.connector-menu header > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-menu__close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-6); height: var(--yj-space-6); padding: 0; border: 0; border-radius: var(--yj-radius-sm); background: transparent; color: var(--yj-color-text-primary); }
.connector-menu__close:hover { background: var(--yj-color-control-hover); }
.connector-menu__search { padding: 0 var(--yj-space-4) var(--yj-space-2); flex: none; }
.connector-menu__list { list-style: none; padding: 0 var(--yj-space-3); margin: 0; overflow-y: auto; overscroll-behavior: contain; min-height: 0; max-height: var(--yj-layout-connector-list-max); }
.connector-menu__list li { display: flex; align-items: center; gap: var(--yj-space-2); }
.connector-menu__option { display: flex; align-items: center; min-width: 0; flex: 1; gap: var(--yj-space-2); padding: var(--yj-space-3) var(--yj-space-1); border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-text-primary); background: transparent; text-align: left; font: inherit; cursor: pointer; }
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
.connector-menu__empty { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-6); text-align: center; min-height: 0; overflow-y: auto; }
.connector-menu__empty > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-menu footer { flex: none; padding: var(--yj-space-3); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
@container chat-composer (max-width: 520px) { .connector-trigger__label { display: none; } }
</style>
