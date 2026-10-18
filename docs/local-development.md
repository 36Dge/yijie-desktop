# Local Development

> 2026-09-05：FEAT-137 已按“Owner 永久终止、未完成验收”收尾。普通与 stable 入口均使用现存 FEAT-136 两补丁 Runtime；stable 保留 FEAT-134/136，审批 v6、原生 opt-in 和 UI 均停用。Contracts 权威为 `4d3f967938dde1c86ca34003a0a5628717f96262:docs/retirements/FEAT-137.json`。历史 v6 lock/checker、存储读取和源码不作活动入口，也不代表验收 PASS；完整记录见相邻 yijie 仓库 FEAT-137 的 `03-termination.md`。

## Demo 快速闭环（默认本地业务验证）

```bash
pnpm tauri:dev
```

日常使用已打包的普通易界 App（保留普通应用身份和任务历史）：

```bash
pnpm tauri:demo-fast:app
```

该命令复用同一个本地启动器，先核验固定来源并构建 `易界 AI.app`，再携带 Native 所需环境启动；
无需验收代理或手工填写 Skills 路径。`tauri:demo-fast:stable` 仍保留为独立验收应用入口。

2026-10-18 起，普通日常入口默认同时启用已有工作流能力和日常专家。正常启动 Docker Desktop 后，
上述命令复用 Infra `workflow-up` 检查并启动已准备的数据集，自动使用已有 owner-only 凭据文件路径；
不再需要手工追加工作流环境变量。首次准备、源码构建及异常恢复仍由 Infra 原有流程负责，启动器不会
初始化新数据集或绕过门禁。显式 `YIJIE_WORKFLOW_ENABLED=false` 保留展示模式；stable 和隔离候选
不自动启用。详细边界见 `verification/workflow-daily-packaged-20261018.md`。

2026-10-08 起，以上普通日常入口在当前 chat-models Runtime 下默认启用连接器，
同时显示聊天输入框与侧栏入口。Native 与 Vite 的开关由启动器统一赋值，
无需每次手动追加环境变量。显式设置 `YIJIE_MARKET_CONNECTORS_ENABLED=false` 可关闭；
stable、旧模型回退和隔离候选不自动开启，public/production 不变。
当前 Host 不支持连接器与旧 FEAT-128 图片工具并用，连接器启动配置会关闭该旧工具。
如需使用原有图片工具，可显式关闭连接器后正常启动：
`YIJIE_MARKET_CONNECTORS_ENABLED=false pnpm tauri:demo-fast:app`。
此开关只打开已有连接器能力与入口，不自动安装、启用、授权服务或执行外部请求。
已有服务配置和逐次审批规则保持不变，详见 `docs/market-connectors-local-candidate.md`。

`pnpm tauri:demo-fast` 是同一入口的显式别名。该入口固定使用
`YIJIE_ENV=local + YIJIE_LOCAL_PROFILE=demo_fast`，自动绑定本地 Demo
身份和工作空间，启动 Desktop 管理的 Agent Host / Codex Runtime sidecar，并直达 `/chat`。
它不显示登录、退出登录或白名单账号密码表单，也不依赖 Keycloak、浏览器 OIDC、
`/v1/me/*` 或 `/v2/tasks`。Chat、Artifact、owner/tenant/session 与 native context 校验仍保留。

2026-09-08 起，普通及 stable 本地启动器同时启用 FEAT-152 的 renderer/native 权限开关，
本地 App 构建也包含三档权限菜单。新任务默认“请求批准”；运行中禁止切换，首次完全访问需要确认。
本地源码校验继续检查既有不可变基线及权限同源契约；正常启动无需验收计数代理。
显式配置验收代理时仍只接受既有固定 loopback 地址。public/production 的开关默认值不变。
已有独立 App 必须从包含 FEAT-152 的当前源码重新构建，不能复用遗漏该功能的历史隔离构建。

