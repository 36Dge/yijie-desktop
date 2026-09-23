# FEAT-155 第二阶段：计划与时间基础

当前批次4A已完成：原位管理页面、手动paused保存、只读历史、共享管理context和原请求查证已接通。候选SQL23只补真实created_at，旧值未知；普通15/Host5及候选Host6保持。canonical本地候选可使用标准app包，通过精确Host源码清单及原契约校验。真实UI正常重开、亮暗/最小窗口、键盘通过，真实调用0；报告33后停止，不进入4B。以下阶段说明按各自历史时点理解。

2026-09-18本地候选。已实施native日历evaluator、计划/occurrence/请求幂等记录、同一repository worker适配及最小聊天删除保护。没有注册renderer command、自动扫描或实际投递，不启动Host/Runtime，不创建受管目录，不涉及页面、通知或唤醒。

## 来源与时间

共享类型从Contracts独立scheduled-plan v0.1.0派生；`contracts/scheduled-plan.candidate.json`记录base与源/生成摘要，未发布。第一阶段草案schema是时间/目标意图原始定义；没有复制影子DTO。Rust对象Debug不输出名称/内容。

直接锁定rrule=0.14.0、chrono=0.4.45、chrono-tz=0.10.4，TZDB=2025b；chrono原已在锁中，正式锁只新增rrule、chrono-tz及phf/phf_shared 0.12.1，旧包版本未升级。依赖源码与校验值见Cargo.lock。

只接受一次/每日/工作日/每周规则。RRULE从当前查询的当地参考日生成最多16个日历候选（UTC载体）；chrono-tz负责把当地时刻映射回UTC，fold选较早一次、gap跳过，once的gap拒绝。没有自行实现DST或从创建日遍历历史；没有任意RRULE输入或all_unchecked。preview与未来触发共用evaluator，参考UTC与生效下界明确；时区固定在计划中。rule_version=1及tzdb版本随计划保存，不自动把依赖升级解释为已重新验证旧计划。

60秒连续清醒窗口和恢复/时钟跳变优先不补跑仅完成纯函数验证。真实sleep/wake、前后台预约、成本/审批与投递仍是第三阶段职责。

## Reader先行与迁移目标

`LATEST_SCHEMA_VERSION=15`继续表示既有公开的已激活默认版本；`MAX_READABLE_SCHEMA_VERSION=16`是新候选能核验的最高版本。普通ChatRepository/DatabaseWorker入口使用CompatibleReader：新库及15库停留15；现有正常16库完整核验ledger后保持16，不降级。

PlanWriter是显式native构造参数；本阶段只在正常合成临时目录测试中使用，普通启动器未接入。读取版本/ledger在配置WAL和清理过期数据之前预检；open本身仍是普通Chat兼容入口，不冒称物理只读连接。1—15 migration原字节/hash不改，16仅增加计划基础。未知更高版本拒绝；测试用标准migration工具生成普通未来格式，不破坏文件或权限。

计划writer关闭后仍可读已有计划、正常使用聊天；删聊天同事务将已有/专属目标暂停、清除绑定与授权引用、取消本地候选时刻，保留不含正文的target_missing事实。每次新聊天模式不被无关历史删除停用。删计划不删聊天。

原schema15旧binary不能读取16库；回退须保留本兼容reader候选并关闭计划writer，禁止down migration/删表/重置/复制日常库。当前没有日常数据迁移，也没有已发布或已提交的回退制品；本阶段证据不覆盖第三阶段未来run/outbox格式，日常writer激活前须重新确认可恢复来源。

## 存储语义

计划、请求去重和occurrence共用现有SQLCipher和writer。request ID按owner/tenant去重，相同请求返回当前视图；内容变更冲突，删除不会被旧请求复活。编辑带expected revision；时间字段变化才增schedule_epoch，时间回拨不越过已观察生效下界。

