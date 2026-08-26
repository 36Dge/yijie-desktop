<script setup lang="ts">
import { computed, useId } from "vue";

const props = defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  supportingText?: string;
  trend?: {
    direction: "up" | "down" | "flat";
    value: string;
    tone?: "success" | "warning" | "error" | "neutral";
  };
}>();

const labelId = useId();
const displayValue = computed(() => props.value === "" ? "—" : String(props.value));
const trendSymbol = computed(() => {
  if (props.trend?.direction === "up") return "↑";
  if (props.trend?.direction === "down") return "↓";
  return "—";
});
const trendDirection = computed(() => {
  if (props.trend?.direction === "up") return "上升";
  if (props.trend?.direction === "down") return "下降";
  return "持平";
});
</script>

<template>
  <article class="yj-metric-card" :aria-labelledby="labelId">
    <h3 :id="labelId" class="yj-metric-card__label">{{ label }}</h3>
    <p class="yj-metric-card__value">
      <span>{{ displayValue }}</span>
      <span v-if="unit && displayValue !== '—'" class="yj-metric-card__unit">{{ unit }}</span>
    </p>
    <p v-if="supportingText" class="yj-metric-card__supporting">{{ supportingText }}</p>
    <p
      v-if="trend"
      class="yj-metric-card__trend"
      :class="`yj-metric-card__trend--${trend.tone ?? 'neutral'}`"
      :aria-label="`趋势${trendDirection}，${trend.value}`"
    >
      <span aria-hidden="true">{{ trendSymbol }}</span>
      <span>{{ trend.value }}</span>
    </p>
  </article>
</template>

<style scoped>
.yj-metric-card {
  display: grid;
  min-width: 0;
  padding: var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
  gap: var(--yj-space-2);
}

.yj-metric-card__label,
.yj-metric-card__value,
.yj-metric-card__supporting,
.yj-metric-card__trend {
  margin: var(--yj-space-0);
}

.yj-metric-card__label {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-regular);
  line-height: var(--yj-line-height-body);
}

.yj-metric-card__value {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-metric-md);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-page-title);
  gap: var(--yj-space-1);
  overflow-wrap: anywhere;
}

.yj-metric-card__unit {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-regular);
  line-height: var(--yj-line-height-caption);
}

.yj-metric-card__supporting,
.yj-metric-card__trend {
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.yj-metric-card__supporting {
  color: var(--yj-color-text-tertiary);
}

.yj-metric-card__trend {
  display: flex;
  align-items: center;
  gap: var(--yj-space-1);
}

.yj-metric-card__trend--success {
  color: var(--yj-color-success);
}

.yj-metric-card__trend--warning {
  color: var(--yj-color-warning);
}

.yj-metric-card__trend--error {
  color: var(--yj-color-error);
}

.yj-metric-card__trend--neutral {
  color: var(--yj-color-text-secondary);
}
</style>
