"""Private primary-build intermediate cache. Never a source or launch authority."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

VERSION = 1
MAX_BUCKETS = 2
MAX_BYTES = 64 * 1024 ** 3
MIN_FREE = 12 * 1024 ** 3
COMPONENTS = {"desktop": "CARGO_BUILD_BUILD_DIR", "worker": "YIJIE_WORKER_BUILD_DIR",
              "artifact": "YIJIE_ARTIFACT_BUILD_DIR"}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path, "cache path alias")
    s = path.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and not s.st_mode & 0o022,
            "cache directory ownership/protection")


def cache_root(root):
    return root / ".local/build-cache/feat162-v1"


def plan(root, identity):
    key = digest(identity)
    bucket = cache_root(root) / key
    return {"schema_version": VERSION, "identity": identity, "key": key,
            "directories": {name: str(bucket / name) for name in COMPONENTS}}


def validate(root, value):
    require(isinstance(value, dict) and isinstance(value.get("identity"), dict)
            and value == plan(root, value["identity"]), "cache descriptor mismatch")
    require(value["identity"].get("workspace") == str(root.parent), "cache workspace mismatch")
    return {env: value["directories"][name] for name, env in COMPONENTS.items()}


def discover(root, environment):
    # Read-only toolchain preflight happens before creating a generation or compiling.
    def run(*args):
        return subprocess.check_output(args, cwd=root, env=environment, text=True).strip()
    cargo, rustc, go = run("cargo", "-Vv"), run("rustc", "-Vv"), run("go", "env", "GOVERSION")
    match = re.search(r"cargo (\d+)\.(\d+)\.(\d+)", cargo)
    require(match and tuple(map(int, match.groups())) >= (1, 91, 0), "Cargo >=1.91 required for separate intermediate cache")
    require(rustc.startswith("rustc 1.95.0 "), "worker requires its pinned Rust 1.95.0")
    minimum = re.search(r"^go (\d+)\.(\d+)\.(\d+)$", (root.parent / "yijie-agent-host/go.mod").read_text(), re.M)
    actual = re.fullmatch(r"go(\d+)\.(\d+)\.(\d+)", go)
    require(minimum and actual and tuple(map(int, actual.groups())) >= tuple(map(int, minimum.groups())),
            "Host Go toolchain is older than go.mod; select the existing supported toolchain first")
    host = re.search(r"^host: (.+)$", rustc, re.M).group(1)
    sdk = {"path": run("xcrun", "--sdk", "macosx", "--show-sdk-path"),
           "version": run("xcrun", "--sdk", "macosx", "--show-sdk-version"),
           "compiler": run("xcrun", "clang", "--version")}
    inputs = {}
    for repo, names in {
        "yijie-desktop": ["src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "src-tauri/.cargo/config.toml", ".cargo/config.toml"],
        "yijie-connectors": ["worker/Cargo.lock", "worker/Cargo.toml", ".cargo/config.toml"],
        "yijie-agent-host": ["artifact-mcp/Cargo.lock", "artifact-mcp/Cargo.toml", ".cargo/config.toml"],
    }.items():
        for name in names:
            p = root.parent / repo / name
            inputs[f"{repo}/{name}"] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    # Cargo also reads ancestor and CARGO_HOME configuration (which may contain
    # rustflags/target overrides). Freeze only hashes, never configuration secrets.
    config_roots = [root, *root.parents, Path(environment.get("CARGO_HOME", str(Path(environment["HOME"]) / ".cargo")))]
    for base in config_roots:
        config_dir = base if base == config_roots[-1] else base / ".cargo"
        for name in ("config", "config.toml"):
            p = config_dir / name
            inputs[str(p)] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    identity = {"workspace": str(root.parent), "cargo": cargo, "rustc": rustc, "host_go": go,
                "tools": {tool: str(Path(shutil.which(tool, path=environment["PATH"])).resolve(strict=True))
                          for tool in ("cargo", "rustc", "go")},
                "sdk": sdk, "target": host, "profile": "dev",
                "features": {"desktop": ["kimi-k31-pro-candidate"], "worker": [], "artifact": []},
                "environment": {k: environment.get(k) for k in ("SDKROOT", "DEVELOPER_DIR", "CARGO_HOME", "RUSTUP_HOME")},
                "flags": "canonical-primary-allowlist-no-ambient-flags", "inputs": inputs}
    return plan(root, identity)


def capacity(root, value):
    """Pre-build soft capacity checks; never delete or interrupt a running build."""
    buckets = [p for p in root.iterdir() if p.is_dir()]
    require(len(buckets) + (0 if (root / value["key"]).exists() else 1) <= MAX_BUCKETS,
            "cache bucket limit reached; review disk before building, no automatic cleanup")
    total = 0
    for base, _, files in os.walk(root):
        for name in files:
            total += (Path(base) / name).lstat().st_size
    require(total < MAX_BYTES, "cache exceeds 64 GiB preflight threshold; review disk before building")
    require(shutil.disk_usage(root).free >= MIN_FREE, "less than 12 GiB free; build not started")


@contextmanager
def acquire(root, value):
    validate(root, value)
    parent = cache_root(root)
    for p in (root / ".local", root / ".local/build-cache", parent):
        p.mkdir(mode=0o700, exist_ok=True)
        directory(p)
    # A normal advisory lock, not a PID file. OS releases it on normal owner exit.
    fd = os.open(parent / "build.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        s = os.fstat(lock.fileno())
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid() and s.st_nlink == 1
                and not s.st_mode & 0o077, "private cache lock required")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("another primary build owns the cache; no build started") from error
        capacity(parent, value)
        bucket = parent / value["key"]
        bucket.mkdir(mode=0o700, exist_ok=True)
        directory(bucket)
        for name in COMPONENTS:
            p = bucket / name
            p.mkdir(mode=0o700, exist_ok=True)
            directory(p)
        yield
