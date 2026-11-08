# 当前上下文用量与公开整理状态

2026-11-08。本地开发候选。最初实现为 `additive`；当前重开恢复修复为 `contract-impact = semantic`，已有 API/IPC 形状不变。用户授权实现浮层，并补充要求展示上下文整理事件；确认统一采用“正在整理上下文 / 上下文已更新”的中性文案。

## 实现

- 仅对话流页面输入区的模型选择器左侧显示浅灰细圆环，新建任务页不显示。已知用量用深灰弧段表达，未知时只显示浅灰底环，不转动、不显示虚线或猜测占用比例。悬停、键盘聚焦显示“上下文窗口”、使用/剩余比例与 Token 数；Escape 收起。未知状态与真实 0 分开。
- 原生 `thread/tokenUsage/updated.tokenUsage.last.totalTokens` 是分子，同一事件的 `modelContextWindow` 是分母。容量已由 Runtime 应用有效窗口比例；不使用模型目录的标称容量。浮层标注“最近一次统计”。
- `get_context_remaining` 实际返回 `tokens_until_compaction`，受压缩阈值和统计范围影响，只有剩余量，不能用于本展示。累计 `tokenUsage.total` 只用于识别重复原生事件，不作为显示用量或分母。
- 独立只读 `context-window/0.2.0` 契约、Host GET、`chat_context_window_v1` IPC，同源生成 Go/Rust/TS 类型与校验。复用原 bearer、Native read_sessions 和本地会话绑定，不新增权限或能力；schema_version 仍为 1。
- Host 保留有界内存快照，重开后可只读恢复同一线程的原生持久统计。Vue 每秒读取当前所选聊天；初次读取已有 Runtime 历史，不发送模型请求。切换聊天/模型、断连与窗口整理会撤掉不可信旧用量，迟到响应不会写入新聊天。
- 原生 `contextCompaction` Item 开始/完成更新同一公开状态行，位于 assistant 一侧，保持原生 thread/turn/item 身份与对话位置。它不是伪造的 agentMessage/phase，不参与答案复制或任务执行。中断/缺失完成事件不显示成功。
- Native6/SSE13/IPC6/format6、原生 Runtime 制品、自动压缩阈值和 new_context 执行策略均不改变。没有数据库迁移或第二份 Token 历史；原有 Host TurnOperation 仅增加私有可选模型 revision 戳。现有 Native Item 没有支持此类型时，只在新只读元数据与其原生身份精确匹配后作阅读展示。

权威源与兼容/回滚见 `../../yijie-contracts/docs/context-window.md`。本地 source.lock 与开发入口 source receipt 已接入；没有发布 tag、commit 或 push。

## 验证

最终 UI 样式（同日，按用户最新提供的 Codex 参考图）：浅灰底环和深灰用量弧段、透明无边框按钮；Kimi 输入区使用与回答区一致的圆角方形，新建任务页不显示指示器。上下文浮层采用深色卡片，无箭头、三行居中。标题为灰色“上下文窗口：”，12px、常规 400 字重；按本次明确要求移除“最近一次统计”字符。百分比和 Token 数量均为白色 13px，三行行高 20px；内边距从 8px/16px 收紧为 4px/12px，Token 行词间距为 -0.06em。16px 圆角、`#191D1E` 背景与统一轻阴影保留，常规 tooltip 不变。

该轮 `contract-impact = none`：仅修改浮层文案、排版与组件断言，API/IPC/Runtime、权限、统计来源及持久状态没有变化。组件/领域 5 项测试与修改文件 ESLint 通过；CUA 在 1180×760 检查亮暗主题，143k / 730k 样本浮层实测约 185×70px，标题/用量/数量为 12/13/13px，后两行均为白色。证据在 `.local/context-window-review/compact-{light,dark}.png`。本轮没有模型请求、原生测试或全量回归；当前运行的是内嵌前端的 `start-ui` 调试构建，通过应用自身 ⌘Q 正常退出后由同一 canonical 入口更新。

更新后的前端类型检查、构建与标准 debug bundle 构建通过。CUA 在实际 macOS App
打开原有 FEAT-170 聊天，确认新的“上下文窗口：”标题、白色用量与紧凑 Token 行已经
生效，仍显示原生的 19.6k / 996.1k、2% 统计；未发送新消息。实际界面证据为
`.local/context-window-review/compact-actual-client.png`。

最终微调：圆环从 16px 调至 18px；保持 32px 点击区域，指示器与模型选择器控件之间的间距从 8px 调至 4px。CUA 在 1180×760 实测尺寸与间距分别为 18px、32px、4px，相关 5 项组件/领域测试与定向 ESLint 通过。

### 用户授权后的真实对话验证

用户另行批准两模型合计最多 8 次 HTTP 请求。本轮实际 **5/8**：Kimi 4 次、MiniMax 1 次，全部 HTTP 200；唯一原生工具调用为 `new_context` 1 次。剩余 3 次未使用，不自动用于其他任务。

