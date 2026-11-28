<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EChartsType } from "echarts/core";
import { createArtifactReportEChartsTheme } from "../../../../design/theme/echarts-theme";
import { usd } from "./campaign";

const props = defineProps<{ sampling: number; commission: number }>();
const surface = ref<HTMLDivElement>();
let chart: EChartsType | undefined;
let observer: ResizeObserver | undefined;
let disposed = false;
function release() {
  observer?.disconnect(); observer = undefined;
  chart?.dispose(); chart = undefined;
}
function draw() {
  if (!chart || !surface.value) return;
  const css = getComputedStyle(surface.value);
  try {
    chart.setOption({
      animation: false, backgroundColor: "transparent",
      color: [css.getPropertyValue("--yj-color-brand-primary").trim(), css.getPropertyValue("--yj-image-aplus-backdrop").trim()],
      series: [{ type: "pie", silent: true, radius: ["76%", "94%"], center: ["50%", "50%"],
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderWidth: 2, borderColor: css.getPropertyValue("--yj-color-on-brand").trim() },
        data: [{ name: "寄样与运费", value: props.sampling }, { name: "成交佣金", value: props.commission }],
      }],
    }, { notMerge: true });
  } catch { release(); }
}
onMounted(async () => {
  try {
    const { init } = await import("../../../../components/store/store-chart-runtime");
    if (disposed || !surface.value) return;
    const css = getComputedStyle(surface.value);
    const theme = createArtifactReportEChartsTheme(name => css.getPropertyValue(name));
    chart = init(surface.value, theme, { renderer: "svg" }); draw();
    if (!chart) return;
    observer = new ResizeObserver(() => {
      try { chart?.resize(); } catch { release(); }
    });
    observer.observe(surface.value);
  } catch { release(); }
});
watch([() => props.sampling, () => props.commission], draw);
onBeforeUnmount(() => { disposed = true; release(); });
</script>

<template>
  <div class="cost-ring">
    <div ref="surface" aria-hidden="true" class="ring-surface"></div>
    <div class="ring-label"><span>合作支出</span><strong>{{ usd((sampling + commission) * 100) }}</strong></div>
  </div>
</template>

<style scoped>
.cost-ring { position: relative; width: min(100%, 108px); aspect-ratio: 1; }
.ring-surface, .ring-label { position: absolute; inset: 0; }
.ring-label { display: grid; place-content: center; text-align: center; pointer-events: none; }
.ring-label span { font-size: var(--yj-font-size-caption); }
.ring-label strong { font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); font-variant-numeric: tabular-nums; }
</style>
