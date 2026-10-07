# 对话模型图标

获取日期：2026-10-03。按用户提供的模型菜单参考图接入，用于识别用户可选择的模型；
商标及图形权利归各自所有者，不表示合作或官方背书，不宣称素材具有开源授权。
用户本次请求授权在此模型选择界面使用这些标识，不扩展为其他营销用途。

- `kimi.svg`：来自 [Kimi 官网](https://www.kimi.com/) 引用的
  [官方图标资源](https://statics.moonshot.cn/kimi-web-seo/assets/kimi.icon-CElMvu4q.js)
  中的 `KforKimi_f` 单色路径；保留原始几何与 `currentColor`，外层使用黑底白字徽标，
  菜单中为圆角方形、触发按钮中为圆形。
- `minimax.svg`：来自 [MiniMax 开放平台](https://platform.minimax.io/) 引用的
  [官方标识 SVG](https://mintcdn.com/minimax-cac98058/XYzsL2L2ynonu2Q_/logo/light.svg)。
  取其中独立的波形图标路径，保留几何，以 `0 0 32 32` 画布显示并使用 `currentColor`
  单色呈现以适应亮暗主题；不包含右侧英文商标字样。

- `deepseek.svg`：来自 [DeepSeek 官网](https://www.deepseek.com/) 页头内联 SVG 的
  独立鲸鱼图形路径，保留原始几何与 `currentColor`，画布仅容纳图形、不含英文商标字样。
- `glm.svg`：来自 [Z.ai](https://z.ai/) 引用的
  [官方标识 SVG](https://z-cdn.chatglm.cn/z-ai/static/logo.svg)，取内部 Z 图形的三段原始几何，
  去除应用图标底板，以 `currentColor` 单色呈现。仅用于 GLM-5.3 的待支持入口。

四者经 `model-icons.ts` 注册为 `modelKimi` / `modelMiniMax` / `modelDeepSeek` / `modelGlm`，由 `YjIcon` 引用，
运行时不请求官方站点。
