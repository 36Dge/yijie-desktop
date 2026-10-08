# 我的店铺方案 2：范围与验证记录

记录日期：2026-10-05（Asia/Shanghai）。

用户授权基于新的参考布局重新实现“我的店铺”视觉与交互，旧方案保留并隐藏。默认页面使用“经营总览”和“AI 运营”两个 Tab；AI 运营展示机会、证据、模拟生成步骤与可阅读结果。

`contract-impact = none`：本次只有页面展示和内存交互变化，不改变 API、Agent Host、原生 IPC 或持久化契约，不实现业务接口。固定模拟数据统一以 USD 展示；本地 CSV 为用户主动导出的演示文件。详细设计约束见 [经营分析 Pattern](design/docs/design/05-patterns/11-store-analytics.md)。

## 已完成检查

以下检查在页面开发期间执行，仅说明该次代码快照的结果；不替代最终改动后的定向测试、构建和浏览器验收。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `make lint` | 通过：`generate:check`、ESLint、`vue-tsc --noEmit`、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`。 | `.local/store-dashboard-checks/make-lint.log` |
| 已人工检查的普通展示层回归 | 7 个文件、48 个测试通过。覆盖 ECharts/Naive UI 主题与对比度、Tabs 键盘操作、指标卡、图标 registry、旧方案数据与场景卡。 | `.local/store-dashboard-checks/presentation-regression-active.log` |
| `pnpm docs:build` | 通过：16 份 SVG 品牌资产校验、参考组件 TypeScript 检查和 VitePress 构建。构建报告部分 chunk 超过 500 kB 的体积警告，未导致失败。 | `.local/store-dashboard-checks/docs-build.log` |

安全定向回归命令：

```sh
pnpm exec vitest run --maxWorkers=4 \
  --exclude '**/.contracts-source/**' \
  --exclude '**/.agent-host-source/**' \
  --exclude '**/.skills-source/**' \
  --exclude '**/.local/**' \
  src/design/theme/echarts-theme.test.ts \
  src/design/theme/naive-theme.test.ts \
  src/components/yijie/YjMetricCard.test.ts \
  src/components/yijie/YjTabs.test.ts \
  src/domain/store-showcase.test.ts \
  src/components/store/StoreSceneCard.test.ts \
  src/icons/registry.test.ts
