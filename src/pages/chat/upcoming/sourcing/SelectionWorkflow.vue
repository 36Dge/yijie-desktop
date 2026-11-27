<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import WorkflowChoices from "./WorkflowChoices.vue";
import { marketplaces, products, type MarketId, type ProductId, type SelectionScene } from "./examples";
import { publishingHandoff, workflowFor, type StepId, type WorkflowStep } from "./workflow";

const props = defineProps<{ scene: SelectionScene }>();
const steps = workflowFor(props.scene.id);
const branchStart = steps.findIndex(step => step.id === "logistics");
const hasBrief = steps[0].id === "opportunity";
const sharedProgress = ref(hasBrief ? 1 : 0);
const selected = ref<ProductId[]>([props.scene.products[0]]);
type Offer = "small" | "volume";
const offerNames: Record<Offer, string> = props.scene.id === "develop"
  ? { small: "成熟工艺试样", volume: "定制工艺试样" } : { small: "小批现货", volume: "整箱供货" };
const quotes = ref<Partial<Record<ProductId, Offer>>>({});
const targetIds = ref<MarketId[]>(["tk-us", "amz-us"]);
const activeTarget = ref<MarketId>("tk-us");
const branchProgress = ref<Partial<Record<MarketId, number>>>({});
const opened = ref(new Set<string>(steps.slice(0, sharedProgress.value + 1).map(step => step.id)));
const root = ref<HTMLElement>();
const uid = useId();
const markets = computed(() => marketplaces.filter(site => targetIds.value.includes(site.id)));
const market = computed(() => markets.value.find(site => site.id === activeTarget.value) ?? markets.value[0]);
const picked = computed(() => props.scene.products.filter(id => selected.value.includes(id)));
const matched = computed(() => picked.value.filter(id => quotes.value[id]).length);
const done = computed(() => sharedProgress.value === branchStart && markets.value.length > 0
  && markets.value.every(site => branchProgress.value[site.id] === steps.length - branchStart));

type Row = WorkflowStep & { key: string; index: number; state: "done" | "current" | "waiting" };
function row(step: WorkflowStep, index: number): Row {
  const perSite = index >= branchStart;
  const cursor = perSite && sharedProgress.value === branchStart && market.value
    ? branchStart + (branchProgress.value[market.value.id] ?? 0) : sharedProgress.value;
  return { ...step, index, key: perSite ? `${market.value?.id ?? "none"}-${step.id}` : step.id,
    state: index < cursor ? "done" : index === cursor && (!perSite || !!market.value) ? "current" : "waiting" };
}
const sections = computed(() => {
  const rows = steps.map(row);
  return [{ perSite: false, rows: rows.slice(0, branchStart) }, { perSite: true, rows: rows.slice(branchStart) }];
});
const poolOptions = props.scene.products.map(id => ({
  id, name: products[id].name, image: products[id].image, value: money(products[id].budget), note: "示例预算 / 件",
}));
const siteOptions = marketplaces.map(site => ({ id: site.id, name: site.label, note: site.route }));

