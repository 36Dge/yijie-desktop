# 对话流式呈现调整（2026-10-23）

`contract-impact = none`：只修改 Desktop 进程内的正文呈现游标、淡入及滚动跟随；
Desktop 与 API/Agent Host、Native IPC、事件顺序、完成事实、权限及本地持久化/重放格式不变。
不增加依赖，不修改 Runtime、sidecar 或其他仓库。

原实现每个数据块同时显示并淡入，自动跟随又在每次更新时重启平滑滚动。
现由 `useChatStreamPresentation` 将追加正文分散到绘制帧，按剩余长度调整速度，
在最后一次追加后目标 180ms 内追上。历史和首次挂载的已有快照不重播；
停止、完成、替换、隐藏窗口及减少动态效果直接呈现。选区暂停呈现，卸载取消回调。
消息级游标保持 Markdown 顺序及完整字素，嵌套内容不再次排队；新增文字使用 120ms 淡入。
滚动观察正文高度并即时跟随，主动回到底部保留平滑滚动，上翻、选区和轮次定位优先。

验证结果：

- 6 个专项测试文件、74 项通过：流式文字、Markdown、原生流式展示、TurnGroup、呈现游标和滚动。
  覆盖连续数据块、跨块顺序、长文本、Emoji、终态、替换、历史、减少动态效果、隐藏窗口、选区及卸载。
- `pnpm lint`（ESLint 与 TypeScript）、`make build`、`pnpm docs:build`、`git diff --check` 通过。
- 生产 Vue 组件的本地合成回放检查亮/暗主题及 1180×760 iframe 视口；26 个数据块产生
  432 次 DOM 文本更新，单次最大增加 7 个 UTF-16 单元。该数字只描述此次样本，不是网络性能保证。
  截图和回放源码在 `.local/chat-stream-smooth-20261023/`；临时预览服务已正常关闭。

未完成及未执行：

- 扩展到 `ChatPage.test.ts` 的页面回归有 1 项文案断言失败、2 项原有跳过。
  `does not treat an active empty reasoning Item as historical authority loss` 仍断言“正在思考”，
  工作区现有过程展示返回“执行进度”。本次未修改这一文案、断言或其他任务的过程聚合改动。
- `make lint` 在 `generate:check` 被 `contracts checkout has tracked changes` 拦截，
  因而未执行其后续 Rust 门禁；没有清理契约仓或更新 pin/digest 来绕过检查。
- 未执行全量 `make test` / Native 历史测试：其中含权限破坏、可执行替换和攻击性 fixture，
  与用户长期安全条款冲突。采用上述正常、非破坏性专项验证；不声明全仓或 Native 回归通过。
- 未重新打包/启动原生客户端或发送真实模型请求；组件合成回放不能替代真实 Provider 端到端验收。
  前端只能平滑已经到达的文本，无法消除服务端尚未产生内容时的等待。

## 2026-10-24 FEAT-163增量

沿用上述单一正文游标、Markdown与滚动机制。公开进度来自原生消息，工具摘要来自已有阅读投影；没有新增打字队列或生成进度引擎。等待文案统一“正在处理…”，页面旧断言同步更新，前述2026-10-23失败保留为历史记录。展开选择提升到当前页的tenant/session作用域，防止同会话权威刷新临时重挂Timeline丢失选择；不持久化、不保存正文或执行权威。实际验证证据由元仓FEAT-163/02和04维护。
