import { describe, expect, it } from "vitest";
import {
  CHAT_ENTRY_PLACEHOLDERS,
  PLACEHOLDER_ROTATION_INTERVAL_MS,
  nextPlaceholderIndex,
  placeholderAt,
  shouldRotatePlaceholder,
} from "./placeholder-rotation";

describe("placeholder rotation model", () => {
  it("PH-001 keeps the five approved placeholders in their exact order", () => {
    expect(CHAT_ENTRY_PLACEHOLDERS).toEqual([
      "搜索热销商品关键词，发现下一个爆款…",
      "输入目标市场，获取本地化选品建议…",
      "查询物流方案，对比各国时效与运费…",
      "粘贴商品链接，一键分析竞品数据…",
      "输入店铺名称，诊断运营健康度…",
    ]);
    expect(PLACEHOLDER_ROTATION_INTERVAL_MS).toBe(4_000);
  });

  it("PH-002 advances through every placeholder and wraps to the first", () => {
    expect([0, 1, 2, 3, 4].map(nextPlaceholderIndex)).toEqual([1, 2, 3, 4, 0]);
  });

  it("PH-003 safely normalizes invalid or out-of-range indexes", () => {
    expect(placeholderAt(5)).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(placeholderAt(-1)).toBe(CHAT_ENTRY_PLACEHOLDERS[4]);
    expect(placeholderAt(Number.NaN)).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(placeholderAt(Number.POSITIVE_INFINITY)).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
  });

  it("PH-004 rotates only while empty, unfocused, motion-enabled, and active", () => {
    expect(
      shouldRotatePlaceholder({
        value: "",
        isFocused: false,
        prefersReducedMotion: false,
        isDisposed: false,
      }),
    ).toBe(true);

    for (const pausedState of [
      { value: "测试输入", isFocused: false, prefersReducedMotion: false, isDisposed: false },
      { value: "", isFocused: true, prefersReducedMotion: false, isDisposed: false },
      { value: "", isFocused: false, prefersReducedMotion: true, isDisposed: false },
      { value: "", isFocused: false, prefersReducedMotion: false, isDisposed: true },
    ]) {
      expect(shouldRotatePlaceholder(pausedState)).toBe(false);
    }
  });
});
