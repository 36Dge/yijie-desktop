import type { CatalogEntry, ErrorCode, Installation, Operation, Snapshot } from "./market-connectors.generated";
import type { ConnectorAction, ConnectorStatusView, ConnectorView } from "./connector-ui";

const errors: Readonly<Record<ErrorCode, string>> = {
  invalid_request: "无法识别此操作，请刷新后重试。",
  context_invalid: "当前账户状态已变化，请重新读取连接器。",
  not_found: "此连接器记录已变化，请刷新后重试。",
  request_conflict: "已有相同操作正在确认，请刷新状态。",
  not_configured: "请先完成连接器所需配置。",
  authorization_required: "请先完成此服务的授权。",
  authorization_cancelled: "连接已取消，服务未启用。",
  dependency_missing: "本地运行依赖尚未就绪，暂时不能连接。",
  provider_onboarding_required: "此服务的接入条件尚未完成，暂时不能连接。",
  permission_denied: "当前账户没有执行此操作的权限。",
  revision_conflict: "连接器状态已变化，请刷新后重新操作。",
  unsupported_capability: "当前版本尚不支持此连接方式。",
  rate_limited: "服务请求较多，请稍后重试。",
  temporarily_unavailable: "连接器服务暂不可用，请稍后重试。",
  operation_pending: "操作仍在进行，请稍后刷新状态。",
  outcome_unknown: "操作结果尚未确认，请刷新状态，不要重复操作。",
  cleanup_pending: "连接器尚未完成清理，请稍后继续确认。",
  execution_unavailable: "当前运行环境暂不支持在对话中使用连接器。",
  selection_stale: "连接已变化，请重新选择本轮使用的连接器。",
};

export function connectorErrorMessage(code: string | null | undefined): string {
  return code && Object.prototype.hasOwnProperty.call(errors, code) ? errors[code as ErrorCode] : "连接器状态暂不可用，请刷新后重试。";
}

/** Presentation of an unresolved operation; a pending receipt is a known state. */
export function connectorOperationStatus(operation: Operation | undefined, receiptNotFound = false): ConnectorStatusView {
  if (receiptNotFound) return { label: "未找到操作回执", tone: "warning" };
  if (operation?.status === "pending") {
    const labels: Record<Operation["action"], string> = {
      authorize: "正在授权，请在浏览器中完成",
      configure: "正在连接",
      enable: "正在启用",
      disable: "正在停用",
      install: "正在安装",
      uninstall: "正在卸载",
    };
    return { label: labels[operation.action], tone: "neutral" };
  }
  return { label: "操作结果待确认", tone: "warning" };
}

export function connectorCanReopen(operation: Operation | undefined, canConfigure: boolean): boolean {
  return canConfigure && operation?.status === "pending" && ["authorize", "configure"].includes(operation.action);
}

function statusFor(entry: CatalogEntry, installation: Installation | undefined, pending: boolean): ConnectorStatusView {
  if (pending) return { label: "正在提交操作", tone: "neutral" };
  const operation = installation?.activeOperation;
  if (operation?.status === "pending" || operation?.status === "unknown") return connectorOperationStatus(operation);
  if (!installation || installation.status === "removed") return entry.availability === "blocked" ? { label: "接入待完成", tone: "warning" } : { label: "未安装", tone: "neutral" };
  if (installation.status === "removing") return { label: "清理待完成", tone: "warning" };
  if (entry.availability === "blocked") return { label: "接入待完成", tone: "warning" };
  if (installation.authorizationStatus === "expired") return { label: "需要重新授权", tone: "warning" };
  if (entry.authorizationAvailable && installation.authorizationStatus === "authorized" && ["blocked", "unverified"].includes(entry.availability) && (!installation.errorCode || installation.errorCode === "provider_onboarding_required")) return { label: "已授权，工具待验证", tone: "warning" };
  if (installation.errorCode || installation.connectionStatus === "failed" || installation.authorizationStatus === "failed") return { label: "连接未完成", tone: "warning" };
  if (installation.effectiveEnabled && installation.connectionStatus === "ready") return { label: "已启用", tone: "success" };
  if (installation.authorizationStatus === "authorizing" || installation.connectionStatus === "connecting") return { label: "正在连接", tone: "neutral" };
  if (entry.authorizationAvailable && ["required", "expired", "failed"].includes(installation.authorizationStatus)) return { label: "待授权", tone: "warning" };
  if (entry.availability === "unverified") return { label: "接入待完成", tone: "warning" };
  if (installation.configurationStatus === "unconfigured" || installation.configurationStatus === "invalid") return { label: "待配置", tone: "warning" };
  if (installation.authorizationStatus === "required") return { label: "待授权", tone: "warning" };
  if (installation.connectionStatus === "unknown" || installation.configurationStatus === "unknown" || installation.authorizationStatus === "unknown") return { label: "状态待确认", tone: "warning" };
  return { label: installation.desiredEnabled ? "连接待恢复" : "未启用", tone: "neutral" };
}

