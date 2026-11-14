#!/usr/bin/env python3
"""FEAT-174 ordinary loopback responses; no forwarding, tools, or supplier I/O.

Use only with explicit start-ui --skill-acceptance ... --tool-search-meter.
Type stop (or close stdin) for an orderly shutdown. Logs contain hashes and
local verification facts, never authorization headers or full request bodies.
"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading


def main():
    if len(sys.argv) != 2:
        raise ValueError("Expected an explicit local evidence JSONL path")
    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    ledger = output.open("x", encoding="utf-8")
    lock = threading.Lock()
    count = 0

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            nonlocal count
            length = int(self.headers.get("Content-Length", "0"))
            if self.path != "/v1/responses" or not 0 < length <= 16 << 20:
                self.send_error(400)
                return
            body = self.rfile.read(length)
            json.loads(body)
            with lock:
                count += 1
                number = count
                if number > 24:
                    self.send_error(429)
                    return
                text = body.decode("utf-8")
                ledger.write(json.dumps({"request": number, "sha256": hashlib.sha256(body).hexdigest(),
                                         "imported_skill_body": "FEAT174_IMPORTED_BODY" in text,
                                         "ordinary_acceptance": "FEAT174" in text,
                                         "supplier_calls": 0}, ensure_ascii=False) + "\n")
                ledger.flush()
            message = {"id": f"local-skill-message-{number}", "type": "message", "role": "assistant",
                       "status": "completed", "phase": "final_answer", "content": [{"type": "output_text",
                       "text": f"本机技能验收响应完成（第 {number} 次）。", "annotations": []}]}
            response = {"id": f"local-skill-response-{number}", "status": "completed", "output": [message],
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for event in [{"type": "response.created", "response": {"id": response["id"], "status": "in_progress", "output": []}},
                          {"type": "response.output_item.added", "output_index": 0, "item": message},
                          {"type": "response.output_item.done", "output_index": 0, "item": message},
                          {"type": "response.completed", "response": response}]:
                self.wfile.write(("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()

    server = ThreadingHTTPServer(("127.0.0.1", 18083), Handler)
    worker = threading.Thread(target=server.serve_forever)
    worker.start()
    print("READY: fixed loopback ordinary responses; supplier calls = 0", flush=True)
    try:
        for line in sys.stdin:
            if line.strip() == "stop":
                break
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
        ledger.close()
    print(f"STOPPED normally: {count} local requests; supplier calls = 0", flush=True)


if __name__ == "__main__":
    main()
