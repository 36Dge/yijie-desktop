#!/usr/bin/env python3
"""Natural legacy plan/domain qualification. Does NOT qualify App cutover admission."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
output = a.output.resolve()
output.mkdir(parents=True, exist_ok=False)
root = output / 'feat164-natural-plans-retained'
root.mkdir()
source = Path(__file__).resolve().parents[1]
env = {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'SDKROOT', 'DEVELOPER_DIR', 'PKG_CONFIG_PATH') if k in os.environ}
env.update(CARGO_NET_OFFLINE='true', CARGO_BUILD_JOBS='4', YIJIE_ENV='local', YIJIE_LOCAL_PROFILE='demo_fast', YIJIE_CHAT_MODELS_ENABLED='true', YIJIE_FEAT164_PLAN_ROOT=str(root))
result = {'scope': 'Natural SQL29 producer, explicit canonical expand, SQL41 retirement/review/grants/reopen; App old-store admission remains blocked', 'contract_impact': 'none', 'real_model_http': 0, 'loopback_model_http': 0, 'source_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(), 'source_status': subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True).splitlines(), 'phases': []}
for phase, candidate in [('produce', False), ('admission', True), ('expand', False), ('upgrade', True), ('reopen', True)]:
    child = dict(env, YIJIE_FEAT164_PLAN_PHASE=phase)
    cmd = ['cargo', 'test', '--offline', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--lib']
    if candidate:
        child['YIJIE_KIMI_K31_PRO_CANDIDATE'] = 'true'
        cmd += ['--features', 'kimi-k31-pro-candidate']
    cmd += ['chat::schedules::feat164_natural_plan_tests::feat164_natural_plan_upgrade', '--', '--exact', '--ignored', '--nocapture', '--test-threads=1']
    started = datetime.datetime.now().astimezone().isoformat()
    log = output / (phase + '.log')
    # No timeout or kill fallback. Only normal temporary storage; no sidecars.
    with log.open('wb') as f:
        run = subprocess.run(cmd, cwd=source, env=child, stdout=f, stderr=subprocess.STDOUT)
    raw = log.read_bytes()
    ok = run.returncode == 0 and b'1 passed; 0 failed; 0 ignored;' in raw and f'S4Q_NATURAL_PLAN_PASS phase={phase};'.encode() in raw
    result['phases'].append({'phase': phase, 'command': cmd, 'started_at': started, 'finished_at': datetime.datetime.now().astimezone().isoformat(), 'exit_code': run.returncode, 'pass': ok, 'log_sha256': hashlib.sha256(raw).hexdigest()})
    result['status'] = 'IN_PROGRESS' if ok else 'FAIL'
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(phase, 'PASS' if ok else 'FAIL', flush=True)
    if not ok:
        raise SystemExit(1)
    if phase in ('produce', 'upgrade'):
        shutil.copytree(root, output / (phase + '-snapshot'))
result['status'] = 'PASS_DOMAIN_ONLY'
result['app_old_store_admission'] = 'BLOCKED_BY_EXISTING_PRODUCT_GUARD'
(output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