function configurationLabel(entry: CatalogEntry): string {
  const unavailable = entry.availability === "blocked" || entry.availability === "unverified";
  switch (entry.authMode) {
    case "none": return "无需账号密钥。启用时检查公开商品目录与支持工具，每次调用仍需批准。";
    case "oauth": return entry.authorizationAvailable ? "点击“授权连接”后，将在浏览器中完成服务账户授权。授权完成后仍需确认支持工具与连接状态。" : "此服务使用账户授权，当前版本尚未开放授权入口。";
    case "local_oauth": return unavailable ? "此服务需要本地运行依赖和账户授权，当前版本尚未提供完整接入。" : "需要准备本地运行依赖，并完成服务账户授权。";
    case "api_key":
    case "provider_credentials":
    case "stdio_api_key": return unavailable ? "此服务需要自备凭据，当前版本尚未开放安全配置入口。请勿将密钥粘贴到对话中。" : "所需凭据通过本机安全配置入口设置，不会写入对话。";
    case "provider_gateway": return "需要先完成服务方的应用接入配置。";
    default: return "此服务的连接方式仍需确认。";
  }
}

export function connectorViews(snapshot: Snapshot, pendingIds: ReadonlySet<string> = new Set()): readonly ConnectorView[] {
  const byService = new Map(snapshot.installations.map(installation => [installation.serviceId, installation]));
  const canManage = snapshot.capabilities.includes("connector.manage");
  const canConfigure = snapshot.capabilities.includes("connector.credentials.manage");
  const canUse = snapshot.capabilities.includes("connector.use");
  return snapshot.catalog.map(entry => {
    const installation = byService.get(entry.serviceId);
    const installed = Boolean(installation && installation.status !== "removed");
    const operation = installation?.activeOperation;
    const pending = pendingIds.has(entry.serviceId);
    const operationPending = operation?.status === "pending" || operation?.status === "unknown";
    const busy = pending || operationPending;
    const enabled = entry.availability !== "blocked" && installed && installation?.effectiveEnabled === true;
    const actions: ConnectorAction[] = [];
    if (!pending && operationPending) {
      actions.push("retry");
      const canCancel = operation && ["configure", "authorize"].includes(operation.action) ? canConfigure : canManage;
      if (canCancel && operation?.cancellable) actions.push("cancel");
      if (connectorCanReopen(operation, canConfigure)) actions.push("reopen");
    } else if (!busy) {
      if (!installed && canManage && entry.availability !== "blocked") actions.push("install");
      else if (installation && installation.status !== "removing") {
        if (canManage) actions.push("uninstall");
        if ((enabled || installation.desiredEnabled) && canManage) actions.push("disable");
        // Native separately reports support for beginning OAuth. An unverified
        // tool catalog must not hide account authorization, and authorization
        // must not grant enablement or execution qualification.
        if (entry.authorizationAvailable === true && canConfigure && ["required", "expired", "failed", "unknown"].includes(installation.authorizationStatus)) {
          actions.push("authorize");
        } else if (!enabled && entry.availability !== "blocked" && entry.availability !== "unverified") {
          if (installation.configurationStatus !== "configured" && canConfigure) actions.push("configure");
          else if (["authorized", "not_required"].includes(installation.authorizationStatus) && canManage) actions.push("enable");
        }
      }
    }
    if (!pending && installation?.status === "removing") actions.push("retry");
    const issue = installation?.errorCode ?? operation?.errorCode ?? entry.blockerCodes[0];
    const explanation = issue === "provider_onboarding_required" && entry.authorizationAvailable === true
      ? installation?.authorizationStatus === "authorized"
        ? "账户授权已完成；支持工具尚待验证，暂不能启用或用于对话。"
        : "可先完成账户授权；支持工具尚待验证，暂不能启用或用于对话。"
      : issue ? connectorErrorMessage(issue) : null;
    return {
      id: entry.serviceId, name: entry.displayName, description: entry.description || `连接${entry.displayName}，在对话中使用其服务能力。`,
      iconAssetId: entry.iconAssetId, categoryId: entry.categoryId, categoryLabel: entry.categoryLabel,
      installed, enabled,
      selectable: enabled && installation?.connectionStatus === "ready" && canUse && snapshot.executionAvailable && !busy,
      status: statusFor(entry, installation, pending),
      explanation,
      configurationLabel: operation?.action === "enable" && operation.status === "pending"
        ? "正在检查连接与支持工具，请等待本次启用结果。"
        : entry.authMode === "oauth" && installation?.authorizationStatus === "authorized"
          ? "已保存账户授权；启用时会重新确认连接和支持工具。"
          : configurationLabel(entry), busy, actions,
    };
  });
}
