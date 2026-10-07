<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";
import type { YjIconName } from "../../icons/registry";
defineProps<{
  title: string;
  subtitle?: string;
  icon?: YjIconName;
  eyebrow?: string;
}>();
</script>
<template>
  <section class="sd-card">
    <header class="sd-card__header">
      <div>
        <p v-if="eyebrow" class="sd-eyebrow">{{ eyebrow }}</p>
        <h2><YjIcon v-if="icon" :name="icon" size="sm" />{{ title }}</h2>
        <p v-if="subtitle" class="sd-muted sd-card__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="action" />
    </header>
    <slot />
    <footer v-if="$slots.footer" class="sd-card__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>
