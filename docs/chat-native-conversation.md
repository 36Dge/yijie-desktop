# FEAT-132 Native Conversation 接入

2026-09-09 已通过local/demo_fast D4，十项Must AC全部通过；仅本地提交，未发布。原生协议 → Host 安全投影 → Native 单一显示缓冲及 SQLCipher → Vue 完整视图。最终证据见元仓 FEAT-132 的 02-verification.md，机制与边界见 03-native-protocol-adjustment.md。

权威源为 `src-tauri/contracts/native-conversation.json` 的精确 Contracts 快照，以及私有 `src-tauri/schemas/chat-native-conversation-v1.schema.json`。运行 `pnpm generate:native` 生成 Rust/TS/AJV，`pnpm check:native` 校验生成物、跨仓来源和旧引擎删除。没有新增依赖。

迁移为 `0014_chat_native_conversation.sql`，仅前向事务扩展；Keychain、SQLCipher、scope、外键和删除机制不变。新表记录 native binding、事实、source/revision 及可丢弃视图；本地提交状态独立。旧记录只读，旧 Runtime ID 不证明来源。

协调器是唯一写入者。普通 history IPC 只读，不因 thread/read completed 提前停止同代实时 SSE/Artifact。确认 Host nonce 换代后可用原生 read 结束状态恢复，明确标注 runtime_read / partial；已观察原生终态优先。

唯一 NativeDisplayBuffer 按原生 Item/segment 追加 delta、按 cursor 去重。final 对象整体替换，无前缀对账、自动封口或客户端事件历史重建。Vue 只替换完整 view，保留选择 epoch 和 subscription 隔离。旧全局 timeline fallback 已删除，旧 reasoning/附件/Artifact 仍通过同一 timeline 只读可见。

正常切换前必须在旧版正常结束活跃 Turn 并退出；无新 Host nonce 来源的旧活跃行拒绝猜测接管。D4在旧应用正常退出后，以固定提交的隔离构建读取现有app-data，未复制用户数据库或凭据；Host Home隔离，未证明原Host全部运行映射已完成日常接管。schema 14 不兼容旧版本写入，禁止降级迁移、静默复制 DB 或自动启动旧 reducer。

Contracts 已固定 6f632f155eacdaf93df0e0b00b5dab9e369c5442；Host 已固定 9e9d317f7e4ecff5f8aeec94fa467f9bede32139。原生来源使用 native-conversation.lock.json，FEAT-152 既有整体 Host 来源校验保留并更新真实 SHA/digest。canonical runner 强制原生 committed pin，未放宽来源或权限门禁。本次独立授权累计上限25次文本、3次图片；D4实际使用19次文本、1次图片。

固定Runtime可能缺少phase或部分冷历史。2026-09-29 起，单纯缺少可识别phase的正文以普通“模型回答”展示，不再显示未分类警告；内部phase未知及原始记录保持不变，真实内容不完整提示继续保留。Host当前只传递Command输出的pending-final提示，原生completed后整体安全投影最终正文，不提供逐字流式Command输出。图片动态工具保留安全unknown展示，Artifact资源独立支持预览、保存与重开。

本次阶段兼容调整的 `contract-impact = none`：只修改 Desktop 标签、图标及说明文字；Desktop/API/Agent Host 跨进程协议、原生phase、消息/轮次终态、权限保护、本地持久状态及重放格式均无变化。

隔离源码验证可通过 canonical runner 的 `YIJIE_DEMO_FAST_RUNTIME_ROOT` / `YIJIE_DEMO_FAST_PROVIDER_KEY_FILE` 指向同一份已有 Runtime 产物和凭据文件，不复制密钥、不替换产物。两者必须绝对路径，原有 binary/manifest SHA-256、普通文件、非符号链接和 Native owner-only 校验保持；默认路径不变。

## FEAT-134 原生展示调整（2026-09-09）

本次只修改展示与无调用残留，继续复用相同 v7/NativeDisplayBuffer/private view/SQLCipher，未新增协议或迁移。原生 reasoning 的 summary/content 在界面按类别和原生索引分别展示，summary-only 不作为原始正文证据；原生完整对象继续直接替换草稿。

UI busy 与执行事实分开：只有当前有效订阅观察到的活跃 Turn 才能显示忙碌；加载历史不建立 live 标记。原生 view 的 partial 初值不代表停止执行，需结合实际订阅、原生状态和明确缺失诊断；Item 缺 completed 时保留最后观察事实，Turn 结束后以独立文案提示缺结束记录，不封口、不回写状态。

