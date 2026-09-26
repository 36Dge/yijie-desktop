# 历史任务删除恢复

2026-09-26。`contract-impact = semantic`：调整 Desktop 本地删除调度和清理回执的解释，修复历史任务删除一直等待或耗尽重试的问题。无新增 IPC command、capability、公共 API、Host/Runtime 协议或跨仓修改；公共契约引用 N/A。持久化继续使用 SQLCipher `chat_deletion_jobs`（migration 0004）和 `chat_deletion_receipts`（migration 0001，schema_version=1）的既有字段。

## 两种恢复路径

- 已取消、曾尝试发送的历史轮次：必须具备原始 Host/Runtime 绑定、已绑定的公共任务身份、匹配的失败 start-turn 操作且没有待发送请求，才交给既有 Host 清理接口。取消状态不证明未执行，不会直接删除本地记录。仍由 Host 原子检查活跃/结果不明的轮次、确认 Runtime thread 删除，Desktop 收到完整清理结果后才清理本地。
- 后台会话已不存在：只有经过认证与实例 nonce 校验的清理接口明确返回 `session_not_found`，且本地没有活跃或结果不明的轮次/待发送请求，才清理本地历史。网络失败、权限失败、非结构化 404、协议不匹配都不能触发此路径。

本地历史清理沿用范围校验、定时任务删除保护、SQLCipher 事务、附件/关联记录清理及 checkpoint。只有这些步骤成功后才写入 `local_history_deleted` 回执并移除侧栏记录。回执保留无法确认的 Host/Runtime surface 为 `incomplete`，显示“本地任务记录已删除；后台会话已不存在，无法确认其运行数据的清理结果”，不宣称完整永久删除。

## 持久化及兼容性

删除结束时，Desktop 原生层发出私有 `yijie://chat-history-changed-v1` 通知，payload 严格为 `{ "schemaVersion": 1 }`。权威源为 `src-tauri/src/chat/ipc.rs` 与 `src/api/chat-history-events.ts`；这是本地新增的列表失效通知，无任务 ID 或内容，不授予读取权限。前端仍通过已授权上下文重新读取任务列表；绑定期间延后刷新，卸载时解除监听。不支持的版本或字段被忽略。即使被删除任务未打开，侧栏也同步移除旧缓存。

既有完整清理继续使用 `cleanup_complete`，回执格式不变。新增 outcome_code 为开放字符串中的 `local_history_deleted`；只含原有操作 ID、会话 keyed hash、surface 状态和时间，无正文、标题或原始会话/线程 ID。默认 30 天到期策略不变。已到重试上限的操作显示“重新尝试删除”；用户点击后复用已确认删除的原操作 ID 重试，避免无限重试。

旧待处理任务可以直接恢复，无数据重写或批量强删。旧客户端仍能解析新回执，并会保守显示清理未完成；不会把不完整的远端清理报告为成功。回滚不恢复用户已确认删除的数据。前端仅在本地 complete 且明确终态回执时移除记录、停止轮询，保留真实的远端状态。全局通知在页面跳转后继续显示本地删除的限定结果，可手动关闭，同一操作不会重复提示。

## 验证范围

使用正常构造的历史状态与本地模拟服务验证：已取消的尝试提交仍依赖远端清理确认、缺失映射的本地清理及重启读取回执、活跃/不明确轮次的阻止、错误身份拒绝、侧栏删除导航及不完整清理提示。未执行进程强杀、权限破坏、攻击性载荷或故障注入测试。

验证结果：7 项定向 Rust 回归通过；161 项相关前端测试通过，ChatPage 删除/重试 2 项定向回归通过；`pnpm lint`、`cargo fmt --check`、`cargo clippy --lib -- -D warnings`、文档构建通过。测试排除 `.local` 下的旧源码快照，避免重复加载历史 Vue 依赖。未运行含禁止性故障/攻击 fixture 的完整 Rust 套件。
