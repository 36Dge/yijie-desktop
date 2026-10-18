<script setup lang="ts">
import { ref, useId, watch } from "vue";
import { NButton, NCard, NModal } from "naive-ui";
import type { ExpertShowcase } from "../../domain/expert-showcase";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{ expert: ExpertShowcase | null; active?: boolean }>(), { active: true });
const emit = defineEmits<{ close: [] }>();
const titleId = useId();
const imageFailed = ref(false);
watch(() => props.expert?.iconUrl, () => { imageFailed.value = false; });
</script>

<template>
  <NModal v-if="expert" :show="active" :trap-focus="true" :auto-focus="true" @update:show="show => { if (!show) emit('close'); }">
    <NCard class="expert-showcase-detail" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <template #header>
        <div class="expert-showcase-detail__header">
          <span class="expert-showcase-detail__avatar" :class="{ 'expert-showcase-detail__avatar--image': expert.iconUrl && !imageFailed }" aria-hidden="true">
            <img v-if="expert.iconUrl && !imageFailed" :src="expert.iconUrl" alt="" decoding="async" @error="imageFailed = true" />
            <YjIcon v-else name="user" size="xl" :stroke-width="1.5" />
          </span>
          <div class="expert-showcase-detail__identity">
            <h2 :id="titleId">{{ expert.name }}</h2>
            <p>{{ expert.author ?? '专家资料' }}</p>
          </div>
        </div>
      </template>
      <template #header-extra>
        <NButton quaternary circle class="expert-showcase-detail__close" aria-label="关闭专家详情" @click="emit('close')"><YjIcon name="dismiss" size="lg" /></NButton>
      </template>
      <div class="expert-showcase-detail__body">
        <p class="expert-showcase-detail__description">{{ expert.description }}</p>
        <div v-if="expert.tags.length" class="expert-showcase-detail__tags" aria-label="擅长领域">
          <span v-for="tag in expert.tags" :key="tag" class="expert-showcase-detail__tag">{{ tag }}</span>
        </div>
        <dl v-if="expert.version || expert.author || expert.usageCount !== null" class="expert-showcase-detail__facts">
          <div v-if="expert.version"><dt>版本</dt><dd>{{ expert.version }}</dd></div>
          <div v-if="expert.usageCount !== null"><dt>使用量</dt><dd>{{ expert.usageCount.toLocaleString('zh-CN') }}</dd></div>
          <div v-if="expert.author"><dt>开发者</dt><dd>{{ expert.author }}</dd></div>
        </dl>
        <section v-if="expert.quickPrompts.length" class="expert-showcase-detail__section" aria-label="专家帮你做">
          <h3><YjIcon name="message" size="lg" />专家帮你做</h3>
          <ul class="expert-showcase-detail__prompts">
            <li v-for="prompt in expert.quickPrompts" :key="prompt"><p>{{ prompt }}</p></li>
          </ul>
        </section>
        <section class="expert-showcase-detail__section" aria-label="更多专家信息">
          <h3><YjIcon name="listView" size="lg" />更多</h3>
          <dl class="expert-showcase-detail__more">
            <div><dt>本地标识</dt><dd>{{ expert.id }}</dd></div>
            <div v-if="expert.category"><dt>分类</dt><dd>{{ expert.category }}</dd></div>
          </dl>
        </section>
      </div>
      <template #footer>
        <div class="expert-showcase-detail__footer"><span>仅供展示</span><NButton @click="emit('close')">关闭</NButton></div>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.expert-showcase-detail {
  display: flex;
  width: min(var(--yj-layout-chat-entry-max), calc(100vw - var(--yj-space-8)));
  max-height: calc(100vh - var(--yj-space-8));
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-modal);
}
.expert-showcase-detail :deep(.n-card-header) { align-items: flex-start; padding: var(--yj-space-6); gap: var(--yj-space-4); }
.expert-showcase-detail :deep(.n-card-header__main) { min-width: 0; }
.expert-showcase-detail :deep(.n-card__content) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--yj-space-6) var(--yj-space-6); }
.expert-showcase-detail :deep(.n-card__footer) { padding: var(--yj-space-4) var(--yj-space-6); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.expert-showcase-detail__header { display: flex; align-items: center; gap: var(--yj-space-4); }
.expert-showcase-detail__avatar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--yj-space-16);
  height: var(--yj-space-16);
  overflow: hidden;
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-control-hover);
}
.expert-showcase-detail__avatar--image { background: var(--yj-color-bg-connector-artwork); }
.expert-showcase-detail__avatar img { display: block; width: 100%; height: 100%; object-fit: contain; }
.expert-showcase-detail__identity { min-width: 0; }
.expert-showcase-detail__identity h2 {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-page-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-page-title);
  overflow-wrap: anywhere;
}
.expert-showcase-detail__identity p { margin: var(--yj-space-1) 0 0; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); font-weight: var(--yj-font-weight-regular); }
.expert-showcase-detail__body { display: flex; flex-direction: column; gap: var(--yj-space-5); color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.expert-showcase-detail__description { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.expert-showcase-detail__tags { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); }
.expert-showcase-detail__tag { padding: calc(var(--yj-space-1) / 2) var(--yj-space-2); border-radius: var(--yj-radius-xs); background: var(--yj-color-control-hover); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-regular); line-height: var(--yj-line-height-caption); overflow-wrap: anywhere; }
.expert-showcase-detail__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--yj-space-4) var(--yj-space-6);
  margin: var(--yj-space-1) 0;
  padding: var(--yj-space-5) 0;
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.expert-showcase-detail__facts > div { display: flex; min-width: 0; flex: 1; flex-direction: column-reverse; align-items: flex-start; gap: var(--yj-space-1); }
.expert-showcase-detail__facts dt { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.expert-showcase-detail__facts dd { margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-card-title); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-card-title); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.expert-showcase-detail__section { display: grid; gap: var(--yj-space-3); }
.expert-showcase-detail__section h3 { display: flex; align-items: center; gap: var(--yj-space-2); margin: 0; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-card-title); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-card-title); }
.expert-showcase-detail__prompts { display: grid; gap: var(--yj-space-2); margin: 0; padding: 0; list-style: none; }
.expert-showcase-detail__prompts li { padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-lg); background: var(--yj-color-control-hover); }
:global([data-theme="dark"]) .expert-showcase-detail__prompts li { background: var(--yj-color-bg-card); }
.expert-showcase-detail__prompts p { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.expert-showcase-detail__more { display: grid; gap: var(--yj-space-2); margin: 0; }
.expert-showcase-detail__more > div { display: flex; align-items: baseline; gap: var(--yj-space-4); }
.expert-showcase-detail__more dt { flex: none; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.expert-showcase-detail__more dd { min-width: 0; margin: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.expert-showcase-detail__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-4); }
.expert-showcase-detail__footer > span { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
@media (max-width: 480px) {
  .expert-showcase-detail__identity h2 { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); }
}
</style>
