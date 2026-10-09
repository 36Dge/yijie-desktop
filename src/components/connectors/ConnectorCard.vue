<script setup lang="ts">
import type { ConnectorView } from "../../domain/connector-ui";
import YjIcon from "../yijie/YjIcon.vue";
import ConnectorIcon from "./ConnectorIcon.vue";

defineProps<{ connector: ConnectorView }>();
defineEmits<{ open: [id: string] }>();
</script>

<template>
  <button class="connector-card" type="button" :aria-label="`${connector.name}，${connector.status.label}，查看详情`" :aria-busy="connector.busy" @click="$emit('open', connector.id)">
    <ConnectorIcon :asset-id="connector.iconAssetId" />
    <span class="connector-card__copy">
      <strong :title="connector.name">{{ connector.name }}</strong>
      <span class="connector-card__description">{{ connector.description }}</span>
      <span v-if="connector.installed || connector.status.tone === 'warning' || connector.status.tone === 'error'" class="connector-card__status" :class="`connector-card__status--${connector.status.tone}`">{{ connector.status.label }}</span>
    </span>
    <span class="connector-card__indicator" :class="{ 'connector-card__indicator--enabled': connector.enabled, 'connector-card__indicator--add': !connector.installed && !connector.busy }" aria-hidden="true">
      <YjIcon :name="connector.busy ? 'loading' : connector.enabled ? 'permissionCheck' : connector.installed ? 'pending' : 'plus'" :size="!connector.installed && !connector.busy ? 'lg' : 'sm'" :class="{ 'connector-card__busy': connector.busy }" />
    </span>
  </button>
</template>

<style scoped>
.connector-card { display: flex; align-items: center; gap: var(--yj-space-3); width: 100%; height: 100%; min-width: 0; padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); text-align: left; font: inherit; cursor: pointer; transition: border-color var(--yj-motion-fast) var(--yj-ease-standard); }
.connector-card:not([aria-busy="true"]):is(:hover, :focus-visible) { border-color: var(--yj-color-brand-primary); }
.connector-card:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.connector-card__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: var(--yj-space-1); }
.connector-card__copy strong { overflow: hidden; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-body); white-space: nowrap; text-overflow: ellipsis; }
.connector-card__description { display: -webkit-box; overflow: hidden; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.connector-card__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.connector-card__status--warning { color: var(--yj-color-semantic-warning-ink); }
.connector-card__status--error { color: var(--yj-color-semantic-error-ink); }
.connector-card__indicator { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--yj-space-6); height: var(--yj-space-6); color: var(--yj-color-text-secondary); }
.connector-card__indicator--add { width: var(--yj-control-height-md); height: var(--yj-control-height-md); border-radius: var(--yj-radius-full); color: var(--yj-color-text-primary); transition: color var(--yj-motion-fast) var(--yj-ease-standard), background-color var(--yj-motion-fast) var(--yj-ease-standard); }
.connector-card:is(:hover, :focus-visible) .connector-card__indicator--add { background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); }
.connector-card:active .connector-card__indicator--add { background: var(--yj-color-brand-active); }
.connector-card__indicator--enabled { color: var(--yj-color-semantic-success-ink); }
.connector-card__indicator :deep(.yj-icon) { color: inherit; }
.connector-card__busy { animation: connector-card-spin var(--yj-motion-connector-loading) linear infinite; }
@keyframes connector-card-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .connector-card, .connector-card__indicator--add { transition: none; } .connector-card__busy { animation: none; } }
</style>
