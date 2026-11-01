# 固定开发客户端验收记录

日期：2026-10-31。用户明确授权将完整日常客户端改为固定开发入口，保留功能及历史，前端热更新、原生正常退出后增量编译，不逐次创建新包和全量备份。

`contract-impact = semantic`（本地开发部署接口）。权威源及兼容边界见 [固定开发客户端 v1](../development-client.md)。HTTP/IPC、数据库格式、运行时权限及已有打包接口不变。用户的本次明确指令作为本机开发方式变更授权，不使用或改写旧 generation 的激活记录。

## 实现

- `pnpm client:dev`、`pnpm tauri:dev`、`pnpm tauri:demo-fast` 统一到固定开发入口。
- 当前完整 daily/media 功能经原 canonical 配置装配。Vite localhost:1420 与 HMR localhost:1421；不扩大远端 capability 或增加原生 command。
- 固定 `.local/development/target`、`bin`、`worker-target`，不调用 `tauri build` 或创建新 generation；原生自动 watcher 禁用，使用 App 自身退出与子服务清理。
- 复用原 Native/Host/Runtime Homes、原模型配置和密钥文件。启动前只读核对原目录、文件及现有工作流 readiness，不建立空数据、不做全量复制。
- 原业务权限、单实例、数据库版本及 Runtime/契约/资源来源校验保持。开发入口允许 Desktop 正常未提交修改。
- 优先选择已安装的 go.mod 精确工具链（当前 Go 1.26.5），避免系统 Go patch 升级带来无关缓存分叉。复用既有 Cargo 缓存桶。

## 实际启动、退出与重启

1. 首次开发编译完成并启动 PID 52345，窗口 1268×780。原 Host、媒体适配器、worker、固定 Runtime 随 App 正常启动；前端通过开发服务加载。
2. 界面工具不支持按路径选择裸开发进程，因此未伪称自动化完成了 Native 视觉检查。用户通过 ⌘Q 正常退出并明确回复“已正常退出”。启动器返回 0，记录为 `stopped`、`cli_signal=null`，日志包含 `FEAT-164 normal app cleanup complete`；1420/1421/18081 监听与项目进程均退出。
3. 退出后 32 份原 Runtime 会话/归档文件及 Native 密钥文件的 SHA-256 与启动前相同。Native 数据库继续使用原路径；未做全库逐行比对，也不因正常启动/退出元数据变化宣称数据库字节不变。
4. 同一命令、同一固定目录再次启动 PID 11830；worker Cargo 复用缓存耗时 0.82s，媒体适配器 0.11s。Desktop 在切回既有工具链缓存并建立开发特性产物后为 46.69s，不能将此时间承诺为以后每次修改的固定耗时。
5. 原 Host `/readyz` 返回 200；通过原认证令牌只读查询模型目录，Kimi K3.1 Pro 和 MiniMax M3 均 available。完整 Host/worker/媒体/Runtime 进程链已核对。
6. 实际 WebKit 进程与 localhost:1421 保持 HMR 连接。给 `ChatThinkingIndicator.vue` 的单亮带背景补充 `background-repeat: no-repeat` 后，Vite 在 02:10:53 记录该 CSS 的 HMR update；App PID 11830 保持。当前客户端保留运行。

未发起真实模型对话或业务工具操作。三阶段“正在思考→已处理→已完成”由既有真实组件预览和以下回归验证，本次没有把这些分层证据写作完整 Native 模型输出视觉验收。

## 空间与数据边界

- 固定开发输出约 1.2 GB；是复用的构建目录，不是每次新增一份。
- 共享 Cargo 缓存约 8.7 GB，切换前约 8.1 GB；本次开发特性新增约 0.6 GB。
- 首次工具链自动选择曾生成一个 Go 1.26.6 对应的额外缓存桶；正常退出后，在构建互斥锁下仅清理了本次新建的多余桶，改为复用 Go 1.26.5 的原桶。未删除旧构建、数据或其他缓存。
- `.local/development/target/debug/bundle` 不存在；`.local/builds/primary` 未新增 `20261031-02`。
- 本次仅保存小型配置/日志/指纹证据，没有复制全量数据。上一轮被用户叫停前已生成的备份保持原状。

## 检查

| 检查 | 结果 |
| --- | --- |
| 开发入口、默认选择、工作流兼容 | Vitest 73 项通过 |
| 固定路径与环境白名单 | Python 2 项通过 |
| 既有 primary 构建接口兼容 | Python 16 项通过 |
| 既有 daily 完整功能选择 | Node test 3 项通过 |
| 对话预加载、流式状态及计时 | 78 项通过 |
| 前端 lint / TypeScript | 通过 |
| `make build` | 通过；仅有既有大 chunk 提示 |
| shell 语法 / diff whitespace | 通过 |
| 文档构建 | 通过 |
| 当前原生开发构建与正常退出 | 通过，未强杀或注入故障 |

历史测试最初因缺少 `FEAT164_D2_TEST_ROOT`、macOS 临时路径别名，以及误用 Vitest 执行 Node test 失败；按其原有运行约定提供 `/private/tmp` 并使用 `node --test` 后通过，未修改校验以掩盖失败。

`make lint` 仍在既有 `contracts/market-catalog.candidate.json` 默认生成校验处阻断，未改该锁或刷新摘要；当前完整 daily 的 canonical 来源检查及独立前端 lint 已通过。全量 `make test` 未执行，因为包括用户禁止的权限故障和攻击/进程 fixture；未修改 Rust 产品代码，不能将定向结果宣称为全仓安全回归通过。

本机日志和小型验收记录：`.local/development/client-first-start.log`、`client-restart.log`、`before-fingerprints.json`、`restart-check.json`、`runtime-verification.json`、`processes.json`。不将真实会话、凭据或完整环境提交到 Git。
