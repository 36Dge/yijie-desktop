<script setup lang="ts">
import { ref } from "vue";
import { NButton, NTooltip } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import type { YjIconName } from "../../icons/registry";
defineProps<{ label: string; icon: YjIconName; disabled?: boolean; id?: string }>();
const emit = defineEmits<{ click: [] }>();
const hovered = ref(false); const focused = ref(false);
</script>
<template>
  <NTooltip trigger="manual" :show="hovered || focused">
    <template #trigger><span @mouseenter="hovered = true" @mouseleave="hovered = false" @click.stop>
      <NButton :id="id" quaternary circle size="small" :disabled="disabled" :aria-label="label" @focus="focused = true" @blur="focused = false" @click="emit('click')"><YjIcon :name="icon" size="sm" /></NButton>
    </span></template>{{ label }}
  </NTooltip>
</template>
