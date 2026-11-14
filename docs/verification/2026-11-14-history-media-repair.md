# 历史对话媒体复发排查

## 已恢复并完成（2026-11-14 14:37:01 CST）

用户明确要求继续，先确认技能任务结束，再完成原生复测与正常重启。已通过聊天状态
工具确认“【Temp】技能管理”最新回合 completed、chat idle；恢复时校验当前技能来源
闭包通过，本轮无需再次刷新来源快照。保留并行任务已完成的修复，没有回退任何工作。

### 原生复测结果

从原桌面“易界.app”启动日常 `com.yijie.ai` 客户端，使用原 Homes、原历史数据和
真实 Native IPC / `yijie-artifact-video` scheme。没有导入验收副本或重新生成媒体。

- 直接打开截图 1 的原会话 `01a1cff8-f454-7b52-9b1f-9b00657108b1`，
  原产物 `ea765004-e7d7-40e8-811c-e5bbded37586` 在点击播放前即显示马克杯封面。
- 截图 2 的原会话 `01a1d000-1e03-7863-9adb-32122ada6fe0` 中，
  `cup-studio.jpg` 与 `cup-table.jpg` 均正常呈现；点开后原图预览正确。
  两个历史会话之间返回时图片直接可见，没有再次出现截图中的空白占位。
- 再打开第三个首帧历史会话后返回原视频，封面保留。原生播放可用，关闭重开时
  可访问性树记录的原生视频地址一致；主动刷新后地址更新、画面正确，控件显示 Play
  （暂停状态）；关闭刷新窗口后对话卡片仍有正确封面。
- 这些是原生实机观察。图片切换没有增加生产代码计数器；IPC 读取复用计数由前序定向
  回归验证，实机结论限于真实历史加载、切换与画面观察，不把视觉观察冒充 IPC 计数。
- 原 30 秒附件投影期限保持；缓存复用不延长有效期，到期或授权变化后的正常读取仍存在。
- 日常 Vite 1420 实际服务的模块包含 `requestVideoFrameCallback`、`cacheEpoch`、
  `reader.peek` 等本轮修复。结合启动器的工程路径和实际进程路径，确认日常入口没有
  指向旧代码，且修复已实际加载。

### 正常重启与最终状态

完成上述复测后通过客户端 ⌘Q 正常退出。确认 App、Host、Runtime、媒体适配器、worker
与启动器结束；启动日志记录 `FEAT-164 normal app cleanup complete` 和
`STOPPED: owned containers exited normally; named volumes and other projects retained`。
随后再次从原桌面“易界.app”启动，没有强杀、删除数据或重建容器。

- 重启后的 Desktop PID：1646；Agent Host PID：1663。
- `development-client.py ready` 返回 `Existing authenticated workflow is ready.`。
- 实际 Host loopback `/readyz` 返回 HTTP 200，`status=ready`、`runtime_state=ready`。
- 最终 canonical 开发二进制 SHA-256：
  `4cdc2660b8e8fa476aea85b08789049952d13039c907b4ec6684de6b463d96d9`。
- 重启后再次打开同一个原产物，未播放前封面仍正常。客户端保持运行，并停留在该历史视频
  封面位置，供用户直接检查。

本任务的原生历史媒体复测及服务重启已完成。沿用前序 84 项相关用例、定向 lint 与类型
检查结果；恢复阶段没有再改媒体功能代码，因此没有无依据地重跑全量测试。
未新增 Native/后端/跨仓测试，未提交、发布或调用付费生成服务。

本机记录位于 ignored `.local/media-history-repair-20261114/`：
`daily-served-modules.json`、`native-checks-before-restart.json`、`final-readiness.json`。
下方暂停记录和“待续”说明保留为历史过程，以本节的完成状态为准。

## 用户要求暂停（2026-11-14 13:50:39 CST）

用户明确要求“先暂停，记录状态信息”。本任务现已暂停；没有继续执行测试、启动、重启、
来源快照刷新或其他开发操作。恢复需用户后续明确指示。

### 已保存的工作