function money(n: number) { return "¥" + Number(n.toFixed(2)).toString(); }
function unitCost(id: ProductId, offer = quotes.value[id]) {
  const factor = offer === "volume" ? (props.scene.id === "develop" ? 1.2 : 0.9) : 1;
  return Math.round(products[id].budget * factor * 100) / 100;
}
function offersFor(id: ProductId) {
  const dev = props.scene.id === "develop";
  return (["small", "volume"] as const).map(offer => ({
    id: offer, name: offerNames[offer],
    image: products[id].image, value: money(unitCost(id, offer)),
    note: dev ? `量产估价 / 件 · 打样 ${offer === "small" ? 7 : 14} 天` : `每件 · 起订 ${offer === "small" ? 12 : 60} 件`,
  }));
}
function invalidateFrom(id: StepId) {
  const index = steps.findIndex(step => step.id === id);
  sharedProgress.value = Math.min(sharedProgress.value, index);
  branchProgress.value = {};
}
function chooseProduct(id: ProductId) {
  if (props.scene.id === "boutique") selected.value = [id];
  else selected.value = selected.value.includes(id) ? selected.value.filter(key => key !== id) : [...selected.value, id];
  for (const key of props.scene.products) if (!selected.value.includes(key)) delete quotes.value[key];
  invalidateFrom("pool");
}
function chooseQuote(id: ProductId, offer: Offer) {
  quotes.value[id] = offer;
  invalidateFrom("sourcing");
}
function chooseTarget(id: MarketId) {
  targetIds.value = targetIds.value.includes(id) ? targetIds.value.filter(key => key !== id) : [...targetIds.value, id];
  if (!targetIds.value.includes(activeTarget.value) && targetIds.value.length) activeTarget.value = targetIds.value[0];
  invalidateFrom("targets");
}
function canAdvance(id: StepId) {
  if (id === "pool") return picked.value.length > 0;
  if (id === "sourcing") return picked.value.length > 0 && matched.value === picked.value.length;
  if (id === "targets") return markets.value.length > 0;
  return true;
}
function toggle(key: string) {
  if (opened.value.has(key)) opened.value.delete(key);
  else opened.value.add(key);
}
async function reveal(index: number) {
  const next = row(steps[index], index);
  opened.value.add(next.key);
  await nextTick();
  const header = root.value?.querySelector<HTMLButtonElement>(`button[data-heading="${next.key}"]`);
  header?.focus({ preventScroll: true });
  header?.scrollIntoView({ block: "nearest" });
}
function switchBranch(id: MarketId) {
  activeTarget.value = id;
  const index = branchStart + Math.min(branchProgress.value[id] ?? 0, steps.length - branchStart - 1);
  opened.value.add(row(steps[index], index).key);
}
async function advance(step: Row) {
  if (step.state !== "current" || !canAdvance(step.id)) return;
  opened.value = new Set([step.key]);
  if (step.index < branchStart) sharedProgress.value = step.index + 1;
  else if (market.value) branchProgress.value[market.value.id] = step.index - branchStart + 1;
  if (step.index < steps.length - 1) {
    await reveal(step.index + 1);
  } else {
    const nextSite = markets.value.find(site => (branchProgress.value[site.id] ?? 0) < steps.length - branchStart);
    if (nextSite) {
      switchBranch(nextSite.id);
      await reveal(branchStart + (branchProgress.value[nextSite.id] ?? 0));
    } else {
      await nextTick();
      root.value?.querySelector<HTMLElement>(".workflow-complete")?.focus();
    }
  }
}
function summary(step: WorkflowStep) {
  if (step.id === "opportunity" || (step.id === "pool" && !hasBrief)) return props.scene.overview;
  const note = props.scene.notes[step.id];
  return note ? [step.purpose, note] : [step.purpose];
}
function statusText(step: Row) {
  if (step.state === "current") return "当前步骤";
  if (step.state === "waiting") return "等待上一步";
  return step.id === "opportunity" && hasBrief ? "已预填" : "已确认";
}
function nextLabel(step: Row) {
  if (step.id !== "screening") return "继续";
  return markets.value.some(site => site.id !== activeTarget.value && (branchProgress.value[site.id] ?? 0) < steps.length - branchStart)
    ? "继续下一站" : "完成示例";
}
function examplePrice(id: ProductId) { return products[id].budget * 2 + 24; }
</script>

