import { describe, expect, it } from "vitest";
import { parseNativeSkillCatalog } from "./native-skill-marketplace";
import { skillCanInstall, projectSkillCategories } from "./skill-marketplace";
import { compileSkillInput } from "./chat-skills";
import { nativeSkillFixture, nativeCatalogFixture } from "../test/native-skill-fixture";

describe("native Skill marketplace projection", () => {
  it("accepts qualified native names and preserves user input", () => {
    const projection = parseNativeSkillCatalog(nativeCatalogFixture());
    const selected = projection.skills[0]!;
    expect(compileSkillInput("保留原文。", [selected])).toBe("$yj-user-ordinary:copywriting\n\n保留原文。");
    expect(selected.nativeEpoch).toBe(2);
    expect(projectSkillCategories(projection.skills).slice(-1)[0]?.skills).toHaveLength(1);
  });
  it("keeps dependency readiness independent from local installation", () => {
    const source = { ...nativeSkillFixture, origin: "builtin" as const, installation_state: "not_installed" as const, enabled: false, runtime_visible: false };
    const projected = parseNativeSkillCatalog(nativeCatalogFixture(source)).skills[0]!;
    expect(skillCanInstall(projected)).toBe(true);
    expect(projected.dependencyState).toBe("unknown");
    expect(skillCanInstall({ ...projected, retired: true })).toBe(false);
  });
  it("keeps bundled browsing read-only when runtime state is unknown", () => {
    const projected = parseNativeSkillCatalog(nativeCatalogFixture({ ...nativeSkillFixture, origin: "builtin", installation_state: "unknown", enabled: false, runtime_visible: false, failure_code: "runtime_unavailable" })).skills[0]!;
    expect(projected.installationStatus).toBe("unknown");
    expect(skillCanInstall(projected)).toBe(false);
  });
  it("retains partial inventory and pending import receipts after reopening", () => {
    const catalog = nativeCatalogFixture({ ...nativeSkillFixture, origin: "unknown", installation_state: "partial", enabled: false, runtime_visible: false });
    catalog.operations = [{ operation_id: "72e88ccb-5ad8-46b9-a79e-6c7f3e461fc4", state: "pending", skill_id: "new-skill", epoch: 1, error_code: "" }];
    const projection = parseNativeSkillCatalog(catalog);
    expect(projection.skills[0]?.nativeInstallation).toBe("partial");
    expect(projection.pendingOperations).toEqual(catalog.operations);
  });
});
