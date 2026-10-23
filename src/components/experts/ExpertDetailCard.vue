<script setup lang="ts">
import { useId } from "vue";
import { NButton, NCard, NTooltip } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import { expertPromptLabel } from "../../data/expert-prompt-labels";

withDefaults(defineProps<{
  name: string;
  developer: string;
  version: string;
  expertId: string;
  description: string;
  tags: readonly string[];
  quickPrompts: readonly string[];
  knowledgeSummary?: string;
  usageCount?: number | null;
  interactive?: boolean;
  disabled?: boolean;
}>(), { knowledgeSummary: "", usageCount: null, interactive: false, disabled: false });
const emit = defineEmits<{ close: []; prompt: [prompt: string] }>();
const titleId = useId();
</script>

<template>
  <NCard class="expert-detail" role="dialog" aria-modal="true" :aria-labelledby="titleId" :bordered="false">
    <template #header>
      <div class="expert-detail__header">
        <slot name="avatar" />
        <div class="expert-detail__identity">
          <div class="expert-detail__title-row">
            <h2 :id="titleId">{{ name }}</h2>
            <span class="expert-detail__byline">{{ developer }}</span>
          </div>
          <div class="expert-detail__action"><slot name="action" /></div>
        </div>
      </div>
    </template>
    <template #header-extra>
      <NButton quaternary circle size="small" class="expert-detail__close" aria-label="关闭专家详情" @click="emit('close')"><YjIcon name="dismiss" size="md" /></NButton>
    </template>
    <div class="expert-detail__body">
      <slot name="feedback" />
      <div class="expert-detail__overview">
        <p class="expert-detail__description">{{ description }}</p>
        <div v-if="tags.length" class="expert-detail__tags" aria-label="擅长领域">
          <span v-for="tag in tags" :key="tag" class="expert-detail__tag">{{ tag }}</span>
        </div>
      </div>
      <dl class="expert-detail__facts">
        <div><dt>版本</dt><dd>{{ version ? `v${version.replace(/^v/, '')}` : '暂无版本' }}</dd></div>
        <div><dt>使用量</dt><dd :class="{ 'expert-detail__unknown': usageCount === null }">{{ usageCount === null ? '暂无统计' : usageCount.toLocaleString('zh-CN') }}</dd></div>
        <div><dt>开发者信息</dt><dd class="expert-detail__developer"><YjIcon name="user" size="sm" />{{ developer }}</dd></div>
      </dl>
      <section v-if="quickPrompts.length" class="expert-detail__section" aria-label="专家帮你做">
        <h3><YjIcon name="lightbulb" size="lg" />专家帮你做</h3>
        <ul class="expert-detail__prompts">
          <li v-for="prompt in quickPrompts" :key="prompt">
            <NTooltip v-if="interactive" placement="top-end" :disabled="disabled">
              <template #trigger>
                <button type="button" class="expert-detail__prompt" :disabled="disabled" :aria-label="`去试试：${prompt}`" @click="emit('prompt', prompt)">
                  <span>“{{ expertPromptLabel(prompt) }}”</span><YjIcon name="arrowUpRight" size="sm" tone="muted" :stroke-width="1.5" />
                </button>
              </template>
              去试试
            </NTooltip>
            <p v-else class="expert-detail__prompt expert-detail__prompt--readonly" :title="prompt"><span>{{ expertPromptLabel(prompt) }}</span></p>
          </li>
        </ul>
      </section>
      <section class="expert-detail__section" aria-label="更多专家信息">
        <h3><YjIcon name="listView" size="lg" />更多</h3>
        <dl class="expert-detail__more">
          <div><dt>ID</dt><dd>{{ expertId }}</dd></div>
          <div v-if="knowledgeSummary" class="expert-detail__knowledge"><dt>知识范围</dt><dd>{{ knowledgeSummary }}</dd></div>
        </dl>
      </section>
    </div>
  </NCard>
</template>

