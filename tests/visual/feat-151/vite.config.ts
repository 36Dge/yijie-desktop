import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    "import.meta.env.VITE_YIJIE_ENV": JSON.stringify("local"),
    "import.meta.env.VITE_YIJIE_LOCAL_PROFILE": JSON.stringify("demo_fast"),
    "import.meta.env.VITE_YIJIE_WORKFLOW_ENABLED": JSON.stringify("true"),
  },
  server: {
    strictPort: true,
  },
});
