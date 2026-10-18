# WorkBuddy 本地专家展示资料（2026-10-16）

## 范围与来源

用户指定读取本机 `~/.workbuddy/plugins/cache/` 内已安装专家，并只实现易界卡片与详情 UI。以 `~/.workbuddy/plugins/installed_plugins.json` 登记的当前安装版本为准，再读取对应 `.codebuddy-plugin/plugin.json`。64 个已安装插件中有 10 个单专家；1 个 `software-company` 专家团按用户随后明确要求排除。普通 Skill、连接器、旧缓存版本、内置文档子代理不纳入。

`contract-impact = none`：新增独立 `ExpertShowcase` 展示类型和静态目录，不转换成可执行 `CatalogEntry`，不进入专家 store、绑定、准备/移除、召唤、模型或 Native 命令。现有易界真实专家保留原操作。新增卡片只打开资料弹窗，推荐问题是文本，卡片与弹窗明确标注展示。

运行时只读取打包的静态 TypeScript 和 10 张原始头像，不访问 WorkBuddy 安装目录，不读取或复制 agent 正文、SKILL、脚本、连接器配置、邮箱、凭据或用户会话，不请求远程图片。原始图像逐字复制，未修改。素材用于本次用户指定的本地界面展示，保留来源和开发者署名；本次未发布或上传。

## 字段选择

- 名称：`profession.zh`，无中文则现有英文；符合 WorkBuddy 卡片使用岗位名称的方式。
- 简介：`displayDescription.zh`；标签与参考问题分别来自 `tags[].zh` / `quickPrompts[].zh`。
- 版本、开发者：`version` / `author.name`。
- 头像：`avatar` 相对安装目录指向的实际本地文件。
- 分类：本地 categoryId 的中文展示映射；销售商务、内容创作、数据智能、金融投资。
- 源插件标识作为弹窗“本地标识”。不伪造市场 `ex_*` ID。

全部10份清单均没有使用量，UI不展示该项；跨境电商运营专家缺作者，不伪造开发者。截图中未安装的市场专家（包括高校创业导师备课易）不从截图臆造加入。

## 静态快照

安装清单 SHA-256：`41494cba1cb245d56d2de0483d0fa33a59e1ab798eac5847625f5a63c93003aa`。以下资源路径均相对 `~/.workbuddy/plugins/cache/experts/`。

| 专家 | 版本 | 原开发者 | 源目录 |
| --- | --- | --- | --- |
| 跨境电商服装人台换模特图专家 | 2.1.0 | Linkfox | `linkfox-expert-aigc-imagegen-mannequin-to-model/2.1.0` |
| 亚马逊1688找货源专家 | 2.2.0 | Linkfox | `linkfox-expert-1688-sourcing-expert/2.2.0` |
| 跨境电商爆款视频复刻专家 | 2.2.0 | Linkfox | `linkfox-expert-aigc-videogen-viral-replicate/2.2.0` |
| TikTok店铺运营专家 | 1.0.1 | 出海匠 | `chuhaijiang-tiktok-shop-operations-expert/1.0.1` |
| 小红书爆款笔记策划 | 1.0.0 | 智能体造物局 | `xiaohongshu-copywriter/1.0.0` |
| 漫剧编剧与分镜师 | 1.0.0 | AgentGrid | `agentgrid-comic-storyboard-director/1.0.0` |
| 数据报告可视化专家 | 1.0.0 | Tand | `report-viz-expert/1.0.0` |
| 跨境电商运营专家 | 1.2.2 | 未提供 | `cross-border-ecommerce-operations-expert/1.2.2` |
| NextB2B报价专家 | 1.0.5 | TradeBuddy (Zhaogang) | `tradebuddy-baojia/1.0.5` |
| 行业研究员 | 0.1.0 | Anthropic FSI | `market-researcher/0.1.0` |

