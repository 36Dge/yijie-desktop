// Render every committed Native revision in the real chat component in an
// isolated Chromium profile. Close Chromium via its normal Browser.close RPC.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "vite";

const exchange = path.resolve(process.argv[2]);
const root = fileURLToPath(new URL("../", import.meta.url));
const data = {views: JSON.parse(await readFile(path.join(exchange, "native-views.json"))),
  reopened: JSON.parse(await readFile(path.join(exchange, "native-reopened.json")))};
const page = `<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module">
import {createApp, h, shallowRef, nextTick} from "/node_modules/.vite/deps/vue.js";
import ChatTurnGroup from "/src/components/chat/ChatTurnGroup.vue";
import {composeConversationView} from "/src/domain/conversation-view.ts";
import {selectConversationTimeline} from "/src/domain/conversation-timeline.ts";
window.runAcceptance = async function(mode) {
  const {views,reopened} = await (await fetch("/__publication/data")).json();
  const project = view => {
    const state = composeConversationView({threads:[{threadId:view.sessionId,status:"ready"}],turns:[],items:[]},[view]);
    return selectConversationTimeline(state,view.sessionId,undefined,{protectApprovalProcessContent:false,
      liveTurnId:view.status==="inProgress" && !view.terminalObserved?view.turnId:null}).turns[0];
  };
  const root = document.getElementById("app");
  const frames = mode === "history" ? [reopened] : views;
  const turn = shallowRef(project(frames[0]));
  const app = createApp({setup:()=>()=>h(ChatTurnGroup,{turn:turn.value,position:1})});
  app.mount(root);
  const button = ()=>root.querySelector(".chat-turn-group__process-toggle");
  const state = ()=>button()?.getAttribute("aria-expanded") ?? null;
  const transitions = [];
  let last = null, manual = false;
  for(const view of frames) {
    turn.value = project(view);
    await nextTick();
    const current = state();
    const final = view.items.find(({item})=>item.type==="agentMessage" && item.phase==="final_answer" && item.text?.trim());
    if(current!==null && current!==last) {
      transitions.push({revision:view.revision,previous:last,current,readableFinalId:final?.item.id??null,terminal:view.terminalObserved});
      last=current;
    }
    if(mode==="manual" && final && state()==="false" && !manual) {
      button().click();await nextTick();manual=state()==="true";last=state();
    }
  }
  const final = reopened.items.find(({item})=>item.type==="agentMessage" && item.phase==="final_answer");
  const answer = final?.item.text ?? "";
  const firstLine = answer.trimStart().split("\\n",1)[0].replace(/^#+\\s*/, "").replaceAll("*","").trim().slice(0,12);
  const visible = () => root.querySelector(".chat-turn-group__item--final_answer, .chat-turn-output")?.innerText.includes(firstLine) ?? false;
  const end=performance.now()+3000;
  while(final && !visible() && performance.now()<end) await new Promise(r=>setTimeout(r,30));
  const readable = Boolean(firstLine) && visible();
  const neutral = reopened.items.find(({item})=>item.type==="unpublishedText");
  const detail = root.querySelector("details.chat-activity-row__unpublished");
  let partialVisible=false;
  if(neutral && detail){ detail.open=true; await nextTick(); partialVisible=detail.innerText.includes(neutral.item.text.slice(0,20)); }
  const result={transitions,manual,expanded:state(),answerVisible:readable,answerId:final?.item.id,partialVisible};
  app.unmount();
  return result;
};
</script>`;
const server = await createServer({root,logLevel:"error",server:{host:"127.0.0.1",port:0,strictPort:false},
  plugins:[{name:"publication-acceptance",configureServer(server) {
    server.middlewares.use((req,res,next)=>{
      if(req.url==="/__publication/data") {res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));}
      else if(req.url==="/__publication") {res.setHeader("Content-Type","text/html");res.end(page);}
      else next();
    });
  }}]});
await server.listen();
const origin="http://127.0.0.1:"+server.httpServer.address().port;
const profile=await mkdtemp(path.join(tmpdir(),"yijie-publication-chromium-"));
const chrome=spawn(process.env.CHROME_BINARY ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new","--disable-background-networking","--disable-sync","--no-first-run","--no-default-browser-check",
   "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const exited=once(chrome,"exit");
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(read) {
  let last;const deadline=Date.now()+30000;
  while(Date.now()<deadline) {try{const v=await read();if(v)return v;}catch(e){last=e;} await delay(100);}
  throw last??new Error("Browser readiness deadline");
}
async function connection(url) {
  const ws=new WebSocket(url);await once(ws,"open");
  let id=0;const pending=new Map();
  ws.addEventListener("message",({data})=>{const value=JSON.parse(data);const pair=pending.get(value.id);
    if(pair){pending.delete(value.id);if(value.error)pair.reject(new Error(value.error.message));else pair.resolve(value.result);}});
  return {rpc(method,params={}){return new Promise((resolve,reject)=>{id++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});},close(){ws.close();}};
}
let browser,tab;
try {
  const port=await wait(async()=>Number((await readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]));
  const endpoint="http://127.0.0.1:"+port;
  const info=await (await fetch(endpoint+"/json/version")).json();
  browser=await connection(info.webSocketDebuggerUrl);
  const pages=await (await fetch(endpoint+"/json/list")).json();
  tab=await connection(pages.find(v=>v.type==="page").webSocketDebuggerUrl);
  async function go() {
    await tab.rpc("Page.navigate",{url:origin+"/__publication"});
    await wait(async()=>(await tab.rpc("Runtime.evaluate",{expression:"typeof window.runAcceptance==='function'"})).result.value);
  }
  async function run(mode) {
    const result=await tab.rpc("Runtime.evaluate",{expression:"window.runAcceptance("+JSON.stringify(mode)+")",awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result.value;
  }
  await go();
  const live=await run("live"),manual=await run("manual");
  await go();
  const history=await run("history");
  const folds=live.transitions.filter(t=>t.previous==="true"&&t.current==="false");
  const result={browser:info.Browser,live,manual,history,autoFolds:folds.length,prematureFolds:folds.filter(t=>!t.readableFinalId).length};
  await writeFile(path.join(exchange,"browser-result.json"),JSON.stringify(result,null,2)+"\n");
  if(data.reopened.status==="interrupted") {
    assert.equal(result.autoFolds,0);assert.equal(live.expanded,"true");
    assert.equal(live.partialVisible,true);assert.equal(history.partialVisible,true);
  } else {
  assert.equal(result.autoFolds,1);
  assert.equal(result.prematureFolds,0);
  assert.equal(manual.manual,true);
  assert.equal(manual.expanded,"true");
  assert.equal(history.expanded,"false");
  assert.equal(history.answerVisible,true);
  }
  console.log(JSON.stringify({browser:info.Browser,autoFolds:result.autoFolds,prematureFolds:result.prematureFolds,manualReopen:manual.expanded,history:history.expanded}));
} finally {
  if(tab)tab.close();
  if(browser)await browser.rpc("Browser.close").catch(()=>{});
  await exited;
  await server.close();
  await rm(profile,{recursive:true,force:true});
}
