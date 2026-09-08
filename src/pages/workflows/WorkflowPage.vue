<script setup lang="ts">
import RecommendedWorkflowCard from "../../components/workflows/RecommendedWorkflowCard.vue";
import WorkflowSummaryCard from "../../components/workflows/WorkflowSummaryCard.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjSection from "../../components/yijie/YjSection.vue";
import { MY_WORKFLOW_FILTERS, MY_WORKFLOWS, RECOMMENDED_WORKFLOWS, WORKFLOW_CATEGORIES } from "../../domain/workflow-showcase";
</script>

<template>
  <YjPage>
    <div class="workflow-page">
      <YjPageHeader title="工作流" description="集中查看常用自动化流程与推荐方案。当前内容仅供展示。" />

      <section class="workflow-page__categories" aria-label="工作流能力分类（仅展示）">
        <ul class="workflow-page__category-list">
          <li v-for="category in WORKFLOW_CATEGORIES" :key="category.id">
            <span class="workflow-page__category yj-control yj-control--pill"
              :class="{ 'workflow-page__category--selected': category.selected }"
              aria-disabled="true"
              :aria-label="category.selected ? `${category.label}，当前展示` : `${category.label}，仅展示`">
              <YjIcon :name="category.icon" size="sm" />
              <span>{{ category.label }}</span>
            </span>
          </li>
        </ul>
      </section>

      <YjSection title="我的工作流">
        <template #actions>
          <span class="workflow-page__create-card yj-control" aria-label="创建工作流，仅展示" aria-disabled="true">
            <YjIcon name="plus" size="sm" tone="muted" />
            创建工作流
          </span>
        </template>
        <div class="workflow-page__toolbar">
          <ul class="workflow-page__filter-list" aria-label="我的工作流分类（仅展示）">
            <li v-for="filter in MY_WORKFLOW_FILTERS" :key="filter.id">
              <span class="workflow-page__filter yj-control yj-control--pill"
                :class="{ 'workflow-page__filter--selected': filter.selected }" aria-disabled="true">
                <YjIcon v-if="filter.icon" :name="filter.icon" size="sm" />
                {{ filter.label }}
              </span>
            </li>
          </ul>
          <div class="workflow-page__display-options" aria-label="排序和视图（仅展示）">
            <span class="workflow-page__sort yj-control" aria-disabled="true">
              最近修改 <YjIcon name="chevronDown" size="sm" tone="muted" />
            </span>
            <span class="workflow-page__view workflow-page__view--selected yj-control yj-control--icon" aria-label="网格视图，当前展示" role="img">
              <YjIcon name="gridView" size="sm" />
            </span>
            <span class="workflow-page__view yj-control yj-control--icon" aria-label="列表视图，仅展示" role="img">
              <YjIcon name="listView" size="sm" tone="muted" />
            </span>
          </div>
        </div>
        <ul class="workflow-page__my-grid" aria-label="我的工作流列表">
          <li v-for="workflow in MY_WORKFLOWS" :key="workflow.id"><WorkflowSummaryCard :workflow="workflow" /></li>
        </ul>
      </YjSection>

      <YjSection title="推荐工作流" icon="refresh">
        <template #actions>
          <span class="workflow-page__view-all yj-control" aria-disabled="true">
            查看全部 <YjIcon name="chevronRight" size="sm" />
          </span>
        </template>
        <ul class="workflow-page__recommended-grid" aria-label="推荐工作流列表">
          <li v-for="workflow in RECOMMENDED_WORKFLOWS" :key="workflow.id"><RecommendedWorkflowCard :workflow="workflow" /></li>
        </ul>
      </YjSection>
    </div>
  </YjPage>
</template>

<style scoped>
.workflow-page {
  display: grid;
  align-content: start;
  gap: var(--yj-space-8);
  container: workflow-page / inline-size;
}

.workflow-page__categories {
  padding-bottom: var(--yj-space-6);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.workflow-page__category-list,
.workflow-page__filter-list,
.workflow-page__my-grid,
.workflow-page__recommended-grid {
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-page__category-list,
.workflow-page__filter-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--yj-space-2);
}

.workflow-page__category,
.workflow-page__filter,
.workflow-page__sort,
.workflow-page__view,
.workflow-page__view-all {
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.workflow-page__category :deep(.yj-icon),
.workflow-page__filter :deep(.yj-icon),
.workflow-page__view :deep(.yj-icon) {
  color: inherit;
}

.workflow-page__category--selected,
.workflow-page__filter--selected,
.workflow-page__view--selected {
  border-color: var(--yj-color-on-brand);
  color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-primary);
  font-weight: var(--yj-font-weight-semibold);
}

.workflow-page__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3) var(--yj-space-5);
}

.workflow-page__filter-list {
  flex: 1 1 auto;
}

.workflow-page__display-options {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--yj-space-2);
}

.workflow-page__my-grid,
.workflow-page__recommended-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--yj-space-4);
}

.workflow-page__my-grid > li,
.workflow-page__recommended-grid > li {
  min-width: 0;
}

.workflow-page__my-grid > li > *,
.workflow-page__recommended-grid > li > * {
  height: 100%;
}

.workflow-page__create-card {
  border: var(--yj-border-width) dashed var(--yj-color-border-strong);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-page);
}

.workflow-page__view-all {
  border-color: transparent;
  color: var(--yj-color-text-primary);
  background: transparent;
  padding-right: 0;
}

@container workflow-page (min-width: 1120px) {
  .workflow-page__my-grid,
  .workflow-page__recommended-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@container workflow-page (max-width: 980px) {
  .workflow-page__category-list {
    display: grid;
    grid-template-columns: repeat(5, max-content);
  }
  .workflow-page__category {
    width: 100%;
  }
}

@container workflow-page (max-width: 600px) {
  .workflow-page__category-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .workflow-page__my-grid,
  .workflow-page__recommended-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
