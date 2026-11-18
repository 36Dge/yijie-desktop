# 最新生图失败审计与修复

2026-11-17，用户反馈余额充足，但最新生图卡片要求核对模型配置与账户额度。

## 审计事实

- 当前日常会话的图片失败发生于 19:42:35（Asia/Shanghai）。Host 原始失败事件为
  `Image generation: authentication_failed.`，没有 HTTP 状态或供应商错误码；
  Artifact 错误码为 `unsupported_provider`，MCP 结果为 `blocked/service_unavailable`。
- 相同受管 Host 的 `--check-media-credential` 返回 `ready=false`、
  `credential_unavailable`、`provider_requests=0`。失败阶段是本机凭据读取。
- `SeedreamClient.Generate` 先读取并验证已有凭据，再创建/发送图片请求；
  远程非 200 响应会保留 HTTP 状态。因此本次不是供应商审图或余额拒绝。
- 旧实现把本地读取失败与远程鉴权失败合并记录为 `authentication_failed`，
  UI 又把共享 `unsupported_provider` 显示为模型配置与账户额度问题，造成误导。

私有运行证据保存于工作区 `.local/image-failure-audit-20261117/`，不复制钥匙串值、
完整聊天正文或图片到仓库。既有失败历史保持，不回填成功、不重放请求。

## 修复边界

Desktop `contract-impact=none`：只修正共享图片失败文案；IPC、状态、原生行为、
数据库和历史解码不变。图片卡片与旧外壳共用现有提示函数，通用服务错误不推断余额。

Host 的本地运营 CLI 为 `additive`：保留旧字段与退出码，增加可选固定原因和
系统状态值；Artifact 既有诊断文本区分本地读取与远程 HTTP 拒绝。权威说明见
`yijie-agent-host/docs/image-credential-diagnostics.md`。公共错误码与 MCP 回执保持，
仍复用固定 Runtime 的原生 MCP、轮次绑定和 Artifact 提交，不新增执行链或凭据存储。

## 已执行验证

- Host/imagegen 与 session 的 10 个选定顶层用例以 `-race` 通过；覆盖普通平台
  错误值、读取失败时零 HTTP、真实 HTTP 响应类型、单次派发、专家排除和 ACK。
- 图片组件选定 6 项通过，16 项未选择；新的失败提示无余额/审图推断，失败态
  不继续加载或打开预览。三个修改文件 ESLint 与 diff whitespace 检查通过。
- 正常退出前核对当前会话 idle、无活动轮次；通过原固定开发入口重建并重开。
  canonical 入口只重建 Host，Native/Runtime 与其余受检组件复用。Host `/readyz`
  返回 ready，实际 Vite 模块包含新文案。Vite 监听 IPv6 回环，初次通过代理/IPv4
  读取失败不计入验证，使用实际 `[::1]:1420` 后读取通过。
- 新 Host SHA-256 为 `4bf76dcc67a65999bc0c3503f86cc9a1fa870a13d27a3807bb016e2cf5f9db0d`。
  无交互复核返回 `access_denied`、`keychain_status=-25293`，明确是本机系统拒绝读取。
  Go vet 通过；运行源码与构建来源由原生成器校验并更新本地 candidate，未手改摘要。
- 用户已在系统窗口完成授权。授权 CLI 返回 `ready=true`；随后对相同 SHA 的 Host
  再运行无交互检查，独立返回 `ready=true`、退出码 0、`provider_requests=0`。
  Host 与 Runtime 均为 ready，当前会话及原失败产物保持。证据为私有目录中的
  `after-authorization.json`；没有再次构建 Host 或沿用旧构建的授权结论。

未执行付费生图、全量回归、强杀、权限破坏、二进制替身或攻击注入。
仅检查服务凭据就绪不能证明实际生图完成；授权后应由显式新请求验证交付。