<template>
  <article ref="root" class="selection-workflow" :aria-label="scene.label + '选品流程'">
    <header class="workflow-heading">
      <div><h2>{{ scene.label }}选品流程</h2><span>{{ steps.length }} 个选品节点 · 手动演示</span></div>
      <p>{{ scene.premise }}</p>
    </header>
    <section v-for="section in sections" :key="String(section.perSite)" :aria-label="section.perSite ? '按站点核对' : '共同研究与供应准备'">
      <div v-if="section.perSite" class="branches">
        <h3>按平台与站点核对</h3>
        <div v-if="markets.length" class="site-switch" role="group" aria-label="查看站点分支">
          <button v-for="site in markets" :key="site.id" type="button" :aria-pressed="market?.id === site.id" @click="switchBranch(site.id)">
            <YjIcon v-if="branchProgress[site.id] === steps.length - branchStart" name="checkmark" size="xs" />{{ site.label }}
          </button>
        </div>
        <p v-else>请先在「发布目标」选择站点。</p>
      </div>
      <ol class="step-list" :start="section.rows[0].index + 1">
        <li v-for="step in section.rows" :key="step.key" class="workflow-step" :data-step="step.id" :data-state="step.state">
          <span class="step-marker" aria-hidden="true"><YjIcon v-if="step.state === 'done'" name="checkmark" size="xs" /><template v-else>{{ step.index + 1 }}</template></span>
          <div class="step-card">
            <h3><button type="button" class="step-heading" :data-heading="step.key" :aria-expanded="opened.has(step.key)"
              :aria-controls="uid + step.key" @click="toggle(step.key)">
              <strong>{{ step.title }}</strong><small v-if="step.id === 'definition'">开品专属</small>
              <span>{{ statusText(step) }}</span><YjIcon name="chevronDown" size="xs" />
            </button></h3>
            <div :id="uid + step.key" :hidden="!opened.has(step.key)">
              <div v-if="opened.has(step.key)" class="step-body">
                <div class="step-summary">
                  <h4>{{ step.id === 'opportunity' ? '商机概述' : step.id === 'pool' ? '候选概述' : '本步要点' }}</h4>
                  <ul><li v-for="line in summary(step)" :key="line">{{ line }}</li></ul>
                </div>
                <WorkflowChoices v-if="step.id === 'pool'" :label="scene.id === 'develop' ? '对标参考样品' : '候选商品'" unit="款"
                  :options="poolOptions" :selected="selected" :single="scene.id === 'boutique'" :disabled="step.state === 'waiting'" @choose="chooseProduct" />
                <dl v-else-if="step.id === 'filter' && picked.length" class="candidate-facts">
                  <div v-for="id in picked" :key="id"><dt>{{ products[id].name }}</dt><dd>{{ products[id].feature }} · 预算 {{ money(products[id].budget) }} / 件</dd></div>
                </dl>
                <template v-else-if="step.id === 'sourcing'">
                  <h4>{{ scene.id === 'develop' ? '工艺与打样方案' : '1688 货源比选' }} <small>示例报价</small></h4>
                  <p v-if="!picked.length">在商品池选中商品后，可在这里比选供货方案。</p>
                  <div v-for="id in picked" :key="id" class="source-choices">
                    <WorkflowChoices :label="products[id].name" unit="个方案" :options="offersFor(id)"
                      :selected="quotes[id] ? [quotes[id]!] : []" single :disabled="step.state === 'waiting'" @choose="chooseQuote(id, $event)" />
                  </div>
                </template>
                <dl v-else-if="step.id === 'inquiry' && matched" class="candidate-facts">
                  <template v-for="id in picked" :key="id">
                    <div v-if="quotes[id]"><dt>{{ products[id].name }}</dt><dd>已选{{ offerNames[quotes[id]!] }} · 示例单价 {{ money(unitCost(id)) }}，待复核交期与规格</dd></div>
                  </template>
                </dl>
                <WorkflowChoices v-else-if="step.id === 'targets'" label="发布目标" unit="个可选站点" :options="siteOptions"
                  :selected="targetIds" :disabled="step.state === 'waiting'" @choose="chooseTarget" />
                <div v-else-if="step.id === 'logistics' && market" class="site-facts">
                  <span>{{ market.label }}</span><strong>{{ market.route }}</strong><span>示例履约预算 {{ money(market.shipping) }} / 件</span>
                </div>
                <div v-else-if="step.id === 'profit' && market" class="estimate">
                  <h4>{{ market.label }} <small>示例测算 · 元 / 件</small></h4>
                  <p v-if="!picked.length">在商品池选中商品后，可查看单件测算。</p>
                  <div v-for="id in picked" :key="id">
                    <strong>{{ products[id].name }}</strong>
                    <span>售价 {{ examplePrice(id) }} − 采购 {{ unitCost(id) }} − 履约 {{ market.shipping }} − 其他费用 {{ market.fees }}</span>
                    <b>结余 {{ money(examplePrice(id) - unitCost(id) - market.shipping - market.fees) }}</b>
                  </div>
                </div>
                <div v-else-if="step.id === 'screening' && market" class="site-facts">
                  <span>{{ market.label }}</span><strong>待核对材料</strong><span>商品规格、来源凭据、站点准入和知识产权材料</span>
                </div>
                <details class="checklist">
                  <summary>查看 {{ step.checks.length }} 项核查内容</summary>
                  <ul><li v-for="check in step.checks" :key="check">{{ check }}</li></ul>
                </details>
                <p class="step-output"><strong>本步产出</strong>{{ step.output }}</p>
                <footer v-if="step.state === 'current'" class="step-actions">
                  <span v-if="step.id === 'pool'">已选 {{ picked.length }} 款</span>
                  <span v-else-if="step.id === 'sourcing'">已匹配 {{ matched }} / {{ picked.length }} 款</span>
                  <span v-else-if="step.id === 'targets'">已选 {{ markets.length }} 个站点</span>
                  <button type="button" class="yj-control" :disabled="!canAdvance(step.id)" @click="advance(step)">{{ nextLabel(step) }}<YjIcon name="arrowRight" size="xs" /></button>
                </footer>
              </div>
            </div>
          </div>
        </li>
      </ol>
    </section>
    <p v-if="done" class="workflow-complete" role="status" tabindex="-1"><YjIcon name="check" size="sm" />已完成 {{ picked.length }} 款商品、{{ markets.length }} 个站点的选品流程演示。</p>
    <section class="workflow-handoff" aria-label="后续发布流程">
      <h3>后续发布流程</h3><p>选品结论交给各目标站点，试卖反馈回到下一轮商品判断。</p>
      <details v-for="item in publishingHandoff" :key="item.title"><summary>{{ item.title }}</summary><p>{{ item.purpose }}<br />产出为{{ item.output }}。</p></details>
    </section>
  </article>
