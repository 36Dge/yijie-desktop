<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCard, NEmpty, NList, NListItem, NSpace, NSpin, NTag, NText } from "naive-ui";
import { RouterLink } from "vue-router";
import { useChatStore } from "../../stores/chat.store";

const chatStore = useChatStore();
const loading = computed(() => chatStore.phase === "binding" || chatStore.phase === "loading");
const canLoadMore = computed(() => chatStore.sessionsCursor !== null);
</script>

<template>
  <section class="page" aria-labelledby="tasks-page-title">
    <div class="page__content">
      <h1 id="tasks-page-title" class="page__title">任务记录</h1>
      <n-card class="page__card" :bordered="false">
        <n-spin :show="loading">
          <n-empty v-if="!loading && chatStore.sessions.length === 0" description="暂无本地任务记录" />
          <n-list v-else>
          <n-list-item v-for="session in chatStore.sessions" :key="session.sessionId">
            <n-space vertical size="small">
              <n-tag v-if="session.latestTurnStatus" size="small" type="info">
                {{ session.latestTurnStatus }}
              </n-tag>
              <n-text strong>
                <RouterLink :to="`/chat/${session.sessionId}`">{{ session.title }}</RouterLink>
              </n-text>
            </n-space>
          </n-list-item>
          </n-list>
          <n-button v-if="canLoadMore" quaternary @click="chatStore.loadMoreSessions">
            加载更多
          </n-button>
        </n-spin>
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
