# FEAT-128 对话流结构化 Artifact Pattern

## 文档状态

- 状态：Accepted
- 版本：1.7.2
- 最后更新：2026-09-05
- 适用 Feature：`FEAT-128`
- Contract impact：`semantic`
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

本文已由 Owner 在 2026-08-20 的 FEAT-128 G2 closure 中接受为 Design Pattern。Contracts S1/S2 与
downstream pin-only preflight 随后通过，G2A 已批准。Desktop S4 native foundation 已实现 SQLCipher v8
authority、严格 v3 adapter、owner-bound transfer/ACK、7 天 TTL/cleanup receipt 与 metadata-only
`chat_load_history_v3`；S5 已实现 provider-neutral domain/store 与通用 metadata shell。S6A 已实现 image-only
native preview/save boundary，S6B 已实现 ready-image renderer/lightbox/save UX，两者均为 G3 外的独立 PASS。
S7F、S7A、S7A-REPAIR 与 S7B 随后分别完成 strict-local playable fixture、Desktop-private Range/save boundary、
累计请求上限修复与 ready-video renderer/runtime playback/seek smoke，并作为 G3 外独立 PASS 留痕。S8A/S8B
随后分别完成 bounded file preview/save boundary 与 ready-file renderer/search/save UX。S9A 已在
`232ea6ce132faa8ac99bdf6abcc5e02ddd704ffe` 完成 Desktop-private bounded report projection/canonical JSON save，
仍是 G3 外独立 PASS。S9B-D `0a36ca7c54460d22ea6b3228832a57f05f0bde68`、checker repair
`aec0f8a05ba7534132cbb4f46be64e333d7e9024` 与 S9B-R
`6bcc2a6bfb4db76398ecf5483c688475477f08ed` 随后也分别完成并保持 G3 外独立 PASS；production Chat/Tauri
纵向仍未执行。S10A-LOCAL-PROFILE、S10B-NATIVE-LIVE 与 S10C-PAGE 已在后续独立授权下分别完成并保持
G3 外 separate PASS。本文 1.7.0 完成 S10-SPEC-RECONCILIATION 与 S10D-READINESS，只批准默认关闭的
S10D-H harness/walking-skeleton 编码；S10D-V 与 S10E 继续等待前序 immutable PASS 与单独授权。模型调用、真实 provider、
云资源、发布或生产配置仍不在授权范围；G3 仍只覆盖 S3/S4/S5，G4 pending。
1.7.1 仅 supersede S10D-H 的终态排序和证据语义：strict-local synthetic Host 必须在 12 条 Artifact lifecycle
事件全部发布成功后才发布 terminal；H 的瞬态证据由 native durable 4/4/4 计数负责，DOM 只证明四个当前稳定 ready shell。

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
- 图片 bytes 只允许由 S6A 批准的 native custom URI protocol 直接交给 WebView 资源加载器；Vue/Pinia 不得接收
  `ArrayBuffer`、`Uint8Array`、base64、digest、Host href、绝对路径或 bearer。组件只持有本次渲染所需的
  non-authoritative opaque preview handle，且不得持久化、记录或进入测试快照。

### 5. 视频 Artifact

- `announced/progress` 使用稳定的 16:9 媒体区域、阶段文案和已确认时长；没有可信时长时显示“--”，不得猜测。
- `ready` 使用系统或 WebView 原生视频 controls，支持播放/暂停、进度、音量、全屏和键盘操作；禁止自动播放，
  默认静止并使用可信 poster 或首帧。
- 视频使用 `preload="metadata"`，不得为了列表首屏同时预载全部视频正文。字幕或音轨只有在产物明确提供时显示，
  不得伪造“已有字幕”。
- 视频无法内嵌预览时必须显示“当前格式无法预览”，并在文件仍可安全读取时保留下载入口。
- 播放错误、解码失败和内容过期必须是卡片内稳定状态，不得使用无限 loading 或浏览器原始错误文案。
- FEAT-128 当前只批准 `video/mp4`；不得把未进入 frozen contract 的 WebM 写成已支持。S7B 使用原生
  `<video controls preload="metadata" playsinline>`，明确禁止 `autoplay`、player library、external origin、
  browser download、remote playback 和 Picture-in-Picture。保存必须走 native command。
- S7B 不新增 poster command，也不把 S6A image-only command 扩展到 video poster。当前切片保留稳定 16:9
  placeholder，资源可解码后由原生 video 显示首帧；未来若要消费 SQLCipher `poster_blob`，必须先单独冻结
  identity-only command、opaque handle、limits 与释放语义。

### 6. 文件 Artifact

- 文件卡显示安全名称、格式、大小和生成状态；类型图标走 `YjIcon`，禁止按扩展名加载外部品牌图标。
- 当前 immutable v3 Artifact output 只允许 `text/plain`、`text/csv`、`application/json`、
  `application/pdf` 与 XLSX。S8 只批准前三类的 bounded inline preview；PDF、XLSX 只显示 metadata 与经批准的
  native save。不得通过 WebView 直接执行系统关联应用。
- `text/markdown` 只存在于另一条 v2 turn input 契约，不属于当前 v3 ready Artifact output。Product Owner 决定
  延期 Markdown：AC-005 在本边界下保持 `PARTIAL`，G4 不得据此通过。若本期必须生成 Markdown Artifact，必须
  重开 G2/G2A、Contracts semantic review、immutable pin 与 downstream repin；禁止把 Markdown 伪装成
  `text/plain`。
- 文本类预览必须作为普通文本节点展示，禁止 `v-html`、脚本、活动链接、宏、表单、外部网络请求或内容中的
  指令触发 Agent 操作。HTML 报告若未来获批，只能在禁脚本、禁表单、禁同源和禁外网的隔离预览中展示。
- “下载文件”必须经过 9.8 冻结的 Desktop-private native 边界执行安全保存流程；Vue 不得获得目标路径、原始
  bytes、digest 或 Host resource reference。
- 下载期间必须显示开始、完成或失败反馈；重复点击不得并发创建多个不一致副本。

### 7. 报告 Artifact

- 报告不应退化为普通文件名行。紧凑结果面必须展示报告标题、专业摘要、格式、数据范围或生成时间等已确认
  信息，并在存在结构化数据时展示关键指标和章节入口。
- 数据分析图表必须使用 ECharts 易界主题，并始终提供可见、可访问的数据表。当前 immutable
  ReportDocumentV1/chart projection 只有 `title/chartType/labels/series`，根对象只另有
  `generatedAt/sourceTime`，没有 chart unit、data source 或 time range。UI 可将非空 `sourceTime` 标为
  “数据时间”，但必须对单位、数据来源和时间范围显示“报告未提供”，不得从标题、系列名或值
  推断。图表辅助描述只能陈述图类、类目数、系列数与“完整数据见下方表格”，不得生成业务结论。
- 本候选的报告 `progress` 只展示权威阶段/百分比和稳定占位，不展示章节或摘要快照。未来 partial report
  必须先获得版本化 resource、digest、权限和替换语义，且明确“生成中”，不得把未完成内容标记为最终结论。
- “预览报告”打开应用内只读预览；“下载报告”保存同一已完成版本的 canonical Report JSON
  (`application/vnd.yijie.report+json;version=1`)。PDF/Markdown 仅作为未来派生导出，不属于本候选。预览和下载
  必须指向同一已完成版本，不能在 ready 后静默替换内容。
- 报告预览为空、部分生成、解析失败或内容不兼容时，必须保留 metadata、错误原因和下一步。
- `chat_load_history_v3` 仍只返回 report metadata；S9A 已提供可复用的 typed bounded projection 与
  canonical JSON save client。S9B-R 只能消费该 client，不得直接读取 SQLCipher、Host resource 或 raw JSON。
- S9A 已修复原 S4 Rust adapter 对 immutable ReportDocumentV1 的 consumer conformance 漂移：Unicode
  `maxLength` 按 scalar 计数、接受合法 RFC 3339 offset，不再发明 section ID/column key 唯一或
  chart labels/values 等长约束；closed schema、unknown-required、integrity 与 revision 失败仍 fail closed。

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

- 除 9.9 明确允许的当前用户授权 bounded safe projection 外，WebView、Pinia、DOM、路由、日志、遥测、错误和
  持久化消息只使用 opaque `artifact_id` 与经过验证的安全 metadata；禁止出现原始绝对路径、`file://`、Host
  内部路径、provider URL、bearer、cookie 或签名查询参数。
- Artifact 内容保持本地，不上传云端，不创建公开链接。Host 暴露的 owner-only 本地资源引用必须由 Desktop
  原生边界消费；图片/视频 WebView 只能获得短生命周期、不可持久化的安全预览句柄并按批准的生命周期释放，
  文件 WebView 只能获得 9.8 的一次性 bounded safe projection。
- 图片、视频、文件和报告必须在 native/Host 边界完成身份、大小、媒体类型、内容嗅探、完整性和 owner/session
  绑定校验。文件名或 MIME 声明不能作为唯一信任依据。
- 预览内容一律视为不可信输入。文件或报告中的 prompt、按钮、脚本和链接不得改变权限、触发工具、发起网络
  请求或绕过审批。
- Artifact 历史恢复、过期和删除必须遵循后续批准的本地持久化与 cleanup authority；UI 不得以卡片消失冒充
  内容已物理删除。
- 除 9.1 与 9.5 已实现的精确 image/video scheme CSP 增量外，本候选不批准其它 CSP 放宽、外部 origin、
  云服务器、对象存储、数据库或其他付费资源；S8A 不新增 scheme 或 CSP。

### 9.1 S6-READINESS：图片 preview 原生边界

- 唯一批准的预览方案是 `yijie-artifact-preview://localhost/v1/<opaque-handle>`。`opaque-handle` 使用 native
  CSPRNG 生成 256-bit base64url 值，不含 session、artifact、path、digest 或 bearer；它不是单独的授权凭据。
- WebView 发起 open 时，private IPC envelope 沿用 `requestId/contextId`，payload 只允许
  `sessionId/turnId/artifactId`。native 必须绑定 `main` WebView label、进程 epoch、当前授权 context、owner、tenant、
  session、turn 与 Artifact；任一不一致都 fail closed，opaque ID 单独没有访问权。
- 只允许 SQLCipher 中 `state=ready`、`kind=image`、尚未到期的 `image/png|image/jpeg|image/webp`。每次签发和
  protocol GET 都重新检查 owner/state/kind/MIME、1..20 MiB、BLOB length、SHA-256 与 image magic/decode limits。
- handle 自签发起绝对 TTL 30 秒、只允许一次 GET；每个 WebView 最多 4 个未消费 handle、每个 Artifact 最多 1 个，
  最多 2 个并发读取且总 in-flight response bytes 不超过 40 MiB。达到上限返回稳定 typed error，不驱逐既有读取。
- protocol 只接受精确 host `localhost`、`/v1/<43-char-base64url>`、无 query、无 request body 的 GET；不支持
  HEAD、Range、redirect、fetch/XHR 或 CORS。成功响应只含 allowlisted `Content-Type`、`Content-Length`、
  `Cache-Control: no-store`、`Pragma: no-cache`、`X-Content-Type-Options: nosniff`；全部失败返回 empty 404。
