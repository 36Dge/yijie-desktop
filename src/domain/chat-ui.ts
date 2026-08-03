import type {
  ChatCleanupStatus,
  ChatErrorCode,
  ChatHistoryTurn,
  ChatLocalReadiness,
  ChatReasoningStatus,
} from "./chat-ipc";

export const CHAT_FOLLOW_THRESHOLD_PX = 48;
export const CHAT_BOTTOM_BUTTON_THRESHOLD_PX = 160;
export const CHAT_INPUT_MAX_BYTES = 64 * 1024;

export type ChatUiTone = "neutral" | "success" | "warning" | "error";

export interface ChatUiNotice {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string | null;
  readonly tone: ChatUiTone;
}

const READINESS_NOTICES: Readonly<Record<NonNullable<ChatLocalReadiness["issueCode"]>, ChatUiNotice>> = {
  chat_host_starting: {
    title: "正在启动本地服务",
    detail: "服务就绪后即可发送任务。",
    actionLabel: null,
    tone: "neutral",
  },
  chat_host_unavailable: {
    title: "本地服务暂不可用",
    detail: "请重试启动本地服务。",
    actionLabel: "重试启动",
    tone: "warning",
  },
  chat_runtime_starting: {
    title: "正在启动模型运行环境",
    detail: "运行环境就绪后即可发送任务。",
    actionLabel: null,
    tone: "neutral",
  },
  chat_runtime_unavailable: {
    title: "模型运行环境暂不可用",
    detail: "请重试启动；如果问题持续，请重新启动应用。",
    actionLabel: "重试启动",
    tone: "warning",
  },
  chat_runtime_version_mismatch: {
    title: "本地运行版本不兼容",
    detail: "请重新启动应用并确认本地组件版本一致。",
    actionLabel: "重新检查",
    tone: "error",
  },
  chat_storage_read_only: {
    title: "本地对话数据库为只读",
    detail: "当前可以查看历史，但不能创建或继续任务。",
    actionLabel: "重新检查",
    tone: "warning",
  },
  chat_storage_full: {
    title: "本机存储空间不足",
    detail: "释放磁盘空间后重新检查。",
    actionLabel: "重新检查",
    tone: "error",
  },
  chat_storage_corrupt: {
    title: "本地对话数据库无法读取",
    detail: "请停止操作并从可信备份恢复；应用不会自动破坏性修复。",
    actionLabel: null,
    tone: "error",
  },
  chat_storage_migration_failed: {
    title: "本地数据升级失败",
    detail: "请重新启动应用；问题持续时保留数据并联系支持。",
    actionLabel: null,
    tone: "error",
  },
  chat_storage_unavailable: {
    title: "本地对话存储暂不可用",
    detail: "请重新启动应用后再试。",
    actionLabel: "重新检查",
    tone: "error",
  },
};

const ERROR_NOTICES: Readonly<Record<ChatErrorCode, ChatUiNotice>> = {
  chat_unauthenticated: {
    title: "登录状态已失效",
    detail: "请重新登录后继续。",
    actionLabel: null,
    tone: "warning",
  },
  chat_context_invalid: {
    title: "权限上下文已更新",
    detail: "正在重新连接当前工作区。",
    actionLabel: "重新加载",
    tone: "warning",
  },
  chat_capability_denied: {
    title: "当前账号无权执行此操作",
    detail: "请确认当前租户权限后再试。",
    actionLabel: null,
    tone: "error",
  },
  chat_resource_not_found: {
    title: "任务不可用",
    detail: "任务可能已删除，或不属于当前工作区。",
    actionLabel: "返回新建任务",
    tone: "warning",
  },
  chat_project_invalid: {
    title: "项目不可用",
    detail: "请重新选择一个可访问的本地项目。",
    actionLabel: "重新选择项目",
    tone: "warning",
  },
  chat_cursor_invalid: {
    title: "历史位置已失效",
    detail: "列表将从最新状态重新加载。",
    actionLabel: "重新加载",
    tone: "warning",
  },
  chat_request_invalid: {
    title: "提交内容不符合要求",
    detail: "请检查文本长度后重试。",
    actionLabel: null,
    tone: "warning",
  },
  chat_request_cancelled: {
    title: "请求已取消",
    detail: "当前页面未保存这次读取结果。",
    actionLabel: null,
    tone: "neutral",
  },
  chat_conflict: {
    title: "任务状态已变化",
    detail: "请重新加载最新状态后再操作。",
    actionLabel: "重新加载",
    tone: "warning",
  },
  chat_turn_active: {
    title: "当前任务仍在生成",
    detail: "请等待完成或先停止当前生成。",
    actionLabel: null,
    tone: "warning",
  },
  chat_host_not_ready: {
    title: "本地服务尚未就绪",
    detail: "请等待服务启动完成后再试。",
    actionLabel: "重试启动",
    tone: "warning",
  },
  chat_storage_unavailable: {
    title: "本地存储暂不可用",
    detail: "请保留当前输入并重新检查存储状态。",
    actionLabel: "重新检查",
    tone: "error",
  },
  chat_protocol_error: {
    title: "本地组件状态不一致",
    detail: "应用将重新同步当前任务。",
    actionLabel: "重新同步",
    tone: "error",
  },
  chat_limit_exceeded: {
    title: "内容超过本次限制",
    detail: "请缩短输入后再试。",
    actionLabel: null,
    tone: "warning",
  },
  chat_cleanup_incomplete: {
    title: "任务删除尚未完成",
    detail: "部分本地清理仍在等待，请稍后重新检查。",
    actionLabel: "检查删除状态",
    tone: "warning",
  },
  chat_temporarily_unavailable: {
    title: "本地服务暂时繁忙",
    detail: "请稍后重试。",
    actionLabel: "重试",
    tone: "warning",
  },
};