<style scoped>
.expert-detail {
  display: flex;
  width: min(var(--yj-layout-expert-detail-width), calc(100vw - var(--yj-space-8)));
  min-height: min(var(--yj-layout-expert-detail-min-height), calc(100vh - var(--yj-space-16)));
  max-height: calc(100vh - var(--yj-space-16));
  overflow: hidden;
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-modal);
}
.expert-detail :deep(.n-card-header) { flex: none; align-items: flex-start; gap: var(--yj-space-4); padding: var(--yj-space-6) var(--yj-space-6) var(--yj-space-5); }
.expert-detail :deep(.n-card-header__main) { min-width: 0; }
.expert-detail :deep(.n-card-content) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--yj-space-6) var(--yj-space-6); }
.expert-detail__header { display: flex; align-items: flex-start; gap: var(--yj-space-4); }
.expert-detail__identity { min-width: 0; flex: 1; }
.expert-detail__title-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--yj-space-2) var(--yj-space-3); }
.expert-detail__title-row h2 { margin: 0; font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-semibold); color: var(--yj-color-text-primary); overflow-wrap: anywhere; }
.expert-detail__byline { padding-inline-start: var(--yj-space-3); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-default); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); font-weight: var(--yj-font-weight-regular); overflow-wrap: anywhere; }
.expert-detail__action { display: flex; align-items: center; min-height: var(--yj-control-height-sm); margin-top: var(--yj-space-2); }
.expert-detail__body { display: flex; flex-direction: column; gap: var(--yj-space-5); color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.expert-detail__overview { display: grid; gap: var(--yj-space-3); }
.expert-detail__description { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.expert-detail__tags { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.expert-detail__tag { padding: var(--yj-space-1) var(--yj-space-2); border-radius: var(--yj-radius-sm); background: var(--yj-color-control-hover); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-badge-line-height); overflow-wrap: anywhere; }
.expert-detail__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--yj-space-4); margin: 0; padding: var(--yj-space-4) 0; border-block: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.expert-detail__facts > div { display: flex; min-width: 0; flex-direction: column-reverse; align-items: center; justify-content: flex-end; gap: var(--yj-space-1); text-align: center; }
.expert-detail__facts dt { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.expert-detail__facts dd { display: flex; align-items: center; justify-content: center; gap: var(--yj-space-2); margin: 0; max-width: 100%; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.expert-detail__facts dd.expert-detail__developer,
.expert-detail__facts dd.expert-detail__unknown { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-medium); }
.expert-detail__facts dd.expert-detail__unknown { color: var(--yj-color-text-secondary); font-weight: var(--yj-font-weight-regular); }
.expert-detail__facts .yj-icon { flex: none; }
.expert-detail__section { display: grid; gap: var(--yj-space-3); }
.expert-detail__section h3 { display: flex; align-items: center; gap: var(--yj-space-2); margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); }
.expert-detail__prompts { display: grid; gap: var(--yj-space-2); margin: 0; padding: 0; list-style: none; }
.expert-detail__prompt { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: var(--yj-space-4); height: var(--yj-space-12); min-height: var(--yj-space-12); margin: 0; padding: var(--yj-space-3) var(--yj-space-4); border: var(--yj-border-width) solid transparent; border-radius: var(--yj-radius-lg); background: var(--yj-color-control-hover); color: var(--yj-color-text-secondary); font: inherit; text-align: left; cursor: pointer; transition: background var(--yj-motion-fast) var(--yj-ease-standard), border-color var(--yj-motion-fast) var(--yj-ease-standard); }
.expert-detail__prompt > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.expert-detail__prompt .yj-icon { flex: none; }
.expert-detail__prompt:enabled:hover { background: var(--yj-color-control-pressed); border-color: var(--yj-color-border-default); }
.expert-detail__prompt:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.expert-detail__prompt:disabled { cursor: not-allowed; color: var(--yj-color-text-disabled); }
.expert-detail__prompt:disabled .yj-icon { color: inherit; }
.expert-detail__prompt--readonly { cursor: default; }
.expert-detail__more { display: grid; gap: var(--yj-space-2); margin: 0; padding: var(--yj-space-3) var(--yj-space-4); border-radius: var(--yj-radius-lg); background: var(--yj-color-control-hover); }
.expert-detail__more > div { display: flex; gap: var(--yj-space-2); align-items: baseline; }
.expert-detail__more dt { flex: none; color: var(--yj-color-text-tertiary); }
.expert-detail__more dd { min-width: 0; margin: 0; color: var(--yj-color-text-secondary); overflow-wrap: anywhere; }
.expert-detail__knowledge { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
@media (max-width: 600px) {
  .expert-detail :deep(.n-card-header) { padding: var(--yj-space-5); }
  .expert-detail :deep(.n-card-content) { padding: 0 var(--yj-space-5) var(--yj-space-5); }
  .expert-detail__byline { padding: 0; border: 0; }
  .expert-detail__facts { gap: var(--yj-space-2); }
  .expert-detail__more > div { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .expert-detail__prompt { transition: none; } }
</style>
