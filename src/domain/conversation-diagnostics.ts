/** Display-only allowlist. Unknown upstream codes never become visible text. */
const messages: Readonly<Record<string, string>> = Object.freeze({
  answer_completion_continuing: "正在根据已有结果补全回答。",
  answer_completion_tools_blocked: "正在补全回答，已阻止重复执行操作。",
  answer_completion_failed: "模型未能生成可交付的回答，本轮已停止，已取得的内容保留。",
  session_budget_exceeded: "本次运行的会话预算已用尽，执行已停止，已取得的内容保留。",
  display_limit: "显示内容达到容量限制，已保留可用部分。",
  history_display_limit: "本次历史显示达到容量限制，历史信息可能不完整。",
  stream_gap: "部分实时通知未被观察到，已保留收到的内容。",
  stream_changed: "实时连接已更换，部分记录需要重新读取。",
  native_format_unsupported: "这条记录使用了较新的保存格式；原记录已保留，请使用兼容版本读取。",
  native_history_partial: "原生历史仅提供了部分信息。",
  history_source_conflict: "历史读取与已观察事实不同，已保留原先观察到的结果。",
  item_start_not_observed: "缺少部分内容的开始记录，未推测其身份或正文。",
  native_source_changed: "内容来源已切换，未混合不同来源的条目。",
  item_unavailable: "部分内容对象暂不可用。",
  part_unavailable: "部分内容分段暂不可用。",
  plan_unavailable: "计划信息暂不可用，未生成替代步骤。",
  status_unavailable: "原生执行状态暂不可确认。",
  command_output_pending_final: "曾观察到命令输出通知；安全输出以各命令的结束记录为准。",
  projection_unavailable: "部分信息暂时无法展示，已保留可用内容。",
  projection_limit_exceeded: "部分信息达到传输或显示限制。",
  unsupported_notification: "当前版本暂不支持部分原生通知。",
  unsupported_source: "部分信息来源暂不支持。",
  invalid_item_identity: "部分内容缺少有效的原生身份。",
  runtime_notice: "运行时返回了提示，但未提供可显示的详细原因。已保留现有内容。",
  web_retrieval_local_fetch_blocked: "本轮已使用网页检索，已阻止再次通过本地脚本抓取网页。需要补充内容时，请使用当前检索工具。",
  operation_duplicate_pending: "相同操作仍在进行，已阻止重复启动。请等待原操作的结果。",
  operation_retry_unchanged: "上次相同操作失败，输入或执行条件尚未变化，已停止重复执行。修正原因后可重试。",
  operation_retry_dns_unchanged: "上次操作发生域名解析错误，相关条件尚未变化，已停止重复执行。",
  operation_retry_network_unchanged: "上次操作发生网络连接错误，相关条件尚未变化，已停止重复执行。",
  operation_retry_access_unchanged: "上次操作返回权限或认证错误，相关条件尚未变化，已停止重复执行。",
  operation_guard_capacity: "本轮执行记录已达上限，已停止启动新的操作。可在下一轮继续。",
  unknown: "会话存在未分类提示，已保留可用内容。",
});

export function safeConversationDiagnostic(code: string): string {
  return Object.prototype.hasOwnProperty.call(messages, code) ? code : "unknown";
}

export function conversationDiagnosticMessage(code: string): string {
  return messages[safeConversationDiagnostic(code)]!;
}
