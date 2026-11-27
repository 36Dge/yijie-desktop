<script setup lang="ts">
import YjIcon from "../../../../components/yijie/YjIcon.vue";
defineProps<{ title: string; description: string; outputLabel: string }>();
const emit = defineEmits<{ apply: [] }>();
</script>

<template>
  <div class="scene-detail">
    <div class="scene-detail__output">
      <div class="scene-detail__label"><span>示例效果</span><span aria-live="polite">{{ outputLabel }}</span></div>
      <slot name="output" />
    </div>
    <div class="scene-detail__info">
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <h3>输入素材</h3>
      <div class="material-list"><slot name="materials" /></div>
      <button type="button" class="scene-use" @click="emit('apply')">使用此示例<YjIcon name="arrowUpRight" size="xs" /></button>
    </div>
  </div>
</template>

<style scoped>
.scene-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
  align-items: start;
  gap: 28px;
  margin-top: 14px;
}
.scene-detail__output, .scene-detail__info { min-width: 0; }
.scene-detail__label {
  display: flex;
  justify-content: space-between;
  gap: var(--yj-space-3);
  margin-bottom: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.scene-detail__label span:last-child { color: var(--yj-color-text-tertiary); }
.material-list :deep(button), .scene-use {
  display: inline-flex;
  align-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--yj-color-text-secondary);
}
.scene-detail__info { padding-top: 22px; }
.scene-detail__info h2 { margin: 0; font-size: 21px; line-height: 29px; font-weight: var(--yj-font-weight-semibold); letter-spacing: -.035em; }
.scene-detail__info p { margin: 7px 0 17px; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-context-window); line-height: 21px; }
.scene-detail__info h3 { margin: 0 0 7px; font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-semibold); }
.material-list { display: grid; justify-items: start; gap: 6px; }
.material-list :deep(button) { gap: 9px; max-width: 100%; border-radius: var(--yj-radius-sm); text-align: start; font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.material-list :deep(button):hover { color: var(--yj-color-text-primary); }
.material-list :deep(img) {
  flex: none;
  width: 42px;
  height: 42px;
  padding: 2px;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-bg-connector-artwork);
  object-fit: contain;
}
.scene-use {
  justify-content: center;
  gap: var(--yj-space-2);
  min-height: 34px;
  margin-top: var(--yj-space-5);
  padding: 6px 13px;
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-text-primary);
  color: var(--yj-color-bg-card);
  font-size: var(--yj-font-size-context-window);
  font-weight: var(--yj-font-weight-semibold);
}
.scene-use :deep(svg) { color: inherit; }
.scene-use:hover { background: var(--yj-color-text-secondary); }
@container scene-gallery (max-width: 620px) {
  .scene-detail { grid-template-columns: minmax(0, 1fr); gap: var(--yj-space-4); }
  .scene-detail__info { padding-top: 0; }
  .scene-detail__info p { margin-bottom: var(--yj-space-3); }
}
@media (pointer: coarse) {
  .material-list :deep(button), .scene-use { min-height: 44px; }
}
</style>
