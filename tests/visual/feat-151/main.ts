import axe from "axe-core";
import type { AxeResults } from "axe-core";
import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import WorkflowPage from "../../../src/pages/workflows/WorkflowPage.vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import WorkflowVisualHarness from "./WorkflowVisualHarness.vue";

const query = new URLSearchParams(window.location.search);
const dark = query.get("theme") === "dark";
document.documentElement.dataset.theme = dark ? "dark" : "light";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/workflows", component: WorkflowPage },
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
