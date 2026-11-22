import type { NativeMcpDisplay } from "../api/generated/native-conversation-private.gen";

// Published marketplace alias of Sorftime's category_search_from_product_name.
export const sorftimeCategoryTool = "m_1d673ceb21a3c8e9b62a3a9ff2d142c1f4e1442ebce7e1b92ae02ef420b2";

interface Category {
  name: string;
  nodeId?: string;
  season?: string;
  metrics: {label: string; value: string}[];
}

export interface SorftimeCategoryResult {
  summary: string;
  categories: Category[];
}

const numberFormat = new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 2});
const priceFormat = new Intl.NumberFormat("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const incompleteResult = new Set(["content_truncated", "content_limit", "content_redacted", "display_limit", "result_unavailable", "unsupported_content"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return;
    value = Number(text.replace(/,/g, ""));
  }
  // The provider uses -1 for unavailable figures. Zero is a valid observation.
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

function peakSeason(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  if (value.trim() === "均衡") return "全年较均衡";
  const months = value.trim().split(/\s*[,，、]\s*/);
  if (months.length > 12 || !months.every(month => /^(?:[1-9]|1[0-2])月$/.test(month))) return;
  return months.join("、");
}

function readCategory(row: unknown): Category | undefined {
  if (!isObject(row)) return;
  const name = typeof row.category_name === "string" ? row.category_name.trim() : "";
  if (!name || name.length > 512 || /[\r\n]|^\[(?:redacted|omitted)\]$/i.test(name) || name.startsWith('{"') || name.startsWith("[{")) return;
  const id = row.node_id;
  const nodeId = typeof id === "string" && /^\d{1,64}$/.test(id) ? id
    : typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? String(id) : undefined;
  const volume = numericValue(row.top100_monthly_sales_volume);
  const price = numericValue(row.average_price);
  const rating = numericValue(row.average_star_rating);
  const metrics: Category["metrics"] = [];
  if (volume !== undefined && Number.isSafeInteger(volume)) metrics.push({label: "月销量合计", value: `${numberFormat.format(volume)} 件`});
  if (price !== undefined) metrics.push({label: "平均售价（当地货币）", value: priceFormat.format(price)});
  if (rating !== undefined && rating <= 5) metrics.push({label: "平均评分", value: `${numberFormat.format(rating)} / 5`});
  return {name, nodeId, season: peakSeason(row.peak_season), metrics};
}

function resultRows(text: string): unknown[] | undefined {
  try {
    const envelope: unknown = JSON.parse(text);
    if (isObject(envelope) && envelope.error == null && envelope.isError !== true && Array.isArray(envelope.data)) return envelope.data;
  } catch { /* A clipped or older receipt may not contain a complete JSON object. */ }
}

/** Read business rows only from this tool's retained display text. doc describes the fields. */
export function readSorftimeCategoryResult(mcp?: NativeMcpDisplay): SorftimeCategoryResult | undefined {
  if (!mcp || !((mcp.server === "yijie_market" && mcp.tool === sorftimeCategoryTool) ||
      (mcp.server === "sorftime" && mcp.tool === "category_search_from_product_name"))) return;
  const categories: Category[] = [];
  let foundList = false;
  let partial = mcp.diagnostics.some(code => incompleteResult.has(code));
  for (const block of mcp.resultKind === "text" ? mcp.texts : []) {
    const rows = resultRows(block.text);
    if (!rows) { partial = true; continue; }
    foundList = true;
    for (const row of rows) {
      const category = readCategory(row);
      if (category) categories.push(category);
      else partial = true;
    }
  }
  let summary = "类目查询已完成，这条记录没有可展示的类目明细。";
  if (categories.length) summary = partial
    ? `已保留 ${categories.length} 条类目结果，明细可能不完整。`
    : `本次返回 ${categories.length} 个匹配类目`;
  else if (foundList && !partial) summary = "本次查询没有找到匹配类目。";
  return {summary, categories};
}