- handle 在 GET 开始时原子消费；显式 close、组件卸载、替换、session 切换、context invalidation、WebView/app
  关闭、进程重启或 TTL 到期均清除未消费 registry entry。S6B 必须在卸载/切换时清空 `<img src>` 并调用 release；
  进程重启后旧 handle 必然无效。
- CSP 只允许在既有 `img-src` 后追加 `yijie-artifact-preview:`。不得修改 `connect-src`、增加外部 origin、
  `asset` scope、`media-src`、`object-src`、`frame-src` 或 `unsafe-*`。Artifact 路径不得使用既有 `asset:`、
  `http://asset.localhost`、`blob:` 或 `data:` 作为绕过。

### 9.2 S6-READINESS：图片 native save 边界

- save 只能由 ready image 上一次明确的 click/keyboard 用户动作触发；private IPC payload 同样只允许
  `sessionId/turnId/artifactId`，不得接收 filename、destination、path、MIME、digest、href 或 bytes。
- native 在打开 dialog 前及真正写入前重复 preview 的 owner/state/kind/MIME/size/digest/content 校验。保存只复制
  SQLCipher authority 的同一不可变 bytes，不转码、不重新编码、不从 Host 重新下载。
- 使用仓库已经存在的 macOS native `rfd` save panel；dialog 内生成默认 safe name，canonical extension 固定为
  PNG `.png`、JPEG `.jpg`、WebP `.webp`。无扩展名时 native 追加 canonical extension；不同扩展名 fail closed，
  不创建临时文件。已有目标的覆盖确认完全由 native panel 管理。
- dialog 返回后，在用户选择目录内创建随机、`0600`、`create_new`/no-follow 的同目录 temporary file；分块读取
  SQLCipher BLOB、同步复算 length/SHA-256，写入并 `fsync`，再执行同目录 atomic replace。目标 leaf 若为 symlink
  或非 regular file 则拒绝；不允许 workspace 自动写入、浏览器 download 或后台保存。
- Vue 只接收 content-free `{ outcome: saved|cancelled|failed, code }`；不接收或记录目标绝对路径。审计只允许
  `kind=image`、outcome、stable code 与大小/时延 bucket，不记录 artifact ID、名称、path、digest 或正文。
- cancel 在创建 temp 前返回；所有正常失败使用 RAII 清理 temp，并保留 SQLCipher authority 以便用户重试。进程或
  断电崩溃可能在用户明确选择的目录留下 `0600` hidden temp；不为清理它持久化目标路径或扫描任意 filesystem。
  下次用户再次选择同一目录时只可 best-effort 清理本应用可验证的陈旧 temp；不得把该限制描述为零残留保证。

### 9.3 S6A 最小 Tauri allowlist

- S6A 仅允许新增 app commands：`chat_open_artifact_image_preview_v1`、
  `chat_release_artifact_image_preview_v1`、`chat_save_artifact_image_v1`；必须逐项加入现有
  `generate_handler!`，不得新增通用 read/write/path/dialog command。
- S6A 允许注册唯一 custom scheme `yijie-artifact-preview`，handler 必须再次校验 `main` WebView label 和 registry
  binding；不得注册 generic asset/file protocol。
- 当前仓库没有 app-command ACL manifest。若只为这三个 command 新建 manifest，Tauri 会把全部既有 app command
  置于 ACL 检查下而造成系统性行为变化；因此 S6A 不新增 capability/permission 文件，不引入
  `tauri-plugin-dialog`、`tauri-plugin-fs` 或 shell。精确命令注册、现有 local-only `main` capability、context/RBAC
  与 native 参数校验共同组成本切片最小边界。未来全量 app-command ACL 迁移必须另立安全切片。
- private authority 使用独立 `src-tauri/schemas/chat-artifact-native-v1.schema.json`；不得扩充公共 Contracts、Host
  wire 或 immutable pin，也不得把 preview/save operation 塞进 metadata-only history schema。

稳定 native error code 集合冻结为：`artifact_native_invalid_request`、`artifact_native_unauthenticated`、
`artifact_native_forbidden`、`artifact_native_not_found`、`artifact_native_not_ready`、
`artifact_native_expired`、`artifact_native_unsupported`、`artifact_native_integrity_failed`、
`artifact_native_limit_exceeded`、`artifact_native_conflict`、`artifact_native_extension_mismatch`、
`artifact_native_dialog_unavailable`、`artifact_native_permission_denied`、`artifact_native_storage_full`、
`artifact_native_io_failed`、`artifact_native_unavailable`。跨 owner/tenant/session 的存在性错误统一映射为
`artifact_native_not_found`；错误响应不得包含 path、name、digest、SQL、正文或 raw OS error。

### 9.4 canonical video fixture 与已完成的 S7F

- `yijie-contracts@ea48fe190e18afba728712d1e2cc79cda57f581b` 已有唯一 canonical resource：
  `tests/fixtures/agent/resources-v3/synthetic-video-16x16.mp4.base64`。解码后固定为 1,642 bytes，SHA-256
  `96ea070cac612d17927939c22f3c0c593fb26b171f62c4e9cee43fb596177dd5`；top-level `ftyp` 后立即是
  `moov`，再到 `free/mdat`，因此 metadata 位于媒体数据之前。
- 该 resource 是本地生成的三帧相同画面，不包含外部素材、品牌或真实业务数据。固定媒体属性为
  H.264/AVC High profile level 1.0、`yuv420p`、16×16、25 fps、0.12 秒、3 帧；`stss` 标记首帧为
  keyframe，sample table 与前置 `moov` 使单 Range 读取可以完成本地播放/seek smoke。S7F 不重新编码、
  不依赖运行机 ffmpeg，也不声称该 0.12 秒 fixture 代表真实视频质量。
- Host S3 曾由 `syntheticMP4()` 只产生 `ftyp/free/mdat`，没有 `moov`、track、codec、duration、dimensions、
  sample table 或 keyframe；该历史 fixture 只能证明 transport/integrity，明确不可播放、不可 seek。S7F
  `1045dd06534eb72d53eb7ad7b7d18e63c80284f8` 已使 Host strict-local producer 消费并校验上述 frozen
  Contracts fixture，禁止再维护第二份独立 authority；历史失败证据继续保留。
- S7F 可以在 Host 保存由 immutable Contracts fixture 派生且由 checker 逐字节比对的 consumer snapshot，或
  生成与 canonical raw digest 完全相同的 bytes；Contracts 路径、tree OID
  `f447129c08b9b39231e33698afc3f2fd875d6b14`、full commit、schema/operation/version 与 Desktop pin 均不得改变。
  本切片是对当前 synthetic producer 的 `semantic` conformance 修复，不是公共 contract 变更；Host commit、
  fixture conformance checker 与测试证据会改变。

### 9.5 已完成的 video opaque Range protocol

- 唯一批准方案是独立 Desktop-private
  `yijie-artifact-video://localhost/v1/<opaque-handle>`。拒绝 `blob:`/`data:`，因为它们要求 Vue 接收正文并扩大
  CSP；拒绝复用 `yijie-artifact-preview`，因为 image handle 是 30 秒 one-shot GET 且明确不支持 HEAD/Range。
- 新 private authority 使用独立 `chat-artifact-video-native-v1.schema.json`，exact commands 只有
  `chat_open_artifact_video_preview_v1`、`chat_release_artifact_video_preview_v1`、
  `chat_save_artifact_video_v1`。envelope 沿用 `requestId/contextId`，payload 只允许
  `sessionId/turnId/artifactId`；Vue 不接收 bytes、base64、digest、Host href、path、filename、bearer 或
  destination。
- open 必须绑定 `main` WebView label、process epoch、当前 context、owner、tenant、session、turn、artifact，
  且只允许 SQLCipher 中 `ready`、未过期、`kind=video`、`media_type=video/mp4`、1..64 MiB 的 immutable BLOB。
  native 在签发时完整复核 BLOB length/SHA-256 与 bounded MP4 box/sample-table 结构；protocol 首次请求前再次
  完整复核，此后每个请求仍重复 owner/state/expiry/kind/MIME/size/digest metadata/BLOB length 与 binding 校验，
  只从同一 SQLCipher row 读取请求范围。SQLCipher/MAC 或 identity/revision 漂移立即撤销 handle。
- handle 使用 native CSPRNG 256-bit base64url（43 chars）；每 WebView 最多 2 个 active video handles、每
  Artifact 1 个，请求并发最多 2，总 in-flight response bytes 最多 64 MiB。不存在累计成功请求次数终态上限：
  同一合法 handle 必须在其生命周期内持续服务 WebKit 的多次 HEAD/GET/Range。Tauri 2.11.x custom protocol
  responder 会缓冲 response body，因此 64 MiB 是不可越过的内存上限；若实现需要 streaming responder、新依赖
  或更大媒体，立即停止并重开 Technical/Security review。
- handle absolute TTL 为 30 分钟、idle TTL 为 5 分钟；每次成功 HEAD/GET 只刷新 idle deadline，不延长 absolute
  deadline。release、pause+clear source、component unmount、artifact/session/context/WebView switch、context
  invalidation、app/WebView close、restart、TTL 或 protocol/identity failure 都清除 registry entry；
  restart 后旧 handle 无效。与 image one-shot 不同，同一 video handle 在存活期内可服务多次 Range。
- protocol 只接受精确 host/path、无 query/fragment/body 的 `GET|HEAD`。无 Range 返回 `200`；一个合法
  closed/open/suffix byte range 返回 `206`；malformed、multi-range、HEAD/GET unsatisfiable 返回 body-empty
  `416` 和 `Content-Range: bytes */<size>`。成功只返回 allowlisted `Content-Type: video/mp4`、准确
  `Content-Length`、`Accept-Ranges: bytes`、必要时 `Content-Range`、`Cache-Control: no-store`、
  `Pragma: no-cache`、`X-Content-Type-Options: nosniff`；HEAD body 为空。禁止 redirect、CORS/Origin reflection、
  cookie、ETag/digest、filename/disposition、query token 和 error body；其它失败统一 body-empty `404`，UI 通过
  identity-only open/retry command 获得稳定 typed error。
- CSP 只新增精确 `media-src 'self' yijie-artifact-video:`。不得把 `blob:`、`data:`、external origin、
  `asset:`、generic file/filesystem/shell scope 加入 `media-src/connect-src`，不得修改 `object-src/frame-src`。
  `connect-src` 不含 video scheme，因此 Vue fetch/XHR 不可读取该 URL。

### 9.6 已完成的 video native save

- save 只能由 ready video 上明确 click/keyboard intent 触发，使用独立 video command；不得通过 `<video>`、
  browser download 或 renderer 自行写文件。native 在 dialog 前和 write 前执行与 preview 相同的 scope、state、
  MIME、64 MiB、digest 与 MP4 structure 校验。
- 允许复用 S6A 已有 `rfd` panel、single-flight、safe-name、same-directory `0600` create-new/no-follow temp、
  chunked digest、fsync、atomic replace 与 RAII cleanup 内核，但 image command/schema/limits/behavior 不得改变。
  video canonical extension 只有 `.mp4`；无 extension 时 native 追加，不匹配时 fail closed。