Item availability 原值传入卡片；现有 private view 没有 diagnostic scope，允许的诊断代码保守按会话展示，未知代码使用固定文案，不把提示猜测绑定到 Turn/Item。旧 v4/v5 DTO、历史 IPC/表、Artifact/Command 适配保留。无调用的 v4/v5 内容发布方法及专属辅助代码已删除，FEAT-137/152 语义与开关边界不变。

本次新验收状态以元仓 FEAT-134 调整记录为准，不继承原 D4。CI 修复使用兄弟目录和真实固定来源，不减少校验；尚未实际运行的远端 CI 不写 PASS。

## FEAT-136 原生 Command 展示调整（2026-09-09）

Command 的进程内展示类型现在区分原生与旧档案。原生分支直接持有已有生成 Item 的只读引用、source 和 lastMethod，不再填造旧 startedSource、目录结构或 output.retention。cwdLabel、outputText、exitCode、durationMs 直接展示，0 值与合法空输出保留。

failed/declined 的固定文案和 command_failed/command_declined 是显式原生 status 的产品展示映射，不是 Codex 原生 error 对象；不根据 exit、Turn 失败或 availability 改写执行结果。历史/缺结束记录沿用既有 busy/activityLabel，避免播报“正在执行”；Item partial 只说明信息不完整，不猜上游截断原因。

Host 的最终安全输出策略、native v7、唯一缓冲及 SQLCipher 保存完全复用；会话级 pending-final 诊断说明曾观察到输出通知，不猜 Item 归属。旧 v4/v5 DTO、IPC、表、读取及安全投影有真实兼容依赖，未删除或恢复其为新对话引擎。真实 Tool 仍属 FEAT-144，未扩展 native Tool 能力。

普通 canonical 验收另发现外壳没有消费已有的缩放视口宽度变量、长标题撑开 Chat Grid；最小修复为使用既有缩放宽度及 minmax(0, 1fr) 单列，不增加状态或权限。最终真实成功/失败两条 Command、200%、键盘复制和正常重开通过；本次独立请求累计3/10文本、0图片。本次八项 local D4 基于当时的工作区候选完成；验收时逐文件 SHA-256 及后续提交、推送状态分别以元仓 FEAT-136 验收和交付记录为准，提交或推送不表示重新运行 D4；原五项 Command D4 已完整归档。


## FEAT-144 原生实现（2026-09-10，阶段记录）

当前工作树的新主源为`src-tauri/contracts/native-conversation-v2.json`和私有`chat-native-conversation-v2.schema.json`，使用native-thread v2、SSE v8、私有history/view v2及原有唯一缓冲。上文v1/v7与schema14段落保留各次历史交付范围。新增schema15只前向增加facts/views格式标记；旧JSON不改写，格式1/2分别读取，未知格式经recordDiagnostics传到历史/worker/IPC/前端，并阻止缺失记录补建和活跃缓冲启动。facts不回放。

原生MCP结果保留安全server/tool、content原生索引和实际状态，空、缺失、未支持、容量及安全处理分开。新Tool不再使用旧DTO伪填，状态/来源/文本直接来自Item；旧Tool兼容renderer和v1出口保留。容量超限缩减正文而保留新Item原生头部；原生完成不由Turn完成或availability推演。复制只使用已有安全文本，链接不激活。

Sorftime本地配置入口为`YIJIE_DEMO_FAST_SORFTIME_ENABLED=true pnpm tauri:demo-fast:app`，必须先通过全部真实来源检查。构建后由用户在系统隐藏输入框输入Account-SK；取消不启用。密钥仅经一次性受管进程环境交接，传给Host后清除Desktop保留副本，不进入WebView/argv/日志/数据库。沿用当前系统HTTPS代理和Codex原生Bearer/真实版本User-Agent；未验证的PAC/SOCKS入口停止。

仅核实原生请求批准/user/workspaceWrite/Prompt、startup ready及实际工具schema后允许开始业务Turn。切换其它模式前，正常结束活跃Turn并经正常退出/清理/禁用MCP重启确认失效；回到请求批准不自动重连。FEAT-152权限含义及普通图片工具注册不改，FEAT-137不恢复。

