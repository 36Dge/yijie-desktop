<script setup lang="ts">
import { ref, watch } from "vue";
const props = withDefaults(defineProps<{ source: string | File; alt?: string }>(), { alt: "" });
const url = ref("");
watch(() => props.source, (source, _, onCleanup) => {
  if (typeof source === "string") { url.value = source; return; }
  const local = URL.createObjectURL(source);
  url.value = local;
  onCleanup(() => URL.revokeObjectURL(local));
}, { immediate: true });
</script>
<template><img :src="url" :alt="alt" draggable="false" /></template>
