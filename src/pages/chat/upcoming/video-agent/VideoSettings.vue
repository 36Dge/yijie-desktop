<script setup lang="ts">
import type { VideoConfig, VideoRatio } from "./draft";
const draft = defineModel<VideoConfig>({ required: true });
const ratios: { value: VideoRatio; hint: string }[] = [
  { value: "自适应", hint: "有素材跟随素材，无素材按平台" }, { value: "9:16", hint: "竖屏" },
  { value: "16:9", hint: "横屏" }, { value: "1:1", hint: "正方形" },
];
</script>

<template>
  <div class="video-settings">
    <h4>视频设置</h4>
    <div class="video-duration">
      <button type="button" aria-label="缩短视频时长" :disabled="draft.duration <= 4" @click="draft.duration--">−</button>
      <strong>{{ draft.duration }}秒</strong>
      <input v-model.number="draft.duration" type="range" min="4" max="15" step="1" aria-label="视频时长" :aria-valuetext="draft.duration + '秒'" />
      <button type="button" aria-label="增加视频时长" :disabled="draft.duration >= 15" @click="draft.duration++">＋</button>
    </div>
    <div class="duration-ends"><small>4秒</small><small>15秒</small></div>
    <h4>生成比例</h4>
    <div class="video-ratios"><button v-for="item in ratios" :key="item.value" type="button"
      :aria-pressed="draft.ratio === item.value" @click="draft.ratio = item.value"><strong>{{ item.value }}</strong><small>{{ item.hint }}</small></button></div>
    <label class="video-audio"><span><strong>生成音频</strong><small>生成配音音频，工具默认开启</small></span>
      <input v-model="draft.generateAudio" type="checkbox" aria-label="生成音频" /></label>
  </div>
</template>

<style scoped>
.video-settings { padding: 10px; border-top: 1px solid var(--agent-line); }
.video-settings h4 { margin: 0 0 8px; font-size: 13px; }
.video-duration { display: grid; grid-template-columns: 32px auto minmax(0,1fr) 32px; gap: 10px; align-items: center; padding: 6px; border: 1px solid var(--agent-line); border-radius: var(--yj-radius-sm); }
.video-duration input { width: 100%; min-width: 0; }
.video-settings input { accent-color: var(--agent-ink); }
.duration-ends, .video-audio { display: flex; align-items: center; justify-content: space-between; }
.duration-ends { margin: 3px 4px 14px; }
.video-ratios { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; }
.video-ratios button { padding: 8px; text-align: left; }
.video-settings small { display: block; margin-top: 3px; font-size: 11px; color: var(--yj-color-text-secondary); }
.video-audio { margin-top: 12px; padding: 8px; border: 1px solid var(--agent-line); border-radius: var(--yj-radius-sm); cursor: pointer; }
.video-audio input { appearance: none; width: 32px; height: 18px; border-radius: var(--yj-radius-full); background: var(--yj-color-control-track); padding: 2px; cursor: pointer; }
.video-audio input::after { content: ""; display: block; height: 14px; width: 14px; border-radius: 50%; background: var(--yj-color-control-switch-thumb); }
.video-audio input:checked { background: var(--yj-color-brand-primary); }
.video-audio input:checked::after { transform: translateX(14px); background: var(--yj-color-on-brand); }
@media (max-width: 600px) { .video-ratios { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