源契约 db54c617c65db5431b950eb297ba148a43a8e600、Host 31ee71889f83aff53dce6eeacd4b5ca4fd319c6b 已本地提交并固定消费者来源。最低兼容 reader 为 25b004fbd5a4dcf642a503d302c21a7d6e3b817f（writer=1）；其实际提交树通过生成、类型和3项正常格式/迁移检查。当前最终 writer=2 后于该基线。canonical 及 D4 仍待执行，9项活动 AC 未关闭，AC-004 业务失败场景用户排除。当前业务 0/10、元数据 8/10、模型 0/8，图片未授权；不得继承上文 FEAT-132/134/136 的调用额度或 PASS。


FEAT-144 canonical 首次启动发现并修正：固定 Runtime 的 `config/read` 返回的是含默认值的有效配置，Host 现按真实原生序列化校验；不放宽未知字段、功能开关或秘密隔离要求。Sorftime 显式启用时，启动读取旧历史不再逐个恢复旧原生线程，避免仅打开应用就初始化外部服务。若旧记录仍含活跃 Turn 绑定，保持拒绝，须先在普通入口正常处理；不改写状态或猜测接管。未启用 Sorftime 的 FEAT-152 恢复路径保持原行为。新验证须从新会话发起；已有记录只读仍复用原生保存与读取。


## FEAT-144 本地不确定投递与当前原生状态（2026-09-11）

实际Sorftime成功、原生参数审批、业务返回独立对照、配置兼容后的权限切换及普通历史重开已完成；当前D4仍以元仓FEAT-144最新验收为准。上节实施前预算和来源保留当时范围，不代表当前调用台账。

真实续验发现：一条已有Host会话的本地text v1提交被拒后，保留queued/no-native-Turn和failed outbox；它的历史执行结果不确定。旧Sorftime启动检查仅看本地queued就阻断整个界面。修复不改这条记录、不补造终态、不重发或恢复旧线程。

新增独立native-thread-status读取使用Contracts生成DTO，Host直接调用原生thread/read(includeTurns=false)。旧native-thread响应、history格式、SQLCipher表及唯一缓冲均不变。只有本地queued、无原生Turn绑定、同scope/session/operation的失败出站且无可调度出站，结合精确原生idle或notLoaded，才允许保留旧记录并打开新任务。notLoaded仅说明当前Runtime未加载，绝不表示旧请求未执行或已完成。active/systemError/未知/缺失/读取失败或任何原生Turn绑定仍阻断。没有原生状态的新Host接口不能回退成历史猜测。

这个状态读取不resume、不启动MCP、不授予原生verified scope、不写入事实或权限。旧任务仍不能自动续跑；未启用Sorftime的既有权限恢复路径保持原样。新HTTP操作遵守provider-first，实际Contracts→Host→Desktop pin按依赖固定；旧reader与schema15最低回滚基线不因临时状态DTO升级。


## 每轮原生耗时（2026-09-29）

`contract-impact = additive`：仅增加 Desktop 私有只读 `chat_read_turn_timing_v1`，源为 `src-tauri/schemas/chat-turn-timing-v1.schema.json`。沿用 `read_sessions` 权限和现有 Host 连接，不启动、恢复或发送 Runtime Turn，不新增 capability、依赖、持久化表或重放字段；现有 IPC 响应不变。旧 Desktop 忽略新增 command，新 Desktop 遇到不支持的 Host 或未知计时数据时省略耗时，不影响正文/执行。回滚只需回滚代码，不做数据库降级。

复用 Contracts `54be9314dce5319b049dc0a236800fd1a1fdd7a1` 的既有 `native-turn-timing` 契约与 `contracts/native-turn-timing.candidate.json` 固定来源。Rust 直接使用既有生成的 `schedules::timing_generated::NativeTurnTiming`；新增 TS 类型/校验器由同一份已固定 schema 生成。公共 wire 变更 N/A：继续调用既有 `GET /v1/agent-sessions/{session}/turns/{turn}/timing`，未修改 Contracts、Host 或 Codex。生成/漂移检查纳入 `generate:native` / `check:native`。

来源检查确认 `yijie-codex/codex-rs/core/src/turn_timing.rs` 已有 `TurnTimingState`：开始时记录 Unix 时间和单调时钟，完成时产生 `completedAt` 与 `durationMs`；后者为整轮经过时间，包含等待，不是模型推理时间或工具耗时求和。Host 已通过稳定 `thread/read` 暴露这些事实，定时任务已有使用，本次仅把它们接到普通对话。

