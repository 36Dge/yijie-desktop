# 当前落地审计：组件配色候选

- 状态：**Proposed / 待用户确认**，不是已发布设计规范。
- 日期：2026-09-06。
- 当前阶段：仅执行审计、候选矩阵和真实页面组件预览；确认前不执行后续正式规范覆盖或应用代码改造。
- 本轮 `contract-impact = none`：候选文件与隔离预览不改变活跃 Desktop 源码、API / Agent Host、Tauri 能力、偏好及本地持久状态。该分类只覆盖本轮候选任务，**不覆盖工作区中既有的独立 Skills 修复**。

## 1. 核心结论

当前主体背景已经是纯白。前序截图采样已确认主体区域为 `#FFFFFF`，当前源码也将 App、页面、导航、卡片和弹层的亮色结构背景设为白色。此次视觉问题不能归因为“主背景仍是灰色”，主要来自普通控件持续消费浅绿背景、深绿文字、灰色次按钮，以及输入区较重的焦点与阴影。

保留已经落地正确的纯白空间、石墨主文字、青柠主操作和新包裹 / YJ Logo。候选只细化组件中的前景、交互底色、边界及焦点表达；字体、字号、间距、圆角、页面布局和业务状态行为继续保持原状。

## 2. 证据范围与限制

| 证据 | 能确认什么 | 不能推出什么 |
|---|---|---|
| 当前 `src/` 源码与已有 diff | 真实组件的 token 消费点、样式规则与继承风险 | 不能据此宣称当前 Tauri 窗口已逐状态实测 |
| 前序截图采样结果 | 被采样截图的主体背景为 `#FFFFFF` | 不是本轮重新采样，也不代表每一个 hover / focus / disabled 状态都已经检查 |
| 既有 `docs/verification/DESIGN-2.0-visual-migration.md` 与 `.local/design-v2-review/` | 先前的 Chrome 组件环境、前后样张及其验收范围 | 不能把 Chrome 称为 Tauri / WebKit，也不把先前测试结果改写成本轮通过 |
| 本目录 `worktree-before.json` | 11 仓起始 HEAD 和 44 个预存修改文件的 SHA-256 | 不包含候选方案对正式源码的修改；它是保护现有工作的快照 |
| 本轮三页候选预览 | 相同真实组件在候选配色下的 Chat、我的店铺、插件展示 | 演示数据、内存路由或浏览器环境不代表真实店铺、模型、原生或 Host 验收 |

本轮未独立检查的运行态标为未知，后续由预览与验证记录补充，不凭源码推测“已经通过”。三页范围明确为 **Chat / 我的店铺 / 插件**；工作流不替代插件页。

## 3. 已经正确的部分

源位置以 2026-09-06 候选开始时的当前工作区为准。

| 已符合方向的部分 | 源码证据 | 本轮处理 |
|---|---|---|
| 亮色结构全白 | `src/styles/variables.css:26`–`31`：app/page/nav/card/elevated/subtle 均为 `#FFFFFF` | 保持；不恢复灰色或浅绿结构底色 |
| 主文字为石墨 | `src/styles/variables.css:19`：`text-primary=#25282B` | 保持；增加正文和元信息的精确角色分配 |
| 青柠主操作 + 石墨前景 | `src/styles/variables.css:8`、`:15`、`:23`；`src/components/chat/ChatComposer.vue:869`–`875` | 保持主色与 on-brand；普通图标不继承此青柠角色 |
| 暗色结构已为中性石墨 | `src/styles/variables.css:149`–`154`：背景 `#191C20`、卡片 `#25282B`、弹层 `#2E3237` | 保持空间层级；收窄局部深绿消费 |
| 新 Logo 已接入页面 | `src/components/yijie/YjLogo.vue:3`–`4`、`:27`–`29`、`:49`–`55` | 保持已批准 SVG、当前显示位置与中文标签；本轮不重做 Logo |
| 店铺大容器已移除绿色结构渐变 | `src/pages/store/StorePage.vue:226`、`:235` 均使用 `bg-card` | 只审视卡片阴影、标签和筛选状态，不再次重排页面 |
| 独立状态和图表语义存在 | `src/styles/variables.css:37`–`61`、`:160`–`174` | 不全局换成中性色；图表首序列需避免随 brand-text 中性化而意外改变 |

## 4. 组件偏差与候选调整

这些是视觉方向与组件消费规则的差异，不是认定旧代码存在业务错误。

