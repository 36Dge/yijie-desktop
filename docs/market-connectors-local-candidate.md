# FEAT-157 本地连接器候选

2026-10-08当前状态：以下为初始实现历史。最新目录revision 5共49项（移除淘宝闪购和豆蔻医生），generic-mcp-v1通用发现与逐次审批已实现；Tushare已有真实批准成功与拒绝零发送证据。AE使用显式导出HTTP Header安全配置。当前范围与限制见元仓FEAT-157/17和Connectors最新逐项审计。

2026-10-07。按照需求/设计包逐步实现，当前完成目录、管理面和聊天入口基础；真实连接器执行尚未开放。

## 正常入口

沿用 `scripts/run-local-demo-fast.sh`，显式设置 `YIJIE_MARKET_CONNECTORS_ENABLED=true` 后，同步启用 Native 和 renderer。仍要求 `local + demo_fast` 及当前 chat-models Runtime；默认关闭，不改变 public/production。新候选启动会使用既有本地数据库并前向迁移到 SQL31，不能把该入口当成独立空白测试数据。

本轮没有启动 canonical 应用或迁移用户日常数据库。组件浏览器检查、内存数据库测试和正常本地合成 Runtime 资格分别记载，不作为 D4。

## 数据与契约

- `contracts/market-connectors.schema.json` 和 TS/Rust/AJV 由 Contracts 独立新 family 生成。`pnpm generate:market-connectors` 同步，`pnpm check:market-connectors` 校验。候选来源记录实际 base commit 与文件摘要，不冒称 immutable release pin。
- `contracts/market-catalog.json` 来自 Connectors 的 51 项非秘密目录；源、摘要和生成器记录于同目录 candidate 文件。目录不含执行 URL、命令、环境变量或凭据。
- SQL30 在原 SQLCipher 连接内保存安装、启用意图、revision/generation、卸载 tombstone 和幂等操作回执。旧记录、旧 migration 及兼容 reader 保留；不作降库回滚。
- 新 IPC 使用既有权限上下文和固定 owner/tenant lease，按 `connector.read/manage/credentials.manage/use` 检查。管理页可单独绑定 context，不启动模型请求。
- 后续审计新增独立 `market-selection/1` 与 SQL31：实际 turn operation 的选集快照、全意图 HMAC、名称快照及双操作别名与既有消息/outbox同事务。`chat_market_submit_v1` provider准入尚未就绪，新请求在写outbox前拒绝（包括空选集），不启动旧coordinator；已有匹配回执可核对重读。UI尚不发送新命令。
- renderer 仅通过生成协议客户端调用 Native；请求严格校验，响应只投影已知字段。任何不能确认的变更回执保留原操作编号，先查询，不把 Promise resolved 当成成功。

## 当前实际行为

51 项可以浏览、筛选、查看详情及安装；安装默认停用，无外部调用或依赖下载。没有凭据/外部活动的本地安装可以卸载，同一操作可重复读取既有回执，重装使旧 generation 失效。未配置启用明确失败；尚无可有效启用的市场服务。

Composer 在关联店铺右侧显示连接器入口，已启用服务的交互组件支持本轮选择、去重和移除标签。管理往返保留正文、选集及新任务模型/工作空间意图，计划草案保持 input-only。产品数据当前没有已资格化服务；任何非空选集会阻止提交，直至版本化提交/Host/Gateway 实现完成，不将 refs 塞入旧文本或旧协议。

秘密配置、OAuth、Gateway 能力和审批、版本化 outbox/history、真实服务初始化和逐项工具调用仍待完成。当前开关不是平台访问授权，不能通过手改 `effectiveEnabled` 或目录资格绕开这些步骤。

## 回退

关闭 feature flag 并正常重启即可隐藏新入口并停止新 writer；保留支持SQL31的reader和已有加密记录。旧执行路径隔离新选集的claim、耗尽、权限恢复、resume和writer。只支持SQL30的旧binary不能读取SQL31，不以降schema伪装兼容。不删用户数据库、不清Keychain，不强杀应用/子进程。

完整设计与实施记录在元仓 `docs/features/FEAT-157-desktop-market-connectors/`；职责补充为 ADR-0021。本地专项通过不代表 51 项真实接入或全仓 CI 通过。
