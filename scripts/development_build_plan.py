"""Component build inputs for the fixed local client; no executable operations.

Vite always serves current frontend files. Native, external resources and each
sidecar keep separate input identities. Rust include_str/include_bytes edges
are supplied by the source scanner, including embedded resource authorities.
"""
import hashlib
import json
from pathlib import PurePosixPath

VERSION = 2
COMPILED = ("native", "helper", "host", "worker", "media")
GROUPS = ("frontend", *COMPILED, "resources", "checks")
RESOURCE_PINS = {
    "contracts/desktop-skill-bundle-local.lock.json",
    "contracts/experts-assets-feat164.candidate.json",
    "contracts/native-skill-resources.candidate.json",
}
CONTROL = {
    "scripts/development_build_plan.py", "scripts/development_preflight.py",
    "scripts/development-client.py", "scripts/run-local-demo-fast.sh",
    "scripts/feat162_build_cache.py", "scripts/feat164_primary.py",
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def groups_for(file, embedded):
    repository, relative = file.split("/", 1)
    result = {group for group, names in embedded.items() if file in names}
    if "native" in result:
        result.add("helper")  # The helper links the same Desktop library.
    path = PurePosixPath(relative)
    name = path.name
    if name.endswith(("_test.go", ".test.ts", ".test.mjs", ".spec.ts")) or relative.startswith(("scripts/tests/", "tests/", "docs/")):
        return result or {"checks"}
    if repository == "yijie-desktop":
        if relative in CONTROL:
            result.update((*COMPILED, "resources"))
        elif relative.startswith(("src/", "public/")) or relative in {"index.html", "vite.config.ts", "tsconfig.json", "tsconfig.node.json"}:
            result.add("frontend")
        elif relative.startswith("src-tauri/resources/"):
            result.add("resources")
        elif relative.startswith("src-tauri/"):
            result.update(("native", "helper"))
        elif relative in RESOURCE_PINS:
            result.add("resources")
        elif relative in {"scripts/run-workflow-dev.mjs", "scripts/development-app-runner.mjs"}:
            result.update(("native", "helper", "resources"))
        elif relative == "scripts/development-resources.mjs":
            result.add("resources")
        elif relative in {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"} or relative.startswith(".cargo/"):
            result.update(("frontend", "native", "helper", "resources"))
        elif relative.startswith("contracts/") or name.startswith(("check-", "sync-", "generate-")):
            result.add("checks")
        elif relative.startswith("scripts/") and not name.startswith(("test-", "run-test")):
            # A new build/launch script must not silently reuse unknown inputs.
            result.update((*COMPILED, "resources"))
    elif repository == "yijie-agent-host":
        if relative.startswith("artifact-mcp/") or relative in {"scripts/build-artifact-adapter.sh", "scripts/artifact_build_output.py"}:
            result.add("media")
        elif relative.startswith(("cmd/", "internal/")) or name.endswith(".go") or relative in {"go.mod", "go.sum"}:
            result.add("host")
        elif relative.startswith(".cargo/"):
            result.add("media")
    elif repository == "yijie-connectors":
        if relative in {"worker/source.lock.json", "worker/schema-validation.lock.json"}:
            result.add("checks")
        elif relative.startswith(("worker/", ".cargo/")) or name.endswith(".rs") or relative in {"scripts/build-market-worker.sh", "scripts/worker_build_output.py"}:
            result.add("worker")
    elif repository == "yijie-codex" and (relative.startswith(("codex-rs/", ".cargo/")) or relative == "rust-toolchain.toml"):
        result.add("worker")
    return result or {"checks"}


def toolchain_inputs(cache, component):
    if not isinstance(cache, dict):
        return {"legacy_cache": cache}
    identity = cache["identity"]
    if component == "host":
        return {"go": identity["host_go"], "tool": identity["tools"]["go"], "target": identity["target"], "flags": identity["flags"]}
    if component in {"frontend", "checks"}:
        return {}
    repository = {"native": "yijie-desktop", "helper": "yijie-desktop", "resources": "yijie-desktop", "worker": "yijie-connectors", "media": "yijie-agent-host"}[component]
    return {
        "cargo": identity["cargo"], "rustc": identity["rustc"], "sdk": identity["sdk"],
        "target": identity["target"], "environment": identity["environment"], "flags": identity["flags"],
        "profile": identity["profile"], "features": identity["features"][{"native": "desktop", "helper": "desktop", "resources": "desktop", "worker": "worker", "media": "artifact"}[component]],
        "tools": {key: identity["tools"][key] for key in ("cargo", "rustc")},
        "config": {key: value for key, value in identity["inputs"].items() if key.startswith(repository + "/") or key.startswith("/")},
    }


def fingerprints(sources, cache):
    members = {group: {} for group in GROUPS}
    embedded = sources.get("embedded", {})
    for file, value in sources["files"].items():
        for group in groups_for(file, embedded):
            # Resource content identity is independent of source commit labels.
            if group == "resources" and file.split("/", 1)[1] in RESOURCE_PINS:
                continue
            members[group][file] = value
    members["resources"]["@resource-content"] = sources.get("resources", {})
    return {group: digest({"version": VERSION, "files": files, "tools": toolchain_inputs(cache, group),
                           "profile": sources["profile"] if group in {"native", "helper", "resources"} else {}})
            for group, files in members.items()}


def plan(current, previous, actual):
    old = previous.get("component_inputs", {}) if previous.get("plan_version") == VERSION else {}
    changed = {group: old.get(group) != value for group, value in current.items()}
    expected = previous.get("artifacts", {})
    artifact = {"native": "desktop", "helper": "helper", "host": "host", "worker": "worker", "media": "media"}
    actions = {}
    for group, key in artifact.items():
        reusable = not changed[group] and bool(actual.get(key)) and actual.get(key) == expected.get(key)
        actions[group] = "reuse" if reusable else "build"
    actions["resources"] = "bundle" if changed["resources"] or actions["native"] == "build" or actions["helper"] == "build" else "verify"
    actions["frontend"] = "live"  # Current Vite sources, never a native build trigger.
    return {"version": VERSION, "actions": actions, "changed": changed}
