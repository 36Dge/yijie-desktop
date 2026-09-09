/** Display-only allowlist. Unknown upstream codes never become visible text. */
const messages: Readonly<Record<string, string>> = Object.freeze({
  display_limit: "显示内容达到容量限制，已保留可用部分。",
  history_display_limit: "本次历史显示达到容量限制，历史信息可能不完整。",
  stream_gap: "部分实时通知未被观察到，已保留收到的内容。",
  stream_changed: "实时连接已更换，部分记录需要重新读取。",
  native_history_partial: "原生历史仅提供了部分信息。",
  history_source_conflict: "历史读取与已观察事实不同，已保留原先观察到的结果。",
  item_start_not_observed: "缺少部分内容的开始记录，未推测其身份或正文。",
  native_source_changed: "内容来源已切换，未混合不同来源的条目。",
  item_unavailable: "部分内容对象暂不可用。",
  part_unavailable: "部分内容分段暂不可用。",
  plan_unavailable: "计划信息暂不可用，未生成替代步骤。",
  status_unavailable: "原生执行状态暂不可确认。",
  command_output_pending_final: "命令输出将在收到原生最终结果后展示。",
  projection_unavailable: "部分信息暂时无法展示，已保留可用内容。",
  projection_limit_exceeded: "部分信息达到传输或显示限制。",
  unsupported_notification: "当前版本暂不支持部分原生通知。",
  unsupported_source: "部分信息来源暂不支持。",
  invalid_item_identity: "部分内容缺少有效的原生身份。",
  unknown: "会话存在未分类提示，已保留可用内容。",
});

export function safeConversationDiagnostic(code: string): string {
  return Object.prototype.hasOwnProperty.call(messages, code) ? code : "unknown";
}

export function conversationDiagnosticMessage(code: string): string {
  return messages[safeConversationDiagnostic(code)]!;
}
