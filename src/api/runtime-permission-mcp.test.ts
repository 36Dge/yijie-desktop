import { describe, expect, it } from "vitest";
import { parseApprovalSnapshot, parseRuntimeApproval } from "./runtime-permission-client";

const approval = {id:"01440000-0000-4000-8000-000000000001",kind:"mcp",summary:"查询商品资料",scope:"Sorftime / product_detail",reason:"确认本次参数",status:"pending",mcp:{server:"sorftime",tool:"product_detail",asin:"B07H9PZDQW",marketplace:"US"}};
describe("native MCP approval boundary",()=>{
  it("keeps actual bounded parameters and the native cancel result",()=>{
    expect(parseRuntimeApproval(approval).mcp).toEqual(approval.mcp);
    expect(parseRuntimeApproval({...approval,status:"cancelled"}).status).toBe("cancelled");
  });
  it("does not infer missing parameters or accept a broader scope",()=>{
    expect(()=>parseRuntimeApproval({...approval,mcp:undefined})).toThrow();
    expect(()=>parseRuntimeApproval({...approval,mcp:{...approval.mcp,marketplace:"CA"}})).toThrow();
    expect(()=>parseRuntimeApproval({...approval,mcp:{...approval.mcp,asin:""}})).toThrow();
    expect(()=>parseRuntimeApproval({...approval,kind:"command"})).toThrow();
  });
});
it("binds prefix choices only to a pending command in the same snapshot and accepts older snapshots", () => {
  const request = { id: "01440000-0000-4000-8000-000000000001", kind: "command", status: "pending", reason: "", scope: "", summary: "git status" };
  expect(parseApprovalSnapshot({ requests: [request] })).toEqual([request]);
  const commandPrefixes = { [request.id]: ["git", "status"] };
  expect(parseApprovalSnapshot({ requests: [request], commandPrefixes })[0]?.commandPrefix).toEqual(["git", "status"]);
  for (const rows of [[], [{ ...request, kind: "file_change" }], [{ ...request, status: "approved" }]]) {
    expect(() => parseApprovalSnapshot({ requests: rows, commandPrefixes })).toThrow();
  }
});
