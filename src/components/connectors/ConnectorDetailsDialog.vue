<script setup lang="ts">
import { computed, useId } from "vue";
import { NAlert, NButton, NCard, NModal } from "naive-ui";
import { connectorPrimaryAction, type ConnectorAction, type ConnectorView } from "../../domain/connector-ui";
import YjIcon from "../yijie/YjIcon.vue";
import YjLogo from "../yijie/YjLogo.vue";
import ConnectorIcon from "./ConnectorIcon.vue";

const props = defineProps<{ show: boolean; connector: ConnectorView | null; canManage: boolean; error?: string | null }>();
defineEmits<{ "update:show": [show: boolean]; action: [action: ConnectorAction, id: string]; "after-leave": [] }>();
const titleId = useId();
const primary = computed(() => props.connector ? connectorPrimaryAction(props.connector) : null);
const title = computed(() => {
  const entry = props.connector;
  if (!entry) return "连接器详情";
  if (entry.busy) return `${entry.name} · ${entry.status.label}`;
  if (!entry.installed) return `安装 ${entry.name}`;
  return entry.enabled ? entry.name : `${entry.name} 已安装但未启用`;
});
</script>

<template>
  <NModal v-if="connector" :show="show" :auto-focus="true" :trap-focus="true" @update:show="$emit('update:show', $event)" @after-leave="$emit('after-leave')">
    <NCard class="connector-details" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="connector.busy" :bordered="false">
      <button class="connector-details__close" type="button" aria-label="关闭连接器详情" :title="connector.busy ? '关闭详情，连接操作可稍后继续查看' : '关闭'" @click="$emit('update:show', false)"><YjIcon name="dismiss" size="md" /></button>
      <div class="connector-details__content">
        <div class="connector-details__identity" aria-hidden="true"><YjLogo variant="icon-only" size="lg" /><YjIcon name="arrowRight" size="md" tone="muted" /><ConnectorIcon :asset-id="connector.iconAssetId" size="lg" /></div>
        <h2 :id="titleId">{{ title }}</h2>
        <p class="connector-details__description">{{ connector.description }}</p>
        <div class="connector-details__principles">
          <div><YjIcon name="skillOperations" size="md" /><span><strong>扩展对话能力</strong><span>启用后，可在对话中选择此连接器。</span></span></div>
          <div><YjIcon name="shield" size="md" /><span><strong>遵循当前权限设置</strong><span>授权连接不会替代任务中的操作审批。</span></span></div>
          <div><YjIcon name="settings" size="md" /><span><strong>随时管理连接</strong><span>可以停用或卸载本机安装，已发送的任务记录会保留。</span></span></div>
        </div>
        <p v-if="connector.configurationLabel" class="connector-details__configuration">{{ connector.configurationLabel }}</p>
        <NAlert v-if="connector.explanation && connector.explanation !== error" :type="connector.status.tone === 'error' ? 'error' : connector.status.tone === 'warning' ? 'warning' : 'info'" :bordered="false">{{ connector.explanation }}</NAlert>
        <NAlert v-if="error" type="error" :bordered="false" role="alert">{{ error }}</NAlert>
        <p v-if="!canManage" class="connector-details__configuration">当前没有安装、启停和卸载权限；账户授权按对应权限单独开放。</p>
        <p v-if="connector.busy" class="connector-details__progress" role="status" aria-live="polite"><YjIcon name="loading" size="sm" />{{ connector.status.label }}</p>
      </div>
      <template #footer>
        <div class="connector-details__actions">
          <NButton v-if="connector.actions.includes('reopen')" @click="$emit('action', 'reopen', connector.id)">重新打开连接页面</NButton>
          <NButton v-if="connector.actions.includes('cancel')" @click="$emit('action', 'cancel', connector.id)">取消操作</NButton>
          <NButton v-if="primary" type="primary" block :loading="connector.busy && primary.action !== 'retry'" :disabled="connector.busy && primary.action !== 'retry'" @click="$emit('action', primary.action, connector.id)">{{ primary.label }}</NButton>
          <NButton v-else-if="connector.enabled && connector.actions.includes('disable')" block :disabled="!canManage || connector.busy" @click="$emit('action', 'disable', connector.id)">停用连接器</NButton>
          <NButton v-else-if="!connector.busy" block @click="$emit('update:show', false)">知道了</NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.connector-details { position: relative; width: min(var(--yj-layout-connector-modal-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8)); border-radius: var(--yj-radius-xl); box-shadow: var(--yj-shadow-modal); }
.connector-details :deep(.n-card-content) { min-height: 0; overflow-y: auto; }
.connector-details :deep(.n-card__footer) { flex: none; }
.connector-details__close { position: absolute; top: var(--yj-space-3); right: var(--yj-space-3); display: inline-flex; align-items: center; justify-content: center; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-primary); }
.connector-details__close:hover { background: var(--yj-color-control-hover); }
.connector-details__close:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.connector-details__content { display: flex; flex-direction: column; gap: var(--yj-space-4); padding-top: var(--yj-space-4); }
.connector-details__identity { display: flex; align-items: center; justify-content: center; gap: var(--yj-space-5); padding: var(--yj-space-4); }
.connector-details h2 { margin: 0; text-align: center; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); overflow-wrap: anywhere; }
.connector-details__description { margin: 0; text-align: center; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.connector-details__principles { display: flex; flex-direction: column; gap: var(--yj-space-5); padding-block: var(--yj-space-4); }
.connector-details__principles > div { display: flex; align-items: flex-start; gap: var(--yj-space-3); }
.connector-details__principles > div > .yj-icon { flex: none; margin-top: var(--yj-space-1); }
.connector-details__principles > div > span { display: flex; flex-direction: column; gap: var(--yj-space-1); }
.connector-details__principles strong { font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); color: var(--yj-color-text-primary); }
.connector-details__principles span span, .connector-details__configuration { margin: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.connector-details__progress { display: flex; align-items: center; justify-content: center; gap: var(--yj-space-2); margin: 0; color: var(--yj-color-text-primary); }
.connector-details__actions { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.connector-details__actions > * { flex: 1; }
</style>
