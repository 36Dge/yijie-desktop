import type { NativeMcpDisplay } from "../api/generated/native-conversation-private.gen";
import { sorftimeTool, type SorftimeMethod } from "./sorftime-tools";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sorftimeResultData(text: string): unknown {
  try {
    const envelope: unknown = JSON.parse(text);
    if (isRecord(envelope) && envelope.error == null && envelope.isError !== true) return envelope.data;
  } catch { /* Older or clipped display text may not contain a complete envelope. */ }
}

export function incompleteSorftimeResult(mcp: NativeMcpDisplay): boolean {
  return mcp.diagnostics.some(code => code !== "arguments_unavailable" && code !== "identity_unavailable");
}

type ResultFact = {kind: "roots" | "categories" | "products"; ids: string[]} |
  {kind: "sales"; asin: string; period: "日" | "月"};

export const sorftimeAsin = /^[A-Z0-9]{10}$/;

function listFact(kind: "roots" | "categories" | "products", data: unknown): ResultFact | undefined {
  if (!Array.isArray(data)) return;
  const identities = new Map<string, string>();
  for (const row of data) {
    if (!isRecord(row)) return;
    if (kind === "products") {
      if (typeof row.asin !== "string" || !sorftimeAsin.test(row.asin)) return;
      identities.set(row.asin, row.asin);
    } else {
      const id = row.node_id;
      if (!(typeof id === "string" && /^[a-z\d_-]{1,64}$/i.test(id)) &&
          !(typeof id === "number" && Number.isSafeInteger(id) && id >= 0)) return;
      if (typeof row.category_name !== "string" || !row.category_name.trim()) return;
      if (kind === "roots" && !Array.isArray(row.children)) return;
      const key = String(id), name = row.category_name.trim();
      if (identities.has(key) && identities.get(key) !== name) return;
      identities.set(key, name);
    }
  }
  const ids = kind === "products" ? [...identities.keys()] :
    Array.from(identities, pair => JSON.stringify(pair));
  return {kind, ids: ids.sort()};
}

function salesFact(data: unknown): ResultFact | undefined {
  if (!isRecord(data) || typeof data.asin !== "string" || !sorftimeAsin.test(data.asin)) return;
  const period = data.type === "DailySalesVolume" ? "日" : data.type === "SalesVolume" ? "月" : undefined;
  const series = data.data;
  if (!period || !Array.isArray(series) || !series.length || series.length % 2) return;
  const date = period === "日" ? /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/ : /^\d{4}(0[1-9]|1[0-2])$/;
  // Sorftime encodes these dimensions as alternating period and volume. Zero is an observation.
  for (let i = 0; i < series.length; i += 2) {
    const value: unknown = series[i + 1];
    if (typeof series[i] !== "string" || !date.test(series[i]) ||
        !((typeof value === "string" && /^\d+$/.test(value)) || typeof value === "number") ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 0) return;
  }
  return {kind: "sales", asin: data.asin, period};
}

const readers: Partial<Record<SorftimeMethod, (data: unknown) => ResultFact | undefined>> = {
  category_tree: data => listFact("roots", data),
  category_search_from_top_node: data => listFact("categories", data),
  category_products: data => listFact("products", data),
  category_products_extended: data => listFact("products", data),
  product_trend: salesFact,
};
type CachedResult = {method: SorftimeMethod; text: string; fact: ResultFact | undefined};
export type ResultCache = Map<string, CachedResult>;
export type ResultRevision = {previous: ReadonlyMap<string, CachedResult>; current: ResultCache};

export function sorftimeResultFact(receipt: NativeMcpDisplay, identity: string, cache?: ResultRevision): ResultFact | undefined {
  const method = sorftimeTool(receipt.server, receipt.tool)?.method;
  const read = method && readers[method];
  if (!method || !read || receipt.resultKind !== "text" || incompleteSorftimeResult(receipt) ||
      receipt.texts.length !== 1 || receipt.texts[0]!.index !== 0) return;
  const text = receipt.texts[0]!.text;
  const saved = cache?.previous.get(identity);
  const fact = saved?.method === method && saved.text === text ? saved.fact : read(sorftimeResultData(text));
  cache?.current.set(identity, {method, text, fact});
  return fact;
}

/** All entries must support the claim, including repeated calls with missing evidence. */
export function sorftimeResultTitle(facts: readonly (ResultFact | undefined)[]): string | undefined {
  const first = facts[0];
  if (!first || facts.some(fact => fact?.kind !== first.kind)) return;
  if (first.kind === "sales") {
    const asins = new Set<string>();
    for (const fact of facts) {
      if (fact?.kind !== "sales") return;
      if (fact.period !== first.period) return "查询商品日销量和月销量";
      asins.add(fact.asin);
    }
    return `取得 ${asins.size} 款商品的${first.period}销量`;
  }
  if (first.kind === "products") {
    const asins = new Set(facts.flatMap(fact => fact?.kind === "products" ? fact.ids : []));
    return asins.size ? `读取 ${asins.size} 款类目商品` : "查询类目商品，未返回商品";
  }
  const same = facts.every(fact => fact?.kind === first.kind && fact.ids.length === first.ids.length &&
    fact.ids.every((id, index) => id === first.ids[index]));
  if (!same) return;
  if (first.kind === "roots") return `读取类目树（${first.ids.length} 个一级类目）`;
  if (facts.length === 1) return `按上级类目查询，返回 ${first.ids.length} 个类目`;
  return first.ids.length ? `${facts.length} 次查询返回相同的 ${first.ids.length} 个类目` : `${facts.length} 次类目查询均未返回匹配项`;
}
