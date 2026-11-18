# 回答图标与 WorkBuddy 正文字体对齐

## 范围

`contract-impact = none`：仅修改 Desktop 对话内容的 CSS token 和回答工具栏 SVG 轮廓。Desktop 跨进程接口、API / Agent Host、本地持久状态、复制原文和评价语义均无变化。无新增依赖、字体文件、原生能力或网络目标。

## 对照来源

本机 `/Applications/WorkBuddy.app` 版本 5.11.3。界面工具未提供原生窗口，因此未声称读取实时窗口样式或用户字号/缩放偏好；采用安装包当前对话渲染器的默认字号档。只读检查 ASAR 资源，不执行、替换或修改 WorkBuddy 程序。

- `renderer/assets/app-core-nlCbXiui.js`：`getSavedFontSizeLevel` 默认返回 2，对应根字号 17.143px。
- `renderer/assets/common-BQtKn-MN.js`：当前对话容器将 `--cb-md-root` 传给 `--cr-md-root`。
- `renderer/assets/src-DIwCVExo.css`：当前 `cr-theme` 的字体为 `"PingFang SC", -apple-system, "Helvetica Neue", Arial, "Microsoft Yahei", sans-serif`，亮暗主题一致。
- `renderer/assets/src-BllqCp4U.css`：当前 `cr-markdown` 段落、列表、表格为根字号的 0.875 倍；H1 为 1.25 倍，H2/H3 为 1 倍；行高 1.75，强调和标题 600；用户正文编辑显示 15px。

未将安装包同时包含的旧 `cb-markdown` 规则或通用 UI 的 14px token 当作当前回答样式。资源 SHA-256、ASAR integrity 核验及定向提取记录存放在工作区 `.local/answer-typography-20261117/`，不复制第三方组件实现到项目。

## 调整

- 回答工具栏复制双框增加圆角；点赞/点踩使用圆润指尖、手掌和袖口。通过既有 registry / YjIcon 消费，选中态与默认态共用轮廓，袖口间隙保持透明。
- 保持 16px、1.5 线宽、32px 点击区域、原颜色与 tooltip。全局其他复制图标不变。
- 对话正文从 14px 调整至约 15px，行高约 26.25px，已发送用户消息同步；H1 约 21.43px，H2/H3 约 17.14px。列表、引用、表格和流式内容共用相同 token，嵌套不累计缩小。
- 对话使用上述字体栈；等宽字体采用当前 WorkBuddy 的系统字体栈。代码块保留 13/20，过程说明保留紧凑字号，应用导航及输入框字号不变。

## 验证

- 受影响 Vue/TypeScript 文件 ESLint 通过；`vue-tsc --noEmit` 通过。
- 定向 Vitest：ChatAnswerActions、ChatCopyAction、ChatSafeContent、图标 registry 共 31 项通过。registry 首次检查发现原有 `quote` 注册项缺少测试清单记录，已同步该既有项并单独复跑 2 项通过。
- 复用真实组件的本地预览：亮色、暗色、1180×760、100% / 140% / 200% 缩放；无页面横向溢出，工具栏与输入框不重叠。表格独立横向滚动。
- DOM 计算样式：正文/用户消息/嵌套列表约 15.0001px、26.2502px 行高；H1 21.4287px，H2/H3 17.143px；三个图标 16px、圆端点/连接、线宽 1.5。
- 默认及点赞选中态均检查；复制、点赞、点踩确认/取消及焦点恢复由既有组件用例覆盖。
- 截图和只读样式记录：`.local/answer-typography-20261117/`。

仅运行本次相关前端检查和普通本地样例；未运行原生、后端或全量回归，未调用模型或产生真实任务。安全排除清单中含攻击 fixture 的用例不在本次定向范围内。WorkBuddy 原生窗口实时偏好与 YiJie 原生窗口像素级对照未执行，原因是当前工具没有原生窗口访问能力；此次对齐依据安装版本默认 CSS，不代表自定义字号/缩放状态也已核验。