所有新建/编辑计划paused，grant为空，不提供开启或claim接口。paused的next_at是候选预览，planned occurrence也不是可消费队列。正常恢复只记录一个有界跨过区间；暂停期间为skipped_paused，不能称为漏执行或业务失败。不创建run/session/outbox或声明成功。

组合授权占用、claim、run、会话和原有outbox必须在第三阶段同事务实现；不可把本阶段独立日历更新直接当调度投递。目标绑定和受管工作目录亦留第三阶段。

## 安全检查

本阶段测试入口：`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib feat155_ -- --nocapture`。仅正常临时SQLCipher、进程内worker、纯时间和普通schema数据；可选`YIJIE_FEAT155_CONFORMANCE_DIR`写合成producer JSON供Contracts schema验证。没有模型、真实服务、用户Home/Keychain或日常库操作。

Rust fmt/clippy、定向旧存储回归、前端lint/build、源生成检查和四个Contracts兼容基线实际结果见元仓08报告。全量历史攻击/故障fixture不执行；不能据此宣称全仓测试或产品D4通过。

## 3A 执行基础（2026-09-18 后续候选）

新增独立 `scheduled-execution` 权威族及生成的 Rust/TypeScript；来源见 `contracts/scheduled-execution.candidate.json`。只增加本地有限授权、运行只读结构、原生目录来源引用和稳定错误，没有 Host 路由、renderer command、自动 timer 或可投递的定时 producer。最高影响为私有 schema breaking。

catalog 增至17，正常迁移目标仍为15。`ExecutionFoundation` 仅是显式 native 候选构造选项，普通入口不选它；正常合成临时库验证15→16→17，1—16原SQL保持。PlanWriter仍只主动迁到16；已是17的库保持17。新的兼容读取不是3B尚未形成的未来格式承诺。

17只新增 grants、runs、全局一个reservation，并在原chat_outbox加scheduled_run_id标识。没有第二队列。即使writer关闭，普通Coordinator的claim、读取dispatch以及真实I/O前均拒绝定时标识记录；预约/unknown/需处理状态同时阻断前台创建和追加。删除中的前台会话继续占用，实际出站还要求原记录保持inflight且没有删除job，避免取消投递/清理间隙被误判空闲。中断仍沿既有正常取消路径允许。未持有定时预约时不改前台之间的并发语义。

`ScheduleExecutionService` 每次从当前NativeAuthRuntime取native-only权限，精确local/demo_fast之外拒绝，不持久化/续期WebView context。读/管理/运行分开；管理还须当前UI确认授权，worker实际执行时再次校验。local能力映射不修改原前台capability投影，字符串本身不代表可运行。计划保存/暂停/删除沿原存储服务，grant确认不启用计划，运行预检最终返回execution_not_ready。

grant绑定plan/revision、完整定义与workspace摘要、authority revision、有限次数/到期时间。相同确认不补额度，旧确认不能重新激活编辑后的grant；目标不存在/非Ask/已删除、scope/revision变化、额度或期限不足均拒绝。managed_schedule目前仅标识native分配策略，实际目录准备/专属绑定仍待3B，不冒充用户bookmark。

事务内预约primitive只供3B未来组合事务复用，3A没有独立提交预约的生产服务入口。普通临时数据检查其run/扣账/预约一起回滚与幂等；它不claim occurrence、不前移next-at、不创建会话/outbox、不给用户成功受理。新运行权限显式Ask，原前台draft_mode不被继承或重置。原生审批观察、释放预约的事实闭环、目标聊天删除扩展和真正出站重验由3B在任何真实投递前完成。

正常合成状态检查明确区分pending/outbox/inflight/queued/streaming/stopping/uncertain和needs_attention；没有故意制造进程或网络故障。日常用户库/Keychain、真实服务及模型未使用，3B/3C/UI未开始。完整结果、失败修正和源摘要见元仓FEAT-155的10-phase-3a-implementation-report.md。

## 3B-1 本地目标与组合事务（2026-09-18）

