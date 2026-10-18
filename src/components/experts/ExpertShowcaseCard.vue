<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExpertShowcase } from "../../domain/expert-showcase";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ expert: ExpertShowcase }>();
const emit = defineEmits<{ open: [event: MouseEvent] }>();
const imageFailed = ref(false);
const visibleTags = computed(() => props.expert.tags.slice(0, 3));
watch(() => props.expert.iconUrl, () => { imageFailed.value = false; });
</script>

<template>
  <button
    type="button"
    class="expert-showcase-card"
    :aria-label="`查看 ${expert.name} 展示详情`"
    @click="emit('open', $event)"
  >
    <span class="expert-showcase-card__header">
      <span class="expert-showcase-card__avatar" :class="{ 'expert-showcase-card__avatar--image': expert.iconUrl && !imageFailed }" aria-hidden="true">
        <img v-if="expert.iconUrl && !imageFailed" :src="expert.iconUrl" alt="" loading="lazy" decoding="async" @error="imageFailed = true" />
        <YjIcon v-else name="user" size="xl" :stroke-width="1.5" />
      </span>
      <span class="expert-showcase-card__intro">
        <span class="expert-showcase-card__name" :title="expert.name">{{ expert.name }}</span>
        <span class="expert-showcase-card__description" :title="expert.description">{{ expert.description }}</span>
      </span>
    </span>
    <span class="expert-showcase-card__tags">
      <span v-for="tag in visibleTags" :key="tag" class="expert-showcase-card__tag" :title="tag">{{ tag }}</span>
    </span>
    <span class="expert-showcase-card__footer">
      <span class="expert-showcase-card__source">
        <span class="expert-showcase-card__author" :title="expert.author ?? undefined">{{ expert.author ?? '专家资料' }}</span>
        <span class="expert-showcase-card__preview">展示</span>
      </span>
      <span class="expert-showcase-card__view" aria-hidden="true">查看详情<YjIcon name="arrowUpRight" size="xs" /></span>
    </span>
  </button>
</template>

<style scoped>
.expert-showcase-card {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: calc(var(--yj-space-16) * 2 + var(--yj-space-10));
  flex-direction: column;
  gap: var(--yj-space-4);
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-bg-card);
  color: var(--yj-color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--yj-motion-fast) var(--yj-ease-standard);
}
.expert-showcase-card:hover { border-color: var(--yj-color-border-strong); }
.expert-showcase-card:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.expert-showcase-card__header {
  display: grid;
  grid-template-columns: var(--yj-space-12) minmax(0, 1fr);
  align-items: center;
  gap: var(--yj-space-3);
  width: 100%;
}
.expert-showcase-card__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--yj-space-12);
  height: var(--yj-space-12);
  overflow: hidden;
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-control-hover);
}
.expert-showcase-card__avatar--image { background: var(--yj-color-bg-connector-artwork); }
.expert-showcase-card__avatar img { display: block; width: 100%; height: 100%; object-fit: contain; }
.expert-showcase-card__intro { display: grid; min-width: 0; gap: var(--yj-space-1); }
.expert-showcase-card__name,
.expert-showcase-card__description,
.expert-showcase-card__author { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.expert-showcase-card__name {
  font-size: var(--yj-font-size-card-title);
  line-height: var(--yj-line-height-card-title);
  font-weight: var(--yj-font-weight-semibold);
}
.expert-showcase-card__description {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}
.expert-showcase-card__tags { display: flex; gap: var(--yj-space-1); min-height: var(--yj-line-height-body); overflow: hidden; }
.expert-showcase-card__tag {
  min-width: 0;
  overflow: hidden;
  padding: calc(var(--yj-space-1) / 2) var(--yj-space-2);
  border-radius: var(--yj-radius-xs);
  background: var(--yj-color-control-hover);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.expert-showcase-card__footer,
.expert-showcase-card__source,
.expert-showcase-card__view { display: flex; align-items: center; gap: var(--yj-space-2); }
.expert-showcase-card__footer {
  justify-content: space-between;
  margin-top: auto;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.expert-showcase-card__source { min-width: 0; }
.expert-showcase-card__preview { flex: none; padding-inline-start: var(--yj-space-2); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-default); }
.expert-showcase-card__view {
  flex: none;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-primary);
  opacity: 0;
  transition: opacity var(--yj-motion-fast) var(--yj-ease-standard);
}
.expert-showcase-card:hover .expert-showcase-card__view,
.expert-showcase-card:focus-visible .expert-showcase-card__view { opacity: 1; }
@container (max-width: 900px) { .expert-showcase-card { padding: var(--yj-space-4); } }
@media (hover: none) { .expert-showcase-card__view { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .expert-showcase-card, .expert-showcase-card__view { transition: none; } }
</style>
