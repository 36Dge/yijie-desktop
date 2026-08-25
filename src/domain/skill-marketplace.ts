export const SKILL_CATEGORIES = [
  { key: "sourcing-selection", label: "货源与选品" },
  { key: "market-research", label: "市场调研与分析" },
  { key: "content-marketing", label: "内容创作与营销" },
  { key: "traffic-advertising", label: "流量获取与广告" },
  { key: "store-operations", label: "店铺运营与基建" },
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]["key"];
export type SkillRiskLevel = "low" | "medium" | "high" | "critical" | "unknown";
export type SkillSourceType = "internal" | "partner" | "third-party" | "unknown";
export type SkillExecutionMode = "model-only" | "tool-assisted" | "unknown";
export type SkillNetworkAccess = "none" | "optional" | "required" | "unknown";
export type SkillFilesystemAccess = "none" | "read" | "write" | "unknown";
export type SkillCatalogStatus = "installable" | "blocked" | "unknown";
export type SkillCatalogBlockedReason =
  | "source_unverified"
  | "license_unverified"
  | "distribution_not_authorized"
  | "security_review_pending"
  | "capability_unavailable"
  | "maintenance_ended"
  | "unknown";
export type SkillMaintenanceStatus = "maintained" | "unmaintained" | "unknown";
export type SkillCapabilityReadiness = "ready" | "degraded" | "blocked" | "unknown";
export type SkillInstallationStatus =
  | "not_installed"
  | "installing"
  | "installed"
  | "uninstalling"
  | "error"
  | "unknown";
export type SkillFailureCode =
  | ""
  | "bundle_missing"
  | "bundle_manifest_invalid"
  | "archive_checksum_mismatch"
  | "archive_unsafe"
  | "archive_too_large"
  | "install_receipt_invalid"
  | "installed_files_missing"
  | "installed_files_corrupt"
  | "capability_unavailable"
  | "runtime_unavailable"
  | "runtime_sync_failed"
  | "install_failed"
  | "uninstall_failed"
  | "scan_failed"
  | "unknown";

export interface ManagedSkillProjection {
  readonly id: string;
  readonly runtimeName: string;
  readonly category: SkillCategory;
  readonly order: number;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly iconKey: string;
  readonly riskLevel: SkillRiskLevel;
  readonly riskReasons: readonly string[];
  readonly sourceType: SkillSourceType;
  readonly licenseExpression: string;
  readonly executionMode: SkillExecutionMode;
  readonly networkAccess: SkillNetworkAccess;
  readonly filesystemAccess: SkillFilesystemAccess;
  readonly requiredTools: readonly string[];
  readonly catalogStatus: SkillCatalogStatus;
  readonly catalogBlockedReason: SkillCatalogBlockedReason | null;
  readonly maintenanceStatus: SkillMaintenanceStatus;
  readonly capabilityReadiness: SkillCapabilityReadiness;
  readonly installationStatus: SkillInstallationStatus;
  readonly enabled: boolean;
  readonly runtimeVisible: boolean;
  readonly failureCode: SkillFailureCode;
}

export interface SkillCatalogSnapshot {
  readonly schemaVersion: 1;
  readonly scannedAt: string;
  readonly skills: readonly ManagedSkillProjection[];
}

export interface SkillCategoryProjection {
  readonly key: SkillCategory;
  readonly label: string;
  readonly skills: readonly ManagedSkillProjection[];
}

export class SkillProjectionError extends Error {
  constructor(readonly field: string) {
    super("skill-native-projection-invalid");
    this.name = "SkillProjectionError";
  }
}

const SKILL_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const RUNTIME_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMANTIC_VERSION =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ICON_KEY = /^[a-z][A-Za-z0-9]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:[./-][a-z0-9_]+)*$/;
const CATEGORY_SET = new Set<string>(SKILL_CATEGORIES.map((category) => category.key));
const MAX_SKILLS = 256;
const MAX_VISITED_VALUES = 8192;
const SNAPSHOT_FIELDS = new Set(["schemaVersion", "scannedAt", "skills"]);
const SKILL_FIELDS = new Set([
  "id",
  "runtimeName",
  "category",
  "order",
  "displayName",
  "description",
  "version",
  "iconKey",
  "riskLevel",
  "riskReasons",
  "sourceType",
  "licenseExpression",
  "executionMode",
  "networkAccess",
  "filesystemAccess",
  "requiredTools",
  "catalogStatus",
  "catalogBlockedReason",
  "maintenanceStatus",
  "capabilityReadiness",
  "installationStatus",
  "enabled",
  "runtimeVisible",
  "failureCode",
]);

