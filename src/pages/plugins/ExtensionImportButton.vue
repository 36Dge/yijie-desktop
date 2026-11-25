<script setup lang="ts">
import { NButton } from "naive-ui";
import YjComingSoonAddButton from "../../components/yijie/YjComingSoonAddButton.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";

defineProps<{ kind: "experts" | "skills"; disabled?: boolean }>();
defineEmits<{ importSkill: [] }>();
</script>

<template>
  <NButton v-if="kind === 'skills'" type="primary" :bordered="false" :disabled="disabled" aria-haspopup="dialog" @click="$emit('importSkill')">
    <template #icon><YjIcon name="plus" size="sm" /></template>
    导入技能
  </NButton>
  <YjComingSoonAddButton v-else label="导入专家" />
</template>
