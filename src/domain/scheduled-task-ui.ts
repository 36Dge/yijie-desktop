import type { TimeRule, TargetMode, PlanState } from "./scheduled-plan.generated";
import type { IpcErrorCode, RecordView, PauseReason, Timing } from "../api/generated/scheduled-task-ipc.gen";

export const stateLabels: Record<PlanState, string> = { paused: "已暂停", enabled: "已开启", completed: "已完成", deleted: "已删除" };
export const targetLabels: Record<TargetMode, string> = { dedicated_chat: "专属聊天", new_chat_each_run: "每次新建聊天", existing_chat: "已有聊天" };
export const frequencyLabels = { once: "仅一次", daily: "每天", weekdays: "工作日", weekly: "每周" };
export const stateOptions = [{ label: "全部状态", value: "all" }, { label: "已开启", value: "enabled" }, { label: "已暂停", value: "paused" }, { label: "已完成", value: "completed" }];
export function timeLabel(value?: number, zone?: string): string {
  if (value === undefined) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", ...(zone ? { timeZone: zone } : {}) }).format(value * 1000);
}
export function executionTimeLabel(timing: Timing): string {
  if (timing.execution_time === "not_started") return "未开始";
  if (timing.execution_time !== "known" || timing.started_at === undefined || !Number.isSafeInteger(timing.started_at)) return "未知";
  const date = new Date(timing.started_at * 1000);
  if (!Number.isFinite(date.getTime())) return "未知";
  const format = (timeZone: string) => new Intl.DateTimeFormat("zh-CN", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).format(date);
  try { return `${format(timing.time_zone ?? "UTC")}（${timing.time_zone ?? "UTC"}）`; }
  catch { return `${format("UTC")}（UTC，原时区不可用）`; }
}
export function durationLabel(timing: Timing): string {
  if (timing.duration === "not_started") return "未开始";
  if (timing.duration === "in_progress") return "尚未结束";
  const ms = timing.duration_ms;
  if (timing.duration !== "known" || ms === undefined || !Number.isSafeInteger(ms) || ms < 0) return "未知";
  const seconds = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format((ms % 60000) / 1000);
  const minutes = Math.floor(ms / 60000);
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}
export function timingNote(timing: Timing): string {
  if (timing.diagnostic === "source_conflict") return "时间来源存在冲突，受影响字段暂显示未知；运行结果保持原记录。";
  if (timing.diagnostic === "field_invalid" || timing.diagnostic === "format_unsupported" || timing.diagnostic === "identity_mismatch") return "部分时间事实暂不可用，未使用计划时间或本机时间替代。";
  if (timing.execution_time === "not_started") return "此项尚未开始，没有实际执行时间和耗时。";
  if (timing.execution_time === "unknown" || timing.duration === "unknown") return "缺少可靠时间事实的字段显示未知。可重新打开详情补读，原操作不会重发。";
  return "执行时间使用本次运行的时区；耗时来自实际整轮执行，包含等待时间。";
}
export function ruleLabel(rule: TimeRule): string {
  const days = ["", "一", "二", "三", "四", "五", "六", "日"];
  return `${frequencyLabels[rule.frequency]}${rule.frequency === "weekly" ? `（${rule.weekdays?.map(n => days[n]).join("、")}）` : ""}${rule.local_date ? ` ${rule.local_date}` : ""} ${rule.local_time} · ${rule.time_zone}`;
}
export function scheduleError(code: IpcErrorCode | null): string {
  const messages: Partial<Record<IpcErrorCode, string>> = {
    context_invalid: "授权已到期，请恢复授权后重试。", scope_denied: "当前账号无权查看这些计划。", permission_denied: "当前没有此操作权限。",
    storage_disabled: "当前环境尚未开放定时任务管理。", storage_read_only: "当前只能查看计划，无法保存更改。",
    storage_unavailable: "暂时无法读取本地数据，请重试。", format_unsupported: "当前应用无法识别此数据格式，请使用兼容版本。",
    protocol_mismatch: "无法确认返回的数据，请刷新后重试。", revision_conflict: "计划已被更新，请重新打开最新版本后编辑。",
    draft_source_invalid: "草案回复不符合要求，未保存计划。你可以补充说明后重新生成。",
    draft_not_candidate: "当前回复还不能保存为计划，请先补齐草案信息。",
    draft_source_deleted: "原草案来源已删除，不能继续或重新确认。",
    request_conflict: "此请求与已有操作不一致，请先核对保存结果。", operation_unknown: "尚不能确认是否保存成功。请查证原请求，避免重复创建。",
    target_unavailable: "关联聊天已不可用，请重新选择。", invalid_input: "请检查名称、内容、时间和运行位置。",
    not_found: "记录已不可用，请刷新列表。", reservation_busy: "任务仍在处理中或等待审批，暂时不能删除。",
    cursor_invalid: "列表已过期，请从第一页刷新。",
  };
  return code ? messages[code] ?? "此操作暂不可用，请刷新后重试。" : "";
}
export function recordStatus(record: RecordView): string {
  if (record.kind === "occurrence") {
    const labels: Record<string, string> = { skipped_paused: "暂停跳过", missed_offline: "离线错过", clock_discontinuity: "时间变化跳过", missed_late: "过时跳过", busy: "聊天忙碌跳过", target_unavailable: "目标不可用", permission_denied: "权限不足", resource_unavailable: "资源不可用", unauthorized: "未获授权", consumed: "未执行" };
    return labels[record.occurrence.disposition] ?? "未执行";
 }
 if (record.attention === "needs_attention") return "需关注（审批或结果待查证）";
 if (record.run.native_outcome !== "unobserved") return { completed: "执行已结束", failed: "执行失败", interrupted: "执行已停止" }[record.run.native_outcome];
 return { reserved: "已预约", sending: "投递中", accepted: "已接受", uncertain: "结果待查证", terminal: "执行状态未知", cancelled: "已取消" }[record.run.delivery_state];
}
export function executionError(code: IpcErrorCode | null): string {
  const messages: Partial<Record<IpcErrorCode, string>> = {
    operation_unknown: "尚不能确认本次授权或运行是否受理。请查证原请求，不要创建新的运行。",
    context_invalid: "本次会话授权已失效。恢复授权后可只读查证；旧许可不会因此续期。",
    execution_not_ready: "本地执行服务尚未就绪。请稍后重新准备运行。",
    reservation_busy: "已有聊天正在排队、执行、等待审批或结果未明。请先处理原运行。",
    grant_missing: "本次运行许可不可用，请重新审阅并确认。",
    grant_expired: "本次运行许可已失效，请重新审阅并确认。",
    grant_stale: "计划或授权已变化，请重新审阅当前配置。",
    grant_exhausted: "本次许可的一次运行已占用，请查看原运行。",
    revision_conflict: "计划已被修改，请重新审阅最新版本。",
    request_conflict: "本次请求与已有回执不一致，请查证原运行。",
    permission_denied: "当前没有执行权限，或计划不再处于暂停状态。",
  };
  return code ? messages[code] ?? scheduleError(code) : "";
}

export const pauseReasonLabels: Record<PauseReason, string> = {
  budget: "本次授权次数已用完，请重新确认后续运行。",
  authorization: "授权已到期或失效，请重新审阅。",
  confirmation: "此计划需要重新确认自动执行。",
  unknown: "原运行结果尚待查证，后续自动运行已停止。",
  target: "运行目标不可用，请检查关联。",
  permission: "执行权限不足，请检查原对话。",
  resource: "本地执行资源不可用，请重新准备。",
};
