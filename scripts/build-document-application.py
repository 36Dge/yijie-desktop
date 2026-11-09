#!/usr/bin/env python3
"""Canonical full local FEAT-171 app candidate. No signing, install or launch.

Build tools run here only. The resulting app carries Host, Runtime, adapter and
the complete document bundle and starts without a repository or Docker.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, cwd, env):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def main():
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        raise ValueError("macOS arm64 required")
    build_app = ROOT / ".local/document-application-target/release/bundle/macos/易界 AI.app"
    active = subprocess.check_output(["/bin/ps", "-axo", "comm="], text=True).splitlines()
    if any(str(build_app) in line for line in active):
        raise ValueError("Close the owned build candidate normally before rebuilding")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("YIJIE_", "VITE_", "TAURI_"))}
    go_root = subprocess.check_output(["go", "env", "GOROOT"], cwd=ROOT.parent / "yijie-agent-host", env=env, text=True).strip()
    env["PATH"] = str(Path(go_root) / "bin") + os.pathsep + env["PATH"]
    env["GOTOOLCHAIN"] = "local"
    env.update(CARGO_NET_OFFLINE="true", GOPROXY="off", GOSUMDB="off", MACOSX_DEPLOYMENT_TARGET="14.0")
    run(["node", "scripts/document-build-candidate.mjs", "--freeze"], ROOT, env)
    document = json.loads((ROOT / ".local/document-bundles/current.json").read_text())
    bundle = Path(document["bundle_root"])
    if sha(bundle / "manifest.json") != document["manifest_sha256"]:
        raise ValueError("document manifest changed")
    for folder in ["helper", "guides"]:
        for file in (ROOT / "document-runtime" / folder).iterdir():
            if file.is_file() and sha(file) != sha(bundle / folder / file.name):
                raise ValueError("Document source changed; run the canonical document assemble first")
    runtime_lock = json.loads((ROOT / "contracts/runtime-documents.candidate.json").read_text())
    runtime = ROOT.parent / "yijie-codex" / runtime_lock["runtime_relative_path"]
    names = subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "--", "src", "src-tauri", "public", "package.json", "pnpm-lock.yaml", "vite.config.ts", "scripts/build-document-application.py", "scripts/build-document-runtime.py", "scripts/document-build-candidate.mjs", "document-runtime", "contracts/document-build.candidate.json"], cwd=ROOT, text=True).splitlines()
    source = {name: sha(ROOT / name) for name in sorted(set(names)) if (ROOT / name).is_file()}
    toolchain = {name: subprocess.check_output(command, env=env, text=True).strip() for name, command in {
        "go": ["go", "version"], "rust": ["rustc", "--version"], "node": ["node", "--version"], "pnpm": ["pnpm", "--version"], "macos_sdk": ["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-version"]}.items()}
    identity = hashlib.sha256(json.dumps([source, document["manifest_sha256"], runtime_lock, toolchain], sort_keys=True).encode()).hexdigest()
    work = ROOT / ".local/document-application" / identity
    resources = work / "resources"
    resources.mkdir(parents=True, exist_ok=True)
    binaries = resources / "bin"
    binaries.mkdir(exist_ok=True)
    host = ROOT.parent / "yijie-agent-host"
    run(["go", "build", "-trimpath", "-o", str(binaries / "yijie-agent-host"), "./cmd/desktop-host"], host, env)
    run(["bash", "scripts/build-artifact-adapter.sh", str(binaries)], host, env)
    managed_runtime = resources / "runtime"
    managed_runtime.mkdir(exist_ok=True)
    for name in ["codex", "runtime-manifest.json"]:
        dest = managed_runtime / name
        if dest.exists() and sha(dest) != sha(runtime / name):
            raise ValueError("existing candidate Runtime conflict")
        if not dest.exists():
            shutil.copy2(runtime / name, dest)
    if not (resources / "documents").exists():
        shutil.copytree(bundle, resources / "documents", symlinks=True)
    package = dict(schema_version=1, release=False, document_bundle="documents", document_manifest_sha256=document["manifest_sha256"], files=[
        dict(path=name, sha256=sha(resources / name)) for name in ["bin/yijie-agent-host", "bin/yijie-artifact-mcp", "bin/yijie-artifact-mcp.sha256", "runtime/codex", "runtime/runtime-manifest.json"]])
    (resources / "application.json").write_text(json.dumps(package, indent=2) + "\n")
    config = work / "tauri.document-candidate.json"
    config.write_text(json.dumps({"bundle": {"resources": {str(resources): "document-application"}, "targets": ["app"], "macOS": {"minimumSystemVersion": "14.0"}}}, indent=2) + "\n")
    env.update(YIJIE_FEAT171_PACKAGE_MANIFEST_SHA256=sha(resources / "application.json"), CARGO_TARGET_DIR=str(ROOT / ".local/document-application-target"))
    for key, value in {
        "ENV": "local", "LOCAL_PROFILE": "demo_fast", "CHAT_LOCAL_UI_ENABLED": "true", "AUTHORITATIVE_PERMISSION_UI_ENABLED": "true",
        "LOCAL_WHITELIST_LOGIN_ENABLED": "false", "CHAT_MODELS_ENABLED": "true", "KIMI_K31_PRO_CANDIDATE": "true",
        "RUNTIME_PERMISSIONS_ENABLED": "true", "INTERACTION_TOOLS": "true", "ARTIFACT_MEDIA_ENABLED": "true",
        "EXPERTS_ENABLED": "false", "MARKET_CONNECTORS_ENABLED": "false", "WORKFLOW_LOCAL_ENABLED": "false",
    }.items():
        env["VITE_YIJIE_" + key] = value
    # Explicit local candidate entry: do not run the release/market resource
    # wrapper. Tauri still owns the actual build and app resource collection.
    run(["pnpm", "exec", "tauri", "build", "--no-sign", "--bundles", "app", "--features", "kimi-k31-pro-candidate", "--config", str(config)], ROOT, env)
    # Tauri's generic resource walker dereferences file links and omits directory
    # links inside nested frameworks. Preserve the audited resource tree in this
    # fresh unsigned, project-owned build output. No executable bytes are edited.
    resource_output = build_app / "Contents/Resources/document-application"
    if build_app.is_symlink() or resource_output.is_symlink() or not resource_output.is_dir():
        raise ValueError("Unexpected Tauri resource output")
    shutil.rmtree(resource_output)
    shutil.copytree(resources, resource_output, symlinks=True)
    verify_env = {**env, "YIJIE_DOCUMENT_TEST_BUNDLE": str(resource_output / "documents")}
    run(["go", "test", "./internal/documents", "-run", "^TestDocumentEnvironmentRealBundle$", "-count=1"], host, verify_env)
    app = work / "app/易界 AI.app"
    if app.exists():
        if sha(app / "Contents/MacOS/yijie-desktop") != sha(build_app / "Contents/MacOS/yijie-desktop"):
            raise ValueError("Retained candidate differs; do not overwrite it")
    else:
        app.parent.mkdir(exist_ok=True)
        shutil.copytree(build_app, app, symlinks=True)
    if any(sha(ROOT / name) != value for name, value in source.items()):
        raise ValueError("Sources changed during build; retain outputs for diagnosis and build a new candidate")
    size = sum(p.stat().st_size for p in app.rglob("*") if p.is_file() and not p.is_symlink())
    if size > 6 * 1024**3:
        raise ValueError("application exceeds expanded budget")
    receipt = dict(schema_version=1, release=False, source_id=identity, app=str(app), expanded_bytes=size, sources=source,
                   document_bundle_id=document["bundle_id"], toolchain=toolchain, application_manifest_sha256=sha(resources / "application.json"))
    (work / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (ROOT / ".local/document-application/current.json").write_text(json.dumps({"source_id": identity, "receipt": str(work / "build-receipt.json"), "app": str(app)}, indent=2) + "\n")
    print("Full local candidate built; not installed, launched, signed or released: " + str(app))


if __name__ == "__main__":
    main()
