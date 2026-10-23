# 专家详情与开发者信息（2026-10-21）

## 需求与实现

用户要求解释卡片的资源状态、移除详情中的资源移除按钮和提示信息，并按所给图3/4重做详情，开发者默认“易界 AI”。已使用易界现有token、Naive UI和YjIcon实现共享详情，保留真实错误、键盘关闭与焦点恢复。头像64px；标题与召唤置顶；简介/标签、三列元信息、可点击问题、ID/知识范围分组。无使用量接口时显示暂无统计，无伪造认证/链接。

- available：Host报告not_installed，显示待准备与准备资源。
- ready：已安装、版本匹配、enabled，且不作为普通全局Skill暴露，显示资源已准备。
- preparing：已有准备操作处理中。unavailable/incompatible继续分别显示暂不可用/版本不兼容。
- ready仍需executionAvailable；available召唤还需canManage。pending/unknown/busy继续禁止重复操作。
- 问题只填入草稿，真实发送流程不变。详情移除的仅是用户入口，历史资源移除协议及保护保留。

## 接口与来源

`contract-impact = additive`。先改Contracts源 `compatibility/experts/wire.schema.json` 与 `native-ipc.json`，通过原有generator与sync同步。新增 `experts_developer_read_v1`，payload为既有ExpertSelection，响应为精确expert和name。Native仅在当前context与plugin.read下查询可信目录；无Host启动、网络、数据库或资源写入。当前返回易界AI。UI匹配响应身份并隔离过期请求；旧Native/读取失败回退用户指定默认，不影响执行授权。

现有100个定义与Contracts起始HEAD逐项一致；Host传输、资源metadata、模型/会话持久化均不改。原schema为closed object，因此没有直接在旧CatalogEntry增加会破坏旧reader的字段。新Native先可用，再由新版UI消费；旧UI仍用原目录，新UI面对旧Native可回退。回滚应用代码与同批来源记录，无数据迁移。

起始来源：Contracts `498c4e79c1889e0500caaf69960553e03876dc0b`；Desktop `221eedd65141e9d7343d34851476c5288b8a75c5`；Host `69da2631178bccac783fe6196fc8cd5e41725d96`；Skills `4247a4f2967ecf60fcf92ed0e86b9dd62496ea6e`。四仓起始干净。本次本地候选未提交、未发布，不冒充immutable release pin或额外人工评审。

标准打包要求三个消费者同源，因此Host同步完整schema/candidate并更新已核验资源清单的固定摘要，Skills仅同步candidate；Go协议/业务逻辑、Skill正文未修改。通过canonical打包重新生成来源证明：75条资源metadata与75个归档逐字节一致，只更新来源revision/candidate和manifest/authority摘要。Desktop资源pin与两个Host构建candidate由真实生成物/既有freeze命令同步，未关闭来源校验。

## 已执行验证

- 15个定向前端文件145项通过：问题预填且不发送、10位原生目录专家召唤、权限/不可用、元信息默认与旧接口、异步过期响应、详情关闭与焦点归还。
- `pnpm lint`、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`make build`通过。
- Contracts `make experts-test`通过（13个Node用例、Go测试/vet、3个Rust用例及clippy）；独立generate/check和Desktop同步校验通过。
- 四个登记基线的JSON Schema breaking检查通过：35e0949c95d7a59ca5480715c225766dcc822056、f16a497e1377f45747f8ff9292b4b60cf2027f88、6f632f155eacdaf93df0e0b00b5dab9e369c5442、811f38d6b104fa18477107e7ac91a85e19c445d1。
- Native定向 `skills::experts::tests::feat158_actual_candidate_projects_separate_safe_catalog_and_exact_reference` 实跑1项通过，读取真实75条目录、投影21位当前专家并验证开发者默认。第一次短名称配合exact过滤命中0项，已改全名重跑，不将0项当通过。
- 内置浏览器1180×760亮暗主题实看：760×712弹窗，四周安全间距，正文独立滚动，无横向溢出；关闭和Esc均恢复卡片焦点。600×760长标题、问题换行及“去试试”提示正常。
- 视觉检查发现Naive实际内容class为n-card-content，已修正滚动选择器后重新实看；亮暗截图位于 `.local/expert-detail-20261021/`。

