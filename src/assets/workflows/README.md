# 工作流图标

2026-10-18 根据用户要求，使用 Codex 内置 `image_gen` 工具逐个生成 8 张工作流专属图标和 1 张自建文本工作流通用图标。

- 成品：`generated/*.png`，192×192；UI 使用既有 token 显示为 48×48、圆角 12px，与技能图标保持一致。
- [完整生成提示词](generation-prompts.json)：记录工作流名称、描述、视觉隐喻与配色。
- [配色调整提示词](recolor-prompts.json)：按用户参考，获客与多语种本地化改为薄荷绿／翠绿，广告搜索词优化改为浅黄／橙黄；保持原有图案、比例和细节。原版本记录保留在来源清单中。
- [来源记录](provenance.json)：记录每张原图与成品路径、SHA-256 和尺寸。原图保留在 Codex 生图输出目录。
- 只通过 macOS `sips` 等比缩小导出，不用代码绘制替代生图；无新图标库、外部图片 URL 或运行时生图请求。
- `src/icons/workflow-artwork.ts` 按稳定工作流 ID 映射；未知 ID 和用户自建流程使用节点自动化图标，不根据任意名称猜测用途。
- 图片为装饰性内容（空 alt、aria-hidden），卡片标题仍提供可访问名称。操作与状态图标继续使用 YjIcon。

`contract-impact = none`：只替换 Desktop 卡片展示素材与尺寸；跨进程接口、API / Agent Host、工作流存储格式和值不变。
