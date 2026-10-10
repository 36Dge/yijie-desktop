<script setup lang="ts">
import { ref } from "vue";
import { NPopover } from "naive-ui";
import type { RecommendedWorkflow } from "../../domain/workflow-showcase";
import YjIcon from "../yijie/YjIcon.vue";
import RecommendedWorkflowPreview from "./RecommendedWorkflowPreview.vue";
defineProps<{ workflow: RecommendedWorkflow }>();
const preview = ref(false);
const exampleNoticeVisible = ref(false);
const previewButton = ref<HTMLButtonElement | null>(null);
function openPreview() {
  // macOS mouse activation does not focus a button; establish the modal's return target.
  previewButton.value?.focus();
  preview.value = true;
}
</script>

<template>
  <article class="recommended-workflow-card workflow-showcase-card">
    <header class="recommended-workflow-card__header workflow-showcase-card__header">
      <span class="recommended-workflow-card__icon workflow-showcase-card__icon" aria-hidden="true"><YjIcon :name="workflow.icon" size="xl" /></span>
      <span class="recommended-workflow-card__badge workflow-showcase-card__badge yj-badge">{{ workflow.badge }}</span>
    </header>
    <div class="recommended-workflow-card__body workflow-showcase-card__body">
      <h3 class="recommended-workflow-card__title workflow-showcase-card__title">{{ workflow.title }}</h3>
      <p class="recommended-workflow-card__description workflow-showcase-card__description" :title="workflow.description">{{ workflow.description }}</p>
    </div>
    <div class="recommended-workflow-card__metadata workflow-showcase-card__metadata">
      <span class="workflow-showcase-card__badge yj-badge">{{ workflow.category }}</span>
      <span class="recommended-workflow-card__usage" title="示例使用次数，非实时统计" :aria-label="`${workflow.usage} 次使用，示例统计`">{{ workflow.usage }} 次使用</span>
    </div>
    <footer class="recommended-workflow-card__footer workflow-showcase-card__footer" role="group" :aria-label="`${workflow.title}操作`">
      <button ref="previewButton" type="button" class="recommended-workflow-card__action workflow-card-action workflow-showcase-control yj-control"
        :aria-label="`预览：${workflow.title}`" aria-haspopup="dialog" :aria-expanded="preview" @click="openPreview">{{ workflow.actions[0] }}</button>
      <NPopover trigger="click" placement="bottom-end" :show="exampleNoticeVisible" @update:show="exampleNoticeVisible = $event">
        <template #trigger>
          <button type="button" class="recommended-workflow-card__action workflow-card-action workflow-card-action--primary workflow-showcase-control yj-control"
            :aria-label="`使用工作流：${workflow.title}`" :aria-expanded="exampleNoticeVisible" @keyup.esc="exampleNoticeVisible = false">{{ workflow.actions[1] }}<YjIcon name="arrowRight" size="sm" /></button>
        </template>
        <p class="recommended-workflow-card__notice" role="status">此工作流为示例方案，暂未开放。可通过「创建工作流」编排自己的流程。</p>
      </NPopover>
    </footer>
  </article>
  <RecommendedWorkflowPreview :show="preview" :workflow="workflow" @close="preview = false" @closed="previewButton?.focus()" />
</template>

<style scoped>
.recommended-workflow-card__badge { margin-left: auto; }
.recommended-workflow-card__usage { font-variant-numeric: tabular-nums; white-space: nowrap; }
.recommended-workflow-card__footer { justify-content: flex-end; }
.recommended-workflow-card__action:first-child { margin-right: auto; }
.recommended-workflow-card__notice {
  max-width: calc(var(--yj-space-16) * 4);
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}
</style>
