<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import bag from "../video-agent/assets/previews/seeding-input.webp";
import sessionPhoto from "./assets/creator-session.webp";
import parcelPhoto from "./assets/sample-parcel.webp";
import cupPhoto from "./assets/cup-detail.webp";
import OutreachCaseStudy from "./OutreachCaseStudy.vue";
import OutreachCostRing from "./OutreachCostRing.vue";
import { usd, type Creator, type Language } from "./campaign";
import { features, invitation, reviewRounds, workPreviews } from "./showcase";

const contacts = defineModel<Creator[]>("contacts", { required: true });
const uid = useId();
const topic = ref<keyof typeof workPreviews>("style");
const language = ref<Language>("en");
const roundIndex = ref(0);
const round = computed(() => reviewRounds[roundIndex.value]);
const spend = computed(() => round.value.sampling + round.value.commission);
const caseOpen = ref(false);
const caseButton = ref<HTMLButtonElement>();
const caseEntry = ref<HTMLElement>();
function jump(id: string) {
  const heading = document.getElementById(uid + "-" + id);
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView({ block: "start" });
}
async function toggleCase() {
  caseOpen.value = !caseOpen.value;
  await nextTick();
  caseButton.value?.focus({ preventScroll: true });
  if (caseOpen.value) caseEntry.value?.scrollIntoView({ block: "start" });
}
</script>

<template>
  <section class="outreach-showcase" aria-label="达人建联功能展示">
    <header class="showcase-intro">
      <div class="intro-copy">
        <p class="platform">TikTok Shop</p>
        <h2>达人建联</h2>
        <p class="intro-lead">通过近期作品判断合作人选，跟进样品和内容交付，再核算成交回报。</p>
        <nav class="feature-index" aria-label="建联功能目录">
          <a v-for="feature in features" :key="feature.id" :href="'#' + uid + '-' + feature.id" @click.prevent="jump(feature.id)">{{ feature.title }}</a>
        </nav>
      </div>
      <img class="intro-photo" :src="sessionPhoto" width="1024" height="683" alt="创作者用手机拍摄陶杯的使用场景" decoding="async" />
    </header>

    <div class="feature-story">
      <section v-for="feature in features" :key="feature.id" class="feature-spread" :data-feature="feature.id" :aria-labelledby="uid + '-' + feature.id">
        <div class="feature-copy">
          <h3 :id="uid + '-' + feature.id" tabindex="-1">{{ feature.title }}</h3>
          <p>{{ feature.copy }}</p>
        </div>

        <figure v-if="feature.id === 'discover'" class="feature-art discovery-art" aria-label="按方向筛选近期作品的示例">
          <div class="art-top">
            <span>近期作品示例</span>
            <div class="art-switch" role="group" aria-label="选择作品方向">
              <button type="button" :aria-pressed="topic === 'style'" @click="topic = 'style'">穿搭</button>
              <button type="button" :aria-pressed="topic === 'home'" @click="topic = 'home'">生活</button>
            </div>
          </div>
          <div class="work-pair" aria-live="polite">
            <figure v-for="work in workPreviews[topic]" :key="work.title">
              <img :src="work.photo" :alt="work.alt" :style="{ objectPosition: work.position }" loading="lazy" decoding="async" />
              <figcaption><strong>{{ work.title }}</strong><span>近 30 天均播 {{ work.views }}</span></figcaption>
            </figure>
          </div>
        </figure>

        <figure v-else-if="feature.id === 'invite'" class="feature-art invitation-art" aria-label="陶杯合作的双语邀约示例">
          <div class="letter-sheet">
            <div class="art-top">
              <span class="letter-label"><YjIcon name="message" size="xs" />邀约草稿</span>
              <div class="art-switch" role="group" aria-label="选择邀约示例语言">
                <button type="button" :aria-pressed="language === 'en'" @click="language = 'en'">English</button>
                <button type="button" :aria-pressed="language === 'zh'" @click="language = 'zh'">中文</button>
              </div>
            </div>
            <blockquote :lang="language === 'en' ? 'en' : 'zh-CN'" aria-live="polite">
              <strong>{{ invitation[language].greeting }}</strong><p>{{ invitation[language].text }}</p>
            </blockquote>
            <div class="offer-product"><img :src="cupPhoto" alt="" width="40" height="34" loading="lazy" /><span>寄样商品<strong>陶瓷咖啡杯</strong></span></div>
          </div>
        </figure>

        <figure v-else-if="feature.id === 'samples'" class="feature-art shipment-art" aria-label="陶杯寄样与交付记录示例">
          <img :src="parcelPhoto" width="700" height="525" alt="陶杯用蜂窝纸包好，准备装箱寄样" loading="lazy" decoding="async" />
          <div class="shipment-slip">
            <strong>寄样记录</strong>
            <ol>
              <li><span>11/18</span>确认寄样</li>
              <li><span>11/20</span>样品寄出</li>
              <li><span>11/25</span>约定交稿</li>
            </ol>
          </div>
        </figure>

        <figure v-else class="feature-art review-art" aria-label="对比两轮合作成效的示例">
          <div class="art-top">
            <span>30 天合作示例</span>
            <div class="art-switch" role="group" aria-label="选择复盘轮次">
              <button v-for="(item, i) in reviewRounds" :key="item.label" type="button" :aria-pressed="roundIndex === i" @click="roundIndex = i">{{ item.label }}</button>
            </div>
          </div>
          <div class="review-statement" aria-live="polite">
            <OutreachCostRing :sampling="round.sampling" :commission="round.commission" />
            <div class="review-ratio"><span>投入产出比</span><strong>{{ (round.sales / spend).toFixed(1) }}<small>×</small></strong></div>
            <dl>
              <div><dt>归因订单</dt><dd>{{ round.orders }} 单</dd></div>
              <div><dt>归因成交额</dt><dd>{{ usd(round.sales * 100) }}</dd></div>
            </dl>
          </div>
          <dl class="cost-key"><div><dt>寄样与运费</dt><dd>{{ usd(round.sampling * 100) }}</dd></div><div><dt>成交佣金</dt><dd>{{ usd(round.commission * 100) }}</dd></div></dl>
        </figure>
      </section>
    </div>

    <section class="case-example" :aria-labelledby="uid + '-case-title'">
      <div ref="caseEntry" class="case-entry">
        <img :src="bag" alt="" width="80" height="70" loading="lazy" decoding="async" />
        <div class="case-name"><p>合作案例 · 美国站</p><h3 :id="uid + '-case-title'">通勤包试背计划</h3></div>
        <button ref="caseButton" type="button" class="case-toggle" :aria-expanded="caseOpen" :aria-controls="uid + '-case-content'" @click="toggleCase">
          {{ caseOpen ? '收起案例' : '查看案例' }}<YjIcon :name="caseOpen ? 'chevronDown' : 'arrowRight'" size="xs" />
        </button>
      </div>
      <div :id="uid + '-case-content'" :hidden="!caseOpen"><OutreachCaseStudy v-if="caseOpen" v-model:contacts="contacts" /></div>
    </section>
  </section>
