<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { createArtifactReportEChartsTheme } from "../../design/theme/echarts-theme";
import {
  dashboardProducts,
  dashboardStats,
} from "../../domain/store-dashboard";

use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);

const props = withDefaults(
  defineProps<{
    kind:
      | "trend"
      | "categories"
      | "channels"
      | "channelConversion"
      | "productGrowth"
      | "funnel"
      | "impact"
      | "capabilities";
    factor?: number;
    period?: number;
    metric?: "sales" | "profit" | "orders";
    label: string;
  }>(),
  { factor: 1, period: 30, metric: "sales" },
);
const emit = defineEmits<{
  select: [
    selection: {
      name: string;
      value: number;
      formattedValue?: string;
      seriesName?: string;
    },
  ];
}>();

type ChartRow = {
  name: string;
  value: number;
  previous?: number;
  sales?: number;
  orders?: number;
};
const chartElement = ref<HTMLElement | null>(null);
const runtimeFailed = ref(false);
const loading = ref(true);
const selectedSeries = ref([true, true]);
const tableId = useId();
const summaryId = useId();
let chart: ReturnType<typeof init> | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let resizeFrame = 0;
let disposed = false;
let renderEpoch = 0;

const periodDays = computed(() =>
  Math.max(1, Math.min(365, Math.round(props.period))),
);
const scale = computed(() => Math.max(0, props.factor));
const stats = computed(() => dashboardStats(scale.value));
const metricName = computed(
  () =>
    ({ sales: "销售额", profit: "预估利润", orders: "订单量" })[props.metric],
);
const metricTotal = computed(() => stats.value[props.metric]);
const metricGrowth = computed(
  () => ({ sales: 18.6, profit: 12.4, orders: 15.2 })[props.metric],
);
const conversionRate = computed(() =>
  stats.value.visitors
    ? ((stats.value.orders / stats.value.visitors) * 100).toFixed(2)
    : "0.00",
);
const comparative = computed(
  () => props.kind === "trend" || props.kind === "impact",
);
const percentage = computed(() =>
  ["capabilities", "channelConversion", "productGrowth"].includes(props.kind),
);
const unit = computed(() =>
  percentage.value
    ? "%"
    : props.kind === "funnel"
      ? "次"
      : props.metric === "orders" && props.kind === "trend"
        ? "单"
        : "USD",
);
const seriesNames = computed(() =>
  props.kind === "impact"
    ? ["AI 优化后", "优化前基线"]
    : ["当前周期", "上一周期"],
);

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((result, value) => result + value, 0);
  const values = weights.map((value) => Math.round((total * value) / sum));
  values[values.length - 1]! +=
    total - values.reduce((result, value) => result + value, 0);
  return values;
}

