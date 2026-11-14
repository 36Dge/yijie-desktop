# FEAT-127 Chat 附件 Pattern

## 文档状态

- 状态：Accepted Design / Desktop Manual Acceptance Pending
- 版本：1.2.0
- 最后更新：2026-10-29
- 适用 Feature：`FEAT-127`；下述限定增补适用于已授权的 `FEAT-165` 候选
- Contract impact：`semantic`
- 适用仓库：`yijie-desktop`
- 默认语言：中文

本文依据 FEAT-127 的明确需求与加号入口截图建立。它只取代
`12-feat-126-chat-app-shell-candidate.md` 中“仅支持文本”“不出现附件入口”和“拖入文件/图片必须拒绝”
的冲突段落；项目选择、只读权限、发送键盘语义、对话布局、推理记录、删除、错误和安全边界继续遵循
FEAT-126 Accepted Pattern。截图中的红框只是位置标注，不是产品样式。

本文的 `Accepted Design` 只表示用户已确认本地功能方向和统一加号语义，不表示实现已完成人工验收。当前只能称为 `Manual Acceptance Candidate Ready`；真实 Desktop picker、拖拽、发送、重开和恢复步骤尚未由用户记录结果，因此不得声明 `Local Candidate Complete`，G3/G4、commit/tag/pin 与 deploy 均保持各自的 `PENDING/NOT FORMED/N/A` 状态。

## FEAT-165 已接受的限定增补

### 2026-11-11 草稿附件尺寸收紧

按用户最新截图反馈，输入框中文档附件的底纹高度由 44px 调整为 36px，水平内边距
由 16px 调整为 12px、垂直内边距由 8px 调整为 4px，圆角采用 12px；保留原文件名
字号与图标。输入图片缩略图由 80×80px 调整为 64×64px，复用现有间距 token。
移除按钮、路径提示和图片大图预览沿用原交互；已发送附件尺寸保持。

`contract-impact = none`：仅收紧 Desktop 草稿附件的展示尺寸；Desktop 私有 IPC、
API/Agent Host、原生权限、本地持久状态及重放边界均无可观察变化。
本节覆盖下文历史记录中的 44px 文档底纹与 80px 草稿图片尺寸。

验证：三个相关组件文件共 52 项用例及受影响 Vue 文件 ESLint 通过，执行时应用已有
安全排除清单。实机复查 1339×843、1180×760 的亮色与 WebKit 临时暗色模拟，文档和
图片并排显示、图片大图、Tab 聚焦、Escape 关闭及移除均正常。临时图片已移除，原
Markdown 草稿保留；检查器关闭并恢复系统配色与默认窗口。原开发页面服务已断开，
故通过 ⌘Q 正常退出后用固定 `pnpm client:dev` 恢复，并确认新尺寸生效。
未运行原生测试或全量回归；不新增尺寸镜像测试，不执行攻击或故障注入验证。

### 2026-11-11 文档附件与路径提示调整

按用户提供的参考图，草稿文档采用 44px 高的浅中性底圆角块，显示彩色折角图标与
半粗文件名，右上角的独立移除按钮在 hover/focus 时出现，保留文件图标。已发送文档
使用紧凑的细边框卡片，位于正文气泡上方，不叠加外层灰色气泡；多文档自然换行。
图片展示和生成产物卡片不受此调整影响。

同日后续反馈：已发送文档的描边使用弱边框 token 的 55% 混合色，圆角由 8px 增至
12px。此样式调整为 `contract-impact = none`；配套的已绑定上传文档预览修复为
`semantic`，审计原因与原生边界见 `17-feat-166-conversation-file-preview.md`。

草稿路径提示复用 NTooltip 和统一 tooltip token；提示只在当前草稿授权范围内按需读取。
来源丢失的原因是 watch getter 每次创建新数组：同 contextId 的正常授权续期也被误判
为 scope 切换，并调用 clear 删除原生来源记录。现按 contextId 与 draft target 的值比较；
临时 busy 仅使在途读取失效，不清除仍由当前草稿持有的来源。真实换上下文/草稿、移除、
发送或卸载继续清理，Native 每次 read 的授权和原 30 秒展示期限保持。已被旧逻辑清除
或应用重开后无法确认的来源不能从文件名反推，提示重新添加文件。

`contract-impact = none`：只修正前端显示与不必要的 clear 调用，Desktop 私有 IPC、
API/Agent Host、原生权限、持久化及重放边界不变。此轮不重建原生客户端。

已完成定向组件、路径保留和侧栏 tooltip 用例、ESLint 与类型检查。真实客户端中同一份
Markdown 草稿保留超过 5 分钟，再次移入仍返回完整 Downloads 来源路径；文档图标在
移除按钮出现时保留。已有四个上传文档在正文上方独立排列并在窄分栏换行。侧栏实际
DOCX 的路径采用统一 tooltip，正文和原阅读位置保持可见。已复查亮/暗配色、1339×843
与 1180×760，清理本轮验收附件并恢复系统配色/默认窗口。仅做本次前端验证，未执行
原生测试、全量回归或新增模型调用。

