"""Fixed local development client: HMR, incremental builds, original daily data.

Private deployment interface v2. Routine dependency startup and normal cleanup;
no package generation, backup, migration, approval issuance or model dispatch.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

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
    # Existing data only. Never silently select a blank candidate Home.
    for key in ("native", "host", "runtime"):
        primary.directory(selected[key])
    for relative in ("chat/conversations.db", "secrets/chat-sqlcipher-v1.secret"):
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


def environment(root, environ):
    # Never inherit model URLs, credentials, Homes, TAURI_CONFIG or old generation
    # selectors. Public feature flags come from the canonical shell profile.
    env = primary.build_environment(environ)
    env["PATH"] = supported_go(root, env) + os.pathsep + env["PATH"]
    selected = paths(root, Path(env["HOME"]))
    return {**env, "YIJIE_DEVELOPMENT_CLIENT": "true",
            "CARGO_TARGET_DIR": str(selected["target"]), "YIJIE_WORKER_TARGET_DIR": str(selected["worker_target"])}


def start():
    selected = check()
    env = environment(ROOT, os.environ)
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
    parser.add_argument("action", choices=["start", "check", "ready"], default="start", nargs="?")
    args = parser.parse_args()
    if args.action == "check":
        check()
        print("Fixed development data roots verified; no database opened.")
        return 0
    if args.action == "ready":
        workflow_ready()
        print("Existing authenticated workflow is ready.")
        return 0
    return start()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("开发客户端未启动；原数据保持。" + (str(error) if isinstance(error, ValueError) else "请检查本地依赖与启动日志。"), file=sys.stderr)
        raise SystemExit(1)
