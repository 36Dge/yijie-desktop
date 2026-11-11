# 文件预览导航栏（2026-11-10）

后续用户实机反馈的路径浮层白屏及错误存储说明，已按 [路径浮层修复记录](./2026-11-10-preview-path-fix.md) 修复并通过真实原生窗口验证。下列初版“managed 存储说明”与未完成实机验收描述保留为当时状态，不再代表当前实现。

## 交付范围

用户要求统一右侧预览标签的文档图标、在正文上方增加文件名导航栏、悬停文件夹图标显示路径浮层，以及右侧“另存为”图标和 tooltip。

- 标签使用现有彩色实心折角文档图标；本地引用没有 MIME 时仅按名称扩展名选择外观。
- 文档导航栏 48px，标题单行省略；路径与保存按钮保留 32px 命中区，空标签隐藏导航栏。
- 路径浮层显示电脑图标及授权后的完整路径，支持键盘聚焦／Esc。只有 messageFile 通过已有 `locate` 查询路径；登记产物／已发送附件的受管存储没有独立文件路径时显示存储说明，不虚构目录。路径按当前 source/context 隔离，切换后迟到响应丢弃。
- 产物与报告分别调用已有保存客户端。本地引用及附件从原生读取原文件，在系统另存为窗口中选择目标。继续遵守用户决定：不在文档界面显示任何保存状态文字。

## 契约、实现与兼容

`contract-impact = additive`。权威源为 Desktop 私有 `src-tauri/schemas/chat-document-preview-v1.schema.json`。先增加 `save` 请求、`saved/cancelled` 响应、可选 `saveSupported` 及普通请求 fixtures，再由原 `scripts/generate-document-preview.mjs` 生成类型；不是手写 wire DTO。消费者只有本仓 Native／renderer，不涉及公共 Contracts、Host、Codex Runtime 或持久化格式，公共 tag/pin 为 N/A。

旧请求行为保持；旧 renderer 可忽略新增 metadata，且不会收到未请求的保存终态。新 renderer 只有看到 `saveSupported` 才发送新动作，旧 Native 下新本地文件保存按钮不可用；既有产物保存入口继续可用。激活需先正常退出当前开发客户端，再经固定入口增量构建重开。

Native 复用原 main WebView／profile／ReadSessions／owner／tenant／会话绑定／源文件准入。原始名称由既有受管记录或授权路径取得，renderer 不提供保存目标或文件字节。保存窗口前后读取同一 source，要求与已预览 revision 一致；复用文件格式校验、扩展名规则、系统选择器、文件临时写入与原子落盘，并沿用同一个文件运行时 process epoch。新保存动作持有有界读取预算与单个对话框租约。没有 Tauri command/capability、数据库迁移或外部目标增量。

## 验证事实

- 定向 ESLint、`vue-tsc --noEmit`、生成物 `--check`、受影响原生文件 rustfmt、`git diff --check` 通过。
- 预览组件、客户端、预览领域、图标 registry 和 schema 生成共 57 项前端测试通过。最终预览组件＋schema 定向复验 31 项通过。覆盖路径按需读取、切换 context 后丢弃旧路径、空标签、报告／文件保存分流、旧 Native 不发送新动作，以及 source/revision 透传与单次保存。
- 原生定向 4 项通过：`document_preview_save::tests` 两项普通文档命名／版本与原子复制，`schema_normal_document_requests_round_trip_through_native_types`，以及 `feat166_normal_bound_document_uses_existing_message_identity_and_expiry`。只运行这些筛选项，未执行其余 733/734 项，不把未运行项计为通过。
- `cargo clippy --lib --features kimi-k31-pro-candidate -- -D warnings` 未通过：3 个在任务开始前 HEAD 中已存在的样式告警，分别为 `document_preview_native.rs` 的 XLSX 条件可合并、`document_runtime.rs` 的 cache 类型复杂度与 existing 条件可合并。新代码无 Clippy 报错；没有关闭规则、扩大修改或将此命令记录为通过。
- 1180×760 浏览器中用真实 `ChatDocumentToolbar` 核对 336px 预览宽度：导航栏 48px，亮色路径浮层完整显示、Esc 可关闭，另存为 tooltip 与键盘激活可用；暗色长标题省略且两个按钮不重叠，无水平溢出。浏览器预览为合成数据和事件计数，不是系统保存窗口或 Native 正文实测。入口为 `.local/preview-toolbar-20261110/index.html`，临时标签已关闭、浏览器尺寸已恢复。

## 实机与安全边界

实现验证完成时，开发客户端仍在运行，自动化按名称及实际可执行路径连接均返回 `Invalid app`，无法通过该工具操作正常退出。该阶段没有强杀、替换现有 App／Runtime 二进制、变更文件权限、攻击注入、真实模型调用或文件保存。原生测试仅通过 Cargo 标准构建生成开发测试产物，未重启日常客户端或访问日常数据。

新增本地文件／附件原生保存能力的激活记录见下节；实际系统保存窗口和完整 Native 预览遮挡／恢复未在本轮实测。既有工作区修改保持，未提交或发布。

## 用户正常退出后的更新完成

用户回复“已正常退出，继续更新”。只读核对旧进程已结束，原开发入口记录为 `stopped`、`cli_exit_code=0`；`development-client.py check` 确认原 Homes 和既有格式回执，没有打开数据库。

按原固定入口执行 `pnpm client:dev`，沿用 `fixed-development-v1`、原身份和数据路径。canonical 依赖／来源检查完成，原工作流鉴权 ready；技能资源 39／77 文件保持，受审 Codex Runtime 路径保持。标准 Cargo 开发构建在 25.66 秒内完成，更新可复现的 `.local/development/target/debug/yijie-desktop`，未覆盖已发布或签名 App。

北京时间 2026-11-10 22:40 启动记录为 `cli_running`；新 App PID 62121，原生窗口 1339×843、2×缩放，Agent Host、artifact adapter、market worker 与固定 Runtime 均正常运行。技能、专家及连接器启动完成，连接器 pending=0；再次执行 `development-client.py ready` 通过。开发客户端保持打开，日志位于 `.local/preview-toolbar-20261110/client-restart.log`。

此次已完成原生增量重建和重开，不再处于等待退出状态。没有发送模型验收任务或自动保存用户文件；完整系统对话框点击与 Native 浮层实测的工具限制仍按前述记录，不将启动完成描述为这些交互已通过实机验收。
