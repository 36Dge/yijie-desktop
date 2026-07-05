<script setup lang="ts">
import { NButton, NCard, NH1, NLayout, NList, NListItem, NSpace, NTag, NText } from "naive-ui";
import { useRouter } from "vue-router";
import { sampleTasks } from "../../domain/tasks";

const router = useRouter();
</script>

<template>
  <n-layout class="page">
    <n-space vertical size="large">
      <n-button text @click="router.push('/chat')">返回 Chat</n-button>
      <n-h1>任务列表</n-h1>

      <n-card :bordered="false">
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
    </n-space>
  </n-layout>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 32px;
  background: #eef3f8;
}
</style>
