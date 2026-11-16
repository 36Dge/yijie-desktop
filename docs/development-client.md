# 固定开发客户端 v2

2026-10-31，用户明确要求保留完整功能和历史数据，前端热更新，原生代码增量编译后正常重启，不再为每次修改创建新包和全量备份。

`contract-impact = semantic`：更改 Desktop 本地默认开发启动方式；权威源为本仓 `scripts/development-client.py`、`scripts/run-local-demo-fast.sh` 和 `scripts/run-workflow-dev.mjs`。消费者为本机开发者及 Desktop 启动流程，用户已确认此范围。公共 HTTP/IPC、数据库格式、原生权限/审批语义不变；Contracts PR/pin 为 N/A（无公共 wire 变化）。原 `daily:prepare/verify/open` 打包接口及其校验保持。

同日 v2：用户进一步要求重启电脑后点击易界，依赖服务自动启动，常规重开不再备份。新增 `scripts/development-entry.swift` 与 `scripts/install-development-entry.py`；Infra 权威源为 `../yijie-infra/scripts/workflow-session.py`，语义见其 `docs/workflow-desktop-session.md`。本次明确授权包括本机启动入口和专用服务的正常启停，不扩大原生业务能力或远端访问权限。

## 使用

### 分组件启动检查（v5，2026-11-14）

用户追加要求按前端、原生与资源改动分别构建。`contract-impact=semantic` 仅涉及本地
部署接口；权威源为 `development_build_plan.py`、`development_preflight.py` 与原启动/
打包脚本，无公共协议、权限或数据库格式变更。原 v4 的来源校验、单实例构建锁、
正常退出和启动前全量输入复核保持。

| 改动 | 日常启动动作 |
| --- | --- |
| `src/`、`public/`、入口 HTML、Vite/TypeScript 配置 | Vite 直接加载当前文件；复用原生程序及未变的应用包 |
| Rust、原生配置、Cargo 依赖或 Rust 显式嵌入文件 | 只编译原生程序及共享同一库的文档 helper，按产物变化打包 |
| 外置技能/专家资源的实际内容 | 保留已验证原生程序，只装配必要的资源和应用包 |
| Host Go 源码、连接器 worker、媒体适配器 | 分别核对各自输入、工具链与上次产物摘要，只构建变化的组件 |
| 来源元数据、检查脚本或未参与编译的生成记录 | 执行原校验；不因无关提交号更新重新编译整个客户端 |

资源清单若由 Rust `include_str!` / `include_bytes!` 嵌入，则属于真实原生依赖，必须连带
编译；图标、共享构建配置等同理，不能为了减少打包而复用旧的嵌入内容。新出现的构建脚本
采用保守失效规则，未知动态嵌入依赖停止并提示登记。组件摘要包含文件集合及内容，新增、
删除和工具链变化均参与比较，不使用 mtime 代替来源身份。
同样追踪 Rust `include!`、显式模块路径和 Go `//go:embed`，包括 Host 的
`api/jsonschema` 编译资源；不能仅按文件扩展名把嵌入 schema 当成检查资料。

旧 v4 回执首次升级时建立组件基线；以后前端或单个后端组件的变化不会使其它组件的基线
失效。当前及上次成功记录新增 `plan_version=2`、`component_inputs` 和 `build_plan`。
复用仍要求来源与既有产物匹配，应用包完整摘要由原 runner 复核。构建失败不写成功回执；
输入在构建过程中变化时不打开旧产物。既有 Runtime/工作流的规范构建与数据兼容门禁保留。

本任务仅修改 Desktop 内部构建编排，不改动主聊天已有代码、既有受审 Runtime、凭据或
历史数据。验证使用普通文件内容/依赖变化的定向用例与正常启动，不用程序替身、强杀、
权限故障或攻击 fixture。实现和最终验证记录分别保存，不预先宣称未运行场景通过。

验证完成：39 项定向用例及相关静态检查通过。真实源码快照回放覆盖现有 882 个前端文件、
外置资源、Rust 嵌入资源及 Go 嵌入 schema 的变化，分别验证只更新对应组件；这些是内存
中的构建计划检查，没有伪称逐一修改真实产品做 GUI 验收。实际普通入口完成最终基线构建
后，用户确认正常重开，日志显示所有未变业务组件跳过编译，应用包直接复用，受检产物及
回执的摘要/修改时间保持，Host `/readyz` 为 200/ready。完整证据位于
`.local/startup-components-20261114/final-verification.json`。全量业务回归和模型调用未执行。

2026-11-14 用户授权将启动前检查纳入日常点击入口。该本地部署接口为 v4，
`contract-impact = semantic`：启动前先核对本机源码、契约生成物、Runtime、技能资源和
连接器依赖，检查通过后使用原增量构建与标准 Tauri bundler，再打开原身份的客户端。
公共 HTTP/IPC、权限、签名发布及日常数据库格式不变，Contracts 公共版本为 N/A。

