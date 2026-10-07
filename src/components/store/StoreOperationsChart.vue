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
import { BarChart, LineChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  RadarComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import type { EChartsOption } from "echarts";
import { createArtifactReportEChartsTheme } from "../../design/theme/echarts-theme";

use([
  BarChart,
  LineChart,
  RadarChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  RadarComponent,
  TooltipComponent,
  SVGRenderer,
  LabelLayout,
]);

const props = withDefaults(
  defineProps<{
    kind: "spark" | "opportunities" | "sentiment" | "coverage";
    label: string;
    factor?: number;
    period?: number;
    metric?: "revenue" | "conversion" | "efficiency";
    variant?: number;
    sparkValues?: readonly number[];
    sparkUnit?: string;
  }>(),
  { factor: 1, period: 30, metric: "revenue", variant: 0 },
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

interface OperationRow {
  name: string;
  values: number[];
  effort?: number;
  revenue?: number;
}
const chartElement = ref<HTMLElement | null>(null);
const failed = ref(false);
const summaryId = useId();
const tableId = useId();
const visibleSeries = ref([true, true]);
let chart: ReturnType<typeof init> | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let frame = 0;
let epoch = 0;
let disposed = false;
const factor = computed(() =>
  Number.isFinite(props.factor) ? Math.max(0, props.factor) : 1,
);
const days = computed(() =>
  Math.max(1, Math.min(365, Math.round(props.period))),
);
const money = (value: number) => `US$ ${value.toLocaleString("zh-CN")}`;

function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((value) => (total * value) / sum);
  const values = exact.map(Math.floor);
  const remaining = total - values.reduce((a, b) => a + b, 0);
  exact
    .map((value, index) => ({ index, remainder: value - values[index]! }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining)
    .forEach(({ index }) => {
      values[index]! += 1;
    });
  return values;
}

const rows = computed<OperationRow[]>(() => {
  if (props.kind === "opportunities")
    return [
      { name: "广告否词", values: [24], effort: 1.2, revenue: 1280 },
      { name: "标题优化", values: [19], effort: 2.8, revenue: 2160 },
      { name: "主图迭代", values: [25], effort: 5.7, revenue: 1840 },
      { name: "关联推荐", values: [10], effort: 3.8, revenue: 960 },
      { name: "评价分析", values: [6], effort: 1.5, revenue: 680 },
      { name: "定价测试", values: [14], effort: 6.6, revenue: 1480 },
    ].map((row) => ({
      ...row,
      revenue: Math.round(row.revenue * factor.value),
    }));
  if (props.kind === "sentiment") {
    const names = ["包装防护", "产品品质", "使用体验", "外观设计", "物流履约"];
    const counts = distribute(
      Math.round(186 * factor.value),
      [7, 3, 13, 46, 4, 6, 38, 6, 5, 31, 4, 2, 11, 4, 6],
    );
    return names.map((name, index) => ({
      name,
      values: counts.slice(index * 3, index * 3 + 3),
    }));
  }
  if (props.kind === "coverage")
    return [
      { name: "商品内容", values: [92, 61] },
      { name: "广告投放", values: [78, 52] },
      { name: "市场洞察", values: [85, 47] },
      { name: "评价分析", values: [64, 39] },
      { name: "经营日报", values: [100, 72] },
    ];
  const supplied = props.sparkValues?.filter(Number.isFinite);
  if (supplied?.length)
    return supplied.map((value, index) => ({
      name: `第 ${Math.ceil(((index + 1) * days.value) / supplied.length)} 天`,
      values: [value],
    }));
  const count = Math.min(days.value, 14);
  const weights = Array.from(
    { length: count },
    (_, index) =>
      0.66 +
      (index / count) * 0.6 +
      Math.sin(index * 0.87 + props.variant) * 0.16 +
      Math.cos(index * 1.61) * 0.06,
  );
  const total = Math.round(
    (props.metric === "efficiency" ? 126 : props.variant === 1 ? 6280 : 42860) *
      factor.value,
  );
  const values =
    props.metric === "conversion"
      ? weights.map((_, index) =>
          Number(
            (
              2.72 +
              (index / Math.max(1, count - 1)) * 1.12 +
              Math.sin(index * 0.85) * 0.08
            ).toFixed(2),
          ),
        )
      : distribute(total, weights);
  return values.map((value, index) => ({
    name: `第 ${Math.ceil(((index + 1) * days.value) / count)} 天`,
    values: [value],
  }));
});

const sentimentNames = ["正向反馈", "中性反馈", "待改善反馈"];
const coverageNames = ["当前覆盖", "接入前基线"];
const feedbackTotal = computed(() =>
  rows.value.reduce(
    (sum, row) => sum + row.values.reduce((a, b) => a + b, 0),
    0,
  ),
);
const summary = computed(() => {
  if (props.kind === "opportunities")
    return "6 项增长机会按预估提升比例和投入时长分布。广告否词预计投入 1.2 小时、提升 24%；气泡大小表示预估价值。收益均为演示估算。";
  if (props.kind === "sentiment")
    return `${feedbackTotal.value} 条演示反馈按五个主题归类。左侧为待改善反馈，右侧为正向与中性反馈；包装防护最值得关注。`;
  if (props.kind === "coverage")
    return "AI 运营覆盖率：商品内容 92%、广告投放 78%、市场洞察 85%、评价分析 64%、经营日报 100%。虚线为接入前基线。";
  const values = rows.value.map((row) => row.values[0]!);
  if (props.sparkValues?.length)
    return `最近 ${days.value} 天${props.label}，最近一个观察点为 ${formatSparkValue(values[values.length - 1]!)}。所有数值为演示估算。`;
  if (props.metric === "conversion")
    return `最近 ${days.value} 天的演示转化率趋势，最近一个观察点为 ${values[values.length - 1]}%。`;
  const total = values.reduce((a, b) => a + b, 0);
  return `最近 ${days.value} 天${props.label}，累计${props.metric === "efficiency" ? `${total} 小时` : money(total)}。所有数值为演示估算。`;
});
const columns = computed(() => {
  if (props.kind === "opportunities")
    return ["增长机会", "预估提升", "投入时长", "预估价值（USD）"];
  if (props.kind === "sentiment")
    return [
      "反馈主题",
      "正向（条）",
      "中性（条）",
      "待改善（条）",
      "待改善占比",
    ];
  return ["运营场景", "当前覆盖率", "接入前基线"];
});

function formatSparkValue(value: number): string {
  if (props.sparkUnit)
    return props.sparkUnit === "USD" || props.sparkUnit === "$"
      ? money(value)
      : `${value}${props.sparkUnit}`;
  return props.metric === "revenue"
    ? money(value)
    : `${value}${props.metric === "efficiency" ? " 小时" : "%"}`;
}

function tableValues(row: OperationRow): string[] {
  if (props.kind === "opportunities")
    return [`${row.values[0]}%`, `${row.effort} 小时`, money(row.revenue ?? 0)];
  if (props.kind === "sentiment") {
    const total = row.values.reduce((a, b) => a + b, 0);
    return [
      ...row.values.map((value) => value.toLocaleString("zh-CN")),
      `${total ? ((row.values[2]! / total) * 100).toFixed(1) : "0.0"}%`,
    ];
  }
  return row.values.map((value) => `${value}%`);
}

function selectRow(row: OperationRow, seriesIndex?: number): void {
  const total = row.values.reduce((a, b) => a + b, 0);
  const value =
    props.kind === "sentiment" && seriesIndex === undefined
      ? total
      : row.values[seriesIndex ?? 0]!;
  emit("select", {
    name: row.name,
    value,
    formattedValue:
      props.kind === "sentiment"
        ? `${value.toLocaleString("zh-CN")} 条反馈`
        : `${value}%`,
    seriesName:
      props.kind === "sentiment"
        ? seriesIndex === undefined
          ? "主题反馈总量"
          : sentimentNames[seriesIndex]
        : props.kind === "coverage"
          ? coverageNames[seriesIndex ?? 0]
          : "预估提升",
  });
}

function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function option(): EChartsOption {
  const theme = createArtifactReportEChartsTheme(token);
  const lime = token("--yj-color-brand-primary");
  const ink = token("--yj-color-text-primary");
  const secondary = token("--yj-color-text-secondary");
  const border = token("--yj-color-border-subtle");
  const muted = token("--yj-color-border-strong");
  const card = token("--yj-color-bg-card");
  const onBrand = token("--yj-color-on-brand");
  const fontSize = Number.parseFloat(token("--yj-font-size-caption"));
  const data = rows.value;
  const base: EChartsOption = {
    animation: !motionQuery?.matches,
    animationDuration: 500,
    animationDurationUpdate: 250,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    color: [lime, ink, muted],
    textStyle: { ...theme.textStyle, fontSize },
    aria: { enabled: true, label: { description: summary.value } },
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      renderMode: "richText",
      confine: true,
      padding: [10, 12],
      textStyle: { ...theme.tooltip.textStyle, fontSize },
    },
  };
  const axis = {
    axisLabel: { color: secondary, fontSize },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: border, type: "dashed" as const } },
    nameTextStyle: { color: secondary, fontSize },
  };
  if (props.kind === "spark") {
    const bars = props.variant % 2 !== 0;
    return {
      ...base,
      grid: { top: 5, right: 2, bottom: 3, left: 2 },
      xAxis: {
        type: "category",
        data: data.map((row) => row.name),
        show: false,
        boundaryGap: bars,
      },
      yAxis: {
        type: "value",
        show: false,
        min: props.metric === "conversion" ? "dataMin" : 0,
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        formatter: (params: unknown) => {
          const item = (params as Array<{ dataIndex: number }>)[0];
          const row = data[item?.dataIndex ?? 0]!;
          const value = row.values[0]!;
          return `${row.name} · 演示趋势\n${formatSparkValue(value)}`;
        },
      },
      series: [
        bars
          ? {
              type: "bar",
              data: data.map((row, index) => ({
                value: row.values[0],
                itemStyle: { color: index >= data.length - 4 ? lime : muted },
              })),
              barMaxWidth: 14,
              barCategoryGap: "34%",
              itemStyle: { borderRadius: [3, 3, 0, 0] },
              emphasis: { itemStyle: { color: ink } },
            }
          : {
              type: "line",
              data: data.map((row) => row.values[0]!),
              smooth: 0.35,
              showSymbol: false,
              symbol: "circle",
              symbolSize: 5,
              lineStyle: { color: ink, width: 1.8 },
              itemStyle: { color: lime, borderColor: ink, borderWidth: 1 },
              areaStyle: {
                opacity: 0.45,
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: lime },
                    { offset: 1, color: card },
                  ],
                },
              },
            },
      ],
    };
  }
  if (props.kind === "opportunities")
    return {
      ...base,
      grid: { left: 4, right: 20, top: 24, bottom: 44, containLabel: true },
      xAxis: {
        ...axis,
        type: "value",
        min: 0,
        max: 8,
        interval: 2,
        name: "投入时长 · 小时",
        nameLocation: "middle",
        nameGap: 27,
      },
      yAxis: {
        ...axis,
        type: "value",
        min: 0,
        max: 30,
        interval: 10,
        axisLabel: { ...axis.axisLabel, formatter: "{value}%" },
        name: "预估提升",
        nameGap: 12,
      },
      tooltip: {
        ...base.tooltip,
        formatter: (params: unknown) => {
          const item = params as { dataIndex: number };
          const row = data[item.dataIndex]!;
          return `${row.name} · 演示预估\n潜在提升  ${row.values[0]}%\n投入时长  ${row.effort} 小时\n预估价值  ${money(row.revenue ?? 0)}\n点击查看机会详情`;
        },
      },
      series: [
        {
          type: "scatter",
          name: "增长机会",
          symbolSize: (_value, params) =>
            14 +
            Math.sqrt(
              [1280, 2160, 1840, 960, 680, 1480][params.dataIndex]! / 2160,
            ) *
              19,
          data: data.map((row, index) => ({
            name: row.name,
            value: [row.effort, row.values[0], row.revenue],
            itemStyle: {
              color: index < 2 ? lime : card,
              borderColor: ink,
              borderWidth: 1.4,
              opacity: 1,
            },
            label: {
              position:
                index === 0 || index === 2 || index === 5 ? "bottom" : "top",
            },
          })),
          label: {
            show: true,
            formatter: "{b}",
            color: ink,
            fontSize,
            distance: 8,
          },
          labelLayout: { hideOverlap: true },
          emphasis: {
            scale: 1.16,
            label: { fontWeight: "bold" },
            itemStyle: { color: lime },
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: muted, type: "dashed", width: 1 },
            label: { show: false },
            data: [{ xAxis: 4 }, { yAxis: 15 }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: lime, opacity: 0.13 },
            label: {
              show: true,
              position: "insideTopLeft",
              color: secondary,
              fontSize,
              distance: 8,
            },
            data: [
              [
                { name: "优先推进", xAxis: 0, yAxis: 30 },
                { xAxis: 4, yAxis: 15 },
              ],
            ],
          },
        },
      ],
    };
  if (props.kind === "sentiment") {
    const maximum = Math.max(
      1,
      ...data.map((row) =>
        Math.max(row.values[2]!, row.values[0]! + row.values[1]!),
      ),
    );
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maximum / 5)));
    const interval =
      [1, 2, 5, 10].find((step) => step * magnitude >= maximum / 5)! *
      magnitude;
    const negativeBound = Math.max(
      interval,
      Math.ceil(Math.max(...data.map((row) => row.values[2]!)) / interval) *
        interval,
    );
    const positiveBound = Math.max(
      interval,
      Math.ceil(
        Math.max(...data.map((row) => row.values[0]! + row.values[1]!)) /
          interval,
      ) * interval,
    );
    return {
      ...base,
      grid: { left: 0, right: 8, top: 4, bottom: 24, containLabel: true },
      xAxis: {
        ...axis,
        type: "value",
        min: -negativeBound,
        max: positiveBound,
        interval,
        axisLabel: {
          ...axis.axisLabel,
          formatter: (value: number) => Math.abs(value).toLocaleString("zh-CN"),
        },
        name: "条",
        nameGap: 4,
      },
      yAxis: {
        ...axis,
        type: "category",
        inverse: true,
        data: data.map((row) => row.name),
        splitLine: { show: false },
        axisLabel: { ...axis.axisLabel, margin: 14 },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        axisPointer: {
          type: "shadow",
          shadowStyle: { color: border, opacity: 0.45 },
        },
        formatter: (params: unknown) => {
          const index =
            (params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0;
          const row = data[index]!;
          return [
            `${row.name} · 最近 ${days.value} 天`,
            ...sentimentNames.map((name, i) => `${name}  ${row.values[i]} 条`),
            `待改善占比  ${tableValues(row)[3]}`,
          ].join("\n");
        },
      },
      series: sentimentNames.map((name, index) => ({
        name,
        type: "bar" as const,
        stack: "sentiment",
        barWidth: 17,
        data: data.map((row) =>
          index === 2 ? -row.values[index]! : row.values[index]!,
        ),
        itemStyle: {
          color: [lime, muted, ink][index],
          borderRadius:
            index === 2 ? [3, 0, 0, 3] : index === 1 ? [0, 3, 3, 0] : 0,
        },
        label: {
          show: true,
          position: "inside" as const,
          color: index === 0 ? onBrand : index === 2 ? card : ink,
          fontSize,
          formatter: (params: { value?: unknown }) =>
            Math.abs(Number(params.value)) >= maximum * 0.17
              ? `${Math.abs(Number(params.value))}`
              : "",
        },
        emphasis: { focus: "series" as const },
        markLine:
          index === 0
            ? {
                silent: true,
                symbol: "none",
                lineStyle: { color: muted, type: "solid", width: 1 },
                label: { show: false },
                data: [{ xAxis: 0 }],
              }
            : undefined,
      })),
    };
  }
  return {
    ...base,
    legend: {
      show: false,
      data: coverageNames,
      selected: Object.fromEntries(
        coverageNames.map((name, index) => [name, visibleSeries.value[index]]),
      ),
    },
    radar: {
      indicator: data.map((row) => ({
        name: `${row.name}\n${row.values[0]}%`,
        max: 100,
      })),
      center: ["50%", "49%"],
      radius: "61%",
      startAngle: 90,
      splitNumber: 4,
      shape: "polygon",
      axisName: { color: secondary, fontSize, lineHeight: 18 },
      axisNameGap: 9,
      splitLine: { lineStyle: { color: border } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: border } },
    },
    tooltip: {
      ...base.tooltip,
      formatter: (params: unknown) => {
        const item = params as { name: string; dataIndex: number };
        return [
          item.name,
          ...data.map((row) => `${row.name}  ${row.values[item.dataIndex]}%`),
        ].join("\n");
      },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 5,
        data: coverageNames.map((name, index) => ({
          name,
          value: data.map((row) => row.values[index]!),
          lineStyle: {
            color: index === 0 ? ink : muted,
            width: index === 0 ? 2 : 1.5,
            type: index === 0 ? "solid" : "dashed",
          },
          itemStyle: {
            color: index === 0 ? lime : muted,
            borderColor: index === 0 ? ink : muted,
            borderWidth: 1,
          },
          areaStyle: {
            color: index === 0 ? lime : muted,
            opacity: index === 0 ? 0.24 : 0.05,
          },
        })),
      },
    ],
  };
}

