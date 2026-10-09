<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { NButton, NInput, NPopover } from "naive-ui";
import type { ChatShopPreview } from "../../composables/useChatShopPreview";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import { chatSearchTheme } from "../../design/theme/chat-search-theme";

// Shop identity stays in the presentation layer and is shared by every selected state.
const shopIcons: Readonly<Record<string, YjIconName>> = {
  "demo-tk-home": "shopHome",
  "demo-tk-outdoor": "shopOutdoors",
  "demo-tk-living": "shopSunny",
  "demo-amazon-home": "shopNorthstar",
  "demo-amazon-living": "shopLighting",
};
function shopIcon(id: string): YjIconName { return shopIcons[id] ?? "store"; }

const props = defineProps<{ model: ChatShopPreview; disabled: boolean }>();
const state = reactive(props.model);
const open = ref(false);
const overlay = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);

const panelHeight = ref(560);
const panelShift = ref(0);
const placement = ref<"top-start" | "bottom-start">("top-start");
function measureAvailableSpace() {
  if (!open.value || !trigger.value) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const scale = Number.parseFloat(rootStyle.getPropertyValue("--yj-ui-scale")) || 1;
  const inset = Number.parseFloat(rootStyle.getPropertyValue("--yj-space-4")) || 16;
  const gap = Number.parseFloat(rootStyle.getPropertyValue("--yj-space-2")) || 8;
  const bounds = trigger.value.getBoundingClientRect();
  const above = bounds.top / scale - inset - gap;
  const below = (window.innerHeight - bounds.bottom) / scale - inset - gap;
  placement.value = above >= below ? "top-start" : "bottom-start";
  const available = Math.max(above, below);
  // At large UI scales use the viewport's height and allow overlap with the composer,
  // rather than squeezing the list to less than a single selectable row.
  panelHeight.value = Math.max(0, Math.floor(available < 360 ? window.innerHeight / scale - inset * 2 : available));
  panelShift.value = Math.max(0, panelHeight.value - available) * (placement.value === "top-start" ? 1 : -1);
}
onMounted(() => { window.addEventListener("resize", measureAvailableSpace); window.addEventListener("scroll", measureAvailableSpace, true); });
onBeforeUnmount(() => { window.removeEventListener("resize", measureAvailableSpace); window.removeEventListener("scroll", measureAvailableSpace, true); });
const filters = ["all", "TikTok Shop", "Amazon"] as const;
const triggerLabel = computed(() => state.current ? `关联店铺：${state.current.name}，${state.current.platform} ${state.current.market}` : "关联店铺");
const canLink = computed(() => !!state.chosen && state.chosen.id !== state.current?.id && !state.busy);
async function setOpen(value: boolean) {
  if (value && props.disabled) return;
  open.value = value;
  if (value) {
    measureAvailableSpace(); state.openPanel(); await nextTick(); focusPanel();
  } else {
    state.cancel(); await nextTick(); if (!props.disabled) trigger.value?.focus({ preventScroll: true });
  }
}
function focusPanel() { if (open.value) panel.value?.focus({ preventScroll: true }); }
watch(() => props.disabled, disabled => { if (disabled) void setOpen(false); });
watch(() => state.scopeRevision, () => { open.value = false; });
watch(() => state.stage, async () => { if (open.value) { await nextTick(); measureAvailableSpace(); focusPanel(); } });
function navigate(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  const button = buttons[next]!;
  state.choose(button.dataset.shopId!); button.focus({ preventScroll: true });
}
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover :show="open" :to="overlay ?? false" trigger="click" :placement="placement" :flip="false" :disabled="disabled" :show-arrow="false" raw @update:show="setOpen">
    <template #trigger>
      <button ref="trigger" class="shop-trigger yj-control" :class="{ 'is-linked': state.current }" type="button" :disabled="disabled" :aria-label="triggerLabel" :title="disabled ? '任务进行中，暂时不能切换店铺' : `${triggerLabel}（交互演示）`" aria-haspopup="dialog" :aria-expanded="open" @keydown.down.prevent="setOpen(true)" @keydown.esc.stop.prevent="setOpen(false)">
        <YjIcon :name="state.current ? shopIcon(state.current.id) : 'store'" size="sm" :stroke-width="1.5" />
        <span class="shop-trigger-name">{{ state.current?.name ?? '关联店铺' }}</span>
        <span v-if="state.current" class="shop-trigger-check" aria-hidden="true"><YjIcon name="permissionCheck" size="xs" :stroke-width="1.5" /></span>
        <YjIcon v-else class="shop-trigger-chevron yj-control__chevron" name="chevronDown" size="xs" tone="muted" />
      </button>
    </template>
    <div ref="panel" class="shop-panel chat-control-menu" :class="{ 'is-compact': panelHeight < 430 }" :style="{ '--shop-panel-available-height': `${panelHeight}px`, '--shop-panel-offset-y': `${panelShift}px` }" role="dialog" tabindex="-1" aria-label="选择关联店铺" :aria-busy="state.busy" @keydown.esc.stop.prevent="setOpen(false)" @keydown="navigate">
      <div v-if="state.stage === 'empty'" class="shop-state">
        <span class="shop-state-visual"><YjIcon name="store" size="xl" :stroke-width="1.5" /><span class="shop-state-mini"><YjIcon name="plus" size="xs" :stroke-width="1.5" /></span></span>
        <h3>还没有授权店铺</h3>
        <p>先将店铺授权给易界，再选择一家店铺，<br />让经营需求有明确的店铺对象。</p>
      </div>

      <div v-else-if="state.stage === 'authorizing' || state.stage === 'linking'" class="shop-state" role="status" aria-live="polite">
        <span class="shop-state-visual"><YjIcon name="loading" size="xl" :stroke-width="1.5" class="shop-spin" /></span>
        <h3>{{ state.stage === 'linking' ? '正在关联店铺' : state.authorizationStep ? '正在同步店铺列表' : '正在准备店铺授权' }}</h3>
        <p>{{ state.stage === 'linking' ? `即将关联「${state.chosen?.name}」` : '稍等片刻，正在为你准备示例店铺。' }}</p>
        <div v-if="state.stage === 'authorizing'" class="shop-progress"><span :class="{ 'is-complete': state.authorizationStep }"><YjIcon :name="state.authorizationStep ? 'permissionCheck' : 'pending'" size="xs" />授权确认</span><span class="shop-progress-line" /><span>同步店铺</span></div>
      </div>

      <template v-else-if="state.stage === 'list'">
        <div class="shop-filter-area">
          <NInput v-model:value="state.query" size="small" :theme-overrides="chatSearchTheme" :input-props="{ 'aria-label': '搜索店铺' }" placeholder="搜索店铺" clearable :disabled="state.busy"><template #prefix><YjIcon name="search" size="sm" :stroke-width="1.5" tone="muted" /></template></NInput>
          <div class="shop-filters" role="group" aria-label="店铺平台筛选"><button v-for="filter in filters" :key="filter" type="button" :aria-pressed="state.platform === filter" :disabled="state.busy" @click="state.platform = filter">{{ filter === 'all' ? '全部' : filter === 'TikTok Shop' ? 'TikTok' : filter }} <span>{{ filter === 'all' ? state.available.length : state.available.filter(shop => shop.platform === filter).length }}</span></button></div>
        </div>
        <div v-if="state.expiredIds.length" class="shop-warning" role="status"><YjIcon name="warning" size="sm" :stroke-width="1.5" /><span>{{ state.expiredIds.length }} 家店铺授权已失效，已从可选列表移除。</span><button type="button" @click="state.authorize">重新授权</button></div>
        <div class="shop-list" role="radiogroup" aria-label="选择一家店铺">
          <button v-for="shop in state.filtered" :key="shop.id" class="shop-option" :class="{ 'is-selected': state.draftId === shop.id }" type="button" role="radio" :aria-checked="state.draftId === shop.id" :aria-label="`${shop.name}，${shop.platform}，${shop.market}`" :disabled="state.busy" :data-shop-id="shop.id" @click="state.choose(shop.id)">
            <span class="shop-avatar"><YjIcon :name="shopIcon(shop.id)" size="lg" :stroke-width="1.5" /></span>
            <span class="shop-option-copy"><span class="shop-option-title">{{ shop.name }}<span v-if="state.current?.id === shop.id" class="shop-current-label">当前</span></span><span class="shop-option-meta">{{ shop.platform }} · {{ shop.market }}</span></span>
            <span class="shop-radio" aria-hidden="true"><YjIcon v-if="state.draftId === shop.id" name="permissionCheck" size="xs" :stroke-width="1.5" /></span>
          </button>
          <div v-if="!state.filtered.length" class="shop-no-results"><YjIcon name="search" size="xl" :stroke-width="1.5" tone="muted" /><strong>没有找到匹配的店铺</strong><span>试试其他名称或平台。</span><NButton quaternary @click="state.query = ''; state.platform = 'all'">清空筛选</NButton></div>
        </div>
        <footer class="shop-selection-footer">
          <p class="shop-selection-summary">{{ state.chosen ? `已选择「${state.chosen.name}」` : '每次仅关联 1 家店铺' }}</p>
          <div class="shop-selection-actions"><NButton v-if="state.current" quaternary :disabled="state.busy" @click="state.unlink">解除关联</NButton><NButton type="primary" size="small" :bordered="false" :disabled="!canLink" @click="state.link">{{ state.draftId && state.draftId === state.current?.id ? '已关联此店铺' : state.current ? '切换关联' : '关联店铺' }}</NButton></div>
          <p v-if="state.notice" class="shop-notice" role="status">{{ state.notice }}</p>
        </footer>
      </template>

      <div v-else-if="state.stage === 'success'" class="shop-state shop-state--success" role="status" aria-live="polite">
        <span class="shop-state-visual"><YjIcon name="check" size="xl" :stroke-width="1.5" /></span>
        <h3>店铺关联成功</h3>
        <p>已为当前对话选定店铺，可随时切换。</p>
        <div v-if="state.current" class="shop-linked-card"><span class="shop-avatar"><YjIcon :name="shopIcon(state.current.id)" size="lg" :stroke-width="1.5" /></span><span><strong>{{ state.current.name }}</strong><span>{{ state.current.platform }} · {{ state.current.market }}</span></span></div>
      </div>

      <div v-else-if="state.stage === 'expired'" class="shop-state shop-state--warning" role="alert">
        <span class="shop-state-visual"><YjIcon name="store" size="xl" :stroke-width="1.5" /><span class="shop-state-mini"><YjIcon name="warning" size="xs" :stroke-width="1.5" /></span></span>
        <h3>已清除失效的店铺关联</h3>
        <p>「{{ state.expiredName }}」的授权已失效。<br />请重新授权，或选择其他可用店铺。</p>
      </div>

      <div v-else class="shop-state shop-state--warning" role="alert">
        <span class="shop-state-visual"><YjIcon name="warning" size="xl" :stroke-width="1.5" /></span>
        <h3>暂时无法完成操作</h3>
        <p>请稍后重试。<br />{{ state.current ? '已关联的店铺会为你保留。' : '你也可以先关闭窗口，稍后再关联。' }}</p>
      </div>
      <footer v-if="state.stage !== 'list'" class="shop-state-footer">
        <NButton v-if="state.stage === 'empty'" type="primary" :bordered="false" block data-primary @click="state.authorize">授权店铺<template #icon><YjIcon name="shield" size="sm" :stroke-width="1.5" /></template></NButton>
        <NButton v-else-if="state.stage === 'authorizing' || state.stage === 'linking'" quaternary data-primary @click="state.cancel">取消</NButton>
        <template v-else-if="state.stage === 'success'"><NButton @click="state.showList">切换店铺</NButton><NButton type="primary" data-primary @click="setOpen(false)">继续对话</NButton></template>
        <template v-else-if="state.stage === 'expired'"><NButton @click="state.showList">选择其他</NButton><NButton type="primary" data-primary @click="state.authorize">重新授权</NButton></template>
        <template v-else><NButton @click="setOpen(false)">稍后再说</NButton><NButton type="primary" data-primary @click="state.retry">重试</NButton></template>
      </footer>
    </div>
  </NPopover>