使用独立 Host/Runtime Home、新建普通验收会话、同一已固定 Runtime 和生产 Session Service。计数器逐请求计数、最多 8 次、请求/响应内容不改写；生产前端 API adapter/composable、指示器、模型控件连接真实只读快照。没有读取或修改原日常聊天数据库，也没有更改自动压缩阈值或模型策略。

| 实际阶段 | 已用 Token | Runtime 有效容量 | 观察结果 |
|---|---:|---:|---|
| Kimi 第一轮 | 18,015 | 996,147 | 打开的浮层从未知更新为真实统计 |
| Kimi 第二轮 | 18,097 | 996,147 | 同一窗口的新统计覆盖旧值 |
| 切换 MiniMax、尚未请求 | 未知 | 未知 | 旧 Kimi 数值清除；切换本身 0 模型请求 |
| MiniMax 回复后 | 20,079 | 950,000 | 使用新模型同一事件的分子/分母 |
| 切回 Kimi、尚未请求 | 未知 | 未知 | 旧 MiniMax 数值清除；切换本身 0 模型请求 |
| new_context 前的最近统计 | 20,277 | 996,147 | 原窗口观察值 |
| 原生整理开始 | 未知 | 未知 | sample=null，状态 in_progress |
| 原生整理完成/重算 | 12,918 | 996,147 | 新窗口，状态 completed |
| 新窗口模型回复后 | 18,039 | 996,147 | 正确刷新，不显示累计 94,507 Token |

记录证明实际原生窗口编号进入 1，previous_window_id 与 window_id 不同；原生开始与完成共用同一 Item ID。开始后的所有有值快照均属于新观察窗口，未见旧窗口样本复活。离开只读验收聊天时清空用量，返回后读取同一新窗口统计，无额外模型调用。

另将实际 Native13 事件送入生产 Rust `NativeDisplayBuffer`，手动限定的 capture replay 测试通过（1 项，715 项无关用例被筛选）。生成的实际开始/完成视图，再经过生产 conversation selectors、`withContextWindowTimeline`、`ChatTimeline` 与 `ChatActivityRow`，CUA 观察“正在整理上下文 · 可能需要几分钟”→“上下文已更新”，同一公开消息行的身份和位置保持。

原生 Runtime 通过正常 stdin EOF 退出，计数器正常停止；18083/18089 监听已关闭。原日常 Host 保持 readiness 200，没有强杀或原应用重启。

证据：Host `.local/context-window-live/20261108-045427/{ledger,verification,events,native-frames,source}.json`；Desktop `.local/context-window-live/` 的真实数值、模型切换、整理消息截图。开始/完成消息的完整对话布局验证使用实际事件帧回放，没有制造或改写原生事件。

- 新功能与聊天页等定向前端测试：102 PASS，6 个原有 SKIP；另一次输入区/公开过程组件定向测试：71 PASS（两组有重合，不合计成总数）。
- 新功能测试涵盖真实零/未知、同一分母、超容量、模型 revision、迟到响应、只读 IPC envelope、精确原生身份、公开消息不随工具折叠、开始/完成/中断、键盘与悬停。
- Host：7 个窗口统计/生命周期/Runtime 断连测试及 1 个只读 HTTP 授权测试，`go test -race` PASS。只执行普通合成事件与临时正常存储，没有供应商调用。
- Native：`chat::host_bridge::tests::context_window_bridge_reads_without_model_or_mutation_requests` PASS，实际编译当前 `kimi-k31-pro-candidate`；验证正常 loopback ready + GET 请求和生成的解码类型。714 个无关原生用例被筛选，不是全量测试。
- Contracts：2 个同源/语义样本测试 PASS，生成及消费者同步检查 PASS。OpenAPI lint 通过，有 1 个 `ContextWindowQuery` 未被 HTTP 引用的提示；它由私有 IPC 使用，保留该提示，没有关闭校验规则。
- 修改前端文件的 ESLint 与 `vue-tsc --noEmit` PASS。
- CUA 在 1180×760 检查真实源组件的亮色/暗色、键盘聚焦、Escape、整理完成后的数值更新及容量未知。证据位于 `.local/context-window-review/{light,dark,completed}.jpg`；这是显式合成数据 UI 检查，不冒称真实模型全链 E2E。

## 重开恢复缺陷修复与同一聊天验收

用户反馈已完成聊天重开后显示“暂无用量数据”。审计确认日常开发入口的 App 包含
`chat_context_window_v1`，Host 包含只读上下文路由；并非漏编译。根因是 Host 只有进程内
统计，冷启动没有读取原生持久统计，resume 重放又因缺少当前进程观察到的轮次而被过滤。

