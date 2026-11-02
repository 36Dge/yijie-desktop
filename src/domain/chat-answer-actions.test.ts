import { describe, expect, it } from "vitest";
import { answerCompletionTime, answerFeedbackReasons, answerModelBadge, nativeCompletedAt } from "./chat-answer-actions";
describe("answer metadata presentation", () => {
  it("uses exact current or retired model identities and never substitutes a default", () => {
    expect(answerModelBadge("kimi-k3-1-pro-max-v1")).toEqual({label:"Kimi K3.1 Pro",icon:"modelKimi"});
    expect(answerModelBadge("kimi-k3-max-v1").label).toBe("Kimi K3");
    expect(answerModelBadge("minimax-m3-high-v1").icon).toBe("modelMiniMax");
    expect(answerModelBadge(null).label).toBe("模型未知");
    expect(answerModelBadge("future-profile").label).toBe("模型未知");
  });
  it("formats the authoritative finish instant, including yesterday and missing facts", () => {
    const date = new Date(2026,10,2,11,39,12);
    const time = date.getTime()/1000;
    expect(answerCompletionTime(time,date.getTime())?.label).toBe("11:39");
    expect(answerCompletionTime(time,new Date(2026,10,3,10).getTime())?.label).toBe("昨天 11:39");
    expect(answerCompletionTime(time,new Date(2026,10,4,10).getTime())?.label).toBe("11月2日 11:39");
    expect(answerCompletionTime(time)?.datetime).toBe(date.toISOString());
    expect(answerCompletionTime(0)).not.toBeNull();
    expect(answerCompletionTime(null)).toBeNull(); expect(nativeCompletedAt(null)).toBeNull();
  });
  it("offers the six local reasons without a freeform other-reason option", () => {
    expect(answerFeedbackReasons).toHaveLength(6);
    expect(answerFeedbackReasons).not.toContain("其他原因");
  });
});
