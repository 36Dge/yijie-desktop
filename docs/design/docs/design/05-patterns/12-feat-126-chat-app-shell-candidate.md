# FEAT-126 Chat / App Shell Pattern 候选

## 文档状态

- 状态：Accepted
- 候选版本：1.0.0
- 最后更新：2026-08-02
- 适用 Feature：`FEAT-126`
- Contract impact：`breaking`
- 适用仓库：`yijie-desktop`
- 默认语言：中文

本文件已由段成威于2026-08-02在FEAT-126 G2批准，但不是业务实现授权。它仅取代
`01-app-shell-navigation.md` 2.0.0与`02-chat-workspace.md` 1.1.0中与FEAT-126 `/chat`入口、活跃会话、
项目/会话导航相关的冲突段落；其余全局规范继续有效。

## 1. 目标与非目标

目标是把 `/chat` 从本地 textarea 入口升级为生产级的文本任务创建与极简对话流，同时保持易界
Design System、macOS 平台习惯、明确权限边界与可访问性。

本期只支持文本。明确不提供附件/文件/图片、模型选择、推理强度、语音输入、可写审批、用户消息
复制/二次编辑、模型结果复制/like/dislike/分叉、页面级置顶和 Chat 二级侧栏开关。

“不提供复制”指不提供产品动作或工具栏；不得阻止 macOS 原生文本选择与 `⌘C`。

## 2. App Shell 冻结

- 保留全局 240px 展开 / 72px 图标 App Shell 以及现有全局收起偏好；FEAT-126 不再创建第二个
  “显示/隐藏侧边栏”按钮、会话 rail 或页面内 drawer。
- 展开态的 Chat 导航区可显示项目树和最近 session；72px 收起态隐藏嵌套树，仅保留批准的全局入口
  图标与 tooltip。用户需展开全局侧栏后操作项目/session。
- `/chat` 是新建任务和单个 session 对话的统一工作区；`/tasks` 继续是跨项目、完整任务记录入口，
  不与 Chat 最近记录重复成第二个全量列表。
- 主内容不设置右侧上下文面板。权限、项目与 session 操作都使用本文定义的窄入口，不创建常驻 inspector。
- 在 1180×760 最小视口，侧栏和主区不得出现双层水平滚动；主对话列最大宽度 880px，布局保持居中。

## 3. 信息架构

展开态侧栏 Chat 区顺序固定为：

1. “新建任务”入口。
2. 已置顶项目，随后是未置顶项目；同组按 `last_used_at DESC, project_id DESC` 稳定排序。
3. 每个展开项目下显示最近 session：置顶组优先，再按 `last_activity_at DESC, session_id DESC`。
4. “任务记录”跳转 `/tasks`，用于加载完整、跨项目记录。

项目菜单只允许“置顶项目/取消置顶”和“移除”。移除仅撤销本地项目引用，不删除目录，也不级联删除
历史 session。session 菜单只允许“重命名”“置顶/取消置顶”“永久删除”；永久删除进入危险确认与已批准
的数据清理 saga，不使用 soft delete。

## 4. 新建任务入口态

页面保持单列、低干扰。核心 composer 自上而下为：

- Native 项目选择入口：首次 turn 必选；只显示安全名称，不把绝对路径交给 WebView。
- “权限审批”只读入口：展示固定 `read-only / deny` 策略及原因，不允许提升权限。
- 可访问 label 为“输入你的任务需求”的多行文本框。
- 输入框内的发送按钮；空白、项目无效、权限/Runtime/DB 未就绪或正在提交时 disabled，并显示具体原因。

点击发送或 `⌘Enter` 只提交一次。普通 `Enter` 换行；IME composition 中不得提交。Desktop 必须先完成
本地 session/user-message/outbox transaction，成功后再路由 `/chat/:sessionId`；transaction 失败保留输入并
显示 typed error，不创建空 session。拖入或粘贴文件/图片必须拒绝，纯文本 paste 允许。

## 5. 活跃对话流

- 对话列只显示用户文本、模型推理记录、模型回答以及必要的 loading/error/interrupted 状态。
- 用户消息不渲染产品级复制或编辑动作。模型回答不渲染复制、like、dislike、分叉动作。
- 本期不展示工具调用、审批卡片、文件结果卡或右侧 panel；若 Runtime 产生未支持 reverse request，
  Host 必须拒绝，UI 只显示安全的失败状态。
- 输入区固定在主工作区底部安全区域，支持继续纯文本 turn 和停止 active turn；不出现附件、模型、
  reasoning effort 或语音入口。
- 内容自然增长；用户距离底部不超过 48px 时跟随新内容。用户主动向上滚动后停止自动跟随。
- 距离底部超过 160px 时，在对话列底部上方显示圆形“一键回到底部”按钮；点击后滚至最新内容并恢复
  follow。reduced-motion 下立即跳转，其他情况使用批准的短时语义动效。按钮命中区不小于 36×36px，
  `aria-label="滚动到对话底部"`，不得抢走正在阅读内容的焦点。

## 6. 模型推理记录

- 标题固定为“模型推理记录”，按 item 显示展开/折叠入口；默认流式时展开，历史重新加载时默认折叠，
  用户本页选择可保持到离开 session。
