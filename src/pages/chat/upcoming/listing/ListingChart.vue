<script setup lang="ts">
import { computed } from "vue";
import YjChartCard from "../../../../components/yijie/YjChartCard.vue";
import { createArtifactReportChartModel } from "../../../../domain/chat-artifact-report-chart";
import type { ReportChart } from "./report-model";

const props = defineProps<{ chart: ReportChart }>();
const model = computed(() => {
  const { kind, title, note, unit, points } = props.chart;
  const chart = createArtifactReportChartModel({
    id: title, ordinal: 0, type: "chart", required: true, truncated: false, title, chartType: kind, aligned: true,
    labels: points.map(([label]) => label), series: [{ ordinal: 0, name: unit, values: points.map(([, value]) => value) }],
  });
  return { ...chart, description: note };
});
</script>

<template><YjChartCard :model="model" compact /></template>