const FORBIDDEN_NATIVE_KEYS = new Set([
  "archive",
  "archivebytes",
  "archivesha256",
  "bearer",
  "catalogrevision",
  "digest",
  "evidencereference",
  "path",
  "root",
  "sha256",
  "skillcontent",
  "sourcereference",
  "token",
]);

const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const SOURCE_TYPES = ["internal", "partner", "third-party"] as const;
const EXECUTION_MODES = ["model-only", "tool-assisted"] as const;
const NETWORK_ACCESS = ["none", "optional", "required"] as const;
const FILESYSTEM_ACCESS = ["none", "read", "write"] as const;
const CATALOG_STATUSES = ["installable", "blocked"] as const;
const CATALOG_BLOCKED_REASONS = [
  "source_unverified",
  "license_unverified",
  "distribution_not_authorized",
  "security_review_pending",
  "capability_unavailable",
  "maintenance_ended",
] as const;
const MAINTENANCE_STATUSES = ["maintained", "unmaintained"] as const;
const CAPABILITY_READINESS = ["ready", "degraded", "blocked"] as const;
const INSTALLATION_STATUSES = [
  "not_installed",
  "installing",
  "installed",
  "uninstalling",
  "error",
] as const;
const FAILURE_CODES = [
  "",
  "bundle_missing",
  "bundle_manifest_invalid",
  "archive_checksum_mismatch",
  "archive_unsafe",
  "archive_too_large",
  "install_receipt_invalid",
  "installed_files_missing",
  "installed_files_corrupt",
  "capability_unavailable",
  "runtime_unavailable",
  "runtime_sync_failed",
  "install_failed",
  "uninstall_failed",
  "scan_failed",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function containsForbiddenNativeKey(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > MAX_VISITED_VALUES) return true;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, nested] of Object.entries(current)) {
      if (FORBIDDEN_NATIVE_KEYS.has(normalizedKey(key))) return true;
      pending.push(nested);
    }
  }
  return false;
}

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => fields.has(key));
}

function boundedString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new SkillProjectionError(field);
  }
  return value;
}

function boundedStringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumLength: number,
  pattern?: RegExp,
  minimumItems = 0,
): readonly string[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
    throw new SkillProjectionError(field);
  }
  const result = value.map((item) =>
    boundedString(item, field, 1, maximumLength, pattern),
  );
  if (new Set(result).size !== result.length) throw new SkillProjectionError(field);
  return Object.freeze(result);
}

function openEnum<const Values extends readonly string[]>(
  value: unknown,
  field: string,
  values: Values,
): Values[number] | "unknown" {
  if (typeof value !== "string" || value.length > 64) {
    throw new SkillProjectionError(field);
  }
  return values.includes(value) ? value as Values[number] : "unknown";
}

function parseCategory(value: unknown): SkillCategory {
  if (typeof value !== "string" || !CATEGORY_SET.has(value)) {
    throw new SkillProjectionError("category");
  }
  return value as SkillCategory;
}

