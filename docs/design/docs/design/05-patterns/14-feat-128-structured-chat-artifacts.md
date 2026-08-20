# FEAT-128 对话流结构化 Artifact Pattern

## 文档状态

- 状态：Accepted
- 版本：1.0.0
- 最后更新：2026-08-20
- 适用 Feature：`FEAT-128`
- Contract impact：`semantic`
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

本文已由 Owner 在 2026-08-20 的 FEAT-128 G2 closure 中接受为 Design Pattern。Contracts S1/S2 与
downstream pin-only preflight 随后通过，G2A 已批准。Desktop S4 native foundation 已实现：SQLCipher v8
expand-only authority、严格 v3 event/report adapter、owner-bound content/poster transfer、commit 后幂等 ACK、
7 天 TTL/cleanup receipt，以及唯一新增的 metadata-only 只读 Tauri command `chat_load_history_v3`。S4 没有
新增 capability、CSP、外部 origin、renderer UI 或保存能力；模型调用、真实 provider、云资源、发布或生产配置
仍不在授权范围。

## 目标

定义 ChatGPT 类对话流中的结构化 Artifact 展示候选，使模型回答可以在 Markdown 文本之外，逐步展示生成的
图片、视频、文件和数据分析报告，并提供专业的预览、下载、状态反馈和可访问交互。

本 Pattern 的核心要求是 Artifact 一经服务端宣布就进入对话流，随后在同一稳定位置更新进度、可预览状态或
失败状态；界面禁止等待全部内容生成完成后才一次性出现结果。

## 适用范围

适用于 `/chat/:sessionId` 中由 Agent/LLM 生成的输出 Artifact，不适用于用户在 composer 中添加的输入附件。
用户输入附件继续遵循 `13-feat-127-chat-attachments.md`。本文虽已 Accepted，仍只为 FEAT-128 定义新边界，
不回写或篡改 FEAT-127 的历史范围。

本期候选覆盖：

- 图片生成结果及灯箱预览；
- 视频生成结果及播放预览；
- 生成文件的元数据、预览与下载入口；
- 数据分析报告的摘要、关键指标、内容预览与下载入口；
- `announced`、`progress`、`ready`、`failed` 及过期、不可预览、未知版本状态；
- 历史恢复、流式更新、键盘、VoiceOver、亮色/暗色和 1180×760 最小窗口。

本候选不批准云端存储、公开分享链接、跨设备同步、外部 URL 导航、在线协作编辑、视频剪辑、图片编辑、
文件内容执行或生产发布。

## 规范正文

### 1. 对话流信息架构

- Artifact 必须属于一条明确的 assistant message 或当前 live turn，并按服务端给出的稳定顺序显示。
- assistant 文本、推理记录和 Artifact 可以并行流式更新；Artifact 不得阻塞文字首屏输出。
- 同一 Artifact 从宣布到终态必须复用同一个容器和稳定 key，不得在每次进度更新时插入新卡片、改变顺序或
  把滚动位置推离用户正在阅读的内容。
- 单个 Artifact 是可以使用卡片边界的独立重复项；页面 section 和整条模型回答不得再包一层装饰性卡片。
- 图片结果可以在可用宽度内组成最多两列的稳定网格；视频、文件和报告默认占满对话内容列。窄宽度或
  200% zoom 时全部回落为单列。
- 多个 Artifact 的加载、失败和完成互不遮蔽；一项失败不得让已经 ready 的其他结果消失。

### 2. 通用结构与操作

每个 Artifact 容器必须包含：

1. 类型图标或可预览媒体区域；
2. 安全名称或稳定回退标题；
3. 类型、格式、大小等已确认的安全元数据；
4. 当前状态及必要的下一步；
5. 仅在能力可用时出现的预览、下载、重试或重新生成操作。

操作按钮必须使用 Lucide registry 中的熟悉图标，并提供稳定中文 `aria-label` 和 tooltip。主要预览区域可以
整体作为“预览”按钮，但必须保留清晰焦点环，且不得只依赖双击、hover 或触控手势。

