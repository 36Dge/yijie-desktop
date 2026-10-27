# FEAT-164 日常历史 format 5 只读兼容

2026-10-27。Owner 要求修复全部 D4 阻塞后完成受限验收。增量 contract-impact=semantic：改变私有持久历史的兼容读取与诊断；新的 display 输入词汇为 additive。Contracts 权威先行固定为 `d5792d6aad18352ce8d1c5d510d345004cab3bd6`，详见 `contracts/native-display-archive-v5.lock.json`。Owner/consumer 评审为本轮授权及 Codex 源码审计，不声称独立人工评审。

## 原因与修复

日常历史已有 format 5 的 NativeItem 展示字段；旧 FEAT-164 reader 只读到 4，而维护预检只检查格式数值与根终态，因此错误放行。renderer 在没有 view 时还把已 submitted 记录变成 queued，造成已完成历史显示等待提交。新预检实际调用生产 decoder，副本检查使用生成的 1–5 schema validator；未来版本仍拒绝。已 submitted 记录保留原执行事实，不重新排队；不可读记录显示明确提示，不伪造答案或终态。

Runtime、Host HTTP/SSE、当前 Native event v4 和 format 4 writer 均保持。单独的 ArchiveV5 类型由冻结词汇和本仓私有 envelope 生成；Native 返回原始类型 companion 与共同事实投影。既有私有 `chat_load_native_history_v4` 响应增加 optional `archivedViewsV5`（最多 50），Native 与 renderer 由同一 App 原子发布；旧 renderer 不消费这个新响应，不能混装。公共端点、独立 Host consumer 无新增字段。

renderer 仅在 session/turn/runtime IDs、revision、source、status、terminalObserved 与完整 item ID/ordinal 集合一致时附加历史详情。文件变更、命令动作/预览、应用上下文只用转义文本展示，不产生 command、链接、文件打开、审批或执行资格。现有私有 IPC 字节上限及 scope 检查保持。实时流不会从 archive 猜测或合并状态。

旧 JSON 不改写，schema 版本不变，原 format 5 永不写回 format 4；旧 writer 的版本保护保留。回退应保留支持 format 5 的 reader，不能用旧候选冒充历史可读，也不能降级数据库或覆盖备份。安全审核范围不新增 command/capability/CSP/URL/依赖，不改 Runtime 核心或补丁。

## 验证与范围

验证包括正常合成 archive/未来版本值、生产 repository/worker/history、renderer 终态与只读详情、实际 inspection 副本 Rust 预检及生成校验。全部真实行留在私有副本，不进入 fixture 或 Git。AJV 生成文件按现有生成 validator 的规则排除风格 lint，仍执行源 hash/generation drift/conformance；手写逻辑照常完整 lint。完整历史攻击/故障注入套件不执行。

新候选经 canonical prepare-only 构建与回执核对后，才在已授权 D4 下使用原 Home、Kimi 暂停、全模型零派发、workflow 真实 ready，查看历史/附件/关闭计划并正常退出后审计。D3 不重跑，D5 不进入；外观、键盘、最小窗口和搜索答案正确性仍为 Owner 排除。
