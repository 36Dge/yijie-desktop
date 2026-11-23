"""Real Runtime/MCP/Host/Native acceptance with a loopback-only model protocol driver."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


OFFICE = "application/vnd.openxmlformats-officedocument."
FORMAT_MIME = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
    "svg": "image/svg+xml", "mp4": "video/mp4",
    "html": "text/html", "htm": "text/html", "txt": "text/plain", "csv": "text/csv",
    "json": "application/json", "pdf": "application/pdf", "md": "text/markdown", "markdown": "text/markdown",
    "xlsx": OFFICE + "spreadsheetml.sheet", "docx": OFFICE + "wordprocessingml.document",
    "pptx": OFFICE + "presentationml.presentation",
}


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def tool_value(value):
    if isinstance(value, str):
        text = value.partition("Output:")[2].lstrip() if value.startswith("Wall time:") and "Output:" in value else value
        try:
            return tool_value(json.loads(text))
        except ValueError:
            return text
    if isinstance(value, list) and len(value) == 1:
        return tool_value(value[0])
    if isinstance(value, dict):
        for key in ("content", "text"):
            if key in value:
                return tool_value(value[key])
    return value


class Case:
    def __init__(self, names, accepted):
        self.names = names
        self.accepted = accepted
        self.calls = {}
        self.publish = []
        for name in names:
            self.publish.append({"relative_path": name, "display_name": f"{name}（https://example.com）"})
            self.publish.append({"relative_path": name})
        self.publish.append({"relative_path": "missing/" + names[0]})

    def staged_ids(self):
        ids = []
        for index, name in enumerate(self.names):
            with_url, path_only = self.calls[2 * index], self.calls[2 * index + 1]
            if name in self.accepted:
                assert with_url == path_only and path_only["status"] == "staged", name
                ids.append(path_only["artifact_id"])
            else:
                assert all(isinstance(v, str) and "当前聊天暂时无法接收此类文档" in v for v in (with_url, path_only)), name
        assert len(set(ids)) == len(self.accepted)
        return ids

    def next_item(self, body):
        for item in body["input"]:
            key = item.get("call_id", "")
            if item.get("type") == "function_call_output" and key.startswith("pubqa_"):
                self.calls[int(key.removeprefix("pubqa_"))] = tool_value(item["output"])
        index = len(self.calls)
        if index < len(self.publish):
            tool, args = "publish_artifact", self.publish[index]
        else:
            ids = self.staged_ids()
            assert "核对相对路径" in self.calls[len(self.publish) - 1]
            queries = [v for i, v in self.calls.items() if i >= len(self.publish)]
            pending = [key for key in ids if not any(
                v["artifact_id"] == key and v["status"] == "committed" for v in queries)]
            if not pending:
                return {"type": "message", "role": "assistant", "phase": "final_answer",
                        "status": "completed", "content": [{"type": "output_text", "text": "验收结束。", "annotations": []}]}
            key = pending[0]
            prior = [v for v in queries if v["artifact_id"] == key]
            assert len(prior) < 3 and all(v["status"] == "staged" for v in prior)
            if prior:
                # Native downloads and commits asynchronously. Keep three queries
                # for the same ID within the document guide's five-second window.
                time.sleep(1.8)
            tool, args = "get_artifact_status", {"artifact_id": key}
        full = "mcp__yijie_artifacts__" + tool
        item = {"type": "function_call", "call_id": f"pubqa_{index}"}
        for spec in body["tools"]:
            if spec.get("name") == full:
                item.update(name=full, arguments=json.dumps(args))
                return item
            if spec.get("name") in ("mcp__yijie_artifacts", "yijie_artifacts", "mcp__yijie_artifacts__") and any(
                    child.get("name") == tool for child in spec.get("tools", [])):
                item.update(name=tool, namespace=spec["name"], arguments=json.dumps(args))
                return item
        if any(spec.get("name") == "exec" for spec in body["tools"]):
            item.update(name="exec", arguments=json.dumps({"input": "text(await tools." + full + "(" + json.dumps(args) + "));"}))
            return item
        raise ValueError("registered artifact tool missing from the real Runtime request")


class ProtocolPeer(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        size = int(self.headers.get("Content-Length", 0))
        if self.path != "/v1/responses" or not 0 < size <= 4 * 1024 * 1024:
            self.send_error(400)
            return
        try:
            item = self.server.case.next_item(json.loads(self.rfile.read(size)))
        except (AssertionError, ValueError, KeyError, TypeError) as exc:
            self.server.failure = f"{type(exc).__name__} after {len(self.server.case.calls)} tool results"
            print(self.server.failure, file=sys.stderr, flush=True)
            self.send_error(400)
            return
        identifier = "resp_" + uuid.uuid4().hex
        item["id"] = "item_" + identifier
        events = [
            {"type": "response.created", "response": {"id": identifier, "status": "in_progress", "output": []}},
            {"type": "response.output_item.added", "output_index": 0, "item": item},
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": {"id": identifier, "status": "completed", "output": [item]}},
        ]
        data = "".join("data: " + json.dumps(e) + "\n\n" for e in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@contextmanager
def verification_state():
    work = Path(tempfile.mkdtemp(prefix="yijie-workspace-publish-")).resolve()
    try:
        yield work
    except BaseException:
        print(f"Private verification state retained at {work}", file=sys.stderr)
        raise
    else:
        shutil.rmtree(work)


def verify(samples, output, reader_mode, formats):
    if not __debug__:
        raise RuntimeError("Run the verifier with Python assertions enabled")
    daily = reader_mode == "daily"
    reader = 12 if daily else int(reader_mode)
    desktop = Path(__file__).resolve().parents[3]
    host = desktop.parent / "yijie-agent-host"
    pin = json.loads((host / "api/runtime-kimi-k31-pro.candidate.json").read_text())["authority"]
    manifest = desktop.parent / "yijie-codex" / next(
        row["path"] for row in pin["native_sources"] if row["path"].endswith("/runtime-manifest.json"))
    assert digest(manifest) == pin["runtime_manifest_sha256"]
    assert digest(manifest.parent / "codex") == pin["runtime_artifact"]["sha256"]
    version = {9: 1, 12: 2}[reader]
    policy = json.loads((desktop / f"contracts/artifact-media-v{version}.schema.json").read_text())
    types = policy["x-media-types"]
    kind_by_mime = {mime: kind for kind in ("image", "video", "file") for mime in types[kind]}
    if len(formats) != len(set(formats)):
        raise ValueError("Provide each sample extension once")
    mime_by_name = {}
    for suffix in formats:
        matches = [f.name for f in samples.iterdir() if f.is_file() and f.suffix.lower() == "." + suffix]
        if len(matches) != 1:
            raise ValueError(f"Expected one .{suffix} sample, got {len(matches)}")
        mime_by_name[matches[0]] = FORMAT_MIME[suffix]
    names = list(mime_by_name)
    accepted = [name for name in names if mime_by_name[name] in kind_by_mime]
    limit = policy["x-http"]["publish"]["limits"]["files_per_turn"]
    if not 1 <= len(accepted) <= limit:
        raise ValueError(f"This native commit check requires 1–{limit} accepted files per turn")
    output.mkdir(parents=True, exist_ok=False)
    clean = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "SDKROOT", "DEVELOPER_DIR", "LANG") if k in os.environ}
    clean.update(YIJIE_ENV="local", YIJIE_LOCAL_PROFILE="demo_fast")
    with verification_state() as work:
        subprocess.run(["bash", "scripts/build-artifact-adapter.sh", work / "bin"], cwd=host, check=True)
        coordinator = work / "host-coordinator"
        subprocess.run(["go", "build", "-o", coordinator, "./tests/integration/workspacepublish"], cwd=host, check=True)
        build_features = ["--features", "kimi-k31-pro-candidate"] if daily else []
        build = subprocess.run(["cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
                                *build_features, "--lib", "--no-run", "--message-format=json"], cwd=desktop, check=True,
                               stdout=subprocess.PIPE, text=True)
        binaries = [v["executable"] for v in map(json.loads, build.stdout.splitlines())
                    if v.get("executable") and v.get("target", {}).get("name") == "yijie_desktop_lib"]
        (receiver,) = binaries
        with ThreadingHTTPServer(("127.0.0.1", 0), ProtocolPeer) as peer:
            peer.case, peer.failure = Case(names, accepted), None
            thread = threading.Thread(target=peer.serve_forever)
            thread.start()
            try:
                with (output / "host.log").open("w") as log:
                    process = subprocess.Popen([coordinator, work, samples, manifest.parent, work / "bin/yijie-artifact-mcp",
                                                str(peer.server_port), *peer.case.accepted], env=clean, stdout=log, stderr=subprocess.STDOUT)
                    try:
                        while not (work / "connection.json").is_file() and process.poll() is None:
                            time.sleep(0.1)
                        if process.poll() is not None:
                            raise RuntimeError("Host setup failed; see host.log")
                        env = {**clean, "YIJIE_PUBLISH_TEST_DIR": str(work), "YIJIE_PUBLISH_TEST_FILES": str(samples),
                               "YIJIE_PUBLISH_TEST_READER": str(reader), "YIJIE_ARTIFACT_MEDIA_ENABLED": "true"}
                        if daily:
                            env.update(YIJIE_FEAT164_DAILY="true", YIJIE_KIMI_K31_PRO_CANDIDATE="true",
                                       YIJIE_CHAT_MODELS_ENABLED="true", YIJIE_RUNTIME_PERMISSIONS_ENABLED="true")
                        elif reader == 12:
                            env["YIJIE_FEAT171_DOCUMENT_RUNTIME"] = "true"
                        with (output / "native.log").open("w") as log_native:
                            subprocess.run([receiver, "workspace_publish_native_receiver", "--ignored", "--nocapture"],
                                           cwd=desktop, env=env, stdout=log_native, stderr=subprocess.STDOUT, check=True)
                    finally:
                        (work / "receiver-finished").touch()
                        status = process.wait()
                if status or peer.failure:
                    raise RuntimeError("Real publication or status lookup failed; see host.log")
                deliveries = json.loads((work / "native-saved.json").read_text())
                committed = {v["artifact_id"] for v in peer.case.calls.values() if isinstance(v, dict) and v.get("status") == "committed"}
                assert len(committed) == len(peer.case.accepted) and {v["id"] for v in deliveries} == committed
                receipt_by_name = {name: peer.case.calls[2 * i] for i, name in enumerate(names) if name in accepted}
                for v in deliveries:
                    mime = mime_by_name[v["name"]]
                    assert receipt_by_name[v["name"]]["artifact_id"] == v["id"]
                    assert (v["kind"], v["media_type"]) == (kind_by_mime[mime], mime)
                    assert digest(samples / v["name"]) == digest(work / "native-saved" / v["saved_as"]) == v["sha256"]
                shutil.copytree(work / "native-saved", output / "saved")
                result = {"reader_mode": reader_mode, "reader": reader, "model_peer": "loopback", "supplier_requests": 0,
                          "publish_requests": peer.case.publish, "calls": peer.case.calls, "deliveries": deliveries}
                (output / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            finally:
                peer.shutdown()
                thread.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples", type=Path, help="Directory with one ordinary file for each selected extension")
    parser.add_argument("output", type=Path, help="New directory for receipts and exported bytes")
    parser.add_argument("--reader", choices=("daily", "9", "12"), default="daily",
                        help="Daily build and launch flags (default), or an explicit compatibility reader")
    parser.add_argument("--formats", nargs="+", choices=tuple(FORMAT_MIME),
                        default=("png", "svg", "html", "docx", "pptx"))
    args = parser.parse_args()
    verify(args.samples.resolve(strict=True), args.output.resolve(), args.reader, args.formats)
