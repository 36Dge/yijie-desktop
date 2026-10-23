# 连接器状态持久化审计（2026-10-21）

## 结论与范围

本次只读审计覆盖聊天菜单、连接器管理页、前端状态投影与启动恢复、Native SQLCipher 存储与 provider 调度、Host 转发与退出、Worker 凭据存储及正常退出、标准打包启动入口。未修改连接器实现、真实安装/启用状态或凭据，未重新授权、发起真实 provider 探测或重启应用。

`contract-impact = none`：仅增加审计文档和忽略目录中的只读元数据检查工具；Desktop、API/Agent Host、公共协议和本地产品持久状态均无行为变化。

当前 daily/demo_fast 标准打包不会重置连接器安装和启用意愿；正常退出只关闭活动连接，不执行忘记凭据。当前三项均有历史启用成功记录，随后发生了成功的 disable/forget 操作。因此截图并非安装记录被打包清空，也不是单纯 UI 缓存错误。

发现需要修正的产品语义：聊天菜单开关实际修改全局启停；目前“停用”与“卸载”复用 provider_forget，包含删除本机凭据。对于需要凭据的连接器，停用后不能仅靠再次打开开关恢复。当前实现不能满足“停用仍保存配置与授权”的预期。

## 实际运行数据

通过运行中应用的文件句柄确认实际数据库为 `~/Library/Application Support/com.yijie.ai/demo-fast-v1/chat/conversations.db`。以 SQLCipher READ_ONLY、query_only 和只读事务查询，仅输出安装/动作/状态/时间及“是否有凭据引用”；不输出数据库密钥、连接器密钥、OAuth token、完整 operation payload 或业务内容。

以下时间均为 Asia/Shanghai，日期均为 2026-10-21。停用时间取成功操作记录的创建时间，完成写入约晚 1 秒。

| 连接器 | 最近启用成功 | 最近停用成功 | 当前持久状态 | 截图解释 |
| --- | --- | --- | --- | --- |
| Shopify MCP | 17:43:49 | 17:44:00 | installed=true，desiredEnabled=false，无凭据引用 | 当前接入无需账户密钥，显示关闭，隐藏“未启用”标签 |
| Sorftime | 12:52:28 | 12:54:19 | installed=true，desiredEnabled=false，无凭据引用 | 缺少已保存凭据引用，显示“待配置” |
| Tushare | 12:52:28 | 12:54:16 | installed=true，desiredEnabled=false，无凭据引用 | OAuth 需要授权，显示“待授权” |

三项的最近停用操作均为 succeeded，provider kind 均为 forget。历史首次启用成功分别为 Shopify 10 月 12 日 23:46:51、Sorftime 10 月 8 日 20:50:35、Tushare 10 月 9 日 09:40:52，证实用户记忆。原安装记录和动作历史仍在。

记录可证明“停用请求已提交并成功执行”，但没有记录 actor 或 UI/source，不能据此认定是用户手动、某次验收还是其他客户端操作触发。未读取 Keychain 原始凭据来二次检查删除结果；删除结论来自成功 forget 回执及对应实现。

本机脱敏证据：`.local/connector-state-audit-20261021/metadata.json`。只读工具源：`.local/feat155-daily-inspector/src/bin/connector-state-audit-20261021.rs`，经既有 Cargo 项目离线标准构建；未替换应用、Worker 或其他运行时可执行文件。

## 完整状态链路

