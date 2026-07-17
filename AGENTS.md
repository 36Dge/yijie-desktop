# AGENTS.md

## 适用范围

本文件适用于 `yijie-desktop` 整个仓库。目录中若出现更具体的 `AGENTS.md`，修改对应目录时以更具体的规则为准。

## 仓库职责

`yijie-desktop` 是易界 AI 面向卖家的 Mac 桌面端，负责登录与店铺授权引导、Chat、Agent 任务进度、工具调用审批、结果展示、本地 sidecar 生命周期和 Mac App 发布。

技术栈为 Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、pnpm 和 Rust。

## 仓库边界

- 不实现 Admin 管理后台、平台连接器或 Codex Runtime 源码；
- 不直接访问 PostgreSQL、Redis 或第三方电商平台 API；
- 不在前端持有或持久化平台 access token、refresh token、cookie 和生产凭据；
- 不绕过服务端权限、审批或审计策略执行高风险操作；
- 原生能力只放在 Tauri/Rust 边界，不为了普通前端逻辑新增 command 或 capability。

## 当前实现状态

- 活跃应用代码位于 `src/`，当前页面、API client 和样式仍是早期骨架；
- `src/api/client.ts` 当前返回本地占位数据，不代表真实 Runtime 或后端已经接通；
- `docs/design/docs/design/` 是设计系统的规范来源；
- `docs/design/exports/` 是待逐步迁移的参考实现，不是应用运行时代码，禁止从 `src/` 直接导入；
- `YjIcon`、图标 registry、设计 token 和部分 `Yj*` 组件尚未完整迁移到活跃的 `src/`，不得假定这些模块已经存在；
- sidecar 尚未形成完整发布闭环，不能把开发期占位行为描述为已打包能力。

## 代码组织

- `src/pages/`：页面组合、路由级状态和用户工作流；
- `src/components/`：可复用 UI，不承载网络或原生副作用；
- `src/stores/`：跨页面共享状态，不把所有请求状态集中成全局状态；
- `src/api/`：后端和 Agent Host I/O、错误映射及契约适配；
- `src/domain/`：与 Vue、Tauri 和传输协议解耦的领域类型与纯逻辑；
- `src/router/`：路由定义和导航边界；
- `src-tauri/`：Tauri 配置、Rust command、sidecar 和 Mac 原生能力；
- `docs/design/`：设计规范、文档站和迁移参考，不参与应用打包。

页面负责组合，API 层负责 I/O，领域层负责纯规则，store 只管理确实需要共享的状态。不要让 Vue 组件直接拼接协议、调用数据库或管理 sidecar 进程细节。

## Design System 与 UX

- 修改复杂页面或交互前，先阅读 `docs/design/docs/design/` 中对应的 pattern、component、token 和 AI/Codex 规则；
- 设计系统迁移期间，以活跃 `src/` 的真实能力为准。需要尚未迁移的 `Yj*` 组件时，应从 exports 参考实现中有边界地迁入或重新实现，并补充验证；
- 新增重要界面时优先建立所需 token、Naive UI 主题覆盖、图标 registry 和基础组件，不继续扩散硬编码颜色、字号、间距、圆角、阴影或 z-index；
- Naive UI 是默认组件库，不引入第二套通用 UI 库；图标统一走批准后的 Lucide registry，图表统一使用 ECharts 和易界主题；
- 页面必须覆盖 loading、empty、error、permission denied 和 ready 状态，并为可重试错误提供明确恢复路径；
- 默认中文文案，亮色和暗色主题都可用；至少验证 `1180x760` 最小窗口，不允许文本、工具栏和关键操作重叠；
- 交互需要可键盘操作、可见焦点和合理的语义标签；仅有图标的按钮必须有可访问名称或 tooltip；
- 涉及店铺、广告、Listing、库存、价格、买家消息等高影响操作时，必须提供确认或审批承接点，并展示服务端返回的审计结果；
- 不提交真实卖家数据、平台 token、cookie、凭据或未授权品牌资产。

## 契约与数据

- 对接真实接口前先在 `yijie-contracts` 更新和评审契约，再生成或适配客户端；
- 不为真实接口手写一份与契约重复的 DTO；当前占位 client 应在接入时被明确替换或隔离；
- 把请求失败、超时、取消、权限拒绝和版本不兼容映射成可测试的 UI 状态；
- 不根据假设决定认证会话、token 存储、租户上下文或离线缓存策略。

## Tauri 安全规则

修改以下内容前必须向用户确认设计和权限范围：Tauri capabilities、CSP、外部 URL、Rust command、plugin、sidecar、shell、文件系统、Keychain、安全存储、自动更新、签名和公证。

- capability 遵循最小权限原则，command 必须校验输入并限制可访问资源；
- 禁止把 shell 参数、路径或外部 URL 未经校验地传给原生层；
- 当前未实现的 Keychain 或安全存储能力不得用 localStorage 临时代替；
- 日志和错误信息不得包含凭据、平台 token、PII 或完整商家数据。

## 必须先确认的决策

- 真实认证、会话、租户上下文和敏感信息存储方案；
- 新增依赖、Tauri plugin、capability、command、sidecar 或外部网络目标；
- API 或 Agent Host 协议变化及任何跨仓库改动；
- 高风险操作的审批交互、失败恢复和审计要求；
- 发布渠道、签名、公证、自动更新和生产配置。

## 开发与验证

统一使用 pnpm，不混用 npm 或 yarn。提交 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock`，不提交 `node_modules/`、`dist/`、Rust `target/`、本地环境文件或生产凭据。

```bash
pnpm install
make lint
make test
make build
pnpm tauri:dev
pnpm docs:build
```

- 文档改动至少执行 `pnpm docs:build`；
- Vue、TypeScript、store、API 或领域逻辑改动执行 `make lint && make test && make build`；
- Rust 或 Tauri 改动还必须通过 `cargo fmt --check`、`cargo clippy -D warnings` 和 `cargo test`，`make lint`、`make test` 已覆盖这些检查；
- UI 改动应实际检查亮色、暗色和最小窗口，记录无法执行的视觉或原生验证。

## 完成标准

- 代码位于正确边界，未把业务、协议或原生副作用塞进页面组件；
- 设计规范与当前实现状态一致，新增 UI 没有继续制造设计系统债务；
- loading、empty、error、permission denied 和 ready 状态完整；
- 高风险操作、安全权限和敏感数据处理符合约束；
- 与改动对应的 lint、测试、构建和视觉检查通过；
- 未完成的 sidecar、签名、公证或真实接口验证被明确说明。
