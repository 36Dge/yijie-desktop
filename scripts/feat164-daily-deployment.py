"""FEAT-164 daily deployment binding. Read-only; no DB, build or lifecycle API."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

POLICY = "feat164-daily-existing-homes-v1"
INFRA_SHA256 = "7fd0450319467d5ad97eb56f2bb713ac411ea19c8708ab2529ffcf6d350194ea"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hexadecimal(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def absolute(value):
    require(isinstance(value, str) and value and not any(ord(c) < 32 for c in value), "invalid path")
    p = Path(value)
    require(p.is_absolute() and str(p) == value and ".." not in p.parts, "noncanonical path")
    return p


def existing_directory(path, private=False):
    require(path.resolve(strict=True) == path, "directory alias")
    m = path.lstat()
    require(stat.S_ISDIR(m.st_mode) and m.st_uid == os.geteuid(), "directory owner/type")
    require(stat.S_IMODE(m.st_mode) == 0o700 if private else not m.st_mode & 0o022, "directory mode")


def regular(path, private=False):
    require(path.resolve(strict=True) == path, "file alias")
    m = path.lstat()
    require(stat.S_ISREG(m.st_mode) and m.st_nlink == 1 and m.st_uid == os.geteuid(), "file owner/type")
    require(stat.S_IMODE(m.st_mode) in (0o400, 0o600) if private else not m.st_mode & 0o022, "file mode")
    return m


def read_regular(path, limit, private=False):
    before = regular(path, private)
    require(before.st_size <= limit, "file size")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as f:
        actual = os.fstat(f.fileno())
        require((actual.st_dev, actual.st_ino) == (before.st_dev, before.st_ino), "file changed")
        data = f.read(limit + 1)
    require(len(data) <= limit, "file size")
    return data


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate field")
        result[key] = value
    return result


def validate_binding(value, *, desktop, receipt_sha, native_directory, stage, paused, now):
    """Pure validation; native_directory is fixed by the CLI, injectable only in unit tests."""
    require(isinstance(value, dict), "binding object")
    require(set(value) == {"schema_version", "feature", "policy", "identifier", "receipt_sha256",
                          "native_data_directory", "original_desktop_root", "host_home", "runtime_home",
                          "providers", "workflow", "approval"}, "binding fields")
    require(type(value["schema_version"]) is int and value["schema_version"] == 1 and value["feature"] == "FEAT-164"
            and value["policy"] == POLICY and value["identifier"] == "com.yijie.ai", "binding identity")
    require(hexadecimal(value["receipt_sha256"]) and value["receipt_sha256"] == receipt_sha, "candidate receipt")
    require(absolute(value["native_data_directory"]) == native_directory, "fixed Native identity")
    origin = absolute(value["original_desktop_root"])
    require(origin != desktop, "candidate cannot be the original daily source")
    base = origin / ".local/demo-fast"
    require(absolute(value["host_home"]) == base / "host-home"
            and absolute(value["runtime_home"]) == base / "codex-home", "original daily Homes")
    require(not origin.is_relative_to(desktop) and not desktop.is_relative_to(origin), "overlapping sources")
    approval = value["approval"]
    require(isinstance(approval, dict) and set(approval) == {"stage", "reference", "expires_at", "preflight_sha256",
                                                          "model_http_limit", "no_dispatchable_work"}, "approval fields")
    require(stage in {"D3", "D4", "D5"} and approval["stage"] == stage, "stage approval")
    require(isinstance(approval["reference"], str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", approval["reference"]), "approval reference")
    require(hexadecimal(approval["preflight_sha256"]) and type(approval["model_http_limit"]) is int
            and approval["model_http_limit"] == 0 and approval["no_dispatchable_work"] is True, "zero-dispatch approval")
    expires = dt.datetime.fromisoformat(approval["expires_at"])
    require(expires.tzinfo is not None and now < expires <= now + dt.timedelta(hours=24), "approval expiry")
    require(stage == "D3" or paused in {"true", "false"}, "explicit Kimi pause")
    require(stage != "D4" or paused == "true", "first start must pause Kimi")
    providers = value["providers"]
    require(isinstance(providers, dict) and set(providers) == {"minimax_key_file", "kimi_key_file"}, "provider references")
    provider_root = origin.parent / "yijie-agent-host/.local/secrets"
    require(absolute(providers["minimax_key_file"]) == provider_root / "minimax-api-key"
            and absolute(providers["kimi_key_file"]) == provider_root / "kimi-api-key", "original provider references")
    workflow = value["workflow"]
    require(isinstance(workflow, dict) and set(workflow) == {"infra_root", "source_sha256", "credential_file"}, "workflow fields")
    infra = origin.parent / "yijie-infra"
    require(absolute(workflow["infra_root"]) == infra and workflow["source_sha256"] == INFRA_SHA256, "fixed Infra source")
    require(absolute(workflow["credential_file"]) == infra / "environments/local/generated/feat-153/private/k-na.json", "workflow credential reference")
    return value


def load_binding(desktop, stage, environ):
    expected = environ.get("YIJIE_FEAT164_DAILY_BINDING_SHA256", "")
    require(hexadecimal(expected), "approved binding digest required")
    binding_file = absolute(environ.get("YIJIE_FEAT164_DAILY_BINDING_FILE", ""))
    raw = read_regular(binding_file, 16384, private=True)
    require(digest(raw) == expected, "binding digest")
    value = json.loads(raw, object_pairs_hook=unique_object)
    receipt = read_regular(desktop / ".local/feat164-daily/packaged-launch-receipt.json", 4194304)
    receipt_value = json.loads(receipt)
    require(receipt_value.get("deployment_policy") == POLICY and receipt_value.get("release") is False, "daily build policy")
    require(receipt_value["inputs"]["sources"]["scripts/feat164-daily-deployment.py"]["sha256"]
            == digest(read_regular(Path(__file__).resolve(), 131072)), "helper build binding")
    validate_binding(value, desktop=desktop, receipt_sha=digest(receipt),
                     native_directory=Path.home() / "Library/Application Support/com.yijie.ai/demo-fast-v1",
                     stage=stage, paused=environ.get("YIJIE_KIMI_K31_EXECUTION_PAUSED"),
                     now=dt.datetime.now(dt.timezone.utc))
    # Do not open Native, Host, Runtime databases, or preflight/secret contents here.
    existing_directory(absolute(value["original_desktop_root"]))
    for name in ["host_home", "runtime_home"]:
        existing_directory(absolute(value[name]), private=True)
    return value, expected


def check_existing_ready(module):
    """No record/status/up/init/build/render/credentials, including transitive calls."""
    state = module.read_state()
    require(state.get("phase") == "ready", "workflow must already be ready")
    items = module.all_containers()
    module.validate_owned(items, state)
    require(module.observed_ready(state, items) is True, "authenticated workflow readiness")
    return state["run_epoch"]


def workflow_ready(value):
    infra = absolute(value["workflow"]["infra_root"])
    existing_directory(infra)
    source = infra / "scripts/workflow-local.py"
    raw = read_regular(source, 131072)
    require(digest(raw) == INFRA_SHA256, "Infra implementation drift")
    # Execute only the exact reviewed source bytes, not a path re-open after hashing.
    # This is the real module, never a replacement executable or test runtime.
    spec = importlib.util.spec_from_loader("feat164_reviewed_workflow", loader=None, origin=str(source))
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(source)
    exec(compile(raw, str(source), "exec"), module.__dict__)
    check_existing_ready(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["resolve", "ready"])
    parser.add_argument("--stage", choices=["D3", "D4", "D5"], required=True)
    parser.add_argument("--desktop-root", required=True)
    args = parser.parse_args()
    desktop = Path(__file__).resolve().parents[1]
    require(absolute(args.desktop_root) == desktop, "fixed candidate source")
    value, binding_sha = load_binding(desktop, args.stage, os.environ)
    if args.action == "resolve":
        print("\t".join([value["host_home"], value["runtime_home"],
                          value["providers"]["minimax_key_file"], value["providers"]["kimi_key_file"],
                          value["workflow"]["credential_file"], binding_sha]))
    else:
        require(args.stage in {"D4", "D5"}, "maintenance never checks live workflow")
        workflow_ready(value)
        print("FEAT-164 existing workflow ready; binding=" + binding_sha)


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    try:
        main()
    except Exception:
        # Neither private paths, tokens, state, HTTP body nor inner exceptions leave the helper.
        print("FEAT-164 daily deployment rejected; retain state and review the approved binding/readiness.", file=sys.stderr)
        sys.exit(1)