Native 以 scoped 本地 session/turn 查精确 Host session、Runtime thread/turn 绑定；读取前后均验证权限和绑定，删除中的会话不返回计时。UI 只在当前有效订阅的活跃轮次依据原生 `started_at` 刷新“已处理 N秒”，完成/失败/中断后使用原生 `duration_ms` 显示“用时 N秒”，取整与 Codex CLI 一致。绝不以计时结果推断 phase、终态或业务成功，也不以本地发送时间、消息到达时间或两个秒级时间戳相减替代最终耗时。

读取按生命周期键去重，最多两路并发；数据暂缺最多三次有限读取（重试间隔 1秒、2秒），结束状态触发重新读取，秒数刷新仅在前端显示层执行，无每秒 IPC/Host 轮询。切换会话/权限失效/卸载取消请求并隔离迟到结果。原生零值保留；unknown、invalid、旧记录无计时或临时读取失败都不伪造 0秒，不影响正常正文阅读。所有计时事实只保留在当前页面内存。


## 整轮过程展开（2026-09-29）

`contract-impact = none`：在上一版计时接口上，仅增加 Desktop 的整轮展示状态；不新增接口、请求、持久化或重放规则，不改 Codex/Host。耗时行有可折叠过程时成为按钮，没有耗时可用时回退“处理过程”；无过程时保留普通耗时文字，不制造空入口。

折叠仅接受明确的 commentary/reasoning/command/tool 和已知执行计划。final_answer、assistant_unclassified、用户输入、生成内容及未知类型保持可见，不按文本、顺序或 item/completed 猜阶段。待审批、决策核对/错误、异常或不完整项目保持在折叠控制之外，既有审批边界及安全内容投影不变。展开时保留原始条目顺序，用户中途追加输入不被过程分组吞入。

终态/历史默认折叠，当前有效 liveObserved 运行轮次默认展开；未手动选择时终态自动收起。手动展开/收起或在过程区交互后保留用户选择，不被计时刷新、完整 view 替换或新增 Item 覆盖。触发器使用独立稳定键；条目通过可见性控制保留 DOM，避免打断选择和工具详情状态。分隔线仅覆盖内容列，样式复用 yijie tokens。


## 日常入口缺少过程数据的排查与标题精简（2026-09-29）

真实日常运行记录确认：截图对应轮次使用 MiniMax-M3、effort=none，原生只记录用户输入与一条 phase 缺省的助手正文，没有 reasoning、commentary 或工具调用，duration_ms=7882。运行中 Runtime 的启动参数同时包含 model_reasoning_effort=none 和 model_reasoning_summary=none；具体轮次的 summary 设置还可能沿用原生会话配置，不能仅凭全局参数判断当轮。

Host 的普通 StartTurnV2 将未指定 effort 归一化为 none，日常 Desktop 请求未显式覆盖。已有 FEAT-134 high/raw 配置属于另一个受约束启动模式；启动器 --stable-api-only 分支才显式选择它，且与实验动态工具能力存在互斥检查。不能只改前端、修改本地运行数据或伪造过程文字来补齐未产生的历史输出。

前一轮过程折叠功能验证使用合成的过程数据，没有证明日常模型入口已启用推理；本次补充真实链路排查，不把 UI 单测当作真实推理输出验收。若要日常入口实际生成推理过程，需要另行实施并验证相应的模型/Host 配置，不通过关闭既有互斥检查直接启用。

本次 UI 精简隐藏 final_answer 和 assistant_unclassified 的助手图标与“模型回答”可见标题，保留无障碍名称、现有消息状态、正文、复制及异常提示。contract-impact=none：只调整前端可见标签；Desktop/API/Host 接口、推理配置和本地持久状态不变。

## 日常推理输出接通（2026-09-29）

`contract-impact = semantic`，部署配置权威为 Host `docs/native-daily-reasoning.md`。日常 sidecar 在真实 MiniMax、local/demo_fast、原生权限启用且不是合成测试环境时，显式传递 `YIJIE_NATIVE_REASONING_ENABLED=true`。Host 的已提交来源由 `contracts/scheduled-host-build.candidate.json` 固定。旧 FEAT-134 隔离模式的工具互斥不变，日常图片注册、原生审批和定时任务权限不变。

