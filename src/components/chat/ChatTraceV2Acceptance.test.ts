// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import type { NativeConversationView, NativeItem } from "../../api/generated/native-conversation-private.gen";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import { conversationActivityPresentation, traceCurrentStatus } from "../../domain/conversation-activity-presentation";
import { summarizeActivity } from "../../domain/conversation-activity-summary";
import { traceItem } from "../../domain/conversation-activity-fixtures";
import ChatTurnGroup from "./ChatTurnGroup.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());
const command = (id: string, status: "inProgress" | "completed" = "completed", label = "python3 --version") => traceItem(id, "commandExecution", {status, commandLabel: label, ...(status === "completed" ? {exitCode: 0} : {})});
const message = (id: string, phase?: "commentary" | "final_answer") => traceItem(id, "agentMessage", {text: `${id} public text`, ...(phase ? {phase} : {})});
const search = (id: string) => traceItem(id, "webSearch", {webSearch: {action: "search", queries: ["ordinary public query"], sources: []}});
function view(items: NativeItem[], live = false, extra: Partial<NativeConversationView> = {}): NativeConversationView {
  return {sessionId: "session", turnId: "turn", runtimeThreadId: "runtime", runtimeTurnId: "runtime-turn", source: "native_observed", revision: "1", availability: "available", status: live ? "inProgress" : "completed", statusSource: "runtime_notification", terminalObserved: !live,
    items: items.map((item, ordinal) => ({item, ordinal, lastMethod: item.status === "inProgress" || live && item.type === "reasoning" ? "item/started" : "item/completed"})), ...extra};
}
function turn(input: NativeConversationView, live = false) {
  return selectConversationTimeline(composeConversationView({threads: [{threadId: "session", status: "ready"}], turns: [], items: []}, [input]), "session", undefined, {protectApprovalProcessContent: false, liveTurnId: live ? "turn" : null})!.turns[0]!;
}
function groups(input: NativeConversationView, live = false) {
  return conversationActivityPresentation(turn(input, live)).filter(node => node.kind === "activity").map(node => node.group);
}
function render(input: NativeConversationView, live = false) {
  return mount(ChatTurnGroup, {attachTo: document.body, props: {turn: turn(input, live), position: 1, timingLabel: "已用时 12 秒"}});
}

