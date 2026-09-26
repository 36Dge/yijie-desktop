<script setup lang="ts">
import { ref } from "vue";
import type { RecommendedWorkflow } from "../../domain/workflow-showcase";
defineProps<{ workflow: RecommendedWorkflow }>();
const selectedAction = ref<RecommendedWorkflow["actions"][number] | null>(null);
</script>

<template>
  <article class="recommended-workflow-card workflow-showcase-card">
    <header class="recommended-workflow-card__header">
      <h3 class="recommended-workflow-card__title">{{ workflow.title }}</h3>
      <span class="recommended-workflow-card__badge yj-badge">{{ workflow.badge }}</span>
    </header>
    <p class="recommended-workflow-card__description">{{ workflow.description }}</p>

    <footer class="recommended-workflow-card__footer">
      <p class="recommended-workflow-card__usage">使用量 <strong>{{ workflow.usage }}</strong></p>
      <div class="recommended-workflow-card__actions" role="group" :aria-label="`${workflow.title}操作`">
        <button v-for="action in workflow.actions" :key="action" type="button"
          class="recommended-workflow-card__action workflow-showcase-control yj-control"
          :class="action === '执行' ? 'recommended-workflow-card__action--primary' : 'recommended-workflow-card__action--secondary'"
          :aria-pressed="selectedAction === action" @click="selectedAction = selectedAction === action ? null : action">{{ action }}</button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.recommended-workflow-card {
  display: flex;
  min-width: 0;
  min-height: calc(var(--yj-space-16) * 3);
  flex-direction: column;
  gap: var(--yj-space-4);
  padding: var(--workflow-card-padding, var(--yj-space-5));
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  box-shadow: none;
}

.recommended-workflow-card__header,
.recommended-workflow-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
}

.recommended-workflow-card__header {
  align-items: flex-start;
  gap: var(--yj-space-2);
}

.recommended-workflow-card__title,
.recommended-workflow-card__description,
.recommended-workflow-card__usage {
  margin: 0;
}

.recommended-workflow-card__title {
  min-width: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.recommended-workflow-card__badge {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.recommended-workflow-card__description {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.recommended-workflow-card__footer {
  flex-wrap: wrap;
  gap: var(--yj-space-2);
  margin-top: auto;
  padding-top: var(--yj-space-4);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.recommended-workflow-card__usage {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recommended-workflow-card__usage strong {
  margin-left: var(--yj-space-1);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
}

.recommended-workflow-card__actions {
  display: flex;
  gap: var(--yj-space-2);
  margin-left: auto;
}

.recommended-workflow-card .recommended-workflow-card__action--primary {
  border-color: var(--yj-color-border-control);
  color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-primary);
  font-weight: var(--yj-font-weight-semibold);
}

.recommended-workflow-card .recommended-workflow-card__action--primary:hover {
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-brand-hover);
}

.recommended-workflow-card .recommended-workflow-card__action--primary[aria-pressed="true"],
.recommended-workflow-card .recommended-workflow-card__action--primary:active {
  border-color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-active);
}

.recommended-workflow-card .recommended-workflow-card__action--secondary {
  color: var(--yj-color-text-secondary);
  font-weight: var(--yj-font-weight-regular);
}

.recommended-workflow-card .recommended-workflow-card__action--secondary[aria-pressed="true"],
.recommended-workflow-card .recommended-workflow-card__action--secondary[aria-pressed="true"]:hover,
.recommended-workflow-card .recommended-workflow-card__action--secondary:active {
  border-color: var(--yj-color-border-control-hover);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-pressed);
  font-weight: var(--yj-font-weight-regular);
}
</style>
