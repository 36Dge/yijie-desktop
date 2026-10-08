<script setup lang="ts">
import { computed, ref } from "vue";
import { NDrawer, NDrawerContent, NModal } from "naive-ui";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjTabs from "../../components/yijie/YjTabs.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import StoreAiOperations from "../../components/store/StoreAiOperations.vue";
import StoreDashboardCard from "../../components/store/StoreDashboardCard.vue";
import StoreDashboardChart from "../../components/store/StoreDashboardChart.vue";
import { useStoreDashboard } from "../../composables/useStoreDashboard";
import {
  dashboardTabs,
  dashboardShops,
  getProductOpportunity,
  getOpportunityResult,
  money,
  dashboardCsv,
  dashboardProducts,
  type StoreDashboardState,
} from "../../domain/store-dashboard";
import "../../styles/store-dashboard.css";

const {
  tab,
  shop,
  period,
  metric,
  state,
  query,
  sort,
  page,
  factor,
  stats,
  products,
  pageCount,
  visibleProducts,
  selectedProduct,
  opportunity,
  execution,
  executionStep,
  completedIds,
  toast,
  refresh,
  setState,
  notify,
  openOpportunity,
  runOpportunity,
  closeOpportunity,
} = useStoreDashboard();
const reportOpen = ref(false);
const generatedResult = computed(() =>
  opportunity.value ? getOpportunityResult(opportunity.value) : undefined,
);
const detail = ref<{
  title: string;
  value: string;
  description: string;
} | null>(null);
const shopLabel = computed(
  () =>
    dashboardShops.find((item) => item.id === shop.value)?.label ?? "全部店铺",
);
const metricLabel = computed(() =>
  metric.value === "profit"
    ? "预估利润"
    : metric.value === "orders"
      ? "订单量"
      : "销售额",
);
const metricValue = computed(() =>
  metric.value === "orders"
    ? money(stats.value.orders)
    : `$${money(metric.value === "profit" ? stats.value.profit : stats.value.sales)}`,
);
const highestProductSales = computed(() =>
  Math.max(1, ...products.value.map((product) => product.sales)),
);
function exportData() {
  const url = URL.createObjectURL(
    new Blob([dashboardCsv(products.value)], {
      type: "text/csv;charset=utf-8;",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `易界-商品表现-演示-${period.value}天.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`已导出 ${products.value.length} 条演示商品数据`);
}
function chartDetail(event: {
  name: string;
  value: number;
  formattedValue?: string;
  seriesName?: string;
}) {
  detail.value = {
    title: [event.name, event.seriesName].filter(Boolean).join(" · "),
    value: event.formattedValue ?? money(event.value),
    description: `${shopLabel.value} · 最近 ${period.value} 天的模拟分析数据。可通过图表下方「查看数据」展开完整数据，支持键盘浏览。`,
  };
}
function productChartDetail(event: { name: string; value: number }) {
  selectedProduct.value =
    dashboardProducts(factor.value).find((item) => item.name === event.name) ??
    null;
}
function changeState(event: Event) {
  setState((event.target as HTMLSelectElement).value as StoreDashboardState);
}
</script>

<template>
  <YjPage class="store-dashboard">
    <YjPageHeader title="我的店铺">
      <template #description>看清经营全貌，让每一步增长都有方向。</template>
      <template #actions>
        <button class="sd-button" @click="reportOpen = true">
          <YjIcon name="file" size="sm" />经营简报
        </button>
      </template>
    </YjPageHeader>

    <div class="sd-toolbar">
      <YjTabs
        class="sd-main-tabs"
        :items="dashboardTabs"
        :model-value="tab"
        aria-label="店铺分析视图"
        panel-id="store-dashboard-panel"
        @update:model-value="tab = $event === 'ai' ? 'ai' : 'overview'"
      />
      <div class="sd-filters">
        <label class="sd-select-wrap"
          ><YjIcon name="store" size="sm" /><select
            v-model="shop"
            aria-label="选择店铺"
          >
            <option
              v-for="item in dashboardShops"
              :key="item.id"
              :value="item.id"
            >
              {{ item.label }}
            </option></select
          ><YjIcon name="chevronDown" size="xs"
        /></label>
        <label class="sd-select-wrap"
          ><YjIcon name="scheduledTask" size="sm" /><select
            v-model.number="period"
            aria-label="时间范围"
          >
            <option :value="7">最近 7 天</option>
            <option :value="30">最近 30 天</option>
            <option :value="90">最近 90 天</option></select
          ><YjIcon name="chevronDown" size="xs"
        /></label>
        <button
          class="sd-icon-button"
          aria-label="刷新演示数据"
          :disabled="state === 'loading'"
          @click="refresh"
        >
          <YjIcon
            name="refresh"
            size="sm"
            :class="{ 'sd-spin': state === 'loading' }"
          />
        </button>
      </div>
    </div>
    <div
      id="store-dashboard-panel"
      role="tabpanel"
      :aria-labelledby="`store-dashboard-panel-tab-${tab}`"
      :aria-busy="state === 'loading'"
    >
      <div v-if="state === 'loading'" class="sd-loading" role="status">
        <span class="sd-sr-only">正在更新演示数据</span>
        <div v-for="i in 6" :key="i" class="sd-skeleton">
          <div />
          <div />
          <div />
        </div>
      </div>
      <section
        v-else-if="state !== 'ready'"
        class="sd-state"
        aria-live="polite"
      >
        <span class="sd-state-icon"
          ><YjIcon
            :name="
              state === 'error'
                ? 'warning'
                : state === 'denied'
                  ? 'shield'
                  : 'store'
            "
            size="xl"
        /></span>
        <h2>
          {{
            state === "error"
              ? "数据暂时未能加载"
              : state === "denied"
                ? "当前店铺暂不可查看"
                : "这个时段还没有经营数据"
          }}
        </h2>
        <p>
          {{
            state === "error"
              ? "可以重新加载，继续查看店铺经营表现。"
              : state === "denied"
                ? "切换可查看的店铺，或恢复演示数据。"
                : "换一个时间范围，发现更多经营趋势。"
          }}
        </p>
        <button class="sd-button sd-button--primary" @click="refresh">
          {{ state === "error" ? "重新加载" : "恢复演示数据" }}
        </button>
      </section>
      <template v-else-if="tab === 'overview'">
        <div class="sd-overview-grid sd-enter">
          <div class="sd-summary-stack">
            <section class="sd-hero">
              <div class="sd-hero__top">
                <span>总销售额</span><YjIcon name="skillResearch" size="lg" />
              </div>
              <p class="sd-hero__value">
                <span>$</span>{{ money(stats.sales) }}
              </p>
              <p class="sd-hero__comparison"><span>↗ 18.6%</span>较上一周期</p>
              <div class="sd-hero__spark" aria-hidden="true">
                <i
                  v-for="(height, i) in [
                    32, 45, 38, 55, 42, 65, 58, 72, 62, 84, 76, 94, 88, 100,
                  ]"
                  :key="i"
                  :style="{ height: `${height}%` }"
                />
              </div>
              <button
                class="sd-hero__link"
                @click="
                  detail = {
                    title: '销售目标达成',
                    value: '91.6%',
                    description: `本期销售额 $${money(stats.sales)}，目标 $${money(stats.goal)}，距离目标还差 $${money(stats.goal - stats.sales)}。统计口径为支付成功订单金额，不含取消订单；以上均为演示数据。`,
                  }
                "
              >
                <span>目标达成 <strong>91.6%</strong></span
                ><YjIcon name="arrowUpRight" size="sm" />
              </button>
            </section>
            <button class="sd-mini-metric" @click="metric = 'profit'">
              <span class="sd-metric-icon"
                ><YjIcon name="skillInstallmentPayments" size="lg" /></span
              ><span
                ><span class="sd-muted">预估利润</span
                ><strong>${{ money(stats.profit) }}</strong></span
              ><span class="sd-positive">↗ 12.4%</span>
            </button>
            <button class="sd-mini-metric" @click="metric = 'orders'">
              <span class="sd-metric-icon"
                ><YjIcon name="shoppingBag" size="lg" /></span
              ><span
                ><span class="sd-muted">订单量</span
                ><strong
                  >{{ money(stats.orders) }}<small>单</small></strong
                ></span
              ><span class="sd-positive">↗ 15.2%</span>
            </button>
          </div>

          <StoreDashboardCard
            class="sd-trend-card"
            title="经营趋势"
            subtitle="持续向上的生意，从每一个变化开始"
          >
            <template #action
              ><div class="sd-segment" aria-label="趋势指标">
                <button
                  v-for="item in [
                    { key: 'sales', label: '销售额' },
                    { key: 'profit', label: '利润' },
                    { key: 'orders', label: '订单' },
                  ]"
                  :key="item.key"
                  :aria-pressed="metric === item.key"
                  @click="metric = item.key as typeof metric"
                >
                  {{ item.label }}
                </button>
              </div></template
            >
            <div class="sd-trend-stat">
              <strong>{{ metricValue }}</strong
              ><span class="sd-positive"
                >↗
                {{
                  metric === "sales"
                    ? "18.6"
                    : metric === "profit"
                      ? "12.4"
                      : "15.2"
                }}%</span
              ><span class="sd-muted">{{ metricLabel }} · 环比</span>
            </div>
            <StoreDashboardChart
              kind="trend"
              :factor="factor"
              :period="period"
              :metric="metric"
              label="经营趋势"
              @select="chartDetail"
            />
            <template #footer
              ><span
                >增长主要来自<strong>自然搜索流量</strong>，占本期销售额的
                58%。</span
              ></template
            >
          </StoreDashboardCard>

          <div class="sd-right-stack">
            <StoreDashboardCard title="经营关键指标" class="sd-key-card">
              <div class="sd-key-grid">
                <div>
                  <span>访客数</span><strong>{{ money(stats.visitors) }}</strong
                  ><small class="sd-positive">↗ 11.8%</small>
                </div>
                <div>
                  <span>转化率</span
                  ><strong
                    >{{ ((stats.orders / stats.visitors) * 100).toFixed(2)
                    }}<small>%</small></strong
                  ><small class="sd-positive">↗ 0.11 pp</small>
                </div>
                <div>
                  <span>客单价</span
                  ><strong
                    >${{ (stats.sales / stats.orders).toFixed(2) }}</strong
                  ><small class="sd-positive">↗ 2.9%</small>
                </div>
                <div>
                  <span>广告 ACOS</span><strong>23.6<small>%</small></strong
                  ><small class="sd-positive">↘ 3.2 pp</small>
                </div>
              </div>
            </StoreDashboardCard>
            <section class="sd-ai-note">
              <div class="sd-ai-note__title">
                <h2>易界 AI 洞察</h2>
                <span class="sd-tiny-tag">3 个机会</span>
              </div>
              <p>
                销售势头不错。将低效广告预算转向高转化词，有望进一步提升利润。
              </p>
              <button class="sd-text-button" @click="tab = 'ai'">
                查看增长机会 <YjIcon name="arrowRight" size="sm" />
              </button>
            </section>
          </div>

          <StoreDashboardCard
            class="sd-category-card"
            title="品类销售贡献"
            subtitle="找到业务的增长支点"
            ><StoreDashboardChart
              kind="categories"
              :factor="factor"
              :period="period"
              label="品类销售贡献"
              @select="chartDetail"
          /></StoreDashboardCard>
          <StoreDashboardCard
            class="sd-efficiency-card"
            title="经营效率"
            subtitle="让每一分投入，都产生更好的回报"
          >
            <div class="sd-efficiencies">
              <div
                v-for="item in [
                  {
                    label: '利润率',
                    value: '28.3%',
                    progress: 94.3,
                    note: '目标 30%',
                    tag: '稳步提升',
                    tone: 'green',
                  },
                  {
                    label: '广告投入产出 ROAS',
                    value: '4.24',
                    progress: 100,
                    note: '目标 4.0',
                    tag: '优于目标',
                    tone: 'blue',
                  },
                  {
                    label: '退款率',
                    value: '2.18%',
                    progress: 72.7,
                    note: '控制线 3%',
                    tag: '健康范围',
                    tone: 'purple',
                  },
                ]"
                :key="item.label"
                class="sd-efficiency"
              >
                <div>
                  <span>{{ item.label }}</span
                  ><strong>{{ item.value }}</strong>
                </div>
                <div class="sd-progress" :class="`sd-progress--${item.tone}`">
                  <i :style="{ width: `${item.progress}%` }" />
                </div>
                <p>
                  <span>{{ item.note }}</span
                  ><span>{{ item.tag }}</span>
                </p>
              </div>
            </div>
          </StoreDashboardCard>
          <StoreDashboardCard
            class="sd-funnel-card"
            title="流量转化漏斗"
            subtitle="从被看见，到被选择"
            ><StoreDashboardChart
              kind="funnel"
              :factor="factor"
              :period="period"
              label="流量转化漏斗"
              @select="chartDetail"
          /></StoreDashboardCard>
          <StoreDashboardCard
            class="sd-channel-card"
            title="销售来源"
            subtitle="健康、多元的增长结构"
            ><StoreDashboardChart
              kind="channels"
              :factor="factor"
              :period="period"
              label="销售来源"
              @select="chartDetail"
            />
            <div class="sd-channel-conversion">
              <div class="sd-chart-subheading">
                <h3>渠道转化效率</h3>
                <span>访问 → 下单</span>
              </div>
              <StoreDashboardChart
                kind="channelConversion"
                :factor="factor"
                :period="period"
                label="渠道转化效率"
                @select="chartDetail"
              />
            </div>
            <div class="sd-channel-insight">
              <p class="sd-eyebrow">下一步关注</p>
              <h3>让广告流量带来更多成交</h3>
              <p>
                将高意向搜索词与泛词分开评估，优先改善广告访问到下单的转化。
              </p>
              <button class="sd-text-button" @click="tab = 'ai'">
                查看运营机会 <YjIcon name="arrowRight" size="sm" />
              </button>
            </div>
          </StoreDashboardCard>
          <StoreDashboardCard
            class="sd-products-card"
            title="商品表现"
            subtitle="关注增长，也关注下一个潜力商品"
          >
            <template #action
              ><button class="sd-text-button" @click="exportData">
                <YjIcon name="download" size="sm" />导出
              </button></template
            >
            <div class="sd-product-landscape">
              <div class="sd-chart-subheading">
                <h3>商品增长分布</h3>
                <span>全部 8 个商品 · 点击数据点查看详情</span>
              </div>
              <StoreDashboardChart
                kind="productGrowth"
                :factor="factor"
                :period="period"
                label="商品增长分布"
                @select="productChartDetail"
              />
            </div>
            <div class="sd-table-tools">
              <label class="sd-search"
                ><YjIcon name="search" size="sm" /><input
                  v-model="query"
                  aria-label="搜索商品"
                  placeholder="搜索商品名称 / SKU" /><button
                  v-if="query"
                  class="sd-icon-button"
                  aria-label="清空搜索"
                  @click="query = ''"
                >
                  <YjIcon name="dismiss" size="xs" /></button></label
              ><select v-model="sort" class="sd-sort" aria-label="商品排序">
                <option value="sales">销售额 ↓</option>
                <option value="growth">增长率 ↓</option>
                <option value="score">AI 评分 ↓</option>
              </select>
            </div>
            <div class="sd-table-scroll">
              <table class="sd-product-table">
                <thead>
                  <tr>
                    <th scope="col">商品</th>
                    <th scope="col">销售额</th>
                    <th scope="col">环比</th>
                    <th scope="col">转化率</th>
                    <th scope="col">AI 建议</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(product, index) in visibleProducts"
                    :key="product.id"
                  >
                    <td>
                      <button
                        class="sd-product-name"
                        @click="selectedProduct = product"
                      >
                        <span class="sd-product-rank" aria-hidden="true">{{
                          String((page - 1) * 5 + index + 1).padStart(2, "0")
                        }}</span
                        ><span
                          ><strong>{{ product.name }}</strong
                          ><small>{{ product.id }}</small></span
                        >
                      </button>
                    </td>
                    <td class="sd-number">
                      ${{ money(product.sales) }}
                      <span class="sd-sales-bar" aria-hidden="true"><i
                        :style="{ width: `${product.sales / highestProductSales * 100}%` }"
                      /></span>
                    </td>
                    <td
                      :class="
                        product.growth > 0 ? 'sd-positive' : 'sd-negative'
                      "
                    >
                      {{ product.growth > 0 ? "↗ +" : "↘ "
                      }}{{ product.growth }}%
                    </td>
                    <td>{{ product.conversion.toFixed(2) }}%</td>
                    <td>
                      <button
                        class="sd-product-action"
                        @click="openOpportunity(getProductOpportunity(product))"
                      >
                        {{ product.opportunity
                        }}<YjIcon name="chevronRight" size="xs" />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!visibleProducts.length">
                    <td colspan="5" class="sd-table-empty">
                      没有找到「{{ query }}」相关商品。<button
                        class="sd-text-button"
                        @click="query = ''"
                      >
                        清空筛选
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="sd-pagination">
              <span
                >共 {{ products.length }} 个商品<span v-if="products.length">
                  · {{ (page - 1) * 5 + 1 }}–{{
                    Math.min(page * 5, products.length)
                  }}</span
                ></span
              >
              <div>
                <button
                  class="sd-icon-button"
                  aria-label="上一页商品"
                  :disabled="page <= 1"
                  @click="page--"
                >
                  <YjIcon
                    class="sd-flip"
                    name="chevronRight"
                    size="sm"
                  /></button
                ><span class="sd-page-count"><b>{{ page }}</b> / {{ pageCount }}</span
                ><button
                  class="sd-icon-button"
                  aria-label="下一页商品"
                  :disabled="page >= pageCount"
                  @click="page++"
                >
                  <YjIcon name="chevronRight" size="sm" />
                </button>
              </div>
            </div>
          </StoreDashboardCard>
        </div>
      </template>
      <StoreAiOperations
        v-else
        :factor="factor"
        :period="period"
        :stats="stats"
        :completed-ids="completedIds"
        :shop="shop"
        @opportunity="openOpportunity"
        @report="reportOpen = true"
        @inspect="chartDetail"
      />
    </div>
    <footer class="sd-page-footer">
      <span
        ><YjIcon
          name="shield"
          size="xs"
        />所有数据均为演示，不代表真实店铺表现</span
      >
      <details class="sd-demo-options" hidden>
        <summary>演示设置</summary>
        <label
          >页面状态<select
            :value="state"
            aria-label="演示页面状态"
            @change="changeState"
          >
            <option value="ready">正常展示</option>
            <option value="loading">加载中</option>
            <option value="empty">暂无数据</option>
            <option value="error">加载失败</option>
            <option value="denied">无查看权限</option>
          </select></label
        >
      </details>
    </footer>
    <Transition name="sd-toast"
      ><div v-if="toast" class="sd-notification" role="status">
        <YjIcon name="check" size="sm" />{{ toast }}
      </div></Transition
    >
  </YjPage>

  <NDrawer
    :show="!!opportunity"
    :width="520"
    :mask-closable="execution !== 'running'"
    :close-on-esc="execution !== 'running'"
    @update:show="
      (value) => {
        if (!value) closeOpportunity();
      }
    "
    ><NDrawerContent
      v-if="opportunity"
      :title="opportunity.category"
      :closable="execution !== 'running'"
      class="store-dashboard-dialog"
      ><div class="sd-drawer-intro">
        <h2>{{ opportunity.title }}</h2>
        <p>{{ opportunity.description }}</p>
        <strong class="sd-positive">{{ opportunity.impact }}</strong>
      </div>
      <h3>为什么值得做</h3>
      <ul class="sd-evidence">
        <li v-for="(evidence, i) in opportunity.evidence" :key="evidence">
          <span>0{{ i + 1 }}</span
          >{{ evidence }}
        </li>
      </ul>
      <h3>易界将为你完成</h3>
      <ol class="sd-execution" aria-live="polite">
        <li
          v-for="(step, index) in opportunity.steps"
          :key="step"
          :class="{
            'is-complete': executionStep > index,
            'is-running': execution === 'running' && executionStep === index,
          }"
        >
          <span
            ><YjIcon
              v-if="executionStep > index"
              name="check"
              size="sm"
            /><YjIcon
              v-else-if="execution === 'running' && executionStep === index"
              name="loading"
              class="sd-spin"
              size="sm"
            /><template v-else>{{ index + 1 }}</template></span
          >
          <div>
            {{ step
            }}<small>{{
              executionStep > index
                ? "已完成"
                : execution === "running" && executionStep === index
                  ? "正在处理…"
                  : "待生成"
            }}</small>
          </div>
        </li>
      </ol>
      <section v-if="execution === 'done'" class="sd-result" role="status">
        <YjIcon name="check" size="xl" />
        <h3>方案已就绪</h3>
        <p>{{ opportunity.result }}</p>
        <p>以下为可供复核的模拟方案，未执行任何店铺修改。</p>
      </section>
      <section v-if="execution === 'done'" class="sd-generated-plan">
        <h3>{{ generatedResult?.title }}</h3>
        <div v-for="section in generatedResult?.sections" :key="section.label">
          <h4>{{ section.label }}</h4>
          <p>{{ section.content }}</p>
        </div>
      </section>
      <p class="sd-muted sd-dialog-note">
        本次仅模拟分析与方案生成，不会修改商品、广告或店铺设置。
      </p>
      <template #footer
        ><button
          class="sd-button"
          :disabled="execution === 'running'"
          @click="closeOpportunity"
        >
          关闭</button
        ><button
          v-if="execution !== 'done'"
          class="sd-button sd-button--primary"
          :disabled="execution === 'running'"
          @click="runOpportunity"
        >
          <YjIcon
            :name="execution === 'running' ? 'loading' : 'arrowRight'"
            size="sm"
            :class="{ 'sd-spin': execution === 'running' }"
          />{{
            execution === "running"
              ? `正在生成 ${executionStep + 1}/3`
              : "模拟生成方案"
          }}</button
        ><button
          v-else
          class="sd-button sd-button--primary"
          @click="closeOpportunity"
        >
          完成
        </button></template
      ></NDrawerContent
    ></NDrawer
  >

  <NDrawer :show="reportOpen" :width="520" @update:show="reportOpen = $event"
    ><NDrawerContent title="经营简报" closable class="store-dashboard-dialog"
      ><header class="sd-report-intro">
        <h2>增长稳健，利润还有提升空间。</h2>
        <p class="sd-muted">{{ shopLabel }} · 最近 {{ period }} 天</p>
      </header>
      <div class="sd-report-metrics">
        <div>
          <span>销售额</span><strong>${{ money(stats.sales) }}</strong>
        </div>
        <div>
          <span>预估利润</span><strong>${{ money(stats.profit) }}</strong>
        </div>
      </div>
      <h3>本期值得关注</h3>
      <ul class="sd-report-list">
        <li>
          <strong>自然流量正在成为增长主力</strong>
          <p>贡献 58% 销售额，建议持续完善高潜商品的搜索词与内容。</p>
        </li>
        <li>
          <strong>广告效率仍有优化空间</strong>
          <p>
            ACOS 为 23.6%，12
            个低效词值得关注。合理分配预算，优先保证高转化词曝光。
          </p>
        </li>
        <li>
          <strong>重视用户的包装反馈</strong>
          <p>
            近期评价中包装防护是集中反馈点。产品改善与页面说明可以协同推进。
          </p>
        </li>
      </ul>
      <p class="sd-dialog-note sd-muted">
        以上结论基于固定模拟样本，所有收益为演示估算。
      </p>
      <template #footer
        ><button class="sd-button" @click="reportOpen = false">关闭</button
        ><button
          class="sd-button sd-button--primary"
          @click="
            reportOpen = false;
            tab = 'ai';
          "
        >
          前往 AI 运营<YjIcon
            name="arrowRight"
            size="sm"
          /></button></template></NDrawerContent
  ></NDrawer>

  <NModal
    :show="!!selectedProduct"
    preset="card"
    title="商品经营详情"
    class="store-dashboard-dialog sd-modal"
    @update:show="
      (value) => {
        if (!value) selectedProduct = null;
      }
    "
    ><template v-if="selectedProduct"
      ><p class="sd-eyebrow">
        {{ selectedProduct.id }} · {{ selectedProduct.category }}
      </p>
      <h2>{{ selectedProduct.name }}</h2>
      <div class="sd-report-metrics">
        <div>
          <span>销售额</span
          ><strong>${{ money(selectedProduct.sales) }}</strong>
        </div>
        <div>
          <span>订单量</span
          ><strong>{{ money(selectedProduct.orders) }}</strong>
        </div>
        <div>
          <span>转化率</span><strong>{{ selectedProduct.conversion }}%</strong>
        </div>
        <div>
          <span>AI 内容评分</span
          ><strong>{{ selectedProduct.score }}<small> / 100</small></strong>
        </div>
      </div>
      <p class="sd-muted">
        优化方向：{{
          selectedProduct.opportunity
        }}。结合核心卖点、搜索词与近期评价，进一步提升商品表现。
      </p>
      <button
        class="sd-button sd-button--primary"
        @click="
          openOpportunity(getProductOpportunity(selectedProduct));
          selectedProduct = null;
        "
      >
        查看优化建议
      </button></template
    ></NModal
  >
  <NModal
    :show="!!detail"
    preset="card"
    :title="detail?.title"
    class="store-dashboard-dialog sd-modal"
    @update:show="
      (value) => {
        if (!value) detail = null;
      }
    "
    ><template v-if="detail"
      ><p class="sd-detail-value">{{ detail.value }}</p>
      <p class="sd-muted">{{ detail.description }}</p>
      <button class="sd-button" @click="detail = null">知道了</button></template
    ></NModal
  >
</template>
