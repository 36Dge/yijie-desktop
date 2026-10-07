import { describe, expect, it } from "vitest";
import { dashboardCsv, dashboardFactor, dashboardProducts, dashboardShops, dashboardStats } from "./store-dashboard";

describe("store dashboard demo data", () => {
  it.each(dashboardShops.flatMap((shop) => [7, 30, 90].map((period) => ({ shop: shop.id, period }))))(
    "keeps table totals consistent with overview for $shop over $period days",
    ({ shop, period }) => {
      const factor = dashboardFactor(shop, period);
      const rows = dashboardProducts(factor);
      const stats = dashboardStats(factor);
      expect(rows.reduce((sum, row) => sum + row.sales, 0)).toBe(stats.sales);
      expect(rows.reduce((sum, row) => sum + row.orders, 0)).toBe(stats.orders);
      expect(stats.profit).toBeLessThan(stats.sales);
      expect(stats.goal).toBeGreaterThan(stats.sales);
      expect(stats.visitors).toBeGreaterThan(stats.orders);
    },
  );

  it("returns independent data so sorting or viewing a scoped store does not alter the aggregate", () => {
    const baseline = dashboardProducts(1);
    const scoped = dashboardProducts(dashboardFactor("studio", 7));
    scoped.reverse();
    scoped[0].name = "临时商品名称";
    expect(dashboardProducts(1)).toEqual(baseline);
    expect(new Set(baseline.map((row) => row.id)).size).toBe(baseline.length);
  });

  it("exports only the selected product rows with explicit units and a Chinese-compatible BOM", () => {
    const rows = dashboardProducts(1).filter((row) => row.category === "厨房用品");
    const csv = dashboardCsv(rows);
    expect(csv.startsWith("\uFEFF商品,SKU,销售额(USD),订单量,转化率(%),环比(%),AI评分\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("便携手冲咖啡壶,YJ-HM-004");
    expect(csv).toContain("竹木厨房置物架,YJ-HM-007");
    expect(csv).not.toContain("陶瓷马克杯套装");
  });
});
