<script setup lang="ts">
import { ref, watch } from "vue";
import { NModal } from "naive-ui";
import type { ExpertShowcase } from "../../domain/expert-showcase";
import { defaultExpertDeveloper } from "../../domain/expert-ui";
import YjIcon from "../yijie/YjIcon.vue";
import ExpertDetailCard from "./ExpertDetailCard.vue";

const props = withDefaults(defineProps<{ expert: ExpertShowcase | null; active?: boolean }>(), { active: true });
const emit = defineEmits<{ close: [] }>();
const imageFailed = ref(false);
watch(() => props.expert?.iconUrl, () => { imageFailed.value = false; });
</script>

<template>
  <NModal v-if="expert" :show="active" :trap-focus="true" :auto-focus="true" @update:show="show => { if (!show) emit('close'); }">
    <ExpertDetailCard :name="expert.name" :developer="expert.author?.trim() || defaultExpertDeveloper" :version="expert.version" :expert-id="expert.id" :description="expert.description" :tags="expert.tags" :quick-prompts="expert.quickPrompts" :usage-count="expert.usageCount" @close="emit('close')">
      <template #avatar>
        <span class="expert-showcase-detail__avatar" :class="{ 'expert-showcase-detail__avatar--image': expert.iconUrl && !imageFailed }" aria-hidden="true">
          <img v-if="expert.iconUrl && !imageFailed" :src="expert.iconUrl" alt="" decoding="async" @error="imageFailed = true" />
          <YjIcon v-else name="user" size="xl" :stroke-width="1.5" />
        </span>
      </template>
      <template #action><span class="expert-showcase-detail__readonly">仅供展示</span></template>
    </ExpertDetailCard>
  </NModal>
</template>

<style scoped>
.expert-showcase-detail__avatar { display: flex; flex: none; align-items: center; justify-content: center; width: var(--yj-space-16); height: var(--yj-space-16); overflow: hidden; border-radius: var(--yj-radius-xl); background: var(--yj-color-control-hover); }
.expert-showcase-detail__avatar--image { background: var(--yj-color-bg-connector-artwork); }
.expert-showcase-detail__avatar img { display: block; width: 100%; height: 100%; object-fit: contain; }
.expert-showcase-detail__readonly { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-regular); }
</style>