- Vue 只接收 content-free `saved|cancelled|failed` 和既有 stable error allowlist，不接收目标路径或 filename。
  cancel/normal failure 保留 SQLCipher authority；crash residue 与 S6A 采用同一保守语义，不扫描未由用户重新选择的
  任意目录。

### 9.7 S7 切片与 Owner readiness

| Slice | 前置与允许范围 | 测试先行与停止条件 | 回滚 |
|---|---|---|---|
| S7F Host fixture conformance | 基于 Host `4017785adb08e1114781d3d844e9a10a683fa933`；只允许 synthetic fixture producer、pinned fixture snapshot/checker/lock metadata 与 Host tests/docs；Contracts/Desktop 不变 | RED 先证明 Host video digest/size 与 canonical 不同且无 `moov`；GREEN 证明 exact digest/boxes/track/keyframe、GET/HEAD/single Range/200/206/416、default-off/strict-local；若必须改 Contracts full commit/tree/schema、引入 codec/ffmpeg/runtime dependency 或真实 provider，停止 | 回退 Host S7F commit，恢复 transport-only fixture 并保持 video renderer 关闭 |
| S7A native boundary | 仅在 S7F immutable PASS 后；允许独立 private schema/client、SQLCipher bounded video reader/range、3 exact commands、one scheme、exact `media-src`、对应 tests，以及必要的 Desktop internal implementation digest/checker 刷新 | Rust/TS RED→GREEN 覆盖 scope/state/MIME/size/digest/MP4、double validation、HEAD/GET/range/limits/TTL/replay/release/save/leak/CSP；若需 dependency/plugin/capability/migration/public pin 或不能在 64 MiB buffered bound 内实现，停止 | 移除 3 commands/schema/client/registry/scheme/media-src；S6A/S6B 与 SQLCipher schema/data不变 |
| S7B video renderer | 仅在 S7A immutable PASS 后；TS/Vue `src/components/chat` 与必要的既有 typed client integration/tests | ready-video-only、native controls/no-autoplay、metadata loading/error/expired、seek、save outcomes、duplicate/stale、pause-clear-release、keyboard/focus/reduced-motion/axe/sensitive-data negative；任何 native/config/dependency/page/contract 需求都停止 | 关闭 video renderer，回落 S5 metadata shell；S7A authority 可保持关闭 |

历史 readiness Owner capture（用户明确要求 Codex 代录，不声称独立人工评审）为 Product/Design
`READY FOR S7F ONLY; S7A/S7B WAIT`、Technical `APPROVED FOR S7F CANONICAL CONFORMANCE`、Security/Data
`APPROVED FOR S7F WITH NO PIN/TREE/DEPENDENCY/PROVIDER DRIFT`。此记录保留当时门禁语义，不代表当前状态。

当前事实为 S7F `1045dd06534eb72d53eb7ad7b7d18e63c80284f8`、S7A
`22b91c5a258458c87f1ac96c06bf39d1af97358f`、S7A-REPAIR
`34991d8967de9aa2197ab2e8b9b49347774df7a5` 与 S7B
`366186b601144bdc2bc87a2cef3075b74f1e8f19` 均为独立 PASS。S7A-REPAIR 的 historical RED 证明 WKWebView 在
metadata-ready 前第 65 个合法请求因累计 64 次上限得到 404；修复后 Rust 覆盖同一 handle 至少 128 次合法
Range，真实 WebView smoke 以 76 次 partial response 达到 metadata、playback、seek 且 404 为 0。该证据废止
9.5 中任何累计 request-count 撤销语义；有效撤销只由 absolute/idle TTL、显式 release、restart 或绑定身份失效
触发。S7 全链仍不扩 G3，也不声明 G4。

### 9.8 S8A：Desktop-private bounded file preview/save boundary

- 新增独立 private authority `chat-artifact-file-native-v1.schema.json`，exact commands 只有
  `chat_read_artifact_file_preview_v1` 与 `chat_save_artifact_file_v1`。两者使用 closed envelope
  `schemaVersion=1/requestId/contextId/payload{sessionId,turnId,artifactId}`，编码后最多 4,096 bytes，拒绝 unknown
  fields 与无效 identity；只接受 `main` WebView 和当前具备 `ReadSessions` 的 context。
- preview 是一次性 identity-only request/response，不签发 URL/handle，不设置 registry/release command，不新增
  custom protocol、CSP、capability、plugin、dependency 或 migration。native 在返回前执行 owner/tenant/session/
  turn/artifact、`ready`、unexpired、`kind=file`、MIME、declared size、BLOB length、digest、revision 与内容格式的
  第一次完整校验；生成 projection 后立即重读 authority 并复核相同不可变 identity/revision，漂移则 fail closed。
- inline MIME 仅为 `text/plain|text/csv|application/json`。source 必须为 1..1,048,576 bytes；返回 projection
  encoded content 最多 262,144 bytes，完整 response 最多 524,288 bytes；每 WebView 最多 2 个并发 preview、
  in-flight source 总计最多 2,097,152 bytes、同 identity single-flight、native timeout 10 秒。
- UTF policy：只接受 valid UTF-8；仅剥离开头一个 UTF-8 BOM；CRLF/CR 仅在 projection 中规范化为 LF；除
  TAB/LF/CR 外的 C0、DEL/C1 control 均拒绝 inline preview，并精确拒绝 Unicode `Bidi_Control` code points
  `U+061C`、`U+200E-U+200F`、`U+202A-U+202E`、`U+2066-U+2069`；这些规则不改变 SQLCipher authority
  或经用户确认的 native save bytes。
- text/JSON projection 最多 2,000 行、单行最多 8,192 UTF-8 bytes 且不拆 Unicode scalar；JSON 必须先完成 strict
  parse、depth 不超过 32、node count 不超过 20,000，再把规范化的原始 source 作为普通文本返回。CSV 必须完整
  bounded RFC 4180 comma-dialect parse，只返回普通 cell strings，最多 200 rows × 50 columns、每 cell 4,096 bytes、
  projection 总计仍受 262,144-byte 上限；公式样式保持 inert text，不求值、不导出。合法边界截断返回
  `truncated=true`，不得在 Vue 重新解析 raw source。
- preview response 是 closed union：text/JSON 为
  `{status:"previewed",mediaType:"text/plain"|"application/json",text,truncated}`，CSV 为
  `{status:"previewed",mediaType:"text/csv",rows,truncated}`；不含 name、size、path、digest、Host href、token 或
  raw error。限制外或非 inline MIME 使用既有 stable `artifact_native_*` code 回落 metadata/native save。
- save 可接受当前 v3 file allowlist 的五个 MIME，ready-file bytes 必须为 `1..67,108,864`；preview 的 1 MiB
  eligibility 与 save 上限相互独立。canonical extension 精确为 `.txt/.csv/.json/.pdf/.xlsx`；缺失 extension 由
  native 追加，不匹配则 fail closed。dialog 前完成第一次 authority/format 校验并释放读取 bytes，用户选定后再读
  SQLCipher、重复校验并复用 same-directory `0600` create-new/no-follow temp、chunked digest、fsync、atomic replace
  与 RAII cleanup 内核。
- file crash residue 使用唯一新 prefix `.yijie-artifact-file-save-v1-`，文件名精确为
  `.yijie-artifact-file-save-v1-<txt|csv|json|pdf|xlsx>-<process-epoch UUID>-<22-char base64url>.tmp`。仅在用户下一次
  明确选择同一目录保存时，best-effort 删除 prior-epoch 且通过以下全部检查的条目：exact filename/media marker、
  regular non-symlink、owner=current effective uid、mode `0600`、link count `1`、size `1..67,108,864`，以及 marker
  对应的 9.8 format recheck；当前 epoch、未知 marker、验证失败或任意其它文件一律保留。S6/S7 prefix/validator/
  behavior 必须保持不变，不扫描未由用户重新选择的目录。
- 两次 save format recheck 对 plain/CSV 要求 valid UTF-8 且无 NUL，对 JSON 要求完整 parse。PDF 必须复用
  `attachment.rs` 既有 bounded preflight（classic xref/EOF、非加密、无 ObjStm/XRef stream/Prev，objects<=4,096、
  pages `1..256`、streams<=1,024、单 stream expanded<=8 MiB、总 decoded stream<=32 MiB、compression
  ratio<=100:1、expanded traversal<=4,096 stream visits/32 MiB、form depth<=16、page-tree depth<=64）；
  XLSX 必须复用既有 bounded OOXML package validator（entries `1..512`、unique path-safe names、Stored/Deflated only、
  单 entry<=8 MiB、总 uncompressed<=32 MiB、ratio<=100:1、无 `.bin`/`vbaProject`，且存在
  `[Content_Types].xml`、`xl/workbook.xml` 与匹配的 spreadsheet main content type）。只允许把这些 validator 抽成
  file boundary 可调用的 helper，attachment import 行为与 limits 必须保持不变。PDF/XLSX 不 inline、不提取、不渲染、
  不执行或自动打开；通过 preflight 也不构成“文档内容安全”声明。
- save 只由明确 click/keyboard intent 触发。Vue 只接收 content-free `saved|cancelled|failed` 与既有 stable code，
  不接收 destination、path、filename、digest 或正文；禁止 browser download、system-associated open、generic
  filesystem/shell/asset protocol 与 external origin。

### 9.9 S8B：ready-file-only renderer 与授权内容生命周期

- S8B 必须等待 S8A immutable PASS 和单独授权。只对 `kind=file && status=ready` 接入 typed client；其它 kind/status
  保持 S5 generic shell。PDF/XLSX 显示 metadata、inline unsupported 与 native-save UX，未知格式 fail closed。
- 用户明确打开后，9.8 已校验的 bounded safe projection 可以短暂存在于该组件 local state 与当前 preview DOM。
  这是 SEC-006 的唯一窄例外；内容不得进入 Pinia、history、router、local/session storage、IndexedDB、日志、遥测、
  diagnostics 或 snapshot。close、status/artifact/session/context switch、unmount、error 与 stale response 必须立即
  清空；未授权内容、超出已批准 bounded projection 的正文、path/token/digest/savedPath/raw error 的 canary 在
  所有 DOM/state/log/snapshot 中仍必须为 0。对小文件，合法 projection 可以在上限内等于完整正文；关闭后该授权
  preview canary 也必须为 0。
- text/JSON 只用 text nodes；CSV cells 只用 escaped text nodes。禁止 `v-html`、active link、regex/HTML highlight、
  macro/formula execution、network、Agent/tool action。搜索仅作用于当前 bounded projection：literal、no-regex、query
  1..128 Unicode scalars、最多 100 hits；截断时明确提示“仅预览部分内容，截断区未搜索”。
- 迟到 response 以 requestId + context/identity 丢弃，重复 preview/save single-flight。状态、截断、fallback、
  saved/cancelled/failed、keyboard/focus、aria-live/aria-busy、200% zoom、reduced-motion 与 sensitive-data negative 均需
  Vitest/component/axe evidence；S8B 不修改 native、config、page、store、dependency 或 contract。

