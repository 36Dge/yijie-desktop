// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatReasoningDisclosure from "./ChatReasoningDisclosure.vue";

describe("ChatReasoningDisclosure", () => {
  it("loads historical raw text only after an accessible disclosure is expanded", async () => {
    const wrapper = mount(ChatReasoningDisclosure, {
      props: {
        disclosureId: "reasoning-synthetic",
        metadata: [{ itemOrdinal: 0, status: "complete", reasonCode: null, totalBytes: 12, partCount: 1, finalizedAtMs: 1 }],
      },
    });
    const trigger = wrapper.get("button");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".reasoning__content").exists()).toBe(false);
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.emitted("load")).toHaveLength(1);
  });

  it("renders raw reasoning as literal text and never creates executable rich content", () => {
    const raw = '<img src=x onerror="alert(1)"> **not markdown**';
    const wrapper = mount(ChatReasoningDisclosure, {
      props: {
        disclosureId: "reasoning-live",
        live: true,
        defaultExpanded: true,
        liveParts: [{ itemOrdinal: 0, contentIndex: 0, text: raw }],
      },
    });
    expect(wrapper.text()).toContain(raw);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.html()).toContain("&lt;img");
  });

  it("announces incomplete and unavailable states without claiming full reasoning", async () => {
    const incomplete = mount(ChatReasoningDisclosure, {
      props: {
        disclosureId: "reasoning-incomplete",
        metadata: [{ itemOrdinal: 0, status: "incomplete", reasonCode: "interrupted", totalBytes: 3, partCount: 1, finalizedAtMs: 1 }],
      },
    });
    expect(incomplete.text()).toContain("推理记录因停止而不完整");
    const unavailable = mount(ChatReasoningDisclosure, {
      props: {
        disclosureId: "reasoning-unavailable",
        metadata: [{ itemOrdinal: 0, status: "unavailable", reasonCode: "not_emitted", totalBytes: 0, partCount: 0, finalizedAtMs: 1 }],
      },
    });
    await unavailable.get("button").trigger("click");
    expect(unavailable.text()).toContain("推理记录不可用");
  });
});
