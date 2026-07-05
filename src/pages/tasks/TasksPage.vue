<script setup lang="ts">
import { sampleTasks } from "../../domain/tasks";
</script>

<template>
  <main class="page">
    <header>
      <RouterLink to="/chat">返回 Chat</RouterLink>
      <h1>任务列表</h1>
    </header>

    <section class="task-list">
      <article v-for="task in sampleTasks" :key="task.id" class="task-card">
        <p class="status">{{ task.status }}</p>
        <h2>{{ task.title }}</h2>
        <p>{{ task.description }}</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 32px;
}

a {
  color: #1f6feb;
}

h1 {
  margin: 12px 0 24px;
}

.task-list {
  display: grid;
  gap: 16px;
}

.task-card {
  padding: 18px;
  border: 1px solid #d5e0e8;
  border-radius: 8px;
  background: #ffffff;
}

.status {
  color: #287271;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
</style>
