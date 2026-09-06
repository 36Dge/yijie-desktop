<script setup lang="ts">
import { ref } from 'vue'
const theme = ref(document.documentElement.dataset.theme ?? 'light')
const variant = ref(document.documentElement.dataset.palette ?? 'candidate')
function apply() {
  window.dispatchEvent(new CustomEvent('component-color-preview-appearance', { detail: { theme: theme.value, variant: variant.value } }))
}
</script>
<template>
  <aside class="preview-controls" aria-label="配色评审控制栏">
    <strong>配色候选</strong>
    <label>主题 <select v-model="theme" @change="apply"><option value="light">明亮</option><option value="dark">暗黑</option></select></label>
    <label>方案 <select v-model="variant" @change="apply"><option value="candidate">候选</option><option value="current">当前实现</option></select></label>
    <a href="../review.html">返回评审</a>
  </aside>
</template>
<style scoped>
.preview-controls { position: fixed; right: 16px; bottom: 16px; z-index: 9999; display: flex; align-items: center; gap: 16px; padding: 12px 16px; border: 1px solid var(--yj-color-border-control, var(--yj-color-border-strong)); border-radius: 8px; background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary); font: 12px/1.5 var(--yj-font-family-sans); }
.preview-controls label { display: flex; align-items: center; gap: 6px; }
.preview-controls select { color: inherit; background: var(--yj-color-bg-elevated); font: inherit; border: 1px solid var(--yj-color-border-strong); border-radius: 4px; padding: 4px; }
.preview-controls a { color: inherit; text-underline-offset: 3px; }
.preview-controls :focus-visible { outline: 2px solid var(--yj-color-focus-ring); outline-offset: 2px; }
</style>
