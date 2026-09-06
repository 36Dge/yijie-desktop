# Design 2.1 组件用色实施与原生验收

日期：2026-09-06。用户已明确批准候选作为第 4—5 项的落地依据。

`contract-impact = none`：本次修改颜色角色、CSS 状态和可用视口高度约束；不改变 Desktop / API / Agent Host 的跨进程请求、响应、权限、审批、业务状态或持久化格式。此分类不包括工作区中原有的独立 Skills 修复。

## 已实施范围

- 正式设计规范更新为 **2.1.0**，以 [组件状态矩阵](../design/docs/design/04-components/09-component-color-state-matrix.md) 为权威；已替换旧文档中普通浅绿底、深绿文字、品牌焦点与容器阴影的冲突规则。
- 运行时 `variables.css` 与 `createNaiveThemeOverrides` 使用同一套角色；共享 Naive 状态适配集中在 `component-colors.css`，由正式应用入口加载。业务组件不依赖 proposal 或 exports。
- 共享 Yj 组件和 27 个业务 Vue 文件的样式归位，覆盖新建任务、店铺、Skill 广场、工作流、设置、权限拒绝、已有对话及附件 / 推理 / 工具 / 审批等已有展示组件。
- 保留纯白 `#FFFFFF`、石墨 `#25282B`、青柠 `#C3F35B` 和已确认 SVG Logo。普通文字 / 图标中性化，导航保留青柠位置标记，主操作和小型选中填充使用青柠与石墨前景。
- 只读、禁用、加载、错误与焦点分开表达；文本选区为青柠 / 石墨。普通卡片、Composer 不再使用扩散阴影，浮层使用独立轻阴影；状态与图表语义保持独立。
- 参考导出的所有明暗颜色角色与运行时一致；Naive 主题和共享适配 CSS 与运行时字节一致。参考层没有复制完整业务页面。

已批准 proposal、离线评审页及 Logo 未被覆盖。原有 Desktop 的 5 个 Skills 修复文件及 Agent Host 的 6 个文件内容 SHA-256 均保持不变；本轮未执行 git add、commit 或 push。

## 原生验收发现并修正的问题

### 最小窗口内容高度

通过实际 Tauri Debug App 的 WebKit Inspector 只读测量：窗口缩至 `1180 × 760` 时，内容视口为 `1180 × 728`，标题栏占用 32px。原有外壳固定最小高度 760px，使文档超出视口并裁切底部设置入口。

仅将 `YjAppShell` 与 `.chat-workspace` 的最小高度限制为：

```css
min-height: min(
  var(--yj-layout-window-min-height),
  var(--yj-ui-viewport-height, 100vh)
);
```

不硬编码减去 32px，不提高原生最小窗口尺寸，不改变 UI zoom 算法、字号、间距或圆角。最终原生测量为：

```json
{
  "viewport": [1180, 728],
  "scroll": [1180, 728],
  "shellHeight": 728,
  "settingsBottom": 712,
  "theme": "light",
  "protocol": "tauri:",
  "background": "rgb(255, 255, 255)"
}
```

新增的 9 项真实组件浏览器检查确认：1180×728 的新建任务、历史对话和店铺无文档超高；底部设置与历史输入区可见。在 1180×760、1440×900 内容视口下，所测几何与修正前相同。原生明暗页面均在最小窗口检查，内容滚动保留在各自既有区域。

### WebKit 路由焦点

原有路由会为页面标题设置程序焦点，WebKit 的 `auto` outline 会继续绘制系统蓝色。共享样式将其颜色 / 宽度归入中性焦点，并对该标题使用 `solid` 绘制；保留路由聚焦和辅助技术公告逻辑，没有删除实际可交互控件的焦点。

## 已执行验证

