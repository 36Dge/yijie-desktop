<script setup lang="ts">
import { computed } from "vue";
import { NButton } from "naive-ui";
import ScheduledPicker from "./ScheduledPicker.vue";
import ScheduledTimeColumn from "./ScheduledTimeColumn.vue";

const time = defineModel<string>({ required: true });
defineProps<{ disabled: boolean; describedBy: string }>();
const parts = computed(() => time.value.split(":"));
</script>
<template>
  <ScheduledPicker :value="time" label="当地时间" panel-label="选择计划时间" icon="pending" :disabled="disabled" :described-by="describedBy">
    <template #default="{ finish }">
      <div class="schedule-clock">
        <ScheduledTimeColumn label="小时" :count="24" :value="parts[0]!" initial-focus @select="time = `${$event}:${parts[1]}`" @finish="finish" />
        <ScheduledTimeColumn label="分钟" :count="60" :value="parts[1]!" @select="time = `${parts[0]}:${$event}`" @finish="finish" />
      </div>
      <div class="schedule-clock__footer">
        <span>{{ time }}</span><NButton size="small" type="primary" :bordered="false" @click="finish">完成</NButton>
      </div>
    </template>
  </ScheduledPicker>
</template>
<style scoped>
.schedule-clock { width: calc(var(--yj-space-16) * 3); display: grid; grid-template-columns: 1fr 1fr; }
.schedule-clock > :first-child { padding-inline-end: var(--yj-space-2); border-inline-end: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.schedule-clock > :last-child { padding-inline-start: var(--yj-space-2); }
.schedule-clock__footer { display: flex; align-items: center; justify-content: space-between; margin-top: var(--yj-space-2); padding-top: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); font-weight: var(--yj-font-weight-semibold); }
.schedule-clock__footer > span { padding-inline-start: var(--yj-space-1); color: var(--yj-color-text-secondary); }
</style>
