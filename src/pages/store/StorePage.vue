<script setup lang="ts">
import { computed, ref } from "vue";
import StoreSceneCard from "../../components/store/StoreSceneCard.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjMetricCard from "../../components/yijie/YjMetricCard.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjSection from "../../components/yijie/YjSection.vue";
import YjTabs from "../../components/yijie/YjTabs.vue";
import {
  STORE_BUSINESS_BRIEFS,
  STORE_CURATED_FILTERS,
  STORE_ROLE_FILTERS,
  getCuratedScenes,
  getRoleScenes,
  getStoreBusinessBrief,
  type StoreBriefId,
  type StoreCuratedFilterId,
  type StoreRoleFilterId,
} from "../../domain/store-showcase";

const selectedBriefId = ref<StoreBriefId>("sales");
const selectedCuratedFilter = ref<StoreCuratedFilterId>("all");
const selectedRoleFilter = ref<StoreRoleFilterId>("all");

const briefTabs = STORE_BUSINESS_BRIEFS.map(({ id, label }) => ({ key: id, label }));
const curatedTabs = STORE_CURATED_FILTERS.map(({ id, label }) => ({ key: id, label }));
const roleTabs = STORE_ROLE_FILTERS.map(({ id, label }) => ({ key: id, label }));

const currentBrief = computed(() => getStoreBusinessBrief(selectedBriefId.value));
const curatedScenes = computed(() => getCuratedScenes(selectedCuratedFilter.value));
const roleScenes = computed(() => getRoleScenes(selectedRoleFilter.value));
const currentCuratedLabel = computed(() =>
  STORE_CURATED_FILTERS.find(({ id }) => id === selectedCuratedFilter.value)?.label ?? "全部",
);
const currentRoleLabel = computed(() =>
  STORE_ROLE_FILTERS.find(({ id }) => id === selectedRoleFilter.value)?.label ?? "全部",
);

function updateBriefId(value: string): void {
  const option = STORE_BUSINESS_BRIEFS.find(({ id }) => id === value);
  if (option) selectedBriefId.value = option.id;
}

function updateCuratedFilter(value: string): void {
  const option = STORE_CURATED_FILTERS.find(({ id }) => id === value);
  if (option) selectedCuratedFilter.value = option.id;
}

function updateRoleFilter(value: string): void {
  const option = STORE_ROLE_FILTERS.find(({ id }) => id === value);
  if (option) selectedRoleFilter.value = option.id;
}
</script>

<template>
  <YjPage>
    <div class="store-page">
      <YjPageHeader
        title="我的店铺"
        description="把经营信号和常用分析场景放在一处，快速找到下一项值得处理的工作。"
      />

      <div class="store-page__demo-notice" role="status">
        <span class="store-page__demo-icon" aria-hidden="true">
          <YjIcon name="store" tone="primary" />
        </span>
        <div>
          <p class="store-page__demo-title">演示内容</p>
          <p class="store-page__demo-copy">
            本页指标、趋势和场景热度均为本地合成内容，不代表任何真实店铺表现。
          </p>
        </div>
      </div>

      <div class="store-page__module store-page__module--brief">
        <YjSection
          title="经营快报"
          description="最近 7 天 · 固定演示口径 · 无店铺数据连接"
          icon="workspace"
        >
          <template #actions>
            <YjTabs
              :items="briefTabs"
              :model-value="selectedBriefId"
              aria-label="经营快报类型"
              panel-id="store-brief-panel"
              @update:model-value="updateBriefId"
            />
          </template>

          <div
            class="store-page__brief-panel"
            role="tabpanel"
            id="store-brief-panel"
            tabindex="0"
            :aria-labelledby="`store-brief-panel-tab-${selectedBriefId}`"
          >
            <div class="store-page__brief-heading">
              <div>
                <h3 class="store-page__brief-title">{{ currentBrief.title }}</h3>
                <p class="store-page__brief-description">{{ currentBrief.description }}</p>
              </div>
              <span class="store-page__source-label">本地合成</span>
            </div>

            <ul class="store-page__metric-grid" aria-label="经营快报指标">
              <li v-for="metric in currentBrief.metrics" :key="metric.id">
                <YjMetricCard
                  :label="metric.label"
                  :value="metric.value"
                  :unit="metric.unit"
                  :trend="{
                    direction: metric.trend === 'neutral' ? 'flat' : metric.trend,
                    value: metric.comparison,
                    tone: 'neutral',
                  }"
                />
              </li>
            </ul>
          </div>
        </YjSection>
      </div>

      <div class="store-page__module">
        <YjSection
          title="精选场景"
          description="按经营目标查看适合当前问题的分析方向。"
          icon="skillResearch"
        >
          <template #actions>
            <YjTabs
              :items="curatedTabs"
              :model-value="selectedCuratedFilter"
              aria-label="精选场景筛选"
              panel-id="store-curated-panel"
              @update:model-value="updateCuratedFilter"
            />
          </template>

          <div
            id="store-curated-panel"
            class="store-page__scene-panel"
            role="tabpanel"
            tabindex="0"
            :aria-labelledby="`store-curated-panel-tab-${selectedCuratedFilter}`"
          >
            <p class="store-page__filter-summary" aria-live="polite">
              {{ currentCuratedLabel }} · {{ curatedScenes.length }} 个演示场景
            </p>
            <ul v-if="curatedScenes.length > 0" class="store-page__scene-grid store-page__scene-grid--curated">
              <li v-for="scene in curatedScenes" :key="scene.id">
                <StoreSceneCard :scene="scene" />
              </li>
            </ul>
            <YjEmpty
              v-else
              title="该筛选暂无演示场景"
              description="请选择其他经营目标继续浏览。"
              icon="store"
            />
          </div>
        </YjSection>
      </div>

      <div class="store-page__module">
        <YjSection
          title="角色场景推荐"
          description="按岗位聚合日常关注点，帮助团队更快进入工作。"
          icon="user"
        >
          <template #actions>
            <YjTabs
              :items="roleTabs"
              :model-value="selectedRoleFilter"
              aria-label="角色场景筛选"
              panel-id="store-role-panel"
              @update:model-value="updateRoleFilter"
            />
          </template>

          <div
            id="store-role-panel"
            class="store-page__scene-panel"
            role="tabpanel"
            tabindex="0"
            :aria-labelledby="`store-role-panel-tab-${selectedRoleFilter}`"
          >
            <p class="store-page__filter-summary" aria-live="polite">
              {{ currentRoleLabel }} · {{ roleScenes.length }} 个演示场景
            </p>
            <ul v-if="roleScenes.length > 0" class="store-page__scene-grid store-page__scene-grid--roles">
              <li v-for="scene in roleScenes" :key="scene.id">
                <StoreSceneCard :scene="scene" />
              </li>
            </ul>
            <YjEmpty
              v-else
              title="该角色暂无演示场景"
              description="请选择其他岗位继续浏览。"
              icon="user"
            />
          </div>
        </YjSection>
      </div>
    </div>
  </YjPage>
