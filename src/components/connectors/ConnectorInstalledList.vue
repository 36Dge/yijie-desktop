<script setup lang="ts">
import { NSwitch } from "naive-ui";
import { connectorCan, connectorSwitchDisabled, type ConnectorView } from "../../domain/connector-ui";
import YjIcon from "../yijie/YjIcon.vue";
import ConnectorIcon from "./ConnectorIcon.vue";

defineProps<{ entries: readonly ConnectorView[]; canManage: boolean }>();
defineEmits<{
  open: [id: string];
  "enabled-change": [id: string, enabled: boolean];
  uninstall: [id: string];
}>();
</script>

<template>
  <ul class="connector-installed" aria-label="已安装的连接器">
    <li v-for="connector in entries" :key="connector.id" class="connector-installed__row" :aria-busy="connector.busy">
      <button class="connector-installed__details" type="button" :aria-label="`查看 ${connector.name}，${connector.status.label}`" @click="$emit('open', connector.id)">
        <ConnectorIcon :asset-id="connector.iconAssetId" />
        <span class="connector-installed__copy">
          <strong :title="connector.name">{{ connector.name }}</strong>
          <span class="connector-installed__description">{{ connector.description }}</span>
          <span class="connector-installed__status" :class="`connector-installed__status--${connector.status.tone}`">{{ connector.status.label }}</span>
        </span>
      </button>
      <div class="connector-installed__actions">
        <button v-if="canManage" class="connector-installed__remove" type="button" :aria-label="`卸载 ${connector.name}`" title="卸载" :disabled="!connectorCan(connector, 'uninstall')" @click="$emit('uninstall', connector.id)"><YjIcon name="trash" size="sm" /></button>
        <NSwitch :value="connector.enabled" :loading="connector.busy" :disabled="connectorSwitchDisabled(connector, canManage)" :aria-disabled="connectorSwitchDisabled(connector, canManage)" :aria-label="`${connector.enabled ? '停用' : '启用'} ${connector.name}`" @update:value="$emit('enabled-change', connector.id, $event)" />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.connector-installed { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--yj-space-3); list-style: none; margin: 0; padding: 0; }
.connector-installed__row { display: flex; min-width: 0; align-items: center; gap: var(--yj-space-3); padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); transition: border-color var(--yj-motion-fast) var(--yj-ease-standard); }
.connector-installed__row:not([aria-busy="true"]):is(:hover, :focus-within) { border-color: var(--yj-color-brand-primary); }
.connector-installed__details { display: flex; flex: 1; align-items: center; gap: var(--yj-space-3); min-width: 0; padding: 0; border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-text-primary); background: transparent; text-align: left; font: inherit; cursor: pointer; }
.connector-installed__details:focus-visible, .connector-installed__remove:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.connector-installed__copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: var(--yj-space-1); }
.connector-installed__copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); }
.connector-installed__description { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-installed__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-installed__status--warning { color: var(--yj-color-semantic-warning-ink); }
.connector-installed__status--error { color: var(--yj-color-semantic-error-ink); }
.connector-installed__actions { display: flex; align-items: center; flex: none; gap: var(--yj-space-3); }
.connector-installed__remove { display: inline-flex; align-items: center; justify-content: center; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-text-secondary); background: transparent; opacity: 0; pointer-events: none; }
.connector-installed__row:hover .connector-installed__remove, .connector-installed__row:focus-within .connector-installed__remove { opacity: 1; pointer-events: auto; }
.connector-installed__remove:hover:not(:disabled) { color: var(--yj-color-semantic-error-ink); background: var(--yj-color-error-soft); }
.connector-installed__remove :deep(.yj-icon) { color: inherit; }
.connector-installed__remove:disabled { color: var(--yj-color-text-disabled); cursor: default; }
@media (hover: none) { .connector-installed__remove { opacity: 1; pointer-events: auto; } }
@container connector-market (max-width: 720px) { .connector-installed { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container connector-market (max-width: 480px) { .connector-installed { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .connector-installed__row { transition: none; } }
</style>