用户授权的本批仅本地准备，不具备出站资格。新增私有schema18，普通入口仍CompatibleReader/目标15；LocalPreparation只供明确native候选构造，未被App启动器或renderer command选择。旧1—17 SQL和grant摘要保持，读取上限18；17及更早reader不能回退打开18。回退保留18 reader并停用writer/出站，不降级数据库、不迁移日常库。

18将原project记录明确区分user_project和managed_schedule，保留旧项目ID、书签、hash、索引与session外键。managed无书签，由native资源ID和本库目录下的scope目录定位；不伪造用户bookmark。普通项目列表、注册/刷新/置顶/移除/书签接口拒绝managed；会话历史仍保留关联。父表改造采用SQLite标准事务重建流程：仅跨入18时在事务外暂时停用外键即时执行，canonical runner的每个migration仍在提交前做foreign_key_check，结束无论成功失败都恢复原设置，之后再验证ledger和外键。没有writable_schema或跳过完整性检查。

稳定用户definition、grant授权策略与native实际绑定分开存储。专属首次绑定不回填definition或修改revision/digest；每次新聊天按scope/plan/request稳定资源ID区分，重复请求复用。已有聊天按其真实来源解析用户书签或已有受管目录。目录准备不属于SQL原子事务；正常失败无run/outbox，事务冲突后未绑定目录可按同身份复用，不启动孤儿清理或删除用户目录。已绑定目录缺失时拒绝，不静默重建。

ScheduleExecutionService.prepare_manual只在当前native authority及候选writer下准备reserved事实，没有HTTP/IPC入口，也不返回accepted。当前scope校验后先按request查回旧结果，避免自己的预约/耗尽额度挡住重试；仅新请求重验grant/目标/Ask/占用，在同一worker事务内完成run、预约、原聊天/消息/v2 outbox、绑定和一次逻辑额度占用。复用原v2事务helper；run.operation_id就是原turn操作，create操作独立。新聊天显式Ask且不改变前台draft_mode。manual不推进next_at/cursor或自动occurrence。

create_session及派生start_turn保留scheduled_run_id。普通claim和实际dispatch仍拒绝所有定时标识；check_run继续execution_not_ready。未知/在途预约不被超时或用户确认释放，无强制释放接口。删除准备中的目标在事务前及事务内拒绝；正常合成终态的关联可按现有删除流程失效并留下不含正文的run墓碑，new_chat历史删除不取消未来目标。专属/已有引用失效清除未来授权，删计划不级联删除聊天或目录。

本批不改Host、Runtime、共享契约形状或生成Rust/TS，不加依赖。当前managed聊天若在未来激活后直接交给旧sidebar，会被错误标为“项目已移除”；来源感知标签是后续激活前的接续项，本批未改UI或宣称可用。Host恢复、审批观察、退出/睡眠屏障和真实执行仍留3B-2，自动触发/重跑/草案留3C。

检查只用正常临时SQLCipher/目录、真实系统书签的无对话框转换、普通合成终态与事务回滚，不启动App/Host/Runtime/Provider或访问用户库/Keychain。合成终态不是实际执行证据，测试专用状态构造不提供生产释放API。真实检查和失败修正见元仓FEAT-155的14-phase-3b-1-implementation-report.md；全部Must/D4仍未验收。

## 3B-2 恢复与原生生命周期（2026-09-18）

私有候选schema19/RecoveryFoundation增加分阶段出站事实、恢复来源、不可变释放证据和scheduled专用静止投影；普通迁移目标仍15，旧1—18不改。迁移后的旧run出站事实为unknown，不能退款或自动释放。旧chat_turns索引的原谓词保持，只排除有精确证据的静止scheduled历史；busy/active/recovery/权限/删除和旧interrupt按同一含义处置。回退需保留19 reader并关闭writer/dispatch，不降级数据。