`contracts/runtime-permissions.lock.json` 独立固定 FEAT-152 的 Contracts/Host 完整提交和来源摘要；
本地入口同时验证对应 Git 对象、消费文件以及 Host 实际构建输入。旧 v4、Skills 和 Runtime 的锁继续保留。
Skills 来源选择统一由 `scripts/resolve-skills-checkout.mjs` 承接：显式 `YIJIE_DESKTOP_SKILLS_DIR`
或 `--skills-root` 优先，指定来源不合格时直接失败，不自动替换。未指定时，优先使用 HEAD 与锁定
完整提交相同的 sibling；sibling 已前进或不存在时，使用已存在且 HEAD 精确匹配的
`.local/skills-pinned-<固定提交前7位>`。总检查、资源同步与默认构建遵循同一规则，
后续继续严格核对干净状态、canonical origin、provider 锁与文件摘要；不自动 checkout、下载或修改锁。
固定副本缺失时会提示准备该精确版本副本，或显式设置路径，不能用更新 digest 绕过。

2026-10-03 修复原因：本机 Skills sibling 在 `10c45bec29603b002e861e1499d5b4e684251af5`
后增加了空的备份提交 `488714a8d96f40806a257aae097683815b1dd458`，tree 完全相同，
但原总检查只选择 sibling，因严格 HEAD 校验被阻断。现复用已有固定版本副本；不回退 sibling，
不变更已评审的 Skills 版本。`contract-impact = none`：仅统一开发工具的固定依赖来源选择；
Desktop/API/Agent Host 跨进程接口、本地持久状态及实际消费的固定资源字节均无变化。

本次验证：未设置临时 Skills 路径的 `make lint` 全部通过（契约、ESLint、Vue/TS、Rust fmt、
all-targets Clippy）；`pnpm skills:check` 与 `pnpm skills:release-boundary` 通过；
6 项来源选择回归及 2 项真实固定契约/实现校验通过。显式指定已前进的 sibling 时仍按预期拒绝。
未执行包含强杀、权限破坏及攻击 fixture 的未筛选 `make test`，遵守用户长期安全条款；
因此以上结果不代表全库测试通过。此次未重新打包、签名或启动发布 App。
App 包仍通过本地启动器提供 Native 的 local/demo_fast 环境，直接双击裸开发包不等于完整本地启动。

2026-10-16，旧 Host Skills v1/v4及普通Skills双渠道资源来源检查也复用上述固定提交选择机制，公共实现为
`scripts/resolve-pinned-checkout.mjs`。未指定 Host 路径时，历史契约检查使用精确 HEAD 的 sibling，
或 `.local/agent-host-pinned-<固定提交前7位>`；Skills v1 固定
`1b7bfd1ce4323e52035b2ba1e62842c2d332d9ed`，v4 固定
`96b1fa19783694aef583b614c492fd2b6b5c15cc`，各自原锁和内容摘要不变。
显式 `YIJIE_DESKTOP_AGENT_HOST_DIR`、`--agent-host-root` 或函数参数始终优先，脏目录、错误远端或缺少固定对象
仍由原检查器拒绝，不回退。选择器不会自动拉取、建立检出、切换分支、提交或刷新摘要。

历史参考副本只供读取锁定 Git 对象。本机通过两个独立 detached sparse worktree 准备，
工作区只展开 `api/contracts.lock`、`api/skills.lock`，其余固定对象由原 `git show` /
`git cat-file` 校验；不展开或执行历史攻击归档/进程故障 fixture。新建副本须在 sparse 模式下
初始化索引并确认 `git status --porcelain` 为空，不能忽略未完成检出留下的删除状态。
目录前缀不是信任依据，实际 HEAD、canonical origin、干净状态、完整 commit、provider 锁与
每份摘要仍必须通过。缺副本时按错误中的完整提交准备，不改变现有开发工作区。

实际运行候选继续使用当前 Host build checkout，并验证完整 source snapshot、原权限消费锁
及生成物；v4检查与普通Skills资源入口在原 local candidate 条件成立时不选择历史副本。
因此历史契约基线检查通过不授予旧 Host 运行新专家的资格，也不替代当前专家来源门禁。
`contract-impact = none`：仅修正开发工具的来源选择，原固定字节、启动权限、专家资产、
协议、数据库及历史均不变。修复与全量检查证据见元仓 FEAT-158/20。
本次默认 `make lint`、23项相关回归、双渠道 `skills:check`、`skills:release-boundary`、
当前专家Host候选及资源来源检查均通过；显式脏Host来源仍拒绝，历史副本也不能冒充当前执行来源。
此处是本地工程检查结果，不表示远端CI、全量故障测试或发布通过。