```

首次执行定向回归时，Vitest 文件名过滤同时匹配了 `.local` 中的历史源码副本，产生 14 个失败，均来自历史副本；活跃源码未出现失败。加入项目默认排除项后，上述 7 个活跃测试文件全部通过。首次日志保留于 `.local/store-dashboard-checks/presentation-regression.log`，不计为当前源码验收失败或通过依据。

## 未执行检查及影响

用户长期安全条款禁止为测试伪装可执行程序、破坏权限、注入攻击性资源或通过强杀制造故障。检查现有测试代码后，未执行完整 `make test`；以下示例说明完整套件与该约束冲突的具体位置，而非完整风险清单。

| 未执行项目 | 原因 | 影响与安全替代 |
| --- | --- | --- |
| 完整 `cargo test`（`make test` 的一部分） | `src-tauri/src/chat/sidecar.rs` 中 `distinct_test_profile_lifecycles_record_content_free_child_crash_evidence` 创建名为 `agent-host` 的 shell 可执行文件，以 `exit 7` 制造失败并启动它；`src-tauri/src/skills/resources.rs` 中 `rejects_writable_bundle_or_app_data_authority_before_creating_managed_state` 将目录改成 `0777` 制造权限拒绝。 | 历史原生失败路径与权限回归未验证。本次不修改原生层；Rust 编译静态检查已由 `make lint` 的 fmt/Clippy 覆盖，不将其宣称为运行时测试。 |
| 完整前端 Vitest 套件（`make test` 的一部分） | `ChatArtifactShell.test.ts`、`ChatReasoningDisclosure.test.ts`、`ChatArtifactFile.test.ts`、`ChatTurnPlan.test.ts` 等测试含 `onerror` 或脚本类攻击性输入，属于用户禁止的攻击注入测试。 | 历史内容安全回归未执行。使用已逐项检查的普通展示层测试与本次看板定向交互验证替代，不宣称全量测试通过。 |
| `scripts/run-feat128-s10-local-profile.sh` 历史 smoke 脚本 | 脚本含 `kill -KILL` 强制清理回退，与本次用户安全条款不符。 | 未验证该历史 smoke 流程；它不属于本次纯视觉看板的必要运行路径。 |

## 最终验证

- `make lint` 再次全部通过，日志 `.local/store-dashboard-checks/make-lint-final.log`。
- `make build` 通过，日志 `.local/store-dashboard-checks/make-build-final.log`；现有大 chunk 体积警告仍保留，未放宽阈值。
- 4 个定向测试文件、45 项测试通过，日志 `.local/store-dashboard-checks/store-tests-final.log`。包含方案 1 回归、方案 2 键盘与筛选、商品上下文、按店铺隔离的完成记录、异常状态恢复、模拟执行与清理、12 组数据合计以及 CSV。
- Codex 内置浏览器实测亮色和暗色，窗口 `1180×760` 与 `1512×982`；页面无水平溢出，宽屏三列、最小窗口两列重排。图表真实使用 ECharts SVG，未用静态图片替代。
- 真实浏览器验证店铺/周期联动、图例开关、展开图表数据表、带单位与系列的明细弹窗、商品搜索空态与分页、错误/加载视觉状态、AI 三步模拟生成及结果。关闭抽屉后焦点恢复到原按钮；生成后完成任务数从 48 更新到 49，动态记录同步显示。
- 初始浏览器 axe 在进入动画未结束时误判对比度，验收 harness 改为等待有限动画结束再检查；发现两个未选中指标按钮的真实对比度为 4.37，已改用 secondary 文本 token。最终亮暗总览浏览器 axe 结果均为 `violations: []`。两个 Tab 的组件级 axe 无 serious/critical，组件级测试不替代原生焦点测试。
- 最终评审修复了商品建议错误引用马克杯案例、完成记录跨店铺串用、异常状态筛选无法恢复、图表明细单位缺失和效率指标比例不一致的问题。
- 本次没有启动或重打包 Tauri App，没有声称通过原生桌面运行时验收。

截图保存于 `.local/store-dashboard-checks/screenshots/`：`light-overview-1512.jpg`、`light-ai-1512.jpg`、`dark-overview-1180.jpg`、`dark-ai-1180.jpg`。

预览启动命令：

```sh
pnpm exec vite --config tests/visual/feat-150/vite.config.ts --host 127.0.0.1 --port 5198
```

预览地址：`http://127.0.0.1:5198/tests/visual/feat-150/index.html`；暗色追加 `?theme=dark`。实际产品路由仍为 `/store`。旧版文件未接入默认路由，未删除。预览日期固定为模拟样本截止日 2026-10-04，并非实时同步时间。


## 第二轮视觉修订（2026-10-05）

依据用户对图标、局部配色和 AI 运营内容密度的反馈，移除活跃店铺 UI 中全部星芒装饰，取消商品行彩色图标底块。销售来源采用青柠／石墨／灰色，补充渠道转化条形图；商品表新增销售额与环比的气泡分布，点击可打开对应商品详情，键盘用户可通过数据表操作。

AI 运营已拆为独立组件：4 个指标微图、优化效果对比、投入与潜在提升的机会图、评价主题情绪图、能力覆盖雷达、工作动态和机会清单。场景工作台加入广告搜索词、Listing 转化、评价归因、流量归因、竞品追踪、健康诊断六个固定样例，每个场景有自己的证据、步骤与可阅读结果。保留方案 1 文件但未恢复其默认页面。

本轮检查：

- 6 个安全定向测试文件、64 项测试通过，日志 `.local/store-dashboard-checks/revision2-tests.log`；涵盖图表单位/缩放/合计、场景筛选与独立生成结果、图例切换、店铺上下文与正常卸载清理。
- `make lint` 通过，日志 `.local/store-dashboard-checks/revision2/make-lint.log`；`make build` 通过，日志 `.local/store-dashboard-checks/revision2/make-build.log`。构建仍保留现有 chunk 体积警告。
- 浏览器检查 `1512×982` 亮色和 `1180×760` 暗色，页面无横向溢出。核对了新下部图表、AI 首屏与中部图表、六场景布局、图例切换和竞品场景筛选/生成。
- 实测修正微图 SVG 渐变发灰、机会图窄宽标签碰撞、评价图非整数刻度及包装反馈口径。评价样本总数 186，包装主题 23（其中待改善 13），与场景说明一致。
- 预览 harness 支持 `?audit=1` 显示“检查当前视图”按钮，以便在切换到 AI Tab 后按实际 DOM 运行 axe；此按钮不进入产品页面，也不出现在普通预览中。亮色和暗色 AI 视图浏览器 axe 均无违规。
- 本轮同样没有运行含禁止行为的历史全套测试、没有实现接口、没有改动原生能力或重新打包 App。安全跳过原因与影响沿用上节记录。