两个精确恢复GET消费Contracts同源Rust/schema/candidate，沿owner bearer和受管healthz实例检查，不要求Runtime ready；404/pending/uncertain不自动重投。当前responder不覆盖历史执行来源。accepted只绑定原turn供同一Coordinator读取/SSE观察，审批仍走runtime_approvals和原完整聊天；回调消失不充当终态。精确原生终态在原事实事务释放；可信正常关闭证据覆盖所有可能发送的代次后，未知结果可仅解除占用、不退款。完整证明从未出站的本地取消才一次退款。

生命周期以一个共享epoch控制claim和实际I/O（包含permission-turns），scope停止/Host换代/sleep-wake使旧permit失效。唯一Coordinator停止不再取消进行中的I/O future；超时保留join。主窗口关闭和ExitRequested先拦截，由native owner停止Coordinator/Workflow/Host，确认正常退出后才清bridge、checkpoint并释放全部DB owner。StopPending保留窗口和所有权继续正常等待；无强杀、kill-on-drop或forget清理。

macOS NSWorkspace sleep/wake observer在主线程注册/注销；只观察系统事件、不发出唤醒/强制休眠命令。最低直接依赖使用锁内objc2-app-kit0.3.2/block2 0.6.2。时钟差异仅保守使连续性失效；恢复后沿原有界计算取得未来时间。

claim及实际出站仍拒绝全部scheduled create/start，无自动扫描或新renderer command。普通App不选RecoveryFoundation，日常库未迁移。代码/合成检查与真实OS平台资格分别报告；真实平台/Provider和产品D4仍未验证时，不得以编译或合成结果解除禁发。后续3C/页面/防空闲睡眠开关另批推进。实际证据见元仓FEAT-155的16-phase-3b-2-implementation-report.md。

## 3C-1 受控手动投递候选（2026-09-18）

新增私有schema20，仅保存create/turn的不含正文错误码和native claim证据；1—19迁移保持，普通目标15，兼容reader最高20。`DispatchFoundation`只启用对应存储能力，不赋予发送权；`start_schedule_dispatch_candidate`是明确native构造，绑定当前NativeAuthRuntime，普通App/IPC/环境变量未接入它。正常重开丢弃内存发送权，支持20的reader继续拒绝scheduled，不能使用19旧binary回退打开20。

候选发送沿原worker、Coordinator、outbox和HostBridge。claim和I/O前都重验当前native scope/能力、grant期限/revision、计划/授权目标摘要、精确绑定、Ask及其它占用；本run已有有效占额不要求剩余新增额度，不重复扣额。paused计划可显式手动准备；编辑、撤销或目标失效阻止下一次I/O。只豁免本run精确关联的turn/outbox/public-task，不排除整个聊天；已释放旧interrupt继续不可发。

create按真实项目来源解析用户bookmark或native受管目录，绑定路径hash在发送前复验。scheduled public-task准备强制复用原NativePublicTaskControlPlane的local路径。精确mapping bound和正常创建复用同一事务helper，完成原create并幂等生成原turn operation；恢复本身无POST。never阶段不查询缺失的操作回执，attempted/旧unknown从不因租期过期重新POST。已有会话发turn前查当前Host的精确session/目录、执行与审批；尚无Host session的首次create不要求不存在的同会话审批。

HostBridge在ready/token/身份await之后执行native admission，再在worker事务内重验并记录该阶段attempted和sending，随后复查生命周期epoch。scheduled只走原permission-turns Ask；没有legacy v1、第二发送器或新Runtime协议。epoch变化使旧许可失效；attempt标记后任何不确定结果都进入只读恢复，不撤销尝试记录。HTTP响应、原聊天与run接受/错误事实原事务收口，错误不伪造native终态或退款。

20的native_claim仅由本批受验证claim事务写入；旧记录默认0，旧已claim记录不能冒充本批证明。两个阶段完整never且有native_claim证据时，本地claim计数/本地public-task绑定不再阻止取消；原outbox、cancelled、释放、一次退款同事务。任一阶段attempted/unknown、native turn已存在或无充分证明仍不退款；已远端创建但turn尚未发也不退款。原释放证据、active索引/占用/删除规则保持。

