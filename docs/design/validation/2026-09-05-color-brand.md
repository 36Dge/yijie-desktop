# 2.0.0 配色与品牌规范验证记录

- 日期：2026-09-05
- 范围：`yijie-desktop/docs/design/`
- 决策：`docs/design/docs/design/08-governance/07-lime-white-brand-refresh.md`
- 回滚参考：改造前 Desktop 基线 `bb9509f85d9a`；验证完成时尚未创建提交或推送。
- contract-impact = none：仅规范、文档站和迁移参考发生变化，活跃 Desktop、API / Agent Host、Tauri 与本地持久状态未改。

## 已执行

| 验证 | 结果 |
|---|---|
| `pnpm docs:build` | 通过；包含 `brand:check`、`typecheck:reference` 与 VitePress 构建 |
| `pnpm exec eslint --no-ignore docs/design/exports/src docs/design/docs/.vitepress/theme/index.ts docs/design/docs/.vitepress/theme/components/ColorBrandPreview.vue docs/design/scripts` | 通过；显式纳入默认忽略的文档站源文件，没有放宽规则 |
| `git diff --check` | 通过 |
| SVG XML 与副本校验 | 8 种变体、16 份文件均为 path/rect 等矢量结构，无 image、text、字体依赖或嵌入位图；public 与 exports 同源一致 |
| 真实 Chrome 文档预览 | 1180×760 亮/暗、1280×820 亮色、375×900 亮色；无横向溢出、损坏图片、JS 错误或失败资源 |
| 实际控件前景 | 亮/暗主按钮均为青柠底和石墨字；Checkbox 青柠底和石墨勾；Menu 选中使用对应主题的可读正文色 |
| 局部交互 | Checkbox 切换指标单位、菜单选择、详情展开、示例分析状态、VitePress 主题切换均通过；仅本地样张状态 |
| Logo 主题组合 | 12 种真实 Chrome 组合通过，包括系统偏好、显式参数、根主题和嵌套主题边界 |
| 其他选择控件映射 | 亮/暗共 22 项实际 Vue/Naive 挂载断言通过，涵盖 Radio、Switch、Select 及弹层、Pagination、Tag 等 |
| 变更范围 | 所有改动限定在 docs/design；10 个兄弟仓工作区干净 |
| 保留规范 | 与任务前 HEAD 比较，字号、行高、间距、圆角、动效、布局、状态/Agent 颜色 token 完全一致 |

正文石墨 / 纯白对比度为 14.82:1，石墨 / 青柠为 11.50:1；普通辅助文字 / 白色为 4.65:1。上述为选定色对的计算结果，不等同于整个产品的可访问性认证。

独立复审发现的菜单浅青柠前景和 Checkbox 白勾问题已修正并关闭；后续复审没有新增可操作问题。该复审由 Codex 子代理执行，不冒充用户最终验收或独立人工批准。

## 未执行、原因与影响

- 未执行全量 `make test` / `pnpm test` 和 Rust 测试：既有相关测试含攻击性 HTML fixture、权限故障及可执行文件替换类步骤，不符合用户本次及长期要求的正常、非破坏性验证范围，且本次没有修改活跃应用或 Rust。已采用文档构建、独立类型检查、纯矢量校验、正常控件交互和真实浏览器检查；本记录不代表产品全量测试通过。
- 未启动真实店铺、后端、Agent 或 Tauri App，也未修改签名/发布资产：本次仅更新规范和迁移参考。因此不能把规范预览通过解释为现有业务页面已完成改造、真实店铺链路已验证或 App 已发布。
- 没有执行强杀进程、权限破坏、可执行文件伪装/覆盖或攻击注入测试。检查用浏览器和本地静态服务器均通过正常 close 流程退出。

## 组件库边界

- Menu 的独立竖向青柠标记由共享导航封装提供；本地 Naive UI 没有相应独立主题键。
- `secondary` / `tertiary` / `quaternary` 与 `type="primary"` 的 Button 组合直接使用主填充色作为文字，参考示例不使用这些组合。未来需在共享按钮封装中单独提供可读映射，参见 Naive UI 集成规范。
- 未来引入的新组件、复杂变体和自定义渲染仍须按当前规范验证，不能推定所有 Naive UI 变体已覆盖。
