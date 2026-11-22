import type { NativeItem } from "../api/generated/native-conversation-private.gen";
import { sorftimeCategoryTool } from "./sorftime-category-result";

type ActionLabel = { title: string; source?: string };

// Label only exact service/tool pairs, including the published marketplace aliases.
const knownActions = new Map<string, ActionLabel>([
  [`yijie_market/${sorftimeCategoryTool}`, {title: "查询 Amazon 类目", source: "Sorftime"}],
  ["sorftime/category_search_from_product_name", {title: "查询 Amazon 类目", source: "Sorftime（旧版）"}],
  ["yijie_market/m_1432d121c0c49225c55e2f004f8fe2f5f8fcf841083c77681ea73541b96f", {title: "查看 Amazon 商品详情", source: "Sorftime"}],
  ["sorftime/product_detail", {title: "查看 Amazon 商品详情", source: "Sorftime（旧版）"}],
  ["codex/list_mcp_resources", {title: "查找可用资源"}],
  ["codex/list_mcp_resource_templates", {title: "查找资源模板"}],
  ["yijie_web/kimi_web_search", {title: "采集网页资料", source: "易界网页检索"}],
  ["yijie_web/kimi_web_search_pro", {title: "网页深度搜索", source: "易界网页检索"}],
  ["yijie_web/kimi_web_fetch", {title: "读取指定网页", source: "易界网页检索"}],
  ["yijie_market/kimi_web_search", {title: "搜索网页（Kimi Basic）", source: "Kimi 网页检索"}],
  ["yijie_market/kimi_web_search_pro", {title: "搜索网页（Kimi Pro）", source: "Kimi 网页检索"}],
  ["yijie_market/kimi_web_fetch", {title: "读取网页（Kimi）", source: "Kimi 网页检索"}],
]);

function displayName(value?: string): string | undefined {
  const label = value?.trim();
  if (!label || /\bmcp__|\bm_[a-f\d]{16,}/i.test(label)) return;
  // Older labels can be "server / tool" or the catalog's "service · raw_name".
  if (/^[\w.-]+\s*\/\s*[\w.-]+$/.test(label) || /^(?:[\w.-]+\s*·\s*)?[\w.-]*_[\w.-]+$/.test(label)) return;
  return label;
}

const genericLabels = new Set(["工具调用", "调用工具", "连接器工具"]);
const receiptLabels = new Set(["结果已接收", "结构化结果已接收"]);

export function nativeMcpLabels(item: NativeItem): ActionLabel {
  const mcp = item.mcp;
  const known = knownActions.get(`${mcp?.server}/${mcp?.tool}`);
  const source = displayName(item.toolDisplay?.sourceLabel) ?? known?.source;
  for (const candidate of [item.toolDisplay?.title, item.toolLabel]) {
    const title = displayName(candidate);
    if (title && title !== mcp?.tool && title !== mcp?.server && !genericLabels.has(title)) return {title, source};
  }
  if (known) return {title: known.title, source};
  const fallback = mcp?.server === "yijie_market" ? "使用连接器" : "使用工具";
  return {title: source ? `使用 ${source}` : fallback, source};
}

/** A completed call can have an empty response or no saved result details. */
export function completedMcpOutcome(item: NativeItem): string {
  const mcp = item.mcp;
  if (mcp?.server === "codex" && (mcp.tool === "list_mcp_resources" || mcp.tool === "list_mcp_resource_templates")) {
    // Earlier resource receipts stored the Host's count on the first line.
    const count = item.resultSummary ?? mcp.texts[0]?.text.split("\n", 1)[0];
    if (count && /^(?:未发现可用|找到 \d+ 项可用)资源(?:模板)?(?:（还有后续分页）)?$/.test(count)) return count;
  }
  // The Host may supply a public outcome for a registered operation. Use that
  // display field before the generic receipt, without falling back to raw text blocks.
  const summary = displayName(item.resultSummary);
  if (summary && summary.length <= 256 && !receiptLabels.has(summary) && !/[{}\r\n]|^\[|^Wall time:/.test(summary)) return summary;
  if (mcp?.resultKind === "empty") return "工具已完成，没有返回内容。";
  if (mcp?.resultKind === "text") {
    if (mcp.diagnostics.some(code => code === "content_limit" || code === "content_truncated")) return "已收到结果，仅保留了部分内容。";
    if (mcp.texts.some(block => block.text.trim())) return "已收到工具结果。";
    return "工具已完成，没有返回文本。";
  }
  if (item.resultSummary === "结构化结果已接收") return "已收到工具结果。";
  return "工具已完成，暂无结果详情。";
}
