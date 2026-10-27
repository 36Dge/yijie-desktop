"""Create a new local daily launcher from a validated activation; never overwrite."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys

SOURCE = Path(__file__).resolve().with_name("feat164-daily-deployment.py")
spec = importlib.util.spec_from_file_location("daily_activation", SOURCE)
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)
ENV_KEYS = {"PATH", "HOME", "TMPDIR", "CARGO_HOME", "RUSTUP_HOME", "SDKROOT", "DEVELOPER_DIR",
            "CARGO_NET_OFFLINE", "CARGO_BUILD_JOBS", "GOPROXY", "GOSUMDB", "GOTOOLCHAIN", "npm_config_offline"}
ENTRY_NAMES = {"易界 AI.command", "易界 AI（暂停 Kimi）.command"}


def entry_environment(environment, binding_file, binding_sha, paused):
    daily.require(isinstance(environment, dict) and set(environment) <= ENV_KEYS, "entry environment keys")
    daily.require({"PATH", "HOME"} <= set(environment), "entry environment required")
    daily.require(all(isinstance(v, str) and v and all(ord(c) >= 32 for c in v) for v in environment.values()), "entry environment values")
    daily.require(environment["HOME"] == str(Path.home()), "original user home")
    daily.absolute(str(binding_file))
    daily.require(daily.hexadecimal(binding_sha), "entry binding digest")
    daily.require(type(paused) is bool, "entry pause")
    return {**environment, "YIJIE_FEAT164_DAILY_BINDING_FILE": str(binding_file),
            "YIJIE_FEAT164_DAILY_BINDING_SHA256": binding_sha, "YIJIE_FEAT164_DAILY_STAGE": "D5",
            "YIJIE_KIMI_K31_EXECUTION_PAUSED": "true" if paused else "false"}


def render_entry(desktop, environment):
    # Shell-quote every value; this is a reproducible project launcher, not a replacement binary.
    argv = ["/usr/bin/env", "-i", *[f"{k}={v}" for k, v in sorted(environment.items())],
            "/bin/bash", str(desktop / "scripts/run-local-demo-fast.sh"),
            "--packaged", "--kimi-k31-daily", "--reopen"]
    return "#!/bin/bash\nset -euo pipefail\n# FEAT-164 approved daily entry; original App/data remain in place.\ncd " + shlex.quote(str(desktop)) + "\nexec " + shlex.join(argv) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding-file", type=Path, required=True)
    parser.add_argument("--binding-sha256", required=True)
    parser.add_argument("--environment-file", type=Path, required=True)
    parser.add_argument("--environment-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--paused", action="store_true")
    args = parser.parse_args()
    desktop = Path(__file__).resolve().parents[1]
    raw = daily.read_regular(daily.absolute(str(args.environment_file)), 16384, private=True)
    daily.require(daily.digest(raw) == args.environment_sha256, "entry environment digest")
    env = entry_environment(json.loads(raw, object_pairs_hook=daily.unique_object), args.binding_file, args.binding_sha256, args.paused)
    value, _ = daily.load_binding(desktop, "D5", env)
    daily.require(value["schema_version"] == 2, "daily entry requires durable activation")
    output = daily.absolute(str(args.output))
    daily.require(output.parent == Path.home() / "Desktop" and output.name in ENTRY_NAMES, "fixed Desktop entry")
    daily.require((output.name == "易界 AI（暂停 Kimi）.command") == args.paused, "entry label/pause")
    daily.existing_directory(output.parent)
    body = render_entry(desktop, env).encode()
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o700), "wb") as stream:
        stream.write(body)
    print(json.dumps({"entry_created": True, "entry_sha256": daily.digest(body), "binding_sha256": args.binding_sha256,
                      "kimi_paused": args.paused, "app_started": False, "model_http": 0}))


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    try:
        main()
    except Exception:
        print("日常入口未创建；请核对已批准的制品、启用记录及目标名称。已有文件和数据保持不变。", file=sys.stderr)
        raise SystemExit(1)
