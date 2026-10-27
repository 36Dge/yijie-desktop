"""D2 cold backup only. Uses the normal App flock; no database/service open.

Fixed daily identity and original workspace layout. New backup and inspection
directories only; preserve source permissions, WAL and keys without repair.
"""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess


def require(ok, code):
    if not ok:
        raise ValueError(code)


def file_hash(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda: f.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def inventory(root):
    result = {}
    def visit(path):
        s = path.lstat()
        require(s.st_uid == os.geteuid(), "unexpected file owner")
        item = {"mode": stat.S_IMODE(s.st_mode), "mtime_ns": s.st_mtime_ns}
        if stat.S_ISLNK(s.st_mode):
            item.update(kind="symlink", target=os.readlink(path))
        elif stat.S_ISREG(s.st_mode):
            item.update(kind="file", bytes=s.st_size, sha256=file_hash(path))
            after = path.lstat()
            require((s.st_ino, s.st_size, s.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns), "source changed while reading")
        elif stat.S_ISDIR(s.st_mode):
            item["kind"] = "directory"
            for child in sorted(path.iterdir()):
                visit(child)
        else:
            raise ValueError("unsupported special file; retain and review")
        result[str(path.relative_to(root))] = item
    visit(root)
    return result


def write_private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())


def no_project_processes():
    ps = subprocess.check_output(["ps", "-axo", "pid=,comm="], text=True)
    names = {"yijie-desktop", "yijie-agent-host", "yijie-artifact-mcp", "yijie-mcp-worker", "codex"}
    active = [line.split(None, 1)[0] for line in ps.splitlines() if len(line.split(None, 1)) == 2 and Path(line.split(None, 1)[1]).name in names and ("CrossBSD/" in line or "易界" in line)]
    require(not active, "project processes still active; normal quit required")


def no_handles(roots):
    for root in roots:
        command = ["/usr/sbin/lsof", "-nP", "+D", str(root)] if root.is_dir() else ["/usr/sbin/lsof", "-nP", str(root)]
        p = subprocess.run(command, capture_output=True)
        require(p.returncode == 1 and not p.stdout and not p.stderr, "open handles or incomplete handle inspection")


@contextlib.contextmanager
def app_lock():
    cache = Path(subprocess.check_output(["getconf", "DARWIN_USER_CACHE_DIR"], text=True).strip())
    s = cache.lstat()
    require(cache.is_absolute() and stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and s.st_mode & 0o077 == 0, "unsafe cache directory")
    path = cache / "com.yijie.ai.desktop.instance.lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid() and s.st_nlink == 1 and s.st_mode & 0o077 == 0, "unsafe instance lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def copy_source(source, destination):
    if source.is_dir():
        shutil.copytree(source, destination, symlinks=True, copy_function=shutil.copy2)
    else:
        require(not destination.exists(), "new file required")
        shutil.copy2(source, destination, follow_symlinks=False)


def backup(sources, output):
    require(output.is_absolute() and not output.exists(), "new private output required")
    for source in sources.values():
        require(source.resolve(strict=True) == source and not output.is_relative_to(source), "source alias or overlapping backup")
    before = {label: inventory(p) for label, p in sources.items()}
    total = sum(item.get("bytes", 0) for tree in before.values() for item in tree.values())
    require(shutil.disk_usage(output.parent).free >= total * 2 + 1024 ** 3, "insufficient backup and inspection space")
    output.mkdir(mode=0o700)
    sealed = output / "sealed"
    sealed.mkdir(mode=0o700)
    for label, source in sources.items():
        copy_source(source, sealed / label)
    copied = {label: inventory(sealed / label) for label in sources}
    after = {label: inventory(p) for label, p in sources.items()}
    require(before == copied == after, "sealed backup differs or source changed")
    write_private(output / "source-manifest.json", {"sources": {k: str(v) for k, v in sources.items()}, "inventory": before})
    inspection = output / "inspection"
    shutil.copytree(sealed, inspection, symlinks=True, copy_function=shutil.copy2)
    require(copied == {label: inventory(inspection / label) for label in sources}, "inspection copy differs")
    return {"feature": "FEAT-164", "stage": "D2", "sealed_backup_verified": True, "inspection_root": str(inspection), "sealed_root": str(sealed), "source_manifest_sha256": file_hash(output / "source-manifest.json"), "files": sum(x["kind"] == "file" for tree in before.values() for x in tree.values()), "bytes": total, "source_unchanged": True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("workspace", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    w = args.workspace
    require(w.resolve(strict=True) == w and (w / "yijie/repos.yaml").is_file(), "original workspace required")
    daily = w / "yijie-desktop/.local/demo-fast"
    sources = {"native": Path.home() / "Library/Application Support/com.yijie.ai", "host": daily / "host-home", "runtime": daily / "codex-home", "minimax-key": w / "yijie-agent-host/.local/secrets/minimax-api-key", "kimi-key": w / "yijie-agent-host/.local/secrets/kimi-api-key"}
    for label in ["host", "runtime"]:
        s = sources[label].lstat()
        require(stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode) == 0o700, "existing private Home required")
    with app_lock():
        no_project_processes()
        no_handles(sources.values())
        result = backup(sources, args.output)
        no_project_processes()
        no_handles(sources.values())
        result.update(completed_at=dt.datetime.now().astimezone().isoformat(), same_global_lock_held=True, no_open_handles=True, no_service_or_database_open=True)
        write_private(args.output / "manifest.json", result)
    print(json.dumps({k: v for k, v in result.items() if k not in ["inspection_root", "sealed_root"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"backup_completed": False, "error_type": type(error).__name__, "reason": str(error) if isinstance(error, ValueError) else "metadata/lock/copy check failed; retain all files"}))
        raise SystemExit(1)
