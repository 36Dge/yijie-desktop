import { describe, expect, it } from "vitest";
import { readWebRetrievalResult } from "./web-retrieval-display";
describe("builtin web application errors",()=>{
  it("renders a Fetch URL refusal with its canonical reason", () => {
    const denied = {error: {code: "url_blocked", message: "网页读取服务的安全策略拒绝了此网址。"}};
    expect(readWebRetrievalResult("kimi_web_fetch", JSON.stringify(denied))).toEqual(denied);
  });
  it("renders the canonical quota message and retains the ordinary retrieval shape",()=>{
    const error={error:{code:"quota_exceeded",message:"网页检索额度已用尽。"}};
    expect(readWebRetrievalResult("kimi_web_search_pro",JSON.stringify(error))).toEqual(error);
    const ordinary={url:"https://example.com/docs",title:"公开资料",markdown:"普通正文",truncated:false};
    expect(readWebRetrievalResult("kimi_web_fetch",JSON.stringify(ordinary))).toEqual(ordinary);
  });
});
