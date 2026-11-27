<script setup lang="ts">
import { computed } from "vue";
import ImageStepper from "./ImageStepper.vue";
import { ratios, ratioHints, suiteTypes, outputCount, type ImageConfig } from "./draft";
const draft = defineModel<ImageConfig>({ required: true });
const size = computed(() => draft.value.sizes[draft.value.direction]);
const devices = { desktopAPlus: "电脑 A+", mobileAPlus: "手机 A+" } as const;
</script>
<template>
  <div class="config-settings">
    <h4>图片设置</h4>
    <template v-if="draft.direction === 'suite'">
      <div class="settings-row"><strong>图片类型与数量</strong><strong>共 {{ outputCount(draft) }} 张</strong></div>
      <div v-for="(label,key) in suiteTypes" :key="key" class="settings-row"><label><input v-model="draft.suite.outputs[key].enabled" type="checkbox" />{{ label }}</label>
        <ImageStepper v-model="draft.suite.outputs[key].count" :label="label" :disabled="!draft.suite.outputs[key].enabled" /></div>
      <div class="settings-row"><label><input v-model="draft.suite.aPlus" type="checkbox" />A+ 图</label><small>作为商品套图中的可选输出</small></div>
    </template>
    <ImageStepper v-else v-model="size.count" label="生成数量" />
    <h4>生成比例</h4><div class="ratio-grid">
      <button v-for="(ratio,i) in ratios" :key="ratio" type="button" :aria-pressed="size.ratio === ratio" @click="size.ratio = ratio"><strong>{{ ratio }}</strong><small>{{ ratioHints[i] }}</small></button>
    </div>
    <template v-if="draft.direction === 'suite' && draft.suite.aPlus">
      <h4>A+ 图设置</h4><div class="settings-row"><small>开启后参考素材中出现可选风格图。</small><span>
        <button type="button" :aria-pressed="draft.suite.advanced" @click="draft.suite.advanced = true">高级 A+</button>
        <button type="button" :aria-pressed="!draft.suite.advanced" @click="draft.suite.advanced = false">普通 A+</button></span></div>
      <template v-for="(label,key) in devices" :key="key"><div v-if="key === 'desktopAPlus' || draft.suite.advanced" class="settings-row">
        <label><input v-model="draft.suite.outputs[key].enabled" type="checkbox" />{{ label }}</label><ImageStepper v-model="draft.suite.outputs[key].count" :label="label" :disabled="!draft.suite.outputs[key].enabled" />
      </div></template>
      <h4>A+ 比例</h4><div class="aplus-ratios"><button v-for="r in [...ratios,'自定义']" :key="r" type="button" :aria-pressed="draft.suite.ratio === r" @click="draft.suite.ratio = r">{{ r }}</button></div>
      <input v-if="draft.suite.ratio === '自定义'" v-model="draft.suite.customRatio" aria-label="自定义 A+ 比例" placeholder="例如 3:2、970x600" />
      <div class="settings-row"><label><input v-model="draft.suite.noText" type="checkbox" />无文字模式</label><small>生成不含文字的 A+ 画面</small></div>
    </template>
  </div>
</template>
<style scoped>
.config-settings { padding: 10px; border-top: 1px solid var(--agent-line); }
.config-settings h4 { margin: 14px 0 8px; padding-top: 10px; border-top: 1px solid var(--agent-line); font-size: 13px; }
.config-settings h4:first-child { margin-top: 0; border: none; padding: 0; }
.ratio-grid small { display: grid; gap: 4px; font-size: 11px; color: var(--yj-color-text-secondary); }
.settings-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; min-height: 34px; }
.settings-row label { display: flex; align-items: center; gap: 6px; }
.settings-row input { accent-color: var(--agent-ink); }
.ratio-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; }
.ratio-grid button { padding: 8px; text-align: left; }
.ratio-grid small { margin-top: 3px; }
.aplus-ratios { display: flex; flex-wrap: wrap; gap: 4px; }
@media(max-width:600px) { .ratio-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
</style>