function disposeChart(): void {
  chart?.dispose();
  chart = null;
}
function render(): void {
  if (disposed || failed.value || !chartElement.value) return;
  try {
    if (!chart) {
      chart = init(
        chartElement.value,
        createArtifactReportEChartsTheme(token),
        { renderer: "svg" },
      );
      chart.on("click", (params) => {
        if (props.kind === "spark") return;
        if (props.kind === "coverage") {
          const index = params.dataIndex ?? 0;
          const value = Math.round(
            rows.value.reduce((sum, row) => sum + row.values[index]!, 0) /
              rows.value.length,
          );
          emit("select", {
            name: coverageNames[index] ?? "运营覆盖",
            value,
            formattedValue: `${value}%`,
            seriesName: "平均运营覆盖率",
          });
          return;
        }
        const row = rows.value[params.dataIndex];
        if (row)
          selectRow(
            row,
            props.kind === "sentiment" ? params.seriesIndex : undefined,
          );
      });
    }
    chart.setOption(option(), { notMerge: true });
  } catch {
    failed.value = true;
    disposeChart();
  }
}
async function rebuild(): Promise<void> {
  const current = ++epoch;
  disposeChart();
  failed.value = false;
  await nextTick();
  if (current === epoch && !disposed) render();
}
function toggleCoverage(index: number): void {
  if (
    visibleSeries.value[index] &&
    visibleSeries.value.filter(Boolean).length === 1
  )
    return;
  visibleSeries.value[index] = !visibleSeries.value[index];
  chart?.dispatchAction({
    type: "legendToggleSelect",
    name: coverageNames[index],
  });
}
watch(
  () => [
    props.kind,
    props.factor,
    props.period,
    props.metric,
    props.variant,
    props.sparkValues,
    props.sparkUnit,
    props.label,
  ],
  render,
);
onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionQuery.addEventListener("change", render);
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!disposed) chart?.resize();
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
  render();
});
onBeforeUnmount(() => {
  disposed = true;
  epoch += 1;
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  motionQuery?.removeEventListener("change", render);
  disposeChart();
});
</script>

