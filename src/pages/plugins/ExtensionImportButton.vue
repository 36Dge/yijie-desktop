<script setup lang="ts">
import { NButton } from "naive-ui";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjTooltip from "../../components/yijie/YjTooltip.vue";

defineProps<{ kind: "experts" | "skills"; disabled?: boolean }>();
defineEmits<{ importSkill: [] }>();
</script>

<template>
  <NButton v-if="kind === 'skills'" type="primary" :bordered="false" :disabled="disabled" aria-haspopup="dialog" @click="$emit('importSkill')">
    <template #icon><YjIcon name="plus" size="sm" /></template>
    导入技能
  </NButton>
  <YjTooltip v-else text="即将支持" placement="bottom-end">
    <span class="extension-import" role="group" tabindex="0" aria-label="导入专家">
      <NButton type="primary" :bordered="false" disabled>
        <template #icon><YjIcon name="plus" size="sm" /></template>
        导入专家
      </NButton>
    </span>
  </YjTooltip>
</template>

<style scoped>
.extension-import { display: inline-flex; border-radius: var(--yj-radius-md); }
.extension-import > :disabled { pointer-events: none; }
</style>
