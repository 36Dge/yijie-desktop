"""Normal parser/filesystem composition only. No App, executable fixture, service or model."""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


composition = module("primary_composition", "tests/feat164-d1-binding-test.py")
daily = composition.daily
primary = module("primary", "feat164_primary.py")


class PrimaryComposition(composition.BindingComposition):
    def prepare_parser_fixture(self, observe=False):
        root = self.origin
        for name in primary.SOURCE_NAMES:
            p = root.parent / name
            p.mkdir(exist_ok=True)
            def git(*a):
                return subprocess.check_output(["git", "-C", str(p), *a], stderr=subprocess.STDOUT)
            git("init", "--quiet")
            (p / ".gitignore").write_text(".local/\n")
            (p / "ordinary-source.txt").write_text("ordinary synthetic source\n")
            git("add", ".gitignore", "ordinary-source.txt")
            git("-c", "user.name=Local test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "ordinary parser fixture")
        generation = "20261028-01"
        paths = primary.layout(root, generation)
        output = Path(paths["output_root"])
        output.mkdir(parents=True, mode=0o700)
        env = primary.build_environment({"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"}, observe)
        primary.write_new(output / "environment.json", env)
        primary.write_new(output / "generation.json", {"schema_version": 1, "feature": "FEAT-164", "policy": primary.POLICY,
            "layout": paths, "sources": primary.source_facts(root), "environment_sha256": primary.digest(primary.json_bytes(env))})
        _, _, descriptor_sha, _ = primary.checked_generation(root, generation)
        value = copy.deepcopy(self.value)
        value.update(schema_version=3, policy=primary.POLICY, primary_source={"kind": "original-main-checkout", "root": str(root),
                     "generation": generation, "descriptor_sha256": descriptor_sha})
        value["approval"]["stage"] = "D4"
        receipt = {"deployment_policy": daily.POLICY, "release": False, "primary_policy": primary.POLICY,
                   "primary_source": {"descriptor_sha256": descriptor_sha},
                   "inputs": {"sources": {"scripts/feat164-daily-deployment.py": {"sha256": daily.digest((SCRIPTS / "feat164-daily-deployment.py").read_bytes())}}}}
        primary.write_new(Path(paths["receipt"]), receipt)
        value["receipt_sha256"] = primary.digest(primary.json_bytes(receipt))
        return value, paths

    def load_primary(self, value, paths, paused="true", stage="D4"):
        file = Path(paths["output_root"]) / "ordinary-binding.json"
        primary.write_new(file, value)
        return daily.load_binding(self.origin, stage, {"YIJIE_FEAT164_PRIMARY_GENERATION": paths["generation"],
            "YIJIE_FEAT164_DAILY_BINDING_FILE": str(file), "YIJIE_FEAT164_DAILY_BINDING_SHA256": primary.digest(primary.json_bytes(value)),
            "YIJIE_KIMI_K31_EXECUTION_PAUSED": paused})

    def test_primary_d4_real_loader_preserves_original_homes(self):
        value, paths = self.prepare_parser_fixture()
        loaded, _ = self.load_primary(value, paths)
        self.assertEqual(loaded["host_home"], str(self.origin / ".local/demo-fast/host-home"))
        self.assertFalse((Path(paths["output_root"]) / "host-home").exists())
        self.assertNotIn("daily-source", paths["bundle"])

    def test_primary_d5_same_identity_and_explicit_approval(self):
        value, paths = self.prepare_parser_fixture()
        value["approval"] = {"stage": "D5", "reference": "ordinary-owner-primary-D5", "approved_at": "2026-10-01T00:00:00+00:00", "active": True,
            "d4_evidence_sha256": "a" * 64, "activation_preflight_sha256": "b" * 64, "kimi_model": "kimi-k3.1-pro",
            "permission_policy": "existing-native-user-and-plan-authorization", "workflow_mode": "existing-ready-only", "verification_model_http_limit": 0,
            "authority_adr": "ADR-0022", "scope": "single-owner-local-only"}
        self.assertEqual(self.load_primary(value, paths, "false", "D5")[0], value)

    def test_primary_cannot_reuse_old_separate_source_or_authorize_d3(self):
        value, _ = self.prepare_parser_fixture()
        for stage, root in [("D3", self.origin), ("D4", self.candidate)]:
            with self.assertRaises(ValueError):
                daily.validate_binding(value, desktop=root, receipt_sha=value["receipt_sha256"], native_directory=Path(value["native_data_directory"]),
                    stage=stage, paused="true", now=dt.datetime.now(dt.timezone.utc))

    def test_descriptor_mismatch_refused(self):
        value, paths = self.prepare_parser_fixture()
        value["primary_source"]["descriptor_sha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "descriptor binding"):
            self.load_primary(value, paths)

    def test_changed_source_refused_without_updating_receipt(self):
        value, paths = self.prepare_parser_fixture()
        (self.origin / "ordinary-source.txt").write_text("ordinary next edit\n")
        with self.assertRaisesRegex(ValueError, "not committed and clean"):
            self.load_primary(value, paths)

    def test_open_does_not_create_approval(self):
        _, paths = self.prepare_parser_fixture()
        with self.assertRaises(FileNotFoundError):
            primary.open_daily(self.origin, paths["generation"], "D5", False)
        self.assertFalse((Path(paths["output_root"]) / "activation/d5.json").exists())

    def test_observation_open_cannot_dispatch_implicitly_or_with_unavailable_meter(self):
        value, paths = self.prepare_parser_fixture(observe=True)
        activation = Path(paths["output_root"]) / "activation"
        activation.mkdir(mode=0o700)
        binding = activation / "binding-d4.json"
        primary.write_new(binding, value)
        primary.write_new(activation / "d4.json", {"stage": "D4", "binding_file": str(binding),
            "binding_sha256": primary.digest(binding.read_bytes())})
        before = {p: p.read_bytes() for p in activation.iterdir()}
        with patch.object(primary, "invoke") as invoke, patch.object(primary.http.client, "HTTPConnection") as connect:
            with self.assertRaisesRegex(primary.ObservationLaunchError, "不能作为普通日常入口"):
                primary.open_daily(self.origin, paths["generation"], "D4", True)
            connect.assert_not_called()
            connect.return_value.request.side_effect = ConnectionRefusedError()
            with self.assertRaisesRegex(primary.ObservationLaunchError, "未就绪或已停止"):
                primary.open_daily(self.origin, paths["generation"], "D4", True, feat162_observe=True)
            invoke.assert_not_called()
        self.assertEqual(before, {p: p.read_bytes() for p in activation.iterdir()})

    def test_environment_and_command_are_primary_only(self):
        env = primary.build_environment({"HOME": str(Path.home()), "PATH": "/usr/bin:/bin", "YIJIE_PERMISSION_VERIFICATION_BASE_URL": "ordinary",
                                         "TAURI_CONFIG": "ordinary", "YIJIE_AGENT_HOST_HOME": "ordinary"})
        cmd, actual = primary.invocation(self.origin, "20261028-01", env, ["--prepare-only"])
        self.assertEqual(cmd[1], str(self.origin / "scripts/run-local-demo-fast.sh"))
        self.assertEqual(actual["CARGO_TARGET_DIR"], str(self.origin / ".local/builds/primary/20261028-01/target"))
        self.assertFalse({"TAURI_CONFIG", "YIJIE_AGENT_HOST_HOME", "YIJIE_PERMISSION_VERIFICATION_BASE_URL"} & set(actual))

    def test_new_generation_and_records_are_exclusive(self):
        _, paths = self.prepare_parser_fixture()
        file = Path(paths["output_root"]) / "generation.json"
        before = file.read_bytes()
        with self.assertRaises(FileExistsError):
            primary.write_new(file, {"ordinary": "different"})
        self.assertEqual(file.read_bytes(), before)
        with self.assertRaises(ValueError):
            primary.layout(self.origin, "ordinary-generation")


if __name__ == "__main__":
    unittest.main()