测试只用普通临时SQLCipher和进程内HTTP声明响应，并通过真实native服务、原Coordinator/HostBridge和原生read/SSE提交事实。实际App/Host/Runtime/Provider、macOS平台、日常库/Keychain和真实模型均未运行。候选验证不能解除日常入口禁发；自动触发、重跑、草案、页面和实际激活不属于本批。实际命令/来源与限制见元仓FEAT-155的18-phase-3c-1-implementation-report.md。

## 3C-2 自动触发与独立重跑候选（2026-09-18）

本批扩展私有schema21/TriggerFoundation，新增槽消费/安全未执行原因、run关联、触发格式与确认事实、进程代次/epoch/连续区间/发送截止、不可恢复的发送关闭原因、启用回执与future_hold。旧1—20 SQL不改，普通迁移目标仍15，reader上限21。回退保留21 reader并关闭writer/dispatch；旧20 binary不能回退打开21，不降级或复制日常库。共享RunTrigger/RunView继续来自既有Contracts；没有公共wire、依赖、Host或Runtime变化。

`start_schedule_trigger_candidate`仅是显式native构造，分别注入当前NativeAuthRuntime和同一Lifecycle；存储版本、计划enabled或ReadyForObservation都不授予自动发送权。没有普通启动器、renderer command、环境变量开关或真实平台激活。正常重开丢弃内存连续性，不继承旧进程同号epoch。

`confirm_and_enable`在当前UI/native管理授权下，同事务保存最终revision、新有限grant、enabled、严格未来next_at/槽及回执；旧确认重放只读当前状态，不能续额、复活暂停状态或清除内部限制。原confirm_grant仍只确认；21中enabled计划不能经grant-only静默续额。有未处置占用时不能重授权。预算/unknown等内部future_hold不增加revision或清除本run授权，最后一次已预扣额度可继续；新确认在合法释放之后才能清除限制。普通pending审批只保留预约/attention，真实attempted未知持续停止未来自动触发。

自动处理在原worker/原组合事务复用准备与预约helper：精确槽/revision/epoch重验，消费一次，冻结run/快照、原聊天/outbox/绑定、一次额度及cursor/严格未来时间一起提交。稳定请求身份来自scope/plan/epoch/槽，manual原请求摘要保持，rerun使用独立版本摘要。已消费槽即使取消退款也保留run关联，不能被未来预览恢复。目录准备属于原生文件系统步骤，不冒称SQL原子。

唯一Coordinator的外层和SSE内层调用同一个tick。每秒最多32个到期计划，按next_at/plan_id排序、有界索引查询并yield；原生变更通知唤醒同一等待器。恢复原因/截止和计划时间先于Host运行恢复处理，旧unknown不会掩盖离线槽。每计划多年离线只压缩一个区间，回拨不越过cursor。暂停后已取消槽会推进其inactive cursor，避免占满扫描页。连续清醒窗口两端包含60秒，启动/wake/跳变优先恢复，不补跑。

自动create与turn各自首次实际I/O都需原进程/epoch/连续区间及原槽60秒窗口，Host ready/token/目录/审批await后再次核验；明确忙碌关闭该槽，不等待释放后补发。发送关闭事实独立于通用错误诊断，避免错误码更新重新开放资格。完全never的失效run按原证明同事务取消、释放、一次退款；create已尝试/已创建则阻止turn，保留真实绑定、未知/需处理和额度，仅接受原生终态或可信正常代次停止释放。attempted操作永不重新POST。once在claim时不completed，只有精确对应自动终态或确定未执行且无未来时刻才完成；循环计划单次终态不完成整个计划。

只读`preview_rerun`比较原快照和当前PlanDefinition；`confirm_rerun`绑定原run/snapshot digest、当前revision/definition digest/grant，并在原组合事务重验。新run/new operation/new debit沿当前三目标执行，旧run、自动槽、cursor与next_at保持。旧unknown未释放或pending审批仍busy；合法释放后显式重跑也不更改旧结果。原grant、状态、次数元数据不伪装成内容差异。

