<script setup lang="ts">
import { computed, useId } from "vue";
import {
  formatDemoPopularity,
  type StoreScene,
  type StoreSceneBadge,
} from "../../domain/store-showcase";

const props = defineProps<{
  scene: StoreScene;
}>();

const titleId = useId();
const descriptionId = useId();
const formattedPopularity = computed(() => formatDemoPopularity(props.scene));

function badgeTone(badge: StoreSceneBadge): "brand" | "warning" | "error" | "neutral" {
  if (badge === "精品") return "warning";
  if (badge === "热门") return "error";
  if (badge === "关联") return "neutral";
  return "brand";
}
</script>

<template>
  <article
    class="store-scene-card"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
  >
    <ul v-if="scene.badges.length > 0" class="store-scene-card__badges" aria-label="场景标签">
      <li
        v-for="badge in scene.badges"
        :key="badge"
        class="store-scene-card__badge yj-badge"
        :class="`store-scene-card__badge--${badgeTone(badge)}`"
      >
        {{ badge }}
      </li>
    </ul>

    <div class="store-scene-card__copy">
      <h3 :id="titleId" class="store-scene-card__title">{{ scene.title }}</h3>
      <p :id="descriptionId" class="store-scene-card__description">
        {{ scene.description }}
      </p>
    </div>

    <p class="store-scene-card__meta">{{ formattedPopularity }}</p>
  </article>
</template>

<style scoped>
.store-scene-card {
  display: grid;
  min-width: 0;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: none;
  gap: var(--yj-space-4);
}

.store-scene-card__badges {
  display: flex;
  flex-wrap: wrap;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-2);
  list-style: none;
}

.store-scene-card__badge {
  border: 0;
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.store-scene-card__badge--warning {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.store-scene-card__badge--error {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.store-scene-card__badge--neutral {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-control-hover);
}

.store-scene-card__copy {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-2);
}

.store-scene-card__title,
.store-scene-card__description,
.store-scene-card__meta {
  margin: var(--yj-space-0);
}

.store-scene-card__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
  overflow-wrap: anywhere;
}

.store-scene-card__description {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.store-scene-card__meta {
  align-self: end;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
</style>
