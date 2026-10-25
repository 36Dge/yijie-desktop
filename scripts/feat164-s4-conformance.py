#!/usr/bin/env python3
"""TCONF-164-04: safe call-surface subset, no App, paid HTTP or external tools."""
import argparse,datetime,hashlib,json,os,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--output',type=Path,required=True)
p.add_argument('--runtime-binary',type=Path,required=True)
p.add_argument('--runtime-manifest',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];host=root.parent/'yijie-agent-host'
a.output.mkdir(parents=True,exist_ok=False)
env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','CARGO_HOME','RUSTUP_HOME','SDKROOT','DEVELOPER_DIR','PKG_CONFIG_PATH') if k in os.environ}
candidate=dict(env,YIJIE_ENV='local',YIJIE_LOCAL_PROFILE='demo_fast',YIJIE_CHAT_MODELS_ENABLED='true',YIJIE_KIMI_K31_PRO_CANDIDATE='true',YIJIE_FEAT155_SCHEDULED_CANDIDATE='true',VITE_YIJIE_KIMI_K31_PRO_CANDIDATE='true',VITE_YIJIE_CHAT_MODELS_ENABLED='true')
integration=dict(env,YIJIE_CODEX_INTEGRATION_BINARY=str(a.runtime_binary.resolve(strict=True)),YIJIE_CODEX_INTEGRATION_MANIFEST=str(a.runtime_manifest.resolve(strict=True)))
cases=[
 ('host-service',host,env,['go','test','-race','-json','./internal/session','-run','^TestFEAT164MarketExpertModelWiring$','-count=1'],7),
 ('real-runtime',host,integration,['go','test','-race','-json','./internal/codex','-run','^TestFEAT164(CallSurfacesRuntime|DraftLoopbackAdmission|TitleCollectorNativeInputLifecycle|MarketCandidateAssembly)$','-count=1'],4),
 ('native-storage',root,candidate,['cargo','test','--offline','--locked','--manifest-path','src-tauri/Cargo.toml','--features','kimi-k31-pro-candidate','--lib','feat164_surfaces','--','--test-threads=1'],4),
 ('renderer',root,candidate,['pnpm','exec','vitest','run','src/api/call-surfaces.feat164.test.ts','src/components/schedules/ScheduledPlanForm.feat164.test.ts','--reporter=json'],4),
 ('candidate-profile',root,env,['node','--test','--test-reporter=tap','scripts/tests/feat164-candidate-closure.test.mjs'],5),
]
result={'test_id':'TCONF-164-04','scope':'S4 safe offline subset; auxiliary agent/review not invoked; App/platform NOT RUN','started_at':datetime.datetime.now().astimezone().isoformat(),'real_model_http_added':0,'expected_loopback_http':6,'sources':{},'checks':[]}
for name,repo in [('desktop',root),('host',host)]:result['sources'][name]={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'status':subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).splitlines()}
for name,cwd,child,cmd,count in cases:
 log=a.output/(name+'.log')
 # No timeout/kill. Tests own normal cleanup and retain files on failure.
 with log.open('wb') as f:r=subprocess.run(cmd,cwd=cwd,env=child,stdout=f,stderr=subprocess.STDOUT)
 text=log.read_text();passed=skipped=0
 if cmd[0]=='go':
  events=[json.loads(l) for l in text.splitlines() if l.startswith('{')]
  passed=sum(e.get('Action')=='pass' and bool(e.get('Test')) for e in events);skipped=sum(e.get('Action')=='skip' for e in events)
 elif cmd[0]=='cargo':
  match=re.search(r'test result: ok\. (\d+) passed; 0 failed; (\d+) ignored',text)
  if match:passed,skipped=map(int,match.groups())
 elif cmd[0]=='pnpm':
  report=json.loads(text[text.index('{'):]);passed=report['numPassedTests'];skipped=report['numPendingTests']+report.get('numTodoTests',0)
 else:
  match=re.search(r'# pass (\d+)',text);passed=int(match[1]) if match else 0
  match=re.search(r'# skipped (\d+)',text);skipped=int(match[1]) if match else -1
 ok=r.returncode==0 and passed==count and skipped==0
 if name=='real-runtime':ok=ok and '6 loopback Responses' in text
 result['checks'].append({'name':name,'command':cmd,'exit_code':r.returncode,'passed_cases':passed,'skipped':skipped,'sha256':hashlib.sha256(log.read_bytes()).hexdigest(),'result':'PASS' if ok else 'FAIL'})
 result['status']='IN_PROGRESS' if ok else 'FAIL';(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(name+': '+result['checks'][-1]['result'],flush=True)
 if not ok:raise SystemExit(1)
result['status']='PASS';result['verified_at']=datetime.datetime.now().astimezone().isoformat();(a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
