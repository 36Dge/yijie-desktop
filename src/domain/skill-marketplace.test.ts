import { describe, expect, it } from "vitest";
import {
  parseSkillCatalogSnapshot,
  projectSkillCategories,
  skillCanInstall,
  skillCapabilitySummary,
  SkillProjectionError,
} from "./skill-marketplace";

function skillWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "yijie.content-marketing.copywriting",
    runtimeName: "copywriting",
    category: "content-marketing",
    order: 0,
    displayName: "跨境营销文案",
    description: "根据已确认的商品事实和受众生成跨境营销文案。",
    version: "0.1.0",
    iconKey: "edit",
    riskLevel: "medium",
    riskReasons: ["营销文案可能包含未经证实的声明。"],
    sourceType: "internal",
    licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
    executionMode: "model-only",
    networkAccess: "none",
    filesystemAccess: "none",
    requiredTools: [],
    catalogStatus: "installable",
    maintenanceStatus: "maintained",
    capabilityReadiness: "ready",
    installationStatus: "not_installed",
    enabled: false,
    runtimeVisible: false,
    failureCode: "",
    ...overrides,
  };
}

function snapshotWire(
  skills: unknown[] = [skillWire()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scannedAt: "2026-08-25T08:00:00Z",
    skills,
    ...overrides,
  };
}

describe("Skill marketplace native projection", () => {
  it("parses, sorts and projects the five fixed categories without synthetic cards", () => {
    const source = snapshotWire([
      skillWire({
        id: "yijie.store-operations.second",
        runtimeName: "second",
        category: "store-operations",
        order: 9,
        displayName: "第二个 Skill",
      }),
      skillWire(),
    ]);
    const snapshot = parseSkillCatalogSnapshot(source);
    const categories = projectSkillCategories(snapshot.skills);

    expect(snapshot.skills.map((skill) => skill.id)).toEqual([
      "yijie.content-marketing.copywriting",
      "yijie.store-operations.second",
    ]);
    expect(categories.map((category) => category.label)).toEqual([
      "货源与选品",
      "市场调研与分析",
      "内容创作与营销",
      "流量获取与广告",
      "店铺运营与基建",
    ]);
    expect(categories.map((category) => category.skills.length)).toEqual([0, 0, 1, 0, 1]);
    expect(skillCanInstall(snapshot.skills[0]!)).toBe(true);
    expect(skillCapabilitySummary(snapshot.skills[0]!)).toContain("不访问网络或本地文件");
  });

  it("fails closed on an unknown operational enum without exposing a control", () => {
    const snapshot = parseSkillCatalogSnapshot(snapshotWire([
      skillWire({ installationStatus: "future_state" }),
    ]));

    expect(snapshot.skills[0]?.installationStatus).toBe("unknown");
    expect(skillCanInstall(snapshot.skills[0]!)).toBe(false);
  });

  it.each([
    snapshotWire(undefined, { catalogRevision: "a".repeat(64) }),
    snapshotWire([skillWire({ archive: { path: "packages/private.zip" } })]),
    snapshotWire([skillWire({ enabled: true })]),
    snapshotWire([skillWire({
      installationStatus: "installed",
      enabled: true,
      runtimeVisible: true,
      capabilityReadiness: "degraded",
    })]),
    snapshotWire([skillWire(), skillWire()]),
    snapshotWire([skillWire({ category: "future-category" })]),
    snapshotWire(undefined, { futureSafeMetadata: "must-not-be-ignored" }),
    snapshotWire([skillWire({ futureSafeLabel: "must-not-be-ignored" })]),
  ])("rejects sensitive, contradictory, duplicate or unclassifiable response %#", (response) => {
    expect(() => parseSkillCatalogSnapshot(response)).toThrowError(SkillProjectionError);
  });
});
