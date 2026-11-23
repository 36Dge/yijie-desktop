# 工作流图标

2026-11-23 使用 Codex 内置 `image_gen` 工具为八个内置工作流分别生成专家页风格的业务角色插画，自建工作流共用拿着流程板的机器人头像。

- 成品位于 `generated/*.png`，均为 192×192，在卡片中显示为 48×48，圆角 12px。
- 每张头像的完整生成提示词由 `basePrompt`、换行、`Subject and color direction: ` 和对应条目的 `subject` 依次组成。[当前头像提示词](portrait-prompts.json)
- 2026-10-18 版使用彩色图形标识。[初版生成提示词](generation-prompts.json) · [初版配色调整提示词](recolor-prompts.json)
- [来源记录](provenance.json)：记录每张原图与成品路径、SHA-256 和尺寸。原图保留在 Codex 生图输出目录。
- 只通过 macOS `sips` 等比缩小导出，不用代码绘制替代生图；无新图标库、外部图片 URL 或运行时生图请求。
- `src/icons/workflow-artwork.ts` 按稳定工作流 ID 选择图片，自建流程和其他未知 ID 使用同一机器人头像。
- 图片为装饰性内容（空 alt、aria-hidden），卡片标题仍提供可访问名称。操作与状态图标继续使用 YjIcon。

`contract-impact = none`：只替换 Desktop 卡片展示素材与尺寸；跨进程接口、API / Agent Host、工作流存储格式和值不变。