## 限制与未执行项

- `make lint`最前面的旧公共API生成检查拒绝dirty Contracts checkout，故完整总门禁未通过；分别运行代码静态检查与本次专家family源校验，不跳过/修改校验脚本。
- 未运行全仓make test及历史攻击/权限故障/进程强杀测试，遵守用户长期安全条款；只运行普通JSON、组件交互和正常目录投影验证。因此不声明全仓测试通过或专家模型业务重新验收。
- 无模型请求、第三方业务操作、删除资源、Git提交/推送或发布。
- 初次标准入口被本批契约来源记录变化拦截，经canonical同步/freeze修正后构建成功。首次原生启动仍被Host旧ReviewedExpertCatalogDigest拒绝；核对75份资源metadata/归档字节不变后更新固定摘要，再次通过正常退出和canonical重建。没有关闭完整性校验、替换Runtime或强杀进程。
- 原生标准构建与界面验收结果在下文补记。

## 最终原生验收

- Host两项正常启动配置测试（`TestFEAT158ExpertLaunch*`）在实际资源目录下通过；`go vet ./internal/skills`通过。独立元数据接口没有扩大原有权限。
- 更新Host固定摘要后再次用 `./scripts/run-local-demo-fast.sh --packaged` 标准入口构建、打包、记录来源并启动成功，原应用身份和数据根不变；无签名/发布。当前Native窗口1268×780、100%缩放。
- 真实目录显示21位专家，历史会话列表正常读取；淘宝天猫/拼多多仍待准备，其余已准备状态保留，没有借UI验收安装或删除资源。
- 原生数据分析专家详情的头像、顶部主按钮、开发者、版本、暂无统计、示例问题、ID和知识范围正确，指定移除按钮及常驻提示均不存在；截图 `native-detail.png`。
- 点击第一条问题，跳转 `/chat?focus=composer`，精确填入问题并选中数据分析专家；发送按钮可用但未点击，未发生模型/工具任务。截图 `native-draft.png`。随后正常清空这条验收草稿并移除临时草稿选择，恢复初始空草稿，再打开详情留给用户查看。
- 收尾定向回归36项通过、1项需显式环境的source-check测试跳过；该真实source-check本身已由canonical freeze/build实际执行并通过，未把skip计作PASS。最终四仓diff whitespace检查通过。
- 结构化自查：新增wire独立于closed旧response；developer异步结果带原身份匹配和生命周期失效；资源状态/安装/会话/权限语义未改；旧接口默认回退；静态展示专家不获得执行能力；UI实际修复内容容器滚动；常驻信息移除后仍保留真实错误。未发现未解决的本次功能阻断项。

本次源码、契约和本地构建完成；全仓总门禁与生产发布仍受上文限制。临时浏览器预览已关闭，Vite通过正常SIGTERM退出；保留最终日常客户端，无强杀、攻击注入、权限破坏或可执行文件伪装。

## 同日跟进：精简卡片资源展示

根据用户进一步要求，专家卡片移除available/ready的“待准备／资源已准备”文字及状态点、相应悬停title和独立“准备资源”按钮，保留平台摘要与既有“召唤专家”入口。preparing/unavailable/incompatible及真实操作错误继续可见。召唤的自动准备、权限、忙碌与未确认操作守卫保持原样。

本次跟进 `contract-impact = none`：仅Desktop进程内展示，无API/Agent Host/Native协议或持久化可观察变化；前序四仓候选改动保留。没有为纯展示删减新增镜像测试，只调整既有资源就绪显示断言。

