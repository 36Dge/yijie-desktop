# 网页搜索来源交互 v1

## 范围与授权

用户 2026-11-01 明确要求：来源限高滚动、网站自身图标、点击超链打开对应网页，移除
partial 底部提示。此授权覆盖来源站点图标请求及系统浏览器打开，不再沿用 2026-10-23
“仅惰性纯文本”的产品呈现限制。

`contract-impact = semantic`：新增 Desktop 私有 IPC `chat_web_source_v1`，为用户选择的来源
提供打开/图标能力。权威源是 `src-tauri/schemas/chat-web-source-v1.schema.json`（v1），
由本仓生成 `src/domain/web-source.generated.ts`。Producer 是 Desktop Native，consumer 是
同一客户端 Vue 页面；用户确认的变更范围即本次需求。公共 Contracts PR/pin 为 N/A：
Host 返回的 display URL 和已有 v1–v5 历史格式完全不变，仍不直接充当可执行授权。
Native 收到新请求后通过原有授权上下文及原生历史读取验证精确 session/turn/item/source
归属，再重新校验 URL，独立授予本次用户操作。未改写旧持久记录，不回填模型来源或图标。

兼容：旧客户端不调用新命令；新客户端必须在 Native 更新后启用完整功能。旧 Native
缺少命令时图标回退、点击显示可重试失败，不能伪装成功。回退不涉及数据库迁移。
本次更新通过固定开发入口增量编译并正常重启；不生成新安装包、不全量备份。

## 实现

- 复用原有 `webbrowser` hardened 依赖（登录/连接器已有机制）打开系统默认浏览器。
- 复用 Chat 授权上下文、离线原生历史读取、IPC 请求/响应及固定开发构建缓存。
- 原生图标读取复用 `reqwest`、`quick-xml`、`image`、`base64`；只为既有 image 开启 ICO
  解码 feature，无新增第三方库或 Tauri plugin，无 CSP 放宽。
- 图标按来源站点 origin 去重；最多 128 项内存缓存、一小时过期、4 个并发、12 秒总超时。
  先读站点 favicon.ico，再检查首页声明的 icon/apple-touch-icon。单资源 256KB，网页仅读取
  前 256KB；图片限制尺寸与解码内存，再转为最大 32px 的 PNG data URL，使用既有 CSP。
- 请求不携带 Cookie、授权头、Referer；每跳重新检查 HTTP(S)、公开 DNS/IP，固定解析地址，
  不走环境 HTTP 代理、不允许 HTTPS 降级。本机 TUN 的 198.18/15 Fake-IP 仅在
  主机名为公开域名且系统路由确认为 utun 接口时接纳；显式 IP 地址与普通局域网路由不适用。来源地址只在用户点击后交给浏览器，不在渲染时打开。
- 图标仅在列表展开时请求；同一记录重新折叠/展开不重复请求。无图标、不可解码或站点
  不可达时显示站点首字母；缓存不写入用户历史，不依赖第三方 favicon 聚合服务。
- 来源列表最大高度 150px（约五条），内容较少时自然收缩，超过后内部滚动，滚动条 3px。
  保留真实 `<a>` 语义，点击和 Enter 均调用原生打开；打开失败提供再次点击重试。
- 仅移除 partial 的“信息不完整，不代表执行失败”提示；不可用、权限与未完整结束说明仍保留。

## 验证

- 前端 64 项定向测试通过；原生 4 项正常测试通过（包括携程站点真实 ICO 获取、PNG 转换与缓存命中）。
- 初次杭州政府站点测试因本机 Fake-IP 校验未兼容而失败，已通过真实 utun 路由识别修正；
  该站点实际 HTTP 403 仍回退，未伪称其图标可用。改用用户参考图中可访问的携程站点完成真实联网验证。
- ESLint、vue-tsc、前端构建、生成物校验、cargo fmt、cargo clippy --all-targets -D warnings 通过。
- 真实组件浏览器预览：1180×760 亮暗主题，无横向溢出；18 条来源的 clientHeight 150、
  scrollHeight 484，3px 滚动条；键盘 End/Home 可独立滚动；底部 partial 提示消失。
- 预览图标来自原生正常联网测试生成的携程 PNG，其 naturalWidth 为 32；预览其余 example.org
  数据为普通演示数据并显示首字母回退，不冒充真实会话验收。点击预览超链实际打开 https://www.ctrip.com/。
- Native 打开路径复用现有 hardened webbrowser。开发原生窗口无法被当前界面工具控制，
  不把浏览器预览点击称为 Native 窗口端到端点击；命令归属校验、客户端参数和真实图标获取分别验证。
- 用户正常 ⌘Q 后，日志确认 normal app cleanup complete，专用容器正常停止；随后由固定桌面入口
  自动恢复原六个容器到 healthy。最终客户端 PID/启动结果见 `.local/development/web-source-activation.json`。

未执行整个仓库的故障/权限/攻击注入测试，原因是用户硬性禁止；本次只执行正常定向验证。
不宣称全仓 make test 通过。make lint 的既有生成物门禁问题未改动，相关前端检查和原生 Clippy
独立执行，固定入口仍运行其原有契约/来源检查。