</template>

<style scoped>
.store-page {
  display: grid;
  align-content: start;
  gap: var(--yj-space-6);
}

.store-page__demo-notice {
  display: flex;
  align-items: flex-start;
  padding: var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-brand-border);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-brand-soft);
  gap: var(--yj-space-3);
}

.store-page__demo-icon {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-card);
}

.store-page__demo-title,
.store-page__demo-copy,
.store-page__brief-title,
.store-page__brief-description,
.store-page__filter-summary {
  margin: var(--yj-space-0);
}

.store-page__demo-title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.store-page__demo-copy,
.store-page__brief-description,
.store-page__filter-summary {
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.store-page__demo-copy,
.store-page__brief-description {
  color: var(--yj-color-text-secondary);
}

.store-page__module {
  min-width: 0;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-xl);
  background: linear-gradient(
    135deg,
    var(--yj-color-brand-soft),
    var(--yj-color-bg-page)
  );
}

.store-page__brief-panel {
  display: grid;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  gap: var(--yj-space-4);
}

.store-page__brief-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-4);
}

.store-page__brief-title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
}

.store-page__source-label {
  flex: none;
  padding: var(--yj-space-1) var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-brand-text);
  background: var(--yj-color-brand-soft);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.store-page__metric-grid,
.store-page__scene-grid {
  display: grid;
  padding: var(--yj-space-0);
  margin: var(--yj-space-0);
  gap: var(--yj-space-4);
  list-style: none;
}

.store-page__scene-panel {
  display: grid;
  gap: var(--yj-space-4);
}

.store-page__brief-panel:focus-visible,
.store-page__scene-panel:focus-visible {
  outline: var(--yj-border-width) solid var(--yj-color-brand-primary);
  outline-offset: var(--yj-space-1);
}

.store-page__metric-grid {
  grid-template-columns: repeat(
    auto-fit,
    minmax(calc(var(--yj-space-16) * 2), 1fr)
  );
}

.store-page__metric-grid > li,
.store-page__scene-grid > li {
  min-width: 0;
}

.store-page__metric-grid > li > *,
.store-page__scene-grid > li > * {
  height: 100%;
}

.store-page__filter-summary {
  color: var(--yj-color-text-tertiary);
}

.store-page__scene-grid--curated {
  grid-template-columns: repeat(
    auto-fit,
    minmax(calc(var(--yj-space-16) * 4), 1fr)
  );
}

.store-page__scene-grid--roles {
  grid-template-columns: repeat(
    auto-fit,
    minmax(calc(var(--yj-space-16) * 3), 1fr)
  );
}
</style>