- 历史附件缓存修复：`src/composables/useChatAttachmentPresentation.ts`、
  `src/components/chat/ChatAttachmentImage.vue`、`src/domain/chat-file-presentation.ts`；
  `src/pages/chat/ChatPage.vue` 仅为历史附件 reader 增加独立的 `read_sessions` 缓存授权 getter。
- 视频首帧候选修复：`src/composables/chat-artifact-media-cache.ts` 等待真实帧回调，
  保留原超时与清理逻辑。此文件在本任务开始前即为未跟踪的前序工作，未覆盖前序修复。
- 定向回归：`src/composables/useChatAttachmentPresentation.test.ts`、
  `src/components/chat/ChatAttachmentImage.test.ts`、
  `src/composables/chat-artifact-media-cache.test.ts`。
- 新的真实组件验收页：`tests/visual/chat-attachment-history/`；
  规范同步在 `docs/design/docs/design/05-patterns/13-feat-127-chat-attachments.md`。
- 6 个相关文件累计 84 个不同用例通过；定向 ESLint、类型检查与 diff 空白检查通过。
  完整一次 82 项日志在 `.local/media-history-repair-20261114/frontend-tests.log`；
  后续新增的帧回调次序与卸载后图片错误用例分别在缓存模块 18 项、附件 15 项复测中通过。
- 已完成 Safari/WebKit 的本地马克杯视频封面、视频句柄淘汰后返回、关闭暂停，以及历史
  图片三个聊天之间的缓存与亮/暗切换检查。它们不能替代 Native 自定义 scheme 验收。
- 本任务独立 Vite（1422，终端 session 33663）已以 `q + Enter` 正常退出，临时 Safari
  标签已关闭。本任务没有遗留测试服务器，也未退出或干预另一个任务正在使用的客户端。
- 未 commit/push，未迁移或重置日常数据，未调用视频/图片生成服务。

### 尚未完成与恢复顺序

1. 等待“【Temp】技能管理”任务完成共享工作区编辑和原生窗口验收。
   暂停前最近只读进度表明它仍在排查同一会话恢复后的“连接器尚未就绪”，未结束。
   对应 chat ID：`01a1d41f-14d2-7852-9e77-c85241ea8835`，host `local`。
2. 恢复时先重读当前工作区状态；多个仓库有前序/并行改动，不可 reset、覆盖、
   全量格式化、手改哈希或擅自关闭其他任务的应用。媒体代码与其他任务改动必须分开审阅。
3. 通过原桌面 `易界.app` canonical 入口核对并正常启动/重启。日常入口指向当前源码已确认；
   先前启动被并行技能源码/来源记录不一致及该任务在用 Runtime 阻止。仅一次用 canonical
   `native-skill-build-candidate.mjs --freeze` 更新过本地来源快照；旧记录保存于
   `.local/media-history-repair-20261114/native-skill-build.before.json`。之后未再追着并行
   修改刷新快照。该快照不是发布或验收批准，不可直接假定仍与当前源码一致。
4. 在日常 Native 客户端实际打开截图所涉历史视频（产物 ID
   `ea765004-e7d7-40e8-811c-e5bbded37586`）及历史图片，检查首帧、跨聊天返回、关闭重开。
   视频当前修复已证明存在并修补帧同步缺口，但尚未确认它覆盖截图中 Native scheme
   空白封面的全部原因；仍须实机观察，有问题继续定位，不把浏览器通过写成原生通过。
5. 确认日常服务 readiness 和原数据/入口保持，再更新本记录并交付。当前 **未完成日常
   服务重启与原生历史记录验收**。

以下保留暂停前的具体调查与验证记录。

`contract-impact = none`：媒体修复仅涉及 Renderer 首帧同步及页内短期缓存，保持现有
Desktop IPC、Native 读取授权、30 秒附件投影期限、视频两句柄预算、SQL/重放格式和
API/Host/Runtime 语义。没有新增依赖、原生命令、权限或外部目标。

## 已核对的原因