修复从已绑定线程的 `thread/read(includeTurns=false)` 取得原生路径，再只读适配原生
`token_count.info`，不调用 `thread/resume`、不新建轮次、不估算 Token。恢复保留原生时间、
模型和窗口归属；模型切换、整理及迟到读取均有归属校验。旧的初始模型记录可恢复；
旧数据如经历多次切换而没有模型 revision 证据，仍保持未知。未来提交的轮次在原事务中
记录私有 revision 戳，正常重开可验证归属。详见 Contracts 的 `docs/context-window-restore.md`。

用户正常退出后，通过 canonical `python3 -B scripts/development-client.py start-ui` 增量
重编译并重开，沿用日常身份、Homes 和数据。新 Host SHA-256 为
`93eff1cc0c1de8219071e11d79735e2572502378fa0b0b744dc2c9a177ccf115`。
没有改动本次之前已经确认的浮层样式。

CUA 直接绑定实际 macOS App，冷启动恢复的就是用户截图中已有的 FEAT-170 聊天，
在打开浮层前没有用调试接口预热统计缓存。界面显示“最近一次统计”、
“2% 已用（剩余 98%）”“已用 19.6k Token，共 996.1k”。随后只读接口独立确认：

| 项目 | 原生与 Host 返回值 |
|---|---|
| 原生线程 | `01a1ba5c-e37a-75f3-92c3-649cef8a9b18` |
| 原统计轮次 | `01a1ba5c-e3e2-7101-a11e-0234e71b6469` |
| 最近窗口用量 / 有效容量 | 19,638 / 996,147 Token |
| 原统计时间 | `2026-11-08T08:54:33.663Z`，未替换为重开时间 |
| 模型绑定 | `kimi-k3-1-pro-max-v1`，revision 1 |
| 未用于展示的累计计量 | 76,542 Token |

本次修复 **0 次新供应商请求**，没有发送聊天消息或借用此前验收余额。
证据位于 `.local/context-window-reopen/{audit,native-read-audit,binding,after}.json` 与
`reopened-same-chat.png`；没有在报告中复制完整聊天内容或凭据。

定向检查：Host context usage/window、turn operation、chat model 相关 race 测试及
相关三包 go vet 通过；实际原生文件经生产 reader 读取通过；固定 Runtime + 普通回环
provider 的正常 `new_context`/退出/重开验证通过，读取后线程仍为 `notLoaded`，推理次数
不增加。Host 入口编译通过。Contracts 生成同步、2 项样本测试、OpenAPI lint 通过
（保留原私有 IPC 查询的 1 项未引用提示）；0.1 → 0.2 去除文档后的 wire 结构完全相同。
Desktop API/composable 4 项测试通过，两个日常构建来源 receipt 已更新并经实际启动验证。
没有进行强杀、权限破坏、二进制替换或全量回归。

## 边界与未执行项

- 初次实现阶段没有发起付费模型请求；之后使用本轮明确授权的 5/8 次请求完成上表验证，没有借用此前任务余额。未主动填满接近百万 Token 的窗口，**自动到阈值压缩未触发**；整理链路由显式 new_context 验证。
- 初次真实更新/切换/整理验收时，unbundled 日常窗口无法由桌面自动化绑定。该阶段使用明确标注的只读验证桥连接生产 Vue 组件，实际整理事件另经过生产 Native 显示缓冲和完整对话组件回放；**不把该阶段证据称为一次完整 OS WebView GUI E2E**。本次重开恢复已另外在 canonical `start-ui` 的实际 macOS App 上核验同一条聊天，见上节。
- Host 重开可恢复有归属证据的原生统计；原生未记录或旧统计无法归属当前模型/窗口时，仍显示“暂无用量数据”。`thread/read` 本身不提供完整用量，只读原生文件适配限于当前固定 Runtime，不从历史计费或界面文本补算。
- 原生冷历史重建的 Item ID 可能与此前 live ID 不同。缺少精确身份匹配的旧未知 Item 保持未知，不按顺序或相似文本关联，也不伪造历史公开消息。
- 未执行强杀、权限破坏、可执行文件替换、攻击 fixture、全量回归和生产发布。普通 API/原生事件合成用例只验证展示与适配，不改变模型策略。
- 开发客户端经用户正常退出后从 `pnpm client:dev` 重开，沿用原数据和容器。实际本地 readiness 与新路由检查记录在 `.local/context-window-review/live-check.json`。
- 初次启动观察：原正常入口构建完成，App/Host 运行，`readyz=200`；新 GET 无凭据 `401`、未知会话 `404`。当时未取得可用于只读探测的现有 Host 会话 ID；之后的独立真实会话验证见上表，不冒称对原有日常聊天的验收。

## 回滚

正常退出 App 后移除新 indicator/只读 adapter/HTTP/IPC 与开发 source receipt 引用，再使用原入口重开。不回退数据库、不删除历史、不改模型或 Runtime 策略。旧客户端不会调用新路径，旧服务使新展示进入未知状态。
