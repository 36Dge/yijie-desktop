<script setup lang="ts">
import { computed } from "vue";
import MaterialImage from "./MaterialImage.vue";
import { targetingLabel, type ConfigSection, type OptionalChip } from "./config";
import { describeConfig, type AgentConfig } from "./presentation";
const props = defineProps<{ config: AgentConfig }>();
const emit = defineEmits<{ open: [section: ConfigSection]; remove: [token: OptionalChip] }>();
const view = computed(() => describeConfig(props.config));
const tokens = computed(() => [
  { key: "direction", prefix: "生成", text: view.value.directionLabel },
  { key: "targeting", prefix: "投放", text: targetingLabel(props.config) },
  { key: "settings", prefix: "设置", text: view.value.settingsLabel },
] as const);
</script>
<template>
  <span class="agent-prompt" :class="config.kind + '-prompt'">
    <strong class="agent-prompt__agent">@{{ view.agent }}</strong>
    <button type="button" :aria-label="'管理' + view.materialLabel + '，已添加' + view.images.length + '张'" @click="emit('open','product')" @keydown.delete.prevent>
      {{ view.materialLabel }}<span class="agent-prompt__stack"><MaterialImage v-for="(m,i) in view.images.slice(0,3)" :key="i" :source="m.src" :style="{zIndex:3-i}" /></span>
      <small v-if="view.images.length && (config.kind === 'video' || view.images.length > 1)">{{ view.images.length }}</small><span v-if="!view.images.length">＋</span>
    </button>
    <template v-if="!view.missing.length">
      <template v-for="token in tokens" :key="token.key"><span v-if="!config.removed.includes(token.key)" class="agent-prompt__part">{{ token.prefix }}
        <button type="button" @click="emit('open',token.key)" @keydown.delete.prevent="emit('remove',token.key)">{{ token.text }}</button>
      </span></template>
    </template>
  </span>
</template>
<style scoped>
.agent-prompt { display: contents; color: var(--yj-color-text-primary); }
.agent-prompt__part { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.agent-prompt button, .agent-prompt__agent { display: inline-flex; align-items: center; gap: 4px; min-height: 25px; padding: 2px 7px; border: 1px solid var(--agent-line); border-radius: 6px; background: var(--agent-tint); color: var(--agent-ink); font-size: 13px; line-height: 19px; font-weight: 600; }
.agent-prompt__agent { border-color: transparent; }
.agent-prompt button:hover { background: var(--agent-tint-strong); }
.agent-prompt__stack { display: inline-flex; }
.agent-prompt__stack img { position: relative; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--yj-color-bg-card); object-fit: cover; }
.agent-prompt__stack img + img { margin-left: -8px; }
</style>
