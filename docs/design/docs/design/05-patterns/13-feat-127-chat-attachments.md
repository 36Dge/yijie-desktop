# FEAT-127 Chat 附件 Pattern

## 文档状态

- 状态：Accepted Design / Desktop Manual Acceptance Pending
- 版本：1.1.0
- 最后更新：2026-08-18
- 适用 Feature：`FEAT-127`
- Contract impact：`semantic`
- 适用仓库：`yijie-desktop`
- 默认语言：中文

本文依据 FEAT-127 的明确需求与加号入口截图建立。它只取代
`12-feat-126-chat-app-shell-candidate.md` 中“仅支持文本”“不出现附件入口”和“拖入文件/图片必须拒绝”
的冲突段落；项目选择、只读权限、发送键盘语义、对话布局、推理记录、删除、错误和安全边界继续遵循
FEAT-126 Accepted Pattern。截图中的红框只是位置标注，不是产品样式。

本文的 `Accepted Design` 只表示用户已确认本地功能方向和统一加号语义，不表示实现已完成人工验收。当前只能称为 `Manual Acceptance Candidate Ready`；真实 Desktop picker、拖拽、发送、重开和恢复步骤尚未由用户记录结果，因此不得声明 `Local Candidate Complete`，G3/G4、commit/tag/pin 与 deploy 均保持各自的 `PENDING/NOT FORMED/N/A` 状态。

## 1. 目标与非目标

目标是让用户通过同一条消息发送有序的文本、图片与文件，并让已发送附件的安全元数据随对话历史加载。
附件在本机完成导入、解析和索引，七天内可作为 AI 上下文；到期后只保留历史展示所需元数据。

本期不设计或实现模型生成图片、生成文件的预览、下载和操作，不提供云同步、远程 URL、目录、压缩包、
SVG、宏文档、legacy `.doc`、OCR、图片编辑或附件粘贴。纯文本粘贴继续允许，文件与图片粘贴继续拒绝。

## 2. 统一入口

- 输入面板底部操作区最左侧放置一个稳定 `40px × 40px` 的加号图标按钮，位于“权限审批”之前。
- 加号是选择图片和文件的唯一入口；点击后直接打开包含两类格式的 native 文件选择器，不增加第二个图片
  按钮，也不要求用户先选择“图片/文件”类型。
- 图标使用 Lucide registry 的 `plus`，按钮使用现有 ghost action token。不得复制参考截图的红色描边、
  背景、圆角或其他品牌视觉。
- 可访问名称和 tooltip 均为“添加图片或文件”。按钮必须支持键盘聚焦与 Enter/Space 激活；焦点环不得被
  输入面板裁切。

## 3. 选择与拖拽

- 加号与拖拽必须进入同一 native 导入、格式验证、解析、索引和持久化路径。
- 整个 composer 是拖放目标。有效拖入时显示不改变布局尺寸的覆盖层，文案为“松开以添加图片或文件”；
  离开、取消或导入开始后立即移除覆盖层。
- WebView 只可在 Tauri drop 回调到 native command 之间瞬时转交用户显式路径。绝对路径不得进入组件
  property、Pinia、DOM、响应、错误、日志、遥测或持久化。
- 每条草稿最多 10 个附件。选择器和拖拽调用都把当前剩余容量交给 native 层；超出容量的整批输入在读取
  或持久化前拒绝，不能在 UI 截断后留下孤立本地副本。

## 4. 格式、大小与状态

- 单个附件最大 `10 * 1024 * 1024` 字节。图片允许 JPEG、PNG、WebP、GIF；文件允许 PDF、TXT、
  Markdown、CSV、JSON、YAML、XML、HTML、RTF、DOCX、XLSX、PPTX。
- 压缩包、目录、可执行文件、SVG、宏格式和 legacy `.doc` 必须在 native 边界拒绝。OOXML 只有在容器结构
  和资源上限校验通过后才作为 DOCX/XLSX/PPTX 接受。
- 草稿附件按 `queued -> importing -> parsing -> indexing -> ready` 的真实顺序显示“排队、导入、解析、建立索引、已就绪”。即使 native 快速完成，五个成功阶段也必须各自至少可观察 `220ms`；状态必须有文字或可访问名称，不能只依赖颜色或 spinner。失败进入持久的 `error_terminal`，等待用户关闭。
- Store 必须用当前 context、operation、draft epoch、连续 sequence、稳定 item count 和合法 transition 对 native aggregate event 与 command 结果进行对账。command 先拒绝时合成合法失败前缀及 `error_terminal`；后到 queued/中间事件不得覆盖失败终态。command 成功但返回附件和事件不可对账时，补偿删除本次新持久化草稿并 fail closed。
- 附件行显示类型图标、安全文件名、格式/大小和状态；长名称单行省略，不得挤压移除或发送按钮。
  图片和文件图标分别来自 Lucide registry 的 `image` 与 `file`。
- 失败项始终可移除，并明确提示“移除后重新选择”；不提供原地重试入口。移除成功必须同步删除尚未绑定
  消息的加密本地副本；native 删除失败时保留草稿并显示可执行错误。

## 5. 发送与失败恢复

- 允许纯文本、纯附件、文本加附件三种发送。没有文本且没有附件时仍禁止发送。
- 任一附件未就绪、正在导入、超过图片总量限制、项目/权限/Runtime/数据库未就绪或正在提交时禁止发送，
  并显示稳定原因。
- 文本块在前，附件按选择顺序排列；一次提交形成一条有序多模态 user message。仅附件创建 session 时，
  使用第一个安全附件名派生回退标题。