</template>

<style scoped>
.shop-trigger { flex: 0 1 auto; min-width: var(--yj-space-8); max-width: var(--yj-layout-shop-trigger-max); border: 0; border-radius: var(--yj-radius-full); background: transparent; color: var(--yj-color-text-primary); }
.shop-trigger > .yj-icon { color: inherit; }
.shop-trigger:hover:not(:disabled), .shop-trigger[aria-expanded="true"], .shop-trigger.is-linked { background: var(--yj-color-control-hover); }
.shop-trigger:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.shop-trigger:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.shop-trigger:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.shop-trigger-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shop-trigger-check { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-4); height: var(--yj-space-4); border-radius: var(--yj-radius-full); background: var(--yj-color-brand-primary); }
.shop-trigger-check .yj-icon { color: var(--yj-color-on-brand); }
.shop-panel { display: flex; flex-direction: column; width: min(var(--yj-layout-shop-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: min(var(--shop-panel-available-height), calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8))); padding: 0; overflow: hidden; }
.shop-panel { translate: 0 var(--shop-panel-offset-y); }
.shop-panel:focus { outline: none; }
.shop-state { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-4); padding: var(--yj-space-5) var(--yj-space-6) var(--yj-space-6); min-height: 0; overflow-y: auto; text-align: center; }
.shop-state-visual { position: relative; display: flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-16); height: var(--yj-space-16); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-xl); background: var(--yj-color-bg-card); }
.shop-state-mini { position: absolute; display: flex; align-items: center; justify-content: center; right: calc(-1 * var(--yj-space-1)); bottom: calc(-1 * var(--yj-space-1)); width: var(--yj-space-6); height: var(--yj-space-6); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-full); background: var(--yj-color-bg-elevated); }
.shop-state h3 { margin: 0; font-size: var(--yj-font-size-section-title); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-section-title); }
.shop-state p { margin: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.shop-state--success .shop-state-visual { border-color: var(--yj-color-brand-primary); background: var(--yj-color-brand-primary); }
.shop-state--success .shop-state-visual .yj-icon { color: var(--yj-color-on-brand); }
.shop-state--warning .shop-state-visual { background: var(--yj-color-warning-soft); border-color: transparent; }
.shop-state--warning .shop-state-visual .yj-icon, .shop-state--warning .shop-state-mini .yj-icon { color: var(--yj-color-semantic-warning-ink); }
.shop-filter-area { padding: var(--yj-space-3) var(--yj-space-3) var(--yj-space-2); flex: none; }
.shop-filters { display: flex; gap: var(--yj-space-2); margin-top: var(--yj-space-2); }
.shop-filters button { position: relative; display: inline-flex; align-items: center; gap: var(--yj-space-1); min-height: var(--yj-space-8); padding: var(--yj-space-1) var(--yj-space-3); border: 0; border-radius: var(--yj-radius-sm); background: transparent; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-semibold); }
.shop-filters button::after { content: ""; position: absolute; inset-inline: var(--yj-space-3); bottom: 0; height: calc(2 * var(--yj-border-width)); border-radius: var(--yj-radius-full); background: transparent; }
.shop-filters button:hover:not(:disabled) { background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.shop-filters button[aria-pressed="true"] { color: var(--yj-color-text-primary); }
.shop-filters button[aria-pressed="true"]::after { background: var(--yj-color-brand-primary); }
.shop-filters button[aria-pressed="true"]:disabled::after { background: var(--yj-color-text-disabled); }
.shop-filters button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.shop-list { overflow-y: auto; min-height: 0; max-height: var(--yj-layout-shop-list-max); padding: 0 var(--yj-space-2); overscroll-behavior: contain; }
.shop-option { display: flex; align-items: center; gap: var(--yj-space-3); width: 100%; padding: var(--yj-space-3) var(--yj-space-2); border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-primary); text-align: left; }
.shop-option:hover:not(:disabled), .shop-option.is-selected { background: var(--yj-color-control-hover); }
.shop-option:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.shop-option:disabled { cursor: default; }
.shop-avatar { display: flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-10); height: var(--yj-space-10); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.shop-option-copy { display: flex; flex-direction: column; gap: var(--yj-space-1); min-width: 0; flex: 1; }
.shop-option-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-2); font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-regular); overflow-wrap: anywhere; }
.shop-option-meta, .shop-current-label { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-regular); }
.shop-radio { display: flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-4); height: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-control); border-radius: var(--yj-radius-full); }
.is-selected .shop-radio { background: var(--yj-color-brand-primary); border-color: var(--yj-color-brand-primary); }
.shop-radio .yj-icon { color: var(--yj-color-on-brand); }
.shop-selection-footer { padding: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-default); flex: none; }
.shop-selection-summary { margin: 0 0 var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.shop-selection-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--yj-space-2); }
.shop-selection-actions > :last-child { flex: 1; }
.shop-notice { margin: var(--yj-space-2) 0 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.shop-state-footer { display: flex; flex: none; gap: var(--yj-space-2); padding: 0 var(--yj-space-5) var(--yj-space-4); }
.shop-state-footer > * { flex: 1; }
.shop-state > * { flex-shrink: 0; }
.shop-linked-card { display: flex; align-items: center; gap: var(--yj-space-3); width: 100%; padding: var(--yj-space-3); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); text-align: left; }
.shop-linked-card > span:last-child { display: flex; flex-direction: column; gap: var(--yj-space-1); min-width: 0; }
.shop-linked-card strong { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); overflow-wrap: anywhere; }
.shop-linked-card span span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.shop-warning { display: flex; align-items: flex-start; gap: var(--yj-space-2); padding: var(--yj-space-2) var(--yj-space-4); color: var(--yj-color-semantic-warning-ink); font-size: var(--yj-font-size-caption); }
.shop-warning .yj-icon { color: inherit; }
.shop-warning span { flex: 1; }
.shop-warning button { border: 0; padding: 0; background: transparent; color: inherit; text-decoration: underline; white-space: nowrap; }
.shop-progress { display: flex; align-items: center; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.shop-progress span { display: inline-flex; align-items: center; gap: var(--yj-space-1); }
.shop-progress-line { width: var(--yj-space-8); height: var(--yj-border-width); background: var(--yj-color-border-default); }
.shop-no-results { display: flex; flex-direction: column; align-items: center; gap: var(--yj-space-2); padding: var(--yj-space-6); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.shop-no-results strong { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); }
.is-compact .shop-state { gap: var(--yj-space-2); padding: var(--yj-space-3) var(--yj-space-5) var(--yj-space-4); }
.is-compact .shop-state-visual { width: var(--yj-space-12); height: var(--yj-space-12); }
.is-compact .shop-option { padding-block: var(--yj-space-2); }
.is-compact .shop-filters { margin-top: var(--yj-space-1); }
.is-compact .shop-filter-area { padding-bottom: var(--yj-space-1); }
.is-compact .shop-selection-footer { padding-block: var(--yj-space-2); }
.is-compact .shop-selection-summary { display: none; }
.is-compact .shop-notice { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.shop-panel button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.shop-spin { animation: shop-spin 1s linear infinite; }
@keyframes shop-spin { to { transform: rotate(360deg); } }
@container chat-composer (max-width: 420px) { .shop-trigger-name, .shop-trigger-chevron, .shop-trigger-check { display: none; } .shop-trigger { width: var(--yj-space-8); flex: none; padding: 0; justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .shop-spin { animation: none; } }
</style>
