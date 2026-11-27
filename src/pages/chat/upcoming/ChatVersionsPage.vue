<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useRoute } from "vue-router";
import ChatPage from "../ChatPage.vue";
import { provideChatPageState } from "../chat-page-state";
import UpcomingTaskPreview from "./UpcomingTaskPreview.vue";
import type { HomeCommerceTask } from "./commerce-tasks";
import { newImageAgentState } from "./image-agent/draft";
import { newVideoAgentState } from "./video-agent/draft";

provideChatPageState();
const route = useRoute();
const ordinaryHome = computed(() => !route.params.sessionId && route.query.create !== "schedule");
const version = ref<"published" | "upcoming">("published");
const publishedPage = ref<InstanceType<typeof ChatPage> | null>(null);
const previewText = ref("");
const previewTask = ref<HomeCommerceTask>("image");
const previewImage = ref(newImageAgentState());
const previewVideo = ref(newVideoAgentState());
const group = useId();

watch(() => route.fullPath, () => {
  version.value = "published";
  previewText.value = "";
  previewTask.value = "image";
  previewImage.value = newImageAgentState();
  previewVideo.value = newVideoAgentState();
});
</script>

<template>
  <div class="chat-versions">
    <div v-if="ordinaryHome" class="chat-versions__switch" role="radiogroup" aria-label="新建任务版本">
      <label>
        <input v-model="version" type="radio" :name="group" value="published" />
        <span>已发布</span>
      </label>
      <label>
        <input v-model="version" type="radio" :name="group" value="upcoming" :disabled="publishedPage?.committingDraft" />
        <span>即将更新</span>
      </label>
    </div>
    <UpcomingTaskPreview v-if="ordinaryHome && version === 'upcoming'" v-model:text="previewText" v-model:task="previewTask"
      v-model:image-state="previewImage" v-model:video-state="previewVideo" />
    <ChatPage v-else ref="publishedPage" />
  </div>
</template>

<style scoped>
.chat-versions { position: relative; height: 100%; min-width: 0; }
.chat-versions__switch {
  position: absolute;
  z-index: var(--yj-z-chat-scroll-control);
  inset-block-start: var(--yj-space-6);
  inset-inline-end: var(--yj-space-8);
  display: inline-flex;
  padding: var(--yj-space-1);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-composer-tray);
}
.chat-versions__switch label { position: relative; display: flex; }
.chat-versions__switch input {
  position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer;
}
.chat-versions__switch span {
  min-width: var(--yj-space-16);
  padding: 0 var(--yj-space-2);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-space-6);
  text-align: center;
  white-space: nowrap;
}
.chat-versions__switch input:hover + span { background: var(--yj-color-control-hover); }
.chat-versions__switch input:checked + span {
  border-color: var(--yj-color-border-default); background: var(--yj-color-bg-elevated);
  color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-semibold);
}
.chat-versions__switch input:focus-visible + span { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.chat-versions__switch input:disabled { cursor: wait; }
.chat-versions__switch input:disabled + span { color: var(--yj-color-text-disabled); }
.chat-versions__switch ~ :deep(.chat-entry--conversation) { padding-block-start: calc(var(--yj-space-8) + var(--yj-space-12)); }
</style>
