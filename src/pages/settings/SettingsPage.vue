<script setup lang="ts">
import { NCard, NText } from "naive-ui";
</script>

<template>
  <section class="page" aria-labelledby="settings-page-title">
    <div class="page__content">
      <h1 id="settings-page-title" class="page__title">设置</h1>
      <n-card class="page__card" title="Sidecar" :bordered="false">
        <n-text>桌面端会在后续版本管理 Codex Runtime 与 yijie-agent-host sidecar。</n-text>
      </n-card>
    </div>
  </section>
</template>

<style scoped>
.page {
  min-height: 100%;
  padding: var(--yj-space-8);
  background: var(--yj-color-bg-page);
}

.page__content {
  width: min(100%, var(--yj-layout-form-max));
  margin-inline: auto;
}

.page__title {
  margin: 0 0 var(--yj-space-6);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-page-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-page-title);
}

.page__card {
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
}
</style>
