<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import ScheduledPicker from "./ScheduledPicker.vue";
import YjIcon from "../yijie/YjIcon.vue";

const date = defineModel<string>({ required: true });
const props = defineProps<{ disabled: boolean; describedBy: string; timeZone: string }>();
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const today = ref("");
const cursor = ref("");
const grid = ref<HTMLElement | null>(null);
// The stored value is a civil date. UTC arithmetic keeps month/day navigation independent of DST.
function dayAt(key: string) { return new Date(`${key}T12:00:00Z`); }
function dateKey(day: Date) {
  const year = day.getUTCFullYear();
  return year >= 1 && year <= 9999 ? day.toISOString().slice(0, 10) : "";
}
function offset(key: string, days: number) {
  const day = dayAt(key);
  day.setUTCDate(day.getUTCDate() + days);
  return dateKey(day);
}
function openCalendar() {
  const now = new Date();
  // A time zone can be temporarily incomplete while the user edits More settings.
  try { today.value = new Intl.DateTimeFormat("sv-SE", { timeZone: props.timeZone }).format(now); }
  catch { today.value = new Intl.DateTimeFormat("sv-SE").format(now); }
  cursor.value = date.value && dateKey(dayAt(date.value)) === date.value ? date.value : today.value;
}
const month = computed(() => cursor.value.slice(0, 7));
const monthTitle = computed(() => `${month.value.slice(0, 4)}年${Number(month.value.slice(5))}月`);
const days = computed(() => {
  if (!cursor.value) return [];
  const first = `${month.value}-01`;
  const leading = (dayAt(first).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => offset(first, index - leading));
});
function moveMonth(by: number) {
  const first = dayAt(`${month.value}-01`);
  first.setUTCMonth(first.getUTCMonth() + by + 1, 0);
  if (first.getUTCFullYear() < 1 || first.getUTCFullYear() > 9999) return;
  first.setUTCDate(Math.min(dayAt(cursor.value).getUTCDate(), first.getUTCDate()));
  cursor.value = dateKey(first);
}
async function navigate(event: KeyboardEvent) {
  const weekday = (dayAt(cursor.value).getUTCDay() + 6) % 7;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday }[event.key];
  if (delta !== undefined) cursor.value = offset(cursor.value, delta) || cursor.value;
  else if (event.key === "PageUp" || event.key === "PageDown") moveMonth((event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
  else return;
  event.preventDefault();
  await nextTick();
  grid.value?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true });
}
function choose(key: string, finish: () => void) { date.value = key; finish(); }
</script>
<template>
  <ScheduledPicker :value="date" label="运行日期" placeholder="选择运行日期" panel-label="选择运行日期" icon="scheduledTask"
    :disabled="disabled" :described-by="describedBy" @open="openCalendar">
    <template #default="{ finish }">
      <div class="schedule-calendar">
        <div class="schedule-calendar__header">
          <strong aria-live="polite">{{ monthTitle }}</strong>
          <button type="button" aria-label="上个月" @click="moveMonth(-1)"><YjIcon class="schedule-calendar__prev" name="chevronRight" size="sm" /></button>
          <button type="button" aria-label="下个月" @click="moveMonth(1)"><YjIcon name="chevronRight" size="sm" /></button>
        </div>
        <div class="schedule-calendar__week" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
        <div ref="grid" class="schedule-calendar__days" role="group" :aria-label="monthTitle" @keydown="navigate">
          <template v-for="(day, index) in days" :key="day || index">
          <button v-if="day" type="button" :aria-label="day" :aria-pressed="day === date"
            :aria-current="day === today ? 'date' : undefined" :class="{ 'is-outside': !day.startsWith(month) }"
            :tabindex="day === cursor ? 0 : -1" :data-picker-focus="day === cursor || undefined"
            @click="choose(day, finish)">{{ Number(day.slice(-2)) }}</button>
          <span v-else />
          </template>
        </div>
        <div class="schedule-calendar__footer"><button type="button" @click="choose(today, finish)">今天</button></div>
      </div>
    </template>
  </ScheduledPicker>
</template>
<style scoped>
.schedule-calendar { width: calc(var(--yj-control-height-sm) * 7 + var(--yj-space-5)); }
.schedule-calendar__header, .schedule-calendar__footer { display: flex; align-items: center; }
.schedule-calendar__header { margin-bottom: var(--yj-space-2); gap: var(--yj-space-1); }
.schedule-calendar__header strong { flex: 1; padding-inline-start: var(--yj-space-2); font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); }
.schedule-calendar button { border: 0; border-radius: var(--yj-radius-md); color: inherit; background: transparent; font: inherit; font-variant-numeric: tabular-nums; }
.schedule-calendar button:hover { background: var(--yj-color-control-hover); }
.schedule-calendar button:focus-visible { outline: var(--yj-border-width) solid var(--yj-color-border-strong); outline-offset: -1px; }
.schedule-calendar__header button { display: grid; place-items: center; width: var(--yj-control-height-sm); height: var(--yj-control-height-sm); }
.schedule-calendar__prev { transform: rotate(180deg); }
.schedule-calendar__week, .schedule-calendar__days { display: grid; grid-template-columns: repeat(7, 1fr); justify-items: center; }
.schedule-calendar__week { padding-block: var(--yj-space-1); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.schedule-calendar__days button { position: relative; width: var(--yj-control-height-sm); height: clamp(var(--yj-space-5), calc((var(--schedule-picker-height, 32rem) - var(--yj-space-16) * 2 - var(--yj-space-3)) / 6), var(--yj-control-height-sm)); padding: 0; }
.schedule-calendar__days .is-outside { color: var(--yj-color-text-tertiary); }
.schedule-calendar__days [aria-current="date"]::after { content: ""; position: absolute; bottom: var(--yj-space-1); left: 50%; width: var(--yj-space-1); height: var(--yj-space-1); border-radius: 50%; background: currentColor; transform: translateX(-50%); }
.schedule-calendar__days [aria-pressed="true"] { background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); font-weight: var(--yj-font-weight-semibold); }
.schedule-calendar__footer { margin-top: var(--yj-space-2); padding-top: var(--yj-space-1); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.schedule-calendar__footer button { padding: var(--yj-space-1) var(--yj-space-2); }
</style>