实现复用 `development-client.py`、`run-local-demo-fast.sh`、既有来源生成器、Cargo/Go、
`development-app-runner.mjs` 与 Infra 正常生命周期。提交号前进但源码与制品一致时，
生成器只同步来源元数据；任何 schema、生成代码、Runtime 制品或资源差异均保留原门禁。
Host 的当前本地源码在契约检查后记录为构建候选，不表示测试、代码审查或发布通过。
构建前记录内容摘要，启动 App 前再次比较；编译期间源码变化时停止该次启动，可正常重开。
未变化时核对上次成功构建的源码、工具链、功能配置、原生二进制与完整应用包摘要；
全部一致才直接复用原开发 App，并保留 Vite HMR 和最后的源码检查。任一输入或制品
变化则进入原标准增量编译和打包；不按文件时间猜测新旧。

验收要求：启动服务前完成检查；普通源码更新进入实际构建；来源提交号变化可自动同步；
不覆盖手工修改的生成内容；编译期间变更不得启动旧产物；正常重新点击可恢复。
运行中再次点击沿用原窗口，先正常退出才更新运行中的二进制。错误保留现场和启动日志，
不强杀、不回退启动旧包、不清历史、不进行自动业务请求或数据库迁移。
检查记录位于 `.local/development/startup-check.json`，上次成功构建记录为
`.local/development/startup-build.json`。固定 Runtime 的实际源码/协议或工作流数据库变更
仍须先通过各自规范构建/兼容流程；启动器不会用更新摘要替代这些步骤。

本轮验证：30 项安全定向用例、相关脚本静态检查、Swift 类型检查及规范入口构建通过。
实机从原图标入口完成“发现更新→标准构建→源码与产物复核→主界面”，随后正常退出并
重开，确认源码未变时直接复用同一原生应用包，Native、Host、Runtime、worker、媒体和
完整 bundle 摘要均保持。两次均在专用服务启动之前完成来源检查，Host `/readyz` 为
200/ready，六个工作流服务健康。现有历史正常加载，没有发起验收聊天或模型业务请求。

实机发现的原无条件 `tauri dev` 编译导致重复打包已修复；初始不复用事实保存在
`.local/startup-automation-20261114/reuse-before-fix.json`，最终证据为同目录
`final-verification.json`。更新 Swift 启动器后 macOS 要求重新允许“下载”文件夹访问，
该系统弹窗由用户本人完成；没有修改或绕过系统权限。全量业务回归、故障/攻击注入和
强杀等检查未执行，原因及验证范围记录在最终证据中；不把启动成功扩展为全业务验收。

日常直接双击桌面或 `~/Applications` 中的 **易界.app**。入口会正常打开原有 Docker Desktop，等待就绪，启动原服务和开发客户端。已打开时再次点击只切回现有窗口。无需开终端或为每次重开生成安装包。

该图标指向 `.local/development/launcher/易界.app`，只是可复现的小型 AppKit 启动器。通过 `pnpm client:install-entry` 生成到固定路径，已有产物校验来源后才更新，不复制完整客户端或用户数据。项目路径移动后需重新生成此入口。

终端开发仍可使用以下命令；此方式要求 Docker 已正常运行：

```bash
pnpm client:dev
```

`pnpm tauri:dev`、`pnpm tauri:demo-fast` 使用同一入口。保持启动终端运行。

2026-11-11：macOS 日常入口保持 `tauri dev --no-watch` 与 Vite HMR，但通过 Cargo 的
target runner 在固定开发 `.app` 中运行刚编译的可执行文件。此前直接运行裸可执行文件，
与 `start-ui` 使用不同构建配置和临时程序身份；实机出现系统 bookmark 解析错误 259，
导致所有文档格式无法定位。仅把 dev 可执行文件放进 `.app` 不能恢复旧授权：本轮已通过
应用原生目录选择器重新选择原 FEAT-171 工作区，更新该目录原有授权，没有绕过 bookmark
校验。`start-ui` 也统一为相同 dev 配置，避免两个固定入口继续切换身份。新入口使用标准 `tauri bundle --debug --bundles app --no-sign`，核对
开发二进制、配置、资源 pin 和完整 bundle 摘要；未变化时复用，不创建 generation、
安装包或数据备份。原生更新仍须正常退出，项目构建锁覆盖完整运行期。

权威源新增 `scripts/development-app-runner.mjs`，本地 deployment interface 为 v3，
`contract-impact = semantic`。开发器、启动器和本机客户端共同消费；原 Homes、
bookmark 权限检查、业务 IPC、Host/Runtime 和持久化格式不变。runner 配置不传给
App 或后续任务子进程；标准 bundler 的输出限于 `.local/development/target`，不改
已安装、签名或发布的客户端。回滚须先正常退出，再恢复原入口；无需数据迁移。

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