Agent Host 的 owner-only loopback token 由 Desktop 自动管理；MiniMax API Key 由 owner-only
本地文件提供。这两者是进程/外部服务凭据，不是用户登录。`demo_fast` 仅允许 `local` 环境；
公网或生产构建继续使用正式 OIDC 与服务端权限链。

正常退出和 Desktop 崩溃都会自动关闭其 Host 并释放端口；启动器在覆盖 Host binary 前后都做端口检查，
不会按名称误杀无关 listener。若端口由仍在运行的 Desktop 或其他程序占用，先关闭实际占用者再重试。
不要为正常本地业务验证启动 FEAT-125/126 的 Keycloak/Caddy 专项认证测试环境。

Desktop 使用 macOS 每用户缓存目录中的进程级本机锁保持单实例。再次运行开发命令或误打开 `target/debug/bundle` 中的 App 时，
后启动的实例会在创建窗口前退出；它不会产生第二个客户端，也不会以缺少 `demo_fast` 环境的设置页
遮挡当前 Chat 客户端。

## FEAT-158 日常专家与同构建重开

2026-10-16 第一组接入：当前受审资产为 bundle 0.5.0，来源 `yijie-skills/dist/skills-experts-first-three-v010`，包含38个原普通Skill和4位真实专家。原京东0.1.3身份与归档不变；新增小红书、漫剧、跨境运营均为易界适配版0.1.0。仍使用下方同一个daily入口、安装器与会话绑定，不新增profile或数据迁移。三位不再是展示卡，其余7位保留展示状态；它们不因资源已准备而获得平台连接或额外权限。来源更新必须先规范打包、核对原资源不变、固定Desktop/Host资产pin，再执行既有Host源码freeze和canonical构建；不得改旧receipt或清理历史以通过检查。

2026-10-13 Owner授权接入日常客户端。普通canonical入口在既有daily模型/连接器组合且未选择workflow专用配置时默认开启专家，保持 `com.yijie.ai`、原 `demo-fast-v1`、Host/Runtime Home、18081端口、Host binary和单实例锁。复用既有SQL33→35及Host8→10迁移，不重写历史、旧outbox或普通Skill安装。专家资源仍通过独立受审槽加载，须用户召唤后才用于会话。

```bash
./scripts/run-local-demo-fast.sh --packaged
# 正常Quit后，不重建地重开同一日常制品：
./scripts/run-local-demo-fast.sh --packaged --reopen
```

显式 `YIJIE_EXPERTS_ENABLED=false` 保留新版兼容reader并关闭专家入口；回退需要按canonical正常构建，不能把新旧Renderer与Native开关混用。已升级SQL35/Host10禁止降级或重置，旧专家会话不冒充普通执行；新普通会话仍可使用。stable、旧模型、隔离定时验证及workflow专用入口维持其原边界。

固定 `--experts-content-v013` 使用 `com.yijie.ai.feat158-content-v013`、`feat158-content-v013-candidate` 与18161端口。原隔离部署和历史保留，不替换旧资源绕过引用保护；这些隔离入口仍需显式 `YIJIE_EXPERTS_ENABLED=true`。

`contract-impact=semantic`：固定本地部署身份与正常重开选择，复用既有专家契约、单一当前资产 pin、构建和安装服务；不增加业务 wire、数据库 schema、权限或进程管理器。

新内容验收使用固定的独立 profile：

```bash
YIJIE_EXPERTS_ENABLED=true ./scripts/run-local-demo-fast.sh --packaged --experts-content-v012
```

原 `default` 专家隔离身份改用显式 `--experts-local` 选择；`--experts-content-v011/v012/v013` 保留。daily和四个隔离profile由 `src-tauri/experts-local-profiles.json` 统一定义，Tauri overlay是经启动前核对的投影。Native日常版无论专家开关真假均使用原日常锁，隔离版使用已登记身份的独立锁。参数不选择历史内容版本，也不接受任意AppData、安装路径或hash。

| 状态 | `--experts-local` | `content-v011` | `content-v012` |
|---|---|---|---|
| App 身份 | `com.yijie.ai.feat158-local` | `com.yijie.ai.feat158-content-v011` | `com.yijie.ai.feat158-content-v012` |
| App 名称 | 易界 AI FEAT-158 | 易界 AI FEAT-158 内容 0.1.1 | 易界 AI FEAT-158 内容 0.1.2 |
| Host/Runtime 根 | `.local/feat158-candidate` | `.local/feat158-content-v011-candidate` | `.local/feat158-content-v012-candidate` |
| 固定 Host 端口 | 18158 | 18159 | 18160 |
| Native AppData | 对应 App 身份目录 | 对应 App 身份目录 | 对应 App 身份目录 |

