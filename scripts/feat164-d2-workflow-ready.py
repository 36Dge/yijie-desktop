"""D2 explicitly authorized read-only dependency audit, without a D4 binding."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

EXPECTED = "7fd0450319467d5ad97eb56f2bb713ac411ea19c8708ab2529ffcf6d350194ea"


def inspect(module):
    result = {"status": "INSPECTION_FAILED", "lifecycle_calls": 0, "model_http": 0}
    stage = "read_state"
    try:
        state = module.read_state()
        result["phase"] = state.get("phase")
        stage = "all_containers"
        items = module.all_containers()
        result.update(containers=len(items), running=sum(bool(x["state"]["Running"]) for x in items), healthy=sum(x["health"] == "healthy" for x in items))
        stage = "validate_owned"
        module.validate_owned(items, state)
        stage = "observed_ready"
        ready = state.get("phase") == "ready" and module.observed_ready(state, items) is True
        result["status"] = "READY" if ready else "NOT_READY"
    except Exception as error:
        result.update(failed_stage=stage, error_type=type(error).__name__)
    return result


def main():
    source, output = map(Path, sys.argv[1:])
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError("source drift")
    spec = importlib.util.spec_from_loader("d2_real_infra", loader=None, origin=str(source))
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(source)
    exec(compile(raw, str(source), "exec"), module.__dict__)
    # Preserve the existing state and credential bytes; never print their contents.
    paths = [module.STATE, module.PRIVATE / "k-na.json", module.PRIVATE / "k-ac.json"]
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None for p in paths}
    try:
        result = inspect(module)
    except Exception:
        result = {"status": "INSPECTION_FAILED", "lifecycle_calls": 0, "model_http": 0}
    after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None for p in paths}
    result["private_state_and_credentials_unchanged"] = before == after
    result["source_sha256"] = EXPECTED
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result))
    return 0 if before == after and result["status"] != "INSPECTION_FAILED" else 1


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    try:
        raise SystemExit(main())
    except Exception:
        print('{"status":"INSPECTION_FAILED","lifecycle_calls":0,"model_http":0}')
        raise SystemExit(1)
