# 对话产物文档卡片验证（2026-11-10）

`contract-impact = none`：只调整 Desktop 文档产物的展示与既有操作入口。文件／报告保存、右侧预览继续使用原接口；API/Agent Host、Native IPC、授权、文件系统范围、持久化与重放语义不变。

## 实现与参考

- 实际查看 WorkBuddy 的“介绍杭州西湖并生成Markdown文档”任务及卡片打开右栏的行为，查看后恢复原侧栏状态。
- 已就绪的文件／报告卡片包含格式图标、文件名、真实大小、浅灰或暗色底纹，视觉收起重复的“生成内容／已完成”行，保留其无障碍名称。
- 卡片主体点击或键盘激活交给现有 `openFile`；右侧“另存为”是独立按钮，hover／focus-within 时显示，触屏常显。按钮 tooltip 为“另存为”。
- 文件与报告分别复用 `ChatArtifactFile.saveFile`、`ChatArtifactReport.saveReport`，保留单次进行、取消、错误、重试和身份切换保护。没有新增原生 command 或在前端接收文件字节／保存路径。
- 本文档与产物卡片变更保留开始前的工作区修改和上一轮文案／青柠链接改动，未提交或发布。

## 检查结果

- 受影响的 7 个 Vue／测试文件定向 ESLint：通过。
- `pnpm exec vue-tsc --noEmit`：通过。首次发现新测试 mock 的 `status` 字面量被拓宽，仅补充 `as const` 后通过。
- 筛选运行 `ChatArtifactList.test.ts`、`ChatArtifactFile.test.ts`、`ChatArtifactReport.test.ts`、`ChatTimelineItemShell.test.ts`：32 PASS、1 SKIPPED。新卡片覆盖 Markdown、DOCX、PPTX、XLSX、PDF 的预览／保存分流、原身份透传、取消、重复点击、失败后显式重试、过期撤下和报告保存入口。
- 真实 Vue 组件及时间线外壳的浏览器核对：1180×760 亮暗主题、760px 与 400px 对话宽度。卡片高 68px，正常大小底纹为亮色 `#F2F2F2`／暗色 `#25282B`，无水平溢出；窄栏长文件名省略而扩展名保持。键盘 Tab 显示保存按钮及“另存为”tooltip，Enter 单独触发保存并呈现取消反馈；卡片主体只触发预览。
- 浏览器组件预览使用合成 metadata 和返回取消的保存适配器，不写入文件；此证据不代表原生预览或系统保存对话框实测。预览入口保留在 `.local/artifact-document-cards-20261110/index.html`，检查后已关闭临时浏览器标签并恢复窗口尺寸。
- `git diff --check`：通过。

## 未执行项目与影响

- 按 `scripts/test-safety-exclusions.json` 跳过 `ChatArtifactFile` 中 `opens only after explicit intent, deduplicates loading, and renders inert plain text`：该历史用例包含 script／formula 注入 fixture，违反用户长期安全条款。没有执行攻击注入，也不将该项计为通过；正常预览与保存路由由非攻击性用例及浏览器组件交互覆盖。
- 未执行原生客户端和系统另存为窗口实测：自动化应用清单未识别当前 `yijie-desktop` 开发进程，按名称连接返回 `Invalid app`。未另起其他已安装候选、重启或强杀现有客户端。系统窗口沿用原 `chat_save_artifact_file_v1`／报告保存能力，源码调用链已核对，实际系统窗口外观和文件落盘未在本轮验证。
- 纯 UI 范围未运行原生测试、全量前端回归、后端或跨仓验证；没有真实模型请求或新增生成任务。

## 后续：图标、标题与高度对齐 WorkBuddy

用户继续要求各文档图标、标题字号／字重、底纹高度与 WorkBuddy 一致，并澄清“紫色”为笔误。本次仍为 `contract-impact = none`。

只读核对已安装 WorkBuddy 的 `artifact-slot-panel-Bm527-il.css` 及主题 token：卡片 64px、圆角 16px、内边距 8px 12px、图标 28px、间距 8px；标题 15px／25px、600；大小 13px／21px；标题亮色黑／暗色白。该数值取代上一轮卡片 68px 的实现。标题／大小增加局部 token，不调整全局正文字号。

新增本仓绘制的实心折角文档 SVG，通过 registry／`YjIcon` 使用；Markdown、Word、演示、表格、PDF、文本、代码及未知格式均采用同一轮廓。未复制或改写 WorkBuddy 二进制／资源，既有预览和保存流程保持。

- 定向 ESLint、`vue-tsc --noEmit` 和 diff 检查通过。
- registry、文件展示与产物列表共 14 项现有测试通过。首次 registry 清单断言发现遗漏已在 HEAD 中存在的 `contextUpdate`，补齐预期清单后该文件 2 项复验通过；未删除或改动该图标实现。
- 浏览器真实组件在 1180×760 下核对亮色 760px 宽、暗色 400px 宽：五种文档卡片均为 64px 高，图标均为 28×28px，标题均为 15px／25px／600，窄栏无水平溢出且保留扩展名。临时标签已关闭、尺寸已恢复。
- 本轮不新增原生测试或系统保存窗口验收；前述实机工具识别限制仍适用，浏览器核对不计为原生实测。

## 后续：隐藏常规保存状态文字

用户要求前端不展示截图中的“已取消保存”和“正在打开原生保存窗口…”等信息。文件与报告卡片现在仅渲染保存失败提示，打开窗口、取消及成功的文字均不渲染、不占位；按钮防重复操作与原生保存行为保持。`contract-impact = none`，仅调整展示条件。

受影响三文件 ESLint、8 项产物列表测试和 diff 检查通过；既有测试覆盖等待、取消、成功时无反馈行，以及失败提示和重试仍可用。1180×760 浏览器亮暗主题取消保存后反馈行均为 0，卡片保持 64px 高与 12px 间距，无额外留白。未运行原生或全量回归。

## 最终：卡片下不显示任何保存状态

用户进一步明确失败提示也不展示，此决定取代上一节保留失败文字的规则。文件与报告的卡片模式均不渲染保存反馈区域，涵盖等待、取消、成功与失败；保存结束后按钮恢复可用。仅改变展示条件，`contract-impact = none`。

受影响三文件 ESLint、8 项产物列表测试和 diff 检查通过。1180×760 浏览器组件使用普通失败结果适配器核对亮暗主题：保存反馈行均为 0、保存按钮恢复可用，卡片保持 64px；未写入文件、未执行攻击性 fixture 或原生／全量测试。

## 用户消息中的文档附件图标

按用户追加要求，共享 `ChatAttachmentChip` 的文档附件复用产物卡片的 `chatDocumentIcon` 格式映射，采用彩色实心折角图标；保留原 16px 尺寸、胶囊布局、文件名、预览及移除行为。输入草稿和已发送消息统一，图片／视频继续使用媒体图标。`contract-impact = none`。

组件 ESLint、7 项现有附件组件测试及 diff 检查通过。1180×760 浏览器真实用户消息外壳中核对 DOCX、PDF、PPTX、XLSX：亮暗主题均显示对应实心图标，16px 尺寸与原换行布局保持，无水平溢出，点击仍派发绑定的预览回调。未修改原生或持久化逻辑，未运行原生／全量回归。
