import { createApp, defineComponent, h, nextTick, ref } from "vue";
import axe from "axe-core";
import MarketChatActivity from "../../../src/components/chat/MarketChatActivity.vue";
import { marketObservation } from "../../../src/test/market-chat-fixture";
import type { MarketApproval } from "../../../src/domain/market-host-v2-native.generated";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "./preview.css";

// Ordinary synthetic values rendered by the actual production components.
// No native client, model, provider, credentials or App activation is imported.
const base = { title: "公开资料与来源示例", url: "https://example.org/docs", snippet: "用于核对正文状态和来源的普通示例材料。" };
const samples = [
  ["kimi_web_search", { results: [
    { ...base, text: "这里是本次取得的正文材料。", content_status: "available" },
    { ...base, title: "未取得正文的来源", url: "https://example.org/empty", text: "", content_status: "unavailable" },
    { ...base, title: "正文已裁至空的来源", url: "https://example.org/clipped", text: "", content_status: "truncated" },
  ], truncated: true, dropped_results: 1 }],
  ["kimi_web_search_pro", { results: [{ ...base, site_name: "Example", date: "2026-10-29", authority: "", chunks: [{ text: "按查询返回的正文片段，保留该页来源。", score: 0.5 }], content_status: "available" }], truncated: false, dropped_results: 0 }],
  ["kimi_web_fetch", { url: base.url, title: "读取指定网页", markdown: "# 普通正文\n这是纯文本材料，不加载远程图片或执行网页脚本。", truncated: false }],
] as const;
const evidence = document.createElement("script");
evidence.id = "feat162-axe-results"; evidence.type = "application/json";
document.body.append(evidence);
let auditRun = 0;
async function audit() {
  const run = ++auditRun;
  evidence.dataset.ready = "false";
  await nextTick();
  const result = await axe.run(document);
  if (run !== auditRun) return;
  evidence.textContent = JSON.stringify({ violations: result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })) });
  evidence.dataset.ready = "true";
}
createApp(defineComponent({
  setup() {
    const theme = ref("light"), scenario = ref("results"), notice = ref("尚未进行界面操作。");
    function themeChange() {
      theme.value = theme.value === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = theme.value;
      void audit();
    }
    return () => {
      const observation = marketObservation();
      const approval = observation.approvals!.requests[0]!;
      approval.identity.toolName = "kimi_web_search_pro";
      approval.identity.serviceId = "kimi-web";
      approval.review = { title: "Kimi Pro 网页检索", summary: "只读检索可能计费；本页仅展示普通合成值，不执行任何调用。", risk: "read", argumentsJson: '{"query":"公开资料","sites":["example.org"]}' };
      approval.decisionExpiresAtUnixMs = Date.now() + 23_000;
      approval.executionExpiresAtUnixMs = approval.expiresAtUnixMs;
      observation.selectionDisplay = [{ ...observation.selectionDisplay[0]!, serviceId: "kimi-web", displayName: "Kimi 网页检索" }];
      const sourceItem = observation.tools!.items[0]!;
      observation.tools!.items = samples.map(([tool, result], index) => ({ ...sourceItem, nativeItemId: `sample-${index}`, toolName: tool, state: "completed", resultText: JSON.stringify(result) }));
      if (scenario.value === "empty-error") {
        observation.tools!.items = [
          { ...sourceItem, nativeItemId: "empty", toolName: "kimi_web_search", state: "completed", resultText: '{"results":[],"truncated":false}' },
          { ...sourceItem, nativeItemId: "error", toolName: "kimi_web_search_pro", state: "failed", resultText: '{"error":{"code":"invalid_response","message":"网页检索服务返回了无法验证的结果。"}}' },
          { ...sourceItem, nativeItemId: "legacy", toolName: "kimi_web_search", state: "completed", resultText: "普通历史文本，保留为可读材料。" },
        ];
        approval.state = "expired";
      }
      return h("main", { class: "feat162-preview" }, [
        h("h1", "FEAT-162 组件零费用预览"),
        h("p", "使用实际工具结果与审批组件；合成材料仅用于界面检查，不代表供应商或真实 App 验收。"),
        h("nav", { "aria-label": "预览选项" }, [
          h("button", { type: "button", class: "yj-control", onClick: themeChange }, theme.value === "light" ? "切换暗色" : "切换亮色"),
          h("select", { "aria-label": "预览场景", value: scenario.value, onChange: (e: Event) => { scenario.value = (e.target as HTMLSelectElement).value; void audit(); } }, [h("option", { value: "results" }, "三工具结果和待批状态"), h("option", { value: "empty-error" }, "空结果、错误、历史和过期")]),
        ]),
        h("p", { role: "status" }, notice.value),
        h(MarketChatActivity, { observation, connected: true, refreshing: false, deciding: null, error: null,
          actionable: (item: MarketApproval) => item.state === "pending",
          onDecision: (_id: string, decision: string) => { notice.value = `仅界面事件：${decision}；没有发送审批或HTTP。`; void audit(); },
        }),
      ]);
    };
  },
})).mount("#app");
void audit();
