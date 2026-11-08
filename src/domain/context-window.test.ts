import { describe, expect, it } from "vitest";
import { contextWindowPresentation } from "./context-window";
import type { ContextWindowSample } from "../api/context-window-client";

const sample = (used: number, capacity: number | null): ContextWindowSample => ({ used_tokens: used, capacity_tokens: capacity, turn_id: "turn", window_id: "10000000-0000-4000-8000-000000000001", observed_at: "2026-11-08T12:00:00Z" });
describe("native context presentation", () => {
  it("uses one native numerator and denominator for numbers and percentages", () => {
    expect(contextWindowPresentation(sample(143000, 730000))).toEqual({ percent: 20, summary: "20% 已用（剩余 80%）", tokens: "已用 143k Token，共 730k", latest: true });
  });
  it("keeps missing statistics, unknown capacity and native zero distinct", () => {
    expect(contextWindowPresentation(null)).toMatchObject({ percent: null, summary: "暂无用量数据", tokens: null, latest: false });
    expect(contextWindowPresentation(sample(500, null))).toMatchObject({ percent: null, summary: "容量未知", tokens: "已用 500 Token", latest: true });
    expect(contextWindowPresentation(sample(0, 730000))).toMatchObject({ percent: 0, summary: "0% 已用（剩余 100%）" });
    expect(contextWindowPresentation(sample(500, 0)).percent).toBeNull();
  });
  it("retains native over-capacity usage without fabricating negative remaining", () => {
    expect(contextWindowPresentation(sample(810000, 730000))).toMatchObject({ percent: 111, summary: "111% 已用（剩余 0%）", tokens: "已用 810k Token，共 730k" });
  });
});
