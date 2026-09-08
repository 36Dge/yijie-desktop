# FEAT-132 Native Conversation 接入

2026-09-09 本地开发候选，未发布。原生协议 → Host 安全投影 → Native 单一显示缓冲及 SQLCipher → Vue 完整视图。详见元仓 FEAT-132 的 03-native-protocol-adjustment.md。

权威源为 `src-tauri/contracts/native-conversation.json` 的精确 Contracts 快照，以及私有 `src-tauri/schemas/chat-native-conversation-v1.schema.json`。运行 `pnpm generate:native` 生成 Rust/TS/AJV，`pnpm check:native` 校验生成物、跨仓来源和旧引擎删除。没有新增依赖。

迁移为 `0014_chat_native_conversation.sql`，仅前向事务扩展；Keychain、SQLCipher、scope、外键和删除机制不变。新表记录 native binding、事实、source/revision 及可丢弃视图；本地提交状态独立。旧记录只读，旧 Runtime ID 不证明来源。

协调器是唯一写入者。普通 history IPC 只读，不因 thread/read completed 提前停止同代实时 SSE/Artifact。确认 Host nonce 换代后可用原生 read 结束状态恢复，明确标注 runtime_read / partial；已观察原生终态优先。

唯一 NativeDisplayBuffer 按原生 Item/segment 追加 delta、按 cursor 去重。final 对象整体替换，无前缀对账、自动封口或客户端事件历史重建。Vue 只替换完整 view，保留选择 epoch 和 subscription 隔离。旧全局 timeline fallback 已删除，旧 reasoning/附件/Artifact 仍通过同一 timeline 只读可见。

正常切换前必须在旧版正常结束活跃 Turn 并退出；无新 Host nonce 来源的旧活跃行拒绝猜测接管。本次未迁移用户运行中的 DB。schema 14 不兼容旧版本写入，禁止降级迁移、静默复制 DB 或自动启动旧 reducer。

Contracts 已固定 6f632f155eacdaf93df0e0b00b5dab9e369c5442；Host 已固定 9e9d317f7e4ecff5f8aeec94fa467f9bede32139。原生来源使用 native-conversation.lock.json，FEAT-152 既有整体 Host 来源校验保留并更新真实 SHA/digest。canonical runner 强制原生 committed pin，未放宽来源或权限门禁。真实 Tauri/D4 待执行，本次 paid budget 尚为 0。