describe("v2 normal reading acceptance", () => {
  it("A01 / A02 separates public stages and renders tools without reasoning rows", async () => {
    const records = Array.from({length: 32}, (_, i) => [search(`s${i}`), traceItem(`r${i}`, "reasoning", {summary: ["Ordinary process context"]}), ...(i % 4 === 0 ? [command(`c${i}`)] : [])]).flat();
    const saved = view(records), original = JSON.stringify(saved);
    const wrapper = render(saved);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    expect(wrapper.findAll("[data-activity-item]")).toHaveLength(40);
    expect(wrapper.findAll(".chat-turn-group__reasoning-summary")).toHaveLength(1);
    expect(wrapper.find(".chat-activity-group .chat-deep-thinking").exists()).toBe(false);
    await wrapper.get('.chat-turn-group__reasoning-summary button').trigger('click');
    expect(wrapper.findAll('[data-reasoning-item]')).toHaveLength(32);
    expect(wrapper.get(".chat-activity-group__counts").text()).toBe("40 次调用");
    expect(JSON.stringify(saved)).toBe(original);
    expect(saved.items).toHaveLength(72);
    expect(groups(view([message("first", "commentary"), ...records, message("second", "commentary"), command("last")]))).toHaveLength(2);
  });

  it("A03 keeps separate native IDs for equal queries and command previews", () => {
    const group = groups(view([search("s1"), search("s2"), command("c1"), command("c2")]))[0]!;
    expect(group.entries.map(entry => entry.item.itemId)).toEqual(["s1", "s2", "c1", "c2"]);
    expect(new Set(group.entries.map(entry => entry.identity)).size).toBe(4);
  });

  it("A05 retains hidden commentary boundaries in optional latest presentation", () => {
    const input = turn(view([message("old", "commentary"), search("s1"), message("new", "commentary"), search("s2"), message("answer", "final_answer")]));
    const nodes = conversationActivityPresentation(input, new Set(), false, "latest");
    expect(nodes.filter(node => node.kind === "activity")).toHaveLength(2);
    expect(nodes.some(node => node.kind === "message" && node.item.itemId === "old")).toBe(false);
    expect(nodes.some(node => node.kind === "message" && node.item.itemId === "new")).toBe(true);
  });

  it("A06 keeps the last unknown-phase answer visible with trailing reasoning or tools", async () => {
    for (const trailing of [traceItem("reason", "reasoning", {summary: ["Ordinary context"]}), command("tail", "inProgress")]) {
      const input = view([message("answer"), trailing], true), wrapper = render(input, true);
      const toggle = wrapper.find(".chat-turn-group__process-toggle");
      if (toggle.exists()) await toggle.trigger("click");
      expect(wrapper.get(".chat-turn-group__item--assistant_unclassified").isVisible()).toBe(true);
      expect(input.items[0]!.item.phase).toBeUndefined();
      wrapper.unmount();
    }
  });

  it("A07 retains an explicit answer after ended trailing command/search/reasoning", () => {
    const input = view([message("answer", "final_answer"), command("tail"), search("web"), traceItem("r", "reasoning", {summary: ["Ordinary context"]})]);
    const wrapper = render(input);
    expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
    expect(wrapper.get(".chat-turn-group__item--final_answer").text()).toContain("answer public text");
  });

  it.each([false, true])("A06 keeps a tail commentary readable as a layout candidate without changing phase (live=%s)", async live => {
    const input = view([command("c"), message("tail", "commentary")], live);
    const original = JSON.stringify(input), wrapper = render(input, live);
    const toggle = wrapper.find(".chat-turn-group__process-toggle");
    if (toggle.exists() && toggle.attributes("aria-expanded") === "true") await toggle.trigger("click");
    const body = wrapper.get(".chat-turn-group__item--commentary");
    expect(body.isVisible()).toBe(true);
    expect(body.get(".chat-safe-content").isVisible()).toBe(true);
    expect(body.text()).toContain("tail public text");
    expect(body.find(".chat-timeline-item-shell__disclosure").exists()).toBe(false);
    expect(input.items[1]!.item.phase).toBe("commentary");
    expect(JSON.stringify(input)).toBe(original);
  });

  it("A08 selects only the latest open group while preserving concurrent facts", () => {
    const input = view([command("early", "inProgress"), message("stage", "commentary"), command("late", "inProgress")], true);
    const [first, last] = groups(input, true);
    expect(first!.state.kind).toBe("summary");
    expect(first!.entries[0]!.item.busy).toBe(true);
    expect(last!.state.kind).toBe("active");
    expect(summarizeActivity(last!, true).key).toContain("late");
  });

  it("A09 / A25 exposes the native summary in one current thinking disclosure without tool rows", async () => {
    const wrapper = render(view([command("done"), traceItem("r", "reasoning", {summary: ["Ordinary context"]})], true), true);
    expect(wrapper.get(".chat-turn-group__reasoning-summary button").text()).toBe("正在思考 · Ordinary context");
    expect(wrapper.find(".chat-turn-group__progress").exists()).toBe(false);
    expect(wrapper.findAll("[data-activity-item]")).toHaveLength(1);
    const only = render(view([traceItem("r", "reasoning", {summary: ["Ordinary context"]})], true), true);
    expect(only.find(".chat-activity-group").exists()).toBe(false);
    expect(only.get('.chat-deep-thinking__toggle').text()).toBe("正在思考 · Ordinary context");
    await only.get('.chat-deep-thinking__toggle').trigger('click');
    expect(only.get('[aria-label="思考摘要内容"]').isVisible()).toBe(true);
    expect(only.get('[aria-label="思考摘要内容"]').text()).toContain("Ordinary context");
  });

  it("A10 stabilizes header identity changes, updates same-key text, and completes immediately", async () => {
    vi.useFakeTimers({now: 0});
    const wrapper = render(view([command("a", "inProgress", "python3 --version")], true), true);
    await wrapper.setProps({turn: turn(view([command("a", "inProgress", "python3 --help")], true), true)});
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("正在运行 python3 --help");
    await wrapper.setProps({turn: turn(view([command("a"), command("b", "inProgress", "tail -n 5 README.md")], true), true)});
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("正在运行 python3 --help");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("正在运行 tail -n 5 README.md");
    await wrapper.setProps({turn: turn(view([command("a"), command("b")] ))});
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("运行了命令");
  });

  it("A11 keeps the same group DOM and opened choice when empty reasoning ends", async () => {
    const input = view([traceItem("r", "reasoning", {summary: [], content: []}), command("c", "inProgress")], true);
    const wrapper = render(input, true), button = wrapper.get(".chat-activity-group__toggle");
    await button.trigger("click");
    const element = button.element;
    const updated: NativeConversationView = {...input, revision: "2", items: input.items.map((entry, i) => i === 0 ? {...entry, lastMethod: "item/completed"} : entry)};
    await wrapper.setProps({turn: turn(updated, true)});
    expect(wrapper.get(".chat-activity-group__toggle").element).toBe(element);
    expect(wrapper.get(".chat-activity-group__toggle").attributes("aria-expanded")).toBe("true");
  });

  it("A12 defaults to folded process on explicit final text without hiding the answer", async () => {
    const wrapper = render(view([message("stage", "commentary"), command("c")], true), true);
    expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("true");
    await wrapper.setProps({turn: turn(view([message("stage", "commentary"), command("c"), message("answer", "final_answer")], true), true)});
    expect(wrapper.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get(".chat-turn-group__item--final_answer").isVisible()).toBe(true);
  });

  it("A13 scopes explicit reading choices to the mounted conversation", async () => {
    const input = view([command("a"), command("b")]);
    const wrapper = render(input);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    wrapper.unmount();
    const reopened = render(input);
    expect(reopened.get(".chat-turn-group__process-toggle").attributes("aria-expanded")).toBe("false");
    expect(reopened.get(".chat-activity-group__toggle").attributes("aria-expanded")).toBe("false");
  });

  it("A14 / A23 preserves interrupted work and pending plan steps", () => {
    const input = view([command("c", "inProgress")], false, {status: "interrupted", plan: [{step: "Read public sources", status: "inProgress"}, {step: "Write answer", status: "pending"}]});
    const before = JSON.stringify(input), wrapper = render(input);
    expect(wrapper.text()).toContain("已中断");
    expect(wrapper.get(".chat-turn-group__item--command").isVisible()).toBe(true);
    expect(input.plan?.map(step => step.status)).toEqual(["inProgress", "pending"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("A17 shows current native retry intent once and folds consecutive equivalent notices", () => {
    const notices = [1, 2].map(i => ({eventId: `event-${i}`, sequence: `${i}`, method: "error" as const, code: "transport_error", scope: "turn" as const, willRetry: true}));
    const input = view([command("c")], true, {notices, cursor: {eventId: "event-2", streamId: "stream", sequence: "2"}});
    const wrapper = render(input, true);
    expect(wrapper.get(".chat-activity-group__title").text()).toBe("运行时正在重试");
    expect(wrapper.findAll(".chat-trace-notices details")).toHaveLength(1);
    expect(traceCurrentStatus(turn(input, true))).toBeNull();
    expect(input.notices).toHaveLength(2);
  });

  it("A15 distinguishes failed, missing-exit and empty successful command results", async () => {
    const noExit = traceItem("no-exit", "commandExecution", {status: "completed"});
    const input = view([command("empty"), noExit, traceItem("failed", "commandExecution", {status: "failed", exitCode: 2})]);
    const wrapper = render(input);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    const rows = wrapper.findAll("[data-activity-item]");
    await rows[0]!.get("button").trigger("click");
    await rows[1]!.get("button").trigger("click");
    expect(rows[0]!.text()).toContain("无可显示输出");
    expect(rows[1]!.text()).toContain("退出码未提供，执行结果未确认");
    expect(wrapper.text()).toContain("执行失败");
  });

  it("A19 never animates a saved inProgress record without a live observation", () => {
    const input = view([command("c", "inProgress")], true), wrapper = render(input, false);
    expect(wrapper.find(".chat-thinking--active").exists()).toBe(false);
    expect(wrapper.text()).toContain("当前进度待确认");
  });

  it("A22 uses safe previews/titles and honest web/unknown fallbacks", () => {
    const input = view([command("cmd"), traceItem("tool", "mcpToolCall", {toolLabel: "登记聊天产物"}), traceItem("web", "webSearch", {webSearch: {action: "other", queries: []}})]);
    const group = groups(input)[0]!;
    expect(group.entries.map(entry => entry.title)).toEqual(["运行 python3 --version", "登记聊天产物", "网页活动"]);
    expect(summarizeActivity(group, false).title).not.toContain("搜索");
  });

  it("A24 renders two actions as two rows of one call and disclosure performs no execution", async () => {
    const native = command("one"); native.commandActions = [{index: 0, kind: "read", label: "README.md"}, {index: 1, kind: "read", label: "package.json"}];
    const input = view([native]), original = JSON.stringify(input), wrapper = render(input);
    await wrapper.get(".chat-turn-group__process-toggle").trigger("click");
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    const rows = wrapper.findAll("[data-activity-item]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attributes("data-native-item")).toBe(rows[1]!.attributes("data-native-item"));
    expect(wrapper.get(".chat-activity-group__counts").text()).toContain("1 次调用 · 2 个命令动作");
    expect(rows[0]!.get("button").text()).toContain("README.md");
    expect(rows[1]!.get("button").text()).toContain("package.json");
    await rows[1]!.get("button").trigger("click");
    expect(wrapper.emitted("approval-decision")).toBeUndefined();
    expect(JSON.stringify(input)).toBe(original);
  });

  it("A26 keeps native failures visible outside a folded ordinary group", () => {
    const wrapper = render(view([command("ok"), traceItem("bad", "commandExecution", {status: "failed", exitCode: 1}), message("answer", "final_answer")]));
    expect(wrapper.findAll(".chat-turn-group__item--command").some(row => row.isVisible() && row.text().includes("执行失败"))).toBe(true);
  });

  it("uses one disclosure for an ended singleton and retains an explicit live-group choice", async () => {
    const cold = render(view([command("single")]));
    await cold.get(".chat-turn-group__process-toggle").trigger("click");
    expect(cold.find(".chat-activity-group__toggle").exists()).toBe(false);
    expect(cold.findAll("[data-activity-item]")).toHaveLength(1);
    expect(cold.get("[data-activity-item] button").text()).toContain("python3 --version");
    const live = render(view([command("single", "inProgress")], true), true);
    await live.get(".chat-activity-group__toggle").trigger("click");
    await live.setProps({turn: turn(view([command("single")]))});
    expect(live.get(".chat-activity-group__toggle").attributes("aria-expanded")).toBe("true");
  });

  it("A11 retains a single command row when its native action metadata arrives", async () => {
    const native = command("one", "inProgress");
    const wrapper = render(view([native], true), true);
    await wrapper.get(".chat-activity-group__toggle").trigger("click");
    const row = wrapper.get("[data-activity-item]");
    await row.get("button").trigger("click");
    const identity = row.attributes("data-activity-item");
    const completed = {...command("one"), commandActions: [{index: 0, kind: "unknown" as const, label: "python3 --version"}]};
    await wrapper.setProps({turn: turn(view([completed]))});
    expect(wrapper.get("[data-activity-item]").element).toBe(row.element);
    expect(wrapper.get("[data-activity-item]").attributes("data-activity-item")).toBe(identity);
    expect(wrapper.get("[data-activity-item] button").attributes("aria-expanded")).toBe("true");
  });
});