| 编号 | 当前现象与具体源位置 | 对视觉的影响 | 待确认候选 |
|---|---|---|---|
| C01 | `src/styles/variables.css:11`–`16`、`:134`–`139` 保留浅绿/深绿 soft、brand-text 和绿色 focus；`src/design/theme/naive-theme.ts:21`–`28` 将它们分发给普通控件 | 主操作、普通文字和焦点共享绿色，品牌强调扩散 | brand-text 普通 UI 映射中性；focus 改 2 px 中性无 glow；图表单独保留自身颜色 |
| C02 | `src/components/yijie/YjNavItem.vue:75`–`77` 使用 brand-soft 选中底；`:70`–`72` 为 4 px 焦点描边 | 侧栏大块浅绿 / 深绿抢占注意，焦点厚重 | 导航 default/selected 保持原白 / 石墨背景，3 px 青柠内侧标记；hover/pressed 仅当前小项用中性底且保留标记；2 px 中性焦点可叠加 |
| C03 | `src/components/yijie/YjTabs.vue:107`–`121` 的 hover 和 selected 消费 brand-soft/subtle、brand-text | 普通筛选有多个绿层级，选中强弱不明确 | 小型筛选 selected 为实色青柠 + 石墨；未选中白 / 卡片底，hover 只用小控件中性底 |
| C04 | `src/components/chat/ChatComposer.vue:617` 的权限值、`:732` 的附件图标、`:828` 的拖放说明使用 brand-text；`src/pages/chat/ChatPage.vue:976` 的引导说明同样使用品牌字色 | 普通阅读信息呈深绿或亮青柠，品牌色充当正文色 | 普通说明、权限值、图标改用 primary/body/secondary 角色；成功等真实状态标记继续独立语义 |
| C05 | `src/components/chat/ChatComposer.vue:675` 默认 shadow-card；`:685`–`692` 焦点 / 拖放为 4 px focus 色环叠加卡片阴影 | 输入容器像浮层，尤其暗色显得发光、厚重 | 普通输入无阴影；focus 为 2 px 中性清晰边界；拖放说明靠文案/轮廓，不叠 glow |
| C06 | `src/styles/variables.css:129` 定义暗色 `0 0 8px 0` 焦点 glow；`src/design/theme/naive-theme.ts:24` 读取供选择器、输入等使用 | 常规输入和选择器的焦点像高强度品牌效果 | 同一 2 px 中性焦点，无模糊半径；不改变键盘可达性或焦点事件 |
| C07 | `src/components/skills/SkillCard.vue:243`–`245` 普通图标容器用品牌绿边框/soft 底；`:217`、`:224`–`227` 默认与 hover/focus 有阴影 | 普通插件卡片具有绿色底板和浮起感 | 图标容器使用结构底与中性边框；普通卡片无阴影，交互边界明确但不整卡发光 |
| C08 | `src/pages/store/StorePage.vue:263`–`264` “本地合成”来源标签用品牌字色/soft 底；`:227` 模块默认 shadow-xs | 非状态信息被品牌化，卡片层级偏厚 | 普通来源标签中性文字、白 / 卡片底、细边框；普通卡片无阴影 |
| C09 | `src/pages/plugins/SkillMarketplacePage.vue:160`、`:215`、`:237` 使用 Naive `secondary`；当前主题没有把 secondary 的底色统一映射为白色 | 次操作依赖组件库灰色衬底，与用户希望的白色控件空间不一致 | 普通次按钮白 / 卡片底 + 中性边框，局部 hover/pressed 允许小面积中性反馈 |
| C10 | `src/styles/variables.css:20` 为 `text-secondary=#60666E`；Skill 描述 `SkillCard.vue:283`、店铺说明 `StorePage.vue:218` 和权限/加载说明广泛复用它 | 正文、操作说明和元信息层级容易都显得偏淡 | 正文独立 body，说明 secondary 加深至 `#51565D`；meta 只给时间/单位等；禁用色不用于正常解释 |
| C11 | `src/pages/chat/ChatPage.vue:1055`、`:1068` 用 brand-soft 承载用户消息/附件 | 内容块成为绿色面积来源 | 候选使用中性正文和结构底 / 细边界，不扩大品牌底色；消息结构、可读内容及状态保持 |

`secondary` 是组件变体名，不等同于产品里的“次操作”视觉定义。审计仅确认源码使用该变体及其库默认继承，具体浏览器计算色由当前预览记录；不把推断包装成最新 live 采样。

## 5. 候选原则与绿色允许清单

