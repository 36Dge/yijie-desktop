<script setup lang="ts">
import { computed } from 'vue'
import markLight from '../../assets/brand/yijie-mark.svg'
import markDark from '../../assets/brand/yijie-mark-dark.svg'
import horizontalLight from '../../assets/brand/yijie-horizontal.svg'
import horizontalDark from '../../assets/brand/yijie-horizontal-dark.svg'
import appIcon from '../../assets/brand/yijie-app-icon.svg'

const props = withDefaults(defineProps<{
  variant?: 'mark' | 'horizontal' | 'icon-only'
  size?: 'sm' | 'md' | 'lg'
  theme?: 'auto' | 'light' | 'dark'
}>(), {
  variant: 'horizontal',
  size: 'md',
  theme: 'auto'
})

const sources = computed(() => {
  if (props.variant === 'icon-only') return { light: appIcon, dark: appIcon }
  if (props.variant === 'mark') return { light: markLight, dark: markDark }
  return { light: horizontalLight, dark: horizontalDark }
})
</script>

<template>
  <span class="yj-logo" :class="[`yj-logo--${variant}`, `yj-logo--${size}`]" :data-logo-theme="theme" role="img" aria-label="易界">
    <img class="yj-logo__image yj-logo__image--light" :src="sources.light" alt="" />
    <img class="yj-logo__image yj-logo__image--dark" :src="sources.dark" alt="" />
  </span>
</template>

<style scoped>
.yj-logo {
  --yj-logo-fallback-light: block;
  --yj-logo-fallback-dark: none;
  --yj-logo-show-light: var(--yj-brand-logo-light-display, var(--yj-logo-fallback-light));
  --yj-logo-show-dark: var(--yj-brand-logo-dark-display, var(--yj-logo-fallback-dark));
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  vertical-align: middle;
}

.yj-logo__image { width: auto; max-width: 100%; }
.yj-logo__image--light { display: var(--yj-logo-show-light); }
.yj-logo__image--dark { display: var(--yj-logo-show-dark); }
.yj-logo--sm .yj-logo__image { height: 24px; }
.yj-logo--md .yj-logo__image { height: 32px; }
.yj-logo--lg .yj-logo__image { height: 40px; }

/* Theme-boundary variables inherit from the nearest data-theme ancestor.
   System preference is only the fallback when no explicit theme exists. */
@media (prefers-color-scheme: dark) {
  .yj-logo { --yj-logo-fallback-light: none; --yj-logo-fallback-dark: block; }
}
.yj-logo[data-logo-theme="dark"] { --yj-logo-show-light: none; --yj-logo-show-dark: block; }
.yj-logo[data-logo-theme="light"] { --yj-logo-show-light: block; --yj-logo-show-dark: none; }
</style>
