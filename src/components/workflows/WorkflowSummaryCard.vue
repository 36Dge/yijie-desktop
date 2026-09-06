<script setup lang="ts">
import type { MyWorkflow } from "../../domain/workflow-showcase";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  workflow: MyWorkflow;
}>();
</script>

<template>
  <article class="workflow-summary-card">
    <header class="workflow-summary-card__header">
      <span
        class="workflow-summary-card__icon"
        :class="`workflow-accent--${workflow.accent}`"
        aria-hidden="true"
      >
        <YjIcon :name="workflow.icon" size="xl" />
      </span>
      <span
        class="workflow-summary-card__more"
        aria-label="更多，仅展示"
        role="img"
      >
        <YjIcon name="more" size="sm" />
      </span>
    </header>

    <div class="workflow-summary-card__body">
      <h3 class="workflow-summary-card__title">{{ workflow.title }}</h3>
      <span
        class="workflow-summary-card__badge"
        :class="`workflow-accent--${workflow.accent}`"
      >{{ workflow.badge }}</span>
      <p class="workflow-summary-card__description">{{ workflow.description }}</p>
    </div>

    <p class="workflow-summary-card__modified">
      修改于
      <time :datetime="workflow.modifiedAt.replace(' ', 'T')">{{ workflow.modifiedAt }}</time>
    </p>
  </article>
</template>

<style scoped>
.workflow-summary-card {
  display: flex;
  min-width: 0;
  min-height: calc(var(--yj-space-16) * 5);
  flex-direction: column;
  gap: var(--yj-space-5);
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  box-shadow: none;
}

.workflow-summary-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-4);
}

.workflow-summary-card__icon,
.workflow-summary-card__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.workflow-summary-card__icon {
  width: var(--yj-space-12);
  height: var(--yj-space-12);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.workflow-summary-card__icon :deep(.yj-icon) {
  color: inherit;
}

.workflow-summary-card__more {
  min-width: var(--yj-space-8);
  min-height: var(--yj-space-6);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-tertiary);
  background: var(--yj-color-bg-page);
}

.workflow-summary-card__body {
  display: grid;
  min-width: 0;
  justify-items: start;
  gap: var(--yj-space-3);
}

.workflow-summary-card__title,
.workflow-summary-card__description,
.workflow-summary-card__modified {
  margin: var(--yj-space-0);
}

.workflow-summary-card__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
}

.workflow-summary-card__badge {
  padding: var(--yj-space-1) var(--yj-space-2);
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-hover);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-caption);
}

.workflow-summary-card__description {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.workflow-summary-card__modified {
  margin-top: auto;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-variant-numeric: tabular-nums;
}

.workflow-accent--blue { --workflow-accent-color: var(--yj-color-chart-series-2); }
.workflow-accent--green { --workflow-accent-color: var(--yj-color-success); }
.workflow-accent--purple { --workflow-accent-color: var(--yj-color-chart-series-4); }
</style>