下载文件名必须来自服务端验证后的安全名称。名称过长时单行省略，但 tooltip 或详情必须能读取完整安全名称；
名称、状态和操作不得互相挤压或造成布局跳动。

`provenance=synthetic` 是受信 metadata，不由 UI 推断。local-only fixture 必须显示“本地合成演示”来源标识，
并在历史恢复/resync 后保持；未带可信 provenance 的结果不能显示为真实模型生成。

### 3. 渐进式状态

Artifact 状态必须投影为以下可观察 UI 阶段：

| 状态 | 展示要求 | 可用操作 |
|---|---|---|
| `announced` | 立即显示稳定占位、类型和“已开始生成”；未知进度不得伪造百分比 | 可以显示服务端明确允许的取消入口；不得预览或下载 |
| `progress` | 在同一卡片更新具体阶段；有可信总量时显示百分比，无总量时使用不定进度和阶段文案；本候选不传输 partial bytes/快照 | 未 ready 时不得预览或下载最终文件 |
| `ready` | 显示完成态、最终元数据和可用预览；不得继续显示循环 spinner | 按能力提供预览、下载或打开报告 |
| `failed` | 持久显示发生了什么及下一步，不自动消失，不泄漏 raw error | 仅在服务端标记可重试时显示“重试生成”；否则显示可执行恢复文案 |

- wire `item.artifact.started` 映射为 `announced`；wire `item.artifact.progress` 只更新阶段/百分比；wire
  `item.artifact.completed/status=ready` 先进入 native `transferring`，只有本地校验和持久化成功才投影为 UI
  `ready`。这两个 `ready` 不可混用。
- 进度百分比必须单调且来自权威事件；Desktop 不得根据经过时间估算或补齐到 100%。
- 状态文案必须具体，例如“正在渲染第 2 页”或“正在整理报告内容”，禁止长时间只显示“加载中”。
- `aria-live="polite"` 只播报阶段摘要、完成和失败，不逐帧、逐字节或逐个 delta 重复播报。
- 进度区域使用 `aria-busy`；已知进度使用具备 `aria-valuemin`、`aria-valuemax` 和 `aria-valuenow` 的 progress
  语义。视觉颜色不是状态的唯一表达。
- 终端状态不得回退到进行中；迟到、重复或乱序事件必须在领域/store 层 fail closed，不由组件猜测修复。
- 用户向上阅读时，Artifact 更新遵循现有 Chat follow 阈值，不得强制滚动到底部。

### 4. 图片 Artifact

- `announced/progress` 使用固定宽高比媒体区域，避免图片就绪后改变对话布局。本候选的 progress 只包含
  权威阶段或百分比，不传输 partial bytes/快照；因此生成中保持占位和进度覆盖层。未来若引入渐进快照，
  必须先增加版本化 resource reference、digest、权限、替换和 cleanup 契约，不能由 renderer 自行猜测。
- `ready` 展示实际图片，使用描述结果内容的替代文本；不能从文件名机械生成无意义 alt。没有可靠描述时，
  使用“AI 生成图片”并在相邻文本显示安全名称。
- 点击图片或“预览图片”打开灯箱 dialog。灯箱必须支持 Escape 关闭、关闭按钮、焦点锁定与关闭后焦点恢复；
  图片按完整内容适配视口，不以模糊背景或侵入式裁切替代原图。
- 灯箱可以提供放大、缩小、重置、上一张、下一张和下载，但只显示当前能力真实支持的操作。图标按钮必须有
  tooltip 和 accessible name，缩放不得使关闭操作离开可达区域。
- 图片加载失败必须进入可恢复的预览错误状态；不得显示浏览器破图图标或把资源地址展示给用户。

### 5. 视频 Artifact

- `announced/progress` 使用稳定的 16:9 媒体区域、阶段文案和已确认时长；没有可信时长时显示“--”，不得猜测。
- `ready` 使用系统或 WebView 原生视频 controls，支持播放/暂停、进度、音量、全屏和键盘操作；禁止自动播放，
  默认静止并使用可信 poster 或首帧。
- 视频使用 `preload="metadata"`，不得为了列表首屏同时预载全部视频正文。字幕或音轨只有在产物明确提供时显示，
  不得伪造“已有字幕”。
