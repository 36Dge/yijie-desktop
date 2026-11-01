# 固定开发客户端 v2

2026-10-31，用户明确要求保留完整功能和历史数据，前端热更新，原生代码增量编译后正常重启，不再为每次修改创建新包和全量备份。

`contract-impact = semantic`：更改 Desktop 本地默认开发启动方式；权威源为本仓 `scripts/development-client.py`、`scripts/run-local-demo-fast.sh` 和 `scripts/run-workflow-dev.mjs`。消费者为本机开发者及 Desktop 启动流程，用户已确认此范围。公共 HTTP/IPC、数据库格式、原生权限/审批语义不变；Contracts PR/pin 为 N/A（无公共 wire 变化）。原 `daily:prepare/verify/open` 打包接口及其校验保持。

同日 v2：用户进一步要求重启电脑后点击易界，依赖服务自动启动，常规重开不再备份。新增 `scripts/development-entry.swift` 与 `scripts/install-development-entry.py`；Infra 权威源为 `../yijie-infra/scripts/workflow-session.py`，语义见其 `docs/workflow-desktop-session.md`。本次明确授权包括本机启动入口和专用服务的正常启停，不扩大原生业务能力或远端访问权限。

## 使用

日常直接双击桌面或 `~/Applications` 中的 **易界.app**。入口会正常打开原有 Docker Desktop，等待就绪，启动原服务和开发客户端。已打开时再次点击只切回现有窗口。无需开终端或为每次重开生成安装包。

该图标指向 `.local/development/launcher/易界.app`，只是可复现的小型 AppKit 启动器。通过 `pnpm client:install-entry` 生成到固定路径，已有产物校验来源后才更新，不复制完整客户端或用户数据。项目路径移动后需重新生成此入口。

终端开发仍可使用以下命令；此方式要求 Docker 已正常运行：

```bash
pnpm client:dev
```

`pnpm tauri:dev`、`pnpm tauri:demo-fast` 使用同一入口。保持启动终端运行。

- Vue、CSS、前端 TypeScript 修改由 Vite 热更新；部分模块更新会正常刷新页面，不重新构建原生包。
- Rust/Go 逻辑、原生资源或编译配置修改后，先在易界菜单正常退出或按 ⌘Q，等待清理完成，再点击同一图标或执行同一命令。Cargo/Go 使用增量缓存。禁用 Tauri 原生 watcher，避免它自动终止正在使用数据库的 App。
- Ctrl+C/SIGTERM 不转发强杀：提示用户通过 App 正常退出；退出后关闭 Vite 并释放构建锁。编译中也不向构建进程转发终止信号。
- 另一个易界实例尚未退出或端口被占用时停止启动，不按名称终止既有进程。
- 退出客户端后，专用工作流服务按 API→Coze→依赖正常停止；Docker 和其他项目保持。菜单栏“易界→退出易界”以及正常关机请求也走正常退出；启动尚未完成或清理超时时暂缓退出，不升级为强杀。AppKit 正常退出依据 [NSRunningApplication.terminate](https://developer.apple.com/documentation/appkit/nsrunningapplication/terminate()) 和 [applicationShouldTerminate](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/applicationshouldterminate(_:))。

## 固定身份、功能与输出

- 原身份 `com.yijie.ai`，原 Native `~/Library/Application Support/com.yijie.ai/demo-fast-v1`。
- 原 Host/Runtime 为本仓 `.local/demo-fast/host-home`、`codex-home`；原模型 key 文件、连接器配置、会话、专家安装和授权继续复用。
- Kimi K3.1 Pro / MiniMax、连接器、专家、现有媒体、日常计划和工作流采用现有 daily/media 配置。保留 daily SQL41 及现有文件候选限制，不新增迁移或候选能力。
- 原生输出固定为 `.local/development/target`，Host/媒体适配器为 `.local/development/bin`，worker 编译输出为 `.local/development/worker-target`。worker 使用现有 canonical 内容寻址发布目录和 manifest，不覆盖受审 Runtime。
- 复用 `.local/build-cache/feat162-v1` 的有界中间缓存及构建互斥锁。前端修改不创建 generation、不生成 `.app` 安装包、不创建数据全量备份、不伪造打包回执或激活记录。
- Vite 绑定 localhost:1420，HMR 使用已有 localhost:1421。工作流仍使用 127.0.0.1:18888。无新增外部目标、Tauri capability 或原生 command。

## 检查与兼容

启动环境从白名单重建，不继承旧 generation、观察代理、模型 URL、Home、凭据正文或 TAURI_CONFIG 覆盖。只选择已安装且满足 go.mod 的工具链，离线构建。原始数据目录和数据库必须已存在，不能因配置遗漏创建空历史。启动前使用 Infra 日常会话入口复用/启动原服务，再执行原 authenticated workflow ready-only 检查。

日常服务入口核对原容器身份、镜像/配置/数据挂载和只读存储事实。Docker VM 退出的 255 作为原始事实保留，通过核验即可正常重开；不自动执行旧事故恢复或全量备份。存在非终态任务、OOM、真实数据异常、配置/来源漂移或未完成启动时保留现场并报告，不重放任务。任意断电或异常退出不能承诺无需检查。

Runtime 摘要、Host/Worker 依赖来源、契约生成物、技能/专家资源和业务权限检查保持。Desktop 允许正常未提交开发修改；跨仓协议或 Host 受审依赖调整仍执行原契约流程，开发入口不跳过来源校验。

旧打包 generation、数据与脚本保留，不自动清理或降级。回到打包使用时必须正常退出开发 App，再按原流程验证相应源码/制品与当前数据兼容性，不把新代码的启动资格附加到旧包。本入口不是公网、签名或生产发布。

## 验证范围

用正常配置值验证完整功能选择、固定路径、环境白名单和开发启动参数。实际启动核对历史与功能入口，通过正常 ⌘Q 退出和再次启动验证增量编译。按用户安全条款不执行强杀、权限故障、二进制替换或攻击注入测试。实际验收记录在完成后保存，未执行项不写作通过。