const rows = computed<ChartRow[]>(() => {
  if (props.kind === "trend") {
    const count = Math.min(periodDays.value, 30);
    const weights = Array.from(
      { length: count },
      (_, index) =>
        0.82 +
        (index / count) * 0.48 +
        Math.sin(index * 0.82) * 0.19 +
        Math.cos(index * 1.9) * 0.065,
    );
    const current = allocate(metricTotal.value, weights);
    const previous = allocate(
      Math.round(metricTotal.value / (1 + metricGrowth.value / 100)),
      weights.map(
        (weight, index) => weight * (0.95 + Math.cos(index * 0.65) * 0.13),
      ),
    );
    return current.map((value, index) => ({
      name: `第 ${Math.ceil(((index + 1) * periodDays.value) / count)} 天`,
      value,
      previous: previous[index],
    }));
  }
  if (props.kind === "categories") {
    const totals = new Map<string, number>();
    for (const product of dashboardProducts(scale.value))
      totals.set(
        product.category,
        (totals.get(product.category) ?? 0) + product.sales,
      );
    return [...totals]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }
  if (props.kind === "channels") {
    const names = ["自然流量", "广告流量", "站外推荐"];
    const values = allocate(stats.value.sales, [58, 27, 15]);
    return names.map((name, index) => ({ name, value: values[index]! }));
  }
  if (props.kind === "channelConversion") {
    const visits = allocate(stats.value.visitors, [52, 35, 13]);
    const orders = allocate(stats.value.orders, [58, 27, 15]);
    return ["自然流量", "广告流量", "站外推荐"].map((name, index) => ({
      name,
      value: Number(
        ((orders[index]! / Math.max(1, visits[index]!)) * 100).toFixed(2),
      ),
    }));
  }
  if (props.kind === "productGrowth")
    return dashboardProducts(scale.value).map((item) => ({
      name: item.name,
      value: item.growth,
      sales: item.sales,
      orders: item.orders,
    }));
  if (props.kind === "funnel") {
    const values = [
      Math.round(1826400 * scale.value),
      stats.value.visitors,
      Math.round(25430 * scale.value),
      stats.value.orders,
    ];
    return ["商品曝光", "店铺访问", "加入购物车", "支付订单"].map(
      (name, index) => ({ name, value: values[index]! }),
    );
  }
  if (props.kind === "impact") {
    const count = Math.max(2, Math.min(6, Math.ceil(periodDays.value / 7)));
    const actual = allocate(
      stats.value.aiRevenue,
      Array.from({ length: count }, (_, index) => 1 + index * 0.19),
    );
    const previous = allocate(
      Math.round(stats.value.aiRevenue / 1.236),
      Array.from({ length: count }, (_, index) => 1 + index * 0.12),
    );
    return actual.map((value, index) => ({
      name: `第 ${index + 1} 阶段`,
      value,
      previous: previous[index],
    }));
  }
  return [
    "商品内容优化",
    "广告投放诊断",
    "市场与竞品洞察",
    "客户声音分析",
    "经营日报生成",
  ].map((name, index) => ({ name, value: [92, 78, 85, 64, 100][index]! }));
});

const summary = computed(() => {
  if (props.kind === "trend")
    return `最近 ${periodDays.value} 天${metricName.value}${formatValue(metricTotal.value)}，较上一周期增长 ${metricGrowth.value}%。`;
  if (props.kind === "channelConversion")
    return "按渠道归因的访客与支付订单计算转化率，分别查看自然、广告和站外流量的效率。";
  if (props.kind === "productGrowth")
    return "横轴为销售额，纵轴为销售额环比，圆点大小表示订单量；点击商品查看经营详情。";
  if (props.kind === "channels")
    return "自然流量贡献 58%，广告流量贡献 27%，站外推荐贡献 15%。";
  if (props.kind === "categories") {
    const top = rows.value[0];
    const share =
      top && stats.value.sales
        ? ((top.value / stats.value.sales) * 100).toFixed(1)
        : "0.0";
    return `${top?.name ?? "暂无品类"}贡献最高，占销售额 ${share}%，共展示 ${rows.value.length} 个品类。`;
  }
  if (props.kind === "funnel")
    return `从商品曝光到支付订单的转化过程，访问至支付转化率为 ${conversionRate.value}%。`;
  if (props.kind === "impact")
    return "对比同一组示例商品在各观察阶段的销售表现，AI 优化后与优化前基线均可独立显示。";
  return "易界 AI 在五个运营场景中的覆盖率，经营日报覆盖率最高，为 100%。";
});

function formatValue(value: number): string {
  if (percentage.value) return `${value}%`;
  if (unit.value === "USD") return `US$ ${value.toLocaleString("zh-CN")}`;
  return `${value.toLocaleString("zh-CN")}${unit.value}`;
}

function selectRow(row: ChartRow, seriesIndex = 0, seriesName?: string): void {
  const value = seriesIndex === 1 ? (row.previous ?? row.value) : row.value;
  emit("select", {
    name: row.name,
    value,
    formattedValue:
      props.kind === "funnel" && row.name === "支付订单"
        ? `${value.toLocaleString("zh-CN")}单`
        : formatValue(value),
    seriesName:
      seriesName ||
      (comparative.value ? seriesNames.value[seriesIndex] : props.label),
  });
}

function compactValue(value: number): string {
  return Math.abs(value) >= 10000
    ? `${(value / 10000).toFixed(1)}万`
    : value.toLocaleString("zh-CN");
}

