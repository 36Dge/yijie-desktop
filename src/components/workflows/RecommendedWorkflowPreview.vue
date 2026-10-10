<script setup lang="ts">
import { useId } from "vue";
import { NButton, NCard, NModal } from "naive-ui";
import type { RecommendedWorkflow } from "../../domain/workflow-showcase";
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ show: boolean; workflow: RecommendedWorkflow }>();
const emit = defineEmits<{ close: []; closed: [] }>();
const titleId = useId();
const descriptionId = useId();
</script>

<template>
  <NModal :show="show" @update:show="!$event && emit('close')" @after-leave="emit('closed')">
    <NCard :bordered="false" class="recommended-workflow-preview" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="descriptionId">
      <header class="recommended-workflow-preview__header">
        <div class="recommended-workflow-preview__title"><YjIcon :name="workflow.icon" size="xl" /><h2 :id="titleId">{{ workflow.title }}</h2></div>
        <NButton quaternary circle aria-label="关闭工作流预览" @click="emit('close')"><YjIcon name="dismiss" size="sm" /></NButton>
      </header>
      <p :id="descriptionId" class="recommended-workflow-preview__description">{{ workflow.description }}</p>
      <dl class="recommended-workflow-preview__details">
        <div><dt>需要准备</dt><dd>{{ workflow.input }}</dd></div>
        <div><dt>预期产出</dt><dd>{{ workflow.output }}</dd></div>
      </dl>
      <h3>方案步骤</h3>
      <ol class="recommended-workflow-preview__steps"><li v-for="node in workflow.nodes" :key="node.label">{{ node.label }}</li></ol>
      <p class="recommended-workflow-preview__notice">此方案为展示示意，业务节点尚未接入。使用工作流将打开创建表单，确认后创建空白流程，需自行编排。</p>
      <footer><NButton @click="emit('close')">关闭预览</NButton></footer>
    </NCard>
  </NModal>
</template>

<style>
.recommended-workflow-preview { width: min(var(--yj-layout-workflow-create-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8)); overflow: auto; }
</style>
<style scoped>
.recommended-workflow-preview__header, .recommended-workflow-preview__title { display: flex; align-items: center; gap: var(--yj-space-3); }
.recommended-workflow-preview__header { justify-content: space-between; }
.recommended-workflow-preview__title { min-width: 0; }
h2 { margin: 0; font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); overflow-wrap: anywhere; }
h3 { margin: var(--yj-space-5) 0 var(--yj-space-2); font-size: var(--yj-font-size-body); }
.recommended-workflow-preview__description { margin: var(--yj-space-3) 0 var(--yj-space-5); color: var(--yj-color-text-secondary); line-height: var(--yj-line-height-body); }
.recommended-workflow-preview__details { display: grid; gap: var(--yj-space-4); margin: 0; }
dt { margin-bottom: var(--yj-space-1); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
dd { margin: 0; line-height: var(--yj-line-height-body); }
.recommended-workflow-preview__steps { display: grid; gap: var(--yj-space-2); margin: 0; padding-left: var(--yj-space-5); color: var(--yj-color-text-body); }
.recommended-workflow-preview__notice { margin: var(--yj-space-5) 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
footer { display: flex; justify-content: flex-end; }
</style>
