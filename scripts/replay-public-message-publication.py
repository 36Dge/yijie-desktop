"""Replay local public-message captures through the candidate app-server.

The source captures and generated evidence are local. All model traffic goes to
the in-process loopback server. Recorded web tools use a local MCP reader.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def save(path, value):
    path.write_text(encoded(value) + "\n")


def replay_web():
    names = ["kimi_web_fetch", "kimi_web_search", "kimi_web_search_pro"]
    for line in sys.stdin:
        message = json.loads(line)
        if "id" not in message:
            continue
        method = message["method"]
        if method == "initialize":
            result = {"protocolVersion": message["params"]["protocolVersion"],
                      "capabilities": {"tools": {}}, "serverInfo": {"name": "recorded-web", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": name, "description": "Read a recorded local web result.",
                                 "inputSchema": {"type": "object", "additionalProperties": True}} for name in names]}
        elif method == "tools/call":
            p = message["params"]
            key = tool_key(p["name"], p.get("arguments", {}))
            records = json.loads(Path(sys.argv[2]).read_text())
            entry = records.get(key)
            result = entry if entry is not None else {"content":[{"type":"text","text":"Recorded call has no result."}], "isError":True}
        else:
            result = {}
        print(encoded({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)


def tool_key(name, arguments):
    return name + "/" + json.dumps(arguments, sort_keys=True, ensure_ascii=False)


def capture(path, case):
    batches, responses, ids = [], {}, []
    if case == "blink":
        rows = [json.loads(line) for line in path.open()]
        turn = next(r["payload"]["turn_id"] for r in rows if r.get("payload", {}).get("type") == "task_started")
        group, calls = [], {}
        for row in rows:
            item = row["payload"]
            kind = item.get("type")
            if kind == "task_complete" and item.get("turn_id") == turn:
                break
            if kind == "token_count" and group:
                batches.append(group)
                group = []
            if kind == "mcp_tool_call_end" and item["call_id"] in calls:
                result = item.get("result", {}).get("Ok")
                if result is not None:
                    responses[calls[item["call_id"]]] = result
            if row["type"] != "response_item":
                continue
            if kind == "function_call":
                name = item["name"].removeprefix("mcp__yijie_web__")
                if name not in ("kimi_web_fetch", "kimi_web_search", "kimi_web_search_pro"):
                    raise ValueError("Unsupported tool in selected capture")
                calls[item["call_id"]] = tool_key(name, json.loads(item["arguments"]))
            if (kind == "message" and item.get("role") == "assistant") or kind in ("function_call", "web_search_call", "reasoning"):
                # Retain provider identities, output text and tool boundaries. The
                # private provider passthrough and hidden reasoning are not needed.
                clean = {k: v for k, v in item.items() if k != "internal_chat_message_metadata_passthrough"}
                if kind == "reasoning":
                    clean = {"type": "reasoning", "id": item["id"], "summary": []}
                elif kind == "message":
                    ids.append(item["id"])
                group.append(clean)
        if group:
            batches.append(group)
    else:
        rows = json.loads(path.read_text())["rawPublicMessages"]
        for i, msg in enumerate(rows, 1):
            identity = f"replay-kimi-e25-{i}"
            item = {"id": identity, "type": "message", "role": "assistant",
                    "content": [{"type": "output_text", "text": msg["text"]}]}
            if msg.get("phase") is not None:
                item["phase"] = msg["phase"]
            batches.append([item])
            ids.append(identity)
        # This capture records tool names/times, without arguments/IDs/results.
        # Do not invent missing shell calls. Preserve its three public items.
    return batches, responses, ids


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--case", choices=("blink", "e25"), required=True)
    for arg in ["binary", "capture", "catalog", "output"]:
        p.add_argument("--"+arg, type=Path, required=True)
    p.add_argument("--preview", action="store_true", help="Negotiate live declared-body previews for this loopback turn")
    p.add_argument("--interrupt-before-final",action="store_true",help="Use ordinary user interrupt during the final captured item")
    args = p.parse_args()
    directory = args.output.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    runtime_home, cwd = directory/"runtime", directory/"workspace"
    runtime_home.mkdir()
    cwd.mkdir()
    batches, results, ids = capture(args.capture, args.case)
    save(directory/"recorded-tools.json", results)
    model = "MiniMax-M3" if args.case == "blink" else "kimi-k3.1-pro"
    requested = []
    partial, release = threading.Event(), threading.Event()
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            n = len(requested)
            requested.append(body.get("model"))
            if self.path != "/v1/responses" or body.get("model") != model or n >= len(batches):
                self.send_error(409, "Unexpected replay request")
                return
            rid = f"recorded-response-{n+1}"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            def emit(kind, **fields):
                self.wfile.write(("data: "+encoded({"type": kind, **fields})+"\n\n").encode())
                self.wfile.flush()
            emit("response.created", response={"id": rid,"status":"in_progress","output":[]})
            for i, item in enumerate(batches[n]):
                seed = dict(item)
                if item["type"] == "message":
                    seed["content"] = []
                emit("response.output_item.added", output_index=i, item=seed)
                if item["type"] == "message":
                    for part in item["content"]:
                        value = part["text"]
                        for at in range(0, len(value), 48):
                            emit("response.output_text.delta", output_index=i, item_id=item["id"],
                                 content_index=0, delta=value[at:at+48])
                            if args.interrupt_before_final and n==len(batches)-1 and at==48:
                                partial.set()
                                release.wait(timeout=60)
                                return
                emit("response.output_item.done", output_index=i, item=item)
            emit("response.completed", response={"id":rid,"status":"completed","output":batches[n],
                 "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}})
    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    script = str(Path(__file__).resolve())
    provider = "replay"
    config = [
        'model = '+encoded(model), 'model_provider = "replay"',
        'model_catalog_json = '+encoded(str(args.catalog.resolve())),
        'model_reasoning_effort = '+encoded("high" if args.case=="blink" else "max"),
        'web_search = "disabled"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
        '[model_providers.replay]', 'name = "Local capture"',
        f'base_url = "http://127.0.0.1:{server.server_port}/v1"', 'wire_api = "responses"',
        'requires_openai_auth = false', 'supports_websockets = false','request_max_retries = 0',
        'stream_max_retries = 0', f'[projects.{encoded(str(cwd))}]','trust_level = "trusted"']
    if args.case == "blink":
        config += ['[features.code_mode]', 'enabled = true', 'function_input = true',
                   'function_namespaces = ["mcp__yijie_web"]', '[mcp_servers.yijie_web]',
                   'default_tools_approval_mode = "approve"', 'command = '+encoded(sys.executable),
                   'args = '+encoded([script, "--recorded-web", str(directory/"recorded-tools.json")])]
    (runtime_home/"config.toml").write_text("\n".join(config)+"\n")
    err = (directory/"app-server.log").open("w")
    child = subprocess.Popen([str(args.binary.resolve()), "app-server", "--listen", "stdio://"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True, cwd=cwd,
        env={**os.environ, "CODEX_HOME": str(runtime_home)}, bufsize=1)
    events, inbox = [], queue.Queue()
    def read():
        for line in child.stdout:
            inbox.put(json.loads(line))
        inbox.put(None)
    threading.Thread(target=read, daemon=True).start()
    counter = 0
    def send(value):
        child.stdin.write(encoded(value)+"\n")
        child.stdin.flush()
    def wait(predicate, timeout=75):
        end = time.monotonic()+timeout
        while True:
            reply = inbox.get(timeout=max(0.1,end-time.monotonic()))
            if reply is None:
                raise RuntimeError("app-server exited")
            if reply.get("method") and "id" in reply:
                raise RuntimeError("unexpected client request "+reply["method"])
            if "method" in reply:
                events.append(reply)
            if predicate(reply):
                return reply
            if time.monotonic()>=end:
                raise TimeoutError("app-server deadline")
    def rpc(method, params):
        nonlocal counter
        counter += 1
        send({"id":counter,"method":method,"params":params})
        reply=wait(lambda x:x.get("id")==counter)
        if "error" in reply:
            raise RuntimeError((method,reply["error"]))
        return reply["result"]
    try:
        rpc("initialize", {"clientInfo":{"name":"yijie_publication_acceptance","version":"1.0"},
                           "capabilities":{"experimentalApi":True}})
        send({"method":"initialized","params":{}})
        start={"model": model,"modelProvider":provider,"approvalPolicy":"never","sandbox":"read-only",
               "cwd":str(cwd),"developerInstructions":"[yijie-public-message-v1]\n[yijie-answer-completion-v1]\n[yijie-publication-v2]"}
        if args.preview:
            start["developerInstructions"] += "\n[yijie-public-preview-v1]"
        thread = rpc("thread/start",start)["thread"]["id"]
        turn = rpc("turn/start",{"threadId":thread,"input":[{"type":"text","text":"整理现有资料并给出完整建议。","text_elements":[]}]})["turn"]["id"]
        if args.interrupt_before_final:
            if not partial.wait(timeout=30):raise TimeoutError("no partial content arrived")
            # Give the already flushed bytes a chance to reach the Runtime reader.
            time.sleep(0.2)
            rpc("turn/interrupt",{"threadId":thread,"turnId":turn})
        terminal=lambda x:x.get("method")=="turn/completed" and x["params"]["turn"]["id"]==turn
        done=next((x for x in events if terminal(x)),None) or wait(terminal)
        release.set()
        history=rpc("thread/read",{"threadId":thread,"includeTurns":True})["thread"]
        save(directory/"runtime-thread.json",history)
        save(directory/"capture-evidence.json", {"sourceSha256":hashlib.sha256(args.capture.read_bytes()).hexdigest(),
             "sourceIds":ids if args.case=="blink" else None, "replayedIds":ids, "requests":requested,
             "case":args.case,"turnId":turn,"threadId":thread, "terminal":done["params"]["turn"]["status"]})
        if len(requested)!=len(batches) or done["params"]["turn"]["status"]!=("interrupted" if args.interrupt_before_final else "completed"):
            raise RuntimeError(f"response count {len(requested)}/{len(batches)} or terminal mismatch")
        print(f"{args.case}: {len(requested)} model responses, {len(ids)} recorded public items")
    finally:
        release.set()
        save(directory/"runtime-events.json",events)
        child.stdin.close()
        # app-server's ordinary stdio EOF initiates its own graceful shutdown.
        try:
            child.wait(timeout=30)
        finally:
            server.shutdown()
            server.server_close()
            err.close()


def reopen(binary, directory):
    directory = Path(directory).resolve()
    observed = json.loads((directory/"host-history.json").read_text())
    thread = observed["thread_id"]
    # The original process has already exited normally. This process only reads
    # the recorded thread and never calls turn/start or thread/resume.
    messages = [{"id":1,"method":"initialize","params":{"clientInfo":{"name":"publication_history","version":"1"}}},
                {"method":"initialized","params":{}},
                {"id":2,"method":"thread/read","params":{"threadId":thread,"includeTurns":True}}]
    with (directory/"reopen.log").open("w") as log:
        child = subprocess.Popen([str(Path(binary).resolve()),"app-server","--listen","stdio://"],cwd=directory,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,
            env={**os.environ,"CODEX_HOME":str(directory/"runtime")})
        try:
            for message in messages:
                child.stdin.write(encoded(message)+"\n");child.stdin.flush()
                if "id" not in message: continue
                while True:
                    line=child.stdout.readline()
                    if not line: raise RuntimeError("cold-read process closed before responding")
                    response=json.loads(line)
                    if response.get("id")==message["id"]:break
                if "error" in response:raise RuntimeError(response["error"])
            cold=response["result"]["thread"]
        finally:
            child.stdin.close()
            child.wait(timeout=30)
    def items(thread):
        return [(row["id"],row.get("phase"),row.get("publication"),row.get("text")) for turn in thread["turns"]
                for row in turn["items"] if row["type"] in ("agentMessage","unpublishedText")]
    actual=items(cold)
    if not actual or actual!=items(observed):
        raise ValueError("cold Runtime identities, phases, sources, order or text differ from the observed Host history")
    save(directory/"runtime-cold-result.json", {"freshProcess":True,"supplierRequests":0,"identical":True,
         "publicItems":[{"id":id,"phase":phase,"source":stamp["source"]} for id,phase,stamp,body in actual]})


if __name__ == "__main__":
    if len(sys.argv)>1 and sys.argv[1]=="--recorded-web":
        replay_web()
    elif len(sys.argv)==4 and sys.argv[1]=="--reopen":
        reopen(sys.argv[2],sys.argv[3])
    else:
        main()
