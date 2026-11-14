import { validateSkillMarketCatalog, validateSkillMarketOperation } from "../api/generated/skill-market-v2-validator.gen";
import type { Catalog, Operation, PendingOperation, Skill } from "./skill-market-v2.generated";
import { SKILL_CATEGORIES, SkillProjectionError, type ManagedSkillProjection, type SkillCatalogSnapshot, type SkillCategory } from "./skill-marketplace";

export function parseNativeSkillOperation(value: unknown): Operation {
  if (!validateSkillMarketOperation(value)) throw new SkillProjectionError("operation");
  return value as Operation;
}
function project(skill: Skill): ManagedSkillProjection {
  const category = SKILL_CATEGORIES.some(item => item.key === skill.category) ? skill.category as SkillCategory : "personal";
  return Object.freeze({
    id: skill.id, runtimeName: skill.runtime_name, category, order: skill.order,
    displayName: skill.display_name, description: skill.description, version: skill.version,
    iconKey: skill.icon_key, riskLevel: "unknown", riskReasons: [], sourceType: skill.origin === "builtin" ? "internal" : "unknown",
    licenseExpression: "", executionMode: "unknown", networkAccess: "unknown", filesystemAccess: "unknown",
    requiredTools: Object.freeze([...skill.required_tools]), catalogStatus: "installable", catalogBlockedReason: null,
    maintenanceStatus: skill.retired ? "unmaintained" : "maintained", capabilityReadiness: skill.dependency_state === "ready" ? "ready" : "degraded",
    installationStatus: skill.installation_state === "partial" || skill.installation_state === "invalid" ? "error" : skill.installation_state,
    enabled: skill.enabled, runtimeVisible: skill.runtime_visible, failureCode: "",
    nativeEpoch: skill.epoch, nativeOrigin: skill.origin, nativeInstallation: skill.installation_state,
    nativeFailureCode: skill.failure_code, retired: skill.retired, dependencyState: skill.dependency_state,
  });
}
export function parseNativeSkillCatalog(value: unknown): SkillCatalogSnapshot {
  if (!validateSkillMarketCatalog(value)) throw new SkillProjectionError("catalog");
  const catalog = value as Catalog;
  const ids = new Set(catalog.skills.map(skill => skill.id));
  if (ids.size !== catalog.skills.length) throw new SkillProjectionError("identity");
  return Object.freeze({ schemaVersion: 2, scannedAt: new Date().toISOString(), skills: Object.freeze(catalog.skills.map(project)), pendingOperations: Object.freeze(catalog.operations), notice: catalog.notice });
}
export type SkillPendingOperation = PendingOperation;

export function nativeSkillFailureMessage(code: string): string {
  switch (code) {
    case "runtime_unavailable": return "安装状态尚未同步，服务恢复后请刷新。";
    case "compatibility_mode": return "技能已回退到兼容模式，可以继续使用；恢复原生模式后可继续管理。";
    case "import_format_invalid": return "请选择 ZIP 技能包或名为 SKILL.md 的文件。";
    case "import_too_large": return "技能包最多 64 MB，单个 SKILL.md 最多 1 MB。";
    case "import_multiple_skills": return "每次导入一个技能，请拆分后重新选择。";
    case "import_entrypoint_missing": return "技能包中没有找到 SKILL.md，请检查后重新选择。";
    case "native_preflight_failed": return "技能内容未通过解析，请检查名称和描述后重新导入。";
    case "import_plugin_unsupported": return "请选择技能包；此处不导入插件、MCP 或钩子配置。";
    case "migration_rule_scope_unresolved": case "migration_rule_unresolved": case "migration_config_conflict": case "migration_user_intent_changed": return "已有技能的规则或状态需要检查，旧内容已保留；确认后可恢复迁移。";
    case "source_reselection_required": return "文件暂存尚未完成，请取消本次操作后重新选择文件。";
    case "skill_inventory_full": return "技能来源数量已达本地上限，请先整理已有来源。";
    case "skill_migration_pending": return "正在核对已有技能，完成后即可管理；原有内容已保留。";
    case "skill_epoch_conflict": case "operation_conflict": return "技能状态已变化，请刷新后重试。";
    case "source_unavailable": case "source_version_unresolved": return "技能来源暂不可用，已有安装和历史记录已保留。";
    case "skill_busy": return "技能正被任务使用，任务结束后会继续处理。";
    case "operation_pending": case "reconciliation_pending": case "skill_import_outcome_unknown": return "正在确认操作结果，可稍后刷新或取消。";
    case "cancel_too_late": return "卸载已完成，无法撤回；可以重新添加技能。";
    default: return "操作尚未完成，请刷新状态或取消后重试。";
  }
}
