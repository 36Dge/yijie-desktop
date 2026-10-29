"""Stop-only consumer of existing canonical Host owner HTTP operations.

No new Host authority, API or execution approval. Credentials stay in memory;
only an exact active session/thread/turn match can become a stop target.
"""
import hashlib
import http.client
import json
from urllib.parse import urlsplit
from uuid import UUID


def require(value, message):
    if not value:
        raise ValueError(message)


def identifier(value):
    require(isinstance(value, str) and str(UUID(value)) == value and UUID(value).int != 0,
            "Canonical nonzero identity required")
    return value


class OwnerStop:
    def __init__(self, url, token):
        parsed = urlsplit(url)
        require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port
                and not parsed.username and not parsed.password and parsed.path in {"", "/"}
                and not parsed.query and not parsed.fragment, "Exact loopback Host origin required")
        require(isinstance(token, str) and token and not any(c.isspace() for c in token), "Owner credential required")
        self.port, self._token, self.binding = parsed.port, token, None

    def _request(self, method, target, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, target, body=body, headers={"Authorization": "Bearer " + self._token,
                                                                  "Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(32769)
            require(len(data) <= 32768, "Bounded Host reply required")
            return response.status, data
        finally:
            connection.close()

    def bind(self, session_id, thread_id, turn_id):
        self.binding = None
        target = tuple(identifier(v) for v in (session_id, thread_id, turn_id))
        status, data = self._request("GET", f"/v1/agent-sessions/{target[0]}")
        require(status == 200, "Host identity read not confirmed")
        session = json.loads(data)["session"]
        require((session.get("agent_session_id"), session.get("codex_thread_id"), session.get("active_turn_id")) == target
                and session.get("state") == "active", "Host active identity differs")
        self.binding = target
        return hashlib.sha256(json.dumps(target).encode()).hexdigest()

    def stop(self):
        require(self.binding is not None, "No verified owner stop target")
        session_id, _, turn_id = self.binding
        status, body = self._request("POST", f"/v1/agent-sessions/{session_id}/turns/{turn_id}/interrupt", b"{}")
        require(status == 204 and not body, "Host normal interruption not confirmed")
        return {"status": "host_acknowledged", "http_status": 204,
                "binding_sha256": hashlib.sha256(json.dumps(self.binding).encode()).hexdigest()}
