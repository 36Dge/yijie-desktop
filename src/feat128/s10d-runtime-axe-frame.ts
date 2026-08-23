export {};

declare global {
  interface Window {
    __YIJIE_FEAT128_S10D_AXE_NONCE__?: string;
    __YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__?: string;
  }
}

type AxeFrameMessage = Readonly<
  | { schemaVersion: 1; nonce: string; stage: "axe_bootstrap_started" }
  | { schemaVersion: 1; nonce: string; stage: "axe_import_rejected" }
>;

function publish(result: AxeFrameMessage): void {
  window.postMessage(result, "*");
}

const nonce = window.__YIJIE_FEAT128_S10D_AXE_NONCE__;
delete window.__YIJIE_FEAT128_S10D_AXE_NONCE__;

if (typeof nonce === "string" && /^[0-9a-f]{32}$/.test(nonce)) {
  window.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__ = nonce;
  publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_bootstrap_started" }));
}
