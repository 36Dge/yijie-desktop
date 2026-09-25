<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import type { WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowCreateDialog from "../../components/workflows/WorkflowCreateDialog.vue";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { useWorkflowDeletion } from "./use-workflow-deletion";
import WorkflowDeleteDialog from "../../components/workflows/WorkflowDeleteDialog.vue";
import { workflowCards } from "./workflow-cards";
import WorkflowCardRail from "../../components/workflows/WorkflowCardRail.vue";
import RecommendedWorkflowCard from "../../components/workflows/RecommendedWorkflowCard.vue";
import WorkflowSummaryCard from "../../components/workflows/WorkflowSummaryCard.vue";
import { workflowLocalUiEnabled } from "../../authorization/workflow-local-ui-config";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjSection from "../../components/yijie/YjSection.vue";
import { MY_WORKFLOW_FILTERS, MY_WORKFLOWS, RECOMMENDED_WORKFLOWS, WORKFLOW_CATEGORIES } from "../../domain/workflow-showcase";
import "../../components/workflows/workflow-showcase.css";

// The existing showcase filters remain local selection feedback.
const selectedCategory = ref("all");
const selectedFilter = ref("all");
const selectedView = ref("grid");
const selectedSort = ref("modified");
const viewAllSelected = ref(false);
const state = useWorkflowWorkspace();
const removedIds = ref(new Set<string>());
const deletion = useWorkflowDeletion(id => {
  removedIds.value = new Set([...removedIds.value, id]);
  state.workflows.value = state.workflows.value.filter(row => row.workflow_id !== id);
  void state.refresh();
});
let deleteReturnTarget: HTMLButtonElement | null = null;
function requestDelete(id: string, trigger: HTMLButtonElement | null) {
  const workflow = state.workflows.value.find(row => row.workflow_id === id);
  if (!workflow || !workflowLocalUiEnabled) return;
  deleteReturnTarget = trigger;
  deletion.select(workflow);
}
function cancelDelete() { deletion.cancel(); if (!deletion.blocked.value) void state.refresh(); }
async function restoreDeleteFocus() { await nextTick(); (deleteReturnTarget?.isConnected ? deleteReturnTarget : createTrigger.value)?.focus(); }
function editWorkflow(id: string) { void router.push({ name: "workflow-editor", params: { workflowId: id } }); }
const { loading, error, nextCursor, creating, createUncertain, pendingCreate, createdWorkflowId } = state;
const router = useRouter();
const route = useRoute();
const showCreate = ref(false);
const createTrigger = ref<HTMLButtonElement | null>(null);
watch(() => route.query.create, value => { if (value === "1") openCreate(); });
function openCreate() {
  // macOS mouse activation does not focus buttons; give the modal a real return target.
  createTrigger.value?.focus();
  state.error.value = null;
  state.createdWorkflowId.value = null;
  showCreate.value = true;
}
function cancelCreate() {
  if (creating.value || createUncertain.value) return;
  showCreate.value = false;
  if (route.query.create) void router.replace({ path: "/workflows" });
}
async function enterCreated() {
  if (createdWorkflowId.value) await router.push({ name: "workflow-editor", params: { workflowId: createdWorkflowId.value } });
}
async function confirmCreate(input: WorkflowSchemas["CreateInput"]) {
  if (!workflowLocalUiEnabled) return;
  await state.create(input.name, input.description, false);
  await enterCreated();
}
async function queryCreate() { await state.queryPendingCreate(false); await enterCreated(); }
onBeforeRouteLeave(() => {
  if (deletion.blocked.value) return false;
  if (creating.value || createUncertain.value) { showCreate.value = true; return false; }
  return true;
});
const cards = computed(() => workflowCards(workflowLocalUiEnabled ? state.workflows.value.filter(row => !removedIds.value.has(row.workflow_id)) : [], MY_WORKFLOWS));
onMounted(() => {
  if (workflowLocalUiEnabled) void state.refresh();
  if (route.query.create === "1") openCreate();
});
const sortOptions = [
  { value: "modified", label: "最近修改" },
  { value: "created", label: "最近创建" },
  { value: "name", label: "名称排序" },
] as const;
</script>

<template>
  <YjPage>
    <div class="workflow-page">
      <YjPageHeader title="工作流">
        <template #description><template v-if="workflowLocalUiEnabled">集中管理和编排本地文本流程，点击<span class="workflow-page__create-highlight">创建工作流</span>开始。电商推荐方案仍为示意。</template><template v-else>集中查看常用自动化流程与推荐方案，工作流方案正在实现中，点击<span class="workflow-page__create-highlight">创建工作流</span>按钮。</template></template>
      </YjPageHeader>

      <section class="workflow-page__categories" aria-label="工作流能力分类">
        <ul class="workflow-page__category-list">
          <li v-for="category in WORKFLOW_CATEGORIES" :key="category.id">
            <button type="button" class="workflow-page__category workflow-showcase-control yj-control yj-control--pill"
              :aria-pressed="selectedCategory === category.id"
              @click="selectedCategory = category.id">
              <YjIcon :name="category.icon" size="sm" />
              <span>{{ category.label }}</span>
            </button>
          </li>
        </ul>
      </section>

      <YjSection title="我的工作流" icon="workflow">
        <template #actions>
          <button ref="createTrigger" type="button" class="workflow-page__create-card workflow-showcase-control yj-control" @click="openCreate">
            <YjIcon name="plus" size="sm" tone="muted" />
            创建工作流
          </button>
        </template>
        <div class="workflow-page__toolbar">
          <ul class="workflow-page__filter-list" aria-label="我的工作流分类">
            <li v-for="filter in MY_WORKFLOW_FILTERS" :key="filter.id">
              <button type="button" class="workflow-page__filter workflow-showcase-control yj-control yj-control--pill"
                :aria-pressed="selectedFilter === filter.id" @click="selectedFilter = filter.id">
                <YjIcon v-if="filter.icon" :name="filter.icon" size="sm" />
                {{ filter.label }}
              </button>
            </li>
          </ul>
          <div class="workflow-page__display-options" role="group" aria-label="排序和视图">
            <span class="workflow-page__sort-wrapper">
              <select v-model="selectedSort" class="workflow-page__sort workflow-showcase-control yj-control yj-input-control" aria-label="工作流排序">
                <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <YjIcon name="chevronDown" size="sm" tone="muted" />
            </span>
            <button type="button" class="workflow-page__view workflow-showcase-control yj-control yj-control--icon"
              aria-label="网格视图" :aria-pressed="selectedView === 'grid'" @click="selectedView = 'grid'">
              <YjIcon name="gridView" size="sm" />
            </button>
            <button type="button" class="workflow-page__view workflow-showcase-control yj-control yj-control--icon"
              aria-label="列表视图" :aria-pressed="selectedView === 'list'" @click="selectedView = 'list'">
              <YjIcon name="listView" size="sm" tone="muted" />
            </button>
          </div>
        </div>
        <p v-if="workflowLocalUiEnabled && loading" class="workflow-page__notice" role="status">正在读取工作流…</p>
        <div v-if="workflowLocalUiEnabled && error" class="workflow-page__notice" role="alert">
          <span>{{ error.message }}</span>
          <button type="button" class="workflow-showcase-control yj-control" :disabled="loading" @click="state.refresh()">重新连接</button>
        </div>
        <p v-if="deletion.notice.value" role="status" class="workflow-page__notice">{{ deletion.notice.value }}</p>
        <WorkflowCardRail :count="cards.length">
          <li v-for="card in cards" :key="card.workflow.id"><WorkflowSummaryCard :workflow="card.workflow" :to="card.to" :example="workflowLocalUiEnabled && card.example" @edit="editWorkflow(card.workflow.id)" @delete="requestDelete(card.workflow.id, $event)" /></li>
        </WorkflowCardRail>
        <button v-if="workflowLocalUiEnabled && nextCursor" type="button" class="workflow-showcase-control yj-control" :disabled="loading" @click="state.refresh(true)">加载更多工作流</button>
      </YjSection>

      <YjSection :title="workflowLocalUiEnabled ? '推荐工作流 · 方案示意' : '推荐工作流'" icon="skillContentStrategy">
        <template #actions>
          <button type="button" class="workflow-page__view-all workflow-showcase-control yj-control"
            :aria-pressed="viewAllSelected" @click="viewAllSelected = !viewAllSelected">
            查看全部 <YjIcon name="chevronRight" size="sm" />
          </button>
        </template>
        <ul class="workflow-page__recommended-grid" aria-label="推荐工作流列表">
          <li v-for="workflow in RECOMMENDED_WORKFLOWS" :key="workflow.id"><RecommendedWorkflowCard :workflow="workflow" /></li>
        </ul>
      </YjSection>
    </div>
    <WorkflowDeleteDialog :target="deletion.target.value" :busy="deletion.busy.value" :uncertain="deletion.uncertain.value" :error="deletion.error.value" @cancel="cancelDelete" @confirm="deletion.confirm" @closed="restoreDeleteFocus" />
    <WorkflowCreateDialog :show="showCreate" :busy="creating" :uncertain="createUncertain" :queryable="!!pendingCreate" :created="!!createdWorkflowId"
      :available="workflowLocalUiEnabled" :error="error?.message" @closed="createTrigger?.focus()" @cancel="cancelCreate" @confirm="confirmCreate" @query="queryCreate" @enter="enterCreated" />
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

.workflow-page__create-highlight {
  color: var(--yj-color-workflow-create-ink);
  font-weight: var(--yj-font-weight-semibold);
  white-space: nowrap;
}

.workflow-page__sort-wrapper {
  position: relative;
  display: inline-flex;
}

.workflow-page__sort {
  appearance: none;
  padding-right: var(--yj-space-8);
  border-color: var(--yj-color-border-control);
}

.workflow-page__sort-wrapper > :deep(.yj-icon) {
  position: absolute;
  top: 50%;
  right: var(--yj-space-3);
  transform: translateY(-50%);
  pointer-events: none;
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

.workflow-page__recommended-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--yj-space-4);
}

.workflow-page__recommended-grid > li {
  min-width: 0;
}

.workflow-page__recommended-grid > li > * {
  height: 100%;
}

.workflow-page__create-card {
  text-decoration: none;
  border-style: dashed;
  border-color: var(--yj-color-border-control);
}

.workflow-page__view-all {
  border-color: transparent;
  color: var(--yj-color-text-primary);
  background: transparent;
}

@container workflow-page (min-width: 1120px) {
    .workflow-page__recommended-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@container workflow-page (max-width: 600px) {
    .workflow-page__recommended-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.workflow-page__notice { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-3); color: var(--yj-color-text-secondary); }
</style>
