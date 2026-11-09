"""Fixed local development client: HMR, incremental builds, original daily data.

Private deployment interface v2. Routine dependency startup and normal cleanup;
no package generation, backup, migration, approval issuance or model dispatch.
"""
import argparse
import hashlib
import json
import importlib.util
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feat164_primary as primary
import feat162_build_cache as build_cache

ROOT = Path(__file__).resolve().parents[1]


def paths(root, home):
    output = root / ".local/development"
    return {
        "output": output, "target": output / "target", "worker_target": output / "worker-target",
        "native": home / "Library/Application Support/com.yijie.ai/demo-fast-v1",
        "host": root / ".local/demo-fast/host-home", "runtime": root / ".local/demo-fast/codex-home",
    }


def stopped(root):
    rows = subprocess.check_output(["ps", "-axo", "comm="], text=True).splitlines()
    names = {"yijie-desktop", "yijie-agent-host", "yijie-mcp-worker", "yijie-artifact-mcp", "codex"}
    primary.require(not any(Path(row).name in names and str(root.parent) + "/" in row for row in rows),
                    "请先通过易界菜单或 ⌘Q 正常退出客户端，再运行 pnpm client:dev。")


def check(root=ROOT, home=None):
    home = home or Path.home()
    primary.require(root.resolve(strict=True) == root and (root / ".git").is_dir(), "原主工作目录不可用。")
    selected = paths(root, home)
    # Original Homes only. A fresh DB requires the explicit v6 reset receipt.
    for key in ("native", "host", "runtime"):
        primary.directory(selected[key])
    database = selected["native"] / "chat/conversations.db"
    receipt = selected["output"] / "trace-v6-reset.json"
    primary.require(receipt.is_file() and receipt.resolve(strict=True) == receipt,
                    "缺少已授权的新格式重置记录，未创建空白数据库。")
    data = json.loads(receipt.read_text())
    primary.require(data.get("schemaVersion") == 1 and data.get("nativeFormat") == 6 and data.get("sseVersion") == 13 and data.get("ipcVersion") == 6,
                    "新格式重置记录不可用。")
    for relative in (("chat/conversations.db",) if database.exists() else ()) + ("secrets/chat-sqlcipher-v1.secret",):
        file = selected["native"] / relative
        primary.require(file.is_file() and file.resolve(strict=True) == file, "原客户端数据或密钥文件不可用。")
    stopped(root)
    return selected


def workflow_ready(root=ROOT):
    source = root / "scripts/feat164-daily-deployment.py"
    spec = importlib.util.spec_from_file_location("development_workflow_ready", source)
    daily = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(daily)
    daily.workflow_ready({"workflow": {"infra_root": str(root.parent / "yijie-infra")}})


def workflow_session(action):
    controller = ROOT.parent / "yijie-infra/scripts/workflow-session.py"
    subprocess.run([sys.executable, "-B", str(controller), action], cwd=controller.parent.parent, check=True)


def supported_go(root, env):
    minimum = re.search(r"^go (\d+)\.(\d+)\.(\d+)$", (root.parent / "yijie-agent-host/go.mod").read_text(), re.M)
    primary.require(minimum is not None, "Host Go 版本声明不可用。")
    required = tuple(map(int, minimum.groups()))
    installed = shutil.which("go", path=env["PATH"])
    # Prefer the project's exact installed toolchain so an unrelated Homebrew
    # patch update does not select a new shared Rust cache bucket on each start.
    exact = Path.home() / ("go/pkg/mod/golang.org/toolchain@v0.0.1-go" + ".".join(minimum.groups()) + ".darwin-arm64/bin/go")
    candidates = ([exact] if exact.is_file() else []) + ([Path(installed)] if installed else []) + sorted(
        Path.home().glob("go/pkg/mod/golang.org/toolchain@*.darwin-arm64/bin/go"), reverse=True)
    for candidate in candidates:
        result = subprocess.run([str(candidate), "env", "GOVERSION"], env=env, capture_output=True, text=True)
        match = re.fullmatch(r"go(\d+)\.(\d+)\.(\d+)", result.stdout.strip())
        if result.returncode == 0 and match and tuple(map(int, match.groups())) >= required:
            return str(candidate.parent)
    raise ValueError("缺少项目要求的已安装 Go 工具链；未下载或替换任何程序。")


