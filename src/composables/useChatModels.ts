import { computed, ref, watch } from "vue";
import { chatModelClient, chatModelsEnabled, type Catalog, type ModelIntent, type ModelState, type ProfileId } from "../api/chat-model-client";
export function useChatModels(context:()=>string|null,target:()=>string|null,busy:()=>boolean,newDraft?:{get:()=>ProfileId;set:(profile:ProfileId)=>void}){
 const catalog=ref<Catalog|null>(null),state=ref<ModelState|null>(null),loading=ref(false),saving=ref(false),error=ref("");
 const localNewProfile=ref<ProfileId>("kimi-k3-max-v1");
 const newProfile=computed({get:()=>newDraft?.get()??localNewProfile.value,set:(profile:ProfileId)=>{if(newDraft)newDraft.set(profile);else localNewProfile.value=profile;}});
 let epoch=0;let pending:{target:string;intent:ModelIntent;operationId:string}|null=null;
 const profile=computed(()=>target()===null?newProfile.value:state.value?.profileId??null);
 const available=computed(()=>catalog.value?.models.some(m=>m.profile.profile_id===profile.value&&m.available)??false);
 const ready=computed(()=>!chatModelsEnabled||(!error.value&&!loading.value&&!saving.value&&available.value&&(target()===null||state.value?.state==="ready")));
 const intent=computed<ModelIntent|undefined>(()=>chatModelsEnabled&&ready.value&&profile.value?Object.freeze({profileId:profile.value,expectedRevision:target()===null?0:state.value?.revision??0}):undefined);
 async function refresh(){
  const ctx=context(),session=target(),current=++epoch;
  if(!chatModelsEnabled||!ctx){catalog.value=null;state.value=null;return;}
  loading.value=true;error.value="";
  try{const c=await chatModelClient.catalog(ctx);const s=session?await chatModelClient.state(ctx,session):null;
   if(epoch!==current||context()!==ctx||target()!==session)return;catalog.value=c;state.value=s;
   pending=session&&s?.pending?{target:session,intent:{profileId:s.pending.profileId,expectedRevision:s.pending.expectedRevision},operationId:s.pending.operationId}:null;
   if(s&&s.state!=="ready")error.value="切换结果待核实，请重试或刷新。";
  }catch{if(epoch===current)error.value="暂时无法读取模型，请刷新重试。";}finally{if(epoch===current)loading.value=false;}
 }
 async function select(id:ProfileId){
  const ctx=context(),session=target();if(!ctx||busy()||saving.value||loading.value||!catalog.value?.models.some(m=>m.profile.profile_id===id&&m.available))return;
  if(pending&&pending.intent.profileId!==id)return;
  if(!session){newProfile.value=id;error.value="";return;}
  if(id===profile.value&&state.value?.state==="ready")return;
  const current=++epoch;saving.value=true;error.value="";
  if(!pending||pending.target!==session||pending.intent.profileId!==id)pending={target:session,intent:{profileId:id,expectedRevision:state.value?.revision??0},operationId:crypto.randomUUID()};
  const request=pending;
  try{const s=await chatModelClient.select(ctx,session,request.intent,request.operationId);if(epoch!==current||context()!==ctx||target()!==session)return;state.value=s;pending=null;}
  catch{if(epoch===current){if(state.value)state.value={...state.value,state:"unknown"};error.value="模型切换未完成，请重试原操作。";}}
  finally{if(epoch===current)saving.value=false;}
 }
 async function retry(){if(pending){await select(pending.intent.profileId);}else await refresh();}
 watch([context,target],([ctx],[oldCtx])=>{epoch++;state.value=null;saving.value=false;loading.value=false;pending=null;if(ctx!==oldCtx&&!newDraft)newProfile.value="kimi-k3-max-v1";void refresh();},{immediate:true});
 watch(busy,(v,old)=>{if(old&&!v)void refresh();});
 return {catalog,state,profile,loading,saving,error,ready,intent,refresh,select,retry,resetNew:()=>{newProfile.value="kimi-k3-max-v1";}};
}
