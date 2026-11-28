<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import CampaignFilm from "./CampaignFilm.vue";
import ContactFollowUp from "./ContactFollowUp.vue";
import { audience, campaign, outcomes, stageLabels, stageOf, stages, usd, type Creator, type Language, type Stage } from "./campaign";

const contacts = defineModel<Creator[]>("contacts", { required: true });
const opened = ref<string | null>(null);
const topic = ref("");
const phase = ref<Stage | "">("");
const notice = ref("");
const directory = ref<HTMLElement>();
const phaseControl = ref<HTMLSelectElement>();
const recapTitle = ref<HTMLHeadingElement>();
const uid = useId();
const topics = computed(() => [...new Set(contacts.value.map(contact => contact.topic))]);
const matches = computed(() => contacts.value.filter(person => (!topic.value || person.topic === topic.value)
  && (!phase.value || stageOf(person) === phase.value)));
const total = computed(() => outcomes(contacts.value));
const nextPerson = computed(() => matches.value.find(person => stageOf(person) === "candidate")
  ?? matches.value.find(person => stageOf(person) !== "published"));
const primaryLabel = computed(() => nextPerson.value ? (stageOf(nextPerson.value) === "candidate" ? "准备邀约" : "跟进合作") : "查看成效");

function filterChanged() { opened.value = null; notice.value = ""; }
function clearFilters() { topic.value = ""; phase.value = ""; filterChanged(); }
function toggle(person: Creator) { opened.value = opened.value === person.id ? null : person.id; notice.value = ""; }
async function openNext() {
  const person = nextPerson.value;
  if (!person) { recapTitle.value?.focus({ preventScroll: true }); recapTitle.value?.scrollIntoView({ block: "nearest" }); return; }
  notice.value = ""; opened.value = person.id;
  await nextTick();
  const detail = directory.value?.querySelector<HTMLElement>(`[data-person="${person.id}"] .contact-detail`);
  const target = detail?.querySelector<HTMLElement>("textarea, .record-button");
  target?.focus({ preventScroll: true });
  detail?.scrollIntoView({ block: "nearest" });
}
function replace(person: Creator) {
  contacts.value = contacts.value.map(current => current.id === person.id ? person : current);
}
function saveDraft(person: Creator, stage: "candidate" | "invited", language: Language, value: string) {
  replace({ ...person, drafts: { ...person.drafts, [`${stage}-${language}`]: value } });
}
const nextStages = { candidate: "invited", invited: "replied", replied: "sampled", sampled: "published" } as const;
async function advance(person: Creator, expected: Stage, message?: string) {
  const current = contacts.value.find(item => item.id === person.id);
  if (!current || stageOf(current) !== expected || expected === "published" || (expected === "candidate" && !message?.trim())) return;
  const next = nextStages[expected];
  replace({ ...current, history: [...current.history, { stage: next, when: "本次预览", message }] });
  notice.value = current.name + " 的合作进度已更新为「" + stageLabels[next] + "」。";
  if (phase.value) {
    opened.value = null;
    await nextTick(); phaseControl.value?.focus({ preventScroll: true });
  } else {
    await nextTick();
    directory.value?.querySelector<HTMLButtonElement>(`[data-person="${current.id}"] .creator-row`)?.focus({ preventScroll: true });
  }
}
function saveOrders(person: Creator, value: number) {
  if (stageOf(person) !== "published" || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * campaign.unitPriceCents)) return;
  replace({ ...person, attributedOrders: value });
  notice.value = person.name + " 的归因订单已保存。";
}
</script>

