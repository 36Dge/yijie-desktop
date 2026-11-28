<script setup lang="ts">
import { computed, ref, useId } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import ListingChart from "./ListingChart.vue";
import { amazonReport } from "./amazon-report";
import { tiktokReport } from "./tiktok-report";
import type { ListingScene, ReportPlatform } from "./scenes";

const props = defineProps<{ scene: ListingScene & { id: ReportPlatform } }>();
const report = computed(() => props.scene.id === "amazon" ? amazonReport : tiktokReport);
const uid = useId();
const copyState = ref("");
const suggestedTitle = ref<HTMLElement[]>([]);

function jump(id: string) {
  const target = document.getElementById(uid + "-" + id);
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }
}
async function copyTitle(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copyState.value = "标题已复制";
  } catch {
    const node = suggestedTitle.value.find(el => el.textContent === value);
    const selection = window.getSelection();
    if (!node || !selection) { copyState.value = "可选中标题后复制"; return; }
    const range = document.createRange();
    range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range);
    copyState.value = "标题已选中，可使用系统复制快捷键";
  }
}
</script>

<template>
  <article class="listing-report" :aria-label="scene.label + ' Listing 优化报告'">
    <header class="report-hero" :class="{ 'report-hero--tk': scene.id === 'tk' }">
      <div class="hero-art"><img :src="scene.photos[0].src" :alt="report.name" decoding="async" /></div>
      <div class="hero-text">
        <p class="market-line">{{ report.market }}<span>Listing 优化报告</span></p>
        <h2 :id="uid + '-top'" tabindex="-1">{{ report.name }}</h2>
        <p class="hero-summary">{{ report.summary }}</p>
        <p class="product-id">{{ report.identifier }} {{ scene.productId }}</p>
      </div>
    </header>
    <dl class="report-metrics" aria-label="商品数据快照">
      <div v-for="metric in report.metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div>
    </dl>
    <div class="report-dateline">示例数据 · <time datetime="2026-11-27">2026-11-27</time></div>
    <dl v-if="report.overview" class="product-brief"><div v-for="item in report.overview" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.text }}</dd></div></dl>
    <nav class="report-contents" aria-label="报告目录">
      <a v-for="section in report.sections" :key="section.id" :href="'#' + uid + '-' + section.id" @click.prevent="jump(section.id)">{{ section.nav }}</a>
    </nav>
    <section v-for="section in report.sections" :key="section.id" class="report-section" :aria-labelledby="uid + '-' + section.id">
      <h3 :id="uid + '-' + section.id" tabindex="-1">{{ section.title }}</h3>
      <p class="section-lead">{{ section.lead }}</p>
      <template v-for="(block, index) in section.blocks" :key="index">
        <div v-if="block.type === 'photos'" class="evidence-photos">
          <figure v-for="photo in block.photos" :key="photo.src">
            <div class="photo-mat"><img :src="photo.src" :alt="photo.title" :class="{ contained: photo.contain }" loading="lazy" decoding="async" /></div>
            <figcaption><strong>{{ photo.title }}</strong><span>{{ photo.caption }}</span></figcaption>
          </figure>
        </div>
        <div v-else-if="block.type === 'rewrite'" class="title-comparison">
          <div class="old-title"><h4>当前标题</h4><p lang="en">{{ block.before }}</p></div>
          <div class="new-title"><div><h4>建议标题</h4><button type="button" class="copy-title" aria-label="复制建议标题" @click="copyTitle(block.after)"><YjIcon name="copy" size="xs" />复制</button></div>
            <p ref="suggestedTitle" lang="en">{{ block.after }}</p></div>
          <p class="rewrite-note">{{ block.reason }}</p><span v-if="copyState" class="copy-status" role="status">{{ copyState }}</span>
        </div>
        <div v-else-if="block.type === 'table'" class="report-table-region" tabindex="0" :aria-label="block.title">
          <table><caption>{{ block.title }}</caption>
            <thead><tr><th v-for="col in block.columns" :key="col" scope="col">{{ col }}</th></tr></thead>
            <tbody><tr v-for="row in block.rows" :key="row[0]"><th scope="row">{{ row[0] }}</th><td v-for="(cell, i) in row.slice(1)" :key="i">{{ cell }}</td></tr></tbody>
          </table>
        </div>
        <ListingChart v-else-if="block.type === 'chart'" :chart="block" />
        <div v-else-if="block.type === 'charts'" class="chart-pair"><ListingChart v-for="chart in block.charts" :key="chart.title" :chart="chart" /></div>
        <div v-else-if="block.type === 'flow'" class="report-flow">
          <h4>{{ block.title }}</h4><ol><li v-for="step in block.steps" :key="step.title"><strong>{{ step.title }}</strong><span>{{ step.text }}</span></li></ol>
        </div>
        <div v-else-if="block.type === 'matrix'" class="report-table-region evidence-matrix" tabindex="0" :aria-label="block.title">
          <table><caption>{{ block.title }}</caption><thead><tr><th scope="col">卖点</th><th v-for="column in block.columns" :key="column" scope="col">{{ column }}</th></tr></thead>
            <tbody><tr v-for="row in block.rows" :key="row.label"><th scope="row">{{ row.label }}</th><td v-for="(value, i) in row.values" :key="i"><span :class="{ covered: value === '已有', missing: value === '可补' }">{{ value }}</span></td></tr></tbody>
          </table>
        </div>
        <dl v-else class="report-notes"><div v-for="item in block.items" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.text }}</dd></div></dl>
      </template>
    </section>
    <footer class="report-footer"><p>{{ report.sourceNote }}</p><button type="button" @click="jump('top')">回到报告开头<YjIcon name="arrowUpRight" size="xs" /></button></footer>
  </article>
