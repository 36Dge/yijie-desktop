import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer, build } from 'vite'
import vue from '@vitejs/plugin-vue'

const proposal = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(proposal, '../../../..')
const config = {
  configFile: false,
  root: proposal,
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@src', replacement: path.join(repository, 'src') },
      { find: /^@tauri-apps\/api\/.+$/, replacement: path.join(proposal, 'preview/tauri-stub.ts') },
    ],
    dedupe: ['vue', 'pinia', 'naive-ui', 'vue-router'],
  },
  define: {
    'import.meta.env.VITE_YIJIE_ENV': JSON.stringify('local'),
    'import.meta.env.VITE_YIJIE_LOCAL_PROFILE': JSON.stringify('demo_fast'),
    'import.meta.env.VITE_YIJIE_CHAT_LOCAL_UI_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED': JSON.stringify('false'),
  },
  server: {
    host: '127.0.0.1',
    port: 1448,
    strictPort: true,
    fs: { allow: [repository] },
    watch: { ignored: ['**/.git/**', '**/.local/**', '**/src-tauri/**'] },
  },
  build: {
    outDir: path.join(repository, '.local/component-color-review/build'),
    emptyOutDir: true,
    target: 'esnext',
    rolldownOptions: { input: path.join(proposal, 'preview/index.html') },
  },
}

if (process.argv.includes('--build')) {
  await build(config)
} else {
  const server = await createServer(config)
  await server.listen()
  console.log('候选评审：http://127.0.0.1:1448/review.html')
  console.log('真实组件：http://127.0.0.1:1448/preview/index.html?page=atlas&theme=light&variant=candidate')
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    process.exitCode = 0
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
