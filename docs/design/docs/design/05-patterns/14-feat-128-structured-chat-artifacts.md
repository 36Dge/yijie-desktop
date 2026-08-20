# FEAT-128 对话流结构化 Artifact Pattern

## 文档状态

- 状态：Accepted
- 版本：1.2.0
- 最后更新：2026-08-20
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
S7-READINESS 进一步冻结 video fixture、Range protocol、native save 与 renderer 切片，但没有修改 fixture、Host、
Desktop 业务代码、private schema、command、CSP 或依赖。模型调用、真实 provider、云资源、发布或生产配置仍不在
授权范围；G3 仍只覆盖 S3/S4/S5，G4 pending。

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
- 除 9.1 冻结的单一 `img-src yijie-artifact-preview:` 增量外，本候选不批准 CSP 放宽、外部 origin、
  云服务器、对象存储、数据库或其他付费资源。

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

### 9.4 S7-READINESS：canonical video fixture 与 S7F

- `yijie-contracts@ea48fe190e18afba728712d1e2cc79cda57f581b` 已有唯一 canonical resource：
  `tests/fixtures/agent/resources-v3/synthetic-video-16x16.mp4.base64`。解码后固定为 1,642 bytes，SHA-256
  `96ea070cac612d17927939c22f3c0c593fb26b171f62c4e9cee43fb596177dd5`；top-level `ftyp` 后立即是
  `moov`，再到 `free/mdat`，因此 metadata 位于媒体数据之前。
- 该 resource 是本地生成的三帧相同画面，不包含外部素材、品牌或真实业务数据。固定媒体属性为
  H.264/AVC High profile level 1.0、`yuv420p`、16×16、25 fps、0.12 秒、3 帧；`stss` 标记首帧为
  keyframe，sample table 与前置 `moov` 使单 Range 读取可以完成本地播放/seek smoke。S7F 不重新编码、
  不依赖运行机 ffmpeg，也不声称该 0.12 秒 fixture 代表真实视频质量。
- 当前 Host S3 `syntheticMP4()` 只产生 `ftyp/free/mdat`，没有 `moov`、track、codec、duration、dimensions、
  sample table 或 keyframe；它只能证明 transport/integrity，明确不可播放、不可 seek。S7F 的唯一目标是让
  Host strict-local producer 消费/校验上述已冻结 Contracts fixture，禁止再维护第二份独立 authority。
- S7F 可以在 Host 保存由 immutable Contracts fixture 派生且由 checker 逐字节比对的 consumer snapshot，或
  生成与 canonical raw digest 完全相同的 bytes；Contracts 路径、tree OID
  `f447129c08b9b39231e33698afc3f2fd875d6b14`、full commit、schema/operation/version 与 Desktop pin 均不得改变。
  本切片是对当前 synthetic producer 的 `semantic` conformance 修复，不是公共 contract 变更；Host commit、
  fixture conformance checker 与测试证据会改变。

### 9.5 S7-READINESS：video opaque Range protocol

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
  Artifact 1 个，每 handle 最多 64 个成功 HEAD/GET，请求并发最多 2，总 in-flight response bytes 最多
  64 MiB。Tauri 2.11.x custom protocol responder 会缓冲 response body，因此 64 MiB 是不可越过的内存上限；
  若实现需要 streaming responder、新依赖或更大媒体，立即停止并重开 Technical/Security review。
- handle absolute TTL 为 30 分钟、idle TTL 为 5 分钟；每次成功 HEAD/GET 只刷新 idle deadline，不延长 absolute
  deadline。release、pause+clear source、component unmount、artifact/session/context/WebView switch、context
  invalidation、app/WebView close、restart、TTL、request budget 或 protocol failure 都清除 registry entry；
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

### 9.6 S7-READINESS：video native save

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

Owner capture（用户明确要求 Codex 代录，不声称独立人工评审）：Product/Design
`READY FOR S7F ONLY; S7A/S7B WAIT`；Technical `APPROVED FOR S7F CANONICAL CONFORMANCE`；
Security/Data `APPROVED FOR S7F WITH NO PIN/TREE/DEPENDENCY/PROVIDER DRIFT`。S7A/S7B 的设计边界已接受，但编码
授权分别以 S7F/S7A immutable PASS 为前置；readiness 不是实现 PASS，不扩 G3，不声明 G4。

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

- 本文已 Accepted，G2A、Host S3、Desktop S4/S5 与 G3(S3/S4/S5 only) 已通过；S6A/S6B 是 G3 外独立
  PASS。下一编码切片只能进入 S7F Host canonical fixture conformance；S7F immutable PASS 后才可请求 S7A，
  S7A immutable PASS 后才可请求 S7B。不得把 S7-READINESS 描述为 fixture/command/protocol/CSP/save/renderer
  已实现，也不得扩展 G3 或声明 G4。
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
- `src-tauri/`：S6A 按 9.1-9.3 实现 image-only owner 校验、SQLCipher 内容读取、一次性预览句柄、native
  保存和生命周期释放；未来 S7A 只能按 9.5-9.6 新增隔离的 video boundary，不得改变 S6A 行为；
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
- [x] S7-READINESS 已冻结 canonical playable/seekable fixture 路线、video Range/save boundary 与 S7F/S7A/S7B；没有实现。
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
- S6 readiness Owner capture：Product/Design `READY FOR S6A; S6B WAITS FOR S6A PASS`；Technical
  `APPROVED FOR S6A CODING WITH EXACT THREE COMMANDS + ONE IMAGE SCHEME`；Security/Data
  `APPROVED FOR S6A CODING WITH NO NEW DEPENDENCY/PLUGIN/CAPABILITY AND EXACT CSP DELTA`。依据是用户本轮
  明确要求记录 Owner 结论；Codex 负责审计与代录，不声称独立人工批准。S6A/S6B 状态仍为 NOT RUN。
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