| 专家标识 | plugin.json SHA-256 | 头像 SHA-256 |
| --- | --- | --- |
| `linkfox-expert-aigc-imagegen-mannequin-to-model` | `2271382bd0712d3209e5de6d8354b4d42dd783f99c03732b0a8a732c5589a87a` | `9a0f5bdcb08dc61568e88ac13a005f38da0cff6878de8858466bdec2d1ef6bd0` |
| `linkfox-expert-1688-sourcing-expert` | `e69f8adeda4886310dfa76df1aa7e8fe94913eb518d43cc4c3afa80cb3fecd0e` | `851ef519616c5757aee8495fade124f070755176662ea8204f75aa291bac7422` |
| `linkfox-expert-aigc-videogen-viral-replicate` | `dd926e5d82bfe742d304778e280861c1ccc93e2a39983e30e9dac67431c40e13` | `2b346e3057987601b8852f30dbe81e8f90ae170e2ce726b506fb438259319bd5` |
| `chuhaijiang-tiktok-shop-operations-expert` | `bd8ad009cea7f48332a40a054d1f9916afda25b97b5e363d091627bfdb5ac1a6` | `3f22afd6d640a044512e27af23aaae28e8b67546b897cef506f318ac62d9f14f` |
| `xiaohongshu-copywriter` | `77e423ce76750ed37a5e099eadd6c2b49cb92f933943079402b544e1630a1b5a` | `73722753e259957d472466dbab0d489a56d7b2549691a2fd342289fd0ce025a4` |
| `agentgrid-comic-storyboard-director` | `dfb00ad8066e77cd2b557f98f992cc3867081c87104c27214f65be1e2fb2ef7e` | `814abc3d23e6968a97022d4a6087189a15b4bbdc29ec53cd5018d927a54db3b5` |
| `report-viz-expert` | `73b2a822fee3bfb948d132630a7270cfc29b67824bba497af4bb65c0fedc1122` | `c4780d5f63b104793f672ce37e6bb752a106fbf52d21cd5d9477ff9f4bbfcd25` |
| `cross-border-ecommerce-operations-expert` | `e217740ce053c41629d8136a6ae9fdfff61a5b346f4334ec153cb54ba1b8468c` | `4ea48cfa7caac462a0097270372db4dcf4d832ddf9ea6a5ca454def0614ab8c8` |
| `tradebuddy-baojia` | `7e695cd6daa67f4dfd9fd09fbe0f395712cbab3bc3cd36721478ea1d188ee6b7` | `7791a6e3aed0f2feb110cdbc1f5571e9dca96d31d5054035ff5fa3c79912097b` |
| `market-researcher` | `61689f6347a26374477cd75c7c709a256fbde69bb46c6c072f6f576a12befc2c` | `1aac98a693e03d47cc69e28e18b21e9beb3bdf8c3a68a0f2158a1c15cf354733` |

## UI 与验证边界

三列网格沿用现有专家页面断点、16px圆角和主题 token。卡片使用真实48px图像、单行简介、最多3枚标签；详情保留完整描述与全部标签/参考问题，支持内部滚动、键盘关闭和焦点返回。静态目录在原生目录暂不可用时仍可读取，搜索对名字、简介、标签、作者和分类生效。

验证记录见本机 `.local/workbuddy-expert-ui-20261016/`：

- 44/44 定向回归（6个测试文件）通过，包括9项新增静态展示集成检查；新增测试已复查关闭/Esc、焦点归还、搜索、原生不可用与无执行副作用。初次TypeScript检查发现3处测试断言使用get().exists()类型不匹配，改为可见性断言后定向9项和vue-tsc复验通过。收尾修正详情关闭时NModal空slot告警，改为整体卸载展示弹窗；最终前端lint和全部44项复验通过，浏览器再次打开/Esc关闭后焦点正确返回，最终预览日志无该告警。
- `make lint`（生成检查、ESLint、vue-tsc、rustfmt、clippy）、`make build`、`pnpm docs:build`、`git diff --check`通过。
- Chrome实际1180×760：网格为284px三列，无横向溢出；10张头像全部加载，亮暗卡片/详情已检查。缺失作者与使用量不会出现在元信息项。
- 正常退出原App，经 `./scripts/run-local-demo-fast.sh --packaged` 标准构建并启动；实际Native窗口显示原有1位可执行专家+10位展示专家，未出现专家团。静态详情打开、Esc关闭及触发器焦点恢复、Linkfox搜索3项及清除恢复11项已验证。
- 10份显示字段与10张原头像逐项/逐SHA-256核对一致；实现后只读审查未发现静态数据流入执行目录、API、原生资源或模型调用。仅做UI验证，未新增模型turn、安装/移除资源或外部服务调用。

截图：`native-grid.png`、`native-detail.png`、`light-grid-1180.png`、`dark-grid-1180.png`、`dark-detail-1180.png`。未把纯UI验证等同专家业务可用。

未执行全仓 `make test`/历史原生故障测试：历史可执行文件、权限破坏、攻击性fixture与用户安全条款冲突，采用正常组件/路由/静态展示集成检查。影响：不宣称全仓测试覆盖或模型执行链路重新验收。
