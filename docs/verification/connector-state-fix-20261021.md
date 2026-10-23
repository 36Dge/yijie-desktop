# 连接器选用与持久化修复（2026-10-21）

用户明确授权按审计结论修复聊天选用、全局启停、凭据保留及正常重启恢复，并重新打包原生验收。

## 设计与兼容

整体 `contract-impact = breaking`：Desktop 私有存储增加 schema 37 的 suspend 操作类型，旧 reader 最大支持 36，应明确拒绝而非把停用误解释成删除凭据；不得直接降级读取新库。已有记录、凭据引用、安装代际和启用意愿原样迁移，不重新安装或猜测恢复历史已删除凭据。回滚应用前使用正常退出后保留的迁移前数据库备份，不能降级丢弃新增动作或用户数据。

公共 wire 为增量：Contracts market-provider/1 0.4.0、market-host/1 0.3.0 增加 provider_suspend，复用原身份绑定和 ProviderStatus，旧方法及其值解释不变。先 Worker 支持正常关闭连接且不读写 Keychain，再 Host 撤销执行准入并转发，再 Native 使用；未知方法绝不降级调用 forget。Native 操作回执仍使用已有 disable，无新 UI DTO/command/capability、平台 endpoint 或权限范围。新停用不改变 credential generation/ref，revision 推进阻断旧调用。

Owner/consumer 范围沿用用户本次明确修复授权：Desktop、Agent Host、Connectors、Contracts。本次为本机未发布候选，源码/生成来源通过 canonical generator/sync 记录；不把 dirty sibling 写作已发布 immutable tag，不提交/推送/签名/发布。公共管理、选集与历史业务 wire 保持原样；不修改 Codex Runtime。

聊天菜单以当前对话选集为唯一开关值，选用权限来自 connector.use；选中项可移除，不需要全局管理权限。仅已连接项目可新增选择，未就绪项目可前往管理页，不能在聊天菜单启停或清除授权。刷新只更新已选项的精确引用，不自动加入所有连接器；不同对话草稿分别维护。

管理页开关表示持久化启用意愿，真实连接状态独立显示；启用后的启动恢复仍以当前 Host 的实际探测为准。普通停用保留配置/授权；既有明确确认的卸载入口负责清理凭据，禁止把单纯关闭连接解释为清除配置。授权有效性不因本地保留承诺而伪造。

验证仅使用普通组件、合成协议状态、正常数据库迁移/重开、canonical 构建和正常退出/重启。遵守用户禁止强杀、权限破坏、运行时替换和攻击注入的约束。实际凭据此前已删除的 Sorftime/Tushare 不从未知来源重建、不伪造已恢复。

实施、验证结果与限制在完成后补记。


## 已完成的代码与定向验证

- 聊天菜单使用 selection-change，只改当前对话的 selections；不调用 setEnabled/configure/authorize。刷新、页面切换不重新自动选中；发送后保持会话选集。管理开关取 desiredEnabled，连接状态单独反馈。启动层 App 绑定可信 context，并独立持有操作观察订阅；页面退出不会中断启动恢复回执观察。
- Suspend 在 Worker 正常取消/等待旧操作与关闭 backend 后成功返回，无 Keychain 读写路径；Host 先撤权再转发；Native 保存原配置/授权与凭据代际。卸载仍走原 forget。
- Schema 36→37 迁移逐项保存既有安装状态及完整操作回执；普通停用→正常关闭/重开数据库→再次启用沿用相同凭据引用/代际；随后明确卸载才删除引用。新增两项 Native 测试通过，既有启动恢复测试通过。Worker suspend 正常清理测试通过，无真实凭据或网络。
- 前端相关 5 文件65项通过；另外 ChatPage/ChatComposer/chips/drafts 4文件117项通过、2项既有功能开关跳过；App及相关恢复/选择3文件39项通过。后者与前述有重叠，不累加为唯一测试数量。
- pnpm lint、Native all-targets clippy、Worker scoped lint/clippy、Host定向路由/正常EOF两项及相关包go vet通过。契约 market-host-test 8项Node、7项Rust、Go及clippy通过。
- 六个登记比较基线的 JSON Schema 检查通过：1a213ac8383e95ac6ec69363937687904fa3591c、35e0949c95d7a59ca5480715c225766dcc822056、f16a497e1377f45747f8ff9292b4b60cf2027f88、6f632f155eacdaf93df0e0b00b5dab9e369c5442、811f38d6b104fa18477107e7ac91a85e19c445d1、e35ae9a0711014e4774a1347413e9a343ce7ab2c。自动结构比较不覆盖上述私有存储回滚限制。
- make build、文档构建通过；完整 make lint 的旧公共API源检查因 Contracts checkout 含本轮及前序未提交改动而拒绝，未绕过或修改门禁。未运行历史攻击/强杀/权限破坏全套，也不宣称全量测试通过。
- 首次通用 cargo fmt 因 Worker 历史 qualification 模块路径失败，并格式化了生成文件；已经 canonical sync 恢复生成字节，使用项目 scoped rustfmt/worker-lint通过。打包第一次由生成漂移检查阻断，修正后第二次由专家来源锁变化阻断；没有关闭校验。
- 专家依赖 Host 契约源，因此用 canonical generator/sync/package 更新来源记录；75项资源 metadata 和全部75个归档逐字节/摘要核对不变，既有专家schema定义不变。更新真实生成的 manifest/authority 摘要与 Host固定目录摘要，再用 canonical freeze 记录源；不改变专家知识或权限。证据 `.local/connector-state-fix-20261021/retained-expert-content.json`。
- 旧应用经 Cmd+Q 正常退出，确认应用/Host/Worker和数据库句柄均已关闭；加密数据库迁移前离线备份在 `.local/connector-state-fix-20261021/pre-schema37/`，不复制明文密钥，不修改用户数据来制造状态。