<template>
  <section class="outreach-workspace" aria-label="通勤包试背计划操作区">
    <header class="campaign-hero">
      <div class="campaign-copy">
        <h4>拍摄简报</h4>
        <p class="campaign-brief">拍一条编织包试背短片，先装进日常随身物，再拍上肩效果。</p>
        <p class="campaign-terms"><span>免费寄样</span><span>成交佣金 {{ campaign.commissionPercent }}%</span></p>
        <button type="button" class="campaign-action" @click="openNext">{{ primaryLabel }}<YjIcon name="arrowRight" size="xs" /></button>
      </div>
      <CampaignFilm />
    </header>

    <section ref="directory" class="contact-directory" aria-label="合作名单">
      <div class="directory-heading">
        <h4>合作名单 <small>{{ matches.length }}{{ topic || phase ? ' / ' + contacts.length : '' }} 位</small></h4>
        <div class="directory-filters">
          <label><select v-model="topic" aria-label="筛选内容方向" @change="filterChanged"><option value="">全部方向</option><option v-for="option in topics" :key="option">{{ option }}</option></select><YjIcon name="chevronDown" size="xs" /></label>
          <label><select ref="phaseControl" v-model="phase" aria-label="筛选合作进度" @change="filterChanged"><option value="">全部进度</option><option v-for="option in stages" :key="option" :value="option">{{ stageLabels[option] }}</option></select><YjIcon name="chevronDown" size="xs" /></label>
        </div>
      </div>
      <div class="roster-head roster-grid" aria-hidden="true"><span>达人与近期作品</span><span>粉丝数</span><span>近 30 天均播</span><span>进度</span></div>
      <ul class="creator-list">
        <li v-for="person in matches" :key="person.id" :data-person="person.id">
          <button type="button" class="creator-row roster-grid" :aria-expanded="opened === person.id"
            :aria-controls="uid + '-' + person.id" :aria-label="person.name + '，' + person.topic + '，' + person.recentPost + '，粉丝 ' + audience(person.followers) + '，近 30 天平均播放 ' + audience(person.avgViews30d) + ' 次，' + stageLabels[stageOf(person)]"
            @click="toggle(person)">
            <span class="creator-name"><strong>{{ person.name }}</strong><small>{{ person.recentPost }}</small>
              <span class="mobile-signals">{{ audience(person.followers) }}粉丝 · 近 30 天均播 {{ audience(person.avgViews30d) }}</span>
            </span>
            <span class="row-metric">{{ audience(person.followers) }}</span><span class="row-metric">{{ audience(person.avgViews30d) }}</span>
            <span class="row-stage">{{ stageLabels[stageOf(person)] }}</span>
            <YjIcon name="chevronDown" size="xs" tone="muted" />
          </button>
          <div :id="uid + '-' + person.id" :hidden="opened !== person.id">
            <ContactFollowUp v-if="opened === person.id" :person="person" @draft="(s, l, v) => saveDraft(person, s, l, v)"
              @advance="(s, message) => advance(person, s, message)" @orders="saveOrders(person, $event)" />
          </div>
        </li>
      </ul>
      <div v-if="!matches.length" class="empty-list"><span>没有符合条件的达人</span><button type="button" @click="clearFilters">清除筛选</button></div>
      <p class="directory-notice" role="status">{{ notice }}</p>
    </section>

    <section class="campaign-results" aria-label="合作复盘">
      <header><h4 ref="recapTitle" tabindex="-1">合作复盘</h4><small>11 月 · 全部 {{ contacts.length }} 位达人</small></header>
      <dl class="results-ledger">
        <div><dt>邀约回复率</dt><dd>{{ total.replyRate }}</dd><dd>已回复 {{ total.replied }} / 已邀约 {{ total.invited }} 位</dd></div>
        <div><dt>归因成交额</dt><dd>{{ total.attributed ? usd(total.revenue) : '—' }}</dd><dd>{{ total.orders }} 单 · 已归因 {{ total.attributed }} / {{ total.published }} 条内容</dd></div>
        <div><dt>投入产出比</dt><dd>{{ total.returnRatio }}</dd><dd>合作支出 {{ usd(total.cost) }}</dd></div>
      </dl>
      <details class="cost-breakdown">
        <summary>费用明细<YjIcon name="chevronDown" size="xs" /></summary>
        <dl><div><dt>寄样与运费 · {{ total.sampled }} 件 × {{ usd(campaign.sampleAndShippingCents) }}</dt><dd>{{ usd(total.samples) }}</dd></div>
          <div><dt>成交佣金 · {{ campaign.commissionPercent }}%</dt><dd>{{ usd(total.commission) }}</dd></div></dl>
        <p>投入产出比按归因成交额除以寄样、运费与佣金的合计支出计算。</p>
      </details>
    </section>
  </section>
</template>

