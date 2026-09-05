# 品牌资产规范

## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 更新日期：2026-09-05
- 适用仓库：`yijie-desktop`
- 默认语言：中文
- 决策：[清爽青柠与纯白品牌更新](../08-governance/07-lime-white-brand-refresh.md)

## 目标与范围

统一 App 图标、侧栏、登录页、关于页面、文档与空态的易界品牌资产。本次替换品牌形态与配色，产品名称、页面结构、组件职责和业务交互规则继续沿用。

中文界面使用 **易界**，技术命名使用 `yijie`，品牌缩写使用 `YJ` / `YIJIE`。标志来源为用户本次确认的「商品包裹折面 × YJ 负形」截图，不再使用旧手提袋加字母占位图形。

## 正式矢量形态

- 石墨主体表达商品包装折面，中间留白形成 Y，右侧回折融入 J。
- 青柠色位于右上包装折角，主体轮廓和负形在单色版中保持一致。
- 横版包含图形与已转为路径的「易界 / YIJIE」字标，不依赖系统字体重新排字。
- 使用纯色轮廓；截图中的纹理、光影和像素渐变不进入矢量母版。
- 所有 SVG 均为真实 `path` / `rect` 几何，不允许嵌入 PNG、JPEG、base64 位图或外部字体。

## 资产清单

规范站资产位于 `docs/design/docs/public/brand/`；迁移参考副本位于 `docs/design/exports/src/assets/brand/`。

| 文件 | 用途 | 颜色 / 背景 |
|---|---|---|
| `yijie-mark.svg` | 标准图形标志、导航、侧栏 | 石墨主体 + 青柠折角，用于白色或浅色背景 |
| `yijie-mark-dark.svg` | 暗色页面图形标志 | 白色主体 + 青柠折角，用于石墨背景 |
| `yijie-mark-mono.svg` | 单色印刷或单色界面 | 石墨单色，用于浅色背景 |
| `yijie-mark-mono-inverse.svg` | 单色反白 | 白色单色，用于深色背景 |
| `yijie-horizontal.svg` | 登录页、侧栏、关于页横版字标 | 浅色背景；图形与中英文字标同一 SVG |
| `yijie-horizontal-dark.svg` | 暗色横版字标 | 深色背景；白色字标 + 青柠折角 |
| `yijie-app-icon.svg` | App Icon 矢量源 | 石墨圆角方形、白色主体、青柠折角；画布透明留边 |
| `yijie-bag-logo.svg` | 旧文件名兼容入口 | 与 `yijie-mark.svg` 字节一致；内容已是新标志 |

`yijie-bag-logo.svg` 仅保留路径兼容，不代表可以继续使用旧袋形。新引用使用 `yijie-mark.svg`。暗色页面需切换专用暗底版，不能直接复用亮底兼容文件。

## 配色与尺寸

- 标准主体：`#25282B`；青柠折角：`#C3F35B`；反白主体：`#FFFFFF`。
- 青柠色由 `--yj-color-brand-primary` 驱动，白色与石墨由亮色规范 token 驱动，禁止单独修改某个派生 SVG 的填色。
- 图形建议最小显示尺寸 24 × 24 px；横版建议最小高度 32 px，较小的导航位置优先使用图形版。
- 保持原始宽高比；独立展示时四周至少留出图形宽度的 1/8，不挤压、拉伸、旋转或重新拼接字标。
- App Icon 使用独立圆角方形构图，不能把整块 App Icon 当作页面插画，也不能给透明图形版任意加底板。

## 单一母版与同步

`docs/design/brand/logo-geometry.json` 保存可编辑路径、构图及用户确认截图的 SHA-256 来源记录。`docs/design/scripts/sync-brand-assets.mjs` 从该母版与颜色 tokens 生成上述两处资源。

在仓库根目录执行：

```sh
pnpm --dir docs/design brand:sync
pnpm --dir docs/design brand:check
pnpm docs:build
```

先修改几何母版或颜色 token，再同步派生 SVG；禁止让 `public/brand` 与 `exports` 两套副本各自演进。`brand:check` 核对资源是否与母版一致，文档构建前自动执行该检查。

## 组件与迁移

展示品牌时使用 [YjLogo 参考组件](../09-implementation/07-logo-code-scaffold.md)。通过显式主题或应用主题选择亮暗资产，不能对整张 Logo 使用 CSS `filter: invert()`，以免青柠颜色被反转。

本次已替换的是 `docs/design/` 权威规范、预览和迁移参考，**活跃 `src/` 与 `src-tauri/` 尚未迁移**。后续新需求与已有页面改造以本规范为准，在各自任务中迁移 tokens、主题与 SVG；App 打包任务再从新 SVG 生成 PNG/ICNS，不覆盖既有签名或发布二进制。

## 禁止事项

- 不混用旧袋形、新包裹形或前序未选中的 Logo 提案。
- 不用普通文本重新排版横版字标，不把平台品牌图标拼接成联合 Logo。
- 不靠调透明度或反色滤镜生成暗色版本。
- 不随机生成额外品牌版本；后续形态更新仍需明确任务与设计决策记录。

## 验收清单

- [ ] 图形及中英文字标与确认稿一致，包含单色与暗底版。
- [ ] 所有资源为纯矢量路径，无嵌入位图和字体依赖。
- [ ] 两处资源通过 `brand:check`，兼容文件与标准图形一致。
- [ ] 亮暗主题下 24 / 32 px 图形清晰，横版宽高比保持正确。
- [ ] 所有引用明确迁移范围，没有把规范更新描述为应用已完成改造。

参见：[实际配色与品牌预览](./07-color-brand-preview.md)、[颜色 Tokens](../02-tokens/02-color-tokens.md)、[主题与暗色模式](./05-theme-dark-mode.md)。
