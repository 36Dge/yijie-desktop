<script setup lang="ts">
import { computed, ref } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import CheckHistory from "./CheckHistory.vue";
import CheckMaterial from "./CheckMaterial.vue";
import { countries, draftIssue, makeDraft, recordFromDraft, sites, type CheckRecord } from "./manual";
import type { ComplianceScene } from "./scenes";

const props = defineProps<{ scene: ComplianceScene }>();
const records = defineModel<CheckRecord[]>({ required: true });
const draft = ref(makeDraft(props.scene, true));
const history = ref<InstanceType<typeof CheckHistory>>();
const issue = computed(() => draftIssue(props.scene, draft.value));
const targetLabel = computed(() => props.scene.target === "site" ? "上架平台与站点" : "上架国家");
const reviewOptions = ["喷雾包装", "净含量", "用途描述"];

function start() {
  if (issue.value) return;
  const id = (records.value[0]?.id ?? 0) + 1;
  const record = recordFromDraft(props.scene, draft.value, id);
  records.value = [record, ...records.value];
  void history.value?.reveal(id);
}
</script>

<template>
  <article class="check-workflow" :aria-label="scene.label + '检测流程'">
    <header class="check-heading">
      <div><h2>{{ scene.label }}检测</h2><p>{{ scene.product }} <span>ASIN {{ scene.asin }}</span></p></div>
      <ol class="check-stages" aria-label="示例检测步骤">
        <li v-for="(stage, index) in scene.stages" :key="stage"><YjIcon v-if="index" name="chevronRight" size="xs" />{{ stage }}</li>
      </ol>
    </header>
    <form class="manual-form" aria-label="手动输入" @submit.prevent="start">
      <div class="input-heading"><h3>手动输入</h3><button type="button" class="text-button" @click="draft = makeDraft(scene, true)"><YjIcon name="rerun" size="xs" />填入示例</button></div>
      <div class="input-grid" :class="{ 'with-image': scene.photoLabel }">
        <CheckMaterial v-if="scene.photoLabel" v-model="draft.image" :label="scene.photoLabel" />
        <div class="manual-fields">
          <label v-if="scene.keyword" class="field">
            <span>{{ scene.keyword.label }}</span><input v-model="draft.keyword" type="text" :placeholder="scene.id === 'graphic' ? '输入产品名称' : '输入中英文关键词或产品标题'" />
          </label>
          <label v-if="scene.id === 'graphic'" class="field"><span>商标文字</span><input v-model="draft.markText" type="text" placeholder="输入标识中可见的文字" /></label>
          <template v-if="scene.listing">
            <label class="field">
              <span>产品标题 <small>{{ scene.listing.language }} · 必填</small><small v-if="scene.listing.titleLimit">{{ draft.title.length }} / {{ scene.listing.titleLimit }}</small></span>
              <input v-model="draft.title" type="text" :maxlength="scene.listing.titleLimit" :placeholder="'输入' + scene.listing.language + '标题'" required />
            </label>
            <label class="field">
              <span>产品描述 <small>{{ scene.listing.language }} · 必填</small><small>{{ draft.description.length }} / {{ scene.listing.descriptionLimit }}</small></span>
              <textarea v-model="draft.description" rows="3" :maxlength="scene.listing.descriptionLimit" :placeholder="'输入' + scene.listing.language + '产品描述'" required />
            </label>
          </template>
          <div v-if="scene.target" class="field">
            <span>{{ targetLabel }} <small>必填</small></span>
            <details class="target-picker">
              <summary :aria-label="'选择' + targetLabel"><span>{{ draft.targets.join('、') || '请选择' }}</span><YjIcon name="chevronDown" size="xs" /></summary>
              <div class="target-choices" role="group" :aria-label="targetLabel">
                <label v-for="target in scene.target === 'site' ? sites : countries" :key="target"><input v-model="draft.targets" type="checkbox" :value="target" />{{ target }}</label>
              </div>
            </details>
          </div>
          <label v-if="scene.id === 'policy'" class="field"><span>特征检测 <small>选填</small></span>
            <input v-model="draft.features" list="check-policy-features" placeholder="选择或输入特征，多项用顿号分隔" />
            <datalist id="check-policy-features"><option v-for="option in reviewOptions" :key="option" :value="option" /></datalist>
          </label>
          <aside v-if="scene.id === 'copyright'" class="work-note">
            <strong>作品来源与授权</strong><p>对照原图与印花局部，准备原稿、首次发布记录或许可文件，核对作品在商品上的使用范围。</p>
          </aside>
          <details class="extra-fields" open>
            <summary>更多填写项<YjIcon name="chevronDown" size="xs" /></summary>
            <div>
              <label v-if="scene.id === 'word'" class="field"><span>选择词库</span>
                <select v-model="draft.wordList"><option value="">不使用词库</option><option>示例品牌关注词库</option></select>
              </label>
              <label class="field"><span>SKU <small>选填</small></span><input v-model="draft.sku" type="text" placeholder="输入产品 SKU 编号" /></label>
            </div>
          </details>
        </div>
      </div>
      <label v-if="scene.id === 'invention' || scene.id === 'copyright'" class="extended">
        <input v-model="draft.extended" type="checkbox" />{{ scene.id === 'invention' ? '智能识别' : '全网扫描' }}<small>加入复核清单</small>
      </label>
      <footer class="check-actions">
        <span role="status">{{ issue || '本地演示 · 生成待复核清单' }}</span>
        <button class="text-button" type="button" @click="draft = makeDraft(scene, false)">清空</button>
        <button class="start-check" type="submit" :disabled="!!issue">开始示例检测<YjIcon name="arrowRight" size="xs" /></button>
      </footer>
    </form>
    <CheckHistory ref="history" v-model="records" :mode="scene.id" />
  </article>
