# 文件路径浮层与原生预览变白修复

## 原因

1. 原路径 `NPopover` 向下覆盖正文区域，命中 `blockingOverlayVisible()`，随后 `resize(visible=false)` 隐藏了整个原生 Wry 阅读视图。文档内容没有丢失，是 UI 层的遮挡处理错误。不能仅豁免这个浮层：主 WebView 的 DOM 浮层仍可能被上层原生子视图盖住。
2. 上一版按 `source.kind` 直接将 artifact／attachment 标为 managed，没有查询工作区。实际生成流程 `publish_artifact` 从会话工作区读取已经生成的文件，另将副本登记并持久化；数据库里有副本不代表磁盘上没有原文件。该前端推断不完整。

## 修复

- 路径浮层固定在文件夹图标上方，根据窗口空间左右对齐，禁止向正文区翻转。顶部高度及水平宽度受实测窗口和缩放约束，长路径可滚动；不对普通菜单／模态层的遮挡规则作豁免，不隐藏、关闭或重载文档。
- Native `locate` 增加 artifact／attachment 的带 revision 请求。先通过原授权读取取得真实名称、格式、大小及 SHA-256，再用同 scope/session 的已登记工作区书签定位根目录；有界查找现存文件，完整内容一致才返回真实绝对路径。没有全盘扫描、创建副本、修改原文件或拼接虚构路径。未匹配时返回错误。
- 查找限制 4096 条目、8 层、64MiB 候选读取；普通文件打开使用现有 macOS `O_NOFOLLOW_ANY` 等限制，返回前重新校验授权与持久来源 revision。等价副本优先登记名称和较短的稳定路径。文件名相同但内容不同的文件不会被误认为当前版本。
- 删除“保存在易界本地，尚无独立文件路径”的硬编码分支。前端按 Native `locationSupported` 能力启用扩展查询；版本、上下文或标签变化后清除路径，迟到结果不复用。

`contract-impact = additive`。Desktop 私有 schema 与普通 fixtures 先行，经原生成器更新类型；旧 messageFile locate 行为保持，旧 Native 没有能力字段时不发送新变体。未修改公共 Contracts、Host、Codex Runtime、持久化结构或 Tauri command/capability。涉及的新工作区读取仅限用户明确要求的当前文档位置查询，且返回值绑定授权内容。

## 定向检查

- ESLint、TypeScript、生成一致性、受影响原生文件 rustfmt、diff 检查通过。
- 36 项前端测试通过，覆盖浮层禁止翻入原生正文、正文保持可见、不重新 open/close、真实路径显示、原生能力门控以及过期上下文的结果丢弃。
- 6 项原生测试通过：位置查找 3 项（同名不同内容、等价副本、缺失不造文件）、schema 正常请求一致性、正常绑定附件、真实书签的消息文件读取／工作区解析。只运行这些筛选项，未运行攻击 fixture、权限破坏、强杀或全量原生测试。
- 首次把工作区解析断言放在使用占位书签的旧附件测试中，出现 `ProjectUnavailable`。已将该断言放到现有真实书签正常用例，原附件用例复验通过，没有放宽产品校验。

## 原生客户端实测

发现原日常开发客户端已正常退出，入口记录 `stopped`、退出码 0，canonical `check` 通过。通过仓库已有 `development-client.py start-ui` 构建未签名的本项目调试产物，沿用原身份和 Homes；没有覆盖发布 App 或 Runtime。此入口使自动化可连接真实原生窗口。

在原“FEAT-171 文档验收 A”历史中只读打开既有文件，没有提交新任务或保存文件：

- `杭州样本-第二版.xlsx` 正文显示原表格，B2=4、合计=7、均值=3.5。打开文件夹路径浮层后，表格仍完整可见，未出现白屏；Native 返回 `/Users/jack/Documents/FEAT-171验收-20261109/kimi-update/杭州样本-第二版.xlsx`。
- 切换到 `杭州样本-第二版.docx`，正文、原表格、插图与修订说明均显示。路径浮层更新为对应 `.docx` 的真实文件位置，正文保持可见，没有串用前一个 XLSX 路径。
- 原生窗口 1339×843，右栏 336 CSS px；路径在顶部可用区域显示，正文区域未被浮层占用。截图与无障碍路径文本已通过 CUA 返回本对话。

验收后通过应用正常 ⌘Q 退出，入口退出码 0，日志记录 `normal app cleanup complete` 和专用容器正常停止。随后通过 `pnpm client:dev` 恢复日常开发入口，继续沿用原身份、数据和配置。启动日志分别保留于 `.local/preview-path-fix-20261110/native-ui-start.log` 和 `restore-development.log`。

日常入口恢复完成：开发构建 35.67 秒结束，App PID 8304，窗口仍为 1339×843，Agent Host 与技能／专家／连接器正常就绪，原工作流鉴权 ready。客户端保持打开；未提交、发布或改动用户文档。