function parseSkill(value: unknown): ManagedSkillProjection {
  if (!isRecord(value) || !hasOnlyFields(value, SKILL_FIELDS)) {
    throw new SkillProjectionError("skills");
  }
  const installationStatus = openEnum(
    value.installationStatus,
    "installationStatus",
    INSTALLATION_STATUSES,
  );
  const capabilityReadiness = openEnum(
    value.capabilityReadiness,
    "capabilityReadiness",
    CAPABILITY_READINESS,
  );
  const catalogStatus = openEnum(value.catalogStatus, "catalogStatus", CATALOG_STATUSES);
  const catalogBlockedReason = value.catalogBlockedReason === undefined || value.catalogBlockedReason === null
    ? null
    : openEnum(
      value.catalogBlockedReason,
      "catalogBlockedReason",
      CATALOG_BLOCKED_REASONS,
    );
  if (
    (catalogStatus === "blocked" && catalogBlockedReason === null) ||
    (catalogStatus !== "blocked" && catalogBlockedReason !== null)
  ) {
    throw new SkillProjectionError("catalogBlockedReason");
  }
  if (typeof value.enabled !== "boolean" || typeof value.runtimeVisible !== "boolean") {
    throw new SkillProjectionError("visibility");
  }
  if (
    (installationStatus === "not_installed" && (value.enabled || value.runtimeVisible)) ||
    (value.runtimeVisible && (
      !value.enabled ||
      installationStatus !== "installed" ||
      (capabilityReadiness !== "ready" && capabilityReadiness !== "degraded")
    ))
  ) {
    throw new SkillProjectionError("visibility");
  }

  const order = value.order;
  if (!Number.isSafeInteger(order) || (order as number) < 0 || (order as number) > 10_000) {
    throw new SkillProjectionError("order");
  }

  return Object.freeze({
    id: boundedString(value.id, "id", 3, 128, SKILL_ID),
    runtimeName: boundedString(value.runtimeName, "runtimeName", 1, 64, RUNTIME_NAME),
    category: parseCategory(value.category),
    order: order as number,
    displayName: boundedString(value.displayName, "displayName", 1, 80),
    description: boundedString(value.description, "description", 1, 240),
    version: boundedString(value.version, "version", 5, 128, SEMANTIC_VERSION),
    iconKey: boundedString(value.iconKey, "iconKey", 1, 64, ICON_KEY),
    riskLevel: openEnum(value.riskLevel, "riskLevel", RISK_LEVELS),
    riskReasons: boundedStringArray(value.riskReasons, "riskReasons", 8, 160, undefined, 1),
    sourceType: openEnum(value.sourceType, "sourceType", SOURCE_TYPES),
    licenseExpression: boundedString(value.licenseExpression, "licenseExpression", 1, 128),
    executionMode: openEnum(value.executionMode, "executionMode", EXECUTION_MODES),
    networkAccess: openEnum(value.networkAccess, "networkAccess", NETWORK_ACCESS),
    filesystemAccess: openEnum(
      value.filesystemAccess,
      "filesystemAccess",
      FILESYSTEM_ACCESS,
    ),
    requiredTools: boundedStringArray(value.requiredTools, "requiredTools", 32, 128, TOOL_NAME),
    catalogStatus,
    catalogBlockedReason,
    maintenanceStatus: openEnum(
      value.maintenanceStatus,
      "maintenanceStatus",
      MAINTENANCE_STATUSES,
    ),
    capabilityReadiness,
    installationStatus,
    enabled: value.enabled,
    runtimeVisible: value.runtimeVisible,
    failureCode: openEnum(value.failureCode, "failureCode", FAILURE_CODES),
  });
}

export function parseSkillCatalogSnapshot(value: unknown): SkillCatalogSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, SNAPSHOT_FIELDS) ||
    containsForbiddenNativeKey(value)
  ) {
    throw new SkillProjectionError("response");
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.skills) || value.skills.length > MAX_SKILLS) {
    throw new SkillProjectionError("schemaVersion");
  }
  const scannedAt = boundedString(value.scannedAt, "scannedAt", 20, 64);
  if (!Number.isFinite(Date.parse(scannedAt))) throw new SkillProjectionError("scannedAt");

  const skills = value.skills.map(parseSkill);
  const ids = new Set<string>();
  const runtimeNames = new Set<string>();
  for (const skill of skills) {
    if (ids.has(skill.id) || runtimeNames.has(skill.runtimeName)) {
      throw new SkillProjectionError("skills");
    }
    ids.add(skill.id);
    runtimeNames.add(skill.runtimeName);
  }

  skills.sort((left, right) =>
    left.order - right.order ||
    left.displayName.localeCompare(right.displayName, "zh-CN") ||
    left.id.localeCompare(right.id),
  );
  return Object.freeze({
    schemaVersion: 1,
    scannedAt: new Date(scannedAt).toISOString(),
    skills: Object.freeze(skills),
  });
}

export function projectSkillCategories(
  skills: readonly ManagedSkillProjection[],
): readonly SkillCategoryProjection[] {
  return Object.freeze(SKILL_CATEGORIES.map((category) => Object.freeze({
    ...category,
    skills: Object.freeze(skills.filter((skill) => skill.category === category.key)),
  })));
}