上述隔离profile的Host binary、HostHome、CodexHome、Native SQLCipher/secret、Skills安装和单实例锁相互隔离；daily项精确复用原日常路径，不能用来另开同库实例。开启专家时 `YIJIE_DEMO_FAST_HOST_PORT` 必须等于所选profile固定值，daily为18081。端口占用直接拒绝，须通过应用正常退出释放，启动器不终止既有进程。

所有 profile 仍用同一份当前 `contracts/experts-assets.candidate.json`，通过原资源同步器校验后复制到共享构建资源槽 `.local/skill-packages-experts`，再装入各自 App 包。这是生成缓存，不是安装目录。新增 profile 不复制或清空旧数据库，不覆盖旧安装，不删除历史；旧资源引用依旧阻止移除和覆盖。用新隔离环境验证新内容，不代表真实旧版本升级已通过。0.1.0/0.1.1 历史及原失败证据保留，跨版本的旧绑定只能继续明确受支持的版本或如实显示不可用，不能静默转换。

首次 canonical packaged 构建成功并且构建前后 Desktop 源码、配置、资产 pin 和构建参数一致后，在对应部署根写 `packaged-launch-receipt.json`。该本地 QA 出处记录包含源码摘要、完整 App bundle 文件清单及摘要、Host、固定 Runtime/manifest、原市场 worker/manifest 摘要和部署身份；不保存密钥，不代表发布签名或安全认证。

worker 的实际构建输入也进入同一个回执：包括 `worker/` 的 Cargo 配置、锁文件、手写/生成源码和内联资产，以及编译包含的 `catalog/` JSON、canonical 构建脚本和依赖检查器。它在 worker 构建前单独采样，直至 App 构建完成仍必须一致。既有 Codex 依赖来源检查继续执行；仅旧 worker binary 没变不能掩盖手写源码已漂移。

完成正常 Quit 后，可用同一构建重新打开：

```bash
YIJIE_EXPERTS_ENABLED=true ./scripts/run-local-demo-fast.sh --packaged --experts-content-v012 --reopen
```

`--reopen` 支持已启用专家的daily及隔离packaged入口。该路径仍执行原契约、源码、权限、普通38技能、专家资源及固定 Runtime 门禁，但全部为 check-only；不调用 Go/Tauri/worker 构建，不同步或重打包资源，不改写回执。只有当前源码/配置、当前单一资产权威和原 App/Host/Runtime/worker 全部与回执一致，才复用原来的受管环境 `exec` 同一个 App binary。缺少回执、来源或产物变化一律停止，需重新执行正常 canonical 构建；不为旧产物补登记回执，不把双击裸 App 当作等价启动。

回执中的编译参数仅存摘要。源码或内容更新后重建会产生新的本地回执，因此本轮同构建 Quit/reopen 应在修改源码或 pin 之前完成。该机制不读写会话数据库或安装回执，不发消息、不授执行资格；真实构建、启动、生命周期和模型验收另行记录，外观按用户指令跳过。

## 基础前端开发

```bash
pnpm install
pnpm dev
```

仅在明确不需要真实业务链路时使用底层 Tauri 开发入口：

```bash
pnpm tauri:dev:raw
```

FEAT-125 本地白名单登录默认关闭。只在 loopback synthetic 服务配置下，同时设置以下值后，
Settings 才显示空白账号/密码表单，Rust runtime 才接受请求：

```bash
VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED=true
VITE_YIJIE_ENV=local
YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED=true
YIJIE_ENV=local
YIJIE_DESKTOP_AUTH_ENVIRONMENT=local-integration
YIJIE_DESKTOP_LOCAL_WHITELIST_IDP_SECRETS_PATH=/absolute/path/to/ignored/feat-125.secrets.env
```