`pnpm lint`、7个相关测试文件76项、`pnpm docs:build`通过；通过正常退出及标准 `run-local-demo-fast.sh --packaged` 重建并启动。原生21张卡片的AX状态确认三项文案/按钮均不存在且召唤入口保留，实际截图核对悬停入口和三列排版正常，见 `.local/expert-detail-20261021/native-cards-clean.png`。本次未触发资源准备或模型任务。前述全仓门禁/安全测试未执行项的限制仍适用。

## 同日跟进：缩小弹窗并优化视觉密度

`contract-impact = none`：仅修改Desktop详情组件与样式token；API/Host/Native接口、召唤与问题预填流程、本地持久状态均无可观察变化。前序接口和资源候选保留，不重新生成契约或资源包。

直接通过系统UI读取WorkBuddy当前专家弹窗并保存真实截图 `workbuddy-reference.png`。WorkBuddy未暴露内部布局DOM，因此按2544×1558截图中的白色弹层边界估算：弹层宽约1280物理像素，即约640逻辑像素、占窗口约50%；高度约715逻辑像素。易界旧样式宽760px，用户原截图窗口1268px，约60%。本次引入独立 `--yj-layout-expert-detail-width: 640px`，不再复用聊天输入区宽度。

- 内边距32→24px，标题24/32→18/26px；头像64px，主按钮32px，开发者署名14/22px，正文保持14/22px。
- 简介/标签成组，间距12px；主区块间距20px。元信息三列等宽，版本与次级统计形成层级。
- 问题行最小48px高，12/16px内边距、12px圆角、8px行间距，右侧图标18px；“更多”中的知识范围采用12/18px次级文字。
- 高度依内容自适应，上下至少32px，固定头部和正文内部滚动；未隐藏或截断专家简介、示例和知识范围。
- 本地UI预览1268×780：京东专家弹窗640×658px，上下61px，正文无滚动/横向溢出；1180×760长名称专家640×696px，正文可滚动且无横向溢出；暗色数据分析专家640×654px。600×760窄视口宽568px，无横向溢出，Esc关闭后焦点返回原卡片。截图保存在 `.local/expert-detail-20261021/compact-*.png`。
- `pnpm lint`、8个相关测试文件85项、`pnpm docs:build`通过。纯视觉调整未新增镜像测试。此前全仓总门禁、全仓/攻击测试未执行的限制仍适用，不声明这些检查通过。

标准 `run-local-demo-fast.sh --packaged` 通过资源/来源校验、前端构建、Rust编译及本地app打包，并重新启动成功（1268×780逻辑像素、scale factor 2、100%缩放）。通过正常Cmd+Q退出旧版本，未强杀。实际21位目录正常；打开与用户原截图相同的京东专家，真实截图白色弹层为1280×1316物理像素，即640×658逻辑像素，宽占50.5%，上下各61px。标题、开发者默认、版本、统计占位、三条问题和完整ID/知识范围可见，无裁切；截图 `native-compact-detail.png`。保留客户端停在该弹窗供用户复核。未召唤、准备资源或发送模型任务。临时Vite通过正常SIGTERM停止。


## 再次微调：更窄更高、无描边按钮与箭头

用户要求弹窗再收窄、略加高，移除召唤按钮石墨描边并更换问题操作图标。`contract-impact = none`：仅Desktop视觉，跨进程接口、Host/Native行为、资源/权限/召唤流程及本地持久状态均无可观察变化。

宽度640→600px，新增700px最小高度token；最小/最大高度同时受视口减64px约束，短窗口不会越界。召唤按钮仅在该详情实例设置Naive UI的bordered=false，不影响全局按钮；问题图标使用既有arrowUpRight，与卡片召唤入口保持一致，无新增图标资产。

预览1268×780实测京东详情600×702px（上一版640×658px），正文client/scroll height均592，无横向溢出，按钮border/state-border节点均为0，三个问题均显示新箭头。暗色1180×760长名称专家600×696px，正文独立滚动；键盘Shift+Tab到召唤仍有2px可见焦点，Esc关闭返回原卡片。此前全量门禁与安全测试未执行项的限制继续适用。

