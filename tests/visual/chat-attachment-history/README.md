# 历史图片切换验证

先用 `node tests/visual/chat-artifact-videos/generate-fixtures.mjs` 准备普通本地 PNG，
再从现有 Vite 打开 `/tests/visual/chat-attachment-history/index.html`。
独立验证可用 `pnpm exec vite --host 127.0.0.1 --port 1422`，用 `q + Enter` 正常退出。

页面使用真实 `ChatAttachmentImage` 和 `useChatAttachmentPresentation`，仅将原生客户端
替换为当前浏览器页内的普通本地图片读取；不会访问 Native、模型或日常历史数据库。

- 依次点击红、蓝、绿聊天，首次各等约一秒；在各自 30 秒有效期内反复返回，图片立即出现且读取计数不增长。
- 三张图片使用相同附件名与局部 ID，颜色必须与聊天匹配。
- 暂时隐藏再显示附件，仍在有效期内时不增加读取。
- 关闭读取权限后不展示旧图，恢复时重新读取；后台图片到期不主动读取。
- 显示中的图片约 25 秒后续读；这是原期限内的必要续期，不能当作切换重复读取。
- 检查亮/暗、悬停/键盘预览和最小窗口。此页不能替代原生 IPC 实机验收。
