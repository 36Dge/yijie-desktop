# Local Development

```bash
pnpm install
pnpm dev
```

Tauri 开发：

```bash
pnpm tauri:dev
```

FEAT-125 本地白名单登录默认关闭。只在 loopback synthetic 服务配置下，同时设置以下值后，
Settings 才显示空白账号/密码表单，Rust runtime 才接受请求：

```bash
VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED=true
VITE_YIJIE_ENV=local
YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED=true
YIJIE_ENV=local
YIJIE_DESKTOP_AUTH_ENVIRONMENT=local-integration
YIJIE_DESKTOP_LOCAL_WHITELIST_IDP_SECRETS_PATH=/absolute/path/to/ignored/feat-125.secrets.env
```

secret 文件必须属于当前用户、权限为 `0400` 或 `0600`、不是 symlink，并包含精确的
FEAT-125 local secret inventory。账号和密码每次手工输入，不写入 `.env`、源码、测试或日志。
`VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED` 是前端表单的显示门，
`YIJIE_DESKTOP_LOCAL_WHITELIST_LOGIN_ENABLED` 是 native command 的运行时门；前者关闭时表单不进入 UI，
后者关闭或配置不完整时 command fail closed。系统浏览器登录入口始终保留，关闭本地表单不会改变既有登录路径。

构建检查：

```bash
pnpm lint
pnpm build
```
