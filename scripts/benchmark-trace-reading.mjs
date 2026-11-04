// Normal synthetic, display-only benchmark. No network, provider or persistence.
import {createServer} from 'vite';
import {performance} from 'node:perf_hooks';
const server = await createServer({configFile:false,root:process.cwd(),logLevel:'silent',server:{middlewareMode:true,watch:{ignored:['**/.local/**','**/src-tauri/target/**']}}});
try {
  const {traceItem,traceTurn} = await server.ssrLoadModule('/src/domain/conversation-activity-fixtures.ts');
  const old = await server.ssrLoadModule('/src/domain/conversation-process.ts');
  const {conversationActivityPresentation} = await server.ssrLoadModule('/src/domain/conversation-activity-presentation.ts');
  const {summarizeActivity} = await server.ssrLoadModule('/src/domain/conversation-activity-summary.ts');
  const turn=traceTurn(Array.from({length:512},(_,i)=>i%8===0?traceItem(String(i),'commandExecution',{exitCode:0,commandActions:[{index:0,kind:'read',label:'README.md'}]}):i%2?traceItem(String(i),'reasoning',{summary:['Ordinary synthetic record']}):traceItem(String(i),'webSearch',{webSearch:{action:'search',queries:['ordinary sample'],sources:[{url:'https://example.org',title:'Sample'}]}})));
  const baseline=()=>{
    const items=turn.items.filter(item=>old.showProcessItem(item,turn));
    const observed=old.observedProgressMessages(turn.items,true);
    const process=items.filter(item=>old.isCollapsibleProcessItem(item,observed.has(item.identity)));
    return old.executionProgressDescriptions(turn,new Set(process.map(item=>item.identity)),old.processDetailItems(process));
  };
  const current=()=>conversationActivityPresentation(turn).map(node=>node.kind==='activity'?summarizeActivity(node.group,false):node);
  for(let i=0;i<100;i++){baseline();current();}
  const measure=fn=>{const start=performance.now();for(let i=0;i<500;i++)fn();return (performance.now()-start)/500;};
  const results={baseline_ms:[],current_ms:[]};
  for(let i=0;i<7;i++){results.baseline_ms.push(measure(baseline));results.current_ms.push(measure(current));}
  const median=values=>[...values].sort((a,b)=>a-b)[3];
  console.log(JSON.stringify({items:512,iterations_per_batch:500,batches:7,baseline_median_ms:median(results.baseline_ms),current_median_ms:median(results.current_ms),samples:results,scope:'Pure projection only; not a browser frame-rate or production throughput claim.'},null,2));
} finally {await server.close();}