export function readinessNotice(readiness: ChatLocalReadiness | null): ChatUiNotice {
  if (readiness === null) {
    return {
      title: "正在检查本地运行环境",
      detail: "完成安全检查后即可发送任务。",
      actionLabel: null,
      tone: "neutral",
    };
  }
  if (readiness.canSend && readiness.issueCode === null) {
    return {
      title: "本地运行环境已就绪",
      detail: "项目内容保持在本机，当前仅允许只读访问。",
      actionLabel: null,
      tone: "success",
    };
  }
  return readiness.issueCode === null
    ? {
        title: "本地运行环境尚未就绪",
        detail: "请稍后重新检查。",
        actionLabel: "重新检查",
        tone: "warning",
      }
    : READINESS_NOTICES[readiness.issueCode];
}

export function errorNotice(code: string | null): ChatUiNotice | null {
  if (code === null || !(code in ERROR_NOTICES)) return null;
  return ERROR_NOTICES[code as ChatErrorCode];
}

export function inputByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function inputValidationMessage(value: string): string | null {
  if (value.trim().length === 0) return "请输入任务需求";
  if (inputByteLength(value) > CHAT_INPUT_MAX_BYTES) return "输入内容过长，请缩短后再发送";
  return null;
}

export function turnStatusLabel(status: string | null): string {
  switch (status) {
    case "pending": return "等待处理";
    case "streaming":
    case "in_progress": return "正在生成";
    case "completed": return "已完成";
    case "interrupted": return "已停止";
    case "failed": return "生成失败";
    default: return status ? "状态已更新" : "";
  }
}

export function reasoningStatusLabel(status: ChatReasoningStatus, reasonCode: string | null): string {
  if (status === "complete") return "推理记录已完成";
  if (status === "incomplete") {
    return reasonCode === "interrupted" ? "推理记录因停止而不完整" : "推理记录不完整";
  }
  return "推理记录不可用";
}

export function cleanupNotice(status: ChatCleanupStatus | null): ChatUiNotice | null {
  if (status === null) return null;
  const states = [status.desktopState, status.hostState, status.runtimeState];
  if (states.every((state) => state === "complete")) {
    return {
      title: "任务已永久删除",
      detail: "本地对话、Host 映射与 Runtime thread 已完成清理。",
      actionLabel: null,
      tone: "success",
    };
  }
  if (states.some((state) => state === "incomplete")) {
    return {
      title: "任务删除尚未完成",
      detail: "部分本地清理失败，应用会保留状态以便重试。",
      actionLabel: "检查删除状态",
      tone: "error",
    };
  }
  return {
    title: "正在永久删除任务",
    detail: "请保持应用运行，完成前不会显示删除成功。",
    actionLabel: "检查删除状态",
    tone: "warning",
  };
}

export function sortHistoryTurns(turns: readonly ChatHistoryTurn[]): readonly ChatHistoryTurn[] {
  return [...turns].sort((left, right) => {
    const leftOrdinal = Math.min(...left.messages.map((message) => message.ordinal), Number.MAX_SAFE_INTEGER);
    const rightOrdinal = Math.min(...right.messages.map((message) => message.ordinal), Number.MAX_SAFE_INTEGER);
    return leftOrdinal - rightOrdinal || left.turnId.localeCompare(right.turnId);
  });
}
