"""Ordinary loopback MCP and Responses peers; never a product worker or result injector.

Only real received tools/call requests increment the sample count. All sample
values are explicitly local. No credentials, user prompts or capabilities logged.
Normal POST /control/stop closes both HTTP servers without process signals.
"""
import argparse
import hashlib
import http.server
import json
from pathlib import Path
import re
import threading
import time
import uuid

PROFILE=json.loads((Path(__file__).resolve().parents[1]/"contracts/market-local-acceptance.json").read_text())
TOOL="m_"+hashlib.sha256((PROFILE["provider"]["serviceId"]+"\n"+PROFILE["tool"]["name"]).encode()).hexdigest()[:60]

class State:
    def __init__(self,output):
        self.lock=threading.RLock();self.output=output;self.calls=[];self.steps={};self.requests=0;self.servers=[];self.inflight=0
    def record(self,value):
        with self.lock:
            with (self.output/'protocol.jsonl').open('a') as f:f.write(json.dumps({'timeMs':int(time.time()*1000),**value},ensure_ascii=False)+'\n')
    def view(self):
        with self.lock:return {'schemaVersion':1,'kind':'ordinary-local-protocol','modelRequests':self.requests,'toolCalls':self.calls.copy(),'inflight':self.inflight,'modelPeerForwardsToSupplier':False,'tool':TOOL}

def latest_case(body):
    users=[x for x in body.get('input',[]) if isinstance(x,dict) and x.get('role')=='user']
    text=json.dumps(users[-1] if users else {},ensure_ascii=False)
    match=re.search(r'LOCAL_CASE_(REJECT|TWICE|DUAL|ERROR|SLOW|CANCEL|ONCE|SESSION_HIT|SESSION|ALWAYS|AFTER_RESTART|AFTER_REVOKE|SAVE_FOR_REINSTALL|NEW_INSTALLATION|FULL|GUARDIAN_ALLOW|GUARDIAN_DENY)\b',text)
    return match.group(1) if match else None

def discovered_native_tool(body):
    # Use the real native search output. Codex owns name normalization and may
    # shorten a long MCP name; the worker's raw tool name is not a JS binding.
    for item in reversed(body.get('input',[])):
        if not isinstance(item,dict) or item.get('type')!='function_call_output':continue
        value=item.get('output')
        if not isinstance(value,str):continue
        try:value=json.loads(value)
        except ValueError:continue
        if not isinstance(value,dict):continue
        for namespace in value.get('tools',[]):
            if namespace.get('type')!='namespace' or namespace.get('name')!='mcp__yijie_market':continue
            for tool in namespace.get('tools',[]):
                if 'market-local-verification' not in tool.get('description',''):continue
                name=namespace['name']+'__'+tool.get('name','')
                if re.fullmatch(r'[A-Za-z0-9_]{1,128}',name):return name
    return None

