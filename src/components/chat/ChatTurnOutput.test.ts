// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView, type ConversationItemSnapshot } from "../../domain/conversation-view";
import { selectConversationTimeline, type ConversationTimelineItemViewModel, type ConversationTimelineArtifactReferenceContentBlock } from "../../domain/conversation-timeline";
import { conversationActivityPresentation } from "../../domain/conversation-activity-presentation";
import { groupConversationTurnOutput } from "../../domain/conversation-turn-output";
import { createArtifactProjection } from "../../domain/chat-artifact";
import type { ChatArtifact } from "../../domain/chat-ipc";
import ChatArtifactList from "./ChatArtifactList.vue";
import ChatTurnGroup from "./ChatTurnGroup.vue";
import ChatTimeline from "./ChatTimeline.vue";

enableAutoUnmount(afterEach);
const SESSION = "019c1a00-0000-7000-8000-000000000901";
const TURN = "019c1a00-0000-7000-8000-000000000902";
const CONTEXT = "019c1a00-0000-7000-8000-000000000903";
const formats = [
  ["txt", "text/plain"], ["md", "text/markdown"], ["html", "text/html"], ["csv", "text/csv"], ["json", "application/json"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["pdf", "application/pdf"],
];
function files(count = 4, status: ChatArtifact["status"] = "ready", turnId = TURN) {
  return formats.slice(-count).map(([extension, mediaType], index) => createArtifactProjection(SESSION, turnId, {
    artifactId: `019c1a00-0000-7000-8000-${String(index + 920).padStart(12, "0")}`,
    kind: "file", provenance: "synthetic", status, ordinal: index,
    progressStage: null, progressPercent: null, displayName: `杭州样本.${extension}`, mediaType: mediaType!,
    sizeBytes: 2048, localCommittedAt: 1000, expiresAt: 605801000, hasPoster: false, errorCode: null, retryable: null,
  }));
}
function timeline(options: {
  count?: number; phase?: "final_answer" | "commentary" | null; text?: string; live?: boolean;
  artifactStatus?: ChatArtifact["status"]; turnId?: string; source?: NativeConversationView["source"];
} = {}) {
  const turnId = options.turnId ?? TURN;
  const artifacts = files(options.count ?? 4, options.artifactStatus, turnId);
  const references: ConversationItemSnapshot[] = artifacts.map(file => ({
    threadId: SESSION, turnId, itemId: `artifact:${file.artifactId}`, ordinal: 1000 + file.ordinal,
    kind: "artifact", status: file.status === "announced" ? "streaming" : "completed",
    contentBlocks: [{type: "artifact_reference", blockIndex: 0, artifactId: file.artifactId, label: file.displayName}],
  }));
  const view: NativeConversationView = {
    sessionId: SESSION, turnId, runtimeThreadId: "native-thread", runtimeTurnId: `native:${turnId}`,
    revision: "1", source: options.source ?? "native_observed", availability: "available",
    statusSource: "runtime_notification", status: options.live ? "inProgress" : "completed", terminalObserved: !options.live,
    items: options.text === "" ? [] : [{
      ordinal: 0, lastMethod: options.live ? "item/started" : "item/completed",
      item: {id: "answer", type: "agentMessage", availability: "available", text: options.text ?? "已完成文档，请查看以下文件。",
        ...(options.phase === null ? {} : {phase: options.phase ?? "final_answer"})},
    }],
  };
  const state = composeConversationView({
    threads: [{threadId: SESSION, status: "ready"}],
    turns: [{threadId: SESSION, turnId, ordinal: 0, status: options.live ? "in_progress" : "completed", terminalStatus: options.live ? null : "completed"}],
    items: references,
  }, [view]);
  return { artifacts, view, timeline: selectConversationTimeline(state, SESSION, undefined, {protectApprovalProcessContent: false, liveTurnId: options.live ? turnId : null})! };
}
function slotsFor(source: ReturnType<typeof files> | (() => ReturnType<typeof files>)) {
  const openFile = vi.fn();
  const client = {readFilePreview: vi.fn(), saveFile: vi.fn(async () => ({status: "cancelled" as const, code: null}))};
  const reference = vi.fn(({item, block}: {item: ConversationTimelineItemViewModel; block: ConversationTimelineArtifactReferenceContentBlock}) =>
    h(ChatArtifactList, {artifacts: (typeof source === "function" ? source() : source).filter(file => file.sessionId === item.threadId && file.turnId === item.turnId && file.artifactId === block.artifactId), contextId: CONTEXT, openFile, fileNativeClient: client}));
  const actions = vi.fn(({item}: {item: ConversationTimelineItemViewModel}) => h("button", {class: "answer-action", "data-item": item.itemId}, "复制回答"));
  return {openFile, client, reference, actions, slots: {"artifact-reference": reference,
    // ChatPage supplies answer controls only for readable assistant text.
    "item-actions": (scope: {item: ConversationTimelineItemViewModel}) => scope.item.kind === "assistant_message" ? actions(scope) : null}};
}

describe("turn output stays inside the response", () => {
  it.each([4, 9])("contains %i document cards before the response footer with their original authority", async count => {
    const input = timeline({count});
    const turn = input.timeline.turns[0]!;
    const original = JSON.stringify({turn, view: input.view});
    const callbacks = slotsFor(input.artifacts);
    const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}, slots: callbacks.slots});
    const response = wrapper.get(".chat-turn-output");
    const body = response.get(".chat-turn-output__body");
    const footer = response.get(".chat-turn-output__actions");
    expect(body.text()).toContain("已完成文档");
    expect(body.findAll(".chat-artifact-document-card")).toHaveLength(count);
    expect(body.element.nextElementSibling).toBe(footer.element);
    expect(wrapper.findAll(".answer-action")).toHaveLength(1);
    expect(wrapper.findAll(".chat-turn-group__item--artifact")).toHaveLength(0);
    expect(callbacks.actions.mock.calls.every(([scope]) => scope.item === turn.items[0])).toBe(true);
    expect(callbacks.reference.mock.calls.every(([scope]) => turn.items.includes(scope.item) && scope.item.contentBlocks.includes(scope.block))).toBe(true);
    const preview = body.findAll("button").find(button => button.attributes("aria-label")?.startsWith("预览 "))!;
    await preview.trigger("click");
    expect(callbacks.openFile).toHaveBeenCalledWith(input.artifacts[0]);
    await body.get('button[aria-label="另存为"]').trigger("click");
    await flushPromises();
    expect(callbacks.client.saveFile).toHaveBeenCalledWith(CONTEXT, {sessionId: SESSION, turnId: TURN, artifactId: input.artifacts[0]!.artifactId});
    expect(JSON.stringify({turn, view: input.view})).toBe(original);
  });

  it("keeps live cards mounted when text arrives and completes", async () => {
    const before = timeline({count: 1, text: "", live: true, artifactStatus: "announced"});
    let artifacts = before.artifacts;
    const callbacks = slotsFor(() => artifacts);
    const wrapper = mount(ChatTurnGroup, {props: {turn: before.timeline.turns[0]!, position: 1}, slots: callbacks.slots});
    const instance = wrapper.getComponent(ChatArtifactList).vm.$;
    const container = wrapper.get(".chat-turn-output__artifacts").element;
    expect(wrapper.find(".answer-action").exists()).toBe(false);
    const streaming = timeline({count: 1, live: true});
    artifacts = streaming.artifacts;
    await wrapper.setProps({turn: streaming.timeline.turns[0]!});
    expect(wrapper.getComponent(ChatArtifactList).vm.$).toBe(instance);
    expect(wrapper.get(".chat-turn-output__artifacts").element).toBe(container);
    expect(wrapper.findAll(".chat-artifact-document-card")).toHaveLength(1);
    expect(wrapper.find(".answer-action").exists()).toBe(false);
    await wrapper.setProps({turn: timeline({count: 1}).timeline.turns[0]!});
    expect(wrapper.getComponent(ChatArtifactList).vm.$).toBe(instance);
    expect(wrapper.get(".chat-turn-output__actions").text()).toBe("复制回答");
  });

  it("adds late artifacts once and reconstructs the same layout on history remount", async () => {
    const complete = timeline({count: 9});
    const callbacks = slotsFor(complete.artifacts);
    const turn = complete.timeline.turns[0]!;
    const wrapper = mount(ChatTurnGroup, {props: {turn: {...turn, items: turn.items.slice(0, 1)}, position: 1}, slots: callbacks.slots});
    expect(wrapper.findAll(".answer-action")).toHaveLength(1);
    await wrapper.setProps({turn});
    await wrapper.setProps({turn: {...turn, items: [...turn.items]}});
    expect(wrapper.findAll(".chat-artifact-document-card")).toHaveLength(9);
    expect(wrapper.findAll(".answer-action")).toHaveLength(1);
    wrapper.unmount();
    const restored = mount(ChatTurnGroup, {props: {turn: timeline({count: 9, source: "native_rebuilt"}).timeline.turns[0]!, position: 1}, slots: callbacks.slots});
    expect(restored.get(".chat-turn-output__body").findAll(".chat-artifact-document-card")).toHaveLength(9);
    expect(restored.get(".chat-turn-output__actions").text()).toBe("复制回答");
  });

  it.each([null, "commentary"] as const)("keeps unphased and trailing commentary text with its output (%s)", phase => {
    const input = timeline({phase});
    const wrapper = mount(ChatTurnGroup, {props: {turn: input.timeline.turns[0]!, position: 1}, slots: slotsFor(input.artifacts).slots});
    expect(wrapper.get(".chat-turn-output__body").text()).toContain("已完成文档");
    expect(wrapper.get(".chat-turn-output__body").findAll(".chat-artifact-document-card")).toHaveLength(4);
    expect(input.view.items[0]!.item.phase).toBe(phase ?? undefined);
    if (phase === "commentary") expect(wrapper.find(".answer-action").exists()).toBe(false);
  });

  it("does not attach files to a tool preamble or move them between turns", () => {
    const first = timeline({phase: null, text: "先检查文件。"});
    const turn = first.timeline.turns[0]!;
    const continuation = {...turn.items[0]!, identity: "tool", itemId: "tool", kind: "tool" as const, presentation: "tool" as const};
    const withTool = {...turn, items: [turn.items[0]!, continuation, ...turn.items.slice(1)]};
    const output = groupConversationTurnOutput(withTool, conversationActivityPresentation(withTool)).find(node => node.kind === "output");
    expect(output?.kind === "output" && output.answer).toBeNull();
    const second = timeline({turnId: "019c1a00-0000-7000-8000-000000000904", text: "第二轮结果。", count: 9});
    const wrapper = mount(ChatTimeline, {props: {timeline: {...first.timeline, turns: [...first.timeline.turns, ...second.timeline.turns]}}, slots: slotsFor([...first.artifacts, ...second.artifacts]).slots});
    expect(wrapper.findAll(".chat-turn-output").map(row => row.findAll(".chat-artifact-document-card").length)).toEqual([4, 9]);
    expect(wrapper.findAll(".chat-turn-output")[0]!.text()).not.toContain("第二轮结果");
  });

  it("retains partial delivery and failure states outside folded process details", async () => {
    const input = timeline();
    const artifacts = [input.artifacts[0]!, files(4, "failed")[1]!, files(4, "expired")[2]!, input.artifacts[3]!];
    const base = input.timeline.turns[0]!;
    const turn = {...base, domainStatus: "interrupted" as const, terminalStatus: "interrupted" as const,
      plan: {identity: "plan", explanation: null, collapsible: true as const, defaultExpanded: false, steps: []},
      items: base.items.map(item => item.kind === "assistant_message" ? {...item, domainStatus: "incomplete" as const, phase: "incomplete" as const} : item)};
    const wrapper = mount(ChatTurnGroup, {attachTo: document.body, props: {turn, position: 1}, slots: slotsFor(artifacts).slots});
    const output = wrapper.get(".chat-turn-output");
    expect(output.text()).toContain("未完整结束");
    expect(output.findAll(".chat-artifact-document-card")).toHaveLength(2);
    expect(output.get(".artifact-shell--failed").isVisible()).toBe(true);
    expect(output.get(".artifact-shell--expired").isVisible()).toBe(true);
    expect(output.find(".answer-action").exists()).toBe(false);
    const card = wrapper.getComponent(ChatArtifactList).vm.$;
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    expect(wrapper.getComponent(ChatArtifactList).vm.$).toBe(card);
    expect(output.isVisible()).toBe(true);
  });

  it("uses the last answer without rewriting earlier messages or hiding structured output", () => {
    const input = timeline();
    const base = input.timeline.turns[0]!;
    const first = base.items[0]!;
    const last = {...first, identity: "last-answer", itemId: "last-answer"};
    const turn = {...base, items: [first, last, ...base.items.slice(1)]};
    const nodes = groupConversationTurnOutput(turn, conversationActivityPresentation(turn));
    expect(nodes[0]?.kind !== "activity" && nodes[0]?.kind !== "output" && nodes[0]?.item).toBe(first);
    const output = nodes.find(node => node.kind === "output");
    expect(output?.kind === "output" && output.answer?.item).toBe(last);
    const callbacks = slotsFor(input.artifacts);
    const wrapper = mount(ChatTurnGroup, {props: {turn: base, position: 1}, slots: {...callbacks.slots,
      "structured-answer": () => h("p", "已校验的结构化结果")}});
    expect(wrapper.get(".chat-turn-output").text()).toContain("已校验的结构化结果");
    expect(wrapper.get(".chat-turn-output").findAll(".chat-artifact-document-card")).toHaveLength(4);
    expect(wrapper.find(".answer-action").exists()).toBe(false);
  });
});
