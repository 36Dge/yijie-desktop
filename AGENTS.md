# AGENTS.md

## 仓库职责

`yijie-desktop` 是易界 AI 面向卖家的 Mac 桌面端，负责登录、店铺授权引导、Chat、Agent 任务进度、工具调用审批、结果展示、本地 sidecar 管理和 Mac App 发布。

## 禁止事项

- 不实现 Admin 管理后台；
- 不直接处理平台 access token；
- 不实现连接器 API 调用；
- 不维护 Codex Runtime 源码；
- 不绕过审批策略执行高风险操作。

## 技术栈

Tauri v2、Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI、pnpm、Rust。

## 开发命令

```bash
pnpm install
pnpm dev
pnpm tauri:dev
pnpm build
```

## 安全要求

本地敏感信息必须使用系统 Keychain 或后续安全存储方案。平台 token 不得持久化在前端存储中。
