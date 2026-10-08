<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NModal, NSkeleton } from "naive-ui";
import { filterConnectors, type ConnectorAction, type ConnectorPageView } from "../../domain/connector-ui";
import YjPage from "../yijie/YjPage.vue";
import YjPageHeader from "../yijie/YjPageHeader.vue";
import YjSection from "../yijie/YjSection.vue";
import YjTabs from "../yijie/YjTabs.vue";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";
import ConnectorCard from "./ConnectorCard.vue";
import ConnectorInstalledList from "./ConnectorInstalledList.vue";
import ConnectorDetailsDialog from "./ConnectorDetailsDialog.vue";

const props = withDefaults(defineProps<{
  model: ConnectorPageView;
  operationErrors?: Readonly<Record<string, string>>;
  canReturn?: boolean;
  openServiceId?: string | null;
}>(), { operationErrors: () => ({}), canReturn: false, openServiceId: null });
const emit = defineEmits<{ refresh: []; action: [action: ConnectorAction, id: string]; back: [] }>();
const tab = ref("market"), query = ref("");
const detailsId = ref<string | null>(null), uninstallId = ref<string | null>(null);
const panelId = useId();
let detailsTrigger: HTMLElement | null = null, uninstallTrigger: HTMLElement | null = null;
const installed = computed(() => props.model.entries.filter(entry => entry.installed));
const tabs = computed(() => [{ key: "market", label: "市场" }, { key: "installed", label: `已安装 ${installed.value.length}` }]);
const filtered = computed(() => filterConnectors(tab.value === "installed" ? installed.value : props.model.entries, query.value));
const categories = computed(() => {
  const groups = new Map<string, { id: string; label: string; entries: typeof filtered.value[number][] }>();
  for (const entry of filtered.value) {
    if (!groups.has(entry.categoryId)) groups.set(entry.categoryId, { id: entry.categoryId, label: entry.categoryLabel, entries: [] });
    groups.get(entry.categoryId)!.entries.push(entry);
  }
  return [...groups.values()];
});
const details = computed(() => props.model.entries.find(entry => entry.id === detailsId.value) ?? null);
const uninstallTarget = computed(() => props.model.entries.find(entry => entry.id === uninstallId.value) ?? null);
const unavailableTitle = computed(() => props.model.phase === "permission-denied" ? "无权访问连接器" : props.model.phase === "incompatible" ? "连接器数据版本不兼容" : "连接器服务暂不可用");
function openDetails(id: string): void { detailsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null; detailsId.value = id; }
function requestUninstall(id: string): void { uninstallTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null; uninstallId.value = id; }
function enabledChange(id: string, enabled: boolean): void { if (enabled) openDetails(id); else emit("action", "disable", id); }
async function restoreTrigger(target: HTMLElement | null): Promise<void> { await nextTick(); if (target?.isConnected) target.focus({ preventScroll: true }); }
watch(() => props.openServiceId, id => { if (id) openDetails(id); }, { immediate: true });
watch(() => details.value?.enabled, (enabled, previous) => { if (enabled && previous === false) detailsId.value = null; });
watch(() => uninstallTarget.value?.installed, (isInstalled, previous) => { if (!isInstalled && previous) uninstallId.value = null; });
watch(() => props.model.phase, phase => { if (phase === "permission-denied") { detailsId.value = null; uninstallId.value = null; } });
</script>

