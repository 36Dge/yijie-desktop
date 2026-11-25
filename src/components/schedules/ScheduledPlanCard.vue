<script setup lang="ts">
import { computed } from "vue";
import type { PlanCard } from "../../api/generated/scheduled-task-ipc-v2.gen";
import { chatModelsEnabled, kimiK31Candidate } from "../../api/chat-model-client";
import { answerModelBadge } from "../../domain/chat-answer-actions";
import { pauseReasonLabels, scheduleCadenceLabel, scheduleModelLabel, stateLabels, timeLabel } from "../../domain/scheduled-task-ui";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ card: PlanCard }>();
const summary = computed(() => props.card.summary);
const modelIcon = computed(() => answerModelBadge(props.card.model_profile ?? "minimax-m3-high-v1").icon);
const statusText = computed(() => {
  const plan = summary.value;
  if (plan.effective_state === "enabled") return `下次执行 ${timeLabel(plan.next_at, props.card.rule.time_zone)}`;
  if (plan.pause_reason) return pauseReasonLabels[plan.pause_reason];
  return plan.effective_state === "paused" ? "已关闭" : stateLabels[plan.effective_state];
});
</script>

<template>
  <article class="schedule-plan-card" :aria-labelledby="`schedule-name-${summary.plan_id}`" :data-state="summary.effective_state">
    <div class="schedule-card__schedule">
      <time class="schedule-card__clock" :datetime="card.rule.local_time">{{ card.rule.local_time }}</time>
      <span class="schedule-card__cadence">{{ scheduleCadenceLabel(card.rule) }} <time v-if="card.rule.local_date" :datetime="card.rule.local_date">{{ card.rule.local_date }}</time></span>
    </div>
    <div class="schedule-card__copy">
      <h2 :id="`schedule-name-${summary.plan_id}`" class="schedule-card__title">{{ summary.name }}</h2>
      <p class="schedule-card__content">{{ card.content_preview }}</p>
      <p v-if="kimiK31Candidate && card.model_profile === 'kimi-k3-max-v1'" class="schedule-card__warning" role="status">旧模型已退役。请编辑计划、确认新模型并保存，再重新开启或授权执行。</p>
    </div>
    <div class="schedule-card__meta">
      <span :id="`schedule-status-${summary.plan_id}`" class="schedule-card__status" :class="{ 'is-warning': summary.target_state === 'missing' || summary.pause_reason }">
        <span class="schedule-card__dot" aria-hidden="true"></span>
        <span>{{ statusText }}<template v-if="summary.target_state === 'missing'"> · {{ summary.target_mode === 'dedicated_chat' ? '专属聊天已删除' : '关联聊天已失效' }}</template></span>
      </span>
      <span v-if="chatModelsEnabled" class="schedule-card__model" role="group" :aria-label="`执行模型 ${scheduleModelLabel(card.model_profile)}`">
        <span class="schedule-card__brand" :class="{ 'is-kimi': modelIcon === 'modelKimi' }"><YjIcon :name="modelIcon" size="xs" /></span>
        {{ scheduleModelLabel(card.model_profile) }}
      </span>
    </div>
    <div class="schedule-card__toolbar" role="group" aria-label="任务操作">
      <slot name="controls" />
      <div class="schedule-card__actions"><slot name="actions" /></div>
    </div>
  </article>
</template>