- 视频无法内嵌预览时必须显示“当前格式无法预览”，并在文件仍可安全读取时保留下载入口。
- 播放错误、解码失败和内容过期必须是卡片内稳定状态，不得使用无限 loading 或浏览器原始错误文案。

### 6. 文件 Artifact

- 文件卡显示安全名称、格式、大小和生成状态；类型图标走 `YjIcon`，禁止按扩展名加载外部品牌图标。
- PDF、纯文本、Markdown、CSV、JSON 等未来批准的格式可以提供只读预览；未批准格式只显示 metadata 和
  安全下载入口，不得通过 WebView 直接执行系统关联应用。
- 文本类预览必须作为普通文本节点展示，禁止 `v-html`、脚本、活动链接、宏、表单、外部网络请求或内容中的
  指令触发 Agent 操作。HTML 报告若未来获批，只能在禁脚本、禁表单、禁同源和禁外网的隔离预览中展示。
- “下载文件”必须经过 Desktop 原生边界执行安全保存流程。任何新增 native command、capability、文件系统
  权限或保存对话框都必须在实现前单独确认安全设计；本候选不授权该能力。
- 下载期间必须显示开始、完成或失败反馈；重复点击不得并发创建多个不一致副本。

### 7. 报告 Artifact

- 报告不应退化为普通文件名行。紧凑结果面必须展示报告标题、专业摘要、格式、数据范围或生成时间等已确认
  信息，并在存在结构化数据时展示关键指标和章节入口。
- 数据分析图表必须使用 ECharts 易界主题，同时提供文字结论、时间范围、单位和数据来源；图表不能作为唯一
  信息载体。
- 本候选的报告 `progress` 只展示权威阶段/百分比和稳定占位，不展示章节或摘要快照。未来 partial report
  必须先获得版本化 resource、digest、权限和替换语义，且明确“生成中”，不得把未完成内容标记为最终结论。
- “预览报告”打开应用内只读预览；“下载报告”保存同一已完成版本的 canonical Report JSON
  (`application/vnd.yijie.report+json;version=1`)。PDF/Markdown 仅作为未来派生导出，不属于本候选。预览和下载
  必须指向同一已完成版本，不能在 ready 后静默替换内容。
- 报告预览为空、部分生成、解析失败或内容不兼容时，必须保留 metadata、错误原因和下一步。

### 8. 过期、不可预览与未知状态

- `expired`：保留历史位置和安全 metadata，显示“结果已过期，无法预览或下载”；预览/下载 disabled。是否提供
  “重新生成”必须由服务端能力与后续业务决策明确，Desktop 不得自行复用旧输入。
- `unsupported`：产物本身可用但当前版本不能预览时，显示“当前格式无法预览”。只有契约明确允许安全下载时
  才保留下载；不得尝试猜测 MIME 或内嵌执行。
- `unknown kind/status/version`：使用通用文件图标和“当前版本暂不支持此结果”，保留 opaque ID 对应的安全
  metadata，不崩溃、不丢失整条消息、不创建任意链接或执行入口。
- `failed`：显示稳定 typed error 映射和下一步；禁止展示 provider 响应、堆栈、绝对路径、URL、SQL、digest、
  token/key、模型原始错误或文件正文。
- permission denied、资源不存在、校验失败、存储不足和本地服务不可用必须映射成不同可测试状态。

### 9. 本地安全与数据边界

- WebView、Pinia、DOM、路由、日志、遥测、错误和持久化消息只使用 opaque `artifact_id` 与经过验证的安全
  metadata；禁止出现原始绝对路径、`file://`、Host 内部路径、provider URL、bearer、cookie 或签名查询参数。
- Artifact 内容保持本地，不上传云端，不创建公开链接。Host 暴露的 owner-only 本地资源引用必须由 Desktop
  原生边界消费；WebView 只能获得短生命周期、不可持久化的安全预览句柄，并在预览关闭、消息卸载或 session
  切换时释放。