- Desktop 必须先原子持久化消息、内容块、附件绑定和 outbox，再调用 Agent Host。失败时保留文本和附件
  草稿；重试复用同一 operation 结果，不能产生重复消息或重复绑定。
- 发送成功后只清除 WebView 草稿引用，不删除已绑定附件。普通 `Enter` 发送、`Shift+Enter` 换行和 IME
  composition 规则保持不变。
- 应用 bind、进入 new composer 或切换 session 时必须先读取对应持久草稿。`listDraftAttachments` 失败不能当作“空草稿成功”：`draftTargetReady=false` 时发送、加号和拖拽全部关闭，并通过页面稳定错误入口提供“重试”。new target 在原 context 重载；session target 重试相同 target 后还要完成订阅、history/resync/control-plane，全部成功才重新开放 composer。

## 6. 对话历史与七天到期

- 已发送 user message 按原顺序显示文本、图片和文件 metadata。附件展示安全名称、类型、大小以及
  `bound` 或“已过期”状态；不得展示或暴露原始路径、原始字节、解析正文、索引或 data URL。
- 应用重开、切换 session、history 分页与 resync 后，附件 metadata 必须跟随所属消息恢复。
- Desktop schema authority 按 `migrations.rs` catalog 顺序应用 v6 `0006_chat_attachments`，再应用 v7 `0007_chat_attachment_draft_targets`。v7 为 ready 草稿增加 `new | session` target 和 target-scoped `draft_ordinal`；同秒批量选择、应用重开和删除后追加均只按 ordinal 恢复用户顺序，不按 timestamp/UUID 排序。无法判定 target 的未绑定 v6 ready 草稿 fail closed 删除，bound 历史保留。
- 附件从导入成功起保留七个 24 小时。到期后 Desktop 清除二进制、解析文本和索引，历史位置和 metadata
  保留并显示“已过期”；过期附件不能再进入 Runtime 上下文。
- 已进入 Runtime rollout 的历史上下文无法在本期按单个附件追溯擦除。永久删除 session 继续使用既有
  cleanup saga，并级联删除附件内容块、BLOB、索引与 staging 数据。

## 7. 状态、文案与可访问性

- 格式、大小、解析、容量、存储和过期错误使用稳定 typed error 映射，包含发生了什么和下一步；不得显示
  provider、SQL、绝对路径、文件正文、digest、token/key 或 raw error。
- 导入和状态变化使用克制的 `aria-live="polite"` 摘要，不逐项重复播报进度。移除按钮有稳定中文
  accessible name；Tab 顺序与视觉顺序一致：textarea → 加号 → 权限 → 发送。
- 220ms 是每个阶段的最短可观察时间，不是 native 解析延迟或人为阻塞；展示队列不得延迟数据库提交。迟到事件被丢弃时也不得重复播报或让终态回退。
- light、dark、1180×760、200% zoom、keyboard only、VoiceOver 和 reduced motion 纳入实现后检查。
  附件队列出现、状态变化、hover 或 focus 不得改变 composer 的固定操作区尺寸或造成控件重叠。

## 8. 验收清单

- [ ] 权限入口前只有一个 `40px` 加号入口，图标、tooltip、accessible name 和焦点状态正确。
- [ ] 加号与拖拽走同一 native 路径；绝对路径不进入 state、DOM、响应、日志或数据库。
- [ ] 单项 10 MiB、最多 10 项、支持格式和压缩包/宏/伪装格式拒绝规则一致。
- [ ] 纯附件可发送；未就绪不能发送；失败保留草稿；移除同时删除未绑定本地副本。
- [ ] bind/new/session 草稿读取失败时发送、加号和拖拽 fail closed；页面重试恢复相同 target，session 还需恢复完整 history/control-plane。
- [ ] `queued`、`importing`、`parsing`、`indexing`、`ready` 各至少显示 220ms；command 先拒绝后迟到事件不能覆盖 `error_terminal`。
- [ ] 多模态消息顺序、应用重开历史和过期 metadata 正确，原始内容不从 IPC 泄漏。
- [ ] v6->v7 权威迁移链、v6 unroutable draft 清理和 target-scoped `draft_ordinal` 的同秒/重开/删除后追加顺序符合设计。
- [ ] 七天后 BLOB、解析文本和索引物理清除，过期附件不再进入 Context。
- [ ] light/dark、1180×760、200% zoom、keyboard、VoiceOver 与 reduced motion 检查通过或如实登记 NOT RUN。

## 9. 变更与批准记录

- 2026-08-18 / 1.1.0：同步真实候选实现：v6->v7 草稿 target/ordinal、草稿恢复 fail-closed + 页面重试、五阶段各至少 220ms，以及 command 拒绝/迟到事件的单调终态修复；明确用户 Desktop 人工验收前不得声明 `Local Candidate Complete`。
- 2026-08-17 / 1.0.1：附件解析失败恢复统一为“移除后重新选择”，删除未发布的附件原地重试入口和状态。
- 2026-08-17 / 1.0.0 Accepted：根据用户明确提出的 FEAT-127 本地实现需求、统一加号截图和七天生命周期
  要求建立；批准范围不包含 Git commit、push、tag、云资源、生产部署或付费模型调用。

## 关联文件

- `02-chat-workspace.md` 1.1.0（其余规则继续有效）
- `12-feat-126-chat-app-shell-candidate.md` 1.1.0（仅覆盖本文列出的冲突段落）
- `yijie/docs/features/FEAT-127-multimodal-chat-attachments/`