1. 桌面与 `~/Applications/易界.app` 都是指向当前仓库
   `.local/development/launcher/易界.app` 的链接；其 Info.plist 的 `YijieProjectRoot`
   也是当前主目录。`development-client.py` → `run-local-demo-fast.sh` →
   `run-workflow-dev.mjs` → Cargo runner 使用当前源码与 Vite HMR，未发现指向旧代码目录。
2. 前一轮缓存针对 `ChatArtifactImage/Video` 生成产物，用户截图 2 的已发送图片走的是
   `ChatAttachmentImage`/`read_bound`。该链每次缩略图组件卸载都会丢弃投影，无页内缓存。
   新回归在修复前得到三次 IPC 而不是应有的两次，证明 A→B→A 重复读取。
3. 视频原实现把 `seeked/loadeddata + readyState >= 2` 当作可绘制帧已经提供，随即缓存
   canvas。首帧合成晚到时，空表面也会变成 ready 缓存，后续返回不重取。
   新回归复现“帧回调尚未发生就 ready”的问题。改为在支持时等待
   `requestVideoFrameCallback`，同时保留 seek 完成、readyState 和 15 秒超时条件，
   清理时取消回调；不播放视频来制造封面，不导出或读取原生视频像素、不放宽 origin。
   帧回调的用途参见 [WebKit 实现记录](https://bugs.webkit.org/show_bug.cgi?id=211945)
   和 [WICG 规范](https://wicg.github.io/video-rvfc/)。这说明一个真实的时序缺口，
   截图所涉原生 scheme 是否还有其他差异，仍需日常客户端复测确认。

## 修复与验证

- 历史附件按 context/session/attachment 保留最多 24 项、16 MiB 字符串估算的短期投影；
  重新挂载同步呈现，保留原到期时刻。换聊天不清其他项，撤权/context 变化/附件移除/
  ChatPage 卸载/到期清理；旧授权读取晚到不能重新填入缓存。
- 定向验证：6 个相关文件共 84 个不同用例通过（先执行 82 项，再补充帧回调时序及卸载后迟到图片错误用例；最终缓存模块 18 项、附件两个文件 15 项复测通过），受影响文件 ESLint、`vue-tsc --noEmit` 通过。
  使用 `scripts/test-safety-exclusions.json` 的文件与名称排除规则，未运行全量回归。
- Safari/WebKit 中通过真实组件检查已有的马克杯视频本地保存件：封面可见；三会话首次
  各读取一次，返回被淘汰播放器的会话仍保留封面且不读取；点击播放才补充一次句柄。
  关闭后 paused=true、播放数量为 0，停止于约 5.25 秒。
- 新历史附件验收页中三会话首次各读一次，返回红色图片立即呈现且计数保持各 1。
  亮/暗下图片颜色正确；约 25 秒发生的主动续期单独记为原生有效期内必要读取。
- 验收页在独立 127.0.0.1:1422，不占用日常 1420。Safari 临时标签已关闭；独立 Vite 已通过 `q + Enter` 正常退出，退出码 0。

## 日常重启状态（待续）

第一次日常启动还发现 FEAT-174 的 `native-skill-build.candidate.json` 与正在编辑的 Host
源码不匹配。原脚本正确拒绝启动并正常清理服务。曾用 canonical
`native-skill-build-candidate.mjs --freeze` 在全部同源检查通过后生成本地来源快照，
旧记录保存在 ignored `.local/media-history-repair-20261114/`；没有手改哈希或绕过校验。
随后并行任务继续改源码，快照再次失效；另一次启动遇到该任务使用中的 Runtime，正常拒绝。

用户确认另一个技能任务仍在进行，要求先继续媒体修复。因此不再反复启动或更新来源记录，
待共享工作区稳定后通过原“易界.app”入口重启，并检查历史视频的 Native scheme 封面、
图片切换以及服务 readiness。此时尚不能宣称日常重启或截图所涉原生场景已验收通过。

未运行 Native/后端/跨仓测试；未调用生成服务、强杀进程、替换程序、修改权限或加入攻击
fixture。日常数据未迁移或重置，已有其他工作区改动保持。