Host 为新派发轮次选择已有 `high` effort，复用已有 `show_raw_agent_reasoning` 原生设置并开放既有 summary/content 投影；不增公共 wire、数据库、Tauri command 或 capability，不升级 Runtime。输入摘要保持原请求的归一化值，开关变更不会让既有 accepted operation 重试发生冲突或再次执行。

前端继续依照原生 reasoning Item 与索引接收流式过程，运行时显示，结束后点击耗时展开或收起。普通模型回答仅显示正文及原有状态/复制操作，隐藏可见标题和助手图标。历史中从未产生的推理不会补造；模型未返回过程时仍只显示耗时。

本地来源先固定，再通过 `pnpm tauri:demo-fast:app` 标准构建及正常退出/重开验证；只更新项目可复现开发产物，不覆盖已发布应用，不变更历史数据。真实运行结果另见本次验收记录。

## 完成耗时文案与重复状态（2026-09-29）

`contract-impact = none`：仅变更前端呈现，Host/Runtime 接口、原生计时、权限及持久化不变。确认整轮 completed 且原生 duration 已知时，时间行显示“已完成 Ns”（总秒数向下取整），使用 body 14px，较原 caption 12px 增大 2px。失败、中断、未知或仍在运行的轮次不因计时返回而显示成功。

完成的模型回答移除右侧重复“已完成”和空标题行，同时移除失去目标的 aria-describedby；进行中/异常/活动提示保持可见。既有耗时展开箭头、鼠标与键盘操作、正文及复制保持。

## 模型回复底部复制时机（2026-09-29）

`contract-impact = none`：仅在 Timeline 展示边界以已有 Item 状态控制整条消息的操作插槽。assistant_message 在 started/streaming/incomplete 时不显示底部复制按钮，只有 domainStatus=completed 时才显示。该状态沿用原生 item/completed，不以正文非空、busy=false、final_answer 阶段或 turn/completed 代替。用户消息与代码块复制不变，既有复制权限和审批内容保护不变；不修改协议、Runtime、计时或持久化。


### 2026-09-30 思考扫光与流式呈现

`contract-impact = none`。只消费当前 native live / progress / Item busy / phase，接口、持久化、权限、原始事件与计时不变。正在思考扫光位于当前输出末尾；不在历史、异常、终态、工具执行或正文输出时假称正在思考。首段回答开始即默认收起过程，用户选择优先。`ChatStreamText` 仅保存动画范围，全文立即呈现；正常 Item completed 立即结束文字动画并沿用既有复制时机。动画不参与 native reducer、阶段判定、Turn 结束或计时。


## FEAT-156 模型选择实施候选（2026-10-02）

新增模型 profile 源与模型感知 Host 路由；原生 SQLite 28 保存会话选择、revision、待查证选择操作与每个提交的不可变模型快照。首轮 operation 在 Host 绑定后才物化 outbox，快照以已预留 operation ID 保存并关联会话，不能以不存在的首轮 outbox 外键阻止新建。Host Store 7 保存 profile 与幂等切换回执。旧计划缺 model_profile 保持旧 MiniMax 语义，旧摘要不重算；新计划将 profile 纳入原授权摘要和 run 快照。

同一 native thread 的正常 unsubscribe/resume 经真实两 Provider 确认可切换 max/high/max；不复制历史或重建 thread。关闭新 writer 时，新模型 outbox 留存，不回退给旧接口发送。Owner已批准0004恢复上游tool_choice=auto及0005严格承接完整终态工具参数，独立产物保持input-only空工具集、沙箱和权限边界。最终本地D4已完成：两模型对话/文件/工具/图片/受限草案、三目标计划、模型冲突、亮暗视觉、正常重开和缺配置恢复通过；标题沿原有关闭门禁，没有真实标题请求。具体事实与限制见元仓FEAT-156的02-verification.md §8，不表示生产发布。

SQL29为已有无项目聊天的managed_chat工作目录补齐计划grant/run的CHECK闭集；先更新共享scheduled-execution0.2.0源与生成reader，再通过canonical迁移保留旧行、摘要、外键及proof/timing触发器，不修改既有SQL17/28校验值。旧数据无模型回填。已有/已绑定专属目标编辑时读取当前已确认模型；不一致的运行拒绝为grant_stale，模型变更后需新授权，旧运行保留原快照。新默认缺配置时终态聊天历史可读；未结束/未知请求不因此重发或解除恢复限制。
