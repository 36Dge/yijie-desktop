<script setup lang="ts">
import { NCard, NList, NListItem, NSpace, NTag, NText } from "naive-ui";
import { sampleTasks } from "../../domain/tasks";
</script>

<template>
  <section class="page" aria-labelledby="tasks-page-title">
    <div class="page__content">
      <h1 id="tasks-page-title" class="page__title">任务记录</h1>
      <n-card class="page__card" :bordered="false">
        <n-list>
          <n-list-item v-for="task in sampleTasks" :key="task.id">
            <n-space vertical size="small">
              <n-tag size="small" type="info">{{ task.status }}</n-tag>
              <n-text strong>{{ task.title }}</n-text>
              <n-text depth="3">{{ task.description }}</n-text>
            </n-space>
          </n-list-item>
        </n-list>
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