</template>

<style scoped>
.listing-report { min-width: 0; margin-top: var(--yj-space-3); color: var(--yj-color-text-primary); }
.report-hero { display: grid; grid-template-columns: minmax(0, .78fr) minmax(0, 1.45fr); align-items: stretch; border-radius: var(--yj-radius-lg); overflow: hidden; background: var(--yj-color-control-hover); }
.hero-art { position: relative; min-width: 0; min-height: 196px; background: var(--yj-selection-art-paper); }
.hero-art img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.report-hero--tk .hero-art { background: var(--yj-color-bg-connector-artwork); }
.report-hero--tk .hero-art img { object-fit: contain; padding: var(--yj-space-3); }
.hero-text { align-self: center; padding: var(--yj-space-5); min-width: 0; }
.market-line, .hero-text h2, .hero-summary, .product-id, .report-section h3, .section-lead, .report-footer p { margin: 0; }
.market-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.market-line span { padding-inline-start: var(--yj-space-2); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-strong); }
.hero-text h2 { margin-top: var(--yj-space-2); font-size: var(--yj-font-size-page-title); line-height: var(--yj-line-height-page-title); letter-spacing: -.025em; }
.hero-summary, .section-lead, .report-notes dd { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); }
.hero-summary { margin-top: var(--yj-space-2); }
.product-id { margin-top: var(--yj-space-3); overflow-wrap: anywhere; color: var(--yj-color-text-tertiary); font: var(--yj-font-size-caption) var(--yj-font-family-mono); }
.report-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--yj-space-2); margin: var(--yj-space-4) 0 var(--yj-space-2); }
.report-metrics > div { border-inline-start: var(--yj-border-width) solid var(--yj-color-border-default); padding-inline-start: var(--yj-space-3); }
.report-metrics dt, .report-dateline, .report-footer { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.report-metrics dd { margin: 2px 0 0; font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-variant-numeric: tabular-nums; font-weight: var(--yj-font-weight-semibold); }
.report-dateline { text-align: end; }
.product-brief { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--yj-space-3); margin: var(--yj-space-3) 0 0; padding: var(--yj-space-3); background: var(--yj-color-control-hover); border-radius: var(--yj-radius-md); }
.product-brief dt, .report-flow h4 { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-semibold); }
.product-brief dd { margin: var(--yj-space-1) 0 0; font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.report-contents { display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-2); margin: var(--yj-space-2) 0 0; padding-block: var(--yj-space-2); border-block: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.report-contents a, .report-footer button, .copy-title { display: inline-flex; align-items: center; justify-content: center; gap: var(--yj-space-1); min-height: var(--yj-control-height-sm); border: 0; padding: 0 var(--yj-space-2); border-radius: var(--yj-radius-sm); background: transparent; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); text-decoration: none; }
.report-contents a:hover, .report-footer button:hover, .copy-title:hover { background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.report-section { display: grid; gap: var(--yj-space-3); padding: var(--yj-space-5) 0; border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); min-width: 0; }
.report-section h3 { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); letter-spacing: -.02em; }
.section-lead { margin-top: calc(-1 * var(--yj-space-1)); }
.report-section h3, .hero-text h2 { scroll-margin-block-start: var(--yj-space-4); }
.evidence-photos { display: grid; grid-auto-columns: minmax(0,1fr); grid-auto-flow: column; gap: var(--yj-space-3); }
.evidence-photos figure { min-width: 0; margin: 0; }
.photo-mat { overflow: hidden; aspect-ratio: 1.36; border-radius: var(--yj-radius-md); background: var(--yj-color-bg-connector-artwork); }
.photo-mat img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center 40%; }
.photo-mat img.contained { object-fit: contain; }
.evidence-photos figcaption { display: grid; gap: 2px; margin-top: var(--yj-space-2); }
.evidence-photos strong, .title-comparison h4, .report-notes dt { font-weight: var(--yj-font-weight-semibold); font-size: var(--yj-font-size-context-window); }
.evidence-photos figcaption span, .rewrite-note, .copy-status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.title-comparison { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--yj-space-2); }
.title-comparison > div { min-width: 0; padding: var(--yj-space-3); border-radius: var(--yj-radius-md); border: var(--yj-border-width) solid var(--yj-color-border-default); }
.old-title { color: var(--yj-color-text-secondary); }
.new-title { background: var(--yj-color-control-hover); }
.title-comparison h4, .title-comparison p { margin: 0; }
.title-comparison h4, .new-title > div { min-height: var(--yj-control-height-sm); display: flex; align-items: center; justify-content: space-between; }
.title-comparison p[lang] { overflow-wrap: anywhere; font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); }
.rewrite-note, .copy-status { grid-column: 1 / -1; }
.report-table-region { min-width: 0; overflow-x: auto; }
.report-table-region table { width: 100%; border-collapse: collapse; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.report-table-region caption { text-align: start; font-weight: var(--yj-font-weight-semibold); color: var(--yj-color-text-primary); margin-bottom: var(--yj-space-2); }
.report-table-region :is(td,th) { padding: var(--yj-space-2); border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); text-align: start; vertical-align: top; }
.report-table-region thead th { background: var(--yj-color-control-hover); font-weight: var(--yj-font-weight-medium); }
.report-table-region tbody th { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.report-flow h4 { margin: 0 0 var(--yj-space-2); }
.chart-pair { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: start; gap: var(--yj-space-3); }
@container scene-gallery (max-width: 640px) { .chart-pair { grid-template-columns: minmax(0,1fr); } }
.report-flow ol { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit,minmax(88px,1fr)); gap: var(--yj-space-2); }
.report-flow li { display: grid; align-content: start; gap: var(--yj-space-1); background: var(--yj-color-control-hover); padding: var(--yj-space-2); border-radius: var(--yj-radius-sm); }
.report-flow strong { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.report-flow li span, .evidence-matrix td { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.evidence-matrix td span { display: block; width: fit-content; min-width: 3.5em; padding: 2px var(--yj-space-1); text-align: center; border-radius: var(--yj-radius-xs); background: var(--yj-color-control-hover); }
.evidence-matrix .covered { color: var(--yj-color-text-primary); background: var(--yj-color-success-soft); }
.evidence-matrix .missing { color: var(--yj-color-text-primary); background: var(--yj-color-warning-soft); }
.report-notes { display: grid; margin: 0; gap: var(--yj-space-2); }
.report-notes > div { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,2.7fr); align-items: baseline; gap: var(--yj-space-3); padding-block: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.report-notes dd { margin: 0; }
.report-footer { display: grid; justify-items: start; gap: var(--yj-space-2); padding-block: var(--yj-space-4); line-height: var(--yj-line-height-caption); }
.listing-report :is(a,button,[tabindex]):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: -2px; }
@container scene-gallery (max-width: 535px) {
  .report-hero { grid-template-columns: minmax(0,.7fr) minmax(0,1.2fr); }
  .hero-art { min-height: 150px; }
  .hero-text { padding: var(--yj-space-3); }
  .hero-text h2 { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); }
  .report-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .title-comparison { grid-template-columns: minmax(0,1fr); }
  .report-table-region table { min-width: 360px; }
}
@container scene-gallery (max-width: 365px) {
  .product-brief { grid-template-columns: minmax(0,1fr); gap: var(--yj-space-2); }
  .report-hero { grid-template-columns: minmax(0,1fr); }
  .hero-art { min-height: 0; aspect-ratio: 2.2; }
  .evidence-photos { grid-auto-flow: row; }
  .evidence-photos figure { display: grid; grid-template-columns: 30% minmax(0,1fr); align-items: center; gap: var(--yj-space-2); }
  .evidence-photos figcaption { margin-top: 0; }
  .report-notes > div { grid-template-columns: minmax(0,1fr); gap: var(--yj-space-1); }
}
</style>
