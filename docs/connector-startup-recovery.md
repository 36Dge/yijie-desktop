# 已启用连接器的启动恢复

2026-10-21。用户明确要求已开启的连接器在应用重启后自动恢复连接并显示输入框图标。

contract-impact = semantic：Desktop 恢复既有启用意图时，主动使用已有 enable/probe 操作重新核验连接；
Native 重新核验期间保留此前已经确认的 desiredEnabled。此处改变的是 Desktop 私有启动策略与
SQLCipher 中已有启用意图的维护，不新增 IPC、provider 方法、字段、权限或第三方 endpoint。
公共 wire 继续使用 `contracts/market-connectors.candidate.json` 的 0.5.0 与现有 provider 合约，
不改变其值解释，因此 contracts 变更/consumer 迁移为 N/A。权威存储仍是
`src-tauri/migrations/chat/0030_market_connectors.sql` 及既有 provider operation 表，无 schema 迁移。

启动获得当前账户权限和连接器快照后，仅恢复 installed + desiredEnabled 的项目。
每个安装代际在本次账户会话中最多检查一次，串行发起，沿用当前 Native 权限、精确安装版本、
原有凭据引用和既有受管连接流程。已连接、已停用、待配置、需要重新授权、已有 pending/unknown
操作的项目不发起新恢复；pending/unknown 只通过既有有界轮询核对原操作，失败不会产生新操作风暴。
页面切换、窗口聚焦、快照刷新和短期 context 续租不会重复启动连接。登出/租户切换清理恢复状态。

SQL 历史始终从 effectiveEnabled=false 开始，只有当前 Host/Native epoch 的实际 probe 成功及
新鲜活动连接证据才恢复 effectiveEnabled，随后使用既有草稿同步逻辑显示图标。
恢复仅 initialize/tools/list 和既有凭据读取/刷新，不自动打开 OAuth/配置页，不重放消息、
业务调用、旧 turn grant 或审批。恢复失败保留开启意图及错误；用户仍可明确重试或停用。
初次启用失败仍不持久化开启；停用、卸载或重新配置继续清除旧意图并撤销旧连接。

兼容与回滚：新旧版本使用相同 SQL schema、布尔字段和 receipt 结构；旧客户端可读，回滚后
恢复原来的手动重连行为。旧版本曾在失败重试时清除的开启意图无法推断，不擅自重新开启。
本轮为本地开发候选；本次提交和推送仅保存源码，不构成应用发布或生产兼容声明。

验证采用普通合成状态、内存 SQL、正常退出/启动和已有已开启连接器的连接检查。
不得运行含强杀、权限破坏、攻击资源或替换运行时程序的全量历史套件；未覆盖其故障测试。

## 提交前复核（2026-10-21）

- `make lint` 通过，包括生成物/契约消费校验、ESLint、Vue/TypeScript、Rust fmt 和 clippy。
- `make build` 与 `pnpm docs:build` 通过；构建存在已有体积提示，不影响退出结果。
- 相关前端普通测试 10 个文件通过：188 项通过，2 项因既有 `chatModelsEnabled`
  功能开关跳过，没有新增跳过。范围为 ChatComposer、ChatConnectorControl、
  ChatConnectorChips、ChatPage 与 ChatPage.connectors、market-connectors store、
  chat-composer-drafts store、market-connectors-ui、ConnectorMarketView 和 icon registry。
- `cargo test --manifest-path src-tauri/Cargo.toml startup_recheck_preserves_enabled_intent_across_normal_database_reopen`
  通过，1 项正常数据库重开测试；其余 Rust 测试未执行。
- 补齐图标清单中实际使用的 `checkmark`、`stopFilled` 精确预期；ChatPage 用例显式使用
  各自挂载的 Pinia，并通过一致的模拟 Native 返回值验证资源不可用状态，保留原有发送门禁断言。
  变更后的测试文件通过 ESLint 与 Vue/TypeScript 检查。

未执行 `make test` / `cargo test` 历史全量套件，原因是其中包含用户禁止的故障或攻击测试；
因此以上结果不代表全量测试通过。本次提交复核未重做真实 App 的亮暗主题、最小窗口及
原生端到端验收，也未进行签名、打包发布或生产部署，不将构建或组件测试当作该类验收证据。
