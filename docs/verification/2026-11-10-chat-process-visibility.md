# 处理过程可见性修正（2026-11-10）

用户要求保留真实执行记录，将已恢复的失败及仅因展示不支持产生的未知内容默认收进处理过程，当前阻塞和待审批事项保持清楚可见；只执行针对性验证。

`contract-impact = none`：只改 Desktop 的活动阅读索引及摘要。未改 API、Host、Native IPC、执行／审批权限、原生状态、本地持久记录或重放格式。既有用户改动保持，未提交或发布。

## 读取规则

- `unknown` 仅在已观察到完成、没有执行状态或推理异常、内容全部为 `unsupported_content` 占位时可折叠。审批、明确状态提示和缺结束记录优先外显。
- 历史失败只在 `native_observed` 轮次的 domain/terminal 均明确 completed、没有阻塞性诊断时考虑折叠；失败后须先有成功执行，再有完整可读公开答复。不跨用户输入或更早的明确最终回答。
- 这里只是展示归类。现有投影没有可靠的重试关联，不能用 `zsh · 参数已隐藏` 等标签认定同一次业务操作，不解析回答文字猜测业务成功，也不改写单项 failed。活动摘要显示失败次数，详情仍展示原状态及输出。
- 当前末尾失败、失败／中断／运行中的轮次、缺终态、不可用执行结果、协议缺口、拒绝／取消、不确定状态以及待审批／提交／核对／错误继续外显。
- 单项身份、顺序及原对象保持，已有公开消息分段边界与手动折叠选择保持。

## 定向检查

1. `pnpm exec vitest run src/domain/conversation-activity-presentation.test.ts src/components/chat/ChatProcessPresentation.test.ts src/components/chat/ChatActivityGroup.test.ts --reporter=dot`：44 项通过。覆盖历史读取、新旧未知项、成功执行与答复的必要顺序、边界、当前失败、审批优先级、记录不变、失败输出查看和展开选择。
2. `ChatTurnGroup.test.ts` 仅筛选既有审批桥接用例 `keeps approval decisions closed by default and relays complete identity through an explicit bridge`：1 项通过，其余26项未执行；审批操作仍按既有 authority 开闭、发出完整原身份。
3. 四个受影响 TS 文件的 ESLint、`vue-tsc --noEmit` 和 `git diff --check` 通过。

检查前核对 `scripts/test-safety-exclusions.json`。三个完整运行的相关文件不包含被排除用例；审批文件只执行上述普通用例。未运行全量回归、原生测试、付费模型、强杀／权限故障／攻击注入测试。

## 组件界面检查

以实际 `ChatTurnGroup`／`ChatActivityGroup`／`ChatCommandItem` 组件加载普通合成记录，含7条历史失败、7条已结束未知项、后续成功命令及公开答复。浏览器视口1180×760，同时检查760px正文与400px窄栏：

- 亮色初始只显示过程入口及答复，历史失败与未知卡片默认收起。
- 暗色展开过程后摘要显示 `8 次调用 · 7 次失败 · 7 项暂不支持展示`；键盘Enter展开活动组可见全部原失败和未知项，长记录沿原活动滚动容器查看。
- 当前未恢复失败在过程收起时仍可见。
- 亮／暗主题下待审批卡和允许一次／取消本轮按钮保持可见，未执行真实审批。
- 400px窄栏无水平页面溢出；浏览器控制台无错误。检查后恢复视口、关闭预览页，Vite通过SIGINT执行自身正常关闭。

本地可复查的预览源、测试日志与截图在 `.local/chat-process-visibility-preview/`：`light-collapsed.png`、`dark-process-summary.png`、`dark-expanded-records.png`、`dark-current-blocker.png`、`light-pending-approval.png`、`dark-pending-approval.png`。

这些结果属于组件预览和定向前端检查；未重新启动原生客户端、重放 FEAT-171 任务或修改该会话的历史数据，不作为真实模型或完整端到端验收。

## 用户追加的实际客户端验证

用户随后明确要求在实际易界客户端打开原 FEAT-171 验收对话，只核对默认折叠与展开记录，禁止重跑任务或调用模型。本节记录这次追加实机检查，不扩大前面的组件验证结论。

首次打开的是11:04生成的调试 bundle，其静态前端早于12:41的本次修复，仍出现旧卡片。通过客户端⌘Q正常退出，确认相关进程结束后，使用既有 `python3 -B scripts/development-client.py start-ui` 更新可复现开发构建。复用原 Native/Host/Runtime Homes，没有覆盖已发布应用，也没有新增产品代码修改。

在 `tauri://localhost/chat/01a1bffe-b5f3-74f3-a187-8ebc8f18897a` 实际观察并保存结果：

| 检查 | 结果 |
|---|---|
| A生成轮次初次打开 | `已完成 1299s` 过程入口默认收起；7次失败和7条未知项不再逐条出现在默认阅读区 |
| 展开处理过程与相关活动组 | 7次失败和7条 `unsupported_content` 记录均可查看，原状态不变 |
| 逐项展开失败详情 | 7项均保留 `command_failed`、退出码2及既有安全输出；被历史脱敏的内容仍显示脱敏标记，没有恢复或猜造隐藏参数 |
| 重新收起 | 外显失败卡片0、未知卡片0，最终答复保持可读；原首轮未完成／运行错误提示仍保留 |
| 其他历史内容 | 9份生成件及4份修订稿，共13个产物链接仍在 |
| 无任务重放 | 原生rollout验证前后逐字节一致，393行，新增轮次0、工具调用0 |

第一次展开明细检查期间，桌面自动化返回超时。检查发现客户端已经正常退出：入口返回0，日志明确记录 `normal app cleanup complete` 与专用容器正常停止，未据此推断退出原因。再次通过同一入口正常打开后完成上述检查，没有强杀或故障注入。

原生thread为 `01a1bffe-b62b-7a92-9893-1967519643df`；rollout前后SHA256均为 `f3f72065431327093c2fdfcbf7e6e300e1d5e22db0f79c3dab4408628c007268`。本次未发送消息、未重跑命令、未调用模型、未点击审批或文件保存；未执行额外回归测试。最终将实际客户端留在该会话的过程折叠状态。

证据位于 `.local/chat-process-visibility-native/`：`native-verification.json`、`native-a-all-failure-details-ax.txt`、`native-final-collapsed-ax.txt`、`native-final-collapsed.png`、`native-a-failure-output.png`，以及保留的两次启动日志。真实窗口1339×843、100%缩放、2倍Retina；本轮没有调整系统外观或窗口尺寸。