function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function option(): EChartsOption {
  const theme = createArtifactReportEChartsTheme(token);
  const palette =
    props.kind === "channels" ||
    props.kind === "channelConversion" ||
    props.kind === "impact"
      ? [
          token("--yj-color-brand-primary"),
          token("--yj-color-text-primary"),
          token("--yj-color-border-strong"),
        ]
      : theme.color;
  const fontSize = Number.parseFloat(token("--yj-font-size-caption"));
  const fontWeight = Number.parseInt(token("--yj-font-weight-semibold"), 10);
  const secondary = token("--yj-color-text-secondary");
  const border = token("--yj-color-border-subtle");
  const data = rows.value;
  const common: EChartsOption = {
    animation: !motionQuery?.matches,
    animationDuration: 650,
    animationDurationUpdate: 350,
    animationEasing: "cubicOut",
    color: [...palette],
    textStyle: { ...theme.textStyle, fontSize },
    aria: {
      enabled: true,
      label: {
        description: `${props.label}。${summary.value}以下数据表提供全部示例数据。`,
      },
    },
    tooltip: {
      ...theme.tooltip,
      trigger: comparative.value ? "axis" : "item",
      renderMode: "richText",
      confine: true,
      borderWidth: 1,
      padding: [12, 16],
      textStyle: { ...theme.tooltip.textStyle, fontSize },
      valueFormatter: (value) => formatValue(Number(value)),
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          name: string;
          seriesName: string;
          value: number;
        }>;
        return [
          `最近 ${periodDays.value} 天 · ${items[0]?.name ?? ""}`,
          ...items.map(
            (item) =>
              `${item.seriesName || item.name}  ${formatValue(Number(item.value))}`,
          ),
        ].join("\n");
      },
    },
    grid: { left: 4, right: 12, top: 16, bottom: 8, containLabel: true },
  };
  const valueAxis = {
    type: "value" as const,
    axisLabel: { color: secondary, fontSize, formatter: compactValue },
    splitLine: { lineStyle: { color: border, type: "dashed" as const } },
    axisLine: { show: false },
    axisTick: { show: false },
    splitNumber: 4,
  };
  const categoryAxis = {
    type: "category" as const,
    data: data.map((row) => row.name),
    axisLabel: { color: secondary, fontSize },
    axisLine: { show: false },
    axisTick: { show: false },
  };

  if (comparative.value) {
    const line = props.kind === "trend";
    return {
      ...common,
      legend: {
        show: false,
        data: seriesNames.value,
        selected: Object.fromEntries(
          seriesNames.value.map((name, index) => [
            name,
            selectedSeries.value[index],
          ]),
        ),
      },
      xAxis: {
        ...categoryAxis,
        boundaryGap: !line,
        axisLabel: { ...categoryAxis.axisLabel, hideOverlap: true },
      },
      yAxis: {
        ...valueAxis,
        name: unit.value,
        nameTextStyle: { color: secondary, fontSize },
        nameGap: 12,
      },
      grid: { left: 4, right: 16, top: 30, bottom: 8, containLabel: true },
      series: seriesNames.value.map((name, index) =>
        line
          ? {
              name,
              type: "line" as const,
              data: data.map((row) =>
                index === 0 ? row.value : row.previous!,
              ),
              smooth: 0.3,
              symbol: "circle",
              symbolSize: 7,
              showSymbol: false,
              lineStyle: {
                width: index === 0 ? 3 : 2,
                type: index === 0 ? "solid" : "dashed",
                opacity: index === 0 ? 1 : 0.65,
              },
              areaStyle:
                index === 0
                  ? {
                      color: {
                        type: "linear",
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                          {
                            offset: 0,
                            color: token("--yj-color-brand-primary"),
                          },
                          { offset: 1, color: token("--yj-color-bg-card") },
                        ],
                      },
                      opacity: 0.48,
                    }
                  : undefined,
              emphasis: { focus: "series", scale: 1.5 },
              z: index === 0 ? 3 : 2,
            }
          : {
              name,
              type: "bar" as const,
              data: data.map((row) =>
                index === 0 ? row.value : row.previous!,
              ),
              barMaxWidth: 28,
              barGap: "30%",
              itemStyle: {
                borderRadius: [4, 4, 0, 0],
                opacity: index === 0 ? 1 : 0.42,
              },
              emphasis: { focus: "series" },
            },
      ),
    };
  }
  if (props.kind === "productGrowth") {
    return {
      ...common,
      grid: { left: 12, right: 28, top: 32, bottom: 26, containLabel: true },
      xAxis: {
        ...valueAxis,
        name: "销售额 · USD",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: secondary, fontSize },
        min: 0,
        max: Math.ceil(
          Math.max(...data.map((row) => row.sales ?? 0), 1) * 1.12,
        ),
      },
      yAxis: {
        ...valueAxis,
        name: "环比 · %",
        nameTextStyle: { color: secondary, fontSize },
        min: -10,
        max: 35,
        axisLabel: { color: secondary, fontSize, formatter: "{value}%" },
      },
      tooltip: {
        ...common.tooltip,
        formatter: (params: unknown) => {
          const row = data[(params as { dataIndex: number }).dataIndex]!;
          return `${row.name}\n销售额 US$ ${row.sales?.toLocaleString("en-US")}\n环比 ${row.value > 0 ? "+" : ""}${row.value}%\n订单 ${row.orders?.toLocaleString("en-US")} 单`;
        },
      },
      series: [
        {
          type: "scatter",
          name: "商品增长",
          data: data.map((row) => ({
            name: row.name,
            value: [row.sales ?? 0, row.value, row.orders ?? 0],
          })),
          symbolSize: (value: number[]) =>
            Math.max(
              12,
              Math.min(
                36,
                Math.sqrt(value[2]! / Math.max(scale.value, 0.001)) * 0.75,
              ),
            ),
          itemStyle: {
            color: token("--yj-color-brand-primary"),
            borderColor: token("--yj-color-text-primary"),
            borderWidth: 1.25,
            opacity: 0.88,
          },
          emphasis: {
            scale: 1.2,
            label: {
              show: true,
              formatter: "{b}",
              position: "top",
              color: theme.textStyle.color,
              fontSize,
              backgroundColor: token("--yj-color-bg-card"),
              padding: [4, 8],
              borderRadius: 4,
            },
          },
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: {
              color: token("--yj-color-border-strong"),
              type: "dashed",
            },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }
  if (props.kind === "channelConversion") {
    return {
      ...common,
      grid: { left: 0, right: 48, top: 4, bottom: 4, containLabel: true },
      xAxis: { ...valueAxis, min: 0, max: 5, show: false },
      yAxis: { ...categoryAxis, inverse: true },
      series: [
        {
          type: "bar",
          name: "渠道转化率",
          barWidth: 10,
          showBackground: true,
          backgroundStyle: { color: border, borderRadius: 4 },
          data: data.map((row, index) => ({
            ...row,
            itemStyle: {
              color: palette[index],
              borderRadius: 4,
              borderColor:
                index === 0
                  ? token("--yj-color-chart-series-1")
                  : palette[index],
              borderWidth: 1,
            },
          })),
          label: {
            show: true,
            position: "right",
            formatter: "{c}%",
            color: theme.textStyle.color,
            fontSize,
          },
        },
      ],
    };
  }
  if (props.kind === "channels") {
    return {
      ...common,
      title: {
        text: "58%",
        subtext: "自然流量贡献",
        left: "center",
        top: "36%",
        itemGap: 4,
        textStyle: {
          color: theme.textStyle.color,
          fontSize: Number.parseFloat(token("--yj-font-size-display")),
          fontWeight,
          fontFamily: theme.textStyle.fontFamily,
        },
        subtextStyle: { color: secondary, fontSize },
      },
      series: [
        {
          type: "pie",
          name: "渠道销售额",
          radius: ["66%", "85%"],
          center: ["50%", "48%"],
          startAngle: 90,
          padAngle: 3,
          itemStyle: {
            borderRadius: 3,
            borderWidth: 2,
            borderColor: token("--yj-color-bg-card"),
          },
          label: { show: false },
          emphasis: { scaleSize: 5, label: { show: false } },
          data,
        },
      ],
    };
  }
  if (props.kind === "funnel") {
    // Logarithmic bar lengths keep later stages legible; exact counts remain visible.
    return {
      ...common,
      grid: { left: 0, right: 64, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: "value", max: 7, show: false },
      yAxis: {
        ...categoryAxis,
        inverse: true,
        axisLabel: { ...categoryAxis.axisLabel, margin: 16 },
      },
      tooltip: {
        ...common.tooltip,
        formatter: (params: unknown) => {
          const item = params as { dataIndex: number };
          const row = data[item.dataIndex]!;
          const prior = data[item.dataIndex - 1];
          return `最近 ${periodDays.value} 天 · ${row.name}\n${formatValue(row.value)}${prior ? `\n上一步转化率 ${(prior.value ? (row.value / prior.value) * 100 : 0).toFixed(2)}%` : "\n漏斗起点"}`;
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 25,
          data: data.map((row, index) => ({
            value: Math.log10(Math.max(1, row.value)),
            actual: row.value,
            name: row.name,
            itemStyle: { color: palette[index], borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: theme.textStyle.color,
            fontSize,
            formatter: (params) => compactValue(data[params.dataIndex]!.value),
          },
          emphasis: { focus: "self" },
        },
      ],
    };
  }
  return {
    ...common,
    grid: { left: 0, right: 48, top: 4, bottom: 4, containLabel: true },
    xAxis: {
      ...valueAxis,
      max: percentage.value ? 100 : undefined,
      show: false,
    },
    yAxis: {
      ...categoryAxis,
      inverse: true,
      axisLabel: { ...categoryAxis.axisLabel, margin: 16 },
    },
    series: [
      {
        name: percentage.value ? "AI 场景覆盖率" : "品类销售额",
        type: "bar",
        barWidth: percentage.value ? 10 : 14,
        showBackground: percentage.value,
        backgroundStyle: { color: border, borderRadius: 4 },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: palette[0] },
        label: {
          show: true,
          position: "right",
          distance: 8,
          color: theme.textStyle.color,
          fontSize,
          fontWeight,
          formatter: (params) =>
            percentage.value
              ? `${params.value}%`
              : compactValue(Number(params.value)),
        },
        data,
        emphasis: { focus: "self" },
      },
    ],
  };
}

function destroyChart(): void {
  chart?.dispose();
  chart = null;
}

function failChart(): void {
  runtimeFailed.value = true;
  loading.value = false;
  destroyChart();
}

function draw(): void {
  if (disposed || !chartElement.value || runtimeFailed.value) return;
  try {
    if (!chart) {
      chart = init(
        chartElement.value,
        createArtifactReportEChartsTheme(token),
        { renderer: "svg" },
      );
      chart.on("click", (params) => {
        const row = rows.value[params.dataIndex];
        if (row) selectRow(row, params.seriesIndex, params.seriesName);
      });
    }
    chart.setOption(option(), { notMerge: true });
    loading.value = false;
  } catch {
    failChart();
  }
}

async function rebuild(): Promise<void> {
  const epoch = ++renderEpoch;
  destroyChart();
  runtimeFailed.value = false;
  await nextTick();
  if (disposed || epoch !== renderEpoch) return;
  draw();
}

function toggleSeries(index: number): void {
  if (
    selectedSeries.value[index] &&
    selectedSeries.value.filter(Boolean).length === 1
  )
    return;
  selectedSeries.value[index] = !selectedSeries.value[index];
  chart?.dispatchAction({
    type: "legendToggleSelect",
    name: seriesNames.value[index],
  });
}

watch(
  () => [props.kind, props.factor, props.period, props.metric, props.label],
  () => {
    draw();
  },
);

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionQuery.addEventListener("change", draw);
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return;
      try {
        chart?.resize();
      } catch {
        failChart();
      }
    });
  });
  if (chartElement.value) resizeObserver.observe(chartElement.value);
  themeObserver = new MutationObserver(() => {
    void rebuild();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  draw();
});

