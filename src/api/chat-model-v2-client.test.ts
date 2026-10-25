import { afterEach, expect, it, vi } from "vitest";
import { modelDefinitions } from "../domain/chat-models-v2.generated";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("uses the exact v2 catalog only in the candidate and preserves known old state", async () => {
 vi.stubEnv("VITE_YIJIE_KIMI_K31_PRO_CANDIDATE", "true"); vi.resetModules();
 const client = await import("./chat-model-client");
 expect(client.defaultModelProfile).toBe("kimi-k3-1-pro-max-v1");
 const value = {schema_version:2,default_profile:client.defaultModelProfile,models:modelDefinitions.map(profile=>({profile,available:true,reason:"ready"}))};
 expect(client.parseModelCatalog(value).models[0]?.profile.model).toBe("kimi-k3.1-pro");
 expect(()=>client.parseModelCatalog({...value,schema_version:1})).toThrow();
 const inconsistent=structuredClone(value);inconsistent.models[0]!.available=false;
 expect(()=>client.parseModelCatalog(inconsistent)).toThrow();
 expect(client.parseModelState({profileId:"kimi-k3-max-v1",revision:7,state:"ready"}).profileId).toBe("kimi-k3-max-v1");
 expect(client.legacyModelIntent({profileId:client.defaultModelProfile,expectedRevision:0})).toBeUndefined();
 expect(client.legacyModelIntent({profileId:"minimax-m3-high-v1",expectedRevision:3})?.expectedRevision).toBe(3);
 const pending={operationId:crypto.randomUUID(),profileId:"minimax-m3-high-v1",expectedRevision:7,recoveryAvailable:false};
 expect(client.parseModelState({profileId:"kimi-k3-max-v1",revision:7,state:"unknown",pending}).pending?.recoveryAvailable).toBe(false);
 expect(()=>client.parseModelState({profileId:"kimi-k3-max-v1",revision:7,state:"unknown",pending:{...pending,recoveryAvailable:"true"}})).toThrow();
});
