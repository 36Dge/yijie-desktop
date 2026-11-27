<script setup lang="ts">
import { useId } from "vue";
import YjIcon from "../../../components/yijie/YjIcon.vue";
import { homeCommerceTasks, type HomeCommerceTask } from "./commerce-tasks";

const selected = defineModel<HomeCommerceTask>({ required: true });
const groupName = useId();
</script>

<template>
  <nav class="commerce-nav" aria-label="电商任务导航">
    <div class="commerce-nav__choices" role="radiogroup" aria-label="电商任务类型">
      <label v-for="(task, key) in homeCommerceTasks" :key="key" class="commerce-nav__choice">
        <input v-model="selected" type="radio" :name="groupName" :value="key" aria-controls="upcoming-task-input" />
        <span class="commerce-nav__pill">
          <YjIcon v-if="selected === key" :name="task.icon" size="sm" :stroke-width="1.5" />
          {{ task.label }}
        </span>
      </label>
    </div>
  </nav>
</template>

<style scoped>
.commerce-nav {
  position: relative;
  isolation: isolate;
  grid-area: 1 / 1;
  min-width: 0;
  padding: var(--yj-space-2) calc(var(--yj-home-mascot-width) + var(--yj-home-mascot-right) + var(--yj-space-2)) var(--yj-space-2) var(--yj-space-2);
}

/* The wash continues behind the rounded top corners of the input card. */
.commerce-nav::before {
  position: absolute;
  z-index: -1;
  inset: 0 0 calc(-1 * var(--yj-radius-chat-composer));
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-bottom: 0;
  border-radius: var(--yj-radius-chat-composer) var(--yj-radius-chat-composer) 0 0;
  background:
    radial-gradient(ellipse at 86% 100%, color-mix(in srgb, var(--yj-color-brand-primary) 30%, transparent), transparent 58%),
    linear-gradient(110deg, var(--yj-color-bg-composer-tray), var(--yj-color-bg-card));
  content: "";
  pointer-events: none;
}

.commerce-nav__choices {
  display: flex;
  gap: var(--yj-space-1);
}

.commerce-nav__choice { position: relative; flex: 1 0 auto; cursor: pointer; }
.commerce-nav__choice input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.commerce-nav__pill {
  display: flex;
  min-height: var(--yj-control-height-sm);
  align-items: center;
  justify-content: center;
  gap: var(--yj-space-1);
  padding-inline: var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-control-line-height);
  white-space: nowrap;
  transition: background-color var(--yj-motion-fast) var(--yj-ease-standard);
}
.commerce-nav__pill .yj-icon { color: inherit; }
.commerce-nav__choice:hover .commerce-nav__pill { background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.commerce-nav__choice:active .commerce-nav__pill { background: var(--yj-color-control-pressed); }
.commerce-nav__choice input:checked + .commerce-nav__pill {
  color: var(--yj-color-on-brand);
  background: var(--yj-color-brand-primary);
  font-weight: var(--yj-font-weight-semibold);
}
.commerce-nav__choice input:focus-visible + .commerce-nav__pill {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-border-width);
}

@container home-composer (max-width: 700px) {
  .commerce-nav__choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container home-composer (max-width: 640px) {
  .commerce-nav { padding-inline-end: calc(var(--yj-home-mascot-width-compact) + var(--yj-space-4)); }
}
@container home-composer (max-width: 475px) {
  .commerce-nav { grid-row: 2; padding-inline-end: var(--yj-space-2); }
}
@container home-composer (max-width: 310px) {
  .commerce-nav__choices { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .commerce-nav__pill { transition: none; }
}
</style>