| 检查 | 结果与范围 |
|---|---|
| 前端 lint / 类型 | `pnpm lint` 通过；候选迁入后局部 ESLint、完整 TypeScript 及 `git diff --check` 通过 |
| 设计文档与参考 | `pnpm docs:build`、reference 类型检查及 16 项 SVG 品牌资产检查通过 |
| 定向正常测试 | 共享主题 25 项、业务页面 / 卡片 31 项、正常 Chat 交互 69 项通过 |
| 旧视觉断言 | Composer 的项目 hover 断言从 `brand-soft` 更新到 `control-hover`，其余布局与行为断言保留 |
| 主题映射一致性 | 明暗运行时主题与“迁移前主题 + 已批准候选增量”相同；所有颜色角色与 reference 无漂移 |
| 浏览器页面对照 | 34 张真实组件捕获：7 类视图的前后明暗对照，以及三类核心页面的批准候选参考。固定 1180×760、相同合成数据，无浏览器异常、外部请求或原生命令调用 |
| 内容 / 几何 | 浏览器前后页面文本及所测主要区域的几何、字号、间距、圆角相同；原生可用高度修正另按上节验证 |
| 项目原生构建 | 标准 Tauri 工具生成本地未签名 Debug App；前端构建与 Rust 编译、App bundling 成功。未签名 / 公证 / 发布 |
| 原生页面 | `tauri://localhost` 的新建任务、店铺、Skill 广场、工作流、设置和已有对话，均实查明暗与最小窗口；已保存截图 |
| 原生交互 | 明暗真实键入后发送按钮可用；文本选区与中性焦点并存；权限说明开关保留草稿；随后清空本轮草稿，未发送模型任务 |
| 主题切换 | 通过系统外观切换检验真实 `prefers-color-scheme` 响应；以稳定绘制和只读计算值核对。已恢复用户原有浅色外观，关闭检查器和系统设置 |
| 原生导航计算值 | 暗色正常导航文字 / 子标签均为 `rgb(245,247,250)`，禁用为 `rgb(105,113,123)`，与角色矩阵一致 |
| 独立修复保护 | Desktop 5 个 Skills 修复文件、Host 6 个文件及 28 个批准稿文件内容均未变；运行时保留当前已修复 Host，没有回退旧 journal reader |

三类核心页面的所测计算样式与批准候选一致，唯一明确收紧项是空输入发送按钮：按矩阵的 disabled 优先级统一为 `control-disabled-bg`，不继续复用旧 `bg-subtle`。该灰底仅出现在小控件禁用态，不作为页面空间底色。

业务脚本与模板保持原样。初轮样式审计的“几何声明不变”结论之后，新增了上述两条原生可用高度约束；这是本轮唯一窗口适配修正，不能将其省略为“所有 CSS 尺寸声明完全未变”。

## 未通过、未执行及影响

| 项目 | 原因与影响 |
|---|---|
| 完整 `make lint` | 在 `generate:check` 被既有 `Agent Host checkout is not clean` 阻断。前端 lint 已单独通过；没有清理、提交、替换或放宽独立修复来绕过门禁，不能宣称全仓门禁绿色 |
| 全量 `make test` / `cargo test` | 既有综合套件包含攻击性内容、权限异常及可执行 fixture，与用户长期限制冲突，未执行。采用正常组件 / 页面 / 交互、构建及原生只读验证，异常恢复和攻击测试不宣称通过 |
| 被筛出的 13 项 Chat 测试 | 1 项 Reasoning 的 HTML/onerror 注入用例明确未执行；另外 12 项 Approval 用例不在本次有界正常状态选择中。断言没有被放宽 |
| 本机 Skills 安装 / 启停 / 卸载 | 未操作用户实际安装状态；其交互仍由既有安全组件回归验证。没有为了打开确认弹窗而先安装或卸载 Skill |
| 真实经营或模型调用 | 未发送消息、执行任务、调用付费模型或经营工具。原生只检查既有数据的呈现及可逆界面动作 |
| 签名、发布及全部原生安全能力 | 不在本轮视觉收敛范围。当前 Debug App 和 dirty sibling 只用于本机验收，不作为发布来源 |

本机启动复用既有 `.local/skill-journal-fix/run.sh`：协议和资源检查读取已锁定的干净来源，实际 Host 仍由当前修复源码经标准 Go build 生成；Runtime 保留原校验值。该方式不等于将 dirty Host 的完整门禁改判为通过。全程使用正常 App 退出和工具清理流程，未强杀、破坏权限、替换 Runtime 或注入攻击内容。

## 对照与证据

原生截图可能包含自动化鼠标指针 / 高亮，不应将其视为应用阴影。截图与既有对话内容仅保存在 ignored 本机输出，没有加入正式规范资源或上传。

- [本机前后对照报告](../../.local/color-convergence/report.html)：6 类页面、明暗、原生与同尺寸浏览器模式，图片内嵌可离线查看。
- `.local/color-convergence/browser-results.json`：34 张浏览器捕获、文本 / 几何 / 计算色比较。
- `.local/color-convergence/viewport-height-check.json`：9 项视口高度检查。
- `.local/color-convergence/native-measurement-ax.txt`：最终 WebKit 只读测量。
- `.local/color-convergence/native-interactions.json`：明暗原生输入与权限弹窗检查。
- `.local/color-convergence/native-before-bundle.json`、`native-after-bundle.json`：构建产物校验记录。
- `.local/color-convergence/business-style-audit.json`、`preservation-and-sync.json`：样式边界、正常测试选择、独立修复和批准稿保护。
- `.local/color-convergence/start.json`、`before-src/`：本轮开始时的快照，仅用于本机对照，不参与应用打包。
