"""Normal retained data only; no actual daily roots, service calls or fault injection."""
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import types
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

backup = module("feat164-d2-backup")
reader = module("feat164-d2-reader")
workflow = module("feat164-d2-workflow-ready")


class Tools(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="d2-normal-", dir=os.environ["FEAT164_D2_TEST_ROOT"]))

    def test_complete_cold_copy_two_layers_and_preservation(self):
        source = self.root / "original"
        source.mkdir(mode=0o700)
        db = sqlite3.connect(source / "ordinary.sqlite")
        db.execute("CREATE TABLE retained(id INTEGER PRIMARY KEY, value TEXT)")
        db.execute("INSERT INTO retained VALUES(1, 'normal history')")
        db.commit()
        db.close()
        (source / "attachment.txt").write_text("ordinary attachment")
        before = backup.inventory(source)
        result = backup.backup({"native": source}, self.root / "cold")
        backup.write_private(self.root / "cold/manifest.json", result)
        self.assertEqual(reader.manifest_root(self.root / "cold/manifest.json"), self.root / "cold/inspection")
        self.assertTrue(result["sealed_backup_verified"])
        self.assertEqual(before, backup.inventory(source))
        self.assertEqual(before, backup.inventory(self.root / "cold/sealed/native"))
        self.assertEqual(before, backup.inventory(self.root / "cold/inspection/native"))

    def test_runtime_readonly_and_rollout_binding(self):
        inspection = self.root / "inspection"
        home = inspection / "runtime"
        home.mkdir(parents=True, mode=0o700)
        (home / "sessions").mkdir()
        (home / "sessions/ordinary.jsonl").write_text('{"type":"ordinary retained test record"}\n')
        db = sqlite3.connect(home / "state_5.sqlite")
        db.execute("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT)")
        db.execute("INSERT INTO threads VALUES(?,?)", ("ordinary-thread", str(home / "sessions/ordinary.jsonl")))
        db.commit()
        db.close()
        before = backup.inventory(home)
        result = reader.runtime(inspection, home)
        self.assertTrue(result["integrity_ok"])
        self.assertTrue(result["threads"][0]["rollout_present"])
        self.assertEqual(before, backup.inventory(home))

    def test_old_natural_sql29_and_sql37_readonly(self):
        base = Path(os.environ["FEAT164_D2_RETAINED_FIXTURES"])
        library = base / "libsqlcipher-audit.dylib"
        for version in [29, 37]:
            parent = base / f"migrate{version}-final/held/Application Support/com.yijie.ai.feat164-kimi-k31-r1/demo-fast-model-candidate-v1/kimi-k31-migration-backups"
            # The producer-only folder has no key file. Use the retained complete
            # pre-migration snapshot, which includes its original synthetic key.
            original = next(p for p in sorted(parent.iterdir()) if (p / "secrets/chat-sqlcipher-v1.secret").is_file())
            before = backup.inventory(original)
            inspection = self.root / str(version) / "inspection"
            inspection.mkdir(parents=True, mode=0o700)
            shutil.copytree(original, inspection / "native")
            db = reader.CipherReader(inspection, inspection / "native/chat/conversations.db", inspection / "native/secrets/chat-sqlcipher-v1.secret", library)
            try:
                result = reader.native(db)
            finally:
                db.close()
            self.assertEqual(result["schema"], version)
            self.assertTrue(result["integrity_ok"])
            self.assertEqual(result["query_errors"], [])
            self.assertEqual(before, backup.inventory(original))

    def test_workflow_normal_states_no_live_module(self):
        for phase, ready in [("ready", True), ("ready", False), ("stopped", False)]:
            calls = []
            def state():
                calls.append("read_state")
                return {"phase": phase}
            def containers():
                calls.append("all_containers")
                return [{"state": {"Running": ready}, "health": "healthy" if ready else "stopped"}]
            def owned(items, s):
                calls.append("validate_owned")
            def observed(s, items):
                calls.append("observed_ready")
                return ready
            result = workflow.inspect(types.SimpleNamespace(read_state=state, all_containers=containers, validate_owned=owned, observed_ready=observed))
            self.assertEqual(result["status"], "READY" if ready else "NOT_READY")
            self.assertEqual(calls, ["read_state", "all_containers", "validate_owned"] + (["observed_ready"] if phase == "ready" else []))


if __name__ == "__main__":
    unittest.main()
