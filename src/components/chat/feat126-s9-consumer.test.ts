// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import consumerFixture from "../../../src-tauri/fixtures/feat126-title-raw-v1/desktop-consumer.json";
import { parseReasoningResponse, type ChatReasoningMetadata } from "../../domain/chat-ipc";
import ChatReasoningDisclosure from "./ChatReasoningDisclosure.vue";

describe("FEAT-126 authoritative fake-provider consumer fixture", () => {
  it("validates and renders raw reasoning as bounded literal plaintext", () => {
    expect(consumerFixture.datasetId).toBe("feat126-title-raw-v1");
    const items = parseReasoningResponse(consumerFixture.reasoningResponse);
    const metadata: readonly ChatReasoningMetadata[] = items.map((item) => ({
      itemOrdinal: item.itemOrdinal,
      status: item.status,
      reasonCode: item.reasonCode,
      totalBytes: item.parts.reduce(
        (total, part) => total + new TextEncoder().encode(part.text).length,
        0,
      ),
      partCount: item.parts.length,
      finalizedAtMs: item.finalizedAtMs,
    }));
    const wrapper = mount(ChatReasoningDisclosure, {
      props: {
        disclosureId: "feat126-authority-fixture",
        metadata,
        items,
        defaultExpanded: true,
      },
    });

    const raw = "先核对约束。\n<script>not executable</script>\n再给出结论。";
    expect(wrapper.text()).toContain(raw);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.html()).toContain("&lt;script&gt;not executable&lt;/script&gt;");
  });
});