### 9.10 S8 切片与 Owner readiness

| Slice | 前置与允许范围 | 测试先行与停止条件 | 回滚 |
|---|---|---|---|
| S8A native boundary | 当前 immutable v3 五种 file MIME；新增独立 file schema/module、必要 SQLCipher/application/worker/ipc wiring、typed TS domain/client/tests；`attachment.rs` 只允许暴露/复用既有 bounded PDF/XLSX validator 且行为不变；仅刷新 Desktop implementation/readiness SHA consumer checker | Rust/TS EXPECTED RED→GREEN 覆盖双次 authority/format 校验、UTF/control/bidi、全部 caps、CSV/JSON、bounded PDF/XLSX preflight、identity/context/concurrency/leak、save drift/extension/dialog/symlink/atomic/fsync/residue；任何 Markdown/public pin/source/tree/schema/operation/version、dependency/plugin/capability/CSP/migration/scheme 或 image/video/attachment-import 行为变化立即停止 | 移除 exact 2 commands/schema/client/file runtime 与 file-only tests，恢复 SHA-only checker；SQLCipher schema/data和 S6/S7 不变 |
| S8B renderer | 仅在 S8A immutable PASS 与单独授权后；`src/components/chat`、必要 TS-only integration 与 tests | ready-file-only、bounded text/CSV/JSON、PDF/XLSX fallback、search/truncation、save outcomes、stale/clear、keyboard/axe/leak；任何 native/page/store/config/dependency/contract 需求立即停止 | 移除 file renderer，回落 S5 metadata shell；S8A authority 可保持关闭 |

Owner capture（用户明确要求 Codex 代录，不声称独立人工评审）：Product
`READY FOR S8A ONLY WITH MARKDOWN DEFERRED; AC-005 PARTIAL; S8B WAITS`；Technical
`APPROVED FOR S8A CODING WITH EXACT PRIVATE SCHEMA + TWO COMMANDS + NO PROTOCOL/CONFIG`；Security/Data
`APPROVED FOR S8A WITH BOUNDED AUTHORIZED-CONTENT EXCEPTION, NO PERSISTENCE/LOG/SNAPSHOT, AND NATIVE ATOMIC SAVE`。
该 1.3.0 readiness 在形成时不是实现 PASS；S8A/S8B 现已分别完成并保持 G3 外独立 PASS，
G3 仍为 S3/S4/S5，G4 pending。

### 9.11 S9A：Desktop-private bounded report projection/save boundary

- S9A 新增独立 private authority `chat-artifact-report-native-v1.schema.json`，exact commands 只有
  `chat_read_artifact_report_preview_v1` 与 `chat_save_artifact_report_v1`。closed request 编码后最多 4,096 bytes，
  envelope 为 `schemaVersion=1/requestId/contextId/payload{sessionId,turnId,artifactId}`；只接受 `main` WebView 与
  当前 `ReadSessions` context。无 URL、handle、custom protocol、CSP、capability、plugin、dependency 或 migration。
- native 在 preview 与 save 的每次读取前后复核 owner/tenant/session/turn/artifact、`ready`、unexpired、
  `kind=report`、exact MIME `application/vnd.yijie.report+json;version=1`、declared size、BLOB length、SHA-256、
  `local_committed_at` revision 与完整 ReportDocumentV1。preview source 必须为 `1..4,194,304` bytes；每 WebView
  最多 2 个并发 preview、source in-flight 总计最多 `8,388,608` bytes、同 identity single-flight、native timeout
  10 秒。save eligibility 与 preview 独立，允许 validated ready report `1..67,108,864` bytes。
- S9A 首先修复 7 节记录的 consumer conformance 漂移：字符串 `maxLength` 按 Unicode scalar 计数；接受 JSON
  Schema `date-time` 的合法 RFC 3339 offset；不再发明 section ID、column key 唯一或 chart labels/values 等长约束。
  section/column 的 UI identity 一律使用原始 ordinal。unknown optional 仍必须 `required=false`、payload JSON 编码
  `<=131,072` bytes、payload depth `<=8`；unknown required 拒绝整份报告。该 repair 的 contract impact 是
  Desktop consumer `semantic` conformance repair，公共 Contracts source/version/digest/fixture 与 Host 不变。
- preview 解析后的完整 document depth 不超过 12、总 JSON nodes 不超过 100,000、sections `0..64`。projection
  encoded content 最多 `524,288` bytes，完整 serialized response 最多 `1,048,576` bytes。已知字符串先把 CRLF/CR
  规范化为 LF，并把 TAB/LF 外的 C0、DEL/C1 与 Unicode `Bidi_Control` `U+061C`、`U+200E-U+200F`、
  `U+202A-U+202E`、`U+2066-U+2069` 投影为可见 ASCII `\\uXXXX`，不得作为控制字符进入 DOM；这不改变 SQLCipher
  canonical bytes 或 native save bytes。所有 truncation 均在 Unicode scalar、section、row 或 cell 边界进行。
- closed projection 根对象只含 `schemaVersion=1/title/generatedAt/sourceTime/truncated/sections`。每个 section 都含
  `ordinal/id/type/required/truncated`，union 仅为：`summary|paragraph` 的 optional heading + text；`metrics` 的
  items；`table` 的 caption、ordered columns 与 positional row arrays；`chart` 的 title/chartType/labels/series 与
  `aligned`；`callout` 的 tone/title/text；以及 `{type:"unsupported",required:false}`。unknown original type 与 payload
  均不得返回、遍历、搜索、记录或渲染。
- exact projection caps：document title `<=200` scalars；summary/paragraph/callout text 每项 `<=8,192` scalars，
  heading/title 每项 `<=1,024` scalars；metrics 每 section `<=32` items，label `<=80`、string value `<=128`、unit
  `<=32` scalars；table 每 section `<=32` columns、前 `<=200` rows、string cell `<=1,024` scalars，number/boolean/null
  原类型保留；chart 只允许 `bar|line|pie`、`<=128` labels、label `<=128`、`<=16` series、series name `<=80`、
  每 series `<=128` finite JSON numbers、总 points `<=2,048`；callout sections 最多 64（受总 section cap）。超过
  display cap 时返回 `truncated=true`；超过 source/node/depth/response、unknown required、schema drift 或 integrity
  failure 时 fail closed，并回落 metadata + canonical save，不返回 partial unvalidated object。
- save 只由明确 click/keyboard intent 触发，canonical MIME 保持 report v1，extension 精确 `.json`；无 extension
  由 native 追加，其它 extension fail closed。dialog 前完成第一次 authority/full-schema validation 并释放 bytes，
  dialog 后重新读取和验证，复用 same-directory `0600` create-new/no-follow temp、chunk digest、fsync、atomic replace 与
  RAII cleanup。report residue filename 精确为
  `.yijie-artifact-report-save-v1-json-<process-epoch UUID>-<22-char base64url>.tmp`；仅在用户下次明确选择同一目录时
  best-effort 删除 prior-epoch 且 exact marker、regular non-symlink、current uid、`0600`、nlink=1、size
  `1..67,108,864` 与 full ReportDocumentV1 recheck 全部通过的条目。Vue 只接收 content-free
  `saved|cancelled|failed` + stable code，不接收 path/name/digest/body/raw error。
- PDF、Markdown、PNG/JPEG 等 derived export 全部延期：当前没有既有安全实现，也不是 AC-006 本候选范围。S9A
  只保存同一不可变 canonical report JSON；禁止 browser download、系统关联应用自动打开、generic filesystem/shell、
  外部 origin 或目标路径返回 Vue。

### 9.12 S9B：provider-neutral report renderer 与 chart adapter

- 依赖方案冻结为直接使用 exact `echarts@6.1.0`（Apache-2.0，registry integrity
  `sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==`）。
  lockfile 只允许新增根 `echarts@6.1.0`、`zrender@6.1.0`（BSD-3-Clause，integrity
  `sha512-oEGMDB6pOP2S6OwRR4PdVv610zrjnA3Bh+JnSG12fYJlBKjtNAoEb5fSUoCOOINlH96I2fU38/A2UpRKs67xYQ==`）与
  `tslib@2.3.0`（0BSD，integrity
  `sha512-N82ooyxVNm6h1riLCoyS9e3fuJ3AMG2zIZs2Gd1ATcSFjSA23Q0fzjjZeh0jbJvWVDZ0cJT8yaNNaaXHzueNjg==`）的
  importer/package/snapshot 增量，并在根 `THIRD_PARTY_NOTICES.md` 保留 package/version/license/source/integrity 与
  ECharts 6.1.0 `NOTICE`。审计日 2026-08-21 未安装任何包。
- 不选 `vue-echarts@8.1.0`：它仍 peer-depend ECharts 6，却增加 generic option/update/event/lifecycle 表面和供应链，
  对 closed adapter 无必要能力。table-only 是每个 chart 的权威 fallback 和回滚路径，但不替代 AC-006 的
  有限图表渐进增强。
- exact value imports 只能是 `init/use` from `echarts/core`，`BarChart/LineChart/PieChart` from
  `echarts/charts`，`GridComponent/TooltipComponent/AriaComponent` from `echarts/components` 和
  `CanvasRenderer` from `echarts/renderers`。禁止 root/full `echarts`、`vue-echarts`、SVG renderer、Legend/Title/
  Dataset/Transform/DataZoom/Toolbox/Graphic/Custom/UniversalTransition、extension/theme pack、CDN、外部 origin、
  import map、dynamic/runtime module 与远程资源。图例使用 card 内的可访问 HTML `<ul>`，不注册
  ECharts LegendComponent。直接 bundled Canvas 方案不需要 Tauri/CSP/capability 增量。
- S9B-D 必须以 2026-08-21 S9A baseline 同环境 build（全部 `dist/assets/*.js`）的
  `655,731` minified raw bytes / `206,580` gzip-9 bytes 为基线。tree-shaken chart runtime 与后续 S9B-R 的
  最终总增量分别不得超过 `716,800` raw / `225,280` gzip bytes，最终全部 JS 不得超过
  `1,372,531` raw / `431,860` gzip bytes。必须统计所有 JS，不得通过拆 chunk 或动态/CDN 加载
  规避。超限、integrity/license/transitive 漂移或出现 install script/额外 package 即停止并回滚 S9B-D。
- S9B-D 新增的 semantic chart token 名称只能是 `--yj-color-chart-series-1` 至
  `--yj-color-chart-series-8`，按序精确映射 light
  `#4B651D,#356BEA,#0E7490,#7C3AED,#B45309,#C2410C,#DC2626,#475569` 和 dark
  `#C3F35B,#78A2FF,#46C7D8,#A78BFA,#FBBF24,#FB923C,#F87171,#94A3B8`；文字/背景/边框/焦点/
  字体使用 text-primary/text-secondary/bg-card/bg-elevated/border-default/focus-ring/font tokens（焦点映射到 2.0.0 的 `--yj-color-focus-ring`）。文字
  对比至少 4.5:1，焦点与信息性图形至少 3:1；颜色仍必须配合 decal、line symbol/style、HTML
  legend 与可见 table。theme factory 只接受 resolved required-token reader，缺 token 则 table fallback。
  2026-09-05 的设计系统 2.0.0 仅更新首序列配色：亮色使用可读的深品牌图形色，暗色使用品牌青柠；
  焦点改用可读的 focus-ring token；其余七个系列色、系列 token 名称、closed adapter、fallback 和本 pattern 的安全/行为边界保持不变。
  此处是后续 UI 迁移要求，不追溯修改原 S9B 验收结果，也不代表本次已改动活跃应用。
