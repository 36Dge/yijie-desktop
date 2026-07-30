export const CHAT_ENTRY_PLACEHOLDERS = [
  "搜索热销商品关键词，发现下一个爆款…",
  "输入目标市场，获取本地化选品建议…",
  "查询物流方案，对比各国时效与运费…",
  "粘贴商品链接，一键分析竞品数据…",
  "输入店铺名称，诊断运营健康度…",
] as const;

export const PLACEHOLDER_ROTATION_INTERVAL_MS = 4_000;

export interface PlaceholderRotationState {
  value: string;
  isFocused: boolean;
  prefersReducedMotion: boolean;
  isDisposed: boolean;
}

export function normalizePlaceholderIndex(index: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  const integerIndex = Math.trunc(index);
  return (
    (integerIndex % CHAT_ENTRY_PLACEHOLDERS.length) + CHAT_ENTRY_PLACEHOLDERS.length
  ) % CHAT_ENTRY_PLACEHOLDERS.length;
}

export function nextPlaceholderIndex(index: number): number {
  return normalizePlaceholderIndex(normalizePlaceholderIndex(index) + 1);
}

export function placeholderAt(index: number): (typeof CHAT_ENTRY_PLACEHOLDERS)[number] {
  return CHAT_ENTRY_PLACEHOLDERS[normalizePlaceholderIndex(index)];
}

export function shouldRotatePlaceholder(state: PlaceholderRotationState): boolean {
  return (
    !state.isDisposed &&
    !state.isFocused &&
    state.value.length === 0 &&
    !state.prefersReducedMotion
  );
}
