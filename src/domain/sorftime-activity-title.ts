import { activityNativeItem, type ConversationActivityEntry as Entry } from "./conversation-activity-entry";
import { sorftimeAsin, sorftimeResultFact, sorftimeResultTitle, type ResultRevision } from "./sorftime-result";
import type { SorftimeMethod } from "./sorftime-tools";

// These qualifiers are already visible in the registered tool rows. Folding them
// describes requests only. All result claims come from the separate receipt reader.
function registeredFields(entry: Entry): string[] {
  const display = activityNativeItem(entry.item)?.toolDisplay;
  if (display?.provenance !== "registeredTool" || !display.title) return [];
  const fields = entry.title.split(" · ");
  const original = display.title.split(" · ");
  return fields.length === original.length && fields.slice(1).every((field, i) => field === original[i + 1]) ? fields : [];
}

function displayedPages(entries: readonly Entry[]): string | undefined {
  const pages = new Set<number>();
  let node: string | undefined;
  for (const entry of entries) {
    const fields = registeredFields(entry);
    const page = fields[2]?.match(/^第 ([1-9]\d{0,6}) 页$/);
    if (fields.length !== 3 || !page || !/^\d{1,20}$/.test(fields[1]!) || (node !== undefined && node !== fields[1])) return;
    node = fields[1];
    pages.add(Number(page[1]));
  }
  const ordered = [...pages].sort((a, b) => a - b);
  const first = ordered[0]!, last = ordered[ordered.length - 1]!;
  if (first === last) return entries.length === 1 ? `第 ${first} 页` : `第 ${first} 页，${entries.length} 次`;
  if (last - first + 1 === ordered.length) return `第 ${first}–${last} 页`;
  return ordered.length <= 3 ? `第 ${ordered.join("、")} 页` : `${ordered.length} 个页码`;
}

function requestedSales(entries: readonly Entry[]): string | undefined {
  const actions = new Set(entries.map(entry => entry.title.split(" · ", 1)[0]!));
  if (actions.size === 2 && actions.has("查询商品日销量") && actions.has("查询商品月销量")) return "查询商品日销量和月销量";
  if (actions.size !== 1) return;
  const action = entries[0]!.title.split(" · ", 1)[0]!;
  const period = action === "查询商品日销量" ? "日" : action === "查询商品月销量" ? "月" : undefined;
  if (period) {
    const targets = entries.map(registeredFields);
    if (targets.every(fields => fields.length === 2 && sorftimeAsin.test(fields[1]!))) {
      const count = new Set(targets.map(fields => fields[1])).size;
      if (count > 1) return `查询 ${count} 款商品的${period}销量`;
    }
  }
  return `${action} ${entries.length} 次`;
}

function confirmedResult(entry: Entry, cache?: ResultRevision) {
  const {item} = entry;
  const native = activityNativeItem(item);
  const mcp = native?.mcp;
  if (!mcp || item.execution?.status !== "completed" || item.busy) return;
  if (native.availability === "unavailable" || (native.availability === "partial" && !mcp.diagnostics.length)) return;
  const fact = sorftimeResultFact(mcp, entry.identity, cache);
  if (fact?.kind === "sales") {
    const [action, target] = registeredFields(entry);
    if (target && sorftimeAsin.test(target) && target !== fact.asin) return;
    if ((action === "查询商品日销量" && fact.period !== "日") || (action === "查询商品月销量" && fact.period !== "月")) return;
  }
  return fact;
}

export function sorftimeActivityTitle(method: SorftimeMethod, label: string, entries: readonly Entry[], cache?: ResultRevision): string | undefined {
  const pages = method === "category_products_extended" ? displayedPages(entries) : undefined;
  const result = sorftimeResultTitle(entries.map(entry => confirmedResult(entry, cache)));
  if (result) return pages ? `${result}（${pages}）` : result;
  if (pages) return `${label}（${pages}）`;
  if (method === "product_trend" && entries.length > 1) return requestedSales(entries);
}
