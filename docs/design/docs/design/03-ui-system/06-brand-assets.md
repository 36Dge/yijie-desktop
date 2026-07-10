# 品牌资产规范


## 文档状态

- 状态：Accepted
- 版本：1.0.0-final
- 适用仓库：`yijie-desktop`
- 适用技术栈：Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、ECharts、Lucide
- 默认语言：中文

## 目标

定义易界 Logo、App Icon、产品名称和品牌资产落地方式。

## 适用范围

适用于 App 图标、侧栏 Logo、登录页、关于页面、文档、空态和安装包资产。

## 规范正文

## 产品名称

- 中文界面显示：易界。
- 技术命名：yijie。
- 品牌缩写：YJ / YIJIE。

## 初始 Logo

当前无 Figma/品牌稿，因此本规范提供初始工程资产：

```text
docs/design/docs/public/brand/yijie-bag-logo.svg
docs/design/docs/public/brand/yijie-app-icon.svg
```

视觉形态：手提袋 + YJ 字母。

- 手提袋代表跨境电商卖家经营。
- YJ 代表易界。
- 主色使用 `#95BF47`。
- App Icon 使用 macOS 圆角图标语义。

## 使用规则

- 侧边栏和登录页使用 `yijie-bag-logo.svg`。
- App 打包图标可以先基于 `yijie-app-icon.svg` 导出 PNG/ICNS。
- 品牌资产后续若由设计稿替换，必须保留文件名兼容或提供迁移说明。

## 禁止事项

- 不允许 AI 随机生成多个 logo 版本混用。
- 不允许在不同页面使用不同品牌写法。
- 不允许把平台品牌图标与易界品牌图标混合成联合 logo。

## AI / Codex 必须遵守

- 需要展示品牌时使用 `YjLogo`，不要手写 img。
- 不允许生成新的 Logo 资产，除非有明确任务和 ADR。
- 不允许把 App Icon 当作普通页面插画使用。
- 不允许修改 SVG 颜色而不更新 token。

## 实现要求

实现 `YjLogo.vue`，支持 `mark`、`horizontal`、`iconOnly` 三种模式。App Icon 由构建脚本导出不同尺寸资源，源文件保持 SVG。

## 验收清单

- [ ] Logo 使用统一资产。
- [ ] 产品名称写法统一。
- [ ] App Icon 可导出打包资产。
- [ ] 暗色主题下 Logo 可读。
- [ ] 后续替换有版本记录。

## 关联文件

`docs/design/docs/public/brand/yijie-bag-logo.svg`、`docs/design/docs/public/brand/yijie-app-icon.svg`、`docs/design/docs/design/09-implementation/07-logo-code-scaffold.md`
