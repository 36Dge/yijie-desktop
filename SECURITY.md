# Security Policy

## 桌面端安全要求

- 不持久化平台 access token；
- 高风险操作必须展示审批卡片；
- 本地 sidecar 状态和日志必须脱敏；
- 公开或生产模式不绕过 `yijie-api` 权限和审批策略；
- 不在 fixtures 中保存真实商家数据。

本地 `demo_fast` 是明确的快速验证例外：它不做用户登录，也不依赖 `yijie-api`/Keycloak 启动，
而由 Rust 绑定固定的 local owner/tenant/capability 并继续执行 context、session、Artifact scope 校验。
该例外只能由 `YIJIE_ENV=local + YIJIE_LOCAL_PROFILE=demo_fast` 的精确组合通过 canonical launcher
启用；Agent Host loopback token 与 MiniMax Key 仍必须使用 owner-only 存储，不能暴露给 WebView。

FEAT-125 S5A 的原生 OIDC、Keychain 生命周期、loopback 回调和固定权限投影传输边界见
[`docs/security/FEAT-125-S5A-security-matrix.md`](docs/security/FEAT-125-S5A-security-matrix.md)。

FEAT-125 G3-NP-LOCAL 的本地 CA 信任、`localhost` 限制、Keychain envelope 迁移和本地签名门禁见
[`docs/security/FEAT-125-G3-NP-LOCAL.md`](docs/security/FEAT-125-G3-NP-LOCAL.md)。


### FEAT-155 3C-3B3B 本地候选

B3B独立候选数据根不接触日常库；默认SQL15，候选22。草案发送必须持有本代显式submit/continue的限时原生许可，并在最后POST前重验当前UI/native授权、Host和生命周期；观察许可不能授予发送，重开pending行默认不可claim。 真实Provider与产品D4没有因本批装配而获得资格。

### FEAT-155 4B 对话创建

4A后的显式候选为SQL23，普通入口仍SQL15。会话用途查询只需原task.read及本地资源授权，不给普通聊天新增schedule.read依赖；renderer不能用路由声明已有会话用途。草案提交不确定按原request_id只读查证，确认仅沿原source/digest唯一保存paused。文本之外的附件、目录选择和权限模式不进入草案发送；普通聊天保护仍由native执行。该页面接线不授定时运行grant，不装配manual/automatic authority，也不迁移日常库。

Provider未给出phase时不伪造final_answer。草案识别仅接纳同一受限用途/binding及原生成功终态下唯一完整、严格schema合法的agentMessage；commentary、多个不一致答复、partial、失败或错误JSON不形成可保存候选。确认提交时再次验证原source/digest，不截取正文或自动修补模型输出。


### FEAT-155 4C-2 有限自动执行

显式隔离候选升至SQL24/Host6，普通入口仍SQL15/Host5。SQL24仅在原enable回执追加automatic_consent_version：旧NULL不回填，未知版本拒绝发送。新自动确认复用有限grant、当前UI/native运行授权，并在同事务比对所审阅的expected_next_at；查询及旧请求重放不补标、不续额、不复活计划。

当前候选按manual/automatic/rerun分别准入。手动保持当前进程一次/短期许可；自动由持久有限确认、每次fresh native权威及process/epoch连续性共同限定，不复用renderer TTL；重跑继续禁发。claim与最终POST均验证，最后一次已占额度不重复扣除。旧运行仅只读恢复，完整never可安全取消退款；尝试过的操作不重发，unknown占用只凭可信原生/正常停止证据释放。

native启动区分有效未来自动意图与仅待收尾记录，耗尽/过期/unknown仍可恢复。时间恢复独立有界，管理查询不启动Host；仍用唯一Coordinator。启动默认只允许已授权scheduled出站，不顺带恢复普通未发送消息、草案或删除操作；只有原显式前台授权路径解除这个额外限制。退出/睡眠先失效资格，正常停止失败保留owner与STOP_PENDING，无强杀。仅隔离候选验证，不迁移日常库，不新增唤醒、通知或常驻服务。


