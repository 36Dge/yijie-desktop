# Logo 代码骨架

## 文档状态

- 状态：Accepted
- 版本：2.0.0
- 更新日期：2026-09-05
- 适用仓库：`yijie-desktop`
- 默认语言：中文

## 目标与范围

提供与新包裹 / YJ 负形标志一致的 SVG 与 Vue 迁移参考。本次仅更新 `docs/design/`，实际业务页面在后续任务中迁入自身 `src/`，不能从运行代码直接导入文档站目录。

## 文件结构

```text
docs/design/
  brand/logo-geometry.json                    # 唯一几何母版
  scripts/sync-brand-assets.mjs               # 同步/校验 SVG
  docs/public/brand/                          # 文档站 SVG
  exports/src/assets/brand/                   # 同源迁移副本
  exports/src/components/yijie/YjLogo.vue      # Vue 参考组件
```

资产清单见 [品牌资产规范](../03-ui-system/06-brand-assets.md)。迁移时将 `exports/src/assets/brand/`、参考 `YjLogo.vue` 和相应主题 tokens 纳入活跃 `src/`，保留资源相对导入路径。不要硬编码 `/brand/` 为业务应用运行路径。

## 组件 API

```ts
type YjLogoVariant = 'mark' | 'horizontal' | 'icon-only'
type YjLogoSize = 'sm' | 'md' | 'lg'
type YjLogoTheme = 'auto' | 'light' | 'dark'
```

| 参数 | 默认 | 语义 |
|---|---|---|
| `variant` | `horizontal` | `mark` 是纯图形；`horizontal` 使用已转轮廓的图形＋中英文字标；`icon-only` 使用 App Icon |
| `size` | `md` | SVG 显示高度依次 24 / 32 / 40 px；宽度随原始比例变化 |
| `theme` | `auto` | 随主题边界选择亮暗 SVG；也可由局部表面明确指定 `light` / `dark` |

文档早期使用过 `iconOnly` 写法，实际组件一直使用 `icon-only`；以本表与参考代码为准。

```vue
<YjLogo variant="horizontal" size="md" />
<YjLogo variant="mark" size="sm" />
<YjLogo variant="horizontal" size="md" theme="dark" />
<YjLogo variant="icon-only" size="lg" />
```

`YjLogo` 自带 `role="img"` 与“易界”可访问名称，内部 SVG 图片使用空 `alt` 避免重复朗读。不要再把中文普通文本并排追加到横版 SVG。

## 明暗主题

主题 token 由文档站或应用主题控制器应用在根元素或局部 `[data-theme]` 边界上。`auto` 使用当前主题；局部卡片与全局主题不同时，使用局部主题边界或显式 `theme`。`light` / `dark` 显式参数优先于系统偏好。

App Icon 自带石墨底板，因此两种主题共用一个 SVG。透明图形及横版需要分别使用浅底与暗底资产；禁止整图反色。

## 同步与验证

```sh
pnpm --dir docs/design brand:sync
pnpm --dir docs/design brand:check
pnpm docs:build
```

`brand:sync` 仅从母版和规范 token 可复现地生成本目录下的 SVG，不修改应用资源或二进制。`brand:check` 仅校验、不写入。App 打包时另行从 SVG 导出 PNG/ICNS，不能把 PNG 嵌入 SVG 冒充矢量。

## 验收清单

- [ ] `mark`、`horizontal`、`icon-only` 语义与文档一致。
- [ ] 显式主题、跟随系统与局部主题边界均选择正确资产。
- [ ] 字标不依赖已安装字体，资源通过导入随构建处理。
- [ ] SVG 同源校验、组件类型检查和实际亮暗预览通过。
- [ ] 后续迁移说明实际改动的页面范围。

参见：[品牌资产规范](../03-ui-system/06-brand-assets.md)、[实际预览](../03-ui-system/07-color-brand-preview.md)。