### 2026-11-11 用户添加图片的展示调整

用户授权输入图片采用并排 80px 缩略图、右上角移除按钮；发送后采用 128px 图片叠放，
末张轻微旋转，图片位于正文气泡上方。悬停、键盘聚焦或点击可显示最大 288px 大图，
Escape 关闭。正常导入阶段不显示过程卡或状态文字，也不再逐阶段等待 220ms；原生
导入完成即可发送，失败恢复和原事件顺序校验保留。生成图片、普通文档
展示及发送绑定不在本次变更范围内。

用户进一步明确同意补齐已发送图片的原生读取。`contract-impact = additive`：唯一权威
源为 Desktop 私有 `src-tauri/schemas/chat-ipc-v2.schema.json`，现有
`chat_attachment_presentation_v2` 增加 `read_bound`。此操作只接受 session target 和
明确 attachmentId，使用既有 ReadSessions 授权、绑定读取、TTL、摘要校验和有界图片
解码，返回原有短期投影结构，sourcePath 恒为 null。旧 read/clear 解释保持；无新增
command、capability、任意路径或外网访问。API/Host/Runtime、存储与重放格式不变，
公共 contracts pin 为 N/A（仅 Desktop 私有配对）。renderer 与 Native 必须一起更新，
旧 Native 不支持新 action 时前端显示可重试占位；回滚无数据迁移。

图片投影由当前组件短期持有，失去权限、换会话、移除、卸载或到期时释放；有界解码
串行复用原读取预算。此规则替代旧的“仅活动胶囊持有投影”限制。此处展示尺寸不改变
模型输入及原图。

2026-11-14 历史附件复发修复：换会话卸载缩略图不再丢弃仍有效的 `read_bound` 投影。
聊天页以 context/session/attachment 完整身份保留最多 24 项、16 MiB 字符串估算的内存
缓存，组件重新挂载时同步呈现缓存，避免每次切换先显示占位并再次 IPC 读取。
投影仍严格使用 Native 返回的到期时间，最长 30 秒；不在换会话时延长有效期。
Native 读取权限撤回、context 变化、附件移除、离开 ChatPage 或到期均清理；已发出的
普通读取可在换会话后完成并在同一授权内保留，未发出的过期页面请求仍跳过。
当前路由暂不可展示与授权撤回分开处理，禁止一次普通会话切换清掉其他会话的有效缓存。
这条替代上段“换会话、缩略图组件卸载必然释放”的 UI 限制，草稿来源清理、Native
30 秒期限、IPC/权限/存储/模型输入均不变，`contract-impact = none`。

同日用户反馈后的前端优化（`contract-impact = none`）：移除按钮改为缩略图右上角内侧
的 20px 半透明底、12px 细线图标，保留 24px 点击区及键盘焦点。滚动离开时关闭大图并
暂停刷新，在原生返回的有效期内保留已解码缩略图和已发起的读取结果；返回时直接复用，
临近到期才刷新。上下各 256px 的邻近视区提前加载。未展示的图片到期后清除且不继续
后台读取；不延长原生 30 秒投影期限、不引入持久缓存。仅改变组件外观和前端展示生命周期，
Desktop IPC、API/Agent Host、原生权限与本地持久/重放状态不变。

此轮优化的 7 项图片组件用例与定向 ESLint 通过，覆盖滚出/返回时复用同一图片节点、
离开期间的读取完成、预览到期及切换 scope 清理。实机在亮/暗配色、1339×843 和
1180×760 下复查了按钮与滚动返回；本轮验收草稿已移除，检查器关闭并恢复系统配色和
默认窗口。只热更新前端，未重启服务，未执行原生测试或全量回归。

本轮定向验证：受影响文件 ESLint、Vue/TypeScript 类型检查和组件/私有 schema/读取
队列/附件导入 store 用例通过。4 项原生用例覆盖有界图片投影、草稿读取、已绑定图片
的会话/归属/有效期及重开读取、原有绑定文档读取。只运行正常非破坏性场景，应用既有
测试安全排除清单；没有运行全量回归或攻击/故障注入，也没有新增模型调用。

已使用固定 `pnpm client:dev` 正常退出、增量构建并重开真实客户端。原“解释一下这两张
图片”聊天的 03.jpg、02.jpg 都能叠放与分别显示大图；原文档胶囊继续显示。输入框通过
原生选择器添加图片后直接显示缩略图，两个验收草稿均通过移除按钮清理，原首页草稿保留。
在 1339×843 默认窗口和 1180×760 最小窗口检查了叠放、大图边界与输入区；通过 WebKit
用户偏好模拟检查暗色输入框和对话图片，结束后关闭检查器、恢复系统配色和默认窗口。
键盘 focus/Escape/重新打开及过期刷新通过组件测试；完整 VoiceOver 和 200% 缩放未执行，
不能据此声称全部可访问性矩阵通过。生成图片展示未改动，未进行生成图片实机验收。

