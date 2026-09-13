import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");
const [launcher, helper, sidecar, nativeWindow, nativeRuntime, base, overlay, capability, packageJson] = await Promise.all([
  read("scripts/run-local-demo-fast.sh"), read("scripts/run-workflow-dev.mjs"),
  read("src-tauri/src/chat/sidecar.rs"), read("src-tauri/src/workflows/window.rs"),
  read("src-tauri/src/workflows/runtime.rs"), read("src-tauri/tauri.conf.json").then(JSON.parse),
  read("src-tauri/tauri.workflow-local.conf.json").then(JSON.parse),
  read("src-tauri/capabilities/default.json").then(JSON.parse), read("package.json").then(JSON.parse),
]);

describe("workflow Desktop normal foundation boundaries", () => {
  it("keeps the canonical main App and its existing window size", () => {
    expect(packageJson.scripts["tauri:dev"]).toBe("./scripts/run-local-demo-fast.sh");
    expect(packageJson.scripts["tauri:demo-fast:app"]).toBe("./scripts/run-local-demo-fast.sh --packaged");
    expect(overlay.productName).toBeUndefined();
    expect(overlay.identifier).toBeUndefined();
    expect(overlay.app.windows).toHaveLength(1);
    expect(overlay.app.windows[0]).toEqual({ ...base.app.windows[0], label: "main", create: false });
    expect(nativeWindow).toContain("WebviewWindowBuilder::from_config(app, config)");
  });

  it("adds only the exact iframe CSP and does not grant remote native capabilities", () => {
    expect(overlay.app.security).toEqual({ csp: { "frame-src": "http://127.0.0.1:18888" } });
    expect(capability.remote).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
    expect(base.app.security.csp["img-src"]).toContain("yijie-artifact-preview:");
    expect(base.app.security.csp["media-src"]).toContain("yijie-artifact-video:");
    expect(nativeWindow).toContain("NewWindowResponse::Deny");
    expect(nativeWindow).toContain('url.path() == "/editor/"');
    expect(nativeWindow).toContain("window.url()");
  });

  it("passes only the owner-only FILE path, never a browser credential", () => {
    expect(launcher).toContain('workflow_environment=(YIJIE_WORKFLOW_ENABLED=true "YIJIE_WORKFLOW_CREDENTIAL_FILE=$workflow_credential_file")');
    expect(launcher).toContain('export VITE_YIJIE_WORKFLOW_ENABLED="$workflow_requested"');
    expect(launcher.indexOf('export VITE_YIJIE_WORKFLOW_ENABLED=')).toBeLessThan(launcher.indexOf('pnpm tauri:build:demo-fast '));
    expect(helper).toContain('process.env.VITE_YIJIE_WORKFLOW_ENABLED = "true";');
    expect(launcher).toContain("stat -f '%u:%Lp:%l:%z'");
    expect(launcher).toContain('"$workflow_file_mode" == "400"');
    expect(launcher).toContain('"$workflow_file_size" -le 1024');
    expect(launcher).not.toMatch(/(?:cat|readFile).*workflow_credential_file/);
    expect(helper.indexOf("delete process.env[key]")).toBeLessThan(helper.indexOf('await import("vite")'));
    expect(helper).not.toContain("readFile(");
    expect(sidecar).toContain(".env_clear()");
    const childEnvironment = sidecar.slice(sidecar.indexOf("    fn environment("), sidecar.indexOf("    fn validate_provider_key_file("));
    expect(childEnvironment).not.toContain("YIJIE_WORKFLOW_");
  });

  it("uses normal Vite close without a Tauri beforeDev child or watcher", () => {
    expect(overlay.build.beforeDevCommand).toBe("");
    expect(helper).toContain("await createServer(");
    expect(helper).toContain("await server.close()");
    expect(helper).toContain('"--no-watch"');
    expect(helper).toContain("detached: true, shell: false");
    expect(helper).toContain('process.on("SIGINT", pending)');
    expect(helper).toContain('process.on("SIGTERM", pending)');
    expect(helper).not.toMatch(/\.kill\(|\.terminate\(|execSync\(|shell:\s*true/);
    expect(launcher).toContain("launch_command=(node scripts/run-workflow-dev.mjs)");
    expect(launcher).toContain('pnpm tauri:build:demo-fast "${workflow_tauri_config');
  });

  it("disables forceful Host cleanup only on the approved exact workflow path", () => {
    const cleanup = sidecar.slice(sidecar.indexOf("    fn forceful_child_cleanup_enabled("), sidecar.indexOf("fn feat136_exact_local_enabled("));
    expect(cleanup).toContain("if crate::workflows::exact_local_enabled()");
    expect(cleanup.indexOf("return false;")).toBeLessThan(cleanup.indexOf("!self.minimax_provider_enabled || self.image_generation_enabled"));
    expect(sidecar).toContain(".kill_on_drop(config.forceful_child_cleanup_enabled())");
  });

  it("marks window context synchronously and keeps late cleanup off a new binding", () => {
    expect(nativeRuntime).toContain("pub(crate) fn invalidate_from_window_event");
    expect(nativeRuntime).toContain("editor.context_revision <= invalidated");
    expect(nativeRuntime).toContain("editor.context_revision != self.context_revision.load(Ordering::Acquire)");
    expect(nativeRuntime).toContain("editor.context_revision == self.context_revision.load(Ordering::Acquire)");
  });
});