export function skillSourceLabel(sourceType: SkillSourceType): string {
  switch (sourceType) {
    case "internal":
      return "易界内部";
    case "partner":
      return "合作方";
    case "third-party":
      return "第三方";
    case "unknown":
      return "来源待确认";
  }
}

export function skillRiskLabel(level: SkillRiskLevel): string {
  switch (level) {
    case "low":
      return "低风险";
    case "medium":
      return "中风险";
    case "high":
      return "高风险";
    case "critical":
      return "关键风险";
    case "unknown":
      return "风险信息待确认";
  }
}

export function skillCapabilitySummary(skill: ManagedSkillProjection): string {
  if (
    skill.executionMode === "model-only" &&
    skill.networkAccess === "none" &&
    skill.filesystemAccess === "none" &&
    skill.requiredTools.length === 0
  ) {
    return "模型内执行，不访问网络或本地文件";
  }
  if (
    skill.executionMode === "unknown" ||
    skill.networkAccess === "unknown" ||
    skill.filesystemAccess === "unknown"
  ) {
    return "能力依赖信息不兼容";
  }
  const requirements: string[] = [];
  if (skill.networkAccess !== "none") requirements.push("需要网络");
  if (skill.filesystemAccess !== "none") requirements.push("需要文件访问");
  if (skill.requiredTools.length > 0) requirements.push(`需要 ${skill.requiredTools.length} 项工具`);
  return requirements.length > 0 ? requirements.join("，") : "模型与工具协同执行";
}

export function skillCanInstall(skill: ManagedSkillProjection): boolean {
  return (
    skill.catalogStatus === "installable" &&
    (skill.capabilityReadiness === "ready" || skill.capabilityReadiness === "degraded") &&
    skill.executionMode !== "unknown" &&
    skill.networkAccess !== "unknown" &&
    skill.filesystemAccess !== "unknown" &&
    (skill.installationStatus === "not_installed" || skill.installationStatus === "error")
  );
}

export function skillCatalogBlockedReasonLabel(
  reason: SkillCatalogBlockedReason | null,
): string | null {
  switch (reason) {
    case null:
      return null;
    case "source_unverified":
      return "来源尚未通过审核，暂不可安装。";
    case "license_unverified":
      return "许可尚未通过审核，暂不可安装。";
    case "distribution_not_authorized":
      return "尚未取得桌面分发授权，暂不可安装。";
    case "security_review_pending":
      return "安全审核尚未完成，暂不可安装。";
    case "capability_unavailable":
      return "所需能力当前不可用，暂不可安装。";
    case "maintenance_ended":
      return "此 Skill 已停止维护，暂不可安装。";
    case "unknown":
      return "暂不可安装；请升级客户端以查看最新审核信息。";
  }
}

export function skillFailureMessage(code: SkillFailureCode): string | null {
  switch (code) {
    case "":
      return null;
    case "bundle_missing":
      return "内置 Skill 资源缺失，请重新安装或升级客户端。";
    case "bundle_manifest_invalid":
      return "Skill 清单未通过校验，请升级客户端后重试。";
    case "archive_checksum_mismatch":
      return "Skill 资源完整性校验失败，未执行安装。";
    case "archive_unsafe":
      return "Skill 资源未通过路径安全校验，未执行安装。";
    case "archive_too_large":
      return "Skill 资源超出安全限制，未执行安装。";
    case "install_receipt_invalid":
    case "installed_files_corrupt":
      return "本地 Skill 文件已损坏，请重新安装。";
    case "installed_files_missing":
      return "本地 Skill 文件已被移动或删除，请重新安装。";
    case "capability_unavailable":
      return "此 Skill 所需能力暂未就绪。";
    case "runtime_unavailable":
    case "runtime_sync_failed":
      return "模型运行服务暂未同步，请稍后重试。";
    case "install_failed":
      return "Skill 安装失败，未保留不完整文件。";
    case "uninstall_failed":
      return "Skill 卸载失败，本地状态保持不变。";
    case "scan_failed":
      return "本地 Skill 状态扫描失败，请重新扫描。";
    case "unknown":
      return "Skill 状态暂不兼容，请升级客户端后重试。";
  }
}