启动时遇到的既有 catalog 来源阻断及保留固定提交的修复记录见
`docs/development-client.md`；合并统计时整体 contract-impact 为 `semantic`。

Owner于2026-10-28接受FEAT-165并授权实施。以下内容在该候选中取代第1、3—6、8节的对应冲突规则，
不改写FEAT-127的历史验收状态；FEAT-165实际结果以元仓该需求的`02-verification.md`和机器账本为准。

- 目标新增SVG、MP4输入，并保留原来支持的格式。SVG和MP4继续使用`file`身份；SVG可用有界文本上下文，
  MP4只提供已确认的名称、MIME、字节数和“未解析音画”的说明，不声称支持视频理解。
- 输入附件使用易界现有token/YjIcon的类型胶囊，保持名称扩展名，多个附件自然换行。非图片hover/focus可在
  当前草稿浮层中显示真实来源路径；这是原“路径不得进入DOM/响应”规则的唯一限定例外。来源只由原导入流程
  记录，经当前context/draft/attachment授权读取，不作为读盘凭据，不进入全局Pinia、模型、Host wire、日志、
  遥测或持久消息。发送、移除、切换草稿/上下文或权限失效时清除；App重开不恢复路径，未知时如实提示。
- PNG/JPG/JPEG/SVG在hover/focus时仅显示图片浮层，替代路径tooltip。复用Native现有有界解码与读取预算，
  返回短期有界投影，只由活动胶囊持有；关闭、Esc、移除、发送或换会话后释放。原件有效但预览失败仍可发送；
  MP4输入不自动播放。该输入预览例外不改变生成图片的opaque-handle边界。
- 键盘Esc关闭后焦点保留在胶囊时，Enter可重新打开；焦点从胶囊移入浮层重试按钮不关闭，
  真正移出胶囊/浮层或按Esc才关闭。读取和重试继续使用同一个按需读取入口。
- pick与拖入共享现有Native导入/验证/持久化。桌面拖放订阅实际发出文件事件的WebView，保持composer命中与
  不可发送/导入中状态限制，不增加DOM导入分支、权限或文件服务。每条草稿10件、单件10MiB等原限制保持。
- 本地附件记录与原生`userMessage`仍是两类数据。不得改变原生类型、wire或持久化；只在唯一明确的本地
  session/turn提交绑定下展示原提交正文和附件，允许独立气泡/行。无本地绑定或有歧义时不按文本、时间或顺序猜关联。
  纯附件只展示附件行，不生成空正文气泡。已发送区域不显示来源路径；重开与分页继续按原绑定恢复。

第2节加号后直接打开文件选择器是FEAT-127历史入口；当前候选复用已有的文件/技能/连接器/专家加号菜单，
不为FEAT-165新建第二套入口。此增补不改变原子导入、正文保留、移除失败恢复、七天TTL或现有授权检查。

## 1. 目标与非目标

2026-11-10 用户要求：用户消息中的文档附件图标与产物卡片统一为彩色实心折角文档，复用 `chatDocumentIcon` 和 `YjIcon`。共享附件胶囊在已发送消息及输入草稿中采用同一映射，保留 16px 尺寸、名称扩展名与换行布局；图片／视频沿用对应媒体图标。此调整 `contract-impact = none`，仅前端显示，不改变导入、预览、发送、授权或本地持久化语义。

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

- 2026-10-29 / 1.2.0：按Owner已接受的FEAT-165补齐限定规则，明确临时路径/图片浮层、SVG/MP4的file身份、胶囊及原生消息独立绑定；修正与旧Pattern的冲突，不声明D4或生产批准。
- 2026-08-18 / 1.1.0：同步真实候选实现：v6->v7 草稿 target/ordinal、草稿恢复 fail-closed + 页面重试、五阶段各至少 220ms，以及 command 拒绝/迟到事件的单调终态修复；明确用户 Desktop 人工验收前不得声明 `Local Candidate Complete`。
- 2026-08-17 / 1.0.1：附件解析失败恢复统一为“移除后重新选择”，删除未发布的附件原地重试入口和状态。
- 2026-08-17 / 1.0.0 Accepted：根据用户明确提出的 FEAT-127 本地实现需求、统一加号截图和七天生命周期
  要求建立；批准范围不包含 Git commit、push、tag、云资源、生产部署或付费模型调用。

## 关联文件

- `02-chat-workspace.md` 1.1.0（其余规则继续有效）
- `12-feat-126-chat-app-shell-candidate.md` 1.1.0（仅覆盖本文列出的冲突段落）
- `yijie/docs/features/FEAT-127-multimodal-chat-attachments/`
