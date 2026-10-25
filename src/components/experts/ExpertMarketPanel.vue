<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, useId, watch } from "vue";
import { NAlert, NButton, NCard, NModal, NSkeleton, useDialog, type DialogReactive } from "naive-ui";
import { useRoute } from "vue-router";
import type { CatalogEntry, ExpertDisplay, ResourceOperation } from "../../domain/experts-v2.generated";
import type { ExpertShowcase } from "../../domain/expert-showcase";
import { expertResourceLabels } from "../../domain/expert-ui";
import { useExpertsStore } from "../../stores/experts.store";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";
import ExpertShowcaseCard from "./ExpertShowcaseCard.vue";
import ExpertShowcaseDetail from "./ExpertShowcaseDetail.vue";
import ExpertAvatar from "./ExpertAvatar.vue";
import ExpertDetailCard from "./ExpertDetailCard.vue";
import { useExpertDeveloper } from "../../composables/useExpertDeveloper";

const props = withDefaults(defineProps<{ active?: boolean; selectedExpert?: ExpertDisplay | null; summonBusy?: boolean; summonError?: string | null; openExpertId?: string; openExpertVersion?: string; showcaseEntries?: readonly ExpertShowcase[] }>(), { active: true, showcaseEntries: () => [] });
const emit = defineEmits<{ summon: [entry: CatalogEntry, prompt?: string] }>();
function canSummon(entry: CatalogEntry): boolean { return props.active && !props.summonBusy && experts.snapshot?.executionAvailable === true && ["available", "ready"].includes(entry.state) && (entry.state === "ready" || experts.canManage) && !experts.busy.has(key(entry)) && !['pending', 'unknown'].includes(experts.operations[key(entry)]?.state ?? ''); }
function isSelected(entry: CatalogEntry): boolean { return props.selectedExpert?.expertId === entry.display.expertId && props.selectedExpert.version === entry.display.version; }
const experts = useExpertsStore(), dialog = useDialog(), route = useRoute();
let confirmation: DialogReactive | null = null, confirmationGeneration = 0, disposed = false;
function closeConfirmation(): void { const previous = confirmation; confirmation = null; previous?.destroy(); }
function invalidateConfirmation(): void { confirmationGeneration++; closeConfirmation(); }
watch(() => [route.fullPath, experts.scope, experts.contextId] as const, invalidateConfirmation, { flush: "sync" });
onScopeDispose(() => { disposed = true; invalidateConfirmation(); });
const query = defineModel<string>("query", { default: "" });
const selectedKey = ref<string | null>(null), titleId = useId();
let detailTrigger: HTMLElement | null = null;
const key = (entry: CatalogEntry) => `${entry.display.expertId}@${entry.display.version}`;
watch(() => [route.fullPath, experts.scope, experts.contextId], () => { selectedKey.value = null; detailTrigger = null; }, { flush: "sync" });
const selected = computed(() => experts.entries.find(entry => key(entry) === selectedKey.value) ?? null);
const developer = useExpertDeveloper(computed(() => selected.value?.display ?? null), computed(() => experts.contextId), computed(() => props.active));
const missingRequestedDetails = computed(() => props.active && !!experts.snapshot && !!props.openExpertId && !!props.openExpertVersion && selectedKey.value === `${props.openExpertId}@${props.openExpertVersion}` && selected.value === null);
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return experts.entries.filter(entry => [entry.display.displayName, entry.display.subtitle, entry.description, entry.platform, ...entry.tags].join(" ").toLocaleLowerCase().includes(search));
});
// Static display records never enter the executable catalog, bindings or store.
const filteredShowcase = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.showcaseEntries.filter(entry => [entry.name, entry.description, entry.author, entry.category, ...entry.tags].join(" ").toLocaleLowerCase().includes(search));
});
const liveUnavailable = computed(() => !!experts.error || !experts.contextId);
const visibleEntries = computed(() => liveUnavailable.value ? [] : filtered.value);
const resultCount = computed(() => visibleEntries.value.length + filteredShowcase.value.length);
const showcaseId = ref<string | null>(null);
const selectedShowcase = computed(() => props.showcaseEntries.find(entry => entry.id === showcaseId.value) ?? null);
let showcaseTrigger: HTMLElement | null = null;
function openShowcase(entry: ExpertShowcase, event: MouseEvent): void {
  if (!props.active) return;
  showcaseTrigger = event.currentTarget as HTMLElement;
  showcaseId.value = entry.id;
}
async function closeShowcase(): Promise<void> {
  const trigger = showcaseTrigger, path = route.fullPath, scope = experts.scope, context = experts.contextId;
  showcaseTrigger = null;
  showcaseId.value = null;
  await nextTick();
  if (!disposed && props.active && showcaseId.value === null && path === route.fullPath && scope === experts.scope && context === experts.contextId && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
watch(() => [props.active, route.fullPath, experts.scope, experts.contextId], () => { showcaseId.value = null; showcaseTrigger = null; }, { flush: "sync" });
const uncertain = computed(() => Object.values(experts.operations).filter(operation => operation.state === "unknown" || operation.state === "pending"));
function open(entry: CatalogEntry, event: MouseEvent): void { if (!props.active) return; detailTrigger = event.currentTarget as HTMLElement; selectedKey.value = key(entry); }
async function closeDetails(): Promise<void> {
  const trigger = detailTrigger, path = route.fullPath, scope = experts.scope, context = experts.contextId;
  detailTrigger = null;
  selectedKey.value = null;
  // Clearing the selected card removes the modal slot immediately, so its leave
  // hook is not guaranteed to run. Restore after the focus trap has unmounted.
  await nextTick();
  if (!disposed && props.active && selectedKey.value === null && path === route.fullPath && scope === experts.scope && context === experts.contextId && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
function confirmResourceAction(title: string, content: string, positiveText: string, action: () => Promise<unknown>): void {
  if (disposed || !props.active || !experts.canManage) return;
  closeConfirmation();
  const generation = confirmationGeneration, scope = experts.scope, context = experts.contextId;
  confirmation = dialog.warning({ title, content, positiveText, negativeText: "取消", onPositiveClick: async () => {
    if (disposed || !props.active || generation !== confirmationGeneration || scope !== experts.scope || context !== experts.contextId || !experts.canManage) return;
    closeConfirmation();
    await action();
  } });
}
function recover(operation: ResourceOperation): void {
  confirmResourceAction("处理未完成操作", "仅核对这次操作；如果确认尚未开始，会结束原请求。不会重复安装或移除资源。", "处理未完成操作", () => experts.recover(operation.expert, operation.operationId));
}
watch(() => [props.active, props.openExpertId, props.openExpertVersion, experts.entries] as const, ([active, id, version, entries]) => {
  if (!active) { invalidateConfirmation(); selectedKey.value = null; detailTrigger = null; }
  else if (typeof id === "string" && typeof version === "string") selectedKey.value = `${id}@${version}`;
  else if (typeof id === "string") { const entry = entries.find(item => item.display.expertId === id); if (entry) selectedKey.value = key(entry); }
}, { immediate: true, flush: "sync" });
watch(() => experts.scope, () => { selectedKey.value = null; query.value = ""; });
</script>

<template>
  <section class="expert-market" aria-label="专家目录" :aria-busy="experts.refreshing">
    <div class="expert-market__summary">
      <span v-if="showcaseEntries.length || experts.snapshot && !experts.error" class="expert-market__count">{{ resultCount }} 位专家</span>
      <p class="expert-market__hint">{{ showcaseEntries.length ? '点击卡片查看详情，标注「展示」的专家仅供浏览。' : '选择专家后进入对话，发送消息才会开始任务。' }}</p>
    </div>
    <NAlert v-if="!experts.canManage && experts.snapshot" type="info" :bordered="false">当前仅可查看，准备资源需要插件管理权限。</NAlert>
    <NAlert v-if="experts.snapshot && !experts.snapshot.executionAvailable" type="info" :bordered="false">当前执行环境暂不支持专家会话，可先查看资料范围。</NAlert>
    <NAlert v-if="summonError" type="warning" :bordered="false">{{ summonError }}</NAlert>
    <div v-if="experts.refreshing && !experts.snapshot" class="expert-market__grid" role="status" aria-label="正在读取专家目录">
      <NSkeleton v-for="index in 3" :key="index" class="expert-market__skeleton" />
    </div>
    <YjEmpty v-else-if="liveUnavailable && !showcaseEntries.length" title="专家服务暂不可用" :description="`${experts.error ?? '本机身份尚未就绪。'} 可点击「重新读取」重试。`" role="alert" />
    <NAlert v-else-if="liveUnavailable" type="info" :bordered="false">易界专家服务暂不可用，展示资料仍可查看。可点击「重新读取」重试。</NAlert>
    <YjEmpty v-if="!resultCount && !(experts.refreshing && !experts.snapshot) && (!liveUnavailable || showcaseEntries.length)" :title="query.trim() ? '未找到匹配专家' : '暂无可用专家'" :description="query.trim() ? '试试其他名称、平台或领域。' : '当前客户端清单还没有可展示的专家。'" />
    <div v-if="resultCount" class="expert-market__grid">
      <article v-for="entry in visibleEntries" :key="key(entry)" class="expert-card" :class="{ 'expert-card--selected': isSelected(entry), 'expert-card--action-visible': isSelected(entry) || summonBusy || !canSummon(entry) }">
        <button type="button" class="expert-card__details" :aria-label="`查看 ${entry.display.displayName} 详情`" @click="open(entry, $event)">
          <span class="expert-card__header">
            <ExpertAvatar :expert-id="entry.display.expertId" :icon-key="entry.display.iconKey" />
            <span class="expert-card__intro">
              <span class="expert-card__name" :title="entry.display.displayName">{{ entry.display.displayName }}</span>
              <span class="expert-card__description" :title="entry.description">{{ entry.description }}</span>
            </span>
          </span>
          <span class="expert-card__tags"><span v-for="tag in entry.tags" :key="tag" class="expert-card__tag">{{ tag }}</span></span>
        </button>
        <div class="expert-card__footer">
          <span class="expert-card__status">
            <span class="expert-card__platform">{{ entry.display.subtitle }}</span>
            <span v-if="entry.state !== 'available' && entry.state !== 'ready'" class="expert-card__resource"><span class="expert-card__status-dot" aria-hidden="true" />{{ expertResourceLabels[entry.state] }}</span>
          </span>
          <div class="expert-card__actions">
            <NButton class="expert-card__summon" text size="small" :disabled="!canSummon(entry)" :loading="summonBusy" @click.stop="emit('summon', entry)">{{ isSelected(entry) ? '已选用' : '召唤专家' }}<YjIcon v-if="!summonBusy" :name="isSelected(entry) ? 'check' : 'arrowUpRight'" size="xs" /></NButton>
          </div>
        </div>
        <p v-if="experts.operationErrors[key(entry)]" class="expert-market__error" role="alert">{{ experts.operationErrors[key(entry)] }}</p>
      </article>
      <ExpertShowcaseCard v-for="entry in filteredShowcase" :key="`showcase:${entry.id}`" :expert="entry" @open="event => openShowcase(entry, event)" />
    </div>
    <section v-if="uncertain.length" class="expert-market__operations" aria-label="待确认操作">
      <h2>待确认操作</h2>
      <p>关闭页面不会撤回已开始的准备。请查询原操作，不会自动重复提交。</p>
      <div v-for="operation in uncertain" :key="operation.operationId" class="expert-market__operation">
        <span>{{ experts.entries.find(entry => key(entry) === `${operation.expert.expertId}@${operation.expert.version}`)?.display.displayName ?? operation.expert.expertId }} · {{ operation.expert.version }} · {{ operation.state === 'pending' ? '处理中' : '结果待确认' }}</span>
        <div class="expert-market__operation-actions">
          <NButton secondary :disabled="!experts.contextId || experts.busy.has(`${operation.expert.expertId}@${operation.expert.version}`)" @click="experts.execute(operation.expert, 'query')">查询状态</NButton>
          <NButton secondary :disabled="!experts.canManage || experts.busy.has(`${operation.expert.expertId}@${operation.expert.version}`)" :loading="experts.busy.has(`${operation.expert.expertId}@${operation.expert.version}`)" @click="recover(operation)">处理未完成操作</NButton>
        </div>
      </div>
    </section>
    <NModal v-if="selected !== null || missingRequestedDetails" :show="active" @update:show="value => { if (!value) void closeDetails(); }">
      <ExpertDetailCard v-if="selected" :name="selected.display.displayName" :developer="developer" :version="selected.display.version" :expert-id="selected.display.expertId" :description="selected.description" :tags="selected.tags" :quick-prompts="selected.quickPrompts" :knowledge-summary="selected.knowledgeSummary" interactive :disabled="!canSummon(selected)" @close="closeDetails" @prompt="prompt => selected && emit('summon', selected, prompt)">
        <template #avatar><ExpertAvatar :expert-id="selected.display.expertId" :icon-key="selected.display.iconKey" detail /></template>
        <template #action><NButton type="primary" size="small" :bordered="false" :disabled="!canSummon(selected)" :loading="summonBusy" @click="emit('summon', selected)">{{ isSelected(selected) ? '已选用' : '召唤专家' }}</NButton></template>
        <template #feedback>
          <NAlert v-if="summonError" type="warning" :bordered="false">{{ summonError }}</NAlert>
          <p v-if="experts.operationErrors[key(selected)]" class="expert-market__error" role="alert">{{ experts.operationErrors[key(selected)] }}</p>
        </template>
      </ExpertDetailCard>
      <NCard v-else-if="missingRequestedDetails" class="expert-detail-unavailable" role="dialog" aria-modal="true" :aria-labelledby="titleId" closable @close="closeDetails">
        <template #header><span :id="titleId">所选专家版本详情不可用</span></template>
        <div class="expert-detail__body">
          <p>所选版本 {{ openExpertVersion }} 当前不在可用目录中，不能用其他版本代替它的详情。</p>
          <p>已有会话绑定保留。可返回对话移除专家，或关闭此详情后显式选择目录中的可用版本。</p>
        </div>
        <template #footer><NButton secondary @click="closeDetails">返回专家目录</NButton></template>
      </NCard>
    </NModal>
    <ExpertShowcaseDetail :expert="selectedShowcase" :active="active" @close="closeShowcase" />
  </section>
</template>

<style scoped>
.expert-market, .expert-detail__body { display: flex; flex-direction: column; gap: var(--yj-space-4); }
.expert-market { container-type: inline-size; padding: var(--yj-space-1); }
.expert-market__summary { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--yj-space-2) var(--yj-space-4); padding-bottom: var(--yj-space-1); }
.expert-market__count { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.expert-market__hint { margin: 0; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.expert-market__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: var(--yj-space-4); }
.expert-market__skeleton { min-height: calc(var(--yj-space-16) * 2 + var(--yj-space-12)); border-radius: var(--yj-radius-xl); }
.expert-card { display: flex; min-width: 0; flex-direction: column; gap: var(--yj-space-4); padding: var(--yj-space-5); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-xl); background: var(--yj-color-bg-card); transition: border-color var(--yj-motion-fast) var(--yj-ease-standard); }
.expert-card--selected { border-color: var(--yj-color-border-strong); }
.expert-card:is(:hover, :focus-within) { border-color: var(--yj-color-brand-primary); }
.expert-card__details { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: var(--yj-space-4); padding: 0; border: 0; background: transparent; color: var(--yj-color-text-primary); font: inherit; text-align: left; cursor: pointer; }
.expert-card__details:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-2); border-radius: var(--yj-radius-md); }
.expert-card__header { display: grid; grid-template-columns: var(--yj-space-12) minmax(0, 1fr); align-items: center; gap: var(--yj-space-3); width: 100%; }
.expert-card__intro { display: grid; min-width: 0; gap: var(--yj-space-1); }
.expert-card__name { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); }
.expert-card__description { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.expert-card__tags { display: flex; flex-wrap: wrap; gap: var(--yj-space-1); }
.expert-card__tag { max-width: 100%; overflow-wrap: anywhere; padding: calc(var(--yj-space-1) / 2) var(--yj-space-2); border-radius: var(--yj-radius-xs); background: var(--yj-color-control-hover); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-regular); }
.expert-card__summon { opacity: 0; pointer-events: none; transition: opacity var(--yj-motion-fast) var(--yj-ease-standard); }
.expert-card__summon :deep(.n-button__content) { gap: var(--yj-space-1); font-size: var(--yj-font-size-caption); }
.expert-card:hover .expert-card__summon, .expert-card:focus-within .expert-card__summon, .expert-card--action-visible .expert-card__summon { opacity: 1; pointer-events: auto; }
.expert-card__footer, .expert-market__operation { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-3); }
.expert-card__footer { flex-wrap: wrap; min-height: var(--yj-badge-height); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); color: var(--yj-color-text-tertiary); }
.expert-card__status { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: var(--yj-space-2); }
.expert-card__platform { max-width: 100%; overflow-wrap: anywhere; }
.expert-card__resource { display: inline-flex; align-items: center; gap: var(--yj-space-1); }
.expert-card__status-dot { flex: none; width: var(--yj-space-1); height: var(--yj-space-1); border-radius: var(--yj-radius-full); background: currentColor; }
.expert-card__actions { display: flex; flex: none; align-items: center; gap: var(--yj-space-3); margin-inline-start: auto; }
.expert-detail__body { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.expert-market__error { margin: 0; color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
.expert-market__operations { display: grid; gap: var(--yj-space-3); }
.expert-market__operation-actions { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.expert-market__operations h2, .expert-detail__body h3 { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-section-title); }
.expert-market__operations p, .expert-detail__body p, .expert-detail__body ul { margin: 0; }
.expert-detail-unavailable { width: min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow-y: auto; }
@container (max-width: 900px) { .expert-card { padding: var(--yj-space-4); } }
@container (max-width: 720px) { .expert-market__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 480px) { .expert-market__grid { grid-template-columns: minmax(0, 1fr); } .expert-market__operation { flex-wrap: wrap; } }
@media (hover: none) { .expert-card__summon { opacity: 1; pointer-events: auto; } }
@media (prefers-reduced-motion: reduce) { .expert-card, .expert-card__summon { transition: none; } }
</style>