secret 文件必须属于当前用户、权限为 `0400` 或 `0600`、不是 symlink，并包含精确的
FEAT-125 local secret inventory。账号和密码每次手工输入，不写入 `.env`、源码、测试或日志。
`VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED` 是前端表单的显示门，
`YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED` 是 native command 的运行时门；前者关闭时表单不进入 UI，
后者关闭或配置不完整时 command fail closed。系统浏览器登录入口始终保留，关闭本地表单不会改变既有登录路径。

构建检查：

```bash
pnpm lint
pnpm test
pnpm build
```

默认 `pnpm test` 等价于 `pnpm test:demo-fast`，覆盖当前业务与 Demo 门禁，但不执行历史
S10D-H production harness checker。需要显式验证生产加固基线时使用：

```bash
pnpm test:production-hardened
# 或同时执行 Rust tests
make test-production-hardened
```

`production_hardened` 入口不会刷新 S10D-H digest 或改变其 `FAIL/PAUSED` 账本；WAL/axe 的 RCA
与一次授权复跑完成前，该入口保持失败是预期行为。

## FEAT-155 日常定时任务入口（2026-09-25）

Owner已授权将定时任务接到普通客户端。`pnpm tauri:dev`、`pnpm tauri:demo-fast`和`pnpm tauri:demo-fast:app`默认设置原生`YIJIE_FEAT155_SCHEDULED_DAILY=true`，使用原`demo-fast-v1` SQLCipher库、`.local/demo-fast/host-home`及`.local/demo-fast/codex-home`。复用已有SQL16～26/Store6迁移、worker、Coordinator和outbox；不另建数据库或调度服务。新保存计划仍暂停，执行与启用仍需用户有限确认。

默认产物改用Contracts固定的input-only Runtime（原FEAT136产物保留），Host源码必须匹配已提交的精确source lock。普通图片、已启用工作流与普通MCP配置保留；受限草案依靠逐线程/逐轮原生空工具回执隔离，不继承普通工具权限。首页及普通聊天页的“通过当前输入创建定时任务”已移除，第二种创建方式保留在定时任务管理页“通过对话创建”。

`YIJIE_FEAT155_SCHEDULED_CANDIDATE=true`仍显式选择独立验收库；不能同时选择daily。`--stable-api-only`仍保留原稳定配置及其Host/Runtime目录；显式`YIJIE_FEAT155_SCHEDULED_DAILY=false`保留原日常数据路径。二者均不执行新定时写入，已有高版本SQL数据使用兼容reader，禁止降级数据库或切换库伪造回滚。保留原Runtime的回退不提供草案资格；回退前正常暂停计划/退出，保留未知运行历史。该接线仅用于local/demo_fast，不是生产发布或任意二进制资格开关。

日常历史兼容：旧v1投递明确failed但projection仍queued时，只有turn payload精确匹配、无Runtime turn绑定、没有同轮非failed操作，且submission不是submitted/uncertain，才不占用全局调度通道。已有聊天自身的原索引/删除保护继续有效；不会把旧历史改成成功或重新投递。清理重试耗尽且lease已释放的记录仍留存，但不再冒充当前清理工作；pending或仍持有lease的清理照常阻挡。

专属聊天的首次create若从未尝试、已按原生恢复流程取消退款且仍无Host/Runtime绑定，则它只是已撤销运行的本地占位。后续显式确认可沿同一受管目录创建新会话/新操作，组合事务重验后更新当前专属关联；旧run、旧聊天和旧outbox继续留存且不得出站。已有真实绑定、已尝试、未释放或未知记录不适用此重建规则。

### 第一组专家事实保真修复候选（2026-10-16）

当前 canonical expert producer 为 `dist/skills-experts-first-three-v011`，bundle `0.5.1`。
44 个资产包含原 38 普通 Skill、原 jd 0.1.3、新三位原 0.1.0 以及小红书/跨境的 0.1.1。
新修订使用不同受管 installation id，旧包、receipt 和精确会话引用保留；目录每位只显示最新版本，仍共 4 位真实专家。
历史版本解析继续校验完整 ExpertRef；只有权威目录确认安装目录互异且摘要相符的旧版本可与新版本共存。

数据库目录在连接打开前统一设置备份排除；不要对打开的 db、WAL、SHM 文件调用 Foundation
`getResourceValue` 或绕过 SQLite 另开/关闭同 inode 描述符，后者会释放进程的 POSIX 锁。
验收保留对照仅在正常退出后运行。修复证据与真实模型复验见元仓 FEAT-158/19。