最终复核还统一了 AI 效果图基线与 +23.6% 指标（浏览器核对最近 7 天为 10,001 / 8,091，即 23.6%）；评价归因入口明确标为固定样例，避免与当前店铺/周期的样本量混淆。移除了旧 AI 专属样式，保留经营总览的洞察样式。第二轮截图位于 `.local/store-dashboard-checks/revision2/screenshots/`。

## 应用到原生「我的店铺」（2026-10-05）

实际导航 `src/navigation/app-nav.ts` 的「我的店铺」指向 `/store`，`src/router/index.ts` 加载 `src/pages/store/StorePage.vue`。默认入口为修订后的方案 2；旧方案仍只保留源码，没有导航或路由入口。

使用仓库标准命令 `pnpm tauri:demo-fast:app` 构建并启动本地开发 App。首次原生验收发现 ECharts 6.1.0 的 `Scheduler.mockMethods` 使用普通赋值创建 `constructor` 属性，与 Tauri 已有的 `Object.freeze(Object.prototype)` 保护冲突，导致模块加载失败和 `/store` 导航中止。通过 pnpm 的受版本控制补丁，将该处改为显式创建自身属性，保留原来的可写、可配置、可枚举语义。补丁在开发与打包时统一应用，不更改 CSP、capability、原型冻结或任何原生权限。

- 补丁：`patches/echarts@6.1.0.patch`；精确版本与摘要由 `pnpm-workspace.yaml` / `pnpm-lock.yaml` 固定，没有新增依赖或更新依赖版本。
- `contract-impact = none`：仅修复原生 WebView 中已有前端图表的加载兼容性；API、Agent Host、本地持久状态、IPC 和安全配置均无变化。
- 本地开发构建来源、旧产物校验值与日志保留在 `.local/store-dashboard-checks/native-apply/`。需要重新构建时通过 App 正常退出，确认端口自然释放；未强杀进程。
- 本次仍未执行上文列出的禁止测试；无真实店铺接口、发布签名或公证验收。

本轮验收结果：

- 原生 App 中点击侧栏「我的店铺」成功进入 `tauri://localhost/store`；在 `1268×780` 窗口实测经营总览和 AI 运营，折线、柱状、散点、评价情绪、雷达与微图正常呈现。
- 实测 AI 能力覆盖图例开关、归因分析抽屉、三步模拟生成与完整结果；完成后运营任务数从 48 变为 49，并同步出现工作动态。最后回到经营总览，应用保持打开。
- 10 个定向测试文件共 92 项通过，另店铺侧栏入口 1 项通过（总计 93 项）。新增兼容测试在独立正常进程中按 Tauri 初始化规则冻结原型，真实加载依赖并进行五类 SVG 渲染，随后正常释放和退出。日志：`.local/store-dashboard-checks/native-compat-regression.log`、`native-store-sidebar.log`。
- `make lint`、标准原生构建内的 `pnpm build`、`pnpm docs:build` 均通过；保留现有 chunk 体积警告。初始拓展侧栏检查另有既存任务树折叠断言失败，与 `/store` 导航无关，未改动该逻辑，不将其计为通过。
- 原生截图：`.local/store-dashboard-checks/native-apply/store-overview.jpg`、`store-ai.jpg`；构建前后产物来源与 SHA-256 分别记录于同目录的 `provenance-before.json`、`provenance-after.json`。

本轮原生检查为亮色实际运行验证；暗色和 `1180×760` 的视觉验证沿用第二轮浏览器记录，不将其重复表述为原生验收。

## 场景筛选截断与空白修复（2026-10-05）

