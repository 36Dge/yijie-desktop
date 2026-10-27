"""Ordinary values and retained synthetic directories only; no service/model calls."""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shlex
import unittest

ROOT = Path(__file__).resolve().parents[1]
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

composition = module("d1_tests", "tests/feat164-d1-binding-test.py")
daily = composition.daily
entry = module("entry", "install-feat164-daily-entry.py")


class DailyActivation(composition.BindingComposition):
    def activation(self):
        value = copy.deepcopy(self.value)
        value.update(schema_version=2, policy=daily.ACTIVATION_POLICY)
        value["approval"] = {"stage": "D5", "reference": "ordinary-owner-D5", "approved_at": "2026-10-01T00:00:00+00:00", "active": True,
                             "d4_evidence_sha256": "a" * 64, "activation_preflight_sha256": "b" * 64, "kimi_model": "kimi-k3.1-pro",
                             "permission_policy": "existing-native-user-and-plan-authorization", "workflow_mode": "existing-ready-only", "verification_model_http_limit": 0, "authority_adr": "ADR-0022", "scope": "single-owner-local-only"}
        receipt = self.candidate / ".local/feat164-daily/packaged-launch-receipt.json"
        data = json.loads(receipt.read_text()); data["activation_policy"] = daily.ACTIVATION_POLICY; receipt.write_text(json.dumps(data))
        value["receipt_sha256"] = daily.digest(receipt.read_bytes())
        return value

    def test_durable_record_composes_with_real_loader_and_preserves_homes(self):
        value = self.activation()
        for paused in ["false", "true"]:
            loaded, _ = self.load("D5", paused, value)
            self.assertEqual(loaded, value)
        self.assertFalse((self.candidate / ".local/feat164-daily/host-home").exists())

    def test_next_day_and_later_restarts_keep_owner_scope(self):
        value = self.activation()
        for year in [2026, 2027]:
            daily.validate_binding(value, desktop=self.candidate, receipt_sha=value["receipt_sha256"], native_directory=Path(value["native_data_directory"]), stage="D5", paused="false", now=dt.datetime(year, 11, 1, tzinfo=dt.timezone.utc))
        self.assertNotIn("no_dispatchable_work", value["approval"])

    def test_disabled_future_or_incomplete_activation_refused(self):
        original = self.activation()
        for patch in [{"active": False}, {"authority_adr": "unknown"}, {"scope": "public"}, {"approved_at": "2099-01-01T00:00:00Z"}, {"workflow_mode": "future-mode"}, {"permission_policy": "unknown"}, {"kimi_model": "kimi-k3"}, {"d4_evidence_sha256": ""}]:
            value = copy.deepcopy(original); value["approval"].update(patch)
            with self.assertRaises(ValueError): self.load("D5", "false", value)
        value = copy.deepcopy(original); del value["approval"]["active"]
        with self.assertRaises(ValueError): self.load("D5", "false", value)

    def test_durable_record_never_authorizes_maintenance_or_first_start(self):
        for stage in ["D3", "D4"]:
            with self.assertRaisesRegex(ValueError, "activation stage"):
                self.load(stage, "true", self.activation())

    def test_old_artifact_without_activation_policy_refuses_new_record(self):
        value = self.activation(); receipt = self.candidate / ".local/feat164-daily/packaged-launch-receipt.json"
        data = json.loads(receipt.read_text()); del data["activation_policy"]; receipt.write_text(json.dumps(data)); value["receipt_sha256"] = daily.digest(receipt.read_bytes())
        with self.assertRaisesRegex(ValueError, "artifact activation policy"): self.load("D5", "false", value)

    def test_entry_environment_is_explicit_and_canonical(self):
        env = entry.entry_environment({"PATH": "/tools", "HOME": str(Path.home())}, self.root / "ordinary binding.json", "a" * 64, False)
        body = entry.render_entry(self.candidate, env)
        argv = shlex.split(body.split("\nexec ", 1)[1])
        self.assertEqual(argv[:2], ["/usr/bin/env", "-i"])
        self.assertIn("YIJIE_KIMI_K31_EXECUTION_PAUSED=false", argv)
        self.assertEqual(argv[-4:], [str(self.candidate / "scripts/run-local-demo-fast.sh"), "--packaged", "--kimi-k31-daily", "--reopen"])
        self.assertNotIn("--migrate", body)
        with self.assertRaisesRegex(ValueError, "environment keys"):
            entry.entry_environment({"PATH": "/tools", "HOME": str(Path.home()), "YIJIE_PERMISSION_VERIFICATION_BASE_URL": "ordinary"}, self.root / "binding.json", "a" * 64, False)


if __name__ == "__main__":
    unittest.main()
