import { expect, it } from "vitest";
import { parseModelCatalog, parseModelState } from "./chat-model-client";
import { modelDefinitions } from "../domain/chat-models.generated";
it("accepts exact profiles and rejects a downgraded Kimi directory",()=>{const catalog={schema_version:1,default_profile:"kimi-k3-max-v1",models:modelDefinitions.map(profile=>({profile,available:true,reason:"ready"}))};expect(parseModelCatalog(catalog).models).toHaveLength(2);const changed=structuredClone(catalog);changed.models[0]!.profile.effort="high";expect(()=>parseModelCatalog(changed)).toThrow();});
it("preserves unresolved selection and rejects unknown model/revision",()=>{expect(parseModelState({profileId:null,revision:0,state:"unknown"}).state).toBe("unknown");for(const value of [{profileId:"future",revision:0,state:"ready"},{profileId:null,revision:-1,state:"unknown"}])expect(()=>parseModelState(value)).toThrow();});
