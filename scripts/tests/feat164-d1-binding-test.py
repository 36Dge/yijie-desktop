"""Positive composition of the real D1 loader; no daily filesystem or services."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "feat164-daily-deployment.py"
spec = importlib.util.spec_from_file_location("daily", SOURCE)
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


class BindingComposition(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="d1-composition-", dir=os.environ["FEAT164_D2_TEST_ROOT"]))
        self.origin = self.root / "original/yijie-desktop"
        self.candidate = self.root / "candidate/yijie-desktop"
        for name in ["host-home", "codex-home"]:
            p = self.origin / ".local/demo-fast" / name
            p.mkdir(parents=True, mode=0o700)
            (p / "retained-record.txt").write_text("ordinary retained record\n")
        receipt = self.candidate / ".local/feat164-daily/packaged-launch-receipt.json"
        receipt.parent.mkdir(parents=True)
        # Ordinary parser input, never used as a canonical App receipt or authorization.
        receipt.write_text(json.dumps({"deployment_policy": daily.POLICY, "release": False,
            "inputs": {"sources": {"scripts/feat164-daily-deployment.py": {"sha256": daily.digest(SOURCE.read_bytes())}}}}))
        self.value = {"schema_version": 1, "feature": "FEAT-164", "policy": daily.POLICY,
            "identifier": "com.yijie.ai", "receipt_sha256": daily.digest(receipt.read_bytes()),
            "native_data_directory": str(Path.home() / "Library/Application Support/com.yijie.ai/demo-fast-v1"),
            "original_desktop_root": str(self.origin), "host_home": str(self.origin / ".local/demo-fast/host-home"),
            "runtime_home": str(self.origin / ".local/demo-fast/codex-home"),
            "providers": {k + "_key_file": str(self.origin.parent / ("yijie-agent-host/.local/secrets/" + k + "-api-key")) for k in ["minimax", "kimi"]},
            "workflow": {"infra_root": str(self.origin.parent / "yijie-infra"), "source_sha256": daily.INFRA_SHA256,
                "credential_file": str(self.origin.parent / "yijie-infra/environments/local/generated/feat-153/private/k-na.json")},
            "approval": {"stage": "D3", "reference": "ordinary-synthetic-composition", "expires_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat(),
                "preflight_sha256": "b" * 64, "model_http_limit": 0, "no_dispatchable_work": True}}

    def load(self, stage, paused=None, value=None, digest=None):
        value = copy.deepcopy(value or self.value)
        value["approval"]["stage"] = stage
        path = self.root / ("binding-" + str(len(list(self.root.glob("binding-*")))) + ".json")
        raw = json.dumps(value).encode()
        with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as f:
            f.write(raw)
        env = {"YIJIE_FEAT164_DAILY_BINDING_FILE": str(path), "YIJIE_FEAT164_DAILY_BINDING_SHA256": digest or daily.digest(raw)}
        if paused is not None:
            env["YIJIE_KIMI_K31_EXECUTION_PAUSED"] = paused
        return daily.load_binding(self.candidate, stage, env)

    def test_d3_maintenance_positive(self):
        self.assertEqual(self.load("D3")[0]["host_home"], self.value["host_home"])

    def test_d4_paused_positive(self):
        value, digest = self.load("D4", "true")
        self.assertEqual(value["runtime_home"], self.value["runtime_home"])
        self.assertEqual(len(digest), 64)

    def test_d5_explicit_pause_both_values(self):
        for paused in ["true", "false"]:
            self.assertEqual(self.load("D5", paused)[0]["host_home"], self.value["host_home"])

    def test_record_preservation_and_no_default_home(self):
        files = list(self.origin.rglob("*.txt"))
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        self.load("D4", "true")
        self.assertEqual(before, {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
        self.assertFalse((self.candidate / ".local/feat164-daily/host-home").exists())

    def test_wrong_digest_refused(self):
        with self.assertRaisesRegex(ValueError, "binding digest"):
            self.load("D3", digest="c" * 64)

    def test_first_start_without_pause_refused(self):
        with self.assertRaisesRegex(ValueError, "first start must pause"):
            self.load("D4", "false")

    def test_missing_approval_field_refused(self):
        value = copy.deepcopy(self.value)
        del value["approval"]["reference"]
        with self.assertRaisesRegex(ValueError, "approval fields"):
            self.load("D3", value=value)


if __name__ == "__main__":
    unittest.main()