- 展示内容是 fixed Runtime 投影的 raw reasoning，不承诺完整、稳定、准确，也不等同模型全部内部思维。
- raw reasoning 必须用普通文本节点呈现；不得解析 Markdown/HTML、激活链接、执行命令或创建 tool action。
- 流式 delta 在内存显示；finalized/显式 incomplete 由 Desktop SQLCipher 历史权威重新加载。历史展开前只
  显示状态、item count、byte count 和耗时等 content-free metadata，不预取正文。
- `incomplete` 必须显示“推理记录不完整”及安全原因；`unavailable` 显示明确错误并使 reasoning 功能
  Gate 失败。不能退化为只有“已处理 6m 22s”却宣称具体文字能力可用。
- raw 正文不得进入日志、遥测、审计、错误、删除 receipt、Host bbolt/replay 或云端。

## 7. 历史与选择竞态

- session 列表只加载 metadata，page 最大 50；点击具体 session 后才加载 history。
- history 使用 opaque cursor，默认 20、最大 50 turns；同页批量加载 reasoning metadata，不读取 raw body。
- 用户展开 reasoning 时一次只加载当前 turn raw body，最大 256 KiB。切换 session 立即取消旧请求并增加
  selection generation，迟到响应不得覆盖当前 session。
- 历史顶部/底部边界、加载更多、空、not found、permission denied、DB error 必须是可判定状态；不能用
  空白页面或无限 spinner 表示失败。

## 8. 状态与错误

入口和活跃页必须覆盖：`auth_loading`、`permission_denied`、`runtime_not_ready`、`project_missing`、
`entry_empty`、`entry_ready`、`submitting`、`list_loading/empty/error`、`history_loading/not_found/error`、
`streaming`、`stopping`、`completed`、`interrupted`、`reasoning_incomplete/unavailable`、
`db_read_only/full/corrupt/migration_failed`、`deleting/delete_failed`。

错误文案只包含稳定 code 与用户可执行的恢复动作，不显示 provider、SQL、绝对路径、token/key 或 raw error。
permanent delete 只有 Desktop/Host/Runtime required surfaces 与 SQLCipher checkpoint 全部完成后才显示成功。

## 9. 视觉与动效

- 使用既有易界 semantic tokens、字体、圆角、边框、阴影和 light/dark theme；不复制参考截图的像素或
  引入 Codex 品牌资产。
- 视觉密度吸收 Codex 的单列阅读层级和 Linear 的克制信息密度；主操作只有发送/停止，次级入口使用
  icon + tooltip，不制造大面积工具栏。
- hover/focus/active/disabled/error 状态在 light/dark 下均达到现有可访问性基线。焦点环不能被
  `overflow:hidden` 裁切。
- 所有非必要动效遵循 `prefers-reduced-motion`；推理流式文字不得通过逐字动画重复朗读。

## 10. 键盘与辅助技术

- Tab 顺序与视觉顺序一致：全局导航 → 项目/权限 → composer → send → conversation → active controls。
- 每个 icon-only action 有稳定中文 accessible name；menu 支持方向键、Enter/Space、Escape 并恢复触发器焦点。
- reasoning disclosure 使用原生 button 语义、`aria-expanded` 和关联内容 ID；状态变化使用克制的
  `aria-live=polite` 摘要，不播报每个 delta。
- VoiceOver 能区分“用户消息”“模型推理记录”“模型回答”和 incomplete/error 状态；消息正文保持可选择。
- 200% zoom、键盘 only、VoiceOver、light/dark、1180×760 与 reduced motion 是批准前/实现后的必测矩阵。

## 11. 验收清单

- [ ] 只有一个全局 240/72 App Shell toggle；Chat 内无二级 sidebar toggle/right panel。
- [ ] 新建任务只有项目、只读权限、文本和发送；没有附件/模型/强度/语音。
- [ ] commit 成功才进入 `/chat/:sessionId`，失败保留输入，重复提交只产生一个 session/turn。
- [ ] 用户/模型工具栏不存在被删除的产品动作，原生文本选择与 `⌘C` 仍有效。
- [ ] scroll-bottom 阈值、follow/reduced-motion、焦点和 accessible name 符合本文。
- [ ] raw reasoning 具体文字、折叠、partial/unavailable、历史懒加载和 no-rich-execution 符合本文。
- [ ] session 排序/菜单、项目排序/菜单及永久删除/移除语义精确。
- [ ] loading/empty/error/permission/DB/Runtime/delete 状态完整。
- [ ] light/dark、1180×760、200% zoom、keyboard、VoiceOver、reduced-motion 评审通过。

## 12. 变更与批准记录

- 2026-08-02 / 1.0.0 Proposed：根据 FEAT-126 G1 已批准产品语义、ADR-0013/0014/0016 与
  DESIGN-126-003 建立 G2 Closure候选；没有修改业务代码。
- Owner approval：段成威，Accepted 2026-08-02。批准范围为本文定义的FEAT-126冲突段落；不授权业务编码。

## 关联文件

- `01-app-shell-navigation.md` 2.0.0（当前 Accepted）
- `02-chat-workspace.md` 1.1.0（当前 Accepted）
- `yijie/docs/features/FEAT-126-public-task-authorization-hardening/`
- `yijie/docs/adr/ADR-0013-desktop-local-conversation-data-authority.md`
- `yijie/docs/adr/ADR-0014-desktop-conversation-protection-and-deletion-boundary.md`
- `yijie/docs/adr/ADR-0016-display-raw-model-reasoning.md`
