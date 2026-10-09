<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { connectorIconUrl } from "../../icons/connector-icons";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{ assetId: string; size?: "xs" | "sm" | "md" | "lg" }>(), { size: "md" });
const failed = ref(false);
const url = computed(() => connectorIconUrl(props.assetId));
watch(() => props.assetId, () => { failed.value = false; });
</script>

<template>
  <span class="connector-icon" :class="`connector-icon--${size}`" aria-hidden="true">
    <img v-if="url && !failed" :src="url" alt="" draggable="false" @error="failed = true" />
    <YjIcon v-else name="plugin" :size="size === 'lg' ? 'xl' : 'sm'" />
  </span>
</template>

<style scoped>
.connector-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; overflow: hidden; width: var(--yj-space-10); height: var(--yj-space-10); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-connector-artwork); color: var(--yj-color-on-brand); }
.connector-icon img { display: block; width: 100%; height: 100%; padding: var(--yj-space-1); object-fit: contain; }
.connector-icon :deep(.yj-icon) { color: var(--yj-color-on-brand); }
.connector-icon--sm { width: var(--yj-space-6); height: var(--yj-space-6); border-radius: var(--yj-radius-sm); }
.connector-icon--xs { width: var(--yj-space-5); height: var(--yj-space-5); border: 0; border-radius: var(--yj-radius-sm); }
.connector-icon--xs img { padding: 0; }
.connector-icon--sm img { padding: var(--yj-space-0); }
.connector-icon--lg { width: var(--yj-space-16); height: var(--yj-space-16); border-radius: var(--yj-radius-xl); }
</style>
