<script setup lang="ts">
import type { RecommendedWorkflow } from "../../domain/workflow-showcase";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{
  workflow: RecommendedWorkflow;
}>();
</script>

<template>
  <article class="recommended-workflow-card">
    <header class="recommended-workflow-card__header">
      <h3 class="recommended-workflow-card__title">{{ workflow.title }}</h3>
      <span
        class="recommended-workflow-card__badge"
        :class="`recommended-workflow-card__badge--${workflow.badge === '热门' ? 'popular' : 'recommended'}`"
      >{{ workflow.badge }}</span>
    </header>

    <p class="recommended-workflow-card__description">{{ workflow.description }}</p>

    <ol class="recommended-workflow-card__flow" :aria-label="`${workflow.title}流程`">
      <li
        v-for="(node, index) in workflow.nodes"
        :key="node.label"
        class="recommended-workflow-card__flow-item"
      >
        <span class="recommended-workflow-card__node" :class="`workflow-accent--${node.accent}`">
          <YjIcon :name="node.icon" size="xl" />
          <span class="recommended-workflow-card__node-label">{{ node.label }}</span>
        </span>
        <YjIcon
          v-if="index < workflow.nodes.length - 1"
          class="recommended-workflow-card__arrow"
          name="arrowRight"
          size="sm"
          tone="muted"
        />
      </li>
    </ol>

    <footer class="recommended-workflow-card__footer">
      <p class="recommended-workflow-card__usage">使用量&nbsp; {{ workflow.usage }}</p>
      <div class="recommended-workflow-card__actions" aria-label="工作流操作（仅展示）">
        <span
          v-for="(action, index) in workflow.actions"
          :key="action"
          class="recommended-workflow-card__action"
          :class="{ 'recommended-workflow-card__action--primary': index === 1 }"
          aria-disabled="true"
        >{{ action }}</span>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.recommended-workflow-card {
  display: flex;
  min-width: 0;
  min-height: calc(var(--yj-space-16) * 4);
  flex-direction: column;
  gap: var(--yj-space-3);
  padding: var(--yj-space-5);
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

.recommended-workflow-card__title,
.recommended-workflow-card__description,
.recommended-workflow-card__usage {
  margin: var(--yj-space-0);
}

.recommended-workflow-card__title {
  min-width: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
}

.recommended-workflow-card__badge {
  flex: none;
  padding: var(--yj-space-1) var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-caption);
}

.recommended-workflow-card__badge--popular {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.recommended-workflow-card__badge--recommended {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.recommended-workflow-card__description,
.recommended-workflow-card__usage {
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.recommended-workflow-card__description { color: var(--yj-color-text-body); }
.recommended-workflow-card__usage { color: var(--yj-color-text-secondary); }

.recommended-workflow-card__flow {
  display: flex;
  align-items: center;
  padding: var(--yj-space-4) var(--yj-space-0);
  margin: var(--yj-space-0);
  list-style: none;
}

.recommended-workflow-card__flow-item {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
}

.recommended-workflow-card__node {
  display: grid;
  min-width: var(--yj-space-12);
  min-height: var(--yj-space-12);
  flex: 1;
  place-items: center;
  gap: var(--yj-space-1);
  padding: var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.recommended-workflow-card__node :deep(.yj-icon) {
  color: inherit;
}

.recommended-workflow-card__node-label {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  text-align: center;
  white-space: nowrap;
}

.recommended-workflow-card__arrow {
  margin-inline: var(--yj-space-1);
}

.recommended-workflow-card__footer {
  margin-top: auto;
}

.recommended-workflow-card__usage {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recommended-workflow-card__actions {
  display: flex;
  gap: var(--yj-space-2);
}

.recommended-workflow-card__action {
  display: inline-flex;
  min-height: var(--yj-space-8);
  align-items: center;
  justify-content: center;
  padding: var(--yj-space-1) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-disabled);
  background: var(--yj-color-control-disabled-bg);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.recommended-workflow-card__action--primary {
  border-color: var(--yj-color-border-default);
  color: var(--yj-color-text-disabled);
  background: var(--yj-color-control-disabled-bg);
}

.workflow-accent--blue { --workflow-accent-color: var(--yj-color-chart-series-2); }
.workflow-accent--green { --workflow-accent-color: var(--yj-color-success); }
.workflow-accent--purple { --workflow-accent-color: var(--yj-color-chart-series-4); }
</style>
