import type { ManagedSkillProjection } from "../domain/skill-marketplace";

export const installedSkill: ManagedSkillProjection = {
  id: "yijie.content-marketing.copywriting", runtimeName: "copywriting", displayName: "跨境营销文案", description: "根据已确认的商品事实和受众生成文案。",
  category: "content-marketing", order: 0, version: "0.1.0", iconKey: "edit",
  riskLevel: "low", riskReasons: ["普通合成展示资料"], sourceType: "internal", licenseExpression: "LicenseRef-YiJie-Local-Development-Only",
  executionMode: "model-only", networkAccess: "none", filesystemAccess: "none", requiredTools: [],
  catalogStatus: "installable", catalogBlockedReason: null, maintenanceStatus: "maintained",
  capabilityReadiness: "ready", installationStatus: "installed", enabled: true, runtimeVisible: true, failureCode: "",
};
