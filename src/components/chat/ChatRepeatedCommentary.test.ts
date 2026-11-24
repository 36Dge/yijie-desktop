// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { NativeConversationView } from "../../api/generated/native-conversation-private.gen";
import { traceItem, traceTurn } from "../../domain/conversation-activity-fixtures";
import { composeConversationView } from "../../domain/conversation-view";
import { selectConversationTimeline } from "../../domain/conversation-timeline";
import ChatTurnGroup from "./ChatTurnGroup.vue";

const note = "杭州明天最低气温为 4℃。";
const message = (id: string, text: string, phase: "commentary" | "final_answer" = "commentary") =>
  traceItem(id, "agentMessage", {text, phase});

it("folds complete equivalent progress across tools, preserves new details and an identical final", async () => {
  const turn = traceTurn([message("a", note), traceItem("search", "webSearch"), message("b", note),
    message("c", note + "后天有雨。"), message("answer", note, "final_answer")]);
  const wrapper = mount(ChatTurnGroup, {props: {turn, position: 1}});
  expect(wrapper.findAll(".chat-turn-group__item--commentary")).toHaveLength(2);
  expect(wrapper.get(".chat-turn-group__occurrences summary").text()).toContain("2 条");
  expect(wrapper.findAll(".chat-turn-group__item--final_answer")).toHaveLength(1);
  wrapper.unmount();
});

it("holds a matching streaming prefix and displays the whole message on its first difference", async () => {
  const turn = traceTurn([message("a", note), message("b", "杭州明天最低")], true);
  const prefix = {...turn, items: turn.items.map((item, index) => index === 1 ? {...item, phase: "active" as const, domainStatus: "streaming" as const} : item)};
  const wrapper = mount(ChatTurnGroup, {props: {turn: prefix, position: 1}});
  expect(wrapper.findAll(".chat-turn-group__item--commentary")).toHaveLength(1);
  const next = traceTurn([message("a", note), message("b", "杭州明天最高气温为 14℃。")], true);
  await wrapper.setProps({turn: next});
  expect(wrapper.findAll(".chat-turn-group__item--commentary")).toHaveLength(2);
  expect(wrapper.text()).toContain("杭州明天最高气温为 14℃。");
  wrapper.unmount();
});

const directory = process.env.HANGZHOU_RENDER_DIRECTORY;
it.skipIf(!directory)("renders the recorded Hangzhou progress once on mount and history reopen", async () => {
  const file = process.env.HANGZHOU_RENDER_FILE ?? "original-view.json";
  const view = JSON.parse(readFileSync(join(directory!, file),"utf8")) as NativeConversationView;
  const source = JSON.parse(readFileSync(join(directory!, "source.json"), "utf8")) as {commentary: string};
  const evidence = [];
  for (let read = 0; read < 2; read++) {
    const state = composeConversationView({threads: [{threadId: view.sessionId, status: "ready"}], turns: [], items: []}, [view]);
    const turn = selectConversationTimeline(state, view.sessionId, undefined, {protectApprovalProcessContent:false,liveTurnId:null})!.turns[0]!;
    const wrapper = mount(ChatTurnGroup, {props:{turn,position:1}});
    const toggle = wrapper.find(".chat-turn-group__process-toggle");
    if (toggle.exists() && toggle.attributes("aria-expanded")==="false") await toggle.trigger("click");
    const progress = wrapper.findAll(".chat-turn-group__item--commentary").filter(row=>row.text().includes(source.commentary));
    expect(progress).toHaveLength(1);
    expect(progress[0]!.isVisible()).toBe(true);
    const finals = wrapper.findAll(".chat-turn-group__item--final_answer");
    if(view.status==="completed"){
      expect(finals).toHaveLength(1);
      expect(finals[0]!.isVisible()).toBe(true);
      for(const day of ["23","24","25","26","27","28","29"]) expect(finals[0]!.text()).toContain(day);
    }
    evidence.push({visibleRepeatedText:progress.length,visibleFinals:finals.length,terminal:view.status});
    wrapper.unmount();
  }
  writeFileSync(join(directory!,file+".render.json"),JSON.stringify(evidence,null,2));
});
