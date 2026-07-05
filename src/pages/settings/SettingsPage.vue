<script setup lang="ts">
import { NButton, NCard, NH1, NLayout, NSpace, NText } from "naive-ui";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <n-layout class="page">
    <n-space vertical size="large">
      <n-button text @click="router.push('/chat')">返回 Chat</n-button>
      <n-h1>本地设置</n-h1>
      <n-card title="Sidecar" :bordered="false">
        <n-text>桌面端会在后续版本管理 Codex Runtime 与 yijie-agent-host sidecar。</n-text>
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