- 图片、视频、文件和报告必须在 native/Host 边界完成身份、大小、媒体类型、内容嗅探、完整性和 owner/session
  绑定校验。文件名或 MIME 声明不能作为唯一信任依据。
- 预览内容一律视为不可信输入。文件或报告中的 prompt、按钮、脚本和链接不得改变权限、触发工具、发起网络
  请求或绕过审批。
- Artifact 历史恢复、过期和删除必须遵循后续批准的本地持久化与 cleanup authority；UI 不得以卡片消失冒充
  内容已物理删除。
- 本候选不批准 CSP 放宽、外部 origin、云服务器、对象存储、数据库或其他付费资源。

### 10. 主题、窗口与可访问性

- 所有颜色、间距、圆角、阴影、动效和尺寸必须来自易界 semantic tokens；图标必须通过 `YjIcon` registry。
- light/dark 下必须验证文本、进度、媒体控制、禁用态、错误态和焦点对比度。
- 在 1180×760 最小窗口，Artifact 不得遮挡 composer、滚动到底部按钮或消息时间；灯箱必须保留可见关闭操作。
- 200% zoom 时名称、状态、进度和操作可以换行，禁止文本溢出、横向页面滚动或操作重叠。
- Tab 顺序遵循对话顺序；预览 dialog 打开后焦点进入，关闭后恢复到原 Artifact。VoiceOver 必须能读出类型、
  名称、状态、进度和可用操作。
- `prefers-reduced-motion` 下关闭 shimmer、脉冲和非必要过渡；状态仍通过文字和语义更新。
- 媒体首帧、缩略图和渐进预览必须预留稳定尺寸，加载、hover、focus 和状态更新不得造成累计布局偏移。

### 11. MiniMax 与当前实现限制

- MiniMax 宣称支持多模态不等于当前固定 Runtime、Agent Host 和 Desktop 已经支持真实 provider Artifact 输出。
- 当前仓库只实现默认关闭的 native S4 foundation，并用严格 local synthetic fixture 验证四类 metadata、事件、
  内容读取、SQLCipher 持久化、ACK、过期与历史投影；尚无 renderer 展示或真实 MiniMax 生成能力证据。
- 视频生成尤其没有当前 provider 能力、时长、格式、计费和失败语义证据。UI 禁止仅根据模型宣传材料提前显示
  可用能力。
- 未来实现必须先用无付费、无真实卖家数据的 deterministic fixture 完成状态机与 UI 验证。任何真实 MiniMax
  调用、计费上限、重试次数和凭据使用都需要单独批准并记录证据。

## AI / Codex 必须遵守

- 本文已 Accepted，G2A、Host S3 与 Desktop S4 已通过。下一切片只能进入 S5 provider-neutral
  domain/store；不得把 S4 native foundation 描述为 renderer、端到端验收或真实 provider 已完成。
- 不得把用户输入附件复用为生成 Artifact，也不得从 Markdown 链接、文件名或模型自然语言猜测结构化结果。
- 必须从权威结构化事件消费 Artifact；未知 kind、status 或版本必须 fail closed 并显示兼容状态。
- 必须先显示 `announced/progress`，不得为了实现简单而等待 ready 后才插入卡片。
- 禁止把 base64、大文件正文、绝对路径、provider URL 或凭据放入 Vue props、Pinia、DOM、日志或测试快照。
- 禁止用 `v-html` 渲染报告或文件内容，禁止放宽 CSP 或增加外部网络目标来完成预览。
- 必须复用设计 token、Naive UI、Yj 组件与 Lucide registry，不引入第二套 UI、图标、播放器或预览库。
- 状态、错误、键盘、VoiceOver、reduced motion、light/dark 和最小窗口必须有自动或人工验证证据。

## 实现要求

本文获批并得到实现授权后，代码必须按以下边界落地：

