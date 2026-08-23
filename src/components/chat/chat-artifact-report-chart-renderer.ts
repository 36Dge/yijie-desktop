import type { Component } from "vue";

export async function loadChatArtifactReportChartRenderer(): Promise<Component> {
  return (await import("../yijie/YjChartCard.vue")).default;
}