1. **安装状态**：Native `chat_connector_installations` 保存 installed、desired_enabled、credential_ref、revision/generation，按 owner/tenant/service 隔离。重复安装一个仍已安装的项目返回 revision conflict；只有卸载后重装才进入新安装代际，不是每次启动重装。来源：`src-tauri/src/chat/connectors/store.rs:209`、`src-tauri/migrations/chat/0030_market_connectors.sql`。
2. **显示状态**：菜单只列已安装项目，但开关绑定 effectiveEnabled，即当前真正可用，并不直接绑定持久化的 desiredEnabled。待授权/待配置按真实配置与授权状态投影。Shopify 的“未启用”标签被菜单隐藏。来源：`src/domain/market-connectors-ui.ts:49`、`:97`，`src/components/chat/ChatConnectorControl.vue:54`、`:100`。
3. **点击行为**：点击菜单行或开关会 emit enabled-change；ChatPage 将关闭直接映射为 disable，store 调用 Native setEnabled。菜单的“选择本轮连接器”语义与实际全局写操作存在不一致，行点击也可能停用。来源：`src/components/chat/ChatConnectorControl.vue:58`、`src/pages/chat/ChatPage.vue:509`、`src/stores/market-connectors.store.ts:163`。管理页停用入口同样没有凭据清除提示；卸载另有确认。
4. **停用清除**：Native 将 Disable 和 Uninstall 都映射为 forget（`src-tauri/src/chat/connectors/store.rs:435`）；Host 先撤销旧执行准入再转发 provider_forget（`../yijie-agent-host/internal/session/market_provider.go:43`）；Worker 等待受管任务和连接正常清理后删除相应本机凭据（`../yijie-connectors/worker/src/providers.rs:450`、`credentials.rs:140`、`tushare_oauth.rs:1158`）。成功后 Native 清空 credential_ref、desired_enabled 并推进 generation；停用仍保留 installed=true，卸载才改为 false（`store.rs:598`）。这与三项实际记录吻合。
5. **启动恢复**：从数据库读取时 effectiveEnabled=false，不把旧连接记录当作当前连接。前端读取当前账户/权限快照后，只对 installed + desiredEnabled 项尝试已有 enable/probe；每个安装代际在本次账户会话中最多检查一次，不自动打开配置或 OAuth。成功的当前 Host/Native 连接证据才使开关开启。来源：`store.rs:54`、`src/stores/market-connectors.store.ts:131`、`src-tauri/src/chat/connectors/provider.rs:1647`。已关闭的三项不会被自动重新打开。
6. **恢复失败**：已成功启用过的项目，在正常重开和重连失败后保留 desiredEnabled 及凭据引用；不等于保证第三方网络、授权有效性或连接永远在线。当前策略不会因每次聚焦/刷新反复重试，必要时需明确重试或重新授权。初次启用失败不保存成功启用意愿。
7. **正常退出**：Host 正常 EOF/等待退出；Worker close 取消并等待受管任务、关闭 backend，不调用 forget。来源：`../yijie-agent-host/internal/marketbroker/owner.go:381`、`../yijie-connectors/worker/src/providers.rs:602`。凭据 alias 由稳定账户、租户、安装标识/代际和凭据引用构成，不包含构建时间或进程 ID。
8. **打包与数据目录**：标准 `scripts/run-local-demo-fast.sh --packaged` daily 路径保留 com.yijie.ai、demo-fast 数据根与固定本地 scope；构建资源和 app bundle 不包含用户连接器数据库。Native daily 数据子目录保持 demo-fast-v1（`src-tauri/src/chat/schedules/candidate.rs:58`、`src-tauri/src/chat/mod.rs:355`）。显式切换隔离 profile、应用标识、账户/租户或数据根会读取不同数据，不应称为清空同一份状态；本次实际记录不属于这种情况。

## 风险与建议

- **优先修正停用语义**：普通停用应保存凭据/配置和安装记录，仅关闭启用意愿、撤销执行准入并正常关闭连接。真正删除凭据应由清晰命名的“断开授权/清除配置”或卸载动作触发，并说明影响。实现前需按仓库规则评审 Native/Host/Worker 控制及凭据生命周期，不能简单删除 forget 调用而遗漏撤权和清理。
- **分离聊天选用与全局启停**：聊天菜单若表示“本次对话选用”，应只修改选集；全局启停保留在管理入口，并分别展示已安装、已启用、连接中/待恢复等状态，不能仅用当前连接的开关表达全部状态。
- **补充操作来源**：记录 actor/source、触发入口及适当的关联标识，避免未来只能证明“发生停用”却不能定位来源；不得写入凭据。
- **恢复边界透明**：明确显示恢复中和失败原因，保留开启意愿；第三方授权过期或 Keychain 不可访问时提供相应入口，不伪造在线状态。

本次没有自动重新配置/授权或修改数据库来恢复这三项。按当前实现，Shopify 可重新启用并检查连接；Sorftime 需要重新配置；Tushare 需要重新授权。无法从已清除的凭据引用推断或重建原密钥。

## 验证与限制

- 前端定向命令：`pnpm exec vitest run src/stores/market-connectors.store.test.ts src/domain/market-connectors-ui.test.ts src/components/chat/ChatConnectorControl.test.ts --exclude '.local/**' --maxWorkers=4`，3 文件 54 项通过。
- Native 定向命令：`cargo test --manifest-path src-tauri/Cargo.toml chat::connectors::provider::tests::startup_recheck_preserves_enabled_intent_across_normal_database_reopen -- --exact`，实际命中 1 项并通过。测试使用普通临时数据库正常 close/reopen，覆盖引用/代际保留、恢复失败仍保留意愿、重新 probe 以及明确停用；不操作用户数据库或 Keychain。
- `pnpm docs:build` 和 `git diff --check` 通过。文档站构建有已有的大 chunk 提示；文档站成功不等同于原生连接器业务验收。
- 首次前端命令未排除 `.local`，误收集历史 UI 备份，出现 2 个失败文件（旧导入缺失及旧交互断言）。已限定正式源码重跑；不把该首次运行记为通过，也未修改历史备份或测试预期。
- 不执行含强杀、权限破坏、攻击注入或运行时伪装的历史全量套件，遵守用户长期安全条款。本次不声明全量测试、所有第三方 provider、签名升级或实际生产环境跨版本迁移均已验收。
- 此结论适用于当前源码、正在运行的 daily/demo_fast 实例及读取时记录；不能保证未知未来打包脚本或外部授权状态永不改变。
