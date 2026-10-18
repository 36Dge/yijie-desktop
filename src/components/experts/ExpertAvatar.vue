<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { expertAvatar } from "../../data/expert-avatars";
import { isYjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{ expertId: string; iconKey: string; detail?: boolean }>(), { detail: false });
const imageFailed = ref(false);
const image = computed(() => expertAvatar(props.expertId));
const icon = computed(() => props.iconKey === "skillOperations" ? "skillShopSetup" : isYjIconName(props.iconKey) ? props.iconKey : "user");
watch(image, () => { imageFailed.value = false; });
</script>

<template>
  <span class="expert-avatar" :class="{ 'expert-avatar--image': image && !imageFailed, 'expert-avatar--detail': detail }" aria-hidden="true">
    <img v-if="image && !imageFailed" :src="image" alt="" decoding="async" @error="imageFailed = true" />
    <YjIcon v-else :name="icon" size="xl" :stroke-width="1.5" />
  </span>
</template>

<style scoped>
.expert-avatar { display: flex; flex: none; align-items: center; justify-content: center; width: var(--yj-space-12); height: var(--yj-space-12); overflow: hidden; border-radius: var(--yj-radius-lg); background: var(--yj-color-on-brand); }
.expert-avatar--detail { width: var(--yj-space-16); height: var(--yj-space-16); border-radius: var(--yj-radius-xl); }
.expert-avatar--image { background: var(--yj-color-bg-connector-artwork); }
.expert-avatar img { display: block; width: 100%; height: 100%; object-fit: contain; }
.expert-avatar :deep(.yj-icon) { color: var(--yj-color-brand-primary); width: var(--yj-space-8); height: var(--yj-space-8); }
</style>