<template>
  <div class="ops-chart" :class="`ops-chart--${kind}`" :data-chart-kind="kind">
    <p :id="summaryId" class="ops-chart__sr-only">{{ summary }}</p>
    <div
      v-if="kind === 'sentiment'"
      class="ops-chart__legend"
      aria-label="反馈情绪图例"
    >
      <span v-for="(name, index) in sentimentNames" :key="name"
        ><i :class="`ops-chart__key--${index}`" aria-hidden="true" />{{
          name
        }}</span
      >
    </div>
    <div v-if="failed" class="ops-chart__fallback" role="status">
      <span>{{
        kind === "spark"
          ? "趋势图暂不可用"
          : "图表暂不可用，下方保留完整演示数据。"
      }}</span
      ><button type="button" @click="rebuild">重新加载</button>
    </div>
    <div
      v-show="!failed"
      ref="chartElement"
      class="ops-chart__canvas"
      role="img"
      :aria-label="label"
      :aria-describedby="summaryId"
    />
    <div
      v-if="kind === 'coverage'"
      class="ops-chart__legend ops-chart__legend--center"
      aria-label="切换覆盖率对比系列"
    >
      <button
        v-for="(name, index) in coverageNames"
        :key="name"
        type="button"
        :aria-pressed="visibleSeries[index]"
        :class="{ 'is-muted': !visibleSeries[index] }"
        @click="toggleCoverage(index)"
      >
        <i :class="`ops-chart__key--${index}`" aria-hidden="true" />{{ name }}
      </button>
    </div>
    <details v-if="kind !== 'spark'" class="ops-chart__details" :open="failed">
      <summary :aria-controls="tableId">
        查看图表数据 <span aria-hidden="true">↗</span>
      </summary>
      <div
        :id="tableId"
        class="ops-chart__table"
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
              days
            }}
            天 · 演示估算
          </caption>
          <thead>
            <tr>
              <th v-for="column in columns" :key="column" scope="col">
                {{ column }}
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
              <td v-for="(value, index) in tableValues(row)" :key="index">
                {{ value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ops-chart {
  position: relative;
  min-width: 0;
  width: 100%;
  color: var(--yj-color-text-primary);
}
.ops-chart__canvas {
  width: 100%;
  height: var(--ops-chart-height, 250px);
  min-height: 180px;
}
.ops-chart--spark .ops-chart__canvas {
  height: var(--ops-chart-height, 64px);
  min-height: 0;
}
.ops-chart--opportunities .ops-chart__canvas {
  height: var(--ops-chart-height, 260px);
}
.ops-chart--coverage .ops-chart__canvas {
  height: var(--ops-chart-height, 240px);
}
.ops-chart__legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--yj-space-2) var(--yj-space-4);
  margin-bottom: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  color: var(--yj-color-text-secondary);
}
.ops-chart__legend--center {
  justify-content: center;
  margin: 0;
}
.ops-chart__legend span,
.ops-chart__legend button {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
}
.ops-chart__legend i {
  display: inline-block;
  width: var(--yj-space-3);
  height: var(--yj-space-2);
  border-radius: var(--yj-radius-xs);
  background: var(--yj-color-brand-primary);
}
.ops-chart__legend i.ops-chart__key--1 {
  background: var(--yj-color-border-strong);
}
.ops-chart__legend i.ops-chart__key--2 {
  background: var(--yj-color-text-primary);
}
.ops-chart button {
  font: inherit;
  cursor: pointer;
}
.ops-chart__legend button {
  padding: var(--yj-space-1) 0;
  border: 0;
  background: transparent;
  color: inherit;
}
.ops-chart__legend .is-muted {
  text-decoration: line-through;
}
.ops-chart__details {
  margin-top: var(--yj-space-3);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.ops-chart__details summary {
  width: fit-content;
  cursor: pointer;
  list-style: none;
  color: var(--yj-color-text-secondary);
}
.ops-chart__details summary::-webkit-details-marker {
  display: none;
}
.ops-chart__details summary span {
  display: inline-block;
  margin-left: var(--yj-space-1);
  transition: transform var(--yj-motion-fast);
}
.ops-chart__details[open] summary span {
  transform: rotate(90deg);
}
.ops-chart button:focus-visible,
.ops-chart summary:focus-visible,
.ops-chart__table:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: 3px;
  border-radius: var(--yj-radius-xs);
}
.ops-chart__table {
  margin-top: var(--yj-space-3);
  overflow: auto;
  max-height: 280px;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
}
.ops-chart table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ops-chart caption {
  padding: var(--yj-space-2) var(--yj-space-3);
  color: var(--yj-color-text-secondary);
  text-align: left;
}
.ops-chart th,
.ops-chart td {
  padding: var(--yj-space-2) var(--yj-space-3);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
  text-align: right;
}
.ops-chart th {
  font-weight: var(--yj-font-weight-semibold);
}
.ops-chart th:first-child {
  text-align: left;
}
.ops-chart th button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ops-chart__fallback {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--yj-space-2);
  padding: var(--yj-space-4) 0;
  font-size: var(--yj-font-size-caption);
  color: var(--yj-color-text-secondary);
}
.ops-chart__fallback button {
  padding: var(--yj-space-1) var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-sm);
  background: var(--yj-color-bg-card);
  color: var(--yj-color-text-primary);
}
.ops-chart__sr-only {
  position: absolute;
  inset: 0 auto auto 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .ops-chart__details summary span {
    transition: none;
  }
}
</style>
