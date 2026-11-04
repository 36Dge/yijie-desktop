"""One-time owner-authorized conversation reset for the v6-only development client.

Default is inventory only. --apply requires all Yijie processes normally stopped.
It preserves secrets, installed resources, configuration and workspace files.
"""
import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("development_client", ROOT / "scripts/development-client.py")
development = importlib.util.module_from_spec(spec)
spec.loader.exec_module(development)


def targets(selected):
    native = selected["native"] / "chat"
    runtime = selected["runtime"]
    databases = [native / "conversations.db", selected["host"] / "sessions.db"]
    databases += [runtime / name for name in ("state_5.sqlite", "logs_2.sqlite", "memories_1.sqlite", "goals_1.sqlite")]
    return [path for database in databases for path in (database, Path(str(database) + "-wal"), Path(str(database) + "-shm"))] + [runtime / "sessions", runtime / "archived_sessions", runtime / "shell_snapshots"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    selected = development.paths(ROOT, Path.home())
    selected_targets = targets(selected)
    # Complete preflight before deleting anything. Never follow a symlink out of
    # the explicit owned stores; existing user workspaces are not in the list.
    for root in (selected["native"], selected["host"], selected["runtime"]):
        if not root.is_dir() or root.resolve(strict=True) != root:
            raise ValueError("Expected original Yijie data root is unavailable")
    existing = [path for path in selected_targets if path.exists() or path.is_symlink()]
    for path in existing:
        if path.is_symlink() or path.resolve(strict=True) != path:
            raise ValueError("Reset target must be an owned regular path")
        if path.is_dir() and any(child.is_symlink() for child in path.rglob("*")):
            raise ValueError("Reset directory contains a link; review it manually")
    print(json.dumps({"mode": "apply" if args.apply else "inventory", "targets": [str(path) for path in existing]}, ensure_ascii=False, indent=2))
    if not args.apply:
        return
    development.stopped(ROOT)
    for path in existing:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    selected["output"].mkdir(mode=0o700, parents=True, exist_ok=True)
    receipt = {"schemaVersion": 1, "nativeFormat": 6, "sseVersion": 13, "ipcVersion": 6,
               "completedAt": datetime.now(timezone.utc).isoformat(), "removed": [str(path) for path in existing],
               "preserved": ["secrets", "credentials", "configuration", "installed resources", "workspace files"]}
    (selected["output"] / "trace-v6-reset.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print("Conversation reset completed; no process was stopped by this script.")


if __name__ == "__main__":
    main()
