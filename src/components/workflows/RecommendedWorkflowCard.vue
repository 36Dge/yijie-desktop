<script setup lang="ts">
import type { RecommendedWorkflow } from "../../domain/workflow-showcase";
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ workflow: RecommendedWorkflow }>();
const stages = ["输入", "处理", "输出"] as const;
</script>

<template>
  <article class="recommended-workflow-card">
    <header class="recommended-workflow-card__header">
      <h3 class="recommended-workflow-card__title">{{ workflow.title }}</h3>
      <span class="recommended-workflow-card__badge yj-badge">{{ workflow.badge }}</span>
    </header>
    <p class="recommended-workflow-card__description">{{ workflow.description }}</p>

    <ol class="recommended-workflow-card__flow" :aria-label="`${workflow.title}流程`">
      <li v-for="(node, index) in workflow.nodes" :key="node.label" class="recommended-workflow-card__flow-item">
        <span class="recommended-workflow-card__step-caption"><span class="recommended-workflow-card__step-number">{{ String(index + 1).padStart(2, '0') }}</span>{{ stages[index] }}</span>
        <span class="recommended-workflow-card__node">
          <span class="recommended-workflow-card__node-icon"><YjIcon :name="node.icon" size="lg" /></span>
          <span class="recommended-workflow-card__node-label">{{ node.label }}</span>
        </span>
        <span v-if="index < workflow.nodes.length - 1" class="recommended-workflow-card__connector" aria-hidden="true"><YjIcon name="chevronRight" size="xs" tone="muted" /></span>
      </li>
    </ol>

    <footer class="recommended-workflow-card__footer">
      <p class="recommended-workflow-card__usage">使用量 <strong>{{ workflow.usage }}</strong></p>
      <div class="recommended-workflow-card__actions" aria-label="工作流操作（仅展示）">
        <span v-for="action in workflow.actions" :key="action" class="recommended-workflow-card__action yj-control" aria-disabled="true">{{ action }}</span>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.recommended-workflow-card {
  display: flex;
  min-width: 0;
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

.recommended-workflow-card__header {
  align-items: flex-start;
}

.recommended-workflow-card__title,
.recommended-workflow-card__description,
.recommended-workflow-card__usage {
  margin: 0;
}

.recommended-workflow-card__title {
  min-width: 0;
  min-height: calc(var(--yj-line-height-card-title) * 2);
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
  min-height: calc(var(--yj-line-height-body) * 2);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.recommended-workflow-card__flow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: var(--yj-space-5) 0;
  margin: 0;
  list-style: none;
}

.recommended-workflow-card__flow-item {
  position: relative;
  display: grid;
  min-width: 0;
  justify-items: center;
  align-content: start;
  gap: var(--yj-space-3);
}

.recommended-workflow-card__step-caption {
  display: flex;
  align-items: center;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.recommended-workflow-card__step-number {
  font-variant-numeric: tabular-nums;
}

.recommended-workflow-card__node {
  position: relative;
  z-index: 1;
  display: grid;
  min-width: 0;
  justify-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-primary);
}

.recommended-workflow-card__node-icon {
  display: inline-flex;
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
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
  overflow-wrap: anywhere;
}

.recommended-workflow-card__connector {
  position: absolute;
  top: calc(var(--yj-line-height-caption) + var(--yj-space-3) + var(--yj-space-5));
  left: calc(50% + var(--yj-space-5) + var(--yj-space-1));
  right: calc(-50% + var(--yj-space-5) + var(--yj-space-1));
  display: flex;
  align-items: center;
  height: var(--yj-border-width);
  border-top: var(--yj-border-width) solid var(--yj-color-border-default);
}

.recommended-workflow-card__connector :deep(.yj-icon) {
  position: absolute;
  top: 0;
  right: 0;
  transform: translateY(-50%);
}

.recommended-workflow-card__footer {
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
}

.recommended-workflow-card__action {
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  color: var(--yj-color-text-disabled);
  background: var(--yj-color-control-disabled-bg);
}
</style>
