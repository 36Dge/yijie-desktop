import type { ConversationTimelineItemViewModel } from "./conversation-timeline";

const words = (query: string) => query.trim().split(/\s+/).filter(Boolean);
const samePrefix = (row: readonly string[], prefix: readonly string[]) => prefix.every((word, i) => row[i] === word);
const phrase = (tokens: readonly string[]) => tokens.join(" ").replace(/([\p{Script=Han}])\s+(?=\p{Script=Han})/gu, "$1");

/** Reading label only. Never change the original queries or assign hits to guessed subqueries. */
export function webSearchQueryTitle(queries: readonly string[]): string {
  const original = queries.map(query => words(query)).filter(query => query.length);
  if (!original.length) return "";
  let rows = original;
  // Some providers flatten several searches into one query, repeating the topic
  // at each boundary. Split only an exactly repeated, multi-character prefix.
  if (rows.length === 1) {
    const tokens = rows[0]!;
    for (let length = Math.min(4, Math.floor(tokens.length / 2)); length >= 1; length--) {
      const prefix = tokens.slice(0, length);
      if (prefix.join("").length < 2) continue;
      const starts = tokens.flatMap((_, index) => samePrefix(tokens.slice(index), prefix) ? [index] : []);
      if (starts.length < 2 || starts.some((start, i) => (starts[i + 1] ?? tokens.length) - start <= length)) continue;
      rows = starts.map((start, i) => tokens.slice(start, starts[i + 1] ?? tokens.length));
      break;
    }
  }
  if (rows.length > 1) {
    let count = 0;
    while (count < Math.min(...rows.map(row => row.length)) - 1 && rows.every(row => row[count] === rows[0]![count])) count++;
    if (count > 0 && rows[0]!.slice(0, count).join("").length >= 2) {
      const topic = phrase(rows[0]!.slice(0, count));
      const aspects = [...new Set(rows.map(row => phrase(row.slice(count))))];
      return `${topic} · ${aspects.join("、")}`;
    }
  }
  return original.map(row => row.join(" ")).join(" / ");
}

/** Distinct native calls with the same queries are real repeats, not duplicate DOM. */
export function webSearchOccurrences(items: readonly Pick<ConversationTimelineItemViewModel, "identity" | "webSearch">[]): ReadonlyMap<string, number> {
  const seen = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const item of items) {
    if (item.webSearch?.action !== "search" || occurrences.has(item.identity)) continue;
    const queries = item.webSearch.queries.map(query => words(query).join(" ")).filter(Boolean);
    if (!queries.length) continue;
    const key = JSON.stringify(queries);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    occurrences.set(item.identity, count);
  }
  return occurrences;
}
