import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./experts-v2.generated";
import { explicitExpertInvocation } from "./explicit-expert";

const entry = { display: { expertId: "linkfox-expert-aigc-imagegen-mannequin-to-model", version: "0.1.0", displayName: "跨境电商服装人台换模特图专家" } } as CatalogEntry;

describe("explicit expert invocation", () => {
  it("uses the catalog and keeps the selected historical version", () => {
    expect(explicitExpertInvocation("请用 LinkFox 人台换模特图专家来出图", [entry], null)).toEqual({kind:"select", entry});
    expect(explicitExpertInvocation("用人台换模特图专家出图", [entry], {...entry.display, version:"0.0.9"}).kind).toBe("selected");
  });
  it("recognizes exact catalog names that do not end in 专家", () => {
    const expert = { ...entry, display: { ...entry.display, expertId:"other-expert", displayName:"漫剧编剧与分镜师" } };
    expect(explicitExpertInvocation("请用漫剧编剧与分镜师写分镜", [expert], null)).toEqual({kind:"select", entry:expert});
    expect(explicitExpertInvocation("请用漫剧编剧与分镜师的名字造句", [expert], null).kind).toBe("none");
  });
  it("preserves normal generation, questions and quotations", () => {
    for (const text of ["把人台换成真人", "不要用人台换模特图专家", "人台换模特图专家有什么功能？", "请解释“用人台换模特图专家出图”"]) {
      expect(explicitExpertInvocation(text, [entry], null).kind).toBe("none");
    }
    expect(explicitExpertInvocation("用其它专家出图", [entry], null).kind).toBe("ambiguous");
  });
});