用户截图中的侧栏上移、内容截断与底部空白已复现。图表的绝对定位读屏说明没有局部定位边界，在 WebKit 中扩展了外层文档的可滚动范围；在 `1280×720` 预览中，文档高度达到 2976px，点击场景筛选会同时滚动外层文档。为两类图表设置局部定位上下文，并把隐藏说明明确定位在图表内部；店铺页面也建立局部定位边界，保留读屏说明。修复后所有六种筛选及返回全部场景均为文档高度 720px、外层滚动位置 0，侧栏顶部始终为 32px。

另修复筛选为单场景时仍占三列网格第一列的问题：单项采用全宽双栏布局，左侧显示说明与指标，右侧展示趋势，下方保留分析入口；窄容器恢复纵向排列。全部场景仍按原网格展示。`contract-impact = none`，未修改 API、Agent Host、原生权限或持久状态。

- 7 个安全定向测试文件、65 项通过；`make lint` 和 `pnpm tauri:demo-fast:app` 构建通过。全套禁止测试仍按前文跳过，不宣称全量回归通过。
- 浏览器完成全部筛选往返及 `1180×760` 暗色检查，无横向溢出、外层滚动或分析按钮截断。测量记录：`.local/store-dashboard-checks/scroll-fix-browser-checks.json`。
- 重建后的原生 App 实测健康诊断筛选并继续向下滚动至边界，侧栏和窗口标题栏保持原位，完整卡片、分析入口及页脚可见；截图 `.local/store-dashboard-checks/scroll-fix-native.jpg`。
- 本轮使用 App 正常退出后重建，未强杀或修改任何安全配置。

## 五处视觉精修（2026-10-05）

按用户逐图反馈移除场景工作台的 `OPERATING PLAYBOOKS` 英文眉题，以及 Tab 下重复的店铺、日期、币种、更新时间信息条。店铺和周期筛选、图表单位、演示标识及经营简报仍正常工作；刷新完成反馈由既有 Toast 承载。

增长机会由通栏列表调整为三张结果卡片，展示预估收益和已有模拟证据的占比条：低效广告预算 18%、待补充搜索词 9/26、包装反馈 23/186。保留待处理／已完成筛选、空态、分析抽屉和完成结果；单条结果采用双栏，窄容器采用单列。

小窗口下漏斗独立占一行，以标题和图表横向组合，不再被相邻销售来源模块拉高；销售来源改为环图与转化效率并排，下方承接运营建议。商品表在销售额下加入相对微条，并在 AI 建议表头和当前页码点缀青柠，保持石墨正文及原有红绿趋势语义。

`contract-impact = none`：纯前端视觉与现有模拟交互，不改变 API、Agent Host、原生安全配置或持久状态。7 个安全定向测试文件、65 项通过；亮色和暗色 AI 视图、暗色经营总览的浏览器 axe 均无违规。`1180×760` 与 `1512×982` 无外层滚动或横向溢出；最小窗口漏斗实际高度 308px。记录保留在 `.local/store-dashboard-checks/polish-*`。全套安全跳过项仍沿用前文。

`make lint`、`pnpm docs:build`、标准 `pnpm tauri:demo-fast:app` 构建通过。原生实测确认五处调整生效，机会卡片筛选和打开分析正常；图表与商品表完整呈现。原生截图为 `polish-native-opportunities.jpg`、`polish-native-funnel.jpg`、`polish-native-products.jpg`，构建来源和校验值保存于 `polish-provenance.json`。

2026-10-05 后续按用户要求移除页头“经营简报”旁的“演示数据”标记，保留页脚和分析内容原有的数据说明；这一局部移除 `contract-impact = none`。同期工作流引导的每次启动规则和 `semantic` 分类另见 `16-feat-151-workflow-showcase.md`。

2026-10-05 后续按用户最新要求隐藏页脚“演示设置”入口，保留其模板、样式和页面状态切换逻辑。使用原生 `hidden` 属性，使入口不占布局空间且不进入键盘和辅助技术导航。`contract-impact = none`：仅改变 Desktop 进程内的展示，不改变 Desktop 跨进程契约、API、Agent Host 或本地持久状态。全套安全跳过项及影响沿用前文。

