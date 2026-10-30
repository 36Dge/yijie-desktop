"""Canonical original-checkout build layout and explicit daily entry. No approval issuer."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

# Also supports the existing importlib-based source checks and parser tests.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import feat162_build_cache as build_cache

POLICY = "feat164-primary-existing-homes-v3"
ROOT = Path(__file__).resolve().parents[1]
SOURCE_NAMES = ("yijie-desktop", "yijie-contracts", "yijie-agent-host", "yijie-connectors", "yijie-skills", "yijie-codex")
ENV_KEYS = {"PATH", "HOME", "TMPDIR", "CARGO_HOME", "RUSTUP_HOME", "SDKROOT", "DEVELOPER_DIR", "LANG", "LC_ALL"}
BUILD_FIXED = {"CARGO_BUILD_JOBS": "2", "CARGO_NET_OFFLINE": "true", "GOPROXY": "off", "GOSUMDB": "off",
               "GOTOOLCHAIN": "local", "npm_config_offline": "true", "COREPACK_ENABLE_NETWORK": "0",
               "GIT_OPTIONAL_LOCKS": "0", "PYTHONDONTWRITEBYTECODE": "1"}


OBSERVATION_PROFILE = "feat162-soft-budget-v3"
OBSERVATION_ENV = {"YIJIE_FEAT162_OBSERVATION_PROFILE": OBSERVATION_PROFILE,
                   "YIJIE_PERMISSION_VERIFICATION_BASE_URL": "http://127.0.0.1:18083/v1"}


class ObservationLaunchError(ValueError):
    """Fixed, actionable launch diagnostics without configuration or response bodies."""


def check_observation_launch(environment, opted_in):
    observation = environment.get("YIJIE_FEAT162_OBSERVATION_PROFILE") == OBSERVATION_PROFILE
    if not observation:
        if opted_in:
            raise ObservationLaunchError("所选构建不是 FEAT-162 验收构建，不能临时切换为验收模式。")
        return
    if not opted_in:
        raise ObservationLaunchError(
            "所选构建绑定 FEAT-162 本机计量器，不能作为普通日常入口打开。"
            "日常使用请准备并激活不带 --feat162-observe 的新构建；"
            "继续已获授权的验收才可显式添加 --feat162-observe。")
    # Read-only health probe, directly to the fixed loopback endpoint. It never
    # reads a provider key, follows a redirect, arms a meter or sends a model request.
    connection = http.client.HTTPConnection("127.0.0.1", 18083, timeout=2)
    try:
        connection.request("GET", "/health")
        response = connection.getresponse()
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise ValueError("health response unavailable")
        health = json.loads(raw)
        if (not isinstance(health, dict) or health.get("feature") != "FEAT-162"
                or type(health.get("offline")) is not bool
                or type(health.get("armed")) is not bool
                or health.get("halted") is not False):
            raise ValueError("meter unavailable")
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise ObservationLaunchError(
            "FEAT-162 本机计量器未就绪或已停止，应用未启动。"
            "请恢复已获授权的验收环境，或使用正式日常构建；不会自动直连模型。") from error
    finally:
        connection.close()

def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def read_json(file):
    require(file.resolve(strict=True) == file, "record path alias")
    s = file.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid() and s.st_nlink == 1
            and stat.S_IMODE(s.st_mode) in {0o400, 0o600} and s.st_size <= 1048576, "private record")
    with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW), "rb") as f:
        actual = os.fstat(f.fileno())
        require((actual.st_dev, actual.st_ino) == (s.st_dev, s.st_ino), "record changed")
        raw = f.read(1048577)
    require(len(raw) <= 1048576, "record too large")
    return json.loads(raw), digest(raw)


def write_new(file, value):
    with os.fdopen(os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600), "wb") as f:
        f.write(json_bytes(value))
        f.flush()
        os.fsync(f.fileno())


def directory(p):
    require(p.resolve(strict=True) == p, "directory alias")
    s = p.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and not s.st_mode & 0o022, "directory protection")


def layout(root, generation):
    require(root.is_absolute() and root.resolve(strict=True) == root and root.name == "yijie-desktop", "primary source root")
    require(isinstance(generation, str) and re.fullmatch(r"[0-9]{8}-[0-9]{2}", generation), "generation must be YYYYMMDD-NN")
    output = root / ".local/builds/primary" / generation
    return {"source_root": str(root), "generation": generation, "output_root": str(output),
            "target": str(output / "target"), "worker_target": str(output / "worker-target"),
            "worker_manifest": str(output / "worker/current.json"),
            "bundle": str(output / "target/debug/bundle/macos/易界 AI.app"),
            "receipt": str(output / "packaged-launch-receipt.json")}


def git(root, *args):
    return subprocess.check_output(["git", "--no-optional-locks", "-C", str(root), *args], text=True).strip()


def source_facts(root):
    directory(root)
    require((root / ".git").is_dir() and not (root / ".git").is_symlink(), "original main checkout required")
    require(Path(git(root, "rev-parse", "--show-toplevel")) == root, "primary Git root")
    common = Path(git(root, "rev-parse", "--git-common-dir"))
    require((common if common.is_absolute() else root / common).resolve() == root / ".git", "primary Git database")
    facts = {}
    for name in SOURCE_NAMES:
        p = root.parent / name
        directory(p)
        require(not git(p, "status", "--porcelain", "--untracked-files=all"), "source is not committed and clean: " + name)
        facts[name] = {"root": str(p), "commit": git(p, "rev-parse", "HEAD")}
    return facts


def build_environment(environ, feat162_observe=False):
    env = {k: environ[k] for k in ENV_KEYS if k in environ}
    require({"PATH", "HOME"} <= set(env) and env["HOME"] == str(Path.home()), "original build user")
    require(all(isinstance(v, str) and v and all(ord(c) >= 32 for c in v) for v in env.values()), "build environment")
    return {**env, **BUILD_FIXED, **(OBSERVATION_ENV if feat162_observe else {})}


def checked_generation(root, generation, check_sources=True):
    paths = layout(root, generation)
    output = Path(paths["output_root"])
    for p in [root / ".local", root / ".local/builds", output.parent, output]:
        directory(p)
    value, descriptor_sha = read_json(output / "generation.json")
    version = value.get("schema_version")
    require(set(value) == {"schema_version", "feature", "policy", "layout", "sources", "environment_sha256"}
            | ({"build_cache"} if version == 2 else set())
            and version in {1, 2} and value["feature"] == "FEAT-164" and value["policy"] == POLICY
            and value["layout"] == paths, "generation descriptor")
    environment, env_sha = read_json(output / "environment.json")
    expected = build_environment(environment, environment.get("YIJIE_FEAT162_OBSERVATION_PROFILE") == OBSERVATION_PROFILE)
    if version == 2:
        expected.update(build_cache.validate(root, value["build_cache"]))
    require(env_sha == value["environment_sha256"] and environment == expected, "generation environment")
    if check_sources:
        require(value["sources"] == source_facts(root), "generation source drift")
    return paths, value, descriptor_sha, environment


def prepare(root, generation, environ, feat162_observe=False):
    paths = layout(root, generation)
    facts = source_facts(root)
    env = build_environment(environ, feat162_observe)
    cache = build_cache.discover(root, env)
    env.update(build_cache.validate(root, cache))
    with build_cache.acquire(root, cache):
        return prepare_generation(root, generation, paths, facts, env, cache)


def prepare_generation(root, generation, paths, facts, env, cache):
    output = Path(paths["output_root"])
    for p in [root / ".local", root / ".local/builds", output.parent]:
        if not p.exists():
            p.mkdir(mode=0o700)
        directory(p)
    output.mkdir(mode=0o700, exist_ok=False)
    for name in ["bin", "worker", "activation"]:
        (output / name).mkdir(mode=0o700)
    write_new(output / "environment.json", env)
    write_new(output / "generation.json", {"schema_version": 2, "feature": "FEAT-164", "policy": POLICY,
              "layout": paths, "sources": facts, "environment_sha256": digest(json_bytes(env)), "build_cache": cache})
    return invoke(root, generation, env, ["--prepare-only"])


def invocation(root, generation, environment, args):
    paths = layout(root, generation)
    env = {**environment, "YIJIE_FEAT164_PRIMARY_GENERATION": generation,
           "CARGO_TARGET_DIR": paths["target"], "YIJIE_WORKER_TARGET_DIR": paths["worker_target"]}
    command = ["/bin/bash", str(root / "scripts/run-local-demo-fast.sh"), "--packaged", "--kimi-k31-daily", *args]
    return command, env


def invoke(root, generation, environment, args):
    command, env = invocation(root, generation, environment, args)
    return subprocess.call(command, cwd=root, env=env)


def open_daily(root, generation, stage, paused, feat162_observe=False):
    paths, _, _, environment = checked_generation(root, generation)
    output = Path(paths["output_root"])
    index, _ = read_json(output / "activation" / (stage.lower() + ".json"))
    require(set(index) == {"stage", "binding_sha256", "binding_file"} and index["stage"] == stage, "approval index")
    binding_file = output / "activation" / ("binding-" + stage.lower() + ".json")
    require(index["binding_file"] == str(binding_file), "approval binding path")
    _, sha = read_json(binding_file)
    require(sha == index["binding_sha256"], "approval binding digest")
    check_observation_launch(environment, feat162_observe)
    env = {**environment, "YIJIE_FEAT164_DAILY_BINDING_FILE": str(binding_file),
           "YIJIE_FEAT164_DAILY_BINDING_SHA256": sha, "YIJIE_FEAT164_DAILY_STAGE": stage,
           "YIJIE_KIMI_K31_EXECUTION_PAUSED": "true" if paused else "false"}
    # The canonical launcher verifies binding+receipt before it reads credentials or starts services.
    return invoke(root, generation, env, ["--reopen"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "open", "verify", "layout"])
    parser.add_argument("--generation", required=True)
    parser.add_argument("--pause-kimi", action="store_true")
    parser.add_argument("--feat162-observe", action="store_true", help="Explicitly prepare or open the frozen local observation profile; no allowance or activation is created")
    args = parser.parse_args()
    require(not args.feat162_observe or args.action in {"prepare", "open", "verify"}, "observation requires prepare, open or verify")
    require(not args.pause_kimi or args.action == "open", "pause applies to open only")
    if args.action == "layout":
        paths, value, sha, _ = checked_generation(ROOT, args.generation)
        print(json.dumps({**paths, "descriptor_sha256": sha, "sources": value["sources"],
                          **({"build_cache": value["build_cache"]} if value["schema_version"] == 2 else {})}))
        return 0
    if args.action == "prepare":
        return prepare(ROOT, args.generation, os.environ, args.feat162_observe)
    return open_daily(ROOT, args.generation, "D4" if args.action == "verify" else "D5",
                      args.action == "verify" or args.pause_kimi, args.feat162_observe)


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    try:
        raise SystemExit(main())
    except ObservationLaunchError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    except (ValueError, OSError, subprocess.CalledProcessError):
        print("Primary entry stopped: review source, generation, environment and explicit approval; existing data retained.", file=sys.stderr)
        raise SystemExit(1)