本轮 `pnpm lint`、8文件85项定向测试、`pnpm docs:build` 和 `git diff --check` 通过。标准 `run-local-demo-fast.sh --packaged` 完成并正常启动；原生1268×780窗口实看同一京东专家详情：600×702px、青柠主按钮无描边、三条右上箭头和完整信息正常。已保存 `native-refined-detail.png` 并保留客户端弹窗。全过程仅正常退出/构建/启动，预览Vite正常SIGTERM退出，未运行模型任务或故障注入测试。


## 图标重新生成与问题行统一

用户指定替换小说故事创作、数据分析、跨境带货口播、股票研究、量化策略回测、MOSS行业研究和跨境电商运营7个图标。已阅读imagegen技能，通过内置image_gen分别使用旧图作风格参考生成7张新图；原始1254×1254 PNG未经后处理直接复制到原资产路径，未新增依赖。逐张检查人物五官、可见手部、物体结构、构图和文字；24/48/64px尺寸检查全部正常，无水印、杂字或白边。原图备份在 `.local/expert-detail-20261021/previous-icons/`，生成提示词、源路径、前后SHA256和尺寸写入 `src/assets/expert-showcase/generated-icons-20261021.provenance.json`。只替换7个指定资产，其他头像不变。

`contract-impact = none`：资产和简短展示文案仅在Desktop内使用，不改变API/Host/Native协议、资源安装、专家版本、完整问题及草稿/发送/持久状态。新增 `expert-prompt-labels.ts` 按完整原问题匹配本地摘要；不使用expertId+下标，以免目录新版问题错误复用旧摘要。未匹配时压平展示空白并单行省略；原问题保留在aria-label及prompt事件。新增两项普通组件回归验证摘要展示仍发送完整问题，以及新版/未知问题不会套用旧摘要。

UI预览1180×760遍历21位专家63条问题：全部48px高、white-space nowrap，63条均无截断；检查结果存 `single-line-checks.json`。暗色同尺寸跨境运营详情三行48px、新头像1254px源加载正常。所有7图在24/48/64/128px共28个img加载正常，尺寸检查截图 `icon-review.png`；暗色弹窗见 `icons-prompts-dark.png`。

`pnpm lint`、9文件87项相关测试通过；遵守用户正常非破坏性测试要求。此前全仓门禁与未执行安全测试的限制继续适用。

本轮文档构建、diff whitespace检查及标准 `run-local-demo-fast.sh --packaged` 构建/打包/启动通过。原应用正常Cmd+Q退出后重启（1268×780、100%缩放）；实际目录中小说、数据、口播、股票、量化、MOSS六个新图同屏可见，截图 `native-new-icons.png`。打开跨境运营详情验证第七个新图及三条单行等高文案，截图 `native-single-line-detail.png`。应用保留该详情；未启动模型任务、安装/删除专家资源或发送业务请求。临时预览已关闭并正常停止Vite。


## 问题行箭头弱化

按用户截图将问题行arrowUpRight从18px缩至16px，线宽2→1.5px，前景改用既有YjIcon muted色（亮暗主题分别取对应token）；禁用时跟随禁用文字色。仅作用于详情问题行，48px整行点击区域、单行等高文案、键盘焦点和其他图标均不变。`contract-impact = none`：只调整Desktop视觉，跨进程/召唤/草稿/持久状态无可观察变化。未为样式新增镜像测试。

1180×760亮暗预览实测箭头16px、stroke-width 1.5；亮色rgb(111,117,125)、暗色rgb(150,158,168)，三行外框仍均48px。`pnpm lint`、3文件36项相关测试、文档构建和diff检查通过。通过正常退出与标准入口重建并重启；实际1268×780窗口的小说专家详情已核对，箭头更小、更浅且完整可辨，截图 `native-muted-arrows.png`。客户端保留详情，临时Vite正常停止；前述全仓总门禁限制仍适用。
