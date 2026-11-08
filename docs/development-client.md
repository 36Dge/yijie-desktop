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

2026-11-01 日常资源修复：固定 tauri-build 2.6.3 在 Cargo 独立 build-dir 下把资源输出到中间缓存。开发入口现依据同一 Tauri 资源配置和既有技能/专家 pin，使用原资源同步器将精确受审文件装配到 `.local/development/target/debug`，供 Native 原生路径解析器读取。每次启动核对清单、归档摘要和输出文件集；未变化的文件保持。此步骤仅处理可复现资源，不复制可执行文件、不修改已安装技能或专家。

同日用户进一步澄清：默认关闭的是**当前对话选用**开关；已配置的连接器应保持**全局已启用**。上一轮“每次启动全局停用”解释已撤回。Native 启动使用既有 provider probe 恢复已保存的启用意愿，不改聊天选集；刷新、身份续期、前端热更新不重复探测。针对上一轮误停用的 Shopify/Kimi，使用两个 scope 绑定的普通幂等 Enable 操作进行一次修复，其真实回执防止覆盖用户之后的明确停用。缺少配置/授权的 Sorftime/Tushare 保持真实提示，配置和授权仍走原安全入口，不从历史回执伪造连接就绪。未完成操作保留原 ID，不重放业务工具。

## 检查与兼容

2026-11-03 执行循环修复：固定入口改用 canonical `execution-progress-v1` Runtime，旧产物保留。普通聊天直接配置 Runtime 已有的 `features.rollout_budget`（25 万加权 token，未缓存输入加输出），作用域是一次加载的根会话树，不是每轮额度或人民币封顶；专家长任务和受限草案不强加此默认。上下文压缩、上下文提醒、显式 Goal 预算保持各自原生语义。连续相同计划由 Runtime 转入已有最多两次无工具补答，客户端只显示原生终态及会话预算原因，不新增执行、计数或自动续问逻辑。Runtime/Contracts/Host 来源经本地不可变提交固定后才可正常重启激活；真实 Kimi 效果不由本机协议测试冒充。

启动环境从白名单重建，不继承旧 generation、观察代理、模型 URL、Home、凭据正文或 TAURI_CONFIG 覆盖。只选择已安装且满足 go.mod 的工具链，离线构建。原始数据目录和数据库必须已存在，不能因配置遗漏创建空历史。启动前使用 Infra 日常会话入口复用/启动原服务，再执行原 authenticated workflow ready-only 检查。

日常服务入口核对原容器身份、镜像/配置/数据挂载和只读存储事实。Docker VM 退出的 255 作为原始事实保留，通过核验即可正常重开；不自动执行旧事故恢复或全量备份。存在非终态任务、OOM、真实数据异常、配置/来源漂移或未完成启动时保留现场并报告，不重放任务。任意断电或异常退出不能承诺无需检查。

Runtime 摘要、Host/Worker 依赖来源、契约生成物、技能/专家资源和业务权限检查保持。Desktop 允许正常未提交开发修改；跨仓协议或 Host 受审依赖调整仍执行原契约流程，开发入口不跳过来源校验。

旧打包 generation、数据与脚本保留，不自动清理或降级。回到打包使用时必须正常退出开发 App，再按原流程验证相应源码/制品与当前数据兼容性，不把新代码的启动资格附加到旧包。本入口不是公网、签名或生产发布。

## 验证范围

用正常配置值验证完整功能选择、固定路径、环境白名单和开发启动参数。实际启动核对历史与功能入口，通过正常 ⌘Q 退出和再次启动验证增量编译。按用户安全条款不执行强杀、权限故障、二进制替换或攻击注入测试。实际验收记录在完成后保存，未执行项不写作通过。


## 显式 UI 验收调试构建（2026-11-03）

用户确认 FEAT-167 验收可临时采用 `python3 -B scripts/development-client.py start-ui`。
该入口复用原固定开发环境、Homes、完整功能和正常清理流程，以项目标准 Tauri debug
构建生成 `.local/development/target/debug/bundle/macos/易界 AI.app`。它有原生 bundle
identifier，便于桌面自动化定位；不是已发布应用，也不覆盖原安装包。`client:dev` 的默认
HMR 模式保持不变。修改原生逻辑/重建前仍先通过 App 菜单或⌘Q正常退出。