onBeforeUnmount(() => {
  disposed = true;
  renderEpoch += 1;
  cancelAnimationFrame(resizeFrame);
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  motionQuery?.removeEventListener("change", draw);
  destroyChart();
});
</script>

<template>
  <div
    class="store-chart"
    :class="`store-chart--${kind}`"
    :aria-busy="loading"
    :data-chart-kind="kind"
  >
    <p :id="summaryId" class="store-chart__sr-only">
      {{ summary }} 所有数值均为演示数据。
    </p>
    <div
      v-if="comparative"
      class="store-chart__legend"
      aria-label="选择显示的数据系列"
    >
      <button
        v-for="(name, index) in seriesNames"
        :key="name"
        type="button"
        :aria-pressed="selectedSeries[index]"
        :aria-label="`${name}，${selectedSeries[index] ? '已显示' : '已隐藏'}`"
        :class="{ 'is-muted': !selectedSeries[index] }"
        @click="toggleSeries(index)"
      >
        <span
          class="store-chart__swatch"
          :class="`store-chart__swatch--${index + 1}`"
          aria-hidden="true"
        />
        {{ name }}
      </button>
    </div>
    <div v-if="runtimeFailed" class="store-chart__fallback" role="status">
      <span>图表暂时无法显示，完整数据仍可在下方查看。</span>
      <button type="button" @click="rebuild">重新加载图表</button>
    </div>
    <div
      v-show="!runtimeFailed"
      ref="chartElement"
      class="store-chart__canvas"
      role="img"
      :aria-label="label"
      :aria-describedby="summaryId"
    />
    <div
      v-if="kind === 'channels'"
      class="store-chart__channel-legend"
      aria-label="渠道销售额占比"
    >
      <button
        v-for="(row, index) in rows"
        :key="row.name"
        type="button"
        @click="selectRow(row)"
      >
        <span
          class="store-chart__swatch"
          :class="`store-chart__swatch--${index + 1}`"
          aria-hidden="true"
        />
        <span>{{ row.name }}</span
        ><strong>{{ [58, 27, 15][index] }}%</strong>
      </button>
    </div>
    <p v-if="kind === 'funnel'" class="store-chart__note">
      条形采用对数刻度 · 访问至支付转化率 {{ conversionRate }}%
    </p>
    <details class="store-chart__details" :open="runtimeFailed">
      <summary :aria-controls="tableId">
        查看图表数据 <span aria-hidden="true">↗</span>
      </summary>
      <div
        :id="tableId"
        class="store-chart__table"
        tabindex="0"
        :aria-label="`${label}完整演示数据，可横向滚动`"
      >
        <table>
          <caption>
            {{
              label
            }}
            · 最近
            {{
              periodDays
            }}
            天 · 演示数据
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ comparative ? "观察阶段" : "项目" }}</th>
              <th scope="col">
                {{
                  comparative
                    ? seriesNames[0]
                    : kind === "productGrowth"
                      ? "销售额环比"
                      : "数值"
                }}（{{ unit }}）
              </th>
              <th v-if="kind === 'productGrowth'" scope="col">销售额（USD）</th>
              <th v-if="kind === 'productGrowth'" scope="col">订单量（单）</th>
              <th v-if="comparative" scope="col">
                {{ seriesNames[1] }}（{{ unit }}）
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.name">
              <th scope="row">
                <button type="button" @click="selectRow(row)">
                  {{ row.name }}
                </button>
              </th>
              <td>{{ row.value.toLocaleString("zh-CN") }}</td>
              <td v-if="kind === 'productGrowth'">
                {{ row.sales?.toLocaleString("en-US") }}
              </td>
              <td v-if="kind === 'productGrowth'">
                {{ row.orders?.toLocaleString("en-US") }}
              </td>
              <td v-if="comparative">
                {{ row.previous?.toLocaleString("zh-CN") }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<style scoped>
.store-chart {
  position: relative;
  min-width: 0;
  width: 100%;
  color: var(--yj-color-text-primary);
}
.store-chart__canvas {
  width: 100%;
  height: var(--store-chart-height, 220px);
  min-height: 180px;
}
.store-chart--trend .store-chart__canvas,
.store-chart--impact .store-chart__canvas {
  height: var(--store-chart-height, 260px);
}
.store-chart--channels .store-chart__canvas {
  height: var(--store-chart-height, 190px);
}
.store-chart__legend {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--yj-space-4);
  margin-bottom: var(--yj-space-2);
}
.store-chart button {
  font: inherit;
  cursor: pointer;
}
.store-chart__legend button,
.store-chart__channel-legend button {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) 0;
  border: 0;
  background: transparent;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.store-chart__legend .is-muted {
  text-decoration: line-through;
}
.store-chart__legend .is-muted .store-chart__swatch {
  opacity: 0.35;
}
.store-chart__swatch {
  width: var(--yj-space-3);
  height: var(--yj-space-2);
  flex: 0 0 auto;
  border-radius: var(--yj-radius-xs);
  background: var(--yj-color-chart-series-1);
}
.store-chart__swatch--2 {
  background: var(--yj-color-chart-series-2);
}
.store-chart__swatch--3 {
  background: var(--yj-color-chart-series-3);
}
.store-chart--trend .store-chart__swatch--2 {
  height: 0;
  border-top: 2px dashed var(--yj-color-chart-series-2);
  border-radius: 0;
  background: transparent;
}
.store-chart__channel-legend {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--yj-space-1) var(--yj-space-4);
  margin-top: var(--yj-space-1);
}
.store-chart--impact .store-chart__swatch--1,
.store-chart--channels .store-chart__swatch--1 {
  background: var(--yj-color-brand-primary);
  border: 1px solid var(--yj-color-chart-series-1);
}
.store-chart--impact .store-chart__swatch--2,
.store-chart--channels .store-chart__swatch--2 {
  background: var(--yj-color-text-primary);
}
.store-chart--channels .store-chart__swatch--3 {
  background: var(--yj-color-border-strong);
}
.store-chart--channelConversion .store-chart__canvas {
  min-height: 120px;
}
.store-chart__channel-legend strong {
  color: var(--yj-color-text-primary);
  font-weight: var(--yj-font-weight-semibold);
}
.store-chart__note {
  margin: var(--yj-space-2) 0 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.store-chart__details {
  margin-top: var(--yj-space-3);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.store-chart__details summary {
  width: fit-content;
  cursor: pointer;
  color: var(--yj-color-text-secondary);
  list-style: none;
}
.store-chart__details summary::-webkit-details-marker {
  display: none;
}
.store-chart__details summary span {
  display: inline-block;
  margin-left: var(--yj-space-1);
  transition: transform var(--yj-motion-fast);
}
.store-chart__details[open] summary span {
  transform: rotate(90deg);
}
.store-chart__details[open] summary {
  color: var(--yj-color-text-primary);
}
.store-chart button:focus-visible,
.store-chart summary:focus-visible,
.store-chart__table:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: 3px;
  border-radius: var(--yj-radius-xs);
}
.store-chart__table {
  margin-top: var(--yj-space-3);
  overflow: auto;
  max-height: 280px;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
}
.store-chart table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.store-chart caption {
  padding: var(--yj-space-2) var(--yj-space-3);
  text-align: left;
  color: var(--yj-color-text-secondary);
}
.store-chart th,
.store-chart td {
  padding: var(--yj-space-2) var(--yj-space-3);
  text-align: right;
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.store-chart th:first-child {
  text-align: left;
}
.store-chart th {
  font-weight: var(--yj-font-weight-semibold);
}
.store-chart th button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.store-chart__fallback {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--yj-space-3);
  min-height: 180px;
  font-size: var(--yj-font-size-body);
  color: var(--yj-color-text-body);
}
.store-chart__fallback button {
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}
.store-chart__sr-only {
  position: absolute;
  inset: 0 auto auto 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .store-chart__details summary span {
    transition: none;
  }
}
</style>
