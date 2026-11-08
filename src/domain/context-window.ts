import type { ContextWindowSample } from "../api/context-window-client";

export function formatContextTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(tokens / 1000)}k`;
}

export function contextWindowPresentation(sample: ContextWindowSample | null) {
  if (!sample || !Number.isSafeInteger(sample.used_tokens) || sample.used_tokens < 0) {
    return { percent: null, summary: "暂无用量数据", tokens: null, latest: false };
  }
  const capacity = sample.capacity_tokens;
  if (capacity === null || !Number.isSafeInteger(capacity) || capacity <= 0) {
    return { percent: null, summary: "容量未知", tokens: `已用 ${formatContextTokens(sample.used_tokens)} Token`, latest: true };
  }
  const percent = Math.round(sample.used_tokens / capacity * 100);
  return {
    percent,
    summary: `${percent}% 已用（剩余 ${Math.max(0, 100 - percent)}%）`,
    tokens: `已用 ${formatContextTokens(sample.used_tokens)} Token，共 ${formatContextTokens(capacity)}`,
    latest: true,
  };
}
