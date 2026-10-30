"""Normal metadata, advisory lock and parser checks. Never dispatch an App build."""
import copy
import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("primary_tests", Path(__file__).with_name("feat164-primary-test.py"))
primary_tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(primary_tests)
primary = primary_tests.primary
cache = primary.build_cache


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "yijie-desktop"
        self.root.mkdir()
        self.identity = {"workspace": str(self.root.parent), "toolchain": "ordinary", "sdk": "ordinary"}
        self.plan = cache.plan(self.root, self.identity)

    def test_stable_components_and_separate_final_outputs(self):
        self.assertEqual(cache.plan(self.root, self.identity), self.plan)
        env = {**primary.build_environment({"PATH": "/usr/bin:/bin", "HOME": str(Path.home())}),
               **cache.validate(self.root, self.plan)}
        _, a = primary.invocation(self.root, "20261030-01", env, ["--prepare-only"])
        _, b = primary.invocation(self.root, "20261030-02", env, ["--prepare-only"])
        self.assertNotEqual(a["CARGO_TARGET_DIR"], b["CARGO_TARGET_DIR"])
        self.assertNotEqual(a["YIJIE_WORKER_TARGET_DIR"], b["YIJIE_WORKER_TARGET_DIR"])
        for key in cache.COMPONENTS.values():
            self.assertEqual(a[key], b[key])
        self.assertEqual(len(set(cache.validate(self.root, self.plan).values())), 3)

    def test_changed_build_identity_selects_a_new_bucket(self):
        for field in ("toolchain", "sdk", "features", "flags", "lock"):
            value = {**self.identity, field: "next ordinary version"}
            self.assertNotEqual(cache.plan(self.root, value)["key"], self.plan["key"])

    def test_normal_lock_contention_and_release(self):
        with cache.acquire(self.root, self.plan):
            with self.assertRaisesRegex(ValueError, "another primary build"):
                with cache.acquire(self.root, self.plan):
                    self.fail("concurrent build admitted")
        with cache.acquire(self.root, self.plan):
            pass

    def test_capacity_stops_without_deleting(self):
        with cache.acquire(self.root, self.plan):
            marker = Path(self.plan["directories"]["desktop"]) / "ordinary.txt"
            marker.write_text("preserve this cache")
        low = shutil.disk_usage(self.root)._replace(free=1)
        with patch.object(cache.shutil, "disk_usage", return_value=low):
            with self.assertRaisesRegex(ValueError, "12 GiB"):
                with cache.acquire(self.root, self.plan):
                    self.fail("low-space build admitted")
        with patch.object(cache, "MAX_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "64 GiB"):
                with cache.acquire(self.root, self.plan):
                    self.fail("oversized build admitted")
        self.assertEqual(marker.read_text(), "preserve this cache")

    def test_bucket_limit_and_descriptor_validation(self):
        with cache.acquire(self.root, self.plan):
            pass
        with patch.object(cache, "MAX_BUCKETS", 1):
            with self.assertRaisesRegex(ValueError, "bucket limit"):
                with cache.acquire(self.root, cache.plan(self.root, {**self.identity, "sdk": "next"})):
                    self.fail("extra bucket admitted")
        value = copy.deepcopy(self.plan)
        value["directories"]["worker"] = value["directories"]["desktop"]
        with self.assertRaisesRegex(ValueError, "descriptor mismatch"):
            cache.validate(self.root, value)

    def test_preflight_precedes_compilers_and_components_have_explicit_cache(self):
        source = (primary_tests.SCRIPTS / "run-local-demo-fast.sh").read_text()
        worker = source.index('scripts/build-market-worker.sh" --output-root')
        for gate in ('check-native-conversation.mjs --require-committed', 'check-agent-host-v4-contract.mjs',
                     'verifyScheduledHostCandidate(process.cwd()', 'build-market-worker.sh" --check-only'):
            self.assertLess(source.index(gate), worker)
        base = primary_tests.SCRIPTS.parents[1]
        self.assertIn('export CARGO_BUILD_BUILD_DIR="$YIJIE_WORKER_BUILD_DIR"', (base / "yijie-connectors/scripts/build-market-worker.sh").read_text())
        self.assertIn('export CARGO_BUILD_BUILD_DIR="$YIJIE_ARTIFACT_BUILD_DIR"', (base / "yijie-agent-host/scripts/build-artifact-adapter.sh").read_text())


class DescriptorTests(primary_tests.PrimaryComposition):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        env = patch.dict(os.environ, {"FEAT164_D2_TEST_ROOT": str(Path(temp.name).resolve())})
        env.start()
        self.addCleanup(env.stop)
        super().setUp()

    def test_v2_cache_descriptor_without_cache_files_still_readable(self):
        _, paths = self.prepare_parser_fixture()
        output = Path(paths["output_root"])
        descriptor, _ = primary.read_json(output / "generation.json")
        environment, _ = primary.read_json(output / "environment.json")
        value = cache.plan(self.origin, {"workspace": str(self.origin.parent), "toolchain": "ordinary"})
        environment.update(cache.validate(self.origin, value))
        descriptor.update(schema_version=2, build_cache=value, environment_sha256=primary.digest(primary.json_bytes(environment)))
        # These are this test's ordinary metadata records, not protected generations.
        (output / "environment.json").write_bytes(primary.json_bytes(environment))
        (output / "generation.json").write_bytes(primary.json_bytes(descriptor))
        self.assertEqual(primary.checked_generation(self.origin, paths["generation"])[3], environment)
        self.assertFalse(cache.cache_root(self.origin).exists())

    def test_prepare_freezes_new_cache_metadata_without_rewriting_old_generation(self):
        _, old = self.prepare_parser_fixture()
        before = (Path(old["output_root"]) / "generation.json").read_bytes()
        value = cache.plan(self.origin, {"workspace": str(self.origin.parent), "toolchain": "ordinary"})
        with patch.object(cache, "discover", return_value=value), patch.object(primary, "invoke", return_value=0) as invoke:
            self.assertEqual(primary.prepare(self.origin, "20261030-01", {"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"}), 0)
            invoke.assert_called_once()
        _, descriptor, _, env = primary.checked_generation(self.origin, "20261030-01")
        self.assertEqual(descriptor["schema_version"], 2)
        self.assertEqual(env["CARGO_BUILD_BUILD_DIR"], value["directories"]["desktop"])
        self.assertEqual((Path(old["output_root"]) / "generation.json").read_bytes(), before)

    def test_prepare_keeps_old_generation_and_never_dispatches_on_failed_preflight(self):
        _, paths = self.prepare_parser_fixture()
        before = (Path(paths["output_root"]) / "generation.json").read_bytes()
        with patch.object(cache, "discover", side_effect=ValueError("ordinary missing toolchain")), patch.object(primary, "invoke") as invoke:
            with self.assertRaisesRegex(ValueError, "toolchain"):
                primary.prepare(self.origin, "20261030-01", {"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"})
            invoke.assert_not_called()
        self.assertEqual((Path(paths["output_root"]) / "generation.json").read_bytes(), before)
        self.assertFalse((self.origin / ".local/builds/primary/20261030-01").exists())


if __name__ == "__main__":
    unittest.main()