- 品牌青柠仍为 `#C3F35B`，仅用于已批准 Logo、主操作填充、小型筛选选中、勾选/开关选中填充和导航 3 px 标记；填充上的前景为石墨。
- 普通正文、说明、链接、工具图标、焦点和容器边界使用中性角色。普通容器、导航和卡片不以浅绿或深绿铺底。
- 本轮不把旧 brand-soft 的存在等同于允许继续消费它；候选 UI 不依靠浅绿来表达普通 hover 或 selected。
- 真实成功状态的绿色保留在语义状态体系；图表首序列的深绿色 `#4B651D` / 暗色青柠 `#C3F35B` 保留在图表专用 token。它们不扩展为普通文字/图标颜色。
- 中性 hover/disabled 底只允许用在小控件的局部状态，不能回流为页面、侧栏或普通卡片结构底色。

具体角色、状态组合与对比限制见 [组件配色矩阵](./02-component-color-matrix.md)。

## 6. 既有工作区分类与保护

快照时间：`2026-09-06T11:43:31.935332+08:00`。完整 HEAD 与逐文件 SHA-256 见 [worktree-before.json](./worktree-before.json)。

| 分类 | 仓库与文件数 | 本轮边界 |
|---|---|---|
| 既有视觉迁移 | Desktop 33 个文件 | 保留原字节；只读取当前实现用于审计 / 隔离预览 |
| 独立 Skills 修复 | Desktop 5 个文件 + Agent Host 6 个文件，共 11 个 | 不改动、不合并入视觉候选、不替该修复声明 contract-impact=none |
| 其他仓库 | 其余 9 仓快照无脏文件 | 本轮不跨仓写入 |
| 本轮新增 | 当前 proposals 目录的候选与隔离预览文件 | 待确认；不覆盖正式 docs / exports / src，不 commit / push / 发布 |

Skills 修复涉及启动刷新、busy 恢复和 Host journal 迁移；既有说明记录其私有持久化降级为 breaking。该事实只用于防止误归类，本轮不重新验收、更改或概括其协议影响。

### 既有视觉迁移文件（33）

```text
docs/verification/DESIGN-2.0-visual-migration.md
src/assets/brand/yijie-bag-logo.svg
src/assets/brand/yijie-mark-dark.svg
src/assets/brand/yijie-mark.svg
src/components/chat/ChatApprovalCard.vue
src/components/chat/ChatArtifactFile.vue
src/components/chat/ChatArtifactImage.vue
src/components/chat/ChatArtifactReport.vue
src/components/chat/ChatArtifactShell.vue
src/components/chat/ChatArtifactVideo.vue
src/components/chat/ChatComposer.vue
src/components/chat/ChatCopyAction.vue
src/components/chat/ChatReasoningDisclosure.vue
src/components/chat/ChatSafeContent.vue
src/components/chat/ChatSidebarTree.vue
src/components/chat/ChatTimelineItemShell.vue
src/components/chat/ChatTurnPlan.vue
src/components/skills/SkillCard.vue
src/components/workflows/RecommendedWorkflowCard.vue
src/components/workflows/WorkflowSummaryCard.vue
src/components/yijie/YjIcon.vue
src/components/yijie/YjLogo.vue
src/components/yijie/YjNavItem.vue
src/components/yijie/YjSidebar.vue
src/components/yijie/YjTabs.vue
src/design/theme/echarts-theme.test.ts
src/design/theme/naive-theme.test.ts
src/design/theme/naive-theme.ts
src/pages/chat/ChatPage.vue
src/pages/settings/SettingsPage.vue
src/pages/store/StorePage.vue
src/pages/workflows/WorkflowPage.vue
src/styles/variables.css
```

### 独立 Skills 修复文件（11）

Desktop：

```text
docs/verification/SKILLS-startup-unavailable-20260906.md
src-tauri/src/skills/host.rs
src/pages/plugins/SkillMarketplacePage.ac009.test.ts
src/stores/skill.store.test.ts
src/stores/skill.store.ts
```

Agent Host：

```text
README.md
docs/skills-journal-v2.md
internal/skills/service.go
internal/skills/store.go
internal/skills/store_database.go
internal/skills/store_database_test.go
```

## 7. 本轮验收边界

本报告是源码审计与候选说明。实际组件预览、三页前后对照、主题/窗口/交互检查应由同目录的预览与结果记录说明具体环境、状态和结果；没有执行的状态不能写成通过。浏览器验证只称 Chrome 组件验证；Tauri / WebKit、真实店铺、模型、Host 和持久化验收不在本轮范围。

后续正式覆盖与应用改造必须以用户对本轮候选的确认结果为依据。本轮不会为了达到预期截图而改动既有 Skills 修复、隐藏真实错误或伪造运行状态。