def environment(root, environ, tool_search_meter=False, document_meter=False):
    # Never inherit model URLs, credentials, Homes, TAURI_CONFIG or old generation
    # selectors. Public feature flags come from the canonical shell profile.
    env = primary.build_environment(environ)
    env["PATH"] = supported_go(root, env) + os.pathsep + env["PATH"]
    selected = paths(root, Path(env["HOME"]))
    images = daily_images_setting(selected["output"])
    interaction = environ.get("YIJIE_FEAT169_INTERACTION_TOOLS", "true")
    primary.require(interaction in ("true", "false"), "Invalid interaction tool selector.")
    tool_search = environ.get("YIJIE_FEAT170_TOOL_SEARCH", "true" if interaction == "true" else "false")
    primary.require(tool_search in ("true", "false"), "Invalid tool search selector.")
    primary.require(tool_search == "false" or interaction == "true", "Tool search requires interaction tools.")
    result = {**env, "YIJIE_FEAT170_TOOL_SEARCH": tool_search, "YIJIE_FEAT169_INTERACTION_TOOLS": interaction, "YIJIE_DEVELOPMENT_CLIENT": "true", "YIJIE_FEAT168_DAILY_IMAGES": "true" if images else "false",
              "CARGO_TARGET_DIR": str(selected["target"]), "YIJIE_WORKER_TARGET_DIR": str(selected["worker_target"])}
    documents = environ.get("YIJIE_FEAT171_DOCUMENT_RUNTIME", "false")
    primary.require(documents in ("true", "false"), "Invalid document runtime selector.")
    if documents == "true":
        primary.require(interaction == "true", "Document runtime requires native interaction tools.")
        receipt = json.loads((root / ".local/document-bundles/current.json").read_text())
        bundle = Path(receipt["bundle_root"])
        primary.require(bundle.resolve(strict=True) == bundle and bundle.is_dir(), "Document bundle unavailable.")
        state_id = hashlib.sha256(str(selected["native"]).encode()).hexdigest()[:16]
        state = Path("/private/tmp") / ("yijie-documents-" + str(os.geteuid()) + "-" + state_id)
        state.mkdir(mode=0o700, exist_ok=True)
        primary.directory(state)
        result.update(YIJIE_FEAT171_DOCUMENT_RUNTIME="true", YIJIE_DOCUMENT_BUNDLE_DIR=str(bundle),
                      YIJIE_DOCUMENT_BUNDLE_SHA256=receipt["manifest_sha256"], YIJIE_DOCUMENT_STATE_ROOT=str(state))
    if tool_search_meter or document_meter:
        primary.require(not (tool_search_meter and document_meter), "Choose one acceptance scope.")
        primary.require(documents == "true" if document_meter else tool_search == "true", "Verification requires its enabled profile.")
        # Explicit UI acceptance only. Reuse the existing fixed, bounded meter;
        # no ambient URL or provider credential is admitted by this selector.
        result["YIJIE_FEAT171_DOCUMENT_METER" if document_meter else "YIJIE_FEAT170_TOOL_SEARCH_METER"] = "true"
        result["YIJIE_PERMISSION_VERIFICATION_BASE_URL"] = "http://127.0.0.1:18083/v1"
    return result


def daily_images_setting(output):
    record = output / "host-images.json"
    if not os.path.lexists(record):
        return False
    value, _ = primary.read_json(record)
    primary.require(isinstance(value, dict) and set(value) == {"schemaVersion", "enabled"}
                    and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
                    and type(value["enabled"]) is bool, "日常生图配置格式无效。")
    return value["enabled"]


def set_daily_images(selected, enabled):
    database = selected["native"] / "chat/conversations.db"
    primary.require(database.is_file() and database.resolve(strict=True) == database, "缺少原日常会话库。")
    output = selected["output"]
    primary.directory(output)
    if daily_images_setting(output) == enabled:
        return
    # Publish a complete preference atomically, outside all three data Homes.
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        stage = Path(temporary) / "host-images.json"
        primary.write_new(stage, {"schemaVersion": 1, "enabled": enabled})
        os.replace(stage, output / "host-images.json")


def start(bundle_for_ui=False, tool_search_meter=False, document_meter=False):
    primary.require(not (tool_search_meter or document_meter) or bundle_for_ui, "Acceptance meter requires start-ui.")
    selected = check()
    env = environment(ROOT, os.environ, tool_search_meter=tool_search_meter, document_meter=document_meter)
    if env["YIJIE_FEAT168_DAILY_IMAGES"] == "true":
        primary.require((selected["native"] / "chat/conversations.db").is_file(), "缺少原日常会话库，已停止启动。")
    if bundle_for_ui:
        env["YIJIE_DEVELOPMENT_UI_BUNDLE"] = "true"
    cache = build_cache.discover(ROOT, env)
    env.update(build_cache.validate(ROOT, cache))
    for folder in (ROOT / ".local", selected["output"], selected["output"] / "bin"):
        folder.mkdir(mode=0o700, exist_ok=True)
        primary.directory(folder)
    # Reuse the existing bounded Cargo intermediates. One owner, including
    # during the live App session; no concurrent rebuild can replace its files.
    with build_cache.acquire(ROOT, cache):
        workflow_session("ensure")
        workflow_ready()
        command = ["/bin/bash", str(ROOT / "scripts/run-local-demo-fast.sh"), "--development", "--kimi-k31-daily"]
        def pending(_signal, _frame):
            print("请通过易界菜单或 ⌘Q 正常退出；开发入口不会强制终止客户端或服务。", flush=True)
        previous = {sig: signal.signal(sig, pending) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            child = subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)
            code = child.wait()
            # The service controller checks that the App and Host have exited.
            # A failed/unfinished cleanup never escalates to a process kill.
            workflow_session("stop")
            return code
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "start-ui", "check", "ready", "images-enable", "images-pause"], default="start", nargs="?")
    parser.add_argument("--tool-search-meter", action="store_true",
                        help="Explicit FEAT-170 UI acceptance through the existing fixed loopback meter.")
    parser.add_argument("--document-meter", action="store_true",
                        help="Approved FEAT-171 UI acceptance through the fixed budget meter.")
    args = parser.parse_args()
    primary.require(not (args.tool_search_meter or args.document_meter) or args.action == "start-ui", "Acceptance meter requires start-ui.")
    if args.action in ("images-enable", "images-pause"):
        set_daily_images(check(), args.action == "images-enable")
        print("已保存日常生图设置，下次从原入口打开时生效。")
        return 0
    if args.action == "check":
        check()
        print("Fixed development data roots verified; no database opened.")
        return 0
    if args.action == "ready":
        workflow_ready()
        print("Existing authenticated workflow is ready.")
        return 0
    return start(bundle_for_ui=args.action == "start-ui", tool_search_meter=args.tool_search_meter, document_meter=args.document_meter)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("开发客户端未启动；原数据保持。" + (str(error) if isinstance(error, ValueError) else "请检查本地依赖与启动日志。"), file=sys.stderr)
        raise SystemExit(1)
