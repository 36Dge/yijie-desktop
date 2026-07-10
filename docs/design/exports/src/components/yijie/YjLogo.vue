<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'mark' | 'horizontal' | 'icon-only'
  size?: 'sm' | 'md' | 'lg'
}>(), {
  variant: 'horizontal',
  size: 'md'
})
</script>

<template>
  <div class="yj-logo" :class="[`yj-logo--${variant}`, `yj-logo--${size}`]" aria-label="易界">
    <img class="yj-logo__mark" src="/brand/yijie-bag-logo.svg" alt="" />
    <span v-if="variant !== 'icon-only'" class="yj-logo__text">易界</span>
  </div>
</template>

<style scoped>
.yj-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-primary);
  font-family: var(--yj-font-family-sans);
  font-weight: 700;
}

.yj-logo__mark { display: block; }
.yj-logo--sm .yj-logo__mark { width: 24px; height: 24px; }
.yj-logo--md .yj-logo__mark { width: 32px; height: 32px; }
.yj-logo--lg .yj-logo__mark { width: 40px; height: 40px; }
.yj-logo--sm .yj-logo__text { font-size: 16px; }
.yj-logo--md .yj-logo__text { font-size: 18px; }
.yj-logo--lg .yj-logo__text { font-size: 22px; }
</style>