<style scoped>
.outreach-workspace {
  container: outreach / inline-size; min-width: 0; padding-block: var(--yj-space-5);
  color: var(--yj-color-text-primary);
}
.campaign-hero { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); align-items: center; gap: var(--yj-space-8); }
.campaign-copy { min-width: 0; }
.campaign-copy p, .outreach-workspace h4, .results-ledger dd, .directory-notice { margin: 0; }
.campaign-terms { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-2); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); color: var(--yj-color-text-secondary); }
.campaign-terms > span + span { padding-inline-start: var(--yj-space-2); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-default); }
.campaign-copy .campaign-brief { max-width: 28em; margin-top: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.campaign-copy .campaign-terms { margin-top: var(--yj-space-3); }
.campaign-action { display: inline-flex; align-items: center; justify-content: center; gap: var(--yj-space-3); min-height: var(--yj-control-height-md); padding: 0 var(--yj-space-4); margin-top: var(--yj-space-4); border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-bg-page); background: var(--yj-color-text-primary); font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-medium); }
.campaign-action:hover { background: var(--yj-color-text-secondary); }
.campaign-action :deep(svg) { color: inherit; }
.contact-directory, .campaign-results { margin-top: var(--yj-space-8); }
.directory-heading, .campaign-results > header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-2); flex-wrap: wrap; margin-bottom: var(--yj-space-3); }
.outreach-workspace h4 { font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-semibold); letter-spacing: -.02em; }
.directory-heading small, .campaign-results > header small { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); font-weight: var(--yj-font-weight-regular); letter-spacing: normal; }
.directory-heading h4 small { margin-inline-start: var(--yj-space-1); }
.directory-filters { display: flex; align-items: center; gap: var(--yj-space-2); }
.directory-filters label { display: inline-grid; align-items: center; position: relative; min-width: 0; }
.directory-filters label > :deep(svg) { pointer-events: none; position: absolute; right: var(--yj-space-1); }
.directory-filters select { appearance: none; max-width: 100%; min-height: var(--yj-control-height-sm); padding: 0 var(--yj-space-5) 0 var(--yj-space-1); border: var(--yj-border-width) solid transparent; border-radius: var(--yj-radius-sm); color: var(--yj-color-text-secondary); background: var(--yj-color-bg-page); font: inherit; font-size: var(--yj-font-size-caption); cursor: pointer; }
.directory-filters select:hover { background: var(--yj-color-control-hover); }
.roster-grid { display: grid; grid-template-columns: minmax(0,1.95fr) minmax(0,.86fr) minmax(0,1.1fr) minmax(0,.78fr) var(--yj-space-4); align-items: center; gap: var(--yj-space-2); }
.roster-head { padding: var(--yj-space-2) var(--yj-space-2) var(--yj-space-2) 0; border-block: var(--yj-border-width) solid var(--yj-color-border-subtle); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.creator-list { padding: 0; margin: 0; list-style: none; }
.creator-list > li { min-width: 0; border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.creator-row { width: 100%; min-height: var(--yj-space-16); padding: var(--yj-space-2) var(--yj-space-2) var(--yj-space-2) 0; border: 0; background: transparent; color: var(--yj-color-text-primary); text-align: start; }
.creator-row:hover .creator-name strong { text-decoration: underline; text-underline-offset: 3px; }
.creator-row[aria-expanded=true] > :deep(svg) { transform: rotate(180deg); }
.creator-name { display: grid; min-width: 0; gap: 2px; }
.creator-name strong { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); font-weight: var(--yj-font-weight-semibold); }
.creator-name small, .mobile-signals { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); line-height: var(--yj-line-height-caption); }
.row-metric { font-size: var(--yj-font-size-context-window); font-variant-numeric: tabular-nums; }
.row-stage { font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); white-space: nowrap; }
.empty-list { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-2); padding: var(--yj-space-4) 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-context-window); }
.empty-list button { padding: var(--yj-space-1) var(--yj-space-2); border: 0; border-radius: var(--yj-radius-sm); background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.directory-notice { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.directory-notice:not(:empty) { margin-top: var(--yj-space-2); }
.results-ledger { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--yj-space-4); padding: var(--yj-space-4) 0; margin: 0; border-block: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.results-ledger > div + div { padding-inline-start: var(--yj-space-4); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.results-ledger dt, .results-ledger dd + dd, .cost-breakdown { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.results-ledger dt + dd { margin-block: var(--yj-space-1); font-size: var(--yj-font-size-page-title); line-height: var(--yj-line-height-page-title); letter-spacing: -.04em; font-weight: var(--yj-font-weight-semibold); font-variant-numeric: tabular-nums; }
.cost-breakdown { margin-top: var(--yj-space-2); }
.cost-breakdown summary { display: inline-flex; align-items: center; gap: var(--yj-space-1); cursor: pointer; list-style: none; }
.cost-breakdown summary::-webkit-details-marker { display: none; }
.cost-breakdown[open] summary :deep(svg) { transform: rotate(180deg); }
.cost-breakdown dl { display: grid; gap: var(--yj-space-1); margin: var(--yj-space-2) 0; }
.cost-breakdown dl > div { display: flex; gap: var(--yj-space-2); }
.cost-breakdown dd { margin: 0; color: var(--yj-color-text-primary); font-variant-numeric: tabular-nums; }
.cost-breakdown p { margin: 0; }
.mobile-signals { display: none; }
.outreach-workspace :is(button,summary,[tabindex]):focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: -2px; }
.directory-filters select:focus-visible { outline: 0; border-color: var(--yj-color-focus-ring); }
@container outreach (max-width: 580px) {
  .campaign-hero { gap: var(--yj-space-4); grid-template-columns: minmax(0,1.15fr) minmax(0,.85fr); }
  .roster-grid { grid-template-columns: minmax(0,1.45fr) minmax(0,.8fr) minmax(0,.95fr) minmax(0,.65fr) var(--yj-space-3); }
}
@container outreach (max-width: 470px) {
  .campaign-hero { grid-template-columns: minmax(0,1fr); }
  .directory-heading { align-items: baseline; }
  .directory-filters { gap: var(--yj-space-1); }
  .roster-grid { grid-template-columns: minmax(0,1fr) auto var(--yj-space-3); }
  .roster-head > :nth-child(2), .roster-head > :nth-child(3), .row-metric { display: none; }
  .mobile-signals { display: block; }
  .results-ledger { gap: var(--yj-space-2); }
  .results-ledger > div + div { padding-inline-start: var(--yj-space-2); }
  .results-ledger dt + dd { font-size: var(--yj-font-size-section-title); }
}
</style>
