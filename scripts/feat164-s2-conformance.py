#!/usr/bin/env python3
"""TCONF-164-02 companion checks, exclusively normal temporary state/loopback.

No real credential discovery, product activation, forced timeout/kill, or App
bundling. Test failures and incomplete cleanup stop the run; evidence is retained.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host-source", type=Path, required=True)
    parser.add_argument("--runtime-binary", type=Path, required=True)
    parser.add_argument("--runtime-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    desktop = Path(__file__).resolve().parents[1]
    host = args.host_source.resolve(strict=True)
    binary = args.runtime_binary.resolve(strict=True)
    manifest = args.runtime_manifest.resolve(strict=True)
    # The product Manager independently validates manifest/source/binary before spawn.
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    env = {k: os.environ[k] for k in ("PATH", "HOME", "TMPDIR", "CARGO_HOME", "RUSTUP_HOME", "SDKROOT", "DEVELOPER_DIR", "PKG_CONFIG_PATH") if k in os.environ}
    candidate = dict(env, YIJIE_ENV="local", YIJIE_LOCAL_PROFILE="demo_fast", YIJIE_CHAT_MODELS_ENABLED="true", YIJIE_KIMI_K31_PRO_CANDIDATE="true")
    integration = dict(env, YIJIE_CODEX_INTEGRATION_BINARY=str(binary), YIJIE_CODEX_INTEGRATION_MANIFEST=str(manifest), YIJIE_FEAT164_DESKTOP_SOURCE=str(desktop))
    results = {"test_id": "TCONF-164-02", "status": "IN_PROGRESS", "real_model_http_added": 0, "platform_ui": "NOT RUN", "runtime_binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "runtime_manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(), "sources": {}, "checks": []}
    for name, repo in (("desktop", desktop), ("host", host)):
        results["sources"][name] = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(), "status": subprocess.check_output(["git", "status", "--porcelain"], cwd=repo, text=True).splitlines()}
    checks = [
        ("host-temporal", host, env, ["go", "test", "-race", "-json", "./internal/session", "-run", "^TestFEAT164MigrationReceiptAndRecovery$", "-count=1"]),
        ("host-routes", host, env, ["go", "test", "-race", "-json", "./internal/app", "-run", "^TestFEAT164(V2OperationRoutesValidateBeforeService|ModelRoutesPreserveAuthAndRetiredRead)$", "-count=1"]),
        ("native-delivery", desktop, candidate, ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "kimi-k31-pro-candidate", "--lib", "feat164_delivery", "--", "--test-threads=1"]),
        ("native-recovery-migration", desktop, env, ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--features", "kimi-k31-pro-candidate", "--lib", "feat164", "--", "--skip", "feat164_surfaces", "--skip", "feat164_delivery", "--skip", "feat164_native_host_boundary", "--skip", "chat::schedules::model_retirement_tests::", "--test-threads=1"]),
        ("native-host-boundary", host, integration, ["go", "test", "-race", "-json", "./internal/app", "-run", "^TestFEAT164NativeHostBoundary$", "-count=1"]),
    ]
    for name, cwd, child_env, command in checks:
        start = datetime.datetime.now().astimezone().isoformat()
        logfile = output / (name + ".log")
        # Deliberately no subprocess timeout: no kill-on-timeout fallback.
        with logfile.open("wb") as log:
            process = subprocess.run(command, cwd=cwd, env=child_env, stdout=log, stderr=subprocess.STDOUT, check=False)
        raw = logfile.read_bytes()
        content = raw.decode()
        if command[0] == "go":
            events = [json.loads(line) for line in content.splitlines() if line.startswith("{")]
            passed = sum(e.get("Action") == "pass" and bool(e.get("Test")) for e in events)
            skipped = sum(e.get("Action") == "skip" for e in events)
        else:
            match = re.search(r"test result: ok\. (\d+) passed; 0 failed; (\d+) ignored", content)
            passed, skipped = (int(match[1]), int(match[2])) if match else (0, 0)
        expected = {"host-temporal": 25, "host-routes": 2, "native-delivery": 12, "native-recovery-migration": 10, "native-host-boundary": 1}[name]
        complete = process.returncode == 0 and passed == expected and skipped == 0
        if name == "native-host-boundary":
            complete = complete and "FEAT164_NATIVE_BOUNDARY_PASS" in content
        results["checks"].append({"name": name, "command": command, "cwd": str(cwd), "started_at": start, "verified_at": datetime.datetime.now().astimezone().isoformat(), "exit_code": process.returncode, "passed_cases": passed, "skipped": skipped, "log": logfile.name, "sha256": hashlib.sha256(raw).hexdigest(), "result": "PASS" if complete else "FAIL"})
        results["status"] = "IN_PROGRESS" if complete else "FAIL"
        (output / "result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(f"{name}: {results['checks'][-1]['result']} ({passed} cases, {skipped} skips)", flush=True)
        if not complete:
            return 1
    results["status"] = "PASS"
    results["limitation"] = "Headless temporal/storage/boundary conformance; no canonical App/UI, daily migration, supplier qualification, S2 G3 or release claim."
    (output / "result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