### FEAT-155 4C-3 单次授权与独立重跑

显式隔离候选SQL25仅增加按grant关联的单次用途证明（格式版本、manual/rerun、原run引用），次数/期限/占额仍在原grant。旧记录不回填，普通15/Host5及候选Host6保持。单次确认须当前native运行权限与UI/Host/epoch许可，最多1次、最长10分钟；不改计划自动授权、未来槽或自动额度。未知用途版本拒绝执行，旧历史不要求新证明。

manual/rerun使用明确绑定用途的当前进程许可，automatic继续以SQL24持久确认、当前计划指针及连续性核权；不得通过取消指针检查为所有grant放行。重跑只读preview不依赖旧grant，新的运行使用当前配置且绑定原run/快照及当前版本。claim和实际POST再次检查，最后一份已占额度仅完成本run。未知先按原请求查证，原grant/run回执不重建许可；正常重开仅恢复/清理，attempted不重发、unknown释放仍凭可信事实。


### FEAT-155 4D-1 执行时间

普通SQL15/Host5保持，显式隔离候选SQL26/Host6。新缓存仅保存经同一run与native绑定核对的原生时间；查询不获得发送资格，不改变终态、预约、额度或outbox。原native持久format1/2保持，旧记录不伪造时间。

采集由原Coordinator拥有，独立于投递观察，前后台共享单一查询通道；每次最多3次、1/5秒退避、每次3秒。恢复只选择最新50条，更早记录随管理分页/详情有界补读；没有无限追赶或全库历史扫描。写回重验当前native读权限、UI上下文（前台时）、生命周期epoch和全部身份。退出取消时间读取，不阻塞原预约释放。

SQL26兼容reader先行，仅TimingFoundation允许写时间缓存。回退保留26可读构建；不降低版本、不改旧迁移、不接触日常库。


### FEAT-155 剩余交互与应用内重要更新

用户明确排除防自动空闲睡眠和“睡眠后停止发送”的新增实现与专项验收，系统通知仍延期；既有公共生命周期不在本批重构。普通15/5、隔离候选26/6保持。应用内观察使用新的私有同源只读查询，从已有scope内run/needs_attention投影最多50条，既有read权限与异步结果核对适用，不启动Host、不写执行账本、不授执行资格。

全局观察器同一时刻一个请求，3秒查询、失败退避；只在当前授权scope内保留有界内存去重，撤权或切scope清理提示。首读仅提示未处理事项，旧结束结果保留于历史；新状态可通知并定位run详情，聊天跳转仍经原native关联校验。提示关闭不是审批、预约释放或状态确认。没有通知中心、新数据库版本或用户数据副本。

### FEAT-155 经授权的日常接入（2026-09-25）

本次Owner明确授权普通客户端接通日常库，替代以上阶段记录中的“尚未迁移日常库”现状。canonical local/demo_fast默认沿原路径使用SQL26/Store6；无新增schema或共享wire。启动selection只选兼容存储及固定Runtime，不授予计划执行、自动确认或草案工具权限。原单次/自动有限授权、前后台共享预约、未知不重投和正常退出保持；不顺带恢复未授权普通outbox。普通图片协商可共存，草案每轮仍验证真实native空工具/无继承回执。安全回退保留兼容reader、旧库与历史，不降级数据。

Owner已明确移除防自动空闲睡眠与“睡眠后停止发送”；本修复不重新启用上述需求，也不增加系统通知、云调度或常驻服务。

日常旧历史适配不删除未知运行：预约和发送前共用同源占用条件，仅排除明确failed且无native绑定的旧排队记录与已无lease的耗尽清理。专属聊天占位重建仅接受同一scope/计划下never_sent_cancel+退款、create/turn均never、create计数0且无Host/Runtime绑定的证据；在组合事务中重验，旧操作保持禁止重发。
