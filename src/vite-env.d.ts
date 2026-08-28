/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEAT126_S10_DRIVER?: string;
  readonly VITE_FEAT126_S10_R8?: string;
  readonly VITE_YIJIE_AUTHORITATIVE_PERMISSION_UI_ENABLED?: string;
  readonly VITE_YIJIE_ENV?: string;
  readonly VITE_YIJIE_LOCAL_WHITELIST_LOGIN_ENABLED?: string;
  readonly VITE_YIJIE_LOCAL_PROFILE?: string;
  readonly VITE_YIJIE_CHAT_LOCAL_UI_ENABLED?: string;
  readonly VITE_YIJIE_LEGACY_CHAT_TIMELINE_ROLLBACK_ENABLED?: string;
  readonly VITE_YIJIE_SKILL_MARKETPLACE_UI_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
