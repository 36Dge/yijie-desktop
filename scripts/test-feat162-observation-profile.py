"""Pure environment construction: no Git fixture, process start or model."""
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("primary", Path(__file__).with_name("feat164_primary.py"))
primary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(primary)


class ObservationProfileTests(unittest.TestCase):
    def test_only_explicit_prepare_adds_the_frozen_meter(self):
        env = {"HOME": str(Path.home()), "PATH": "/usr/bin:/bin", "YIJIE_PERMISSION_VERIFICATION_BASE_URL": "unselected"}
        normal = primary.build_environment(env)
        self.assertNotIn("YIJIE_PERMISSION_VERIFICATION_BASE_URL", normal)
        observation = primary.build_environment(env, True)
        self.assertEqual(observation["YIJIE_PERMISSION_VERIFICATION_BASE_URL"], "http://127.0.0.1:18083/v1")
        self.assertEqual(primary.build_environment(observation, True), observation)
        self.assertEqual({k:v for k,v in observation.items() if k not in primary.OBSERVATION_ENV}, normal)
        self.assertNotIn("paid_authorized", observation)
        self.assertNotIn("max_output_tokens", observation)


if __name__ == "__main__": unittest.main()
