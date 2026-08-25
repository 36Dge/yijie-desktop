import { describe, expect, it } from "vitest";
import {
  parseSkillCatalogSnapshot,
  projectSkillCategories,
  skillCanInstall,
  skillCatalogBlockedReasonLabel,
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
    expect(snapshot.skills[0]?.catalogBlockedReason).toBeNull();
  });

  it("keeps installable degraded Skills actionable and accepts confirmed Runtime visibility", () => {
    const notInstalled = parseSkillCatalogSnapshot(snapshotWire([
      skillWire({
        executionMode: "tool-assisted",
        networkAccess: "required",
        requiredTools: ["browser.search"],
        capabilityReadiness: "degraded",
      }),
    ])).skills[0]!;
    expect(skillCanInstall(notInstalled)).toBe(true);

    const installed = parseSkillCatalogSnapshot(snapshotWire([
      skillWire({
        executionMode: "tool-assisted",
        networkAccess: "required",
        requiredTools: ["browser.search"],
        capabilityReadiness: "degraded",
        installationStatus: "installed",
        enabled: true,
        runtimeVisible: true,
      }),
    ])).skills[0]!;
    expect(installed.runtimeVisible).toBe(true);
  });

  it("requires and safely labels the 0.5.1 blocked catalog reason", () => {
    const blocked = parseSkillCatalogSnapshot(snapshotWire([
      skillWire({
        catalogStatus: "blocked",
        catalogBlockedReason: "distribution_not_authorized",
        capabilityReadiness: "blocked",
      }),
    ])).skills[0]!;

    expect(skillCanInstall(blocked)).toBe(false);
    expect(skillCatalogBlockedReasonLabel(blocked.catalogBlockedReason)).toContain("桌面分发授权");
    expect(() => parseSkillCatalogSnapshot(snapshotWire([
      skillWire({ catalogStatus: "blocked", capabilityReadiness: "blocked" }),
    ]))).toThrowError(SkillProjectionError);
    expect(() => parseSkillCatalogSnapshot(snapshotWire([
      skillWire({ catalogBlockedReason: "license_unverified" }),
    ]))).toThrowError(SkillProjectionError);
  });

  it("projects the reviewed 38-card category shape as 5/9/7/9/8", () => {
    const counts = [5, 9, 7, 9, 8] as const;
    const skills = counts.flatMap((count, categoryIndex) => {
      const category = [
        "sourcing-selection",
        "market-research",
        "content-marketing",
        "traffic-advertising",
        "store-operations",
      ][categoryIndex]!;
      return Array.from({ length: count }, (_, index) => skillWire({
        id: `yijie.${category}.fixture-${index}`,
        runtimeName: `${category}-fixture-${index}`,
        category,
        order: index,
        displayName: `${category} ${index}`,
      }));
    });

    const snapshot = parseSkillCatalogSnapshot(snapshotWire(skills));
    expect(snapshot.skills).toHaveLength(38);
    expect(projectSkillCategories(snapshot.skills).map((category) => category.skills.length))
      .toEqual([5, 9, 7, 9, 8]);
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
    snapshotWire([skillWire({ catalogStatus: "blocked" })]),
    snapshotWire([skillWire(), skillWire()]),
    snapshotWire([skillWire({ category: "future-category" })]),
    snapshotWire(undefined, { futureSafeMetadata: "must-not-be-ignored" }),
    snapshotWire([skillWire({ futureSafeLabel: "must-not-be-ignored" })]),
  ])("rejects sensitive, contradictory, duplicate or unclassifiable response %#", (response) => {
    expect(() => parseSkillCatalogSnapshot(response)).toThrowError(SkillProjectionError);
  });
});
