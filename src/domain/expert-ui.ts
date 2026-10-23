import type { ErrorCode, ExpertSelection, ResourceOperation, ResourceState } from "./experts.generated";

/** Project display objects onto the source-defined closed request identity. */
export function expertSelection(expert: ExpertSelection): ExpertSelection {
  return { expertId: expert.expertId, version: expert.version };
}

export function expertErrorMessage(code: ErrorCode): string {
  switch (code) {
    case "permission_denied": return "当前身份没有所需权限。";
    case "context_invalid": return "当前身份已变化，请重新读取。";
    case "outcome_unknown":
    case "operation_pending": return "操作结果待确认，请查询原操作状态。";
    case "resource_in_use": return "此版本仍被会话或待发送任务引用，暂不可移除。";
    case "revision_conflict":
    case "selection_stale": return "状态已变化，请重新读取后选择。";
    case "busy":
    case "approval_pending": return "请等待当前任务和审批结束后再操作。";
    case "qualification_required":
    case "unsupported_capability": return "当前客户端尚未接通专家服务，暂不可用。";
    case "not_found":
    case "version_unavailable": return "此专家版本当前不可用，请重新读取。";
    case "temporarily_unavailable": return "专家服务暂不可用，请重新读取。";
    default: return "专家操作未完成，请重新读取状态。";
  }
}

export function expertResourceOperationMessage(operation: ResourceOperation): string | null {
  if (operation.state === "rejected" && operation.errorCode === "request_conflict") return "原操作已结束，可重新准备或移除资源。";
  if (operation.errorCode) return expertErrorMessage(operation.errorCode);
  return ["pending", "unknown"].includes(operation.state) ? expertErrorMessage("outcome_unknown") : null;
}

export const expertResourceLabels: Readonly<Record<ResourceState, string>> = {
  available: "待准备", preparing: "正在准备", ready: "资源已准备", unavailable: "暂不可用", incompatible: "版本不兼容",
};

export const defaultExpertDeveloper = "易界 AI";