</template>

<style scoped>
.selection-workflow { margin-top: var(--yj-space-4); color: var(--yj-color-text-primary); }
.selection-workflow h2, .selection-workflow h3, .selection-workflow h4, .selection-workflow p { margin: 0; }
.workflow-heading { margin-bottom: var(--yj-space-5); }
.workflow-heading > div { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--yj-space-2); }
.workflow-heading h2 { font-size: 21px; line-height: 29px; font-weight: var(--yj-font-weight-semibold); }
.workflow-heading > div > span, .workflow-handoff > p, .branches > p { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.workflow-heading > p { margin-top: var(--yj-space-2); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); }
.step-list { list-style: none; padding: 0; margin: 0; }
.workflow-step {
  display: grid;
  position: relative;
  grid-template-columns: var(--yj-space-6) minmax(0, 1fr);
  align-items: start;
  gap: var(--yj-space-3);
  padding-bottom: var(--yj-space-3);
}
.workflow-step:not(:last-child)::before {
  content: "";
  position: absolute;
  inset-block: 30px -14px;
  inset-inline-start: 11px;
  border-inline-start: var(--yj-border-width) dashed var(--yj-color-border-strong);
}
.step-marker {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--yj-space-6);
  height: var(--yj-space-6);
  margin-top: var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-tertiary);
  background: var(--yj-color-bg-card);
  font-size: var(--yj-font-size-caption);
  font-variant-numeric: tabular-nums;
}
[data-state="done"] > .step-marker, [data-state="current"] > .step-marker { border-color: var(--yj-color-text-primary); }
[data-state="current"] > .step-marker { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-semibold); }
[data-state="done"] > .step-marker { color: var(--yj-color-bg-card); background: var(--yj-color-text-primary); }
.step-marker :deep(svg) { color: inherit; }
.step-card { min-width: 0; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
[data-state="current"] > .step-card { border-color: var(--yj-color-border-strong); }
.step-heading { display: flex; align-items: center; width: 100%; min-height: 46px; gap: var(--yj-space-2); padding: var(--yj-space-2) var(--yj-space-4); border: 0; border-radius: var(--yj-radius-lg); background: transparent; color: var(--yj-color-text-primary); text-align: start; }
.step-heading strong { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); font-weight: var(--yj-font-weight-semibold); }
.step-heading span, .step-heading small, .step-body h4 small { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-regular); }
.step-heading span { margin-inline-start: auto; white-space: nowrap; }
.step-heading[aria-expanded="true"] :deep(svg) { transform: rotate(180deg); }
.step-heading:hover { background: var(--yj-color-control-hover); }
.step-body { display: grid; gap: var(--yj-space-3); padding: 0 var(--yj-space-4) var(--yj-space-4); }
.step-body h4 { font-weight: var(--yj-font-weight-semibold); font-size: var(--yj-font-size-context-window); }
.step-body p, .step-summary ul, .checklist { font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-body); color: var(--yj-color-text-secondary); }
.step-summary { padding: var(--yj-space-3) var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-md); background: var(--yj-color-control-hover); }
.step-summary ul, .checklist ul { margin: var(--yj-space-1) 0 0; padding-inline-start: var(--yj-space-5); }
.step-summary li + li { margin-top: var(--yj-space-1); }
.checklist > summary, .workflow-handoff summary { width: fit-content; cursor: pointer; }
.checklist summary { font-size: var(--yj-font-size-caption); }
.step-output { overflow-wrap: anywhere; }
.step-output strong { margin-right: var(--yj-space-2); font-weight: var(--yj-font-weight-medium); color: var(--yj-color-text-primary); }
.step-actions { display: flex; gap: var(--yj-space-3); justify-content: flex-end; align-items: center; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.step-actions button { border: 0; color: var(--yj-color-bg-card); background: var(--yj-color-text-primary); }
.step-actions button:hover:enabled { background: var(--yj-color-text-secondary); }
.step-actions button:disabled { background: var(--yj-color-control-disabled-bg); color: var(--yj-color-text-disabled); cursor: not-allowed; }
.step-actions :deep(svg) { color: inherit; }
.source-choices + .source-choices { padding-top: var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.candidate-facts { display: grid; gap: var(--yj-space-1); margin: 0; font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.candidate-facts > div { display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-2); }
.candidate-facts dt { font-weight: var(--yj-font-weight-medium); }
.candidate-facts dd { margin: 0; color: var(--yj-color-text-secondary); }
.branches, .workflow-handoff { margin: var(--yj-space-4) 0 var(--yj-space-3); }
.branches h3, .workflow-handoff h3 { margin-bottom: var(--yj-space-2); font-size: var(--yj-font-size-card-title); }
.site-switch, .site-facts { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); align-items: center; }
.site-switch button { display: inline-flex; align-items: center; gap: var(--yj-space-1); min-height: var(--yj-control-height-sm); padding: 0 var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.site-switch button[aria-pressed="true"] { border-color: var(--yj-color-text-primary); color: var(--yj-color-text-primary); }
.site-facts, .estimate { font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); color: var(--yj-color-text-secondary); }
.site-facts strong, .estimate b, .estimate strong { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.estimate > div { display: flex; flex-wrap: wrap; gap: var(--yj-space-1) var(--yj-space-3); align-items: baseline; padding-block: var(--yj-space-2); border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); font-variant-numeric: tabular-nums; }
.estimate b { margin-inline-start: auto; }
.workflow-complete { display: flex; align-items: center; gap: var(--yj-space-2); padding: var(--yj-space-3); color: var(--yj-color-text-primary); font-size: var(--yj-font-size-context-window); }
.workflow-handoff { border-top: var(--yj-border-width) solid var(--yj-color-border-default); padding-top: var(--yj-space-4); }
.workflow-handoff details { padding: var(--yj-space-2) 0; border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle); font-size: var(--yj-font-size-context-window); }
.workflow-handoff details p { margin-top: var(--yj-space-1); color: var(--yj-color-text-secondary); line-height: var(--yj-line-height-body); }
.selection-workflow summary:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
@container scene-gallery (max-width: 550px) {
  .workflow-step { gap: var(--yj-space-2); }
  .step-heading, .step-summary { padding-inline: var(--yj-space-2); }
  .step-body { padding-inline: var(--yj-space-2); }
}
@media (pointer: coarse) { .step-actions button, .site-switch button { min-height: 44px; } }
</style>
