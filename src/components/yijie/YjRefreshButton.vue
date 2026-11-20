<script setup lang="ts">
import { NButton } from "naive-ui";
import YjIcon from "./YjIcon.vue";
import YjTooltip from "./YjTooltip.vue";

defineProps<{ loading?: boolean; disabled?: boolean }>();
defineEmits<{ refresh: [] }>();
</script>

<template>
  <YjTooltip text="刷新数据" placement="bottom">
    <NButton quaternary circle :bordered="false" aria-label="刷新数据" :aria-busy="loading" :loading="loading" :disabled="disabled || loading" @click="$emit('refresh')">
      <template #icon><YjIcon name="refresh" size="sm" /></template>
    </NButton>
  </YjTooltip>
</template>
