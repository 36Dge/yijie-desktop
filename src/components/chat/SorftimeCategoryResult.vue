<script setup lang="ts">
import { computed, ref, useId } from "vue";
import type { SorftimeCategoryResult } from "../../domain/sorftime-category-result";

const props = defineProps<{ result: SorftimeCategoryResult }>();
const previewLimit = 3;
const showAll = ref(false);
const listId = useId();
const visible = computed(() => showAll.value ? props.result.categories : props.result.categories.slice(0, previewLimit));
</script>

<template>
  <div class="category-result yj-selectable-text">
    <p class="category-result__summary">{{ result.summary }}</p>
    <ol v-if="visible.length" :id="listId" class="category-result__list" aria-label="匹配的 Amazon 类目">
      <li v-for="(category, index) in visible" :key="index">
        <strong class="category-result__name">{{ category.name }}</strong>
        <dl v-if="category.nodeId || category.season" class="category-result__identity">
          <div v-if="category.nodeId"><dt>节点 ID</dt><dd>{{ category.nodeId }}</dd></div>
          <div v-if="category.season"><dt>旺季</dt><dd>{{ category.season }}</dd></div>
        </dl>
        <div v-if="category.metrics.length" class="category-result__market">
          <p>前 100 款商品</p>
          <dl class="category-result__metrics" aria-label="前 100 款商品指标">
            <div v-for="metric in category.metrics" :key="metric.label">
              <dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd>
            </div>
          </dl>
        </div>
      </li>
    </ol>
    <button v-if="result.categories.length > previewLimit" class="category-result__more" type="button"
      :aria-controls="listId" :aria-expanded="showAll" @click="showAll = !showAll">
      {{ showAll ? "收起更多类目" : `查看其余 ${result.categories.length - previewLimit} 个类目` }}
    </button>
  </div>
</template>

<style scoped>
.category-result, .category-result__list { display: grid; min-width: 0; gap: var(--yj-space-3); }
.category-result p, .category-result dl, .category-result dd, .category-result__list { margin: 0; }
.category-result__summary { color: var(--yj-color-text-secondary); }
.category-result__list { list-style: none; padding: 0; }
.category-result__list > li { display: grid; min-width: 0; gap: var(--yj-space-1); }
.category-result__list > li + li {
  border-block-start: var(--yj-border-width) solid var(--yj-color-border-subtle);
  padding-block-start: var(--yj-space-3);
}
.category-result__name { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-medium); }
.category-result__identity, .category-result__metrics { display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-5); }
.category-result__identity > div { display: flex; flex-wrap: wrap; gap: var(--yj-space-1); }
.category-result dt, .category-result__market > p { color: var(--yj-color-text-secondary); }
.category-result dd { font-variant-numeric: tabular-nums; }
.category-result__market { display: grid; gap: var(--yj-space-1); margin-block-start: var(--yj-space-2); }
.category-result__metrics { gap: var(--yj-space-2) var(--yj-space-6); }
.category-result__metrics dd { font-size: var(--yj-font-size-body); color: var(--yj-color-text-primary); }
.category-result__more {
  justify-self: start; border: 0; background: transparent; color: var(--yj-color-text-secondary);
  font: inherit; padding: var(--yj-space-1) 0; cursor: pointer;
}
.category-result__more:is(:hover, :focus-visible) { color: var(--yj-color-text-primary); text-decoration: underline; }
.category-result__more:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