检查仅使用普通临时SQLCipher、纯墙钟/单调时钟参数、声明native事件、原Coordinator/HostBridge和进程内HTTP；未改变设备时钟、强制睡眠、强杀或注入攻击。候选源码/检查结果见元仓FEAT-155的20-phase-3c-2-implementation-report.md。真实App/OS/Host/Runtime/Provider、日常数据/Keychain及产品D4继续NOT RUN；文本0/12、图片/商家0。完成后停止，草案/typed IPC、页面、防空闲睡眠及实际激活留后续。

## 3C-3A: private management IPC (2026-09-18)

The Desktop-owned `src-tauri/schemas/scheduled-task-ipc-v1.schema.json` now defines 15 closed commands for availability, bounded plans/targets/history, native time preview, save/pause/delete, grant/enable confirmation, manual execution and rerun preview/confirmation. `scripts/generate-scheduled-ipc.mjs` pins the existing shared plan/execution schema and generated types, then derives Rust, TypeScript, strict AJV validators and a resolved native schema. No shared domain DTO is copied. `contracts/scheduled-ipc.candidate.json` is a local candidate manifest, not a release pin. This batch is semantic; overall FEAT-155 remains breaking.

Every request validates its current UI context, native owner/tenant, capability and authorization revision inside the worker. A short synchronous context lease prevents rebind during the operation; the earlier UI/native expiry is rechecked before transaction commit. Read results are checked again before publication. A write with an untyped transport failure or an invalid late receipt is `operation_unknown`, with its original request ID retained and no client retry. Save and grant-only remain paused; enable does not create a run. Pause/delete use namespaced request digests in the existing request table.

All native plan deletion entry points use the same transaction and same-plan occupancy check. In-flight, attention and unreleased unknown work block deletion; another plan's work does not. Trusted release permits deletion while retaining history. Legacy PlanError maps busy to `ExecutionNotReady`; the private execution boundary reports `ReservationBusy`.

Lists default to 20 and cap at 100. Keyset cursors bind owner/tenant, UI context, command and query; the in-memory registry caps at 512 and expires at 300 seconds. Plan lifecycle takes precedence over future holds: completed remains completed; only enabled plans with holds or insufficient current grants project paused. History separates runs from missed/busy occurrences, excludes planned/cancelled previews, and does not duplicate a linked occurrence. Links contain only scoped local conversation/turn IDs, otherwise a tombstone or unavailable reason. Missing execution clocks remain `unknown`/`not_started`; `needs_attention` does not assert approval state, and native completion does not assert business success. Targets expose directory source, never paths/bookmarks.

Commands call the ordinary database reader and cannot select a writer, migrate, start Host or grant send eligibility. Ordinary schema15/default-deny remains; explicit candidate schema21 is unchanged and no migration22 exists. No draft, page, event platform, real activation or Provider call is included. See the meta repository's FEAT-155 report22 for actual checks and the existing aggregate generation guard limitation. Draft generation remains 3C-3B; this batch stops after reporting.

## 3C-3B2 · 2026-09-19 candidate boundary

The combined B1/B2 batch adds candidate SQL22. Ordinary startup remains SQL15. `DraftFoundation` adds three source/confirmation tables and a deletion tombstone trigger; migrations 1–21 are unchanged. New native IPC commands submit text to a restricted-purpose conversation, preview a trusted source, and confirm a selected definition. They reuse current context/native capabilities, worker lease/deadline checks and generated closed IPC. No page or ordinary activation is added.

