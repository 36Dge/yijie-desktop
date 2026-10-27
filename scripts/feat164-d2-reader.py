"""FEAT-164 D2: inspect second copies only; no product open/migration/lifecycle.

CLI requires a manifest created after a sealed cold backup. Native results contain
counts and hashes only. SQLCipher is the existing audited project library.
"""
import argparse
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import sqlite3

LIB_SHA = "555cce3be011978081b2e1d20781fe18d253bcf43afaca86d53e7e3b25fccf4d"
OWNER = "12500000-0000-4000-8000-000000000001"
TENANT = "12500000-0000-4000-8000-100000000001"


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(value):
    return digest(str(value).encode()) if value else None


def inside(root, path):
    require(root.name == "inspection" and root.resolve(strict=True) == root, "inspection root required")
    require(path.resolve(strict=True).is_relative_to(root) and not path.is_symlink(), "copy path required")
    require(path.is_file(), "regular copy required")
    return path


class CipherReader:
    def __init__(self, root, path, key, library):
        inside(root, path)
        inside(root, key)
        require(digest(library.read_bytes()) == LIB_SHA, "unqualified SQLCipher library")
        self.lib = lib = C.CDLL(str(library))
        ptr = C.c_void_p
        for name, args in {
            "sqlite3_open_v2": [C.c_char_p, C.POINTER(ptr), C.c_int, C.c_char_p],
            "sqlite3_key_v2": [ptr, C.c_char_p, ptr, C.c_int],
            "sqlite3_prepare_v2": [ptr, C.c_char_p, C.c_int, C.POINTER(ptr), ptr],
            "sqlite3_step": [ptr], "sqlite3_column_count": [ptr],
            "sqlite3_column_type": [ptr, C.c_int], "sqlite3_column_bytes": [ptr, C.c_int],
            "sqlite3_column_blob": [ptr, C.c_int], "sqlite3_column_name": [ptr, C.c_int],
            "sqlite3_finalize": [ptr], "sqlite3_close": [ptr],
        }.items():
            getattr(lib, name).argtypes = args
        lib.sqlite3_column_blob.restype = ptr
        lib.sqlite3_column_name.restype = C.c_char_p
        self.db = ptr()
        require(lib.sqlite3_open_v2(str(path).encode(), C.byref(self.db), 1, None) == 0, "readonly open failed")
        try:
            raw = key.read_bytes()
            require(len(raw) == 32, "key length")
            buf = C.create_string_buffer(raw)
            try:
                require(lib.sqlite3_key_v2(self.db, None, buf, 32) == 0, "key initialization failed")
            finally:
                C.memset(buf, 0, len(buf))
                del raw, buf
            self.query("PRAGMA query_only=ON")
            self.query("PRAGMA trusted_schema=OFF")
        except Exception:
            self.close()
            raise

    def query(self, sql):
        # All callers use fixed queries or quoted identifiers enumerated from sqlite_schema.
        require(sql.lstrip().upper().startswith(("SELECT", "PRAGMA")), "readonly query required")
        s = C.c_void_p()
        require(self.lib.sqlite3_prepare_v2(self.db, sql.encode(), -1, C.byref(s), None) == 0, "readonly prepare failed")
        result = []
        try:
            names = [self.lib.sqlite3_column_name(s, i).decode() for i in range(self.lib.sqlite3_column_count(s))]
            while True:
                code = self.lib.sqlite3_step(s)
                if code == 101:
                    break
                require(code == 100, "readonly step failed")
                row = []
                for i in range(len(names)):
                    kind = self.lib.sqlite3_column_type(s, i)
                    size = self.lib.sqlite3_column_bytes(s, i)
                    pointer = self.lib.sqlite3_column_blob(s, i)
                    raw = C.string_at(pointer, size) if size else b""
                    row.append(None if kind == 5 else int(raw) if kind == 1 else float(raw) if kind == 2 else raw.decode() if kind == 3 else {"blob_sha256": digest(raw), "bytes": size})
                result.append(dict(zip(names, row)))
        finally:
            require(self.lib.sqlite3_finalize(s) == 0, "readonly finalize failed")
        return result

    def close(self):
        if self.db:
            require(self.lib.sqlite3_close(self.db) == 0, "readonly close failed")
            self.db = None


