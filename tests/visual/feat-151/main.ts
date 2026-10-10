import axe from "axe-core";
import type { AxeResults } from "axe-core";
import { createApp, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import WorkflowPage from "../../../src/pages/workflows/WorkflowPage.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import WorkflowVisualHarness from "./WorkflowVisualHarness.vue";
import { workflowNativeClient } from "../../../src/api/workflow-native-client";
import { uiZoomCssValue, uiZoomedViewportCss, uiZoomedWindowMinimumCss } from "../../../src/domain/ui-zoom";

const query = new URLSearchParams(window.location.search);
const dark = query.get("theme") === "dark";
document.documentElement.dataset.theme = dark ? "dark" : "light";

// Read-only synthetic data in this isolated visual harness; no native service calls.
workflowNativeClient.status = async () => ({ protocol_version: 1, ready: true, state: "ready", run_epoch: "15300000-0000-4000-8000-000000000001", limits: { input_bytes: 4096, prefix_bytes: 1024, output_bytes: 5120, canvas_bytes: 262144, message_bytes: 524288, max_active_runs: 1, execution_budget_seconds: 30, editor_ttl_seconds: 300 } });
workflowNativeClient.list = async () => ({ items: query.get("fixtures") === "1" ? [
  { workflow_id: "15301", revision: "15302", name: query.get("stress") === "1" ? "跨境商品多语种文案生成与目标市场关键词分析工作流" : "商品文案整理工作流", description: query.get("stress") === "1" ? "整理商品卖点、目标市场与搜索词，生成结构清晰的商品文案，并保留完整的输入信息供后续核对与编辑。" : "整理商品卖点，生成结构清晰的商品文案", published_version: "v0.0.1", runnable: true, updated_at_ms: 2000 },
  { workflow_id: "15303", revision: "15304", name: "待完善的文本处理流程", ...(query.get("stress") === "1" ? {} : { description: "继续配置文本处理节点与输出内容" }), runnable: false, updated_at_ms: 1000 },
] : [] });
const previewZoom = Number(query.get("zoom") ?? 100);
if ([80, 100, 120, 140, 160, 180, 200].includes(previewZoom)) {
  const viewport = uiZoomedViewportCss(previewZoom);
  const minimum = uiZoomedWindowMinimumCss(previewZoom);
  document.documentElement.style.setProperty("zoom", uiZoomCssValue(previewZoom));
  document.documentElement.style.setProperty("--yj-ui-scale", uiZoomCssValue(previewZoom));
  document.documentElement.style.setProperty("--yj-ui-viewport-width", viewport.width);
  document.documentElement.style.setProperty("--yj-ui-viewport-height", viewport.height);
  document.documentElement.style.setProperty("--yj-layout-window-min-width", minimum.width);
  document.documentElement.style.setProperty("--yj-layout-window-min-height", minimum.height);
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/workflows", component: WorkflowPage },
    { path: "/workflows/:workflowId", name: "workflow-editor", component: { render: () => h("h1", "工作流页面 · 视觉验证") } },
    { path: "/chat", component: { template: "<div>新建任务</div>" } },
    { path: "/store", component: { template: "<div>我的店铺</div>" } },
    { path: "/plugins", component: { template: "<div>插件</div>" } },
    { path: "/settings", component: { template: "<div>设置</div>" } },
  ],
});
await router.push("/workflows");
await router.isReady();

declare global {
  interface Window {
    __FEAT151_RUN_AXE__: () => Promise<AxeResults>;
  }
}

window.__FEAT151_RUN_AXE__ = () => axe.run(document, {
  rules: { region: { enabled: false } },
});

createApp(WorkflowVisualHarness, { dark }).use(router).mount("#app");

const axeEvidence = document.createElement("script");
axeEvidence.id = "feat151-axe-results";
axeEvidence.type = "application/json";
document.body.append(axeEvidence);
void window.__FEAT151_RUN_AXE__().then((results) => {
  axeEvidence.textContent = JSON.stringify({
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })),
  });
  axeEvidence.dataset.ready = "true";
});