</template>

<style scoped>
.check-workflow { margin-top: var(--yj-space-3); color: var(--yj-color-text-primary); }
.check-heading h2, .input-heading h3, .check-heading p, .work-note p { margin: 0; }
.check-heading h2 { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-semibold); }
.check-heading p { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-3); margin-top: var(--yj-space-1); font-size: var(--yj-font-size-context-window); color: var(--yj-color-text-secondary); }
.check-heading p > span { font: var(--yj-font-size-caption) var(--yj-font-family-mono); color: var(--yj-color-text-tertiary); }
.check-stages { display: flex; flex-wrap: wrap; align-items: center; list-style: none; gap: var(--yj-space-1); padding: 0; margin: var(--yj-space-3) 0 var(--yj-space-4); }
.check-stages li { display: inline-flex; align-items: center; gap: var(--yj-space-1); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.check-stages li:first-child { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.manual-form { padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.input-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--yj-space-2); margin-bottom: var(--yj-space-3); }
.input-heading h3 { font-size: var(--yj-font-size-card-title); font-weight: var(--yj-font-weight-semibold); }
.input-grid, .manual-fields { display: grid; align-content: start; gap: var(--yj-space-3); min-width: 0; }
.input-grid.with-image { grid-template-columns: minmax(0, .72fr) minmax(0, 1.75fr); gap: var(--yj-space-5); }
.field { display: grid; min-width: 0; gap: var(--yj-space-1); }
.field > span { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--yj-space-1); font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.field > span > small, .extended small { color: var(--yj-color-text-tertiary); font-weight: var(--yj-font-weight-regular); font-size: var(--yj-font-size-caption); }
.field > span > small + small { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.field > :is(input, textarea, select), .target-picker > summary {
  width: 100%; min-width: 0; min-height: var(--yj-control-height-md); padding: var(--yj-space-1) var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); font: inherit; font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-context-window);
}
.field textarea { resize: vertical; min-height: var(--yj-space-16); }
.field > :is(input, textarea, select):focus { border-color: var(--yj-color-focus-ring); outline: 0; }
.target-picker summary, .extra-fields summary { display: flex; align-items: center; gap: var(--yj-space-1); list-style: none; cursor: pointer; }
.target-picker summary::-webkit-details-marker, .extra-fields summary::-webkit-details-marker { display: none; }
.target-picker summary { justify-content: space-between; }
details[open] > summary > svg { transform: rotate(180deg); }
.target-choices { display: flex; flex-wrap: wrap; gap: var(--yj-space-2) var(--yj-space-3); padding: var(--yj-space-2); }
.target-choices label, .extended { display: inline-flex; align-items: center; gap: var(--yj-space-1); font-size: var(--yj-font-size-context-window); }
.target-choices input, .extended input { accent-color: var(--yj-color-text-primary); }
.extra-fields > summary { width: fit-content; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.extra-fields > div { display: grid; gap: var(--yj-space-2); margin-top: var(--yj-space-2); }
.work-note { padding: var(--yj-space-3); border-radius: var(--yj-radius-md); background: var(--yj-color-control-hover); }
.work-note strong { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.work-note p { margin-top: var(--yj-space-1); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.extended { margin-top: var(--yj-space-3); }
.check-actions { display: flex; align-items: center; justify-content: end; gap: var(--yj-space-3); flex-wrap: wrap; margin-top: var(--yj-space-4); }
.check-actions > span { margin-inline-end: auto; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.text-button, .start-check { display: inline-flex; align-items: center; justify-content: center; gap: var(--yj-space-1); min-height: var(--yj-control-height-sm); border: 0; font-size: var(--yj-font-size-context-window); border-radius: var(--yj-radius-md); }
.text-button { padding: 0 var(--yj-space-1); background: transparent; color: var(--yj-color-text-secondary); }
.text-button:hover { color: var(--yj-color-text-primary); text-decoration: underline; }
.start-check { min-height: var(--yj-control-height-md); padding-inline: var(--yj-space-3); color: var(--yj-color-bg-card); background: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.start-check :deep(svg) { color: inherit; }
.start-check:disabled { color: var(--yj-color-text-disabled); background: var(--yj-color-control-disabled-bg); cursor: not-allowed; }
.check-workflow :is(button, summary, input[type="checkbox"]):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
@container scene-gallery (max-width: 480px) {
  .input-grid.with-image { grid-template-columns: minmax(0, 1fr); gap: var(--yj-space-3); }
  .manual-form { padding: var(--yj-space-3); }
}
@media (pointer: coarse) { .text-button, .start-check { min-height: 44px; } }
</style>