def native(reader):
    result = {"read_only": True, "query_errors": [], "tables": {}, "checks": {}, "session_mapping": []}
    result["schema"] = next(iter(reader.query("PRAGMA user_version")[0].values()))
    result["schema_qualified"] = result["schema"] in [29, 37, 38, 39, 40, 41]
    result["integrity_ok"] = reader.query("PRAGMA integrity_check") == [{"integrity_check": "ok"}]
    result["foreign_key_failures"] = len(reader.query("PRAGMA foreign_key_check"))
    names = [r["name"] for r in reader.query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    for name in names:
        rows = reader.query('SELECT * FROM "' + name.replace('"', '""') + '"')
        result["tables"][name] = {"count": len(rows), "row_hashes": sorted(digest(json.dumps(r, sort_keys=True, ensure_ascii=False).encode()) for r in rows)}
    checks = {
        "outbox_pending_inflight": "SELECT count(*) n FROM chat_outbox WHERE state IN ('pending','inflight')",
        "selection_nonready": "SELECT count(*) n FROM chat_model_selections WHERE state!='ready'",
        "reservations": "SELECT count(*) n FROM chat_scheduled_reservation",
        "occupied_grants": "SELECT count(*) n FROM chat_scheduled_grants WHERE occupied_runs>0",
        "turn_uncertain_or_active": "SELECT count(*) n FROM chat_turns WHERE submission_status='uncertain' OR status IN ('streaming','stopping')",
        "native_view_nonterminal_or_unreadable": "SELECT count(*) n FROM chat_native_bindings b LEFT JOIN chat_native_views v ON v.turn_id=b.turn_id AND v.session_id=b.session_id WHERE v.turn_id IS NULL OR v.format_version NOT BETWEEN 1 AND 5 OR NOT json_valid(v.view_json) OR COALESCE(json_extract(v.view_json,'$.status'),'unknown') NOT IN ('completed','failed','interrupted')",
        # Conservative all-model upper bound, deliberately independent of Kimi pause, expiry or auth revision.
        "all_model_enabled_future": "SELECT count(*) n FROM chat_scheduled_plans WHERE state='enabled' AND future_hold IS NULL AND next_at IS NOT NULL",
        "all_model_pending_recovery": "SELECT count(*) n FROM chat_scheduled_runs r LEFT JOIN chat_scheduled_recovery e ON e.run_id=r.run_id WHERE e.release_kind IS NULL OR EXISTS(SELECT 1 FROM chat_scheduled_reservation v WHERE v.run_id=r.run_id)",
    }
    for table in ["chat_sessions", "chat_projects", "chat_scheduled_plans", "chat_scheduled_grants"]:
        checks[table + "_foreign_scope"] = f"SELECT count(*) n FROM {table} WHERE owner_user_id!='{OWNER}' OR tenant_id!='{TENANT}'"
    for name, sql in checks.items():
        try:
            result["checks"][name] = reader.query(sql)[0]["n"]
        except ValueError:
            result["checks"][name] = None
            result["query_errors"].append(name)
    try:
        result["session_mapping"] = [{k: identity(v) for k, v in row.items()} for row in reader.query("SELECT id,agent_session_id,runtime_thread_id FROM chat_sessions")]
    except ValueError:
        result["query_errors"].append("session_mapping")
    result["migration_preflight_clear"] = result["schema_qualified"] and result["integrity_ok"] and result["foreign_key_failures"] == 0 and not result["query_errors"] and all(v == 0 for k, v in result["checks"].items() if not k.startswith("all_model_"))
    result["zero_dispatch_upper_bound_clear"] = all(result["checks"].get(k) == 0 for k in ["all_model_enabled_future", "all_model_pending_recovery"])
    return result


def runtime(root, home):
    result = {"read_only": True, "databases": {}, "threads": []}
    for path in sorted(home.glob("*.sqlite")):
        inside(root, path)
        db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            db.execute("PRAGMA query_only=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            tables = db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            result["databases"][path.name] = {"integrity_ok": db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "tables": {name: db.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name, in tables}}
            if path.name == "state_5.sqlite":
                for row in db.execute("SELECT id,rollout_path FROM threads"):
                    original = Path(row[1])
                    # Only resolve rollout names under the backed up sessions/archive subtree.
                    parts = original.parts
                    found = [i for i, part in enumerate(parts) if part in ["sessions", "archived_sessions"]]
                    local = home.joinpath(*parts[found[-1]:]) if found else None
                    present = bool(local and local.is_file() and local.resolve().is_relative_to(home))
                    result["threads"].append({"id": identity(row[0]), "rollout_present": present, "rollout_sha256": digest(local.read_bytes()) if present else None})
        finally:
            db.close()
    require("state_5.sqlite" in result["databases"], "runtime state database missing")
    result["integrity_ok"] = all(x["integrity_ok"] for x in result["databases"].values())
    return result


def manifest_root(path):
    m = json.loads(path.read_text())
    require(m["feature"] == "FEAT-164" and m["stage"] == "D2" and m["sealed_backup_verified"] is True, "D2 sealed backup required")
    root = Path(m["inspection_root"])
    require(root == path.resolve().parent / "inspection" and Path(m["sealed_root"]) == root.parent / "sealed", "manifest copy binding")
    require(digest((root.parent / "source-manifest.json").read_bytes()) == m["source_manifest_sha256"], "sealed manifest drift")
    return root


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifest", type=Path)
    p.add_argument("library", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    root = manifest_root(args.manifest)
    native_root = root / "native/demo-fast-v1"
    reader = CipherReader(root, native_root / "chat/conversations.db", native_root / "secrets/chat-sqlcipher-v1.secret", args.library)
    try:
        result = {"native": native(reader), "runtime": runtime(root, root / "runtime")}
    finally:
        reader.close()
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps({"inspection_completed": True, "schema": result["native"]["schema"], "native_checks": result["native"]["checks"], "migration_preflight_clear": result["native"]["migration_preflight_clear"], "zero_dispatch_upper_bound_clear": result["native"]["zero_dispatch_upper_bound_clear"], "runtime_integrity_ok": result["runtime"]["integrity_ok"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Fixed diagnostics only; paths, keys, SQL values and inner library messages stay private.
        print(json.dumps({"inspection_completed": False, "error_type": type(error).__name__}))
        raise SystemExit(1)