- `YjChartCard` 只接受 closed frozen adapter model，不接受 `EChartsOption`、option fragment、provider config、
  generic slot 或 event callback。固定 transparent background、standard height `280px`、narrow/200% zoom height `180px`、
  grid `{left:16,right:16,top:24,bottom:32,containLabel:true}`、`animation=false`、
  `tooltip.renderMode="richText"/confine=true/appendToBody=false/enterable=false/transitionDuration=0`、
  `aria.enabled=true` 与 decal。禁止 formatter（function 或 template）、HTML tooltip、URL、`.on`、
  `dispatchAction`、toolbox、dataZoom、dataset、graphic 与 custom series。通用图表规范中的 dataZoom 建议对
  FEAT-128 无效。
- closed adapter 输入只能是 S9A `type=chart` projection，输出只能是 frozen
  `renderable|fallback` model 和完整 text-table model，不暴露 ECharts option。bar/line 只在 `aligned=true`、
  `1..64` labels、`1..8` series、每 series 等长 finite values 且总 points `<=512` 时增强；pie 只在
  exactly one aligned series、`1..32` labels、所有值 `>=0` 且至少一个 `>0` 时增强。empty、mismatch、
  unsupported、defensive non-finite 或 oversize 都只对当前 section 回落 table。mismatch table 行数取 labels/
  values 最大长度，缺 label 显示“第 N 项（缺少标签）”，缺值显示“—”，不丢弃其他投影值。
- S9B-D 提供无全局状态的纯 budget helper；S9B-R 在每次 explicit open 的组件 local state 中按 section
  `ordinal` 升序提交已通过 adapter 的 chart candidates，只增强最前 `4` 个。单 chart 已受 `<=512` points
  限制，因此合计必为 `<=2,048`；其余只表格。close/error/stale/switch/unmount 清掉该次 open 的 budget，
  禁止按 mount/async completion 顺序或跨 report/global counter 分配。
  card 每次只持有一个 Canvas instance 和一个 ResizeObserver；model/theme/error/unmount 时按
  `clear -> dispose -> disconnect` 释放，init/setOption/resize 失败只降级当前 chart，其它 section 和可见 table
  不受影响。theme change 通过既有 `document.documentElement.dataset.theme` 驱动 dispose/re-init。
- S9B-R 只对 `kind=report && status=ready` 在用户明确打开后调用 typed S9A client；其它
  kind/status 保持 S5 shell。summary/paragraph/callout/metrics 只用 text nodes；table 用 `<table>`/
  `<caption>`/`<th scope>` 与 positional cells；unknown optional 只显示固定 unsupported marker。禁止
  `v-html`、linkification、活动 URL、公式/宏/代码、网络与 Agent/tool action。canonical JSON save 只调用
  S9A client，禁止 derived PDF/Markdown/image export。
- projection/model/option 只能在组件 local state 与打开态 DOM；close/error/stale response、status/artifact/session/
  context switch 与 unmount 时先使 request epoch 失效，再清 projection/model/feedback，然后 unmount chart 以
  dispose。禁止进入 Pinia/history/router/storage/log/diagnostics/telemetry 或 snapshot。含 title/labels/series/
  values 的 model/option 不得做 snapshot；测试必须改用 exact-key allowlist、JSON-serializable 与递归
  no-function/no-URL/no-formatter 结构断言。
- chart Canvas 使用固定 accessible name 和只陈述结构的 description，不进 Tab 序；键盘/读屏用户通过
  紧邻的 HTML legend 与始终可见 table 读取全部 bounded 数据。loading/error/empty/fallback/truncated
  有稳定文字、`aria-live`/`aria-busy`；panel 打开聚焦 labelled region，关闭返焦触发器。
  `animation=false` 在所有主题成立，reduced-motion 下同时去除 CSS transition。
- S9B-D 必须以 test-only chart harness 验证 light/dark、1180×760、720px 窄宽与 200% zoom（有效
  590 CSS px），并检查无 page horizontal scroll/重叠、table local scroll、focus、tooltip confinement、theme
  dispose/re-init 与 reduced-motion。S9B-R 仍需 component/axe/security 与同一视觉矩阵；production page/vertical
  继续属于 S10，不得用 harness 冒充。

### 9.13 S9 切片、测试与回滚

S9B-D checker 路径固定为 `scripts/check-feat128-s9b-d-dependencies.mjs` 与
`scripts/check-feat128-s9b-d-bundle.mjs`，测试分别使用同名 `.test.mjs`；visual harness 固定在
`tests/visual/feat-128-s9b-d/`。实现验证必须依次执行：

1. `pnpm exec vitest run scripts/check-feat128-s9b-d-dependencies.test.mjs scripts/check-feat128-s9b-d-bundle.test.mjs src/design/theme/echarts-theme.test.ts src/domain/chat-artifact-report-chart.test.ts src/components/yijie/YjChartCard.test.ts`
2. `node scripts/check-feat128-s9b-d-dependencies.mjs`
3. `pnpm lint`
4. `pnpm test`
5. `make build`
6. `pnpm docs:build`
7. `node scripts/check-feat128-s9b-d-bundle.mjs --dist dist/assets`
8. `pnpm exec vite --config tests/visual/feat-128-s9b-d/vite.config.ts --host 127.0.0.1 --port 41783`，随后在真实浏览器逐格执行 9.12 的 light/dark、1180×760、720px、200% zoom、fallback/error/reduced-motion 矩阵并记录实际结果；不得把 happy-dom/axe 冒充真实布局证据。
9. `git diff --check`

| Slice | 前置与允许范围 | 测试先行与停止条件 | 回滚 |
|---|---|---|---|
| S9A native boundary | `232ea6ce132faa8ac99bdf6abcc5e02ddd704ffe` separate PASS；immutable report v1 consumer repair + private projection/canonical JSON save | Rust/TS EXPECTED RED→GREEN、cargo 227 passed/3 ignored、Desktop lint/347 tests/build/docs/diff 已 PASS；保留原 RED 证据 | 若未来需要关闭，移除 report commands/schema/client/runtime 而不恢复错误 consumer 契约解释 |
| S9B-D dependency/theme/adapter foundation | S9A PASS + 1.5.0 readiness + separate S9B-D authorization；`package.json`/`pnpm-lock.yaml`/`THIRD_PARTY_NOTICES.md`、`src/styles/variables.css`、`src/design/theme/echarts-theme.ts`、`src/domain/chat-artifact-report-chart.ts`、`src/components/yijie/YjChartCard.vue`、两条 exact checker + tests 与 `tests/visual/feat-128-s9b-d/`；禁止 `components/chat`、S9A client 调用与报告正文读取 | 先做 dependency/import/theme/adapter/card/bundle EXPECTED RED；按本节 9 条 exact 验证 GREEN，覆盖 lock/integrity/license/imports、light/dark/missing-token、bar/line/pie/fallback/bounds、ordinal budget/table-completeness、exact-key/no-function/no-URL、init/update/resize/theme/error/unmount disposal、axe/reduced-motion/network/storage/log 与真实浏览器矩阵。任何额外 dependency、budget 超限、native/config/page/store/public contract 或 arbitrary option 需求立即停止 | 移除 exact dependency/三个 lock nodes/notice、chart tokens/theme/adapter/card/checker；S5 shell 与 S9A authority 不变 |
| S9B-R ready-report renderer | S9B-D immutable PASS + separate S9B-R authorization；只允许 `src/components/chat/ChatArtifactReport*.vue`、Shell/List 的 typed report-client 透传、对应 tests 与 test-only visual harness；不再改 dependency/theme/adapter/native/config/page/store | 先做 renderer EXPECTED RED；GREEN 覆盖 explicit open/all known sections/unknown/truncation、chart fallback 隔离、duplicate/stale/clear/dispose顺序、save 三结果、keyboard/focus/aria/axe、open-DOM/close-zero-hit、no raw/unknown/path/digest/href/token/requestId/error/log/snapshot，并复验总 bundle 上限 | 移除 report renderer 与 Shell/List 透传，回落 S5 metadata + S9A canonical save；S9B-D 可保留但不接入 |

Owner capture（用户明确要求 Codex 代录，不声称独立人工评审）：Product
`READY FOR S9B-D ONLY; ACCESSIBLE TABLE IS AUTHORITATIVE; UNIT/SOURCE/TIME RANGE MUST BE HONESTLY UNAVAILABLE;
S9B-R WAITS`；Technical `APPROVED FOR S9B-D WITH EXACT ECHARTS@6.1.0, DIRECT STATIC TREE-SHAKEN CORE,
CANVAS RENDERER, CLOSED ADAPTER, SEMANTIC THEME/CARD AND EXACT BUNDLE GATE`；Security/Data
`APPROVED FOR S9B-D WITH EXACT LICENSE/LOCK, NO REPORT READ, NO ARBITRARY OPTION/HTML/EVENT/NETWORK,
BOUNDED INSTANCES AND DISPOSE-ON-LIFECYCLE; S9B-R WAITS FOR IMMUTABLE D PASS`。S9B-READINESS 只是 docs-only
PASS；其历史 Owner capture 保留。S9B-D、checker repair 与 S9B-R 现已分别 PASS，production page/Tauri
vertical 仍 `NOT RUN`；G3 保持 S3/S4/S5，G4 pending。

### 9.14 S10 当前事实与 single-V3 决策

- 历史 S10-READINESS 捕获时 production 只开 v2、Page/Store 尚未接入；该事实不得回写成从未发生。当前 S10A 已
  提供 exact keyless strict-local Host/fake profile，S10B 已实现 single-v3 coordinator、SQLCipher/cursor 原子提交、ACK
  recovery 与 private invalidation，S10C 已实现 history v3、`ArtifactStore` authority/bounded resync 及 production
  `ChatPage`/`ChatArtifactList`/四类 typed-client wiring。三者均为 G3 外 separate PASS。
- 当前仍没有 fresh exact Host/fake/Desktop binaries + 真实 Tauri WebView + production ChatPage 的端到端证据。S7B
  runtime 会替换 production bootstrap 并只挂 seeded video shell；S9 visual 使用 Vite fake projection；S10A runner
  只驱动 sidecar/Host integration test，不启动 production Page。三者均不得冒充 S10D vertical。
- Host v3 hub 是普通 turn/reasoning 事件与四类 Artifact 事件的同一有序超集。Artifact producer flag 开启时，
  Desktop active turn 必须只消费 `/v3/agent-sessions/{id}/events?event_schema_version=3`；禁止并跑不具原子同步
  证明的 v2/v3 双流，也禁止把 v2 pagination cursor 交给 `chat_load_history_v3`。