本次 `make lint`、2 个安全定向测试文件（28 项）和标准 `pnpm tauri:demo-fast:app` 构建通过。浏览器 `1180×760` 亮暗主题核对入口 `display: none`、无布局尺寸，原有 5 个状态选项仍保留；更新后的原生客户端页脚同样不显示入口。检查日志为 `.local/store-dashboard-checks/hide-demo-*.log`，原生截图为 `hide-demo-native.jpg`。应用经正常退出后重建，未强杀进程。

2026-10-05 按用户框选范围移除建议抽屉中的“AI 建议 · 模拟演示”标记和“AI 工作动态”右上角的“演示”标记，同时清理不再使用的 `sd-demo-badge` 样式选择器。`contract-impact = none`：仅精简 Desktop 进程内的展示，不改变 Desktop 跨进程契约、API、Agent Host、本地持久状态或模拟交互行为。全套安全跳过项及影响沿用前文。

本轮 `make lint`、2 个安全定向测试文件（25 项）和标准原生构建通过；实测暗色 `1180×760` 及亮色原生窗口中的工作动态和口碑洞察抽屉，两处标记均已消失，查看洞察和关闭交互正常。日志与截图保存在 `.local/store-dashboard-checks/ai-badges-*`；客户端通过正常退出后重建更新。

## 单场景切换滚动回退修复（2026-10-05）

原生客户端复现“降 ACOS”切到“提转化”后，场景工作台从窗口约 293px 下移至 556px。原先按场景 ID 更换整张卡片和图表，旧节点移除后新图表同步测量布局，WebKit 在短暂缩短的内容高度上限制了滚动位置。第一张卡片改用稳定展示位 key，在全部／单项和单项之间切换时始终复用卡片与图表，更新当前场景数据；其余卡片仍按场景 ID 区分。`contract-impact = none`：纯 Desktop 进程内渲染修复，Desktop 跨进程契约、API、Agent Host 与本地持久状态不变。全套安全跳过项及影响沿用前文。

切换期间暂时保留场景网格的当前高度，待 Vue 完成内容更新后释放，并恢复最近滚动容器的原始 `scrollTop`；内容确实缩短时仍由浏览器限制到正常滚动范围。这样同时覆盖 WebKit 图表测量中的临时高度变化，不锁死卡片高度，也不影响后续手动滚动。定向回归覆盖展示位复用、六场景内容与分析入口更新、焦点保留以及滚动偏移恢复。

最终 `make lint`、3 个安全定向测试文件（32 项）与标准原生构建通过。最小窗口暗色浏览器中六场景及全部往返，工作台顶部均保持 283px、滚动位置 1988.5px，临时高度约束更新后已清空；另核对亮色布局和键盘切换。原生亮色窗口直接鼠标点击“降 ACOS”→“提转化”，对照 `scene-verified-before.jpg` / `scene-verified-after.jpg`，工作台顶部均为截图约 587px（CSS 约 293px），筛选栏与页脚位置不变。证据位于 `.local/store-dashboard-checks/scene-jump-*` 和 `scene-verified-*`。首次 lint 发现测试使用超出项目 ES 目标的 `Array.at`，已改为兼容写法并通过最终检查。未执行的安全受限全套测试仍按前文记录。

## 经营简报头部精简（2026-10-07）

按用户框选范围移除英文品牌／日期眉题和店铺范围行末的“演示分析”，清理不再使用的固定日期计算。头部改为“结论标题 → 店铺与时间范围”，使用独立的简报头部间距，缩短顶部留白；下方继续双列呈现销售额与预估利润，再衔接关注事项和底部操作。`contract-impact = none`：仅调整 Desktop 进程内展示，不改变 Desktop 跨进程契约、API、Agent Host、本地持久状态及模拟交互行为。安全受限全套测试继续按前文跳过。

本轮 `make lint`、`make build` 和 StorePage 的 14 项安全定向测试通过。浏览器 `1180×760` 亮暗主题均无抽屉横向溢出，店铺／周期联动、关闭及“前往 AI 运营”正常；头部两处原文均不再呈现。亮色截图为 `.local/store-dashboard-checks/report-header-light.jpg`，日志为 `report-header-*.log`。当前原生 UI 工具未能连接已运行的开发客户端，本轮未声称原生视觉验收或重新打包完成；未停止该客户端或其服务。
