"""Pure environment construction: no Git fixture, process start or model."""
import importlib.util
import http.client
import http.server
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
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

    def test_daily_launch_never_probes_or_inherits_an_observation_endpoint(self):
        normal = primary.build_environment({"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"})
        with patch.object(primary.http.client, "HTTPConnection") as connect:
            primary.check_observation_launch(normal, False)
            with self.assertRaisesRegex(primary.ObservationLaunchError, "不是 FEAT-162"):
                primary.check_observation_launch(normal, True)
            connect.assert_not_called()

    def test_observation_requires_fresh_explicit_selection_even_when_kimi_is_paused(self):
        environment = {**primary.OBSERVATION_ENV, "YIJIE_KIMI_K31_EXECUTION_PAUSED": "true"}
        before = dict(environment)
        with patch.object(primary.http.client, "HTTPConnection") as connect:
            with self.assertRaisesRegex(primary.ObservationLaunchError, "不能作为普通日常入口"):
                primary.check_observation_launch(environment, False)
            connect.assert_not_called()
        self.assertEqual(environment, before)

    def test_missing_meter_fails_closed_without_direct_fallback(self):
        with patch.object(primary.http.client, "HTTPConnection") as connect:
            connect.return_value.request.side_effect = ConnectionRefusedError()
            with self.assertRaisesRegex(primary.ObservationLaunchError, "不会自动直连模型"):
                primary.check_observation_launch(primary.OBSERVATION_ENV, True)
            connect.assert_called_once_with("127.0.0.1", 18083, timeout=2)
            connect.return_value.request.assert_called_once_with("GET", "/health")
            connect.return_value.close.assert_called_once()

    def test_health_is_read_only_bounded_and_does_not_arm_or_follow_redirects(self):
        health = {"feature": "FEAT-162", "offline": True, "armed": False, "halted": False}
        cases = [(200, health, True), (200, {**health, "offline": False}, True),
                 (200, {**health, "halted": True}, False),
                 (200, {**health, "feature": "unrelated"}, False),
                 (200, {**health, "armed": "false"}, False),
                 (200, {}, False), (200, [], False), (302, health, False),
                 (502, health, False), (200, "x" * 4097, False)]
        real_connection = http.client.HTTPConnection
        for status, body, accepted in cases:
            with self.subTest(status=status, body=str(body)[:80]):
                requests = []

                class HealthHandler(http.server.BaseHTTPRequestHandler):
                    def log_message(self, *_args):
                        pass

                    def do_GET(self):
                        requests.append((self.command, self.path, self.headers.get("Authorization")))
                        raw = json.dumps(body).encode()
                        self.send_response(status)
                        self.send_header("Content-Length", str(len(raw)))
                        self.send_header("Location", "http://example.invalid/")
                        self.end_headers()
                        self.wfile.write(raw)

                with http.server.HTTPServer(("127.0.0.1", 0), HealthHandler) as server:
                    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
                    worker.start()
                    try:
                        def connect(host, port, timeout):
                            self.assertEqual((host, port, timeout), ("127.0.0.1", 18083, 2))
                            return real_connection("127.0.0.1", server.server_port, timeout=timeout)

                        with patch.object(primary.http.client, "HTTPConnection", side_effect=connect):
                            if accepted:
                                primary.check_observation_launch(primary.OBSERVATION_ENV, True)
                            else:
                                with self.assertRaises(primary.ObservationLaunchError):
                                    primary.check_observation_launch(primary.OBSERVATION_ENV, True)
                    finally:
                        server.shutdown()
                        worker.join()
                self.assertEqual(requests, [("GET", "/health", None)])


if __name__ == "__main__": unittest.main()