- v3 decoder 必须一次解析 common envelope/stream cursor，再把普通事件交给既有 turn reducer、Artifact 事件交给
  strict artifact decoder。所有事件继续按同一 `stream_id/sequence/event_id` 连续域 fail closed；gap、stream change、
  identity mismatch、unknown required shape 或 terminal regression 触发 bounded resync，不得跳过或降低单调检查。
- ordinary progress 可按既有阈值合并，但在 Artifact 事件前必须把此前 ordinary projection 一起提交。started、progress、
  failed 必须在一个 SQLCipher transaction 内完成 turn progress flush、Artifact 状态变更和该 v3 cursor advance。
  completed 先将前序 cursor flush，再保持 completed cursor 未推进地进入 `transferring`、下载和完整校验；最终 ready
  BLOB、ACK intent 与 completed cursor 在同一 transaction commit，随后才发送 ACK 和 private invalidation。崩溃发生在
  ready commit 前时重放 completed 并重新 fetch；发生在 commit 后时 cursor 去重，pending ACK 由既有幂等路径重试。
  不允许在网络 I/O 期间持有 SQLite transaction，也不需要 migration。
- flag off 禁止新 v3 producer/transfer，active turn 继续单一 v2；已经持久化的 Artifact metadata/history 与经当前
  `ReadSessions` authority 授权的 image/video/file/report preview/save 保持只读。不得新增 Vue-only Artifact flag。

### 9.15 S10A-LOCAL-PROFILE：严格本地零 provider 剖面

- 当前 FEAT-128 synthetic 不能独立驱动真实 Host：`StartSession`/`StartTurn` 先要求 Runtime 成功，而 Host 又拒绝
  synthetic 与 MiniMax 或 FEAT-126 fake Responses 同时启用。因此 1.6.0 选择新增 exact、默认关闭的
  `YIJIE_FEAT128_S10_TEST_PROFILE_ENABLED=true`，只在它与既有
  `YIJIE_FEAT126_S10_TEST_PROFILE_ENABLED=true` 同时成立时允许 synthetic + fake Responses 组合；其它组合仍在监听
  端口、创建 spool 或启动 child 之前失败。
- exact conjunction 还必须满足：`YIJIE_ENV=local`、`YIJIE_AGENT_HOST_V3_ARTIFACTS_ENABLED=true`、
  `YIJIE_FEAT128_SYNTHETIC_ENABLED=true`、manifest exact `feat128-artifact-v1`、MiniMax/provider/key/key-file 均未设置、
  fake endpoint exact `http://127.0.0.1:18082/v1`，以及既有 canonical UUIDv4 run id、parent PID、owner-only run root/
  log dir/process manifest 校验。只允许 loopback；任何 key、MiniMax、非 loopback、浮动 manifest、缺失 authority 或
  大小写/非 exact-true 值都 fail startup，且错误与证据不得包含 env value、token 或路径。
- Desktop parent 的 `YIJIE_CHAT_ARTIFACTS_V3_ENABLED=true` 只在本进程控制新 v3 coordinator，并映射为 child
  `YIJIE_AGENT_HOST_V3_ARTIFACTS_ENABLED=true`；parent flag 本身不转发。synthetic 两个 child env 只能由
  compile-time `feat128-s10-runtime` + exact S10 test profile 注入，禁止继承任意 shell 值。四个 flags 默认都关闭。
- S10A 只允许 Host `internal/app/app.go`/tests、必要 `cmd/desktop-host` config wiring、一个
  `internal/integration/feat128_s10_local_profile_test.go` 与 exact runner；Desktop 只允许 `src-tauri/Cargo.toml`、
  `src-tauri/src/chat/sidecar.rs`/tests 和 test-only runner。不得修改 session fixture bytes、public wire、Contracts pin、
  Host S7F、Desktop transfer/page/store/schema/config/capability/CSP/dependency。
- runner 必须从待测 Host commit build fresh `desktop-host`，记录 source SHA 与 binary SHA-256；创建 `mktemp -d` 后
  校验 realpath、owner、0700，内部独立 host-home/codex-home/log/spool/process manifest。fixed loopback ports 18082
  (fake Responses) 与 18080 (Host) 必须先证明未占用；ready deadline 20s，session/turn deadline 各 30s，全程 180s
  watchdog，SIGTERM grace 10s 后才 SIGKILL。测试必须真实完成 start session/turn、读取 v3 四类 started/progress/
  completed、GET/ACK，并证明 MiniMax/key/provider env absent、所有 socket peer 为 loopback。退出后先停 Desktop/Host/fake，
  再证明无 child、无监听、无 WAL/spool/temp residue，最后删除 run root；只保留 content-free JSON evidence。

### 9.16 Desktop-private invalidation、history 与 authority

- S10B-NATIVE-LIVE 已新增独立 private channel `yijie:chat:artifact:changed:v1` 与 closed schema
  `chat-artifact-live-v1.schema.json`。事件 exact root 为 `schemaVersion=1`、`subscriptionId/contextId/sessionId/turnId/eventId`
  canonical UUID、`notificationSequence` canonical decimal string、kind `artifact_changed|resync_required|context_invalidated`；
  payload 分别只能是 `{}`、`{reason:'backpressure'|'sequence_gap'|'protocol_error'}`、
  `{reason:'authority_changed'}`。事件不含 artifactId、state、name、MIME、size、正文、digest、href、path、token 或 raw error。
- notification 只在对应 SQLCipher transaction durable commit 后向 current main-WebView、current context/session
  subscription 发出；每 subscription 序列从 1 单调递增，queue cap 64。gap/invalid/overflow 必须丢弃 pending changed、
  合并为一个 `resync_required`；事件不做跨进程 replay，restart 后以 history v3 为唯一恢复 authority。emit 失败不回滚
  durable state，下一次 subscribe/resync 恢复。
- S10C-PAGE 已按 subscribe 两个 private channels first 并 buffer 的顺序，在同一 epoch 执行 control resync + 首个
  `chat_load_history_v3` page、用同一个 S5 reducer ingest history，再 coalesce buffered Artifact invalidation 并至少再做
  一次 history-v3 resync，最后 replay ordinary buffered events。older-page 只使用独立 v3 cursor state；不得与 v2 cursor
  比较、复用或拼接。
- `ArtifactStore` 增加 authority tuple `authorizationRevision/contextId/tenantId/sessionId`、`resetAuthority()`、per-read epoch
  和 stale guards；logout、permission expiry/rebind、tenant/context/session switch、delete 与 unmount 先 invalidate epoch 再
  清全部 projection。`ChatPage` 只使用 `chatStore.context.contextId` 和 history/native 返回的 trusted turnId；不得从 route、
  DOM 或显示顺序推断。即使 assistant text 为空，也在对应 turn 下挂 Artifact list，并显式注入现有四类 singleton typed clients。

### 9.17 S10 DAG、停止条件与回滚

| Slice | 前置与允许范围 | 测试/停止条件 | 回滚 |
|---|---|---|---|
| S10A-LOCAL-PROFILE | 1.6.0 Accepted；仅 9.15 Host/Desktop config、sidecar、feature 与 test runner | EXPECTED RED 证明当前 synthetic+fake 被拒、child env 缺失；GREEN 证明 exact conjunction、zero key/provider/non-loopback、fresh binary digest、watchdog/cleanup；任何 public wire/pin/fixture、dependency/config capability/CSP、非 loopback 或 secret 需求立即停止 | 删除 exact master/profile mapping 与 runner；恢复 synthetic+fake 互斥，v2/default-off production 不变 |
| S10B-NATIVE-LIVE | S10A immutable PASS + 单独授权；HostBridge/v3 decoder、application/artifact/database/worker/ipc/mod/lib、private schema/client parser/tests及必要 Desktop implementation/readiness SHA-only checker | 单一 v3、common sequence、started/progress/failed atomic cursor、completed crash points/ACK replay、stream restart/gap/duplicate/identity、queue 64/content-free notification；禁止 migration/public contract/Host fixture/monotonic weakening | 关闭 parent Artifact flag，恢复 v2 coordinator；保留 SQLCipher rows与只读 preview/save；移除 private channel，不删 authority data |
| S10C-PAGE | S10B immutable PASS + 单独授权；ChatClient/ChatStore/ArtifactStore/ChatPage/List integration/tests | subscribe-buffer-control+v3-history-replay、独立 v3 pagination、authority reset/stale、empty-text turn、四 client、keyboard/axe/leak；禁止 native/config/dependency与 route/DOM identity inference | unmount list并移除 v3 UI subscription/history wiring；回落现有 v2 Chat UI，native authority保留关闭 |
| S10D-H HARNESS | A-C immutable PASS + 1.7.1 + 单独授权；复用 compile-time `feat128-s10-runtime`，只允许 9.18 的 test-only bootstrap/controller/runner/checker 与 exact terminal-order/evidence repair | fresh exact Host/fake/Desktop；真实 Tauri production bootstrap/ChatPage；Host/native durable lifecycle=4/4/4，DOM 四类 stable ready shell；content-free verdict、axe/focus/单张 transient screenshot、全进程清理。不得替换 production commands/Page/store，不得写 DB/spool | 删除 S10D-H module/controller/runner/checker 与 `src/main.ts`/`lib.rs` 的 feature-only hook；S10A-C production path不变 |
| S10D-V VERTICAL | H immutable PASS + 单独授权；只扩展 test-only scenarios/evidence | 四类 preview/playback/file/report、ACK/history/pagination/reload/restart/mixed failure/TTL/delete；light/dark/1180x760/720/200%/keyboard/focus/axe/reduced-motion；seeded shell/Vite fake均不算 | 关闭/移除 V scenarios；保留 H walking skeleton与 A-C authority |
| S10E-SEC-PERF | D-V PASS + 单独授权；test-only adversarial/boundary/perf controls/evidence | 12 items、100 progress/s、20MiB image、64MiB video/save、file/report caps、auth/digest/MIME/size/content mismatch、WAL/residue；任一泄漏/越权/阈值 hard-stop 即失败 | 禁用 affected kind/preview，仅保留 metadata+native save；不得放宽 limit |

所有后续切片都禁止新 dependency/plugin/capability/CSP/migration/external origin、公共 Contracts/Host wire/canonical fixture
或 real provider。consumer checker 只可更新 Desktop implementation/readiness SHA 与对应 test 常量；Contracts
`full_commit/source/tree/schema/operation/version` 和 Host public pin 必须逐字段不变。

### 9.18 S10D/E 纵向、安全与性能证据

- vertical harness 必须挂载真实 production `ChatPage`，运行 fresh exact Host binary，不替换 production commands、SQLCipher
  或 Artifact clients。每次 run 独立 0700 root；禁止外部写 DB/spool 造状态。native save 继续通过真实 dialog，只记
  manual `saved|cancelled|failed` content-free 结果；无法安全自动化时明确 `MANUAL/NOT RUN`，不得注入 target path。
