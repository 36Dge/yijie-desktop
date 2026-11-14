import type { Catalog, Skill } from "../domain/skill-market-v2.generated";

export const nativeSkillFixture: Skill = {
  id: "ordinary-skill", version: "1.0.0", runtime_name: "yj-user-ordinary:copywriting",
  display_name: "普通技能", description: "处理普通本地文本。", category: "personal", order: 0, icon_key: "skill",
  origin: "user", installation_state: "installed", enabled: true, runtime_visible: true, retired: false,
  dependency_state: "unknown", required_tools: [], epoch: 2, failure_code: "",
};
export function nativeCatalogFixture(skill: Skill = nativeSkillFixture): Catalog {
  return { schema_version: 2, revision: "a".repeat(64), skills: [skill], operations: [] };
}