<style scoped>
.schedule-plan-card {
  --schedule-clock-bg: var(--yj-color-control-hover);
  --schedule-dot: var(--yj-color-text-tertiary);
  display: grid;
  grid-template-columns: clamp(8.5rem, 14%, 9rem) minmax(0, 1fr) minmax(13rem, 22%) auto;
  grid-template-areas: "clock copy meta toolbar";
  align-items: center;
  column-gap: var(--yj-space-4);
  min-width: 0;
  padding: var(--yj-space-2) var(--yj-space-4) var(--yj-space-2) var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  color: var(--yj-color-text-primary);
}
.schedule-plan-card[data-state="enabled"] {
  --schedule-clock-bg: color-mix(in srgb, var(--yj-color-brand-primary) 17%, var(--yj-color-bg-card));
  --schedule-dot: var(--yj-color-chart-series-1);
}
.schedule-card__schedule { grid-area: clock; align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: var(--yj-space-1); padding: var(--yj-space-2) var(--yj-space-3); border-radius: var(--yj-radius-md); background: var(--schedule-clock-bg); font-variant-numeric: tabular-nums; }
.schedule-card__clock { font-size: var(--yj-font-size-metric-md); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-semibold); letter-spacing: -.035em; }
.schedule-card__cadence, .schedule-card__status, .schedule-card__model, .schedule-card__warning { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); overflow-wrap: anywhere; }
.schedule-card__cadence { color: var(--yj-color-text-secondary); }
.schedule-card__cadence time { display: inline-block; white-space: nowrap; }
.schedule-card__copy { grid-area: copy; min-width: 0; }
.schedule-card__title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); }
.schedule-card__content { margin: var(--yj-space-1) 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.schedule-card__warning { margin: var(--yj-space-1) 0 0; color: var(--yj-color-semantic-warning-ink); }
.schedule-card__meta { grid-area: meta; display: grid; gap: var(--yj-space-1); align-content: center; min-width: 0; }
.schedule-card__status, .schedule-card__model { display: flex; align-items: center; gap: var(--yj-space-2); }
.schedule-card__status { color: var(--yj-color-text-secondary); font-weight: var(--yj-font-weight-medium); }
.schedule-card__status.is-warning { --schedule-dot: currentColor; color: var(--yj-color-semantic-warning-ink); }
.schedule-card__dot { width: .5em; height: .5em; flex: none; margin-inline: var(--yj-space-1); align-self: flex-start; margin-top: calc((var(--yj-line-height-caption) - .5em) / 2); border-radius: 50%; background: var(--schedule-dot); }
.schedule-card__model { color: var(--yj-color-text-secondary); }
.schedule-card__brand { display: inline-flex; flex: none; align-items: center; justify-content: center; }
.schedule-card__brand.is-kimi { border-radius: var(--yj-radius-xs); background: var(--yj-color-model-kimi-bg); color: var(--yj-color-model-kimi-ink); }
.schedule-card__brand .yj-icon { color: inherit; }
.schedule-card__toolbar { grid-area: toolbar; display: flex; align-items: center; justify-self: end; gap: var(--yj-space-2); }
.schedule-card__actions { --action-size: calc(var(--yj-control-height-sm) - var(--yj-space-1)); display: flex; align-items: center; }
.schedule-card__actions::before { content: ""; width: var(--yj-border-width); height: var(--yj-space-4); margin-inline-end: var(--yj-space-2); background: var(--yj-color-border-default); }
.schedule-card__actions > :deep(span) { display: inline-flex; }
.schedule-card__actions :deep(.n-button) { width: var(--action-size); height: var(--action-size); border-radius: var(--yj-radius-sm); }
.schedule-card__actions :deep(.yj-icon) { color: var(--yj-color-icon-subtle); }
.schedule-card__actions :deep(.n-button:enabled:is(:hover, :focus-visible, :active) .yj-icon) { color: var(--yj-color-text-primary); }
.schedule-card__actions :deep(.n-button:disabled .yj-icon) { color: var(--yj-color-text-disabled); }
/* Root-relative breakpoints follow the desktop's CSS zoom in WebKit. */
@container schedules (max-width: 47.5rem) {
  .schedule-plan-card { grid-template-columns: 7rem minmax(0, 1fr) auto; grid-template-areas: "clock copy toolbar" "clock meta toolbar"; gap: var(--yj-space-1) var(--yj-space-3); }
  .schedule-card__meta { display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-3); }
}
@container schedules (max-width: 28.75rem) {
  .schedule-plan-card { grid-template-columns: minmax(0, 7rem) minmax(0, 1fr); grid-template-areas: "copy copy" "clock meta" "toolbar toolbar"; gap: var(--yj-space-2) var(--yj-space-3); padding: var(--yj-space-3); }
  .schedule-card__schedule { flex-direction: row; justify-self: start; align-self: center; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: var(--yj-space-2); padding: var(--yj-space-1) var(--yj-space-2); }
  .schedule-card__clock { font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); }
  .schedule-card__toolbar { justify-self: stretch; justify-content: flex-end; padding-top: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
}
</style>