def running_native_cell(body):
    # Only the latest native output can request a wait. Never reuse an older
    # cell, infer completion, or substitute a tool result.
    for item in reversed(body.get('input',[])):
        if isinstance(item,dict) and item.get('role')=='user':return None
        if not isinstance(item,dict) or item.get('type')!='function_call_output':continue
        output=item.get('output')
        if isinstance(output,list):
            output='\n'.join(block.get('text','') for block in output if isinstance(block,dict))
        if not isinstance(output,str):return None
        match=re.search(r'^Script running with cell ID ([A-Za-z0-9_-]+)\s*$',output,re.MULTILINE)
        return match.group(1) if match else None
    return None

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*_):pass
    def reply(self,status,value=None):
        data=json.dumps(value,ensure_ascii=False).encode() if value is not None else b''
        self.send_response(status);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        if data:self.send_header('Content-Type','application/json')
        self.end_headers()
        if data:self.wfile.write(data)
    def do_GET(self):
        if self.path=='/status':self.reply(200,self.server.state.view())
        else:self.reply(405)
    def do_DELETE(self):self.reply(200)
    def do_POST(self):
        size=int(self.headers.get('Content-Length','0'))
        if size<=0 or size>2*1024*1024:self.reply(400);return
        try:body=json.loads(self.rfile.read(size))
        except (ValueError,UnicodeError):self.reply(400);return
        if self.path=='/control/stop':
            if self.server.state.view()['inflight']:
                self.reply(409,{'stopping':False,'reason':'ordinary calls still finishing'});return
            self.reply(200,{'stopping':True})
            for server in self.server.state.servers:threading.Thread(target=server.shutdown).start()
        elif self.path=='/mcp':self.mcp(body)
        elif self.path=='/v1/responses':self.model(body)
        else:self.reply(404)
    def mcp(self,body):
        state=self.server.state;method=body.get('method');request_id=body.get('id')
        call_record=None
        state.record({'event':'mcp_request','method':method})
        if request_id is None:self.reply(202);return
        if method=='initialize':result={'protocolVersion':'2025-11-25','capabilities':{'tools':{}},'serverInfo':{'name':'ordinary-local-acceptance','version':'1.0.0'}}
        elif method=='tools/list':result={'tools':[PROFILE['tool']]}
        elif method=='ping':result={}
        elif method=='tools/call':
            params=body.get('params',{});args=params.get('arguments',{})
            if params.get('name')!='local_sample' or set(args)!={'scenario','marker'} or args['scenario'] not in ['structured','dual','error','slow'] or not isinstance(args['marker'],str) or not 1<=len(args['marker'])<=48:self.reply(400);return
            with state.lock:
                call={'serial':len(state.calls)+1,'scenario':args['scenario'],'marker':args['marker'],'source':'ordinary-local-sample'};state.calls.append(call);state.inflight+=1
            call_record=call
            state.record({'event':'tool_received',**call})
            if args['scenario']=='slow':time.sleep(12)
            structured={**call,'value':{'colour':'blue','quantity':2}}
            result={'content':[],'structuredContent':structured,'isError':args['scenario']=='error'}
            if args['scenario']=='dual':result['content']=[{'type':'text','text':'本地样本文本：blue summary'}]
            if args['scenario']=='error':result['content']=[{'type':'text','text':'本地验收端正常返回的业务错误；没有外部操作。'}]
            state.record({'event':'tool_response_prepared',**call,'isError':result['isError']})
        else:self.reply(400);return
        try:
            self.reply(200,{'jsonrpc':'2.0','id':request_id,'result':result})
            if call_record:state.record({'event':'tool_response_sent',**call_record})
        except (BrokenPipeError,ConnectionResetError):state.record({'event':'client_closed_after_response','method':method})
        finally:
            if call_record:
                with state.lock:state.inflight-=1
    def model(self,body):
        state=self.server.state
        if (body.get('stream') is True and
                ('risk_level' in body.get('instructions','') or '"outcome"' in json.dumps(body.get('text',{})))):
            # Only the explicit local Guardian cases have a scripted model assessment.
            review_input=json.dumps(body.get('input',[]))
            markers=[outcome for outcome in ('allow','deny') if 'local-guardian_'+outcome in review_input]
            if len(markers)!=1:
                self.reply(400,{'error':'explicit local Guardian marker required'})
                return
            with state.lock:
                state.requests+=1
                if state.requests>64:
                    self.reply(429,{'error':'bounded local sequence exhausted'})
                    return
            outcome=markers[0]
            state.record({'event':'model_guardian_review','outcome':outcome})
            self.model_item({'type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':json.dumps({'outcome':outcome,'risk_level':'low','user_authorization':'high','rationale':'Ordinary local sample.'}),'annotations':[]}]})
            return
        case=latest_case(body)
        if case is None or body.get('stream') is not True:self.reply(400,{'error':'explicit local case required'});return
        meta=body.get('client_metadata',{});nested=meta.get('x-codex-turn-metadata','{}')
        try:nested=json.loads(nested) if isinstance(nested,str) else nested
        except ValueError:nested={}
        turn=meta.get('turn_id') or nested.get('turn_id')
        # Driver sequencing is not Runtime identity. If the provider transport
        # omits metadata, keep it absent; never fabricate an approval/turn ID.
        driver_key=turn or 'case:'+case
        running_cell=running_native_cell(body)
        with state.lock:
            state.requests+=1;step=state.steps.get(driver_key,0)
            if not running_cell:state.steps[driver_key]=step+1
        state.record({'event':'model_protocol_request','turnId':turn,'case':case,'step':step})
        if state.requests>64 or step>5:self.reply(429,{'error':'bounded local sequence exhausted'});return
        call='call_'+uuid.uuid4().hex
        direct=body.get('model')=='MiniMax-M3'
        first_call=0 if direct else 1
        if running_cell:
            state.record({'event':'native_wait_used','turnId':turn,'cellId':running_cell})
            item={'type':'function_call','name':'wait','call_id':call,'arguments':json.dumps({'cell_id':running_cell,'yield_time_ms':20000,'max_tokens':3000})}
        elif not direct and step==0:
            item={'type':'function_call','name':'tool_search','call_id':call,'arguments':json.dumps({'query':'本地连接器验收 local_sample','limit':1})}
        elif step==first_call or (case=='TWICE' and step==first_call+1):
            if direct:
                native_tool=next((tool['name'] for tool in body.get('tools',[]) if tool.get('type')=='function'
                    and tool.get('name','').startswith('mcp__yijie_market__')
                    and 'market-local-verification' in tool.get('description','')),None)
            else:
                native_tool=discovered_native_tool(body)
            if not native_tool:
                state.record({'event':'driver_failed','reason':'native_binding_missing','turnId':turn})
                self.reply(400,{'error':'native market binding unavailable'})
                return
            scenario={'DUAL':'dual','ERROR':'error','SLOW':'slow','CANCEL':'slow'}.get(case,'structured')
            args={'scenario':scenario,'marker':'local-'+case.lower()}
            state.record({'event':'native_binding_used','turnId':turn,'name':native_tool})
            item={'type':'function_call','name':native_tool if direct else 'exec','call_id':call,
                  'arguments':json.dumps(args if direct else {'input':'text(await tools['+json.dumps(native_tool)+']('+json.dumps(args)+'));'})}
        else:item={'type':'message','role':'assistant','phase':'final_answer','status':'completed','content':[{'type':'output_text','text':'本地协议驱动已结束。是否批准、工具是否执行及结果状态，以界面中的真实工具记录为准。','annotations':[]}]}
        self.model_item(item)

    def model_item(self,item):
        state=self.server.state
        rid='local_'+uuid.uuid4().hex;item['id']='item_'+rid
        events=[{'type':'response.created','response':{'id':rid,'status':'in_progress','output':[]}}, {'type':'response.output_item.added','output_index':0,'item':item}, {'type':'response.output_item.done','output_index':0,'item':item}, {'type':'response.completed','response':{'id':rid,'status':'completed','output':[item]}}]
        data=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events).encode()
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):state.record({'event':'model_protocol_client_closed','turnId':turn})

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True,mode=0o700);state=State(args.output)
    state.record({'event':'peer_start','profileSha256':hashlib.sha256(json.dumps(PROFILE,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    for port in [18083,18085]:
        server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler);server.state=state;state.servers.append(server)
    threads=[threading.Thread(target=s.serve_forever) for s in state.servers]
    for t in threads:t.start()
    print(json.dumps({'ready':True,'ports':[18083,18085],'tool':TOOL}),flush=True)
    for t in threads:t.join()
    for s in state.servers:s.server_close()
    (args.output/'final-status.json').write_text(json.dumps(state.view(),ensure_ascii=False,indent=2)+'\n')
    print('Ordinary local peers stopped normally.',flush=True)
if __name__=='__main__':main()
