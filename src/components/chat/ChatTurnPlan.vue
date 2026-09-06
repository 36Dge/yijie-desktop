<script setup lang="ts">
import { computed, ref, useId } from "vue";
import type {
  ConversationTimelinePlanStepViewModel,
  ConversationTimelinePlanViewModel,
} from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  plan: ConversationTimelinePlanViewModel;
}>();

const expanded = ref(props.plan.defaultExpanded);
const id = useId();
const titleId = `${id}-title`;
const contentId = `${id}-content`;

const planStatusLabel = computed(() => {
  if (props.plan.steps.some((step) => step.status === "in_progress")) return "进行中";
  if (props.plan.steps.some((step) => step.status === "unknown")) return "状态未知";
  if (props.plan.steps.every((step) => step.status === "completed")) return "已完成";
  return "待执行";
});

function stepStatusLabel(step: ConversationTimelinePlanStepViewModel): string {
  switch (step.status) {
    case "pending":
      return "待执行";
    case "in_progress":
      return "进行中";
    case "completed":
      return "已完成";
    case "unknown":
    default:
      return "状态未知";
  }
}

function stepStatusIcon(step: ConversationTimelinePlanStepViewModel): YjIconName {
  return step.status === "completed" ? "check" :
    step.status === "unknown" ? "warning" : "pending";
}

function stepStatusTone(
  step: ConversationTimelinePlanStepViewModel,
): "muted" | "primary" | "success" | "warning" {
  switch (step.status) {
    case "completed":
      return "success";
    case "in_progress":
      return "primary";
    case "unknown":
      return "warning";
    case "pending":
    default:
      return "muted";
  }
}

function toggle(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <section class="chat-turn-plan" :aria-labelledby="titleId">
    <button
      class="chat-turn-plan__disclosure"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="contentId"
      @click="toggle"
    >
      <span class="chat-turn-plan__identity">
        <YjIcon name="taskHistory" size="sm" tone="muted" />
        <strong :id="titleId">执行计划</strong>
      </span>
      <span class="chat-turn-plan__status">{{ planStatusLabel }}</span>
      <YjIcon :name="expanded ? 'chevronDown' : 'chevronRight'" size="sm" tone="muted" />
    </button>

    <div v-if="expanded" :id="contentId" class="chat-turn-plan__content">
      <p v-if="plan.explanation" class="chat-turn-plan__explanation">
        {{ plan.explanation }}
      </p>
      <ol class="chat-turn-plan__steps" aria-label="计划步骤">
        <li
          v-for="step in plan.steps"
          :key="step.identity"
          class="chat-turn-plan__step"
          :class="`chat-turn-plan__step--${step.status}`"
        >
          <YjIcon
            :name="stepStatusIcon(step)"
            size="sm"
            :tone="stepStatusTone(step)"
          />
          <span class="chat-turn-plan__step-text">{{ step.text }}</span>
          <span class="chat-turn-plan__step-status">{{ stepStatusLabel(step) }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.chat-turn-plan {
  min-width: 0;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-subtle);
}

.chat-turn-plan__disclosure {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-3);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: 0;
  border-radius: inherit;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-turn-plan__disclosure:hover {
  background: var(--yj-color-control-hover);
}

.chat-turn-plan__disclosure:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.chat-turn-plan__identity {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-plan__identity strong,
.chat-turn-plan__status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-turn-plan__status,
.chat-turn-plan__step-status {
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-plan__content {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-3);
  padding: var(--yj-space-2) var(--yj-space-3) var(--yj-space-3);
}

.chat-turn-plan__explanation {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-turn-plan__steps {
  display: grid;
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-2);
  list-style: none;
}

.chat-turn-plan__step {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--yj-space-2);
}

.chat-turn-plan__step-text {
  min-width: 0;
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@media (max-width: 40rem) {
  .chat-turn-plan__step {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .chat-turn-plan__step-status {
    grid-column: 2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-turn-plan__disclosure {
    transition: none;
  }
}
</style>
