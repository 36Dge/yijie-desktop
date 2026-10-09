# FEAT-157 本地连接器候选

后续扩展（2026-10-08）：新增9项并迁入FastMoss后目录revision7共58项（跨境电商10项、行业数据16项）；Sorftime新使用统一FEAT-157，旧启动与专用执行退役、历史保留。下文保留原范围历史，最新实现与验证见元仓FEAT-157/20及Connectors跨境审计JSON。

2026-10-08当前状态：以下为初始实现历史。最新目录revision 5共49项（移除淘宝闪购和豆蔻医生），generic-mcp-v1通用发现与逐次审批已实现；Tushare已有真实批准成功与拒绝零发送证据。AE使用显式导出HTTP Header安全配置。当前范围与限制见元仓FEAT-157/17和Connectors最新逐项审计。

2026-10-07。按照需求/设计包逐步实现，当前完成目录、管理面和聊天入口基础；真实连接器执行尚未开放。

## 正常入口

2026-10-08 启动入口修复：用户要求新启动的日常客户端显示连接器。排查确认，当前 Native 和 Vite 进程均带有 `YIJIE_MARKET_CONNECTORS_ENABLED=false` / `VITE_YIJIE_MARKET_CONNECTORS_ENABLED=false`，来源是启动器仍使用早期候选的默认关闭值。因此 Composer、侧栏和路由被一致隐藏，而不是卡片布局或权限菜单移位导致。

`contract-impact = breaking`（本地默认启动配置）：本仓 `scripts/run-local-demo-fast.sh` 是该配置的权威源，producer 为启动器，consumers 为 Desktop Native、Vite 和既有 Agent Host。普通日常 `local + demo_fast` 且启用当前 chat-models Runtime 时，连接器改为默认开启；Native 与 renderer 始终使用同一解析值。用户已明确授权恢复入口。现有 API/IPC、权限校验、存储格式和固定来源检查不变，无公共 wire 变更，Contracts 新 pin 为 N/A。已有安装、启用、授权和逐次批准规则不变，不自动安装或启用任何服务。

原生验收还发现第二处启动冲突：旧 FEAT-128 图片生成会设置 `Runtime.DynamicToolsEnabled=true`，但既有 Host `internal/app/market_config.go` 明确拒绝 market 与旧 dynamic tools 并用。开启连接器时，启动器必须同步关闭旧 FEAT-128 图片工具，不修改或放宽 Host 准入。此变化影响默认入口的旧图片能力，因此按最高风险从 semantic 更新为 breaking。兼容窗口保留完整旧分支：`YIJIE_MARKET_CONNECTORS_ENABLED=false pnpm tauri:demo-fast:app` 可恢复普通入口原有图片工具配置；stable、旧模型和隔离候选不自动开启连接器。无需删库、降级 schema 或更改凭据。此为本地候选启动修复，不是生产发布。

沿用 `scripts/run-local-demo-fast.sh`（`pnpm tauri:dev`、`pnpm tauri:demo-fast`、`pnpm tauri:demo-fast:app`）。仍要求 `local + demo_fast` 及当前 chat-models Runtime；不改变 public/production。启动使用原本地数据库和已有前向迁移，不把该入口当成独立空白测试数据。

启动修复验证：34 项定向检查通过，包含直接执行启动器纯配置片段的六种组合（日常默认、显式关闭、旧模型、隔离候选、stable、显式候选开启），并确认 Native / Vite 值一致，连接器开启时旧图片工具关闭、显式回退时保留原配置；导航与权限条件回归通过。`bash -n`、前端 lint / 类型检查、前端构建和文档构建通过。完整 `make lint` 已通过前端与契约检查，但在既有 Native 连接器文件的 `cargo fmt --check` 差异处停止，未修改无关 Rust 文件。一个旧启动器测试仍断言 provider 参数直接内联；已按 FEAT-157 现有 provider 数组转发更新断言，没有更改凭据或 provider 行为。

2026-10-08 原生重启验收完成：用户正常退出旧客户端后，以 `env -u YIJIE_MARKET_CONNECTORS_ENABLED -u VITE_YIJIE_MARKET_CONNECTORS_ENABLED pnpm tauri:demo-fast:app` 构建并启动标准本地 App。首轮发现上述图片工具冲突；通过 App 的 Cmd+Q 正常退出，再按修正配置构建启动。未强杀进程、未替换 Runtime，未改凭据或权限。新进程确认 Native/Vite market=true、chat-models=true、provider-only=false、FEAT-128 image=false；Native → Host → worker / Codex 父子关系正常，Host 监听原 loopback 端口。聊天模型和权限菜单恢复可用，历史任务正常显示。

实机可见结果：侧栏连接器可访问管理页，49 项目录正常加载；Composer 连接器菜单显示真实的「0 个已安装」空状态，「管理连接器」进入 `/connectors?from=/chat`。只核对入口与本地目录，未安装、启用或调用任何外部服务，未发送模型请求。本次只改启动配置，未改 UI 布局；实机检查为当前亮色窗口，未新增暗色／最小窗口视觉回归。产物为标准脚本生成的未签名 debug App，不宣称签名发布。证据目录：`.local/connectors-startup-20261008/`（`native-evidence.json`、两张实机截图、构建与测试日志）；全量故障／攻击类测试继续遵守 `docs/store-dashboard-plan-2.md` 的安全跳过记录。

初始候选实现阶段没有启动 canonical 应用或迁移用户日常数据库。组件浏览器检查、内存数据库测试和正常本地合成 Runtime 资格分别记载，不作为 D4。

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
