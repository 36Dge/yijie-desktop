# 真实页面隔离预览检查

本检查只针对 `proposals/2026-09-06-component-colors/preview/`，没有修改正式规范、现有 `src/`、原 `.local/design-v2-review` 或任何仓库提交。

## 运行方式与结果

在主任务管理的预览服务 `127.0.0.1:1448` 上执行：

```sh
node docs/design/proposals/2026-09-06-component-colors/validation/page-state-audit.cjs
```

- 浏览器：本机已安装 Chrome，视口 `1180 × 760`。
- 12 个正常页面组合通过：Chat 新建任务、我的店铺、Skill 广场 × 亮/暗 × current/candidate。
- 16 个已有状态分支通过：Chat、Skill 广场 × 亮/暗 × loading/empty/error/denied。
- 4 个真实控件交互通过：亮/暗 Chat 输入焦点与权限弹层，亮/暗 Skill 合成安装与启停。
- 所有页面没有浏览器异常、外部资源请求或 native IPC 调用；`native.attemptedCommands` 始终为空。
- 独立 `vue-tsc --noEmit -p docs/design/proposals/2026-09-06-component-colors/tsconfig.preview.json` 通过。

完整计算样式、状态文字及内存动作记录见 [page-state-audit.json](./page-state-audit.json)。没有创建截图副本，正式全页截图由主任务统一管理。

## 选择器与候选差异

| 对象 | 实际选择器 | 候选规则 |
|---|---|---|
| 新建任务说明 | `.chat-entry__subtitle` | 从辅助灰提升为 `text-body`，保持字号与位置 |
| 顶部说明、卡片描述 | `.yj-page-header__description`、`.yj-section__description`、`.skill-card__description`、`.store-scene-card__description` | 统一承担有用内容的正文角色 |
| 项目/历史名称 | `.chat-tree__project-name`、`.chat-tree__session-link` | 使用主要文字；时间、版本和状态元信息保留独立角色 |
| 主导航 | `.yj-nav-item--selected` | 默认导航底与 3 px 青柠内侧标记；hover/pressed 使用中性色并保留位置标记 |
| 输入区 | `.chat-composer__field` | 默认无阴影；中性控件边界；聚焦为清晰 2 px 中性圈 |
| Skill 图标与卡片 | `.skill-card__icon`、`.skill-card` | 图标为卡片底与主要文字，细中性边框；默认、hover、focus-within 不添加扩散阴影 |
| 小面筛选 | `.yj-tabs__tab--selected` | 默认/hover/pressed 分别使用三阶青柠，石墨字及石墨边框 |
| 普通说明标签 | `.store-page__source-label`、`.store-scene-card__badge` | 经营来源与促销标签使用中性角色；真正错误、风险及成功状态保持独立语义 |
| 共享 Naive 控件 | `.n-button`、`.n-menu`、`.n-switch--disabled` | 统一按钮焦点、选中位置标记与禁用样式，页面和图谱不再各自覆盖 |

候选样式全部受 `html[data-palette="candidate"]` 限定。`current` 使用当前真实源码样式和当前主题映射，不应用候选覆盖。

## 合成边界与未覆盖项

- 使用真实 `ChatPage`、`StorePage`、`SkillMarketplacePage`、`YjAppShell` 和共享组件，不复制页面业务组件。Skill store 保留原有状态转换，客户端只读写隔离内存目录。
- Chat/Skill 的 loading、empty、error、denied 是直接设置的被动界面投影；没有启动服务、制造真实故障、注入攻击内容或调用原生能力。
- StorePage 是现有固定演示数据页面，没有全页 loading/error/denied 分支；本轮没有杜撰这些状态或把重复正常页记为状态验收通过。
- Chat 输入、合成对话及 Skill 安装/启停只改变预览内存，刷新即恢复，不验证真实权限、模型、安装、持久化或经营操作。
- 本轮未执行实际 Tauri/WebKit、原生打包或与视觉无关的测试；浏览器结果不能替代后续正式运行环境验收。
