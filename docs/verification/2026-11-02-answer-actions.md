# 回答操作组、轮次模型与完成时间

用户要求在回答复制右侧增加点赞、点踩、实际模型标识，并在整个操作组悬停时显示完成时间。点赞/点踩明确只做前端交互，不发送反馈、不修改模型或下一轮输入；点踩移除“其他原因”。

已实际操作 WorkBuddy 最新任务“全面介绍杭州”：复制后显示“已复制”；点赞可切换；点踩弹层允许选择原因，选择后启用确认，取消关闭。未向 WorkBuddy 提交反馈原因。易界采用相同交互结构与自己的中性/青柠 tokens、1.5px 线性图标。

`contract-impact = additive`：新增 Desktop 私有只读 `chat_read_turn_model_v1`，权威源为 `src-tauri/schemas/chat-turn-model-v1.schema.json`，生成 TS/Rust/validator。原生按已有 `read_sessions`、owner/tenant/session/turn 归属，读取 `chat_turns.operation_id` 对应的 `chat_operation_models.profile_id`。这是原执行链已经冻结并实际用于 dispatch 的模型；不得以当前输入框模型反推旧回答。旧记录缺失返回 null，不回填、不猜测。旧 command 与 wire 不变；公共 Contracts PR/pin 为 N/A，Host/Runtime/数据库 schema 不变。原生先更新，再由同一固定客户端使用新读取；旧 Native 缺少命令时仅元数据回退，不阻断正文。

完成时间复用现有原生 `NativeTurnTiming.completed_at`，与原有耗时共用一次读取，不能使用当前渲染时间代替。完成时间不在反馈操作中写入。

点赞、点踩及原因只保存在当前回答组件内存，正文/身份变化或卸载即清理；没有反馈接口、持久化、遥测、模型请求或提示词接线。这部分及操作组 UI 属于 `contract-impact = none`。本轮正常授权范围包含显示模型所需的只读私有元数据能力；无新增依赖或 Tauri capability。

## 实现与边界

- 完成的最终回答底部依次显示复制、点赞、点踩、当轮模型。用户消息、代码复制以及尚未完成的消息沿用原交互。
- 复制沿用原剪贴板适配器，成功后短暂显示勾选和“已复制”；失败可重试。三个图标按钮分别提示“复制”“点赞”“点踩”，使用 16px 图标、1.5px 线宽与 32px 点击区域。
- 点赞可再次点击取消；点踩弹层六项原因可多选，至少选择一项才可确认。确认后选中点踩并取消点赞；关闭、Escape、点击外部均丢弃本次草稿，保留先前标记。再次点击已选中的点踩可清除。没有“其他原因”。
- 整组悬停或键盘焦点进入时，在模型右侧显示真实完成时间；没有元数据时明确显示未知，不使用当前模型或当前时间猜测。隐藏时间保留占位，不引起按钮位移。
- 使用现有主题与品牌图标；弹层支持键盘焦点循环和 Escape 返回触发按钮。模型读取限制并发、有限重试，并隔离切换任务后的过期响应。

## 实机与视觉验收

通过正常 ⌘Q 退出旧客户端 PID 66859，观察到正常清理与退出码 0、无 signal，再从固定入口 `/Users/jack/Applications/易界.app` 启动标准增量开发构建（新 PID 26156）。未强杀、未替换既有二进制。

在原“介绍一下杭州的最有名的几个美食店铺？”历史对话中，六轮回答均显示其真实 Kimi K3.1 Pro 标识，末轮完成时间为 **11:21**；旧“全面对比苏州与杭州”任务仍显示退役模型 **Kimi K3**，没有被输入框当前模型覆盖。本轮验收复用历史对话，未再发送模型问题。

已在真实客户端执行复制成功、点赞开关、点踩多选与确认、再取消点踩；结束时所有测试评价恢复未选中。鼠标移入复制/点赞/点踩分别出现对应 tooltip，模型旁出现完成时间。原生窗口 **1180×760** 下操作组及弹层完整可用，结束恢复用户原尺寸 **1268×845**。

生产组件本地预览补充验证亮色/暗色、Kimi/MiniMax 两条独立回答、互斥标记、键盘 Escape、离开操作组后的时间隐藏、复制按钮不误声明为 toggle。两主题均无横向溢出，预览无 console warning/error；临时页面关闭并恢复浏览器 viewport。预览的复制适配器只记录调用次数，真实剪贴板成功以原生客户端为准。

实机图片与 WorkBuddy 对照保存在忽略目录 `.local/development/answer-actions-20261102/`；未将账号快照、访问 token 或 WorkBuddy WebView URL 写入证据。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `make lint` | 通过，含生成契约校验、Rust format、默认及 Kimi Clippy |
| `make test` | 通过；前端当次 2040 passed / 16 skipped；Node 26 passed |
| 最后 UI/ARIA 调整后的 `pnpm lint`、`pnpm test` | 通过；255 文件、2041 passed / 16 skipped；Node 26 passed |
| 默认 Native | 623 passed、14 ignored、27 安全过滤 |
| Kimi Native | 658 passed、16 ignored、27 安全过滤 |
| `make build`、最后 `pnpm build` | 通过；保留已有的大 chunk 提示 |
| `pnpm docs:build` | 通过 |
| `git diff --check` | 通过 |

新增验证覆盖原始 Markdown 复制、成功复位、准确模型与时间、点赞/点踩互斥与取消、切换回答清理、反馈无传输/持久化接线、只读模型查询不写数据库、不受后续模型选择影响、元数据缺失/未知/过期响应，以及完成时间与耗时共享同一次读取。

未执行项目：沿用 `scripts/test-safety-exclusions.json` 排除的故障注入、可执行程序替换、权限破坏及攻击性 fixture；项目既有 ignored 项也未执行。上述 skipped/ignored/filtered 均不计为通过，不能据此声明这些异常路径已验证；本次以正常只读、正常生命周期和普通数据验证所需行为。未执行发布、签名或打包交付，本次交付为固定开发客户端中的更新。

已有工作区改动保留，起点备份见 `.local/development/answer-actions-20261102/before/`。本轮源码摘要、结果与本地证据路径记录于 [verification.json](./evidence/2026-11-02-answer-actions/verification.json)，任务内增量另存 `task-only.patch`。没有提交或推送 Git。
