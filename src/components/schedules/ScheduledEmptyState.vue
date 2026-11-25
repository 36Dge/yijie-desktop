<script setup lang="ts">
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";

const copy = {
  plans: { title: "还没有定时任务", description: "设定时间和任务内容，开启后按计划自动运行。" },
  records: { title: "还没有执行记录", description: "任务运行或跳过后，这里会显示时间和状态。" },
  filtered: { title: "没有匹配的记录", description: "试试其他关键词，或清空筛选条件。" },
};
defineProps<{ variant: keyof typeof copy }>();
</script>

<template>
  <YjEmpty class="schedule-empty" :data-variant="variant" :title="copy[variant].title" :description="copy[variant].description">
    <template #illustration>
      <div class="schedule-empty__art" aria-hidden="true">
        <div class="schedule-empty__sheet">
          <div v-if="variant === 'plans'" class="schedule-empty__calendar">
            <span v-for="day in 8" :key="day"></span>
          </div>
          <div v-else class="schedule-empty__timeline">
            <span v-for="line in 3" :key="line"></span>
          </div>
        </div>
        <span class="schedule-empty__symbol">
          <YjIcon :name="variant === 'plans' ? 'plus' : variant === 'records' ? 'pending' : 'search'" size="lg" :stroke-width="1.5" />
        </span>
      </div>
    </template>
    <template #actions><slot /></template>
  </YjEmpty>
</template>

<style scoped>
.schedule-empty {
  grid-template-columns: auto minmax(0, 20rem);
  grid-template-areas: "art copy" "art actions";
  gap: var(--yj-space-4) var(--yj-space-8);
  justify-items: start;
  min-height: var(--yj-layout-schedule-empty-min-height);
  text-align: start;
}
.schedule-empty :deep(.yj-empty__copy) { grid-area: copy; align-self: end; margin: 0; gap: var(--yj-space-2); }
.schedule-empty :deep(.yj-empty__description) { color: var(--yj-color-text-secondary); }
.schedule-empty :deep(.yj-empty__actions) { grid-area: actions; align-self: start; margin: 0; }
.schedule-empty__art {
  --sheet-width: calc(var(--yj-space-16) + var(--yj-space-5));
  --sheet-height: var(--yj-space-16);
  --art-ink: var(--yj-color-text-secondary);
  grid-area: art;
  position: relative;
  align-self: center;
  width: calc(var(--sheet-width) + var(--yj-space-6));
  height: calc(var(--sheet-height) + var(--yj-space-5));
  pointer-events: none;
}
.schedule-empty__art::before, .schedule-empty__sheet {
  position: absolute;
  inset: var(--yj-space-2) auto auto var(--yj-space-2);
  width: var(--sheet-width);
  height: var(--sheet-height);
  border: var(--yj-border-width) solid var(--yj-color-border-strong);
  border-radius: var(--yj-radius-md);
}
.schedule-empty__art::before { content: ""; transform: translate(calc(-1 * var(--yj-space-1)), var(--yj-space-1)) rotate(-8deg); background: var(--yj-color-control-hover); }
.schedule-empty__sheet { border-color: var(--art-ink); background: var(--yj-color-bg-card); }
.schedule-empty__calendar {
  position: absolute;
  inset: var(--yj-space-4) 0 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  place-items: center;
  gap: var(--yj-space-1);
  padding: var(--yj-space-2);
  border-top: var(--yj-border-width) solid var(--art-ink);
}
.schedule-empty__calendar::before, .schedule-empty__calendar::after {
  position: absolute;
  top: calc(-1 * var(--yj-space-5));
  width: var(--yj-space-1);
  height: var(--yj-space-2);
  border: var(--yj-border-width) solid var(--art-ink);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-card);
  content: "";
}
.schedule-empty__calendar::before { inset-inline-start: var(--yj-space-4); }
.schedule-empty__calendar::after { inset-inline-end: var(--yj-space-4); }
.schedule-empty__calendar > span { width: var(--yj-space-2); height: var(--yj-space-1); border-radius: var(--yj-radius-full); background: var(--yj-color-border-strong); }
.schedule-empty__calendar > span:nth-child(3) { width: var(--yj-space-3); height: var(--yj-space-3); border-radius: var(--yj-radius-xs); background: var(--yj-color-brand-primary); }
.schedule-empty__timeline { position: absolute; inset: var(--yj-space-3) var(--yj-space-3) var(--yj-space-3) var(--yj-space-4); display: flex; flex-direction: column; justify-content: space-between; border-inline-start: var(--yj-border-width) solid var(--yj-color-border-strong); }
.schedule-empty__timeline > span { position: relative; height: var(--yj-border-width); margin-inline-start: var(--yj-space-3); background: var(--yj-color-border-strong); }
.schedule-empty__timeline > span:nth-child(2) { margin-inline-end: var(--yj-space-4); }
.schedule-empty__timeline > span:last-child { margin-inline-end: var(--yj-space-2); }
.schedule-empty__timeline > span::before { position: absolute; inset-inline-start: calc(-1 * var(--yj-space-3)); top: 50%; width: var(--yj-space-2); height: var(--yj-space-2); transform: translate(-50%, -50%); border: var(--yj-border-width) solid var(--art-ink); border-radius: 50%; background: var(--yj-color-bg-card); content: ""; }
.schedule-empty[data-variant="records"] .schedule-empty__timeline > span:first-child::before { background: var(--yj-color-brand-primary); }
.schedule-empty__symbol { position: absolute; inset: auto 0 0 auto; display: grid; place-items: center; width: var(--yj-space-8); height: var(--yj-space-8); border: var(--yj-border-width) solid var(--art-ink); border-radius: 50%; background: var(--yj-color-bg-elevated); }
.schedule-empty__symbol .yj-icon { color: var(--art-ink); }
@container schedules (max-width: 560px) {
  .schedule-empty { grid-template-columns: minmax(0, 22rem); grid-template-areas: "art" "copy" "actions"; justify-items: center; gap: var(--yj-space-3); padding: var(--yj-space-6); text-align: center; }
}
</style>