- `src/domain/`：Artifact UI 状态机、未知值策略、格式化和纯映射；
- `src/components/chat/`：可复用的 Artifact 列表、图片、视频、文件、报告和预览组件；
- `src/stores/`：按 session/turn/item identity 合并单调事件，不持有原始路径或大文件正文；
- `src/pages/chat/`：只组合 assistant message、live turn 和预览入口，不解析 wire 或执行下载副作用；
- `src-tauri/`：经单独安全批准后负责 owner 校验、内容读取、临时预览句柄、保存和生命周期释放；
- Agent Host 与 Contracts：由对应仓库定义并评审权威事件、历史恢复、读取、过期、错误和兼容语义。

实现必须先固定不可变 Contracts 引用和 provider-first conformance，再由 Desktop 消费；不得在 Vue 中手写一份与
权威契约重复的 DTO。若保存、预览或播放需要新增依赖、Tauri plugin、command、capability、CSP 或外部目标，
必须在编码前取得明确批准。

## 验收清单

- [x] 本文状态已由 G2/Owner 明确批准为 Accepted；G2A、Host S3 与 Desktop S4 已通过。
- [x] S4 native authority 持久化单调进度、校验/加密 content 与 poster、commit 后 ACK、TTL receipt，并且
  private IPC v3 只返回安全 metadata；默认 flag 为关闭。
- [ ] Artifact 在 `announced` 时立即出现，并在同一稳定位置进入 `progress/ready/failed`。
- [ ] 有可信进度才显示百分比；未知进度、完成、失败和迟到事件语义正确。
- [ ] 图片卡和灯箱、视频 controls、文件预览/下载、报告摘要/预览/下载符合本文。
- [ ] expired、unsupported、unknown、permission、not found、integrity、storage 和 service error 状态完整。
- [ ] WebView、state、DOM、日志和错误中的绝对路径、provider URL、凭据、正文和大 base64 命中为 0。
- [ ] 不可信预览不能执行 HTML、脚本、链接、宏、表单、网络请求、工具或审批动作。
- [ ] 历史恢复、session 切换、resync、删除和过期不会产生错位、重复、终态回退或虚假删除声明。
- [ ] light/dark、1180×760、200% zoom、keyboard only、VoiceOver 和 reduced motion 完成验证。
- [ ] deterministic fixtures 和自动测试先通过；真实 MiniMax 能力、调用次数和费用只有单独批准后才验证。
- [ ] 无云资源、公开链接、生产部署、release/tag 或上线就绪声明。

## 变更与批准记录

- 2026-08-20 / 0.1.0 Proposed Candidate：根据 FEAT-128 需求形成 ChatGPT 类结构化 Artifact UI 候选，覆盖
  图片、视频、文件、报告、渐进式状态、预览/下载、安全边界和无云资源的本地限制。
- 2026-08-20 / 1.0.0 Accepted：G2 closure 冻结 turn-level cancel、synthetic/real 分层、report unknown optional/required、bounded preview/save 与 retention 展示语义。
- 2026-08-20 / S4 native foundation：实现 SQLCipher schema v8、严格 v3 adapter、原生 transfer/ACK/TTL/delete
  和 metadata-only private history v3；未实现 S5-S9 renderer/CSP/save/provider 能力。
- Owner approval：段成威，`APPROVED`（用户明确 G2 指令由 Codex 代录；不声称独立人工评审）。
- Desktop implementation approval：`GRANTED AFTER G2A FOR PLANNED S4+ ONLY`。精确 pin commit 为
  `96094419d963745529ed0fa246919089e659f20d`；它只包含 provenance/conformance，不包含业务实现。
  本文不授权真实 MiniMax/provider、tag、push、release 或生产激活。

## 关联文件

- `02-chat-workspace.md` 1.1.0（Accepted，全局 Chat 结构）
- `12-feat-126-chat-app-shell-candidate.md` 1.1.0（Accepted，活跃对话与流式基础）
- `13-feat-127-chat-attachments.md` 1.1.0（Accepted，用户输入附件；当前不含生成 Artifact）
- `docs/design/docs/design/01-foundations/05-accessibility-baseline.md`
- `docs/design/docs/design/03-ui-system/04-data-visualization.md`
- `docs/design/docs/design/04-components/05-feedback-components.md`
- `docs/design/docs/design/04-components/06-data-display-components.md`
- `yijie/docs/features/FEAT-128-structured-chat-artifacts/`