FEAT-167 用户同时明确撤销旧数据兼容要求。首次切换需显式执行
`python3 -B scripts/reset-trace-v6-data.py --apply`（默认不带参数只列清单）；仅在所有易界
进程正常停止后清理固定会话库及独立 Runtime 历史，保留凭据、配置、技能和工作空间文件。
成功产生本地重置记录后才允许新格式客户端启动，不进行旧数据迁移。该命令不可当作日常启动步骤。

## 原生问答与上下文工具（2026-11-08 本地候选）

在原四组 native-tools 基础上，固定开发入口使用配对的 interaction-tools 候选：
`YIJIE_FEAT169_INTERACTION_TOOLS=true` 与对应 Runtime/Host/生成类型/renderer 开关共同核验。
`interaction-tools-build-candidate.mjs --freeze` 只记录已审本地来源，不是发布或验收。
显式传 false 可选择原四组 Runtime；必须先正常结束当前任务并退出 App，再核验匹配来源重开，
不在活跃问答中切换、不恢复旧待答请求。日常 Homes、数据格式和权限机制不变。

问题卡只处理原生问答：多题、选项/自由输入、逐题跳过，X 关闭并跳过整组。停止任务使用原有停止入口。
敏感输入默认遮罩、可显隐；提交/切换会话清除本地敏感草稿，不进入持久聊天草稿。
答案仍提供给模型并由原生会话保存；平台凭据配置保持原连接器入口。
可选超时由 Host 协调，交互后暂停；结果未知时只读原回执，不自动重发。


## 原生工具搜索（FEAT-170，2026-11-08）

当前原开发入口在interaction工具配对范围内默认启用YIJIE_FEAT170_TOOL_SEARCH=true；仅普通Kimi根聊天的有效MCP目录参与发现。默认模型目录及MiniMax保持关闭，无新搜索页面/IPC/capability，已有审批和结果展示不变。

原生变更须先正常退出。临时停用可在同一入口设置YIJIE_FEAT170_TOOL_SEARCH=false；仍选择tool-search兼容Runtime，由Host为普通线程恢复基线目录，不自动退回旧reader。内部YIJIE_FEAT170_TOOL_SEARCH_RUNTIME由canonical launcher根据interaction配对推导，不作为用户任意来源选择器。

新Runtime来源锁、原interaction构建回执和tool-search构建回执均须匹配。不要为修复来源漂移删除日常Home或改写记录。当前Runtime源fac52ad79cc7e0a379fc597a7ecfcee573205d38a60c9d0ed3a2e96871ab0f45；完整证据见元仓FEAT-170。完整原生GUI内的检索操作没有单独自动化录制，不将本机启动和分层工具验证冒称GUI E2E。


### FEAT-170 显式桌面验收计数器

`python3 -B scripts/development-client.py start-ui --tool-search-meter` 仅供已有任务级授权的原生UI验收使用。先正常退出客户端，另由验收操作者启动已有FEAT-170 Kimi-only计数器并检查原账本剩余额度；入口仅转发固定127.0.0.1:18083地址，不接受任意环境URL。计数器停止后请求失败，不回退直连；验收完正常退出App和计数器，再以普通 `pnpm client:dev` 恢复。此参数不授予付费/外部操作权限、不改变数据Homes、Runtime或审批规则。2026-11-08已完成同一原生桌面聊天的搜索、审批和真实结果链，见元仓FEAT-170的05记录；不等同整体D4。

### 问答续期的草稿边界（2026-11-08）

最初版本通过dispose/bind期间暂存草稿恢复问答；该版本的真实Kimi等待超过5分半与提交后继续证据见元仓FEAT-169/09记录。2026-11-09续期调整见[聊天授权续期与页面连续性](./chat-authority-renewal.md)：同权限续期使用独立原生续期入口，保持contextId、订阅和输入节点，不再每5分钟清空或重建页面。该原生改动需正常退出并通过固定开发入口重建重开，不能只热更新renderer。

显式重绑的草稿保护继续有效：前端以有效tenant/revision/能力集合和原生generation/request/turn/item/题目定义确认同一问题；短期重新确认期间隐藏输入并关闭明文显示，确认后恢复原卡片内存草稿。权限或原请求变化、投影失效、页面离开、提交或终态均清理；重新确认60秒仍未完成也清理，不自动发送。审批和持久化语义不变，不将旧版本的真实模型证据作为新续期入口的验收结果。
