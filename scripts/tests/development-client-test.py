"""Pure normal-configuration checks; no real process, secret or database access."""
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("development", Path(__file__).resolve().parents[1] / "development-client.py")
development = importlib.util.module_from_spec(spec)
spec.loader.exec_module(development)

class DevelopmentClientTest(unittest.TestCase):
    def test_tool_search_meter_is_explicit_and_keeps_fixed_origin(self):
        root = Path("/workspace/yijie-desktop")
        source = {"PATH": "/usr/bin", "HOME": str(Path.home()),
                  "YIJIE_FEAT170_TOOL_SEARCH_METER": "true",
                  "YIJIE_PERMISSION_VERIFICATION_BASE_URL": "http://127.0.0.1:18084/v1"}
        with patch.object(development, "supported_go", return_value="/existing/toolchain/bin"):
            ordinary = development.environment(root, source)
            self.assertNotIn("YIJIE_PERMISSION_VERIFICATION_BASE_URL", ordinary)
            self.assertNotIn("YIJIE_FEAT170_TOOL_SEARCH_METER", ordinary)
            selected = development.environment(root, source, tool_search_meter=True)
            self.assertEqual(selected["YIJIE_PERMISSION_VERIFICATION_BASE_URL"], "http://127.0.0.1:18083/v1")
            self.assertEqual(selected["CARGO_TARGET_DIR"], ordinary["CARGO_TARGET_DIR"])
            with self.assertRaises(ValueError):
                development.environment(root, {**source, "YIJIE_FEAT170_TOOL_SEARCH": "false"}, tool_search_meter=True)

    def test_daily_images_can_be_paused_without_changing_the_database(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            selected = {"output": base / "development", "native": base / "native"}
            selected["output"].mkdir()
            (selected["native"] / "chat").mkdir(parents=True)
            database = selected["native"] / "chat/conversations.db"
            self.assertFalse(development.daily_images_setting(selected["output"]))
            with self.assertRaises(ValueError):
                development.set_daily_images(selected, True)
            database.write_bytes(b"retained normal fixture")
            for enabled in (True, True, False):
                development.set_daily_images(selected, enabled)
                self.assertEqual(development.daily_images_setting(selected["output"]), enabled)
                self.assertEqual(database.read_bytes(), b"retained normal fixture")

    def test_interaction_selector_keeps_exact_boolean_without_extra_overrides(self):
        root = Path("/workspace/yijie-desktop")
        source = {"PATH": "/usr/bin", "HOME": str(Path.home())}
        with patch.object(development, "supported_go", return_value="/existing/toolchain/bin"):
            self.assertEqual(development.environment(root, source)["YIJIE_FEAT169_INTERACTION_TOOLS"], "true")
            self.assertEqual(development.environment(root, {**source, "YIJIE_FEAT169_INTERACTION_TOOLS": "false"})["YIJIE_FEAT169_INTERACTION_TOOLS"], "false")
            with self.assertRaises(ValueError):
                development.environment(root, {**source, "YIJIE_FEAT169_INTERACTION_TOOLS": "ordinary-selector"})

    def test_tool_search_selector_requires_paired_interaction_profile(self):
        root = Path("/workspace/yijie-desktop")
        source = {"PATH": "/usr/bin", "HOME": str(Path.home())}
        with patch.object(development, "supported_go", return_value="/existing/toolchain/bin"):
            self.assertEqual(development.environment(root, source)["YIJIE_FEAT170_TOOL_SEARCH"], "true")
            self.assertEqual(development.environment(root, {**source, "YIJIE_FEAT170_TOOL_SEARCH": "false"})["YIJIE_FEAT170_TOOL_SEARCH"], "false")
            self.assertEqual(development.environment(root, {**source, "YIJIE_FEAT169_INTERACTION_TOOLS": "false"})["YIJIE_FEAT170_TOOL_SEARCH"], "false")
            self.assertEqual(development.environment(root, {**source, "YIJIE_FEAT170_TOOL_SEARCH": "true"})["YIJIE_FEAT170_TOOL_SEARCH"], "true")
            with self.assertRaises(ValueError):
                development.environment(root, {**source, "YIJIE_FEAT170_TOOL_SEARCH": "ordinary-selector"})
            with self.assertRaises(ValueError):
                development.environment(root, {**source, "YIJIE_FEAT170_TOOL_SEARCH": "true", "YIJIE_FEAT169_INTERACTION_TOOLS": "false"})

    def test_fixed_output_keeps_original_daily_homes(self):
        root = Path("/workspace/yijie-desktop")
        selected = development.paths(root, Path("/Users/owner"))
        self.assertEqual(selected["target"], root / ".local/development/target")
        self.assertEqual(selected["host"], root / ".local/demo-fast/host-home")
        self.assertEqual(selected["runtime"], root / ".local/demo-fast/codex-home")
        self.assertEqual(selected["native"], Path("/Users/owner/Library/Application Support/com.yijie.ai/demo-fast-v1"))
        self.assertEqual(selected, development.paths(root, Path("/Users/owner")))

    def test_v6_receipt_allows_only_the_fixed_fresh_home(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve() / "yijie-desktop"
            root.mkdir()
            (root / ".git").mkdir()
            selected = development.paths(root, Path(folder).resolve() / "user")
            for key in ("native", "host", "runtime", "output"):
                selected[key].mkdir(mode=0o700, parents=True)
            (selected["native"] / "secrets").mkdir()
            (selected["native"] / "secrets/chat-sqlcipher-v1.secret").write_text("ordinary-fixture-key")
            with patch.object(development, "stopped"):
                with self.assertRaises(ValueError):
                    development.check(root, Path(folder).resolve() / "user")
                (selected["output"] / "trace-v6-reset.json").write_text(json.dumps({"schemaVersion": 1, "nativeFormat": 6, "sseVersion": 13, "ipcVersion": 6}))
                self.assertEqual(development.check(root, Path(folder).resolve() / "user"), selected)
                self.assertFalse((selected["native"] / "chat/conversations.db").exists())

    def test_environment_does_not_reuse_packaged_or_observation_overrides(self):
        root = Path("/workspace/yijie-desktop")
        original = {"PATH": "/usr/bin", "HOME": str(Path.home()), "YIJIE_FEAT164_PRIMARY_GENERATION": "20261031-01",
                    "YIJIE_FEAT162_OBSERVATION_PROFILE": "old-profile", "TAURI_CONFIG": "old-config",
                    "YIJIE_AGENT_HOST_HOME": "/old-profile", "VITE_YIJIE_EXPERTS_ENABLED": "false",
                    "YIJIE_FEAT168_DAILY_IMAGES": "true", "YIJIE_FEAT168_HOST_IMAGES": "true"}
        with patch.object(development, "supported_go", return_value="/existing/toolchain/bin"):
            env = development.environment(root, original)
        self.assertEqual(env["YIJIE_DEVELOPMENT_CLIENT"], "true")
        self.assertEqual(env["YIJIE_FEAT168_DAILY_IMAGES"], "false")
        self.assertNotIn("YIJIE_FEAT168_HOST_IMAGES", env)
        self.assertEqual(env["CARGO_TARGET_DIR"], str(root / ".local/development/target"))
        self.assertEqual(env["PATH"], "/existing/toolchain/bin:/usr/bin")
        for key in ("TAURI_CONFIG", "YIJIE_FEAT164_PRIMARY_GENERATION", "YIJIE_FEAT162_OBSERVATION_PROFILE", "YIJIE_AGENT_HOST_HOME", "VITE_YIJIE_EXPERTS_ENABLED"):
            self.assertNotIn(key, env)

if __name__ == "__main__":
    unittest.main()
