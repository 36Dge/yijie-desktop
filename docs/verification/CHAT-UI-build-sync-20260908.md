# 聊天界面构建版本同步修复

日期：2026-09-08。

`contract-impact = none`：恢复已提交的 Desktop renderer 展示调整；Desktop 跨进程接口、API/Agent Host 协议、本地持久状态和权限规则不变。

## 原因

聊天界面修复已存在于 `7f45a9277e00f5c8a1bd6613442122667b591f7b`：移除新建任务上方的“本地 AI 工作区”文字，并将共用输入框的聚焦、拖放态改为单层 1px 品牌青柠边框。

上次插件界面的本地 App 来自 `.local/skill-card-build-source`，该隔离目录仍以较早的 `e6bf08f655f3b7f123405575bb62a4aad7adc89b` 为基线，只叠加了插件相关文件，因此漏掉上述聊天修复。旧 App 二进制 SHA256 为 `b0c2ad698a1706e884bc41ed426fea05b8cb6a2f14203e58bb8e33f6a6e38771`；本次运行进程与该产物一致，原生界面仍显示旧文字。

这是打包来源落后造成的显示回退。当前主工作区的聊天源码正确，无须再改写相同 CSS；旧文字在源码中原本是展示用 div，而非独立导航链接。

## 修复

- 从最新完整提交 `c3a6195c540982e6304d02a2918f70eb0f49eb1a` 创建新的隔离构建目录 `.local/chat-ui-sync-20260908-source`，同时包含聊天与插件修复。
- 逐一核对全部 233 个受 Git 跟踪的 renderer 文件与该提交完全一致，再执行 canonical `pnpm tauri:build:demo-fast`。保留当前已有 App 图标产物，使用原有固定依赖来源与 local/demo_fast 配置。
- 新产物位于 `.local/chat-ui-sync-20260908-target/debug/bundle/macos/易界 AI.app`；原 App 未覆盖。通过正常退出流程关闭旧进程，并确认 Host 端口释放后启动新产物。
- 未将其他任务进行中的权限、Rust 或脚本修改带入该构建；没有更改运行权限、原生接口、业务数据或安装状态。

## 验证

- 隔离构建源码 `pnpm lint` 通过；完整前端与 macOS 本地开发 App 构建通过。
- ChatComposer、ChatPage、ChatAccessibility、SkillCard、SkillMarketplacePage、AC009、registry 共 7 个文件：96 项通过，1 项按安全要求跳过。
- 同源预览中，新建任务/继续对话 × 亮色/暗色，在 1180×760 窗口下聚焦边框均为 `1px solid rgb(195, 243, 91)`，`box-shadow: none`，没有横向溢出。
- 实际新 App 的新建任务与已完成对话页面均通过点击输入框确认细青柠聚焦效果；新建任务的原生可访问树和截图中均无“本地 AI 工作区”文字。未发送测试任务或修改已有草稿。
- 插件页面通过相关回归及完整源码版本校验，保留已接受的卡片精简、独立图标和青柠交互；原生插件页面复核因用户切换页面未继续，不将其记为本轮原生目视通过。

## 限制与未执行

- 跳过 `uses the legacy renderer only through the explicit rollback boundary`，该既有用例包含 script 注入内容。遵循用户禁止攻击注入测试的要求，不声称本轮验证了该过滤路径。
- 未运行包含故障/权限破坏 fixture 的全量原生测试。此前完整 `make lint` 的契约目录未提交改动阻塞不在本次修复范围；本轮使用固定来源构建和独立前端检查。
- 本轮是本地未签名开发构建验收，不涉及发布、签名或公证。

## 后续构建约束

复用隔离构建目录前必须核对其基线。面向用户更新 App 时，从最新完整已接受提交建立来源，核对全量 renderer 文件及相关页面，再记录源提交、输入文件哈希、产物哈希和实际运行路径；不能只同步当前任务文件而默认其他页面已包含最新修改。

本轮机器本地证据保存在 `.local/chat-ui-sync-20260908/`：`provenance.json`、`build-inputs.json`、构建和测试日志；启动配置保留在本地，不提交仓库。
