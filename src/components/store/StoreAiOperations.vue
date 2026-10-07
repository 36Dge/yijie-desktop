<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import YjIcon from "../yijie/YjIcon.vue";
import StoreDashboardCard from "./StoreDashboardCard.vue";
import StoreDashboardChart from "./StoreDashboardChart.vue";
import StoreOperationsChart from "./StoreOperationsChart.vue";
import {
  dashboardStats,
  money,
  opportunityData,
  type StoreOpportunity,
} from "../../domain/store-dashboard";
import {
  storeAiGoals,
  storeAiScenes,
  type StoreAiGoal,
  type StoreAiScene,
} from "../../domain/store-ai-scenes";
import "../../styles/store-ai-operations.css";

const props = defineProps<{
  factor: number;
  period: number;
  stats: ReturnType<typeof dashboardStats>;
  completedIds: string[];
  shop?: string;
}>();
type ChartInspection = {
  name: string;
  value: number;
  formattedValue?: string;
  seriesName?: string;
};
const emit = defineEmits<{
  opportunity: [opportunity: StoreOpportunity];
  report: [];
  inspect: [selection: ChartInspection];
}>();
const goal = ref<StoreAiGoal>("all");
const sceneGrid = ref<HTMLElement | null>(null);
const sceneGridMinHeight = ref<number>();
const opportunityFilter = ref("all");
const opportunityVisuals = {
  ads: {
    label: "预计每月节省", value: "$1,280",
    signal: "低效预算占比", signalValue: "18%", share: 18,
    note: "12 个关键词待复核",
  },
  listing: {
    label: "预计转化提升", value: "8–12%",
    signal: "待补充核心词", signalValue: "9 / 26", share: 9 / 26 * 100,
    note: "覆盖 3 款潜力商品",
  },
  reviews: {
    label: "重点关注商品", value: "5 款",
    signal: "包装相关反馈", signalValue: "23 / 186", share: 23 / 186 * 100,
    note: "优先改善包装防护",
  },
} as const;
const visibleScenes = computed(() =>
  storeAiScenes.filter(
    (scene) => goal.value === "all" || scene.id === goal.value,
  ),
);
const visibleOpportunities = computed(() =>
  opportunityData.filter(
    (item) =>
      opportunityFilter.value === "all" ||
      (opportunityFilter.value === "done"
        ? props.completedIds.includes(item.id)
        : !props.completedIds.includes(item.id)),
  ),
);
const pendingCount = computed(
  () =>
    opportunityData.filter((item) => !props.completedIds.includes(item.id))
      .length,
);
const completedCount = computed(
  () => props.stats.completed + props.completedIds.length,
);
const completedSpark = computed(() =>
  [0.26, 0.4, 0.38, 0.52, 0.66, 0.64, 0.82, 1].map((part) =>
    Math.round(completedCount.value * part),
  ),
);
const metricCards = computed(() => [
  {
    label: "AI 关联销售额",
    value: `$${money(props.stats.aiRevenue)}`,
    note: "优化商品销售 · 预估",
    trend: "+23.6%",
    variant: 0,
    metric: "revenue" as const,
  },
  {
    label: "广告费节省",
    value: `$${money(props.stats.saved)}`,
    note: "对比优化前预算 · 预估",
    trend: "低效消耗减少",
    variant: 1,
    metric: "revenue" as const,
  },
  {
    label: "运营时间节省",
    value: money(props.stats.hours),
    unit: "小时",
    note: "按人工处理时长估算",
    trend: "更多时间用于决策",
    variant: 2,
    metric: "efficiency" as const,
  },
  {
    label: "已完成运营任务",
    value: money(completedCount.value),
    unit: "项",
    note: "本期分析、内容与复盘",
    trend: "包含本次生成",
    variant: 3,
    metric: "efficiency" as const,
  },
]);
const recentCompletions = computed(() =>
  [...props.completedIds]
    .reverse()
    .slice(0, 3)
    .map((id) => ({
      id,
      label:
        storeAiScenes.find((scene) => scene.opportunity.id === id)?.title ??
        opportunityData.find((item) => item.id === id)?.category ??
        "商品优化",
      opportunity:
        storeAiScenes.find((scene) => scene.opportunity.id === id)
          ?.opportunity ?? opportunityData.find((item) => item.id === id),
    })),
);
const reviewCount = computed(() => Math.max(1, Math.round(186 * props.factor)));
watch(
  () => [props.shop, props.period],
  () => {
    goal.value = "all";
    opportunityFilter.value = "all";
  },
);
function sceneValues(scene: StoreAiScene): number[] {
  return scene.chart.values.map((value) =>
    scene.chart.scale ? Math.round(value * props.factor) : value,
  );
}
async function changeGoal(nextGoal: StoreAiGoal): Promise<void> {
  if (goal.value === nextGoal) return;
  let scroller = sceneGrid.value?.parentElement ?? null;
  while (scroller && !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  const scrollTop = scroller?.scrollTop;
  // Chart updates measure layout during Vue's patch. Keep the current height until
  // the new content is complete so WebKit cannot clamp the scroll range mid-patch.
  sceneGridMinHeight.value = sceneGrid.value?.getBoundingClientRect().height;
  goal.value = nextGoal;
  await nextTick();
  sceneGridMinHeight.value = undefined;
  await nextTick();
  if (scroller?.isConnected && scrollTop !== undefined) {
    scroller.scrollTop = scrollTop;
  }
}
function selectScene(scene: StoreAiScene): void {
  emit("opportunity", scene.opportunity);
}
function inspect(selection: ChartInspection): void {
  emit("inspect", selection);
}
</script>

<template>
  <div class="aiops">
    <header class="aiops-heading">
      <div>
        <p class="aiops-eyebrow">AI OPERATIONS</p>
        <h2>运营成效与增长机会</h2>
      </div>
      <div class="aiops-heading__actions">
        <span class="aiops-status"><i />{{ pendingCount }} 个机会待处理</span>
        <button class="aiops-button" type="button" @click="emit('report')">
          查看运营简报<YjIcon name="arrowUpRight" size="sm" />
        </button>
      </div>
    </header>

    <section class="aiops-metrics" aria-label="AI 运营成果">
      <article
        v-for="item in metricCards"
        :key="item.label"
        class="aiops-metric"
        :aria-label="item.label"
      >
        <span class="aiops-metric__label">{{ item.label }}</span>
        <p class="aiops-metric__value">
          {{ item.value }}<small v-if="item.unit">{{ item.unit }}</small>
        </p>
        <div class="aiops-metric__chart">
          <StoreOperationsChart
            kind="spark"
            :metric="item.metric"
            :variant="item.variant"
            :factor="factor"
            :period="period"
            :label="`${item.label}走势`"
            :spark-values="item.variant === 3 ? completedSpark : undefined"
            :spark-unit="item.variant === 3 ? '项' : undefined"
          />
        </div>
        <div class="aiops-metric__footer">
          <span>{{ item.note }}</span
          ><strong>{{ item.trend }}</strong>
        </div>
      </article>
    </section>

    <div class="aiops-analysis">
      <StoreDashboardCard
        class="aiops-impact"
        title="AI 优化效果追踪"
        subtitle="同组商品在观察阶段内的销售表现 · USD"
      >
        <template #action><span class="aiops-tag">预估关联贡献</span></template>
        <div class="aiops-chart-intro">
          <div>
            <strong>+23.6<span>%</span></strong>
            <p>关联商品销售额环比</p>
          </div>
          <div class="aiops-inline-facts">
            <span>转化改善 <b>+0.62 pp</b></span
            ><span>ACOS 变化 <b>−3.2 pp</b></span>
          </div>
        </div>
        <StoreDashboardChart
          kind="impact"
          :factor="factor"
          :period="period"
          label="AI 优化效果追踪"
          @select="inspect"
        />
        <template #footer
          ><span
            >优化前基线为同期估算。结合流量和活动变化共同判断，关联变化不等同于因果收益。</span
          ></template
        >
      </StoreDashboardCard>
      <StoreDashboardCard
        class="aiops-priority"
        title="增长机会优先级"
        subtitle="先做高价值、低投入的事"
      >
        <template #action><span class="aiops-tag">6 个分析方向</span></template>
        <StoreOperationsChart
          kind="opportunities"
          :factor="factor"
          :period="period"
          label="增长机会优先级地图"
          @select="inspect"
        />
        <template #footer
          ><span
            >气泡对应运营方向；点击查看预估机会。横轴为处理投入，纵轴为潜在改善幅度。</span
          ></template
        >
      </StoreDashboardCard>
    </div>

    <div class="aiops-diagnostics">
      <StoreDashboardCard
        class="aiops-voices"
        title="客户声音与体验"
        subtitle="从评价主题中找到产品改进方向"
      >
        <template #action
          ><button
            class="aiops-text-button"
            type="button"
            @click="selectScene(storeAiScenes[2]!)"
          >
            查看归因样例<YjIcon name="arrowUpRight" size="xs" /></button
        ></template>
        <div class="aiops-voice-metrics">
          <div>
            <strong>{{ money(reviewCount) }}</strong
            ><span>条演示评价</span>
          </div>
          <div>
            <strong>4.6<small> / 5</small></strong
            ><span>商品平均评分</span>
          </div>
          <p>优先关注<br /><b>包装防护</b></p>
        </div>
        <StoreOperationsChart
          kind="sentiment"
          :factor="factor"
          :period="period"
          label="客户评价主题与情绪分布"
          @select="inspect"
        />
      </StoreDashboardCard>
      <StoreDashboardCard
        class="aiops-capabilities"
        title="运营能力覆盖"
        subtitle="把重复工作交给易界，保留人的判断"
      >
        <StoreOperationsChart
          kind="coverage"
          :factor="factor"
          :period="period"
          label="五项运营能力覆盖率"
          @select="inspect"
        />
        <div class="aiops-capability-summary">
          <div><strong>5</strong><span>运营环节</span></div>
          <div>
            <strong>83.8<small>%</small></strong
            ><span>平均覆盖率</span>
          </div>
        </div>
      </StoreDashboardCard>
      <StoreDashboardCard
        class="aiops-activity"
        title="AI 工作动态"
        subtitle="分析过程与结果都有迹可循"
      >
        <ol class="aiops-timeline">
          <li v-for="item in recentCompletions" :key="item.id">
            <span class="aiops-timeline__point is-completed" />
            <div class="aiops-timeline__meta">
              <time>刚刚</time><span>模拟完成</span>
            </div>
            <h3>{{ item.label }}方案已生成</h3>
            <button
              v-if="item.opportunity"
              class="aiops-text-button"
              type="button"
              @click="emit('opportunity', item.opportunity)"
            >
              查看结果<YjIcon name="arrowRight" size="xs" />
            </button>
            <p v-else>可从对应商品入口重新查看结果。</p>
          </li>
          <li>
            <span class="aiops-timeline__point" />
            <div class="aiops-timeline__meta">
              <time>09:41</time><span>经营诊断</span>
            </div>
            <h3>完成 {{ money(stats.orders) }} 笔订单分析</h3>
            <p>发现 3 个值得进一步处理的机会。</p>
            <button
              class="aiops-text-button"
              type="button"
              @click="emit('report')"
            >
              查看简报<YjIcon name="arrowRight" size="xs" />
            </button>
          </li>
          <li>
            <span class="aiops-timeline__point" />
            <div class="aiops-timeline__meta">
              <time>09:32</time><span>广告诊断</span>
            </div>
            <h3>12 个低效关键词已归类</h3>
            <p>预算调整建议已整理，等待复核。</p>
            <button
              class="aiops-text-button"
              type="button"
              @click="emit('opportunity', opportunityData[0])"
            >
              查看分析<YjIcon name="arrowRight" size="xs" />
            </button>
          </li>
          <li>
            <span class="aiops-timeline__point" />
            <div class="aiops-timeline__meta">
              <time>09:18</time><span>客户声音</span>
            </div>
            <h3>评价中的包装问题值得关注</h3>
            <button
              class="aiops-text-button"
              type="button"
              @click="emit('opportunity', opportunityData[2])"
            >
              查看洞察<YjIcon name="arrowRight" size="xs" />
            </button>
          </li>
        </ol>
      </StoreDashboardCard>
    </div>

    <StoreDashboardCard
      class="aiops-opportunities"
      title="值得行动的增长机会"
      subtitle="分析已经就绪，下一步由你决定"
    >
      <template #action
        ><div class="aiops-segment" role="group" aria-label="增长机会筛选">
          <button
            v-for="filter in [
              { id: 'all', label: '全部' },
              { id: 'pending', label: '待处理' },
              { id: 'done', label: '已完成' },
            ]"
            :key="filter.id"
            type="button"
            :aria-pressed="opportunityFilter === filter.id"
            @click="opportunityFilter = filter.id"
          >
            {{ filter.label }}
          </button>
        </div></template
      >
      <div
        class="aiops-opportunity-list"
        :class="{ 'aiops-opportunity-list--single': visibleOpportunities.length === 1 }"
        aria-live="polite"
      >
        <article
          v-for="item in visibleOpportunities"
          :key="item.id"
          class="aiops-opportunity"
        >
            <div class="aiops-opportunity__meta">
              <span class="aiops-opportunity__number">0{{ opportunityData.indexOf(item) + 1 }}</span>
              <span>{{ item.category }}</span
              ><span
                class="aiops-tag"
                :class="{
                  'aiops-tag--complete': completedIds.includes(item.id),
                  'aiops-tag--priority': item.id === 'ads',
                }"
                >{{
                  completedIds.includes(item.id) ? "方案已生成" : item.priority
                }}</span
              >
            </div>
          <div class="aiops-opportunity__content">
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </div>
          <div class="aiops-opportunity__visual">
            <span>{{ opportunityVisuals[item.id].label }}</span>
            <strong>{{ opportunityVisuals[item.id].value }}</strong>
            <div class="aiops-opportunity__signal">
              <span>{{ opportunityVisuals[item.id].signal }}</span>
              <b>{{ opportunityVisuals[item.id].signalValue }}</b>
            </div>
            <div class="aiops-opportunity__bar" aria-hidden="true">
              <i :style="{ width: `${opportunityVisuals[item.id].share}%` }" />
            </div>
            <small>{{ opportunityVisuals[item.id].note }}</small>
          </div>
          <div class="aiops-opportunity__action">
            <span><i />{{ completedIds.includes(item.id) ? '方案已生成' : '分析已就绪' }}</span>
            <button
              class="aiops-button"
              type="button"
              @click="emit('opportunity', item)"
            >
              {{ completedIds.includes(item.id) ? "查看结果" : "查看建议"
              }}<YjIcon name="arrowUpRight" size="sm" />
            </button>
          </div>
        </article>
        <div v-if="!visibleOpportunities.length" class="aiops-empty">
          <h3>
            {{
              opportunityFilter === "done"
                ? "还没有已生成的方案"
                : "这组机会已全部处理"
            }}
          </h3>
          <p>
            {{
              opportunityFilter === "done"
                ? "选择一个机会，查看证据并模拟生成方案。"
                : "可以查看已完成的方案，或从下方场景开始新的分析。"
            }}
          </p>
          <button
            class="aiops-text-button"
            type="button"
            @click="opportunityFilter = 'all'"
          >
            查看全部机会<YjIcon name="arrowRight" size="sm" />
          </button>
        </div>
      </div>
    </StoreDashboardCard>

    <section class="aiops-workbench" aria-labelledby="aiops-workbench-title">
      <header class="aiops-workbench__header">
        <div>
          <h2 id="aiops-workbench-title">从一个经营问题，开始下一次分析</h2>
          <p>精选日常运营场景，把数据发现推进到具体行动。</p>
        </div>
        <span class="aiops-workbench__count"
          >{{ visibleScenes.length }} 个场景</span
        >
      </header>
      <div class="aiops-goals" role="group" aria-label="场景目标筛选">
        <button
          v-for="item in storeAiGoals"
          :key="item.id"
          type="button"
          :aria-pressed="goal === item.id"
          @click="changeGoal(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <div
        ref="sceneGrid"
        class="aiops-scene-grid"
        :class="{ 'aiops-scene-grid--focused': visibleScenes.length === 1 }"
        :style="{ minHeight: sceneGridMinHeight === undefined ? undefined : `${sceneGridMinHeight}px` }"
        aria-live="polite"
      >
        <!-- Reuse the first display slot, including all/single transitions, to avoid scroll clamping during chart initialization. -->
        <article
          v-for="(scene, index) in visibleScenes"
          :key="index === 0 ? 'primary-scene' : scene.id"
          class="aiops-scene"
        >
          <div class="aiops-scene__intro">
            <div class="aiops-scene__heading">
              <span class="aiops-scene__index"
                >0{{ storeAiScenes.indexOf(scene) + 1 }}</span
              ><span>{{
                storeAiGoals.find((item) => item.id === scene.id)?.label
              }}</span
              ><span
                v-if="completedIds.includes(scene.opportunity.id)"
                class="aiops-scene__complete"
                >方案已生成</span
              >
            </div>
            <h3>{{ scene.title }}</h3>
            <p class="aiops-scene__description">{{ scene.description }}</p>
          </div>
          <div class="aiops-scene__metrics">
            <div>
              <strong
                >{{ scene.primary.value
                }}<small>{{ scene.primary.unit }}</small></strong
              ><span>{{ scene.primary.label }}</span>
            </div>
            <div>
              <b>{{ scene.secondary.value }}</b
              ><span>{{ scene.secondary.label }}</span>
            </div>
          </div>
          <div class="aiops-scene__chart">
            <StoreOperationsChart
              kind="spark"
              :factor="factor"
              :period="period"
              :metric="scene.chart.metric"
              :variant="scene.chart.variant"
              :spark-values="sceneValues(scene)"
              :spark-unit="scene.chart.unit"
              :label="scene.chart.label"
            />
          </div>
          <div class="aiops-scene__footer">
            <span>{{ scene.chart.label }}<small>固定模拟样本</small></span
            ><button
              class="aiops-text-button"
              type="button"
              :aria-label="`查看${scene.title}`"
              @click="selectScene(scene)"
            >
              {{
                completedIds.includes(scene.opportunity.id)
                  ? "查看结果"
                  : "查看分析"
              }}<YjIcon name="arrowUpRight" size="sm" />
            </button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
