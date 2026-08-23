import axeScriptUrl from "axe-core/axe.min.js?url";

declare global {
  interface Window {
    __YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__?: string;
    axe?: AxeRuntime;
  }
}

interface AxeRuntime {
  run(
    context: Document,
    options: Readonly<{ resultTypes: readonly ["violations"] }>,
  ): Promise<Readonly<{
    violations: readonly Readonly<{ impact: string | null }>[];
  }>>;
}

type AxeEngineMessage = Readonly<
  | { schemaVersion: 1; nonce: string; stage: "axe_import_resolved" }
  | { schemaVersion: 1; nonce: string; stage: "axe_import_rejected" }
  | { schemaVersion: 1; nonce: string; stage: "axe_run_resolved"; seriousCritical: number }
  | { schemaVersion: 1; nonce: string; stage: "axe_run_rejected" }
>;

function publish(result: AxeEngineMessage): void {
  window.postMessage(result, "*");
}

function cleanup(script: HTMLScriptElement, runtime?: AxeRuntime): void {
  script.remove();
  if (runtime !== undefined && window.axe === runtime) delete window.axe;
}

const nonce = window.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__;
delete window.__YIJIE_FEAT128_S10D_AXE_ENGINE_NONCE__;

if (typeof nonce === "string" && /^[0-9a-f]{32}$/.test(nonce)) {
  const script = document.createElement("script");
  script.src = axeScriptUrl;
  script.dataset.feat128S10dAxeLibrary = "true";
  script.addEventListener("error", () => {
    cleanup(script);
    publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_import_rejected" }));
  }, { once: true });
  script.addEventListener("load", () => {
    const axe = window.axe;
    if (axe === undefined || typeof axe.run !== "function") {
      cleanup(script, axe);
      publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_import_rejected" }));
      return;
    }
    publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_import_resolved" }));
    void axe.run(document, { resultTypes: ["violations"] }).then((result) => {
      const seriousCritical = result.violations.filter((item) =>
        item.impact === "serious" || item.impact === "critical"
      ).length;
      cleanup(script, axe);
      publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_run_resolved", seriousCritical }));
    }).catch(() => {
      cleanup(script, axe);
      publish(Object.freeze({ schemaVersion: 1, nonce, stage: "axe_run_rejected" }));
    });
  }, { once: true });
  document.head.append(script);
}