</template>

<style scoped>
.outreach-showcase {
  container: outreach-story / inline-size; width: min(100%, var(--yj-layout-chat-entry-max)); min-width: 0;
  margin: clamp(var(--yj-space-8), 6%, var(--yj-space-12)) auto var(--yj-space-5); color: var(--yj-color-text-primary);
  --story-paper: color-mix(in srgb, var(--yj-color-chart-series-5) 7%, var(--yj-color-bg-subtle));
  --story-cool: color-mix(in srgb, var(--yj-color-chart-series-3) 5%, var(--yj-color-bg-subtle));
}
.showcase-intro { display: grid; grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr); align-items: center; gap: var(--yj-space-8); }
.intro-copy, .feature-copy { min-width: 0; }
:where(.outreach-showcase) :where(.platform,.intro-lead,.intro-copy h2,.feature-copy h3,.feature-copy p,.feature-art,.work-pair figure,.letter-sheet blockquote,.letter-sheet p,.review-statement dl,.review-statement dd,.case-name p,.case-name h3) { margin: 0; }
.platform { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-medium); color: var(--yj-color-text-secondary); }
.intro-copy h2 { margin-block-start: var(--yj-space-1); font-size: var(--yj-font-size-display); line-height: var(--yj-line-height-display); letter-spacing: -.045em; font-weight: var(--yj-font-weight-semibold); }
.intro-copy .intro-lead { margin-top: var(--yj-space-3); max-width: 24em; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.feature-index { display: flex; flex-wrap: wrap; gap: 0 var(--yj-space-3); margin-top: var(--yj-space-3); }
.feature-index a { display: inline-flex; align-items: center; min-height: var(--yj-control-height-sm); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); text-decoration: underline; text-underline-offset: 4px; text-decoration-color: var(--yj-color-border-control); }
.feature-index a:hover { color: var(--yj-color-text-primary); text-decoration-color: currentColor; }
.intro-photo { display: block; width: 100%; height: auto; aspect-ratio: 1.55; border-radius: var(--yj-image-gallery-radius); object-fit: cover; }
.feature-story { display: grid; }
.feature-spread { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr); grid-template-areas: "art copy"; align-items: center; gap: var(--yj-space-10); padding-top: var(--yj-space-10); }
.feature-spread:nth-child(even) { grid-template-columns: minmax(0, .88fr) minmax(0, 1.12fr); grid-template-areas: "copy art"; }
.feature-copy { grid-area: copy; }
.feature-copy h3 { font-size: var(--yj-font-size-metric-md); line-height: var(--yj-line-height-page-title); font-weight: var(--yj-font-weight-semibold); letter-spacing: -.025em; scroll-margin-block-start: var(--yj-space-5); }
.feature-copy p { margin-top: var(--yj-space-2); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.feature-art { grid-area: art; min-width: 0; border-radius: var(--yj-image-gallery-radius); }
.art-top, .case-entry { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-2); }
.art-top > span, .work-pair figcaption span, .shipment-slip > strong, .shipment-slip li span, .review-statement dt, .review-ratio > span, .case-name p { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.art-top > span { font-weight: var(--yj-font-weight-medium); }
.art-switch { display: inline-flex; align-items: center; gap: 2px; }
.art-switch button { padding: 2px var(--yj-space-2); min-height: var(--yj-space-6); border: var(--yj-border-width) solid transparent; border-radius: var(--yj-radius-sm); background: transparent; color: var(--yj-color-text-secondary); font: inherit; font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.art-switch button[aria-pressed="true"] { background: var(--yj-color-bg-card); border-color: var(--yj-color-border-default); color: var(--yj-color-text-primary); }
.art-switch button:hover { text-decoration: underline; text-underline-offset: 3px; }
.discovery-art { padding: var(--yj-space-3); background: var(--story-cool); }
.work-pair { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--yj-space-2); margin-top: var(--yj-space-2); }
.work-pair img { width: 100%; display: block; aspect-ratio: 1.65; object-fit: cover; border-radius: var(--yj-radius-sm); }
.work-pair figcaption { display: grid; gap: 1px; padding-top: var(--yj-space-1); }
.work-pair figcaption strong { font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.work-pair figcaption span { color: var(--yj-color-text-secondary); }
.invitation-art { background: var(--story-paper); padding: var(--yj-space-4) var(--yj-space-5); }
.letter-sheet { padding: var(--yj-space-3) var(--yj-space-4); background: var(--yj-color-bg-card); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-sm); }
.letter-label { display: inline-flex; align-items: center; gap: var(--yj-space-1); }
.letter-sheet .art-top { padding-bottom: var(--yj-space-2); border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.letter-sheet blockquote { padding-block: var(--yj-space-3) var(--yj-space-1); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-context-window); }
.letter-sheet blockquote strong { font-weight: var(--yj-font-weight-semibold); }
.letter-sheet blockquote p { margin-top: var(--yj-space-1); }
.offer-product { display: flex; gap: var(--yj-space-2); align-items: center; padding-top: var(--yj-space-2); }
.offer-product img { width: var(--yj-space-10); height: var(--yj-space-8); object-fit: cover; border-radius: var(--yj-radius-xs); }
.offer-product span { display: flex; gap: var(--yj-space-2); align-items: baseline; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.offer-product strong { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.shipment-art { display: grid; grid-template-columns: minmax(0,1.25fr) minmax(0,.8fr); overflow: hidden; background: var(--story-paper); }
.shipment-art > img { width: 100%; height: 100%; min-height: 0; min-width: 0; object-fit: cover; object-position: 50% 55%; }
.shipment-slip { padding: var(--yj-space-4); }
.shipment-slip > strong { font-weight: var(--yj-font-weight-semibold); }
.shipment-slip ol { margin: var(--yj-space-2) 0 0; padding: 0; list-style: none; }
.shipment-slip li { display: grid; position: relative; padding: 0 0 var(--yj-space-2) var(--yj-space-3); font-size: var(--yj-font-size-context-window); }
.shipment-slip li::before { content: ""; position: absolute; left: 0; top: 6px; width: 5px; height: 5px; border: 1px solid var(--yj-color-text-secondary); border-radius: 50%; background: var(--yj-color-text-secondary); }
.shipment-slip li:not(:last-child)::after { content: ""; position: absolute; left: 3px; top: 14px; bottom: -4px; border-inline-start: 1px solid var(--yj-color-border-control); }
.shipment-slip li:last-child { padding-bottom: 0; }
.shipment-slip li:last-child::before { background: transparent; }
.shipment-slip li span { color: var(--yj-color-text-secondary); font-variant-numeric: tabular-nums; }
.review-art { background: var(--yj-color-on-brand); color: var(--yj-video-play-ink); padding: var(--yj-space-4) var(--yj-space-5); }
.review-art .art-top > span, .review-ratio > span, .review-statement dt { color: color-mix(in srgb,var(--yj-video-play-ink) 76%,var(--yj-color-on-brand)); }
.review-art .art-switch button { color: var(--yj-video-play-ink); }
.review-art .art-switch button[aria-pressed="true"] { color: var(--yj-color-on-brand); background: var(--yj-color-bg-connector-artwork); border-color: transparent; }
.review-statement { display: grid; grid-template-columns: minmax(0,.8fr) minmax(0,.67fr) minmax(0,1fr); align-items: center; gap: var(--yj-space-2); margin-block: var(--yj-space-3) var(--yj-space-2); }
.review-ratio { display: grid; gap: var(--yj-space-1); }
.review-ratio strong { font-size: var(--yj-font-size-display); line-height: var(--yj-line-height-display); letter-spacing: -.045em; font-variant-numeric: tabular-nums; font-weight: var(--yj-font-weight-semibold); }
.review-ratio small { margin-inline-start: 2px; font-size: var(--yj-font-size-section-title); color: var(--yj-color-brand-primary); }
.review-statement dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--yj-space-2); padding-block: var(--yj-space-1); border-bottom: 1px solid color-mix(in srgb,var(--yj-video-play-ink) 18%,transparent); }
.review-statement dd { font-size: var(--yj-font-size-context-window); font-variant-numeric: tabular-nums; }
.cost-key { display: flex; flex-wrap: wrap; gap: var(--yj-space-2) var(--yj-space-4); margin: 0; padding-top: var(--yj-space-2); border-top: 1px solid color-mix(in srgb,var(--yj-video-play-ink) 18%,transparent); }
.cost-key > div { display: inline-flex; gap: var(--yj-space-1); align-items: center; font-size: var(--yj-font-size-caption); }
.cost-key > div::before { content: ""; width: var(--yj-space-2); height: var(--yj-space-2); background: var(--yj-color-brand-primary); border-radius: 2px; }
.cost-key > div + div::before { background: var(--yj-image-aplus-backdrop); }
.cost-key dd { margin: 0; font-variant-numeric: tabular-nums; }
.case-example { margin-top: var(--yj-space-10); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
.case-entry { justify-content: start; padding-top: var(--yj-space-4); scroll-margin-block-start: var(--yj-space-2); }
.case-entry > img { width: var(--yj-space-16); height: var(--yj-space-16); flex: none; object-fit: contain; border-radius: var(--yj-radius-md); background: var(--yj-color-bg-connector-artwork); }
.case-name { min-width: 0; }
.case-name p { color: var(--yj-color-text-secondary); }
.case-name h3 { font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); font-weight: var(--yj-font-weight-semibold); }
.case-toggle { margin-inline-start: auto; display: inline-flex; align-items: center; gap: var(--yj-space-1); min-height: var(--yj-control-height-sm); flex: none; padding: 0 var(--yj-space-2); border: 0; border-radius: var(--yj-radius-sm); color: var(--yj-color-text-primary); background: transparent; font-size: var(--yj-font-size-context-window); }
.case-toggle:hover { background: var(--yj-color-control-hover); }
.case-toggle[aria-expanded="true"] :deep(svg) { transform: rotate(180deg); }
.outreach-showcase :is(a,button,[tabindex]):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: -2px; }
.review-art button:focus-visible { outline-color: var(--yj-color-brand-primary); }
@container outreach-story (max-width: 560px) {
  .showcase-intro { gap: var(--yj-space-4); grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
  .feature-spread, .feature-spread:nth-child(even) { gap: var(--yj-space-3); grid-template-columns: minmax(0,1fr); grid-template-areas: "copy" "art"; }
  .feature-copy p { max-width: none; }
  .review-statement { gap: var(--yj-space-2); }
}
@container outreach-story (max-width: 420px) {
  .showcase-intro { grid-template-columns: minmax(0,1fr); }
  .intro-photo { aspect-ratio: 1.85; }
  .feature-spread { padding-top: var(--yj-space-6); }
  .invitation-art { padding: var(--yj-space-3); }
  .shipment-slip { padding: var(--yj-space-3); }
  .review-art { padding: var(--yj-space-3); }
  .case-entry > img { width: var(--yj-space-12); height: var(--yj-space-12); }
}
@media (pointer: coarse) { .art-switch button, .case-toggle, .feature-index a { min-height: 44px; } }
</style>
