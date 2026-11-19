"""Normal source/provenance scenarios; no executable fixtures or live processes."""
import hashlib
import importlib.util
import json
import sys
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).resolve().parents[1] / "development_preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class StartupFreshnessTest(unittest.TestCase):
    def test_workflow_provenance_reconstructs_the_recorded_tree_and_checks_copied_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp).resolve()
            def git(*args):
                return subprocess.check_output(["git", "-C", str(folder), *args])
            git("init", "-q")
            (folder / "web.go").write_text("package web\n")
            (folder / "workflow").mkdir()
            copied = folder / "workflow/flow.go"
            copied.write_text("package workflow\n")
            (folder / "Dockerfile.workflow-local").write_text("FROM scratch\nCOPY workflow /src/workflow\n")
            git("add", ".")
            git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "workflow source")
            expected = preflight.candidate_digest(preflight.repository_hashes(folder))
            (folder / "web.go").write_text("package retrieval\n")
            (folder / "new-web.go").write_text("package web\n")
            revision = preflight.recorded_revision(folder, preflight.repository_hashes(folder), expected)
            self.assertEqual(revision, git("rev-parse", "HEAD").decode().strip())
            inputs = preflight.workflow_api_inputs(folder)
            self.assertEqual(git("diff", "--name-only", revision, "--", *inputs), b"")
            copied.write_text("package updated\n")
            self.assertIn(b"workflow/flow.go", git("diff", "--name-only", revision, "--", *inputs))
            (folder / "workflow/new.go").write_text("package workflow\n")
            self.assertIn(b"workflow/new.go", git("ls-files", "--others", "--exclude-standard", "--", *inputs))

    def test_existing_repository_document_links_include_their_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            document = root / "LICENSE.txt"
            document.write_text("ordinary license text")
            link = root / "LICENSE"
            link.symlink_to("LICENSE.txt")
            self.assertEqual(preflight.source_hash(link, root, include_link=False), preflight.sha(document))
            before = preflight.source_hash(link, root)
            document.write_text("updated license text")
            self.assertNotEqual(before, preflight.source_hash(link, root))

    def test_content_changes_are_detected_without_file_timestamps(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            project = workspace / "yijie-desktop"
            (project / "src").mkdir(parents=True)
            source = project / "src/view.vue"
            source.write_text("<p>one</p>")
            with patch.dict(preflight.INPUTS, {"yijie-desktop": ["src"]}, clear=True), patch.object(preflight.subprocess, "check_output", return_value=b"src/view.vue\0"):
                first = preflight.snapshot(project, {})
                self.assertEqual(first, preflight.snapshot(project, {}))
                source.write_text("<p>two</p>")
                second = preflight.snapshot(project, {})
                self.assertNotEqual(preflight.digest(first), preflight.digest(second))
                with self.assertRaisesRegex(ValueError, "编译期间源码发生变化"):
                    preflight.require_unchanged(first, second)

    def test_removed_source_and_profile_change_are_not_reused(self):
        before = {"files": {"src/view.vue": "abc"}, "profile": {"skills": "true"}}
        with self.assertRaises(ValueError):
            preflight.require_unchanged(before, {**before, "files": {"src/view.vue": None}})
        with self.assertRaises(ValueError):
            preflight.require_unchanged(before, {**before, "profile": {"skills": "false"}})

    def test_source_check_failure_does_not_record_a_successful_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".local/development").mkdir(parents=True)
            with patch.object(preflight, "workflow_sources_current", return_value=[]), patch.object(preflight, "refresh_sources", side_effect=ValueError("normal source mismatch")):
                with self.assertRaisesRegex(ValueError, "source mismatch"):
                    preflight.prepare(root, {}, "cache")
            self.assertFalse(preflight.state_file(root, "startup-build.json").exists())
            preflight.failure(root)
            self.assertEqual(json.loads(preflight.state_file(root, "startup-status.json").read_text())["phase"], "failed")

    def test_source_verification_precedes_the_build_record_and_next_open_reuses_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".local/development").mkdir(parents=True)
            sources = {"files": {"src/view.vue": "abc"}, "profile": {}}
            events = []
            with patch.object(preflight, "workflow_sources_current", return_value=[]), patch.object(preflight, "refresh_sources", side_effect=lambda *_: events.append("refresh")), patch.object(preflight, "run", side_effect=lambda *_: events.append("check")), patch.object(preflight, "snapshot", side_effect=lambda *_: events.append("snapshot") or sources):
                first_id = preflight.prepare(root, {}, "cache")
                first = json.loads(preflight.state_file(root).read_text())
                self.assertTrue(first["source_changed"])
                self.assertEqual(events, ["refresh", "check", "snapshot"])
                preflight.write_state(root, first, "startup-build.json")
                second_id = preflight.prepare(root, {}, "cache")
                self.assertNotEqual(first_id, second_id)
                self.assertFalse(json.loads(preflight.state_file(root).read_text())["source_changed"])

    def test_workflow_candidate_digest_uses_ordered_paths_and_content(self):
        files = {"b.go": hashlib.sha256(b"two").digest(), "a.go": hashlib.sha256(b"one").digest()}
        expected = hashlib.sha256(b"a.go\0" + files["a.go"] + b"b.go\0" + files["b.go"]).hexdigest()
        self.assertEqual(preflight.candidate_digest(files), expected)

    def test_sidecar_reuse_requires_this_run_and_unchanged_artifact_digests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".local/development").mkdir(parents=True)
            expected = {"host": "host-digest", "worker": "worker-digest", "media": "media-digest"}
            record = {"schema_version": 1, "run_id": "current", "phase": "building", "plan_version": 2,
                      "reusable_artifacts": expected, "build_plan": {"actions": {key: "reuse" for key in expected}}}
            preflight.write_state(root, record)
            with patch.object(preflight, "artifact_inventory", return_value=expected):
                self.assertEqual(preflight.sidecar_decisions(root, "current"), "false false false")
                with self.assertRaises(ValueError):
                    preflight.sidecar_decisions(root, "previous")
            with patch.object(preflight, "artifact_inventory", return_value={**expected, "worker": "new-digest"}):
                with self.assertRaisesRegex(ValueError, "复用产物不一致"):
                    preflight.sidecar_decisions(root, "current")


if __name__ == "__main__":
    unittest.main()
