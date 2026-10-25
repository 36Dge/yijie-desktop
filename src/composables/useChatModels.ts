import { computed, ref, watch } from "vue";
import { chatModelClient, chatModelsEnabled, defaultModelProfile, kimiK31Candidate, type Catalog, type ModelIntent, type ModelState, type ProfileId } from "../api/chat-model-client";
export function useChatModels(context:()=>string|null,target:()=>string|null,busy:()=>boolean,newDraft?:{get:()=>ProfileId;set:(profile:ProfileId)=>void}){
 const catalog=ref<Catalog|null>(null),state=ref<ModelState|null>(null),loading=ref(false),saving=ref(false),error=ref("");
 const localNewProfile=ref<ProfileId>(defaultModelProfile);
 const newProfile=computed({get:()=>newDraft?.get()??localNewProfile.value,set:(profile:ProfileId)=>{if(newDraft)newDraft.set(profile);else localNewProfile.value=profile;}});
 let epoch=0;let pending:{target:string;intent:ModelIntent;operationId:string;recoveryAvailable?:boolean}|null=null;
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
   pending=session&&s?.pending?{target:session,intent:{profileId:s.pending.profileId,expectedRevision:s.pending.expectedRevision},operationId:s.pending.operationId,recoveryAvailable:s.pending.recoveryAvailable}:null;
   if(s&&s.state!=="ready")error.value=kimiK31Candidate?(s.pending?.recoveryAvailable?"切换结果待核实。恢复将核对原操作，未完成时可能重新应用原目标模型；刷新仅查询状态。":"旧切换结果尚未结清，请刷新核对；不会自动重新应用模型。"):"切换结果待核实，请重试或刷新。";
  }catch{if(epoch===current)error.value="暂时无法读取模型，请刷新重试。";}finally{if(epoch===current)loading.value=false;}
 }
 async function select(id:ProfileId){
  const ctx=context(),session=target();if(!ctx||busy()||saving.value||loading.value||!catalog.value?.models.some(m=>m.profile.profile_id===id&&m.available))return;
  if(kimiK31Candidate&&session&&(pending||state.value?.state!=="ready"))return;
  if(pending&&pending.intent.profileId!==id)return;
  if(!session){newProfile.value=id;error.value="";return;}
  if(id===profile.value&&state.value?.state==="ready")return;
  const current=++epoch;saving.value=true;error.value="";
  if(!pending||pending.target!==session||pending.intent.profileId!==id)pending={target:session,intent:{profileId:id,expectedRevision:state.value?.revision??0},operationId:crypto.randomUUID()};
  const request=pending;
  try{const s=await chatModelClient.select(ctx,session,request.intent,request.operationId);if(epoch!==current||context()!==ctx||target()!==session)return;state.value=s;pending=null;if(s.state!=="ready")error.value="当前模型状态仍待核实，请刷新。";}
  catch{if(epoch===current){if(state.value)state.value={...state.value,state:"unknown"};error.value=kimiK31Candidate?"模型切换未完成，请刷新查询原操作，再明确恢复。":"模型切换未完成，请重试原操作。";}}
  finally{if(epoch===current)saving.value=false;}
 }
 const retryLabel=computed(()=>kimiK31Candidate?(state.value?.pending?.recoveryAvailable?"恢复原切换":"刷新状态"):"重试");
 async function retry(){
  if(!kimiK31Candidate){if(pending)await select(pending.intent.profileId);else await refresh();return;}
  const ctx=context(),session=target();
  if(!ctx||!session||!pending?.recoveryAvailable){await refresh();return;}
  if(busy()||saving.value||loading.value||pending.target!==session)return;
  const current=++epoch,request=pending;saving.value=true;error.value="";
  try{const value=await chatModelClient.recover(ctx,session,request.intent,request.operationId);if(current!==epoch||context()!==ctx||target()!==session)return;state.value=value;pending=null;if(value.state!=="ready")error.value="当前模型状态仍待核实，请刷新。";}
  catch{if(current===epoch)error.value="原切换尚未恢复，请刷新核对；不会发送新的对话请求。";}
  finally{if(current===epoch)saving.value=false;}
 }
 watch([context,target],([ctx],[oldCtx])=>{epoch++;state.value=null;saving.value=false;loading.value=false;pending=null;if(ctx!==oldCtx&&!newDraft)newProfile.value=defaultModelProfile;void refresh();},{immediate:true});
 watch(busy,(v,old)=>{if(old&&!v)void refresh();});
 return {catalog,state,profile,loading,saving,error,ready,intent,refresh,select,retry,retryLabel,resetNew:()=>{newProfile.value=defaultModelProfile;}};
}
