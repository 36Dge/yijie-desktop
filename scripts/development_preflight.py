"""Local startup freshness, using canonical generators and the existing build owner.

No model dispatch, database access, source checkout, executable substitution or
release qualification. The caller holds the fixed development build lock.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import uuid
import development_build_plan as build_plan


INPUTS = {
    "yijie-desktop": ["src", "public", "index.html", "src-tauri", "scripts", "contracts", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json", "tsconfig.node.json"],
    "yijie-agent-host": ["cmd", "internal", "api", "go.mod", "go.sum", "artifact-mcp", "scripts"],
    "yijie-connectors": ["cmd", "internal", "api", "worker", "catalog", "scripts", "go.mod", "go.sum"],
    "yijie-codex": ["codex-rs", ".yijie", "scripts"],
    "yijie-contracts": ["compatibility", "jsonschema", "openapi", "protobuf", "asyncapi", "sdks", "scripts", "package.json", "pnpm-lock.yaml", "go.mod", "go.sum"],
    "yijie-skills": ["plugins", "marketplace", "scripts", "package.json", "pnpm-lock.yaml"],
    "yijie-api": ["cmd", "internal", "api", "config", "migrations", "go.mod", "go.sum", "Dockerfile.workflow-local"],
    "yijie-coze": ["backend", "frontend", "docker/workflow-local", "scripts/yijie", ".dockerignore"],
    "yijie-infra": ["scripts", "compose", "config/workflow-local"],
}
PROFILE = {
    "YIJIE_FEAT169_INTERACTION_TOOLS": "true", "YIJIE_FEAT170_TOOL_SEARCH": "true",
    "YIJIE_FEAT174_NATIVE_SKILLS": "true", "YIJIE_FEAT171_DOCUMENT_RUNTIME": "false",
    "YIJIE_FEAT173_VIDEO_MCP": "true",
    "YIJIE_MARKET_LOCAL_ACCEPTANCE": "",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def sha(file):
    require(file.is_file() and not file.is_symlink(), "构建输入必须是普通文件：" + str(file))
    return hashlib.sha256(file.read_bytes()).hexdigest()


def source_hash(file, repository, include_link=True):
    if not file.is_symlink():
        return sha(file)
    resolved = file.resolve(strict=True)
    require(resolved.is_relative_to(repository) and resolved.is_file(), "源码链接需要检查：" + str(file))
    content = sha(resolved)
    return digest({"link": os.readlink(file), "content": content}) if include_link else content


def state_file(root, name="startup-check.json"):
    return root / ".local/development" / name


def write_state(root, value, name="startup-check.json"):
    target = state_file(root, name)
    require(not target.is_symlink(), "启动检查记录路径不可用。")
    temporary = target.with_name(target.name + "." + str(os.getpid()) + ".tmp")
    with temporary.open("x") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")
    temporary.replace(target)
    if name == "startup-check.json":
        write_state(root, {key: value[key] for key in ("schema_version", "run_id", "phase", "message") if key in value}, "startup-status.json")


def snapshot(root, environment):
    files = {}
    for repository, inputs in INPUTS.items():
        folder = root.parent / repository
        paths = subprocess.check_output(["git", "-C", str(folder), "ls-files", "-co", "--exclude-standard", "-z", "--", *inputs, ".cargo", "rust-toolchain.toml", "pnpm-workspace.yaml"]).decode().split("\0")
        for relative in sorted(set(filter(None, paths))):
            file = folder / relative
            files[repository + "/" + relative] = source_hash(file, folder) if file.exists() or file.is_symlink() else None
    profile = {name: environment.get(name, default) for name, default in PROFILE.items()}
    embedded = {}
    for component, repository, directory in [("native", "yijie-desktop", "src-tauri/src"), ("media", "yijie-agent-host", "artifact-mcp/src"), ("worker", "yijie-connectors", "worker/src")]:
        edges = set()
        for name in list(files):
            if not name.startswith(repository + "/" + directory + "/") or not name.endswith(".rs") or files[name] is None:
                continue
            source = root.parent / name
            text = source.read_text()
            include = r'include(?:_str|_bytes)?!\s*\(\s*'
            literals = re.findall(include + r'"([^"]+)"', text)
            # Cargo expands this exact expression to a path under the crate manifest directory.
            manifest_paths = re.findall(include + r'concat!\s*\(\s*env!\s*\(\s*"CARGO_MANIFEST_DIR"\s*\)\s*,\s*"/([^"]+)"\s*,?\s*\)\s*\)', text)
            require(len(literals) + len(manifest_paths) == len(re.findall(include, text)), "动态 Rust 嵌入依赖需要先登记到构建规则：" + name)
            literals += re.findall(r'#\[\s*path\s*=\s*"([^"]+)"\s*\]', text)
            crate_root = root.parent / repository / Path(directory).parent
            targets = [source.parent / relative for relative in literals]
            targets.extend(crate_root / relative for relative in manifest_paths)
            for target in targets:
                target = target.resolve(strict=True)
                require(target.is_relative_to(root.parent), "嵌入依赖超出当前工作区。")
                key = str(target.relative_to(root.parent))
                edges.add(key)
                files[key] = source_hash(target, root.parent)
        embedded[component] = sorted(edges)
    go_edges = set()
    for name in list(files):
        if not name.startswith("yijie-agent-host/") or not name.endswith(".go") or name.endswith("_test.go") or files[name] is None:
            continue
        source = root.parent / name
        for declaration in re.findall(r'^\s*//go:embed\s+(.+)$', source.read_text(), re.M):
            for pattern in shlex.split(declaration):
                include_hidden = pattern.startswith("all:")
                pattern = pattern.removeprefix("all:")
                require(not pattern.startswith("/") and ".." not in Path(pattern).parts and "`" not in pattern, "Go 嵌入路径需要登记：" + name)
                matches = list(source.parent.glob(pattern))
                require(matches, "Go 嵌入资源缺失：" + name)
                for match in matches:
                    for target in (match.rglob("*") if match.is_dir() else [match]):
                        if not target.is_file():
                            continue
                        if not include_hidden and any(part.startswith((".", "_")) for part in target.relative_to(source.parent).parts):
                            continue
                        require(target.resolve().is_relative_to(root.parent), "Go 嵌入资源超出当前工作区。")
                        key = str(target.relative_to(root.parent))
                        files[key] = source_hash(target, root.parent)
                        go_edges.add(key)
    embedded["host"] = sorted(go_edges)
    resources = {}
    for relative in build_plan.RESOURCE_PINS:
        if "yijie-desktop/" + relative not in files:
            continue
        pin = json.loads((root / relative).read_text())
        if "channels" in pin:
            resources[relative] = pin["channels"]["local-development"]["manifest_sha256"]
        elif "files" in pin:
            resources[relative] = pin["files"]
        else:
            resources[relative] = {key: pin[key] for key in ("manifest_sha256", "authority_sha256")}
    return {"files": files, "profile": profile, "embedded": embedded, "resources": resources}


def require_unchanged(before, after):
    require(before == after, "编译期间源码发生变化，已停止打开旧产物；请重新点击易界。")


def run(root, environment, repository, *command):
    subprocess.run(command, cwd=root.parent / repository, env=environment, check=True, start_new_session=True)


def git(folder, *arguments):
    return subprocess.check_output(["git", "-C", str(folder), *arguments])


def repository_hashes(folder):
    names = git(folder, "ls-files", "-co", "--exclude-standard", "-z").decode().split("\0")
    return {name: bytes.fromhex(source_hash(folder / name, folder, include_link=False)) for name in set(filter(None, names)) if (folder / name).is_file()}


def candidate_digest(files):
    value = hashlib.sha256()
    for name, content in sorted(files.items()):
        value.update(name.encode() + b"\0" + content)
    return value.hexdigest()


def recorded_revision(folder, hashes, expected):
    # Compare the immutable tree to the recorded complete candidate, including
    # worktree edits and untracked files. Read changed blobs in one Git batch.
    extra = set(git(folder, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0"))
    tracked = {name: value for name, value in hashes.items() if name not in extra}
    for candidate in git(folder, "log", "-32", "--format=%H").decode().splitlines():
        old = tracked.copy()
        changed = [name for name in git(folder, "diff", "--no-renames", "--name-only", "-z", candidate, "--").decode().split("\0") if name]
        if changed:
            batch = subprocess.check_output(["git", "-C", str(folder), "cat-file", "--batch", "-z"],
                input=b"".join((candidate + ":" + name).encode() + b"\0" for name in changed))
            offset = 0
            for name in changed:
                end = batch.index(b"\n", offset)
                header = batch[offset:end]
                offset = end + 1
                if header.endswith(b" missing"):
                    old.pop(name, None)
                    continue
                _, kind, length = header.split()
                if kind != b"blob":
                    break
                size = int(length)
                old[name] = hashlib.sha256(batch[offset:offset + size]).digest()
                offset += size + 1
            else:
                if candidate_digest(old) == expected:
                    return candidate
        elif candidate_digest(old) == expected:
            return candidate
    return None


def workflow_api_inputs(folder):
    recipe = "Dockerfile.workflow-local"
    inputs = [recipe, ".dockerignore", recipe + ".dockerignore"]
    # Local compiler sources only enter this immutable recipe through literal
    # COPY instructions. Unsupported context access requires a canonical rebuild.
    for raw in (folder / recipe).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = shlex.split(line)
        directive = tokens[0].upper()
        require(directive not in {"ADD", "ONBUILD", "INCLUDE"} and not line.endswith(chr(92)) and
                not (directive == "RUN" and any(t.startswith("--mount") for t in tokens)),
                "工作流镜像包含新的构建上下文输入，需要标准构建。")
        if directive == "COPY" and not tokens[1].startswith("--from="):
            paths = tokens[1:-1]
            require(paths and all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", name) and
                                  ".." not in Path(name).parts for name in paths), "工作流镜像输入需要标准构建。")
            inputs.extend(paths)
    return inputs


def workflow_sources_current(root):
    # The daily session deliberately reuses existing containers and never runs
    # migrations. Check their actual source identity too, including the editor,
    # so a healthy old service cannot silently satisfy a newer-code startup.
    state = json.loads((root.parent / "yijie-infra/environments/local/generated/feat-153/state.json").read_text())
    proof = []
    for name, repository in [("api", "yijie-api"), ("coze", "yijie-coze")]:
        folder = root.parent / repository
        built = state["built"][name]
        hashes = repository_hashes(folder)
        current = candidate_digest(hashes)
        revision = None
        if current != built["source_digest"]:
            revision = recorded_revision(folder, hashes, built["source_digest"])
            require(revision is not None, "工作流镜像来源需要核对；未启动旧版本，请先完成标准工作流构建。")
            inputs = workflow_api_inputs(folder) if name == "api" else INPUTS[repository]
            changed = git(folder, "diff", "--name-only", revision, "--", *inputs).decode().splitlines()
            untracked = git(folder, "ls-files", "--others", "--exclude-standard", "--", *inputs).decode().splitlines()
            require(not changed and not untracked, "工作流代码尚未进入固定镜像；请先完成标准工作流构建及数据兼容检查。")
        proof.append({"repository": repository, "image_id": built["image_id"], "source_digest": built["source_digest"], "equivalent_source_commit": revision, "code_current": True})
    editor = state["editor"]
    coze = root.parent / "yijie-coze"
    changed = git(coze, "diff", "--name-only", editor["source_commit"], "--", "frontend", "scripts/yijie").decode().splitlines()
    require(not changed, "工作流编辑器存在未打包更新，请先完成其标准构建。")
    print("DAILY PREFLIGHT: workflow images and editor contain current code", flush=True)
    return proof


def refresh_sources(root, environment):
    run(root, environment, "yijie-contracts", "node", "scripts/sync-market-local-acceptance.mjs", "--check")
    # These modes compare every generated output first and may change ONLY source
    # identity metadata. Actual Runtime/source/schema drift cannot be relabelled.
    families = ["runtime-kimi-k31-pro", "runtime-native-tools"]
    if environment.get("YIJIE_FEAT169_INTERACTION_TOOLS") == "true":
        families += ["runtime-interaction-tools", "user-input", "runtime-tool-search"]
    if environment.get("YIJIE_FEAT171_DOCUMENT_RUNTIME") == "true":
        families += ["runtime-documents"]
    if environment.get("YIJIE_FEAT174_NATIVE_SKILLS") == "true":
        families += ["runtime-skill-marketplace"]
    for family in families:
        run(root, environment, "yijie-contracts", "node", "scripts/generate-" + family + ".mjs", "--refresh-provenance")
    run(root, environment, "yijie-connectors", "python3", "-B", "scripts/check-worker-source.py", "--record-equivalent-wrapper")
    # The user has authorized compiling the current local Host sources on startup.
    # The existing freezer validates canonical contracts/resources first; its
    # release=false snapshot is build provenance, never a test/review approval.
    if environment.get("YIJIE_FEAT174_NATIVE_SKILLS") == "true":
        run(root, environment, "yijie-desktop", "node", "scripts/native-skill-build-candidate.mjs", "--freeze")


def artifact_inventory(root):
    files = {
        "desktop": root / ".local/development/target/debug/yijie-desktop",
        "helper": root / ".local/development/target/debug/yijie-document-render",
        "host": root / ".local/development/bin/yijie-agent-host",
        "media": root / ".local/development/bin/yijie-artifact-mcp",
    }
    manifest = root.parent / "yijie-connectors/bin/market-worker/current.json"
    if manifest.is_file():
        value = json.loads(manifest.read_text())
        worker = Path(value["binary"])
        require(worker.resolve().is_relative_to(root.parent / "yijie-connectors/bin/market-worker"), "连接器构建来源不一致。")
        files["worker"] = worker
    return {key: sha(file) if file.exists() else None for key, file in files.items()}


def prepare(root, environment, cache):
    run_id = str(uuid.uuid4())
    record = {"schema_version": 1, "run_id": run_id, "phase": "checking", "message": "正在检查源码和构建来源…"}
    write_state(root, record)
    print("DAILY PREFLIGHT: checking current local sources before service startup", flush=True)
    workflow = workflow_sources_current(root)
    refresh_sources(root, environment)
    run(root, environment, "yijie-desktop", "/bin/bash", "scripts/run-local-demo-fast.sh", "--development", "--kimi-k31-daily", "--preflight-only")
    sources = snapshot(root, environment)
    previous_file = state_file(root, "startup-build.json")
    previous = json.loads(previous_file.read_text()) if previous_file.is_file() else {}
    cache_key = cache["key"] if isinstance(cache, dict) else cache
    changed = previous.get("sources_sha256") != digest(sources) or previous.get("cache_key") != cache_key
    component_inputs = build_plan.fingerprints(sources, cache)
    plan = build_plan.plan(component_inputs, previous, artifact_inventory(root))
    builds = [key for key, value in plan["actions"].items() if value in {"build", "bundle"}]
    message = "正在更新受影响的组件…" if builds else "前端实时加载，正在复用已校验组件…"
    record.update(phase="building", message=message,
                  sources=sources, sources_sha256=digest(sources), cache_key=cache_key, source_changed=changed, workflow=workflow,
                  plan_version=build_plan.VERSION, component_inputs=component_inputs, build_plan=plan,
                  build_cache=cache,
                  reusable_artifacts=previous.get("artifacts", {}))
    write_state(root, record)
    print("DAILY BUILD PLAN: " + json.dumps(plan["actions"], sort_keys=True), flush=True)
    return run_id


def verify_build(root, environment, run_id):
    record = json.loads(state_file(root).read_text())
    require(record.get("schema_version") == 1 and record.get("run_id") == run_id and record.get("phase") == "building", "缺少本次启动的源码检查记录。")
    require(digest(record["sources"]) == record["sources_sha256"], "源码检查记录不一致。")
    require_unchanged(record["sources"], snapshot(root, environment))
    build = json.loads((root / ".local/development/dev-app-build.json").read_text())
    native = root / ".local/development/target/debug/yijie-desktop"
    bundle = root / ".local/development/target/debug/bundle/macos/易界 AI.app/Contents/MacOS/yijie-desktop"
    require(sha(native) == sha(bundle) == build["binary_sha256"], "应用包未包含本次编译结果。")
    worker = json.loads((root.parent / "yijie-connectors/bin/market-worker/current.json").read_text())
    worker_file = Path(worker["binary"])
    require(worker_file.resolve().is_relative_to(root.parent / "yijie-connectors/bin/market-worker"), "连接器构建产物来源不一致。")
    require(sha(worker_file) == worker["sha256"], "连接器构建摘要不一致。")
    family = "runtime-native-tools"
    if environment.get("YIJIE_FEAT169_INTERACTION_TOOLS") == "true": family = "runtime-tool-search"
    if environment.get("YIJIE_FEAT171_DOCUMENT_RUNTIME") == "true": family = "runtime-documents"
    if environment.get("YIJIE_FEAT174_NATIVE_SKILLS") == "true": family = "runtime-skill-marketplace"
    runtime = json.loads((root / "contracts" / (family + ".candidate.json")).read_text())
    runtime_dir = root.parent / "yijie-codex" / runtime["runtime_relative_path"]
    require(runtime_dir.resolve().is_relative_to(root.parent / "yijie-codex/.yijie/build"), "Runtime 来源路径不一致。")
    require(sha(runtime_dir / "codex") == runtime["runtime_artifact"]["sha256"] and sha(runtime_dir / "runtime-manifest.json") == runtime["runtime_manifest_sha256"], "Runtime 构建摘要不一致。")
    artifacts = {"desktop": build["binary_sha256"], "helper": sha(root / ".local/development/target/debug/yijie-document-render"), "bundle": build["bundle_sha256"], "worker": worker["sha256"],
                 "host": sha(root / ".local/development/bin/yijie-agent-host"),
                 "media": sha(root / ".local/development/bin/yijie-artifact-mcp"), "runtime": runtime["runtime_artifact"]["sha256"]}
    require(record.get("plan_version") == build_plan.VERSION, "构建计划版本不一致。")
    for component, artifact in {"native": "desktop", "helper": "helper", "host": "host", "worker": "worker", "media": "media"}.items():
        if record["build_plan"]["actions"][component] == "reuse":
            require(artifacts[artifact] == record["reusable_artifacts"].get(artifact), "复用组件发生变化：" + component)
    verified = {**record, "phase": "verified", "message": "更新检查完成，正在打开易界…", "artifacts": artifacts}
    write_state(root, verified, "startup-build.json")
    write_state(root, verified)
    print("DAILY PREFLIGHT: current sources and built artifacts verified; opening client", flush=True)


def failure(root):
    file = state_file(root)
    record = json.loads(file.read_text()) if file.is_file() else {"schema_version": 1}
    record.update(phase="failed", message="启动检查或构建未通过，请查看启动日志。")
    write_state(root, record)


def sidecar_decisions(root, run_id):
    record = json.loads(state_file(root).read_text())
    require(record.get("run_id") == run_id and record.get("phase") == "building" and record.get("plan_version") == build_plan.VERSION, "缺少本次分组件构建计划。")
    actual = artifact_inventory(root)
    decisions = []
    for component in ("worker", "host", "media"):
        action = record["build_plan"]["actions"][component]
        require(action in {"build", "reuse"}, "未知构建动作。")
        if action == "reuse":
            require(actual.get(component) == record["reusable_artifacts"].get(component) and actual.get(component), "复用产物不一致：" + component)
        decisions.append("true" if action == "build" else "false")
    return " ".join(decisions)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["verify", "sidecars"])
    parser.add_argument("run_id")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    try:
        if args.action == "sidecars":
            print(sidecar_decisions(project, args.run_id))
        else:
            verify_build(project, os.environ, args.run_id)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        failure(project)
        print(str(error), flush=True)
        raise SystemExit(1)