- 基础 matrix：四类 announced→progress→ready；duplicate/out-of-order/gap/terminal regression；一项失败不清其它 ready；
  live/history/pagination/reload/session/context/tenant switch；Host/Desktop restart、download validation、ACK replay、TTL/delete；
  未授权 context/WebView/session 和 digest/MIME/size/content mismatch。安全 canary 对 DOM/Pinia/log/diagnostics/evidence 的
  bytes/base64/digest/Host href/absolute path/token/raw error/未授权正文命中必须为 0。
- S10D 重切为 H/V，因为现有 S7B 只证明 self-mounted WebView media、S10A 只证明 sidecar，而 production auth 又不接受
  ephemeral test profile；真实 Page bootstrap、macOS WKWebView 控制、screenshot 和多进程 teardown 属于非平凡生命周期。
  本结论不是实现 blocker，而是只批准 H 先建立并证明该控制面；H 未 PASS 前不得运行 V。
- H 复用现有 Cargo feature `feat128-s10-runtime`，不得新增 feature/dependency/plugin/capability/CSP/config。允许文件仅为
  `src-tauri/src/lib.rs`、新 `src-tauri/src/feat128_s10d_runtime.rs`、完成 exact test-auth/bootstrap 所必需且只受同 feature
  编译的 `src-tauri/src/native_auth/{mod.rs,runtime.rs}` 最小引用、`src/main.ts`、新
  `src/feat128/s10d-runtime-controller.ts` 及 test、`scripts/run-feat128-s10d-runtime-smoke.sh` 与同名 scope checker/test。
  禁止改 Page/Store/component/domain/api/schema/protocol/commands/config/package/lock。若 consumer digest、public/private wire、
  migration 或生产 auth 语义必须变化，立即停止并另行授权。
- `src/main.ts` 必须先按现有 production branch 创建 `App`/Pinia/router 并完成 `router.isReady()`，再在 exact
  `VITE_FEAT128_S10D_RUNTIME=true` 时动态加载 test controller；controller 不得 mount 第二个 App、mock client、set Pinia、
  写 SQLCipher/spool 或绕过 router。native bootstrap 只可在 exact S10A conjunction 下建立 synthetic auth/project
  prerequisite；session/turn、四类 Artifact、history/ACK/UI 必须走 production commands、S10B coordinator 与 S10C Page。
- H runner 必须先证明 ports 18080/18082 free，建立 canonical 0700 `mktemp` root，fresh `go build -trimpath` Host/fake，
  `pnpm build` 后以隔离 `CARGO_TARGET_DIR` 执行 exact
  `cargo build --locked --release --features feat128-s10-runtime,tauri/custom-protocol`，记录三仓 source SHA、Host/fake/Desktop
  binary SHA-256。先启动 fake，再启动 Desktop，由 production sidecar 启动 Host；禁止 Vite/devUrl/1420/1421 authority。
  deadlines 固定为 Host/fake ready 20s、Tauri/Page ready 45s、walking skeleton 180s、runtime global 300s、SIGTERM grace
  10s 后 SIGKILL；任一超时只输出 stable content-free failure class。
- strict-local synthetic profile 必须为每个 starting turn 建立 terminal barrier。start response 完成 Bind/Accept 前到达的 terminal
  只能暂存，不得调用 `CompleteTurn` 或进入 EventHub；Bind/Accept 后精确一次发布四类各 started/progress/completed，全部 12 条
  成功并完成 Desktop native/SQLCipher commit 后才精确一次 flush terminal。失败、取消、identity conflict、cleanup/exit 清空 barrier
  并 fail closed；禁止 sleep、Host 人为延时或延长 Desktop timeout。
- H controller 只按 accessible role/name 真实 click/type/keyboard：进入 production ChatPage、选择已由 native test bootstrap
  注册的 run-root project、提交一个 deterministic prompt，并等待 image/video/file/report 四个当前稳定 ready shell。H 不要求
  极快 synthetic run 的 announced/progress 各自形成可截图的独立 DOM frame；这些阶段由 native coordinator 在各次 SQLCipher
  durable commit 后以 closed 4/4/4 tracker 证明。若 Product 要求 UI 每个瞬态都可见，必须重开 S10C 并新增有界、版本化
  transition journal/projection；current history/current-state ArtifactStore 不能恢复已被后续事件覆盖的中间态。
  H 不打开 renderer、不做 save、不声称完整 vertical；它只证明 production walking skeleton 与四类 stable shell。
- H verdict 是 exact closed JSON：`schemaVersion/status/failureCode`、三个 source commit、Host/fake/Desktop binary SHA-256、
  `profile{zeroProvider,zeroNonLoopback}`、`productionPath{realTauri,productionBootstrap,productionChatPage,productionCommands,
  singleV3,sqlcipher,historyV3,artifactStore,typedClients}`、
  `lifecycle{hostNative{announced,progress,ready,kinds},dom{domReadyShells,domKinds}}`、
  `ui{axeSeriousCritical,focusOrder,screenshotSha256}`、`cleanup{desktop,webContent,host,fake,listeners,wal,spool,temp,runRoot}`。
  禁止 ID、path、URL、header、requestId、正文、name、MIME、digest（artifact）、token 或 raw error；binary/screenshot SHA 仅作为
  test provenance。feature-only Rust hook 使用现有 Tauri raw macOS window/`objc2` 取得 current `NSWindow.windowNumber`，
  runner 再以 `/usr/sbin/screencapture -l` 采集到 0600 run-root，
  只允许 deterministic synthetic ready-state，记录 SHA 后删除；权限/窗口定位失败则 H fail closed，不得改用 Vite/browser。
- H teardown 顺序固定为 controller terminal→pause/release renderer resources→close Tauri window→TERM Desktop→等待 WebContent→
  stop Host→stop fake→检查 18080/18082、child PIDs、SQLCipher WAL/SHM、Host spool/temp/save residue→删除 run root。controller、
  DOM、Pinia、stdout/stderr、diagnostics、verdict 的禁止 canary 必须 zero-hit；原始 screenshot/log 只存在 run root 且最终删除。
- S10D-V matrix 固定覆盖四类 announced→progress→ready、duplicate/out-of-order/gap/terminal regression、single failed 不清其它
  ready、live→history-v3→pagination→reload、session/context/tenant/stale clear、Host restart、Desktop reload/restart、ACK replay、
  expired/TTL/session-delete cleanup；image inline/lightbox、video metadata/playback/seek、file plain/JSON/CSV 与 PDF/XLSX save-only、
  report table/chart fallback；light/dark、1180×760、720×760、200% zoom、keyboard/focus/axe/reduced-motion。native save 必须真实
  click + native dialog；无法安全自动化时逐项 `MANUAL/NOT RUN`，不得注入目标路径。
- 性能 run 固定 release-like build、同一机器；记录 macOS/build、CPU、RAM、Desktop/WebContent/Host PID 与 binary/source
  digest。每 scenario 3 次 warmup + 30 measured samples，报告 p50/p95。started-to-visible p95 `<300ms`，`>=1000ms`
  hard-stop；100 progress events/s 持续 10s 时每 component render `<=10Hz`，持续 `>20Hz` hard-stop；12 mixed Artifacts
  不得出现 `>200ms` long task，目标无 `>50ms`，CLS `<=0.1`。
- RSS 分别采 Desktop main、WebContent、Host，在 open 前、peak、close 后 30s 记录；20MiB image/64MiB video preview
  peak delta 目标 `<=2.5x` content，`>3x` 或 crash/OOM hard-stop，close 后三进程合计残留增量必须 `<=64MiB`。
  chart instance、image/video handle、ResizeObserver、temporary save/residue 最终计数必须为 0。超 target 但未达 hard-stop
  只能降级 metadata/table/save-only并保留 finding，不能声明 G4。

### 9.19 S10 Owner readiness

历史 Owner capture（用户明确要求 Codex 代录，不声称独立人工评审）只批准 S10A；当时 S10A-S10E 均 `NOT RUN`，
该事实保留。当前 S10A/S10B/S10C 已分别 separate PASS。1.7.0 新 capture：Product
`READY FOR S10D-H ONLY; H PROVES ONE PRODUCTION WALKING SKELETON, FULL FOUR-TYPE USER PATHS WAIT FOR V`；Technical
`APPROVED FOR EXACT FRESH-BINARY REAL-TAURI HARNESS WITH PRODUCTION BOOTSTRAP/COMMANDS AND CLOSED PROCESS LIFECYCLE;
S10D-V WAITS FOR H IMMUTABLE PASS`；Security/Data `APPROVED FOR S10D-H ONLY WITH EXACT KEYLESS LOOPBACK PROFILE,
TEST-ONLY AUTHORITY BOOTSTRAP, ZERO CANARY, CONTENT-FREE VERDICT, TRANSIENT SCREENSHOT AND COMPLETE CLEANUP`。
本 readiness 只是 docs-only PASS；S10D-H/V 与 S10E 均 `NOT RUN`，不扩 G3、不声明 G4。

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
- 当前跨仓库实现已包含默认关闭的 S4 foundation、S5 shell、Desktop S6 image boundary/renderer、Host S7F video
  fixture、Desktop S7 video boundary/renderer 与 S8 file boundary/renderer。真实 Tauri WebView
  metadata/playback/seek smoke 只对 video 形成；image/file runtime visual 仍待后续 vertical evidence。S9A report
  private commands/projection/canonical JSON save 已以 `232ea6ce132faa8ac99bdf6abcc5e02ddd704ffe` 独立 PASS；
  S9B-D、checker repair 与 S9B-R 已分别实现并独立 PASS；production Chat/Tauri vertical 仍属于 S10。上述 local evidence 均不是
  MiniMax/provider capability 证据。
- 视频生成尤其没有当前 provider 能力、时长、格式、计费和失败语义证据。UI 禁止仅根据模型宣传材料提前显示
  可用能力。
- 未来实现必须先用无付费、无真实卖家数据的 deterministic fixture 完成状态机与 UI 验证。任何真实 MiniMax
  调用、计费上限、重试次数和凭据使用都需要单独批准并记录证据。

## AI / Codex 必须遵守

- 本文已 Accepted，G2A、Host S3、Desktop S4/S5 与 G3(S3/S4/S5 only) 已通过；S6A/S6B/S7F/S7A/
  S7A-REPAIR/S7B/S8A/S8B/S9A/S9B-D/S9B-D-CHECKER-REPAIR/S9B-R 是 G3 外独立 PASS。下一编码切片只能在
  单独授权后进入 9.15/9.17 的 S10A-LOCAL-PROFILE；其 immutable PASS 与单独授权前不得进入 S10B。不得扩展 G3
  或声明 G4。
- 不得把用户输入附件复用为生成 Artifact，也不得从 Markdown 链接、文件名或模型自然语言猜测结构化结果。
- 必须从权威结构化事件消费 Artifact；未知 kind、status 或版本必须 fail closed 并显示兼容状态。
- 必须先显示 `announced/progress`，不得为了实现简单而等待 ready 后才插入卡片。
- 禁止把 base64、未授权内容、超出当前已批准 bounded projection 的正文、绝对路径、provider URL 或凭据放入
  Vue props、Pinia、DOM、日志或测试快照；9.9 的当前 bounded projection 窄例外不得扩大或持久化。
