"""Ordinary source and dependency changes, using only in-memory digest records."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import development_build_plan as build


class BuildPlanTest(unittest.TestCase):
    def setUp(self):
        self.sources = {"profile": {}, "resources": {"ordinary": "resource-v1"}, "embedded": {"native": ["yijie-desktop/contracts/native-skill-resources.candidate.json"], "media": ["yijie-agent-host/api/schemas/media-generation-v1.schema.json"], "host": ["yijie-agent-host/api/jsonschema/session-event.schema.json"]}, "files": {
            "yijie-desktop/src/App.vue": "view-v1", "yijie-desktop/public/logo.svg": "logo-v1",
            "yijie-desktop/src-tauri/src/lib.rs": "native-v1", "yijie-desktop/contracts/native-skill-resources.candidate.json": "pin-v1",
            "yijie-desktop/contracts/native-skill-build.candidate.json": "provenance-v1",
            "yijie-agent-host/internal/session/service.go": "host-v1", "yijie-agent-host/internal/session/service_test.go": "tests-v1",
            "yijie-agent-host/artifact-mcp/src/main.rs": "media-v1", "yijie-agent-host/api/schemas/media-generation-v1.schema.json": "schema-v1",
            "yijie-connectors/worker/src/main.rs": "worker-v1", "yijie-codex/codex-rs/rmcp-client/src/lib.rs": "library-v1",
        }}
        self.cache = {"key": "bucket-v1", "identity": {"cargo": "cargo", "rustc": "rustc", "host_go": "go", "tools": {"cargo": "/tools/cargo", "rustc": "/tools/rustc", "go": "/tools/go"}, "sdk": "sdk", "target": "arm64", "profile": "dev", "features": {"desktop": ["candidate"], "worker": [], "artifact": []}, "environment": {}, "flags": "canonical", "inputs": {"yijie-desktop/src-tauri/Cargo.lock": "native-lock", "yijie-connectors/worker/Cargo.lock": "worker-lock", "yijie-agent-host/artifact-mcp/Cargo.lock": "media-lock", "/workspace/.cargo/config.toml": None}}}
        self.actual = {key: str(index) * 64 for index, key in enumerate(["desktop", "helper", "host", "worker", "media"], 1)}
        self.previous = {"plan_version": build.VERSION, "component_inputs": build.fingerprints(self.sources, self.cache), "artifacts": self.actual.copy()}

    def plan(self, sources=None, cache=None, actual=None):
        return build.plan(build.fingerprints(sources or self.sources, cache or self.cache), self.previous, self.actual if actual is None else actual)["actions"]

    def change(self, file):
        value = deepcopy(self.sources)
        value["files"][file] = "ordinary-new-content"
        return value

    def rebuilt(self, plan):
        return {key for key, action in plan.items() if action == "build"}

    def test_frontend_edit_addition_deletion_never_rebuilds_native_or_sidecars(self):
        for file in ["yijie-desktop/src/App.vue", "yijie-desktop/public/logo.svg", "yijie-desktop/src/new-page.vue", "yijie-desktop/index.html", "yijie-desktop/vite.config.ts"]:
            value = self.change(file)
            self.assertEqual(self.rebuilt(self.plan(value)), set(), file)
            self.assertEqual(self.plan(value)["resources"], "verify")
            value["files"][file] = None
            self.assertEqual(self.rebuilt(self.plan(value)), set(), file)

    def test_external_resource_content_only_rebundles(self):
        value = deepcopy(self.sources)
        value["resources"]["ordinary"] = "resource-v2"
        self.assertEqual(self.rebuilt(self.plan(value)), set())
        self.assertEqual(self.plan(value)["resources"], "bundle")
        file_change = self.plan(self.change("yijie-desktop/src-tauri/resources/manual.txt"))
        self.assertEqual(self.rebuilt(file_change), set())
        self.assertEqual(file_change["resources"], "bundle")

    def test_embedded_resource_authority_rebuilds_native_and_shared_helper(self):
        result = self.plan(self.change("yijie-desktop/contracts/native-skill-resources.candidate.json"))
        self.assertEqual(self.rebuilt(result), {"native", "helper"})
        self.assertEqual(result["resources"], "bundle")

    def test_native_code_does_not_rebuild_unrelated_sidecars(self):
        self.assertEqual(self.rebuilt(self.plan(self.change("yijie-desktop/src-tauri/src/lib.rs"))), {"native", "helper"})

    def test_host_worker_media_inputs_are_independent(self):
        for file, expected in [("yijie-agent-host/internal/session/service.go", {"host"}), ("yijie-connectors/worker/src/main.rs", {"worker"}), ("yijie-agent-host/artifact-mcp/src/main.rs", {"media"}), ("yijie-codex/codex-rs/rmcp-client/src/lib.rs", {"worker"}), ("yijie-agent-host/api/schemas/media-generation-v1.schema.json", {"media"})]:
            result = self.plan(self.change(file))
            self.assertEqual(self.rebuilt(result), expected, file)
            self.assertEqual(result["resources"], "verify")

    def test_provenance_or_go_test_changes_do_not_rebuild_binaries(self):
        for file in ["yijie-desktop/contracts/native-skill-build.candidate.json", "yijie-agent-host/internal/session/service_test.go"]:
            self.assertEqual(self.rebuilt(self.plan(self.change(file))), set())

    def test_go_embedded_schema_and_new_api_go_files_rebuild_host(self):
        for file in ["yijie-agent-host/api/jsonschema/session-event.schema.json", "yijie-agent-host/api/new-helper.go"]:
            self.assertEqual(self.rebuilt(self.plan(self.change(file))), {"host"})

    def test_worker_toolchain_input_does_not_invalidate_native_bucket(self):
        cache = deepcopy(self.cache)
        cache["key"] = "new-shared-bucket"
        cache["identity"]["inputs"]["yijie-connectors/worker/Cargo.lock"] = "new-worker-lock"
        self.assertEqual(self.rebuilt(self.plan(cache=cache)), {"worker"})

    def test_go_toolchain_change_only_rebuilds_host(self):
        cache = deepcopy(self.cache)
        cache["identity"]["host_go"] = "new-go"
        self.assertEqual(self.rebuilt(self.plan(cache=cache)), {"host"})

    def test_missing_component_output_requires_only_its_build(self):
        actual = {**self.actual, "media": None}
        self.assertEqual(self.rebuilt(self.plan(actual=actual)), {"media"})

    def test_shared_configuration_and_new_build_scripts_are_conservative(self):
        self.assertEqual(self.rebuilt(self.plan(self.change("yijie-desktop/scripts/new-build-helper.py"))), set(build.COMPILED))
        self.assertEqual(self.rebuilt(self.plan(self.change("yijie-desktop/src-tauri/tauri.conf.json"))), {"native", "helper"})

    def test_legacy_receipt_requires_one_component_baseline(self):
        result = build.plan(build.fingerprints(self.sources, self.cache), {"artifacts": self.actual}, self.actual)
        self.assertEqual(self.rebuilt(result["actions"]), set(build.COMPILED))


if __name__ == "__main__":
    unittest.main()
