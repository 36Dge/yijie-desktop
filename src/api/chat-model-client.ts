import { invoke } from "@tauri-apps/api/core";
import { modelDefinitions as legacyDefinitions, type Catalog as LegacyCatalog, type ProfileId as LegacyProfileId } from "../domain/chat-models.generated";
import { modelDefinitions as currentDefinitions, type Catalog as CurrentCatalog, type ProfileId as CurrentProfileId } from "../domain/chat-models-v2.generated";
export const kimiK31Candidate = import.meta.env.VITE_YIJIE_KIMI_K31_PRO_CANDIDATE === "true";
const modelDefinitions = kimiK31Candidate ? currentDefinitions : legacyDefinitions;
const knownDefinitions = [...legacyDefinitions, ...currentDefinitions];
type Catalog = LegacyCatalog | CurrentCatalog;
type ProfileId = LegacyProfileId | CurrentProfileId;
export const defaultModelProfile: ProfileId = kimiK31Candidate ? "kimi-k3-1-pro-max-v1" : "kimi-k3-max-v1";
import { parseCreatedTurnResponse, type ChatCreatedTurn, type ChatTurnContentBlock } from "../domain/chat-ipc";
export type { ProfileId, Catalog };
export interface ModelIntent { readonly profileId: ProfileId; readonly expectedRevision: number }
// Older market/expert/plan families remain closed until their own versioned
// source migration. Do not silently coerce a new identity into the old DTO.
export function legacyProfile(profile: ProfileId): LegacyProfileId | undefined {
 return profile === "kimi-k3-max-v1" || profile === "minimax-m3-high-v1" ? profile : undefined;
}
export function legacyModelIntent(intent: ModelIntent): { profileId: LegacyProfileId; expectedRevision: number } | undefined {
 const profileId = legacyProfile(intent.profileId);
 return profileId ? { profileId, expectedRevision: intent.expectedRevision } : undefined;
}
export interface ModelState { readonly profileId: ProfileId | null; readonly revision: number; readonly state: "ready" | "switching" | "unknown"; readonly pending?: Readonly<{operationId:string;profileId:ProfileId;expectedRevision:number}> | null }
export const chatModelsEnabled = import.meta.env.VITE_YIJIE_CHAT_MODELS_ENABLED === "true";
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("模型响应暂不可用"); return v as Record<string, unknown>; }
export function parseModelState(raw: unknown): ModelState {
 const v=record(raw);
 if ((v.profileId !== null && !knownDefinitions.some(p=>p.profile_id===v.profileId)) || !Number.isSafeInteger(v.revision) || (v.revision as number)<0 || !["ready","switching","unknown"].includes(v.state as string)) throw new Error("模型状态暂不可用");
 let pending:ModelState["pending"]=null;
 if(v.pending!==undefined&&v.pending!==null){const p=record(v.pending);if(typeof p.operationId!=="string"||!/^[0-9a-f-]{36}$/.test(p.operationId)||!knownDefinitions.some(d=>d.profile_id===p.profileId)||!Number.isSafeInteger(p.expectedRevision)||(p.expectedRevision as number)<0)throw new Error("模型操作暂不可用");pending={operationId:p.operationId,profileId:p.profileId as ProfileId,expectedRevision:p.expectedRevision as number};}
 return {profileId:v.profileId as ProfileId|null,revision:v.revision as number,state:v.state as ModelState["state"],pending};
}
export function parseModelCatalog(raw: unknown): Catalog {
 const v=record(raw);
 if (v.schema_version!==(kimiK31Candidate ? 2 : 1) || v.default_profile!==defaultModelProfile || !Array.isArray(v.models) || v.models.length!==2) throw new Error("当前执行环境不支持模型切换");
 const seen=new Set<string>();
 for(const rawEntry of v.models){const entry=record(rawEntry),p=record(entry.profile),known=modelDefinitions.find(d=>d.profile_id===p.profile_id);
  if(!known || seen.has(known.profile_id) || Object.entries(known).some(([k,value])=>p[k]!==value) || typeof entry.available!=="boolean" || !(kimiK31Candidate ? ["ready","not_configured","runtime_unavailable","activation_required"] : ["ready","not_configured","runtime_unavailable"]).includes(entry.reason as string)) throw new Error("模型目录不一致");
  if (kimiK31Candidate && entry.available !== (entry.reason === "ready")) throw new Error("模型可用状态不一致");
  seen.add(known.profile_id);
 }
 return v as unknown as Catalog;
}
async function call(command:string,contextId:string,payload:object):Promise<unknown>{
 const requestId=crypto.randomUUID();
 const response=record(await invoke(command,{request:{schemaVersion:1,requestId,contextId,payload}}));
 if(response.schemaVersion!==1||response.requestId!==requestId)throw new Error("模型响应不匹配");
 return response;
}
export const chatModelClient={
 async catalog(context:string){const r=record(await call("chat_model_catalog_v1",context,{}));return parseModelCatalog(r.data);},
 async state(context:string,sessionId:string){const r=record(await call("chat_model_state_v1",context,{sessionId}));return parseModelState(r.data);},
 async select(context:string,sessionId:string,intent:ModelIntent,operationId:string){const r=record(await call("chat_select_model_v1",context,{sessionId,intent,operationId}));return parseModelState(r.data);},
 async submit(context:string,projectId:string|null,sessionId:string|null,contentBlocks:readonly ChatTurnContentBlock[],operationId:string,intent:ModelIntent):Promise<ChatCreatedTurn>{
  return parseCreatedTurnResponse(await call("chat_model_submit_v1",context,{projectId,sessionId,contentBlocks,operationId,intent}));
 },
};