## 最终原生验收

使用 canonical `scripts/run-local-demo-fast.sh --packaged` 完成新构建并启动，应用身份、daily 数据根与固定 scope 均保持；实际窗口1268×780、100%缩放。应用、Host、Worker 均通过正常 Cmd+Q/EOF 退出，没有强杀或替换既有 Runtime。

1. 管理页显式启用 Shopify：成功 probe，schema37 中 installed/desiredEnabled 均 true，generation=5、revision=25。
2. 管理页普通停用：成功回执 kind=suspend（不是 forget），revision=26，desiredEnabled=false，installed=true；凭据引用的脱敏摘要及 generation 与启用前相同。然后可直接重新启用，revision=27，不出现重新配置要求。
3. 聊天菜单选用再取消：图标即时增减、菜单不关闭；对照数据库没有额外 enable/disable/configure/authorize 操作，仍 globally enabled。前端测试另验证当前对话取消不影响另一对话草稿、刷新/导航不自动重新选择。
4. 保持 Shopify 启用，正常退出后再次完整打包启动，自动 probe 到 revision=28。原生验收发现后台窗口的 UI 状态观察可能延后，补充 App 独立、有界观察订阅及页面隐藏不取消应用观察的回归测试（App/store 2文件35项通过，pnpm lint通过），再次正常退出并 canonical 打包启动到最终构建。
5. 最终构建 PID27221：启动自动发起且仅发起一个 enable/probe，revision=29；没有点击启用、重新授权或重新配置。Worker 脱敏诊断显示北京时间21:00:06启动、21:00:14完成 initialize/tools/list；首次前台状态同步确认 succeeded/connected。desiredEnabled=true、installed=true、generation=5、凭据引用摘要始终一致。随后只打开管理列表，实际显示已启用，开关 on。Sorftime/Tushare记录与重启前逐项一致。

**后台显示边界**：后台 WebView 的定时器仍可能由系统延迟调度，实验中数据库完成回执在窗口置前后才同步；不能声称“后台完成回执已即时持久化”。实际后台连接探测完成、正常前台自动显示已连接，不需要手动再启用。App订阅有原操作/120次/5分钟上限，不后台反复启动新授权或业务调用。

**凭据验证边界**：Shopify 是无需账户密钥的实际服务，因此原生证明的是启停、引用/代际保留和重启连接；OAuth/API-key保留由普通Native/Worker定向测试及代码路径验证，没有替用户重填 Sorftime 密钥或重新授权 Tushare，也没有宣称这两项真实授权回归通过。旧逻辑已经清除的凭据无法从引用推断恢复，需用户通过安全配置/授权入口重新完成一次。

亮暗主题与1180×760预览使用实际组件、普通合成状态检查；菜单说明缩短为单行“开关仅控制当前对话选用”，无重叠或横向溢出。临时预览已关闭、视口恢复，Vite经Ctrl+C正常停止。原生应用保持运行并停留在已安装连接器页。

证据位于 `.local/connector-state-fix-20261021/`：

- native-enabled.json、native-disabled.json、native-chat-unselected.json：启用→停用→聊天选用对照。
- native-before-background-fix-restart.json、native-restart-foreground.json、native-verification-summary.json：最终正常打包/重启/自动连接对照。
- native-restarted-enabled.png：最终重启后的原生已安装列表；native-chat-deselected.png：当前对话取消选用、全局仍启用（说明文案精简前）。
- ui-light-1180.png、ui-dark-1180.png：最小窗口两主题组件预览，不冒充真实连接证据。
- packaged-background-recovery.log：最终canonical构建、打包和窗口尺寸；pre-schema37/：迁移前加密数据库备份。

已知门禁和未执行项仍以上文为准；无Git提交/推送、签名发布、模型请求或第三方业务工具调用。原生验收只执行用户已授权的连接初始化与工具目录发现。