2026-11-11 图片输入展示验收期间，固定启动被 FEAT-164 catalog 的 sibling HEAD 校验阻断。
连接器 `37552bec1c31bca95457af7145e0dad206df1f8a` 相对固定
`2d2351b49bc7ca7bfe53e6dfe090c2bc0d949d65` 仅更新 worker 来源锁，catalog 字节相同。
开发入口现按既有 retained expert source 方式，必要时在
`.local/development/catalog-source/<固定提交>` 保留精确 detached worktree。
原 `syncMarketCatalog` 的 qualified HEAD、已提交字节、输出与来源记录校验全部保持；
不改 catalog pin/receipt，不回退活动 sibling，不改变 worker 构建来源。非开发入口保持原规则。
本地 deployment interface 的分类为 `semantic`（兼容地改变开发源码位置选择）；
图片预览 IPC 扩展自身为 `additive`，本任务整体取最高 `semantic`。
旧界面与 Native 配对回滚无需数据迁移，若 sibling 已前进，旧开发入口仍会报告原来源不匹配。

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
构建生成 `.local/development/target/debug/bundle/macos/易界 AI.app`。2026-11-11 起
`start-ui` 与 `client:dev` 统一为同一 dev 二进制、配置及 HMR 运行链；验收参数仍只选择
原有明确授权的计量入口。它有原生 bundle identifier，便于桌面自动化定位；不是已发布
应用，也不覆盖原安装包。修改原生逻辑/重建前仍先通过 App 菜单或⌘Q正常退出。

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

### FEAT-171 已授权文档验收

`YIJIE_FEAT171_DOCUMENT_RUNTIME=true python3 -B scripts/development-client.py start-ui --document-meter` 使用同一固定开发入口、原Homes及专用文档包。文档Runtime包含工具搜索基线，必须最后选定，不得被基线覆盖。仅显式验收选择固定18083计量路由；先启动独立FEAT-171计量器并核对30元/80次任务授权。该入口不授予额外费用，不继承FEAT-170额度，计量器不在线时不直连供应商。验收完正常退出；普通入口默认不开启计量和文档候选。

### 2026-11-10 澄清界面实机启动的来源同步

用户明确授权使用现有生成脚本同步过期来源锁及必要派生记录，再继续实机问答验证。
本段修复的 `contract-impact = semantic`，范围为本地开发的来源锁和构建配对元数据；
公共协议、Runtime二进制、权限及持久化格式不变。UI改动自身仍为 `none`。

最初Docker未运行；正常启动Docker后，原服务身份、存储及就绪检查通过。后续启动分别被
Runtime来源提交和worker库引用校验阻断，均沿原流程正常停止专用服务，没有强杀或任务重放。
经核对，Runtime `fe3f5b1c768f2a1464314e2a350d419a3e63d9c6` 相对原记录
`db3c7b56c390215803449b38fd7599ab4f5715f3` 没有改变这四组候选的源码、schema或制品。
按现有Kimi／native-tools／interaction-tools／tool-search生成器同步来源提交，并同步user-input、
context-window来源摘要及消费者记录；所有协议生成物和Runtime制品摘要保持一致。

native／interaction构建记录通过原 `--freeze` 入口配对当前已提交Host
`61bd306f607e1b8604b9e763f633cbc4f8db53d1`。其源码集合与既有document构建记录一致，
仅本次两个API候选元数据摘要发生变化；同时同步tool-search依赖记录和document构建记录中的
这两个摘要。没有修改Host实现或启用文档候选。Connectors沿现有兼容包装提交列表登记
`fe3f5b1c768f2a1464314e2a350d419a3e63d9c6`；它与固定库的 `codex-rs` Git树均为
`755f32c45a4c30e805e3c7fe1db89dcb4dcc6e41`，原库提交、依赖和worker源码保持不变，
原 `check-worker-source.py` 完整通过。

恢复后固定 `start-ui` 的全部启动检查和标准开发构建通过，使用原日常Homes打开客户端。
真实Kimi问答验证已完成，详见Chat工作区pattern的2026-11-10记录。此轮未提交或发布这些改动，
未运行全量回归；来源同步证据及启动日志位于 `.local/request-user-input-20261110/`。

## FEAT-172 内置图片 MCP

固定日常入口自动装配 `yijie_media.generate_image`，不再读取 `host-images.json`，不使用 `images-enable` / `images-pause` 或 `--host-images`。原生图片开关固定关闭，Runtime 仍为已固定的原生工具/搜索版本。

未选择专家时可直接请求生图；选定专家后仅使用该专家能力。专家、授权或工具不可用，输入不支持，以及执行失败或结果未知，都不自动切换易界内置生图；保留专家选择并展示原状态。用户可自行更改/移除专家后发起新请求。

当前非公开本机部署由运营方在受管 macOS Keychain 预置 Seedream 凭据。Host 仅非交互读取，缺凭据或读取需要授权时返回内置服务不可用，不向用户索取供应商 Key。没有新增凭据数据库或公网代理服务；公开分发另行设计。媒体调用不依赖文档功能开关，图片沿现有 Artifact 提交、预览、保存流程交付。

FEAT-174本地修复候选新增按需Native schema46：仅在已验证Host未派发证明后，用户向尚无Host绑定的同一本地会话显式发送新操作时升级。原失败消息/回执保持；新意图映射为首次Host创建并再次核对创建权限。旧reader拒绝46；当前reader保留46且不降级。新表沿现有父记录正常删除级联清理，不单独重写原消息或重放任务。
