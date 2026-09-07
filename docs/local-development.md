# Local Development

> 2026-09-05：FEAT-137 已按“Owner 永久终止、未完成验收”收尾。普通与 stable 入口均使用现存 FEAT-136 两补丁 Runtime；stable 保留 FEAT-134/136，审批 v6、原生 opt-in 和 UI 均停用。Contracts 权威为 `4d3f967938dde1c86ca34003a0a5628717f96262:docs/retirements/FEAT-137.json`。历史 v6 lock/checker、存储读取和源码不作活动入口，也不代表验收 PASS；完整记录见相邻 yijie 仓库 FEAT-137 的 `03-termination.md`。

## Demo 快速闭环（默认本地业务验证）

```bash
pnpm tauri:dev
```

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
Skills sibling 已前进时，未显式配置路径的本地入口使用已存在的 `.local/skills-pinned-<固定提交前7位>`，
并按旧 Skills 锁重新核对干净状态、origin 和完整提交；不会静默改用新 Skills 版本。
App 包仍通过本地启动器提供 Native 的 local/demo_fast 环境，直接双击裸开发包不等于完整本地启动。

Agent Host 的 owner-only loopback token 由 Desktop 自动管理；MiniMax API Key 由 owner-only
本地文件提供。这两者是进程/外部服务凭据，不是用户登录。`demo_fast` 仅允许 `local` 环境；
公网或生产构建继续使用正式 OIDC 与服务端权限链。

正常退出和 Desktop 崩溃都会自动关闭其 Host 并释放端口；启动器在覆盖 Host binary 前后都做端口检查，
不会按名称误杀无关 listener。若端口由仍在运行的 Desktop 或其他程序占用，先关闭实际占用者再重试。
不要为正常本地业务验证启动 FEAT-125/126 的 Keycloak/Caddy 专项认证测试环境。

Desktop 使用 macOS 每用户缓存目录中的进程级本机锁保持单实例。再次运行开发命令或误打开 `target/debug/bundle` 中的 App 时，
后启动的实例会在创建窗口前退出；它不会产生第二个客户端，也不会以缺少 `demo_fast` 环境的设置页
遮挡当前 Chat 客户端。

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
