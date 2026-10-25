#!/usr/bin/env python3
"""Safe expert/media/native auxiliary checks; real Runtime, loopback model only."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
for flag in ('output', 'runtime-binary', 'runtime-manifest', 'worker-manifest', 'expert-bundle', 'artifact-adapter'):
    parser.add_argument('--' + flag, type=Path, required=True)
a = parser.parse_args()
root = Path(__file__).resolve().parents[1]
host = root.parent / 'yijie-agent-host'
env = {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME', 'SDKROOT', 'DEVELOPER_DIR', 'PKG_CONFIG_PATH') if k in os.environ}
# No caller's provider credentials, endpoint overrides or model settings inherited.
paths = {name: getattr(a, name).resolve(strict=True) for name in ('runtime_binary', 'runtime_manifest', 'worker_manifest', 'expert_bundle', 'artifact_adapter')}
assert paths['expert_bundle'].is_dir()
pin = json.loads((root / 'contracts/experts-assets-feat164.candidate.json').read_text())
assert hashlib.sha256((paths['expert_bundle'] / 'bundle-manifest.json').read_bytes()).hexdigest() == pin['manifest_sha256']
worker = json.loads(paths['worker_manifest'].read_text())
assert hashlib.sha256(Path(worker['binary']).read_bytes()).hexdigest() == worker['sha256']
assert worker['codexSource'] == '7fd463bcef07f37b0211acd9f62b9f93ea0a4b12'
assert worker['candidateOnly'] is True
candidate = dict(env, YIJIE_ENV='local', YIJIE_LOCAL_PROFILE='demo_fast', YIJIE_CHAT_MODELS_ENABLED='true', YIJIE_KIMI_K31_PRO_CANDIDATE='true', YIJIE_RUNTIME_PERMISSIONS_ENABLED='true')
integration = dict(env, YIJIE_CODEX_INTEGRATION_BINARY=str(paths['runtime_binary']), YIJIE_CODEX_INTEGRATION_MANIFEST=str(paths['runtime_manifest']), YIJIE_MARKET_BROKER_TEST_MANIFEST=str(paths['worker_manifest']), YIJIE_FEAT164_EXPERT_BUNDLE=str(paths['expert_bundle']), YIJIE_FEAT164_ARTIFACT_ADAPTER=str(paths['artifact_adapter']))
a.output.mkdir(parents=True, exist_ok=False)
result = {'test_id': 'TCONF-164-04', 'scope': 'S4b safe offline expert/media/auxiliary extension; App/platform NOT RUN', 'started_at': datetime.datetime.now().astimezone().isoformat(), 'real_model_http_added': 0, 'expected_loopback_http': 13, 'sources': {}, 'inputs': {}, 'checks': []}
for name, repo in [('desktop', root), ('host', host), ('connectors', root.parent / 'yijie-connectors'), ('skills', root.parent / 'yijie-skills'), ('runtime', root.parent / 'yijie-codex')]:
    result['sources'][name] = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(), 'status': subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo, text=True).splitlines()}
    assert not result['sources'][name]['status'], 'Committed clean source required: ' + name
for name, location in paths.items():
    file = location / 'bundle-manifest.json' if location.is_dir() else location
    result['inputs'][name] = {'path': str(location), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
result['inputs']['worker_binary'] = {'path': worker['binary'], 'sha256': worker['sha256']}
cases = []
for mode, flags in [('ordinary', (False, False, False)), ('market', (True, False, False)), ('experts', (True, True, False)), ('media', (True, True, True))]:
    profile = dict(candidate, YIJIE_KIMI_K31_CALL_SURFACES=mode)
    for key, enabled in zip(('YIJIE_MARKET_CONNECTORS_ENABLED', 'YIJIE_EXPERTS_ENABLED', 'YIJIE_ARTIFACT_MEDIA_ENABLED'), flags):
        profile[key] = str(enabled).lower()
    cases.append(('source-' + mode, root, profile, ['node', 'scripts/kimi-k31-build-candidate.mjs'], None, []))
cases.extend([
    ('expert-resources', host, integration, ['go', 'test', '-race', '-json', './internal/skills', '-run', '^TestFEAT164ImmutableExpertResources$', '-count=1'], 1, ['37 exact expert versions installed/resolved/reopened']),
    ('expert-media', host, integration, ['go', 'test', '-race', '-json', './internal/app', '-run', '^TestFEAT164ExpertMediaCanonicalRuntime$', '-count=1'], 3, ['1 loopback Responses; media=false', '3 loopback Responses; media=true']),
    ('native-auxiliary', host, integration, ['go', 'test', '-race', '-json', './internal/codex', '-run', '^TestFEAT164(NativeAuxiliaryAgent|NativeAuxiliaryCompaction|NativeGuardianModel|AuxiliaryMeterLayer)$', '-count=1'], 4, ['native parent3 + child1 loopback requests', '2 loopback Responses', 'native Guardian1 + ordinary2 loopback']),
    ('native-expert-resources', root, dict(candidate, YIJIE_DESKTOP_EXPERT_BUNDLE_TEST_ROOT=str(paths['expert_bundle'])), ['cargo', 'test', '--offline', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'kimi-k31-pro-candidate', '--lib', 'skills::catalog::tests::exact_reviewed_expert_bundle_loads_when_the_integration_root_is_supplied', '--', '--exact'], 1, []),
])
for name, cwd, child_env, cmd, expected, markers in cases:
    log = a.output / (name + '.log')
    # No timeout/kill. Native tests own normal shutdown and retain temporary roots on cleanup failure.
    with log.open('wb') as output:
        completed = subprocess.run(cmd, cwd=cwd, env=child_env, stdout=output, stderr=subprocess.STDOUT)
    body = log.read_text()
    passed = skipped = 0
    if cmd[0] == 'go':
        events = [json.loads(line) for line in body.splitlines() if line.startswith('{')]
        passed = sum(e.get('Action') == 'pass' and bool(e.get('Test')) for e in events)
        skipped = sum(e.get('Action') == 'skip' for e in events)
    elif cmd[0] == 'cargo':
        match = re.search(r'test result: ok\. (\d+) passed; 0 failed; (\d+) ignored', body)
        if match:
            passed, skipped = map(int, match.groups())
    ok = completed.returncode == 0 and skipped == 0 and (expected is None or passed == expected) and all(marker in body for marker in markers)
    result['checks'].append({'name': name, 'command': cmd, 'exit_code': completed.returncode, 'passed_cases': passed if expected is not None else None, 'skipped': skipped, 'sha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'result': 'PASS' if ok else 'FAIL'})
    result['status'] = 'IN_PROGRESS' if ok else 'FAIL'
    (a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(name + ': ' + result['checks'][-1]['result'], flush=True)
    if not ok:
        raise SystemExit(1)
result['status'] = 'PASS'
result['verified_at'] = datetime.datetime.now().astimezone().isoformat()
(a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
