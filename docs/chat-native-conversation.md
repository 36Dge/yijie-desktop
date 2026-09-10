# FEAT-132 Native Conversation 接入

2026-09-09 已通过local/demo_fast D4，十项Must AC全部通过；仅本地提交，未发布。原生协议 → Host 安全投影 → Native 单一显示缓冲及 SQLCipher → Vue 完整视图。最终证据见元仓 FEAT-132 的 02-verification.md，机制与边界见 03-native-protocol-adjustment.md。

权威源为 `src-tauri/contracts/native-conversation.json` 的精确 Contracts 快照，以及私有 `src-tauri/schemas/chat-native-conversation-v1.schema.json`。运行 `pnpm generate:native` 生成 Rust/TS/AJV，`pnpm check:native` 校验生成物、跨仓来源和旧引擎删除。没有新增依赖。

迁移为 `0014_chat_native_conversation.sql`，仅前向事务扩展；Keychain、SQLCipher、scope、外键和删除机制不变。新表记录 native binding、事实、source/revision 及可丢弃视图；本地提交状态独立。旧记录只读，旧 Runtime ID 不证明来源。

协调器是唯一写入者。普通 history IPC 只读，不因 thread/read completed 提前停止同代实时 SSE/Artifact。确认 Host nonce 换代后可用原生 read 结束状态恢复，明确标注 runtime_read / partial；已观察原生终态优先。

唯一 NativeDisplayBuffer 按原生 Item/segment 追加 delta、按 cursor 去重。final 对象整体替换，无前缀对账、自动封口或客户端事件历史重建。Vue 只替换完整 view，保留选择 epoch 和 subscription 隔离。旧全局 timeline fallback 已删除，旧 reasoning/附件/Artifact 仍通过同一 timeline 只读可见。

正常切换前必须在旧版正常结束活跃 Turn 并退出；无新 Host nonce 来源的旧活跃行拒绝猜测接管。D4在旧应用正常退出后，以固定提交的隔离构建读取现有app-data，未复制用户数据库或凭据；Host Home隔离，未证明原Host全部运行映射已完成日常接管。schema 14 不兼容旧版本写入，禁止降级迁移、静默复制 DB 或自动启动旧 reducer。

Contracts 已固定 6f632f155eacdaf93df0e0b00b5dab9e369c5442；Host 已固定 9e9d317f7e4ecff5f8aeec94fa467f9bede32139。原生来源使用 native-conversation.lock.json，FEAT-152 既有整体 Host 来源校验保留并更新真实 SHA/digest。canonical runner 强制原生 committed pin，未放宽来源或权限门禁。本次独立授权累计上限25次文本、3次图片；D4实际使用19次文本、1次图片。

固定Runtime可能缺少phase或部分冷历史，界面保留未分类/不完整提示。Host当前只传递Command输出的pending-final提示，原生completed后整体安全投影最终正文，不提供逐字流式Command输出。图片动态工具保留安全unknown展示，Artifact资源独立支持预览、保存与重开。

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
