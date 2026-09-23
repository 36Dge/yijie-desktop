import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { isSessionPurposeView } from "./chat-session-purpose.generated";
import { parseSessionPurposeResponse } from "./chat-ipc";
it("validates the source-driven purpose without accepting unknown roles or renderer metadata",()=>{
  const source=JSON.parse(readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v1.schema.json",import.meta.url),"utf8"));
  const check=new Ajv({strict:true}).compile({...source.$defs.sessionPurpose,$defs:{uuid:source.$defs.uuid}});
  const sessionId=crypto.randomUUID();
  for(const purpose of ["ordinary","scheduled_plan_draft"]){const value={sessionId,purpose};expect(check(value)).toBe(true);expect(isSessionPurposeView(value)).toBe(true);expect(parseSessionPurposeResponse({schemaVersion:1,requestId:crypto.randomUUID(),data:value})).toEqual(value);}
  for(const value of [{sessionId,purpose:"unknown"},{sessionId,purpose:"ordinary",scope:"renderer"},{sessionId,purpose:null}]){expect(check(value)).toBe(false);expect(isSessionPurposeView(value)).toBe(false);}
});