New conversations use an existing native managed-directory mechanism without user bookmarks. Original chat stores text, original outbox stores create/turn operations. A dedicated native candidate constructor installs fresh draft dispatch authority; ordinary readers/writers do not gain it. Coordinator uses only fixed draft routes for those records and checks Host capability before POST. Persistent attempt markers prevent lease expiration/reopen from reposting attempted operations. Ordinary chat sends, permission changes and scheduled existing-chat targets cannot upgrade draft conversations. Native resume selects the same restricted route. Clarification follow-ups keep that purpose.

A source is recognized only through scoped local conversation/turn/operation plus exact native bindings, complete `final_answer` item facts and the corresponding successful `turn/completed` notification. Partial display views do not discard intact authoritative items. Missing/failed/interrupted/multiple/unknown-format facts and cold-history-only observations do not establish a candidate. Model text is parsed as one closed JSON value, never code fences or concatenated deltas. Model labels cannot supply target identity.

Confirmation revalidates source digest, normalized user-selected definition and native time/target rules. Source→plan, original save receipt and confirmation request receipt commit together. Same source remains unique across different request IDs and normal reopen. A confirmed replay returns the current plan; deletion never recreates it. Source deletion invalidates unconfirmed drafts while retaining minimal confirmed receipts. A new plan is paused, has no grant and causes no run.

This is candidate engineering evidence, not a qualified live draft feature: ordinary Host remains Store5; actual Manager lacks effective-policy qualification and denies real draft sends. Native root/writer/dispatch construction is not wired into ordinary launch. Real Runtime/Provider/schema support, UI, activation, wake behavior and D4 remain later. The batch consumes zero real model calls; the existing aggregate `generate:check` dirty-Contracts guard remains in place.

Compatible ordinary readers do not resume draft conversations. Draft resume requires the explicit native candidate authority; unavailable draft policy does not block ordinary chat recovery.


## 3C-3B3B 原生装配与草案恢复（2026-09-19）

canonical launcher 的 `YIJIE_FEAT155_SCHEDULED_CANDIDATE=true` 仅选择原生候选：从 Contracts 同源 lock 选定29精确 Runtime，关闭图片/外部扩展组合，使用独立 `demo-fast-scheduled-candidate-v1` 数据根。普通入口仍 SQL15/Host5；同一 ChatRuntime、SQLCipher worker、Coordinator、sidecar 和 Host 组合候选22/6，不开启已有定时计划的手动/自动发送，不新增23/7。

Host私有部署JSON只由native计算scope/目录和传递；renderer不传路径、原生身份或能力。计划读/存、手动、自动、草案分项返回资格；新接口 `schedule_operation_capabilities_v1` 不启动Host、不因读取授发送权。`schedule_find_draft_source_v1` 只按scoped本地conversation/turn重发现source。`schedule_continue_draft_source_v1` 仅显式继续从未尝试的原operation，仍须当前UI/native授权和只读查证；typed client不自动重试不确定写入。

提交/继续生成限时、绑定本代Host/lifecycle/source/operation的内存许可。普通开库、正常重开、只读恢复和已存在pending行都不生成许可。claim与token/readiness等待后的最后POST分别重验；create/turn在最后检查后持久标记attempted，后续结果不明保留unknown，不因租期重发。resume也经准入，只发生在当前显式动作的发送路径。

草案mapping GET和原operation GET只补可信关联。恢复create关闭原create出站但不创建start_turn；显式继续同事务复用原加密正文、原operation及唯一outbox。accepted恢复缺原发送来源时写NULL，并以当前mapping+operation+source组合提供临时观察资格；接收后续原生事件前再次验证。保留完整final与completed事实才可确认，冷历史/部分文字不变成候选。重复确认仍唯一保存paused计划，删除墓碑不复活。

真实无模型检查发现固定Runtime的未执行空线程冷重开可能没有持久历史；该情况保留不可用/unknown，不能创建替代线程或伪造终态。同代尚无turn尝试的已加载线程由Host重验策略后复用原回执。报告31记录97项定向回归、后续草案复测、源/生成物/IPC conformance、真实Host正常生命周期与限制；Provider、完整App页面/电源/D4仍未验收。