<template>
  <YjPage width="full" class="connector-market">
    <YjPageHeader title="连接器" description="连接外部应用与服务，在对话中使用已启用的连接器。">
      <template #actions><NButton v-if="canReturn" secondary @click="$emit('back')">返回对话</NButton><NButton secondary :loading="model.refreshing" :disabled="model.phase === 'loading' || model.refreshing" @click="$emit('refresh')"><template #icon><YjIcon name="refresh" size="sm" /></template>刷新</NButton></template>
    </YjPageHeader>
    <div v-if="model.phase === 'loading'" class="connector-market__loading" role="status" aria-live="polite" aria-busy="true"><p>正在读取连接器…</p><div class="connector-market__grid" aria-hidden="true"><NCard v-for="index in 6" :key="index" :bordered="true"><NSkeleton text :repeat="2" /></NCard></div></div>
    <YjEmpty v-else-if="model.phase !== 'ready'" :title="unavailableTitle" :description="model.error ?? '请确认本机服务已就绪，然后重新读取。'" :icon="model.phase === 'permission-denied' ? 'shield' : 'warning'" role="alert"><template #actions><NButton @click="$emit('refresh')">重新读取</NButton></template></YjEmpty>
    <template v-else>
      <NAlert v-if="model.error" type="warning" :bordered="false" role="alert">{{ model.error }} 当前显示上次读取的状态，请刷新后再操作。</NAlert>
      <NAlert v-if="!model.canManage" type="info" :bordered="false">安装、启停和卸载需要管理权限；账户授权按对应权限单独开放。</NAlert>
      <div class="connector-market__toolbar"><YjTabs v-model="tab" :items="tabs" aria-label="连接器视图" :panel-id="panelId" /><NInput v-model:value="query" class="connector-market__search" clearable placeholder="搜索连接器" :input-props="{ 'aria-label': '搜索连接器' }"><template #prefix><YjIcon name="search" size="sm" tone="muted" /></template></NInput></div>
      <section :id="panelId" role="tabpanel" :aria-labelledby="`${panelId}-tab-${tab}`">
        <YjEmpty v-if="!filtered.length" :title="query.trim() ? '没有找到匹配的连接器' : tab === 'installed' ? '还没有安装连接器' : '当前没有可展示的连接器'" :description="query.trim() ? '试试其他名称或清空搜索。' : tab === 'installed' ? '前往市场安装应用，再完成配置或授权。' : '请刷新状态，或更新客户端后重试。'" :icon="query.trim() ? 'search' : 'connector'"><template #actions><NButton v-if="query.trim()" @click="query = ''">清空搜索</NButton><NButton v-else-if="tab === 'installed'" type="primary" @click="tab = 'market'">前往市场</NButton><NButton v-else @click="$emit('refresh')">刷新</NButton></template></YjEmpty>
        <ConnectorInstalledList v-else-if="tab === 'installed'" :entries="filtered" :can-manage="model.canManage" @open="openDetails" @enabled-change="enabledChange" @uninstall="requestUninstall" />
        <div v-else class="connector-market__categories"><YjSection v-for="category in categories" :key="category.id" :title="category.label" :count="category.entries.length" :count-label="`${category.entries.length} 个连接器`"><ul class="connector-market__grid"><li v-for="entry in category.entries" :key="entry.id"><ConnectorCard :connector="entry" @open="openDetails" /></li></ul></YjSection></div>
      </section>
    </template>
    <ConnectorDetailsDialog :show="detailsId !== null && details !== null" :connector="details" :can-manage="model.canManage" :error="detailsId ? operationErrors[detailsId] : null" @update:show="value => { if (!value) detailsId = null; }" @action="(action, id) => $emit('action', action, id)" @after-leave="restoreTrigger(detailsTrigger)" />
    <NModal v-if="uninstallTarget" :show="uninstallId !== null" :mask-closable="true" :close-on-esc="true" @update:show="value => { if (!value) uninstallId = null; }" @after-leave="restoreTrigger(uninstallTrigger)">
      <NCard class="connector-market__uninstall" title="卸载连接器" role="dialog" aria-modal="true" aria-label="卸载连接器" :bordered="false">
        <p>确定卸载「{{ uninstallTarget.name }}」？本机安装、连接配置和所管凭据将被清理，已发送的任务记录会保留。</p>
        <p>未发送的选择将不再可用。已经发出的外部操作无法通过卸载撤回。</p>
        <p v-if="uninstallTarget.busy || uninstallTarget.actions.includes('retry')" role="status">{{ uninstallTarget.status.label }}。关闭窗口不会取消操作，可稍后从连接器详情重新确认状态。</p>
        <NAlert v-if="operationErrors[uninstallTarget.id]" type="error" :bordered="false" role="alert">{{ operationErrors[uninstallTarget.id] }}</NAlert>
        <template #footer><div class="connector-market__confirm-actions">
          <NButton @click="uninstallId = null">关闭窗口</NButton>
          <NButton v-if="uninstallTarget.actions.includes('retry')" @click="$emit('action', 'retry', uninstallTarget.id)">重新确认状态</NButton>
          <NButton v-if="uninstallTarget.actions.includes('cancel')" @click="$emit('action', 'cancel', uninstallTarget.id)">取消操作</NButton>
          <NButton v-if="uninstallTarget.actions.includes('uninstall')" type="error" :loading="uninstallTarget.busy" :disabled="!model.canManage || uninstallTarget.busy" @click="$emit('action', 'uninstall', uninstallTarget.id)">确认卸载</NButton>
        </div></template>
      </NCard>
    </NModal>
  </YjPage>
</template>

<style scoped>
.connector-market { container: connector-market / inline-size; }
.connector-market__toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--yj-space-4); margin-block: var(--yj-space-5); }
.connector-market__search { width: min(100%, var(--yj-layout-connector-search-width)); }
.connector-market__categories { display: flex; flex-direction: column; gap: var(--yj-space-6); }
.connector-market__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--yj-space-3); padding: 0; margin: 0; list-style: none; }
.connector-market__grid > li { min-width: 0; }
.connector-market__loading { color: var(--yj-color-text-secondary); }
.connector-market__uninstall { width: min(var(--yj-layout-connector-modal-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8)); overflow-y: auto; border-radius: var(--yj-radius-xl); }
.connector-market__uninstall p { color: var(--yj-color-text-body); }
.connector-market__confirm-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--yj-space-2); }
@container connector-market (max-width: 720px) { .connector-market__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container connector-market (max-width: 480px) { .connector-market__grid { grid-template-columns: minmax(0, 1fr); } .connector-market__search { width: 100%; } }
</style>
