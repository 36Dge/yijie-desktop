<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, useId, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NModal, NSkeleton, NTag, useDialog, type DialogReactive } from "naive-ui";
import { useRoute } from "vue-router";
import type { CatalogEntry, ExpertDisplay, ResourceOperation } from "../../domain/experts.generated";
import { expertResourceLabels } from "../../domain/expert-ui";
import { useExpertsStore } from "../../stores/experts.store";
import { isYjIconName } from "../../icons/registry";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{ active?: boolean; selectedExpert?: ExpertDisplay | null; summonBusy?: boolean; summonError?: string | null; openExpertId?: string; openExpertVersion?: string }>(), { active: true });
const emit = defineEmits<{ summon: [entry: CatalogEntry, prompt?: string] }>();
function canSummon(entry: CatalogEntry): boolean { return props.active && !props.summonBusy && experts.snapshot?.executionAvailable === true && ["available", "ready"].includes(entry.state) && (entry.state === "ready" || experts.canManage) && !experts.busy.has(key(entry)) && !['pending', 'unknown'].includes(experts.operations[key(entry)]?.state ?? ''); }
function isSelected(entry: CatalogEntry): boolean { return props.selectedExpert?.expertId === entry.display.expertId && props.selectedExpert.version === entry.display.version; }
const experts = useExpertsStore(), dialog = useDialog(), route = useRoute();
let confirmation: DialogReactive | null = null, confirmationGeneration = 0, disposed = false;
function closeConfirmation(): void { const previous = confirmation; confirmation = null; previous?.destroy(); }
function invalidateConfirmation(): void { confirmationGeneration++; closeConfirmation(); }
watch(() => [route.fullPath, experts.scope, experts.contextId] as const, invalidateConfirmation, { flush: "sync" });
onScopeDispose(() => { disposed = true; invalidateConfirmation(); });
const query = ref(""), selectedKey = ref<string | null>(null), titleId = useId();
let detailTrigger: HTMLElement | null = null;
const key = (entry: CatalogEntry) => `${entry.display.expertId}@${entry.display.version}`;
const selected = computed(() => experts.entries.find(entry => key(entry) === selectedKey.value) ?? null);
const missingRequestedDetails = computed(() => props.active && !!experts.snapshot && !!props.openExpertId && !!props.openExpertVersion && selectedKey.value === `${props.openExpertId}@${props.openExpertVersion}` && selected.value === null);
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return experts.entries.filter(entry => [entry.display.displayName, entry.display.subtitle, entry.description, entry.platform, ...entry.tags].join(" ").toLocaleLowerCase().includes(search));
});
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
function remove(entry: CatalogEntry): void {
  const display = entry.display;
  confirmResourceAction("移除专家资源", `移除 ${display.displayName} ${display.version} 的本地资源？已有会话历史会保留；被会话或待发送任务引用的版本不能移除。`, "移除", () => experts.execute(display, "remove"));
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
    <NAlert type="info" :bordered="false">选择专家后回到对话。召唤和参考问题不会发送消息；主动发送后才开始任务。</NAlert>
    <NAlert v-if="!experts.canManage && experts.snapshot" type="info" :bordered="false">当前仅可查看，准备和移除资源需要插件管理权限。</NAlert>
    <NAlert v-if="!experts.snapshot?.executionAvailable" type="info" :bordered="false">当前执行环境暂不支持专家会话，可先查看资料范围。</NAlert>
    <NAlert v-if="summonError" type="warning" :bordered="false">{{ summonError }}</NAlert>
    <NInput v-model:value="query" clearable placeholder="搜索专家、平台或擅长领域" :input-props="{ 'aria-label': '搜索专家' }" :disabled="!experts.snapshot" />
    <div v-if="experts.refreshing && !experts.snapshot" class="expert-market__grid" role="status" aria-label="正在读取专家目录">
      <NSkeleton v-for="index in 3" :key="index" class="expert-market__skeleton" />
    </div>
    <YjEmpty v-else-if="experts.error || !experts.contextId" title="专家服务暂不可用" :description="experts.error ?? '本机身份尚未就绪，请重新读取。'" role="alert" />
    <YjEmpty v-else-if="!filtered.length" :title="query.trim() ? '未找到匹配专家' : '暂无可用专家'" :description="query.trim() ? '试试其他名称、平台或领域。' : '当前客户端清单还没有可展示的专家。'" />
    <div v-else class="expert-market__grid">
      <article v-for="entry in filtered" :key="key(entry)" class="expert-card">
        <button type="button" class="expert-card__details" :aria-label="`查看 ${entry.display.displayName} 详情`" @click="open(entry, $event)">
          <YjIcon :name="isYjIconName(entry.display.iconKey) ? entry.display.iconKey : 'skillOperations'" size="xl" />
          <span class="expert-card__name">{{ entry.display.displayName }}</span>
          <span class="expert-card__subtitle">{{ entry.display.subtitle }}</span>
          <span class="expert-card__description">{{ entry.description }}</span>
          <span class="expert-card__tags"><NTag v-for="tag in entry.tags" :key="tag" size="small" :bordered="false">{{ tag }}</NTag></span>
        </button>
        <div class="expert-card__footer">
          <span>{{ expertResourceLabels[entry.state] }}</span>
          <NButton v-if="entry.state === 'available'" secondary :loading="experts.busy.has(key(entry))" :disabled="!experts.canManage || !!experts.operations[key(entry)] && ['pending', 'unknown'].includes(experts.operations[key(entry)]!.state)" @click="experts.execute(entry.display, 'prepare')">准备资源</NButton>
          <NButton type="primary" :disabled="!canSummon(entry)" :loading="summonBusy" @click.stop="emit('summon', entry)">{{ isSelected(entry) ? '已选用' : '召唤专家' }}</NButton>
        </div>
        <p v-if="experts.operationErrors[key(entry)]" class="expert-market__error" role="alert">{{ experts.operationErrors[key(entry)] }}</p>
      </article>
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
    <NModal :show="active && (selected !== null || missingRequestedDetails)" @update:show="value => { if (!value) void closeDetails(); }">
      <NCard v-if="selected" class="expert-detail" role="dialog" aria-modal="true" :aria-labelledby="titleId" closable @close="closeDetails">
        <template #header><span :id="titleId">{{ selected.display.displayName }}</span></template>
        <div class="expert-detail__body">
          <NAlert v-if="summonError" type="warning" :bordered="false">{{ summonError }}</NAlert>
          <p>{{ selected.display.subtitle }} · {{ selected.display.version }}</p>
          <p>{{ selected.description }}</p>
          <div class="expert-card__tags"><NTag v-for="tag in selected.tags" :key="tag" :bordered="false">{{ tag }}</NTag></div>
          <h3>知识范围</h3><p>{{ selected.knowledgeSummary }}</p>
          <h3 v-if="selected.quickPrompts.length">可以这样提问</h3>
          <div v-if="selected.quickPrompts.length" class="expert-detail__prompts"><NButton v-for="prompt in selected.quickPrompts" :key="prompt" secondary :disabled="!canSummon(selected)" @click="emit('summon', selected, prompt)">{{ prompt }}</NButton></div>
          <p>当前版本仅获本地开发使用授权。资料可能涉及需要复核的平台规则，不能作为平台政策已核验的证明。</p>
          <NAlert type="info" :bordered="false">参考问题只填入输入框；由你确认内容后发送。</NAlert>
          <p v-if="experts.operationErrors[key(selected)]" class="expert-market__error" role="alert">{{ experts.operationErrors[key(selected)] }}</p>
        </div>
        <template #footer><div class="expert-detail__actions">
          <NButton v-if="selected.state === 'available'" secondary :disabled="!experts.canManage || !!experts.operations[key(selected)] && ['pending', 'unknown'].includes(experts.operations[key(selected)]!.state)" :loading="experts.busy.has(key(selected))" @click="experts.execute(selected.display, 'prepare')">准备资源</NButton>
          <NButton v-if="selected.state === 'ready'" secondary :disabled="!experts.canManage || experts.busy.has(key(selected)) || !!experts.operations[key(selected)] && ['pending', 'unknown'].includes(experts.operations[key(selected)]!.state)" @click="remove(selected)">移除资源</NButton>
          <NButton type="primary" :disabled="!canSummon(selected)" :loading="summonBusy" @click="emit('summon', selected)">{{ isSelected(selected) ? '已选用' : '召唤专家' }}</NButton>
        </div></template>
      </NCard>
      <NCard v-else-if="missingRequestedDetails" class="expert-detail" role="dialog" aria-modal="true" :aria-labelledby="titleId" closable @close="closeDetails">
        <template #header><span :id="titleId">所选专家版本详情不可用</span></template>
        <div class="expert-detail__body">
          <p>所选版本 {{ openExpertVersion }} 当前不在可用目录中，不能用其他版本代替它的详情。</p>
          <p>已有会话绑定保留。可返回对话移除专家，或关闭此详情后显式选择目录中的可用版本。</p>
        </div>
        <template #footer><NButton secondary @click="closeDetails">返回专家目录</NButton></template>
      </NCard>
    </NModal>
  </section>
</template>

<style scoped>
.expert-market, .expert-detail__body { display: flex; flex-direction: column; gap: var(--yj-space-4); }
.expert-market__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--yj-space-4); }
.expert-market__skeleton { min-height: calc(var(--yj-space-16) * 3); }
.expert-card { display: flex; flex-direction: column; gap: var(--yj-space-4); padding: var(--yj-space-5); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.expert-card:focus-within, .expert-card:hover { border-color: var(--yj-color-focus-ring); }
.expert-card__details { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: var(--yj-space-2); padding: 0; border: 0; background: transparent; color: var(--yj-color-text-primary); text-align: left; cursor: pointer; }
.expert-card__details:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-2); border-radius: var(--yj-radius-sm); }
.expert-card__name { font-size: var(--yj-font-size-section-title); font-weight: var(--yj-font-weight-semibold); }
.expert-card__subtitle, .expert-card__description, .expert-card__footer, .expert-detail__body { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.expert-card__tags { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.expert-card__footer, .expert-market__operation { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-3); }
.expert-market__error { margin: 0; color: var(--yj-color-semantic-error-ink); font-size: var(--yj-font-size-caption); }
.expert-market__operations { display: grid; gap: var(--yj-space-3); }
.expert-market__operation-actions { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.expert-market__operations h2, .expert-detail__body h3 { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-section-title); }
.expert-market__operations p, .expert-detail__body p, .expert-detail__body ul { margin: 0; }
.expert-detail { width: min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow-y: auto; }
.expert-detail__prompts { display: grid; gap: var(--yj-space-2); }
.expert-detail__prompts :deep(.n-button__content) { white-space: normal; text-align: left; }
.expert-detail__prompts :deep(.n-button) { height: auto; min-height: var(--yj-control-height-md); padding: var(--yj-space-3); justify-content: flex-start; }
.expert-detail__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); }
@media (max-width: 960px) { .expert-market__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .expert-market__grid { grid-template-columns: minmax(0, 1fr); } .expert-market__operation { flex-wrap: wrap; } }
</style>