- 禁止用 `v-html` 渲染报告或文件内容，禁止放宽 CSP 或增加外部网络目标来完成预览。
- 必须复用设计 token、Naive UI、Yj 组件与 Lucide registry，不引入第二套 UI、图标、播放器或预览库。
- 状态、错误、键盘、VoiceOver、reduced motion、light/dark 和最小窗口必须有自动或人工验证证据。

## 实现要求

本文获批并得到实现授权后，代码必须按以下边界落地：

- `src/domain/`：Artifact UI 状态机、未知值策略、格式化和纯映射；
- `src/components/chat/`：可复用的 Artifact 列表、图片、视频、文件、报告和预览组件；
- `src/stores/`：按 session/turn/item identity 合并单调事件，不持有原始路径或大文件正文；
- `src/pages/chat/`：只组合 assistant message、live turn 和预览入口，不解析 wire 或执行下载副作用；
- `src-tauri/`：S6A 按 9.1-9.3 实现 image-only boundary，S7A/S7A-REPAIR 按 9.5-9.6 实现并修正隔离的 video
  boundary；S8A 按 9.8 实现隔离的 file boundary；S9A 只能按 9.11 修复 report consumer conformance 并新增隔离的
  report boundary，不得改变 S6-S8 行为；
- `src/design/theme/`、`src/domain/`、`src/components/yijie/`：S9B-D 只能按 9.12-9.13 实现 exact dependency、
  semantic chart theme、closed adapter 与 one-instance chart card，不得读取报告或接入 Chat shell；
- `src/components/chat/`：S9B-R 只能在 S9B-D immutable PASS 后消费 S9A typed client 与 S9B-D closed card，
  不得修改 native、dependency/theme/adapter、page 或 store；
- S10 必须严格按 9.14-9.19 的 A→B→C→D→E DAG；native single-v3/cursor foundation 先于 production page，
  test-only keyless profile/harness 均默认关闭且不得成为 provider capability 声明；当前下一编码切片仅为 9.17/9.18
  的 S10D-H，S10D-V/S10E 等待 H immutable PASS 与单独授权；
- Agent Host 与 Contracts：由对应仓库定义并评审权威事件、历史恢复、读取、过期、错误和兼容语义。

实现必须先固定不可变 Contracts 引用和 provider-first conformance，再由 Desktop 消费；不得在 Vue 中手写一份与
权威契约重复的 DTO。若保存、预览或播放需要新增依赖、Tauri plugin、command、capability、CSP 或外部目标，
必须在编码前取得明确批准。

## 验收清单

- [x] 本文状态已由 G2/Owner 明确批准为 Accepted；G2A、Host S3 与 Desktop S4/S5 已通过。
- [x] S4 native authority 持久化单调进度、校验/加密 content 与 poster、commit 后 ACK、TTL receipt，并且
  private IPC v3 只返回安全 metadata；默认 flag 为关闭。
- [x] S5 provider-neutral reducer/store 与通用 accessible metadata shell 已实现并通过 G3 slice evidence。
- [x] S6-READINESS 已先冻结 custom protocol、opaque handle、native save、最小 command/CSP delta 与稳定错误。
- [x] S6A/S6B 已分别实现 image native boundary 与 component renderer，保持 G3 不变。
- [x] S7F/S7A/S7A-REPAIR/S7B 已分别独立 PASS；累计 64 次 request 撤销已由 lifecycle-based boundary 取代。
- [x] S8A/S8B 已分别实现 bounded file native boundary 与 reusable ready-file renderer；Markdown 仍延期。
- [x] S9A 已实现 contract-conformant bounded report projection 与 canonical JSON native save，并以 G3 外独立 PASS 留痕。
- [x] S9B-READINESS 已冻结 exact ECharts dependency/integrity/license/imports/bundle、semantic theme/card、closed adapter、
  data lifecycle、a11y/visual matrix 与 S9B-D/S9B-R 回滚；S9B-D、checker repair 与 S9B-R 后续均独立 PASS。
- [x] S10A/S10B/S10C 已分别形成 G3 外 separate PASS；1.7.0 S10D-READINESS 已冻结 real-Tauri H/V harness、
  production path、content-free evidence、process cleanup 与完整 vertical matrix；S10D-H/V、S10E 均 `NOT RUN`。
- [ ] Artifact 在 `announced` 时立即出现，并在同一稳定位置进入 `progress/ready/failed`。
- [ ] 有可信进度才显示百分比；未知进度、完成、失败和迟到事件语义正确。
- [ ] 图片卡和灯箱、视频 controls、文件预览/下载、报告摘要/预览/下载符合本文。
- [ ] expired、unsupported、unknown、permission、not found、integrity、storage 和 service error 状态完整。
- [ ] WebView、state、DOM、日志和错误中的绝对路径、provider URL、凭据、未授权内容、超出已批准 projection 的
  正文和大 base64 命中为 0；用户当前明确打开的 bounded safe projection 仅按 9.9 短暂存在，小文件 projection
  可在上限内等于完整正文并必须在关闭后清零。
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
- 2026-08-20 / S5 provider-neutral shell：实现 domain/store/generic metadata shell；未实现 type renderer、preview、
  save、custom protocol 或 CSP。
- 2026-08-20 / 1.1.0 S6-READINESS Accepted：以 SQLCipher authority + one-shot opaque handle custom protocol
  取代不可同时满足 no-bytes-to-Vue 的 object URL 候选；冻结 S6A/S6B、3-command allowlist、单一 `img-src`
  scheme delta、native atomic save 与稳定 error codes。本记录不构成 S6 实现、G3 扩展或 G4。
- 2026-08-20 / S6A/S6B：S6A `8b99849d418a3ef226f4133128f1ac22a438f9d5` 与 S6B
  `4a8dce6a6526e37052941f6dbb921ba2486e109f` 分别独立 PASS；G3 仍只包含 S3/S4/S5。
- 2026-08-20 / 1.2.0 S7-READINESS Accepted：确认 Contracts canonical MP4 可播放/可 Range seek，而 Host S3
  transport-only MP4 不可播放；冻结 S7F producer conformance、独立 multi-request Range video opaque protocol、
  native `.mp4` save、精确 `media-src` 与 S7A/S7B stop conditions。本记录不构成 S7 实现、G3 扩展或 G4。
- 2026-08-21 / S7F/S7A/S7A-REPAIR/S7B：四个切片分别独立 PASS；保留 request 65 historical RED，修复后同一
  handle 通过至少 128 次 Range unit coverage 与 76 次 partial response WebView metadata/playback/seek smoke，
  `responsesNotFound=0`。累计 request-count 撤销被 absolute/idle TTL、release、restart 与 binding invalidation 取代。
- 2026-08-21 / 1.3.0 S8-READINESS Accepted：冻结 current-v3-only file MIME、identity-only bounded projection、
  exact two commands/limits、native atomic save、S8A/S8B stop conditions 与授权内容的 DOM 窄例外；Product 延期
  Markdown，AC-005 保持 PARTIAL、G4 pending。本记录不构成 S8 实现或 G3 扩展。
- 2026-08-21 / S8A/S8B：S8A `bf5452f7fde24d1391845deaba17ec1135716c62` 与 S8B
  `4d0238b1906f02d319f47f5e55cdc023485ef07a` 分别独立 PASS；production page/runtime visual 仍待 S10。
- 2026-08-21 / 1.4.0 S9-READINESS Accepted：确认 report history 仍 metadata-only、无 bounded projection；冻结
  S9A consumer-conformance repair、identity-only projection/canonical JSON save、exact caps/unknown omission/lifecycle，
  以及 S9B fixed ECharts mapping。active app 尚无 ECharts dependency/theme，故只批准 S9A，S9B blocked/waits。
- 2026-08-21 / S9A：`232ea6ce132faa8ac99bdf6abcc5e02ddd704ffe` 独立 PASS；修复 Desktop
  consumer conformance，新增 exact private projection/canonical JSON save，未实现 report renderer/chart 或改变 G3。
- 2026-08-21 / 1.5.0 S9B-READINESS Accepted：选择 direct exact `echarts@6.1.0` + Canvas static tree-shaken
  core，拒绝 `vue-echarts`；冻结 exact integrity/license/transitives/imports/bundle、accessible semantic theme/card、
  closed adapter/table fallback、单位/来源/时间范围 honest-unavailable、local-only lifecycle 与 S9B-D/S9B-R。
  只批准 S9B-D；本记录不是 implementation PASS，S9B-R 等待 D immutable PASS 与单独授权。
- 2026-08-21 / S9B-D/CHECKER-REPAIR/S9B-R：`0a36ca7c54460d22ea6b3228832a57f05f0bde68`、
  `aec0f8a05ba7534132cbb4f46be64e333d7e9024`、`6bcc2a6bfb4db76398ecf5483c688475477f08ed`
  分别独立 PASS；保留 readiness/RED 历史，production Chat/Tauri vertical 仍 NOT RUN。
- 2026-08-22 / 1.6.0 S9-SPEC-RECONCILIATION + S10-READINESS Accepted：纠正 S9 当前状态；确认现有
  FEAT-128 synthetic 无法独立驱动真实 Runtime，选择 exact FEAT126 loopback fake Responses 组合 profile；冻结
  S10A-LOCAL-PROFILE→S10B-NATIVE-LIVE→S10C-PAGE→S10D-VERTICAL→S10E-SEC-PERF，仅批准 S10A 编码。
- 2026-08-22 / S10A/S10B/S10C：Host/Desktop exact keyless profile、Desktop single-v3/atomic/private invalidation 与
  history-v3/ArtifactStore/production ChatPage wiring 已分别独立 PASS；G3 仍只包含 S3/S4/S5，production vertical 未运行。
- 2026-08-22 / 1.7.0 S10-SPEC-RECONCILIATION + S10D-READINESS Accepted：确认 S7B/S9/S10A evidence 均不能替代
  production vertical；将非平凡的 macOS Tauri bootstrap/control/screenshot/process lifecycle 独立为 S10D-H，并将完整
  四类/restart/history/visual/a11y matrix 留给 S10D-V；只批准 H 编码，D-H/D-V/E 均未实现或运行。
- 2026-08-23 / 1.7.1 S10D-H terminal/evidence superseding clarification：保留 1.7.0 readiness 历史；新增 strict-local
  per-turn terminal barrier，并将 H 证据冻结为 native durable started/progress/completed=`4/4/4` + DOM 四个 stable ready shell。
  不用 sleep、timeout 或 DOM 伪计数补偿 current-state projection 对瞬态帧的天然合并。
- S6 readiness Owner capture：Product/Design `READY FOR S6A; S6B WAITS FOR S6A PASS`；Technical
  `APPROVED FOR S6A CODING WITH EXACT THREE COMMANDS + ONE IMAGE SCHEME`；Security/Data
  `APPROVED FOR S6A CODING WITH NO NEW DEPENDENCY/PLUGIN/CAPABILITY AND EXACT CSP DELTA`。依据是用户本轮
  明确要求记录 Owner 结论；Codex 负责审计与代录，不声称独立人工批准。该句只记录当时 readiness；当前
  S6A/S6B 已独立 PASS。
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