## 4C-2 有限自动授权与实际原生装配（2026-09-23）

AutomaticFoundation为显式候选SQL24，普通15/Host5与候选Host6保持。仅追加enable_receipts.automatic_consent_version，旧记录NULL、当前明确确认1；先兼容reader，旧迁移不改。旧启用记录可读，但不因装配升级静默获得自动资格。私有enable封套复用GrantConfirmation并附expected_next_at，同事务复算/比较、保存最终revision/grant/未来槽/确认标记；enable原请求只读查询复用同一回执，重放不补标或重新启用。未知确认版本拒绝投递，不影响旧历史读取。

后台继续使用原native tick、串行worker、原outbox和唯一Coordinator。manual保留4C-1行动许可，automatic使用持久有限grant与fresh native权威，rerun暂不开放；各阶段重新核验。native启动先有界恢复时间/完整never清理，再根据未来意图或待收尾记录准备原Host。旧历史resume失败不阻止时间恢复/其它事实观察，但不能代替本run精确核验；启动默认不出站普通队列，原前台授权路径才解除该限制。不存在页面timer调度、第二队列或常驻进程。

页面两种创建仍保存暂停；启用前明确次数（默认1）、截至时间（下次预计+10分钟）和运行条件，支持取消、原请求查证/同请求明确重试，以及权限/时间冲突后的重新审阅。raw与有效状态分开，旧确认、耗尽/到期、unknown和资源问题有真实说明；已开启计划不自动借用手动许可，需先暂停才可按4C-1立即运行。独立重跑、完整历史时钟、电源/应用内更新另批。实施与合成/真实验证分别在元仓FEAT-155本批报告记录，不把本段当作D4证据。

回退使用兼容24/6的禁发reader，先关闭新确认/claim并正常停止；不降级写库、不回填旧授权、不覆盖数据库。此候选未作发布或生产兼容承诺。


## 4C-3 单次执行与独立重跑（2026-09-23）

SingleRunFoundation为显式候选SQL25，普通入口仍15/Host5，候选Host6。SQL25只新增单次grant用途关联，原grant继续唯一保存限额及期限；旧记录无关联并保持旧解释，不改历史migration或回填。先兼容reader后由明确候选writer迁移，日常库不迁移。

新的私有schedule_confirm_single_run_v1复用GrantConfirmation，native绑定manual/rerun用途、当前revision/目录和rerun审阅事实。它不替换plan.authorization_ref、不消耗或续期自动grant；可用于enabled/paused/completed，deleted及无效目标拒绝。单次仍需要本进程UI/Host/epoch许可，一次/最长10分钟；schema标记不是发送许可。原legacy grant/手动入口保持原规则，不以缺标记推断新资格。

preview只读对照原快照与当前配置，不要求授权。实际rerun沿原组合事务创建新run/operation及original_run_id，保持原历史；现有trigger fact格式不改。相同请求只返回原事实，读single_grant/rerun回执不新建许可；Host换代/重开不能续投。有效新rerun不被旧never清理取消，失效never按原一次退款/释放收尾，已尝试只观察。并发、待审批和unknown继续共享预约，不增加执行器或队列。

回退关闭新single确认/claim并正常停止，保留25/6兼容读取；不降级SQL24写库或覆盖数据库。实际验证与限制另见元仓本批报告，不以本段声明完整D4。

## 本地来源固化

FEAT-155 Runtime来源为`fb79b1d53501ec90084b584af5fdbe221c7a25aa`，Contracts为`54be9314dce5319b049dc0a236800fd1a1fdd7a1`，Host为`56e9a924454e850bd181c452c35078b3e0a36954`。六份共享consumer元数据固定实际Contracts commit；Host构建锁固定完整Host commit并逐文件比较Git对象，不再只依赖工作树摘要。既有FEAT152锁仅更新同一Host实现来源，wire和权限语义保持。普通SQL15/Store5与隔离候选26/6不变，未授权日常库迁移或发布。
