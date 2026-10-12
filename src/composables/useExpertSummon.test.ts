import { createPinia, setActivePinia } from "pinia";
import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpertNativeClient, expertNativeClient } from "../api/expert-native-client";
import { useExpertsStore } from "../stores/experts.store";
import { useChatExpertsStore } from "../stores/chat-experts.store";
import { useChatComposerDraftStore } from "../stores/chat-composer-drafts.store";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId as id } from "../test/expert-fixture";
import { useExpertSummon } from "./useExpertSummon";

const mocks = vi.hoisted(() => ({ push: vi.fn(), info: vi.fn(), route: { query: {} as Record<string, string> } }));
vi.mock("vue-router", () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push }) }));
vi.mock("naive-ui", () => ({ useDialog: () => ({ info: mocks.info }) }));
beforeEach(() => {
  setActivePinia(createPinia()); mocks.route = reactive({ query: {} }); mocks.push.mockReset(); mocks.info.mockReset(); mocks.info.mockReturnValue({ destroy: vi.fn() });
  const resources = useExpertsStore(); resources.scope = "scope-one"; resources.contextId = id(1);
  resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  useChatExpertsStore().bind(id(1), "scope-one");
});
describe("expert summon navigation and prefill", () => {
  it.each(["new", "existing"] as const)("prepares an available display and summons %s through the real generated validators", async (target) => {
    const selection = { expertId: expertDisplay.expertId, version: expertDisplay.version };
    const resources = useExpertsStore();
    resources.snapshot = { ...expertSnapshot(), executionAvailable: true };
    if (target === "existing") {
      mocks.route.query.from = `/chat/${id(2)}`;
      useChatExpertsStore().bindings = { [id(2)]: { sessionId: id(2), managed: false, bindingRevision: 0, expert: null, state: "none" } };
    }
    const transport = vi.fn(async (command, { request }) => {
      let data;
      if (command === "experts_snapshot_v1") data = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
      else {
        expect(request.payload.expert).toEqual(selection);
        if (command === "experts_prepare_v1") data = { ...request.payload, action: "prepare", state: "succeeded" };
        else {
          expect(command).toBe("chat_expert_binding_set_v1");
          data = {
            binding: { sessionId: request.payload.sessionId, managed: true, bindingRevision: 1, expert: expertDisplay, state: "ready" },
            operation: { operationId: request.payload.operationId, sessionId: request.payload.sessionId, expectedBindingRevision: 0, bindingRevision: 1, requestedExpert: expertDisplay, state: "succeeded" },
          };
        }
      }
      return { schemaVersion: 1, requestId: request.requestId, data };
    });
    const real = createExpertNativeClient(transport);
    const prepare = vi.spyOn(expertNativeClient, "prepare").mockImplementation(real.prepare);
    const snapshot = vi.spyOn(expertNativeClient, "snapshot").mockImplementation(real.snapshot);
    const binding = vi.spyOn(expertNativeClient, "setBinding").mockImplementation(real.setBinding);
    const submit = vi.spyOn(expertNativeClient, "submit");
    try {
      await useExpertSummon().summon(expertEntry, "整理准备清单");
      expect(transport.mock.calls.map(call => call[0])).toEqual(target === "new" ? ["experts_prepare_v1", "experts_snapshot_v1"] : ["experts_prepare_v1", "experts_snapshot_v1", "chat_expert_binding_set_v1"]);
      expect(mocks.push).toHaveBeenCalledWith({ path: target === "new" ? "/chat" : `/chat/${id(2)}`, query: { focus: "composer" } });
      expect(submit).not.toHaveBeenCalled();
      if (target === "new") expect(useChatComposerDraftStore().expert("new")).toEqual(expertDisplay);
      else expect(useChatExpertsStore().bindings[id(2)]?.expert).toEqual(expertDisplay);
    } finally { prepare.mockRestore(); snapshot.mockRestore(); binding.mockRestore(); submit.mockRestore(); }
  });
  it("sidebar summon selects the new draft and preserves its text, model and workspace", async () => {
    const drafts = useChatComposerDraftStore(); drafts.texts = { new: "原草稿" } as typeof drafts.texts; drafts.newProfile = "minimax-m3-high-v1"; drafts.workspaceId = id(7);
    const submit = vi.spyOn(expertNativeClient, "submit"), binding = vi.spyOn(expertNativeClient, "setBinding");
    try {
      await useExpertSummon().summon({ ...expertEntry, state: "ready" });
      expect(drafts.expert("new")).toEqual(expertDisplay); expect(drafts.texts.new).toBe("原草稿");
      expect(drafts.newProfile).toBe("minimax-m3-high-v1"); expect(drafts.workspaceId).toBe(id(7));
      expect(mocks.push).toHaveBeenCalledWith({ path: "/chat", query: { focus: "composer" } });
      expect(submit).not.toHaveBeenCalled(); expect(binding).not.toHaveBeenCalled();
    } finally { submit.mockRestore(); binding.mockRestore(); }
  });
  it("each quick question only prefills an empty draft and never submits", async () => {
    const submit = vi.spyOn(expertNativeClient, "submit");
    try {
      for (const text of ["整理上架清单", "先了解投放条件", "列出待核实规则"]) {
        const drafts = useChatComposerDraftStore(); drafts.clearTarget("new");
        await useExpertSummon().summon({ ...expertEntry, state: "ready" }, text);
        expect(drafts.texts.new).toBe(text); expect(drafts.expert("new")).toEqual(expertDisplay);
      }
      expect(submit).not.toHaveBeenCalled();
    } finally { submit.mockRestore(); }
  });
  it("offers keeping an existing draft as the default question action", async () => {
    const drafts = useChatComposerDraftStore(); drafts.texts = { new: "保留这段" } as typeof drafts.texts;
    const flow = useExpertSummon(); await flow.summon({ ...expertEntry, state: "ready" }, "参考问题");
    expect(drafts.texts.new).toBe("保留这段"); expect(mocks.push).not.toHaveBeenCalled();
    const options = mocks.info.mock.calls[0]![0]; expect(options.positiveText).toBe("保留当前草稿");
    await options.onPositiveClick(); expect(drafts.texts.new).toBe("保留这段"); expect(drafts.expert("new")).toEqual(expertDisplay);
  });
  it("plus entry returns to the original session only after its Native binding succeeds", async () => {
    mocks.route.query.from = `/chat/${id(2)}`;
    const bindings = useChatExpertsStore(); bindings.bindings = { [id(2)]: { sessionId: id(2), managed: false, bindingRevision: 0, expert: null, state: "none" } };
    const select = vi.spyOn(bindings, "select").mockResolvedValue(true);
    try {
      await useExpertSummon().summon({ ...expertEntry, state: "ready" });
      expect(select).toHaveBeenCalledWith(id(2), expertDisplay);
      expect(mocks.push).toHaveBeenCalledWith({ path: `/chat/${id(2)}`, query: { focus: "composer" } });
      expect(useChatComposerDraftStore().expert("new")).toBeNull();
    } finally { select.mockRestore(); }
  });
  it("a pending Native binding prevents another selection or navigation", async () => {
    mocks.route.query.from = `/chat/${id(2)}`;
    const bindings = useChatExpertsStore(); bindings.bindings = { [id(2)]: { sessionId: id(2), managed: true, bindingRevision: 1, expert: expertDisplay, state: "applying", operationId: id(8) } };
    const select = vi.spyOn(bindings, "select");
    try { await useExpertSummon().summon({ ...expertEntry, state: "ready" }); expect(select).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled(); }
    finally { select.mockRestore(); }
  });
  it.each(["navigate", "dispose"] as const)("does not prefill or navigate after a successful binding when the caller did %s", async (change) => {
    mocks.route.query.from = `/chat/${id(2)}`;
    const bindings = useChatExpertsStore();
    bindings.bindings = { [id(2)]: { sessionId: id(2), managed: false, bindingRevision: 0, expert: null, state: "none" } };
    let resolve!: (value: boolean) => void;
    const select = vi.spyOn(bindings, "select").mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const scope = effectScope();
    const flow = scope.run(() => useExpertSummon())!;
    try {
      const pending = flow.summon({ ...expertEntry, state: "ready" }, "参考问题");
      expect(select).toHaveBeenCalledOnce();
      if (change === "navigate") mocks.route.query.from = `/chat/${id(3)}`;
      else scope.stop();
      resolve(true); await pending;
      expect(mocks.push).not.toHaveBeenCalled();
      expect(useChatComposerDraftStore().texts).toEqual({});
      expect(select).toHaveBeenCalledOnce();
    } finally { scope.stop(); select.mockRestore(); }
  });
  it.each(["draft", "replacement"] as const)("invalidates the original %s confirmation before any action after destination or authority changes", async (kind) => {
    for (const change of ["navigate", "context", "scope", "dispose"] as const) {
      mocks.route.query.from = `/chat/${id(2)}`;
      const resources = useExpertsStore(), bindings = useChatExpertsStore(), drafts = useChatComposerDraftStore();
      resources.scope = "scope-one"; resources.contextId = id(1);
      resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
      bindings.bind(id(1), "scope-one");
      const oldExpert = kind === "replacement" ? { ...expertDisplay, expertId: "another-expert" } : null;
      bindings.bindings = {
        [id(2)]: { sessionId: id(2), managed: false, bindingRevision: 0, expert: oldExpert, state: oldExpert ? "ready" : "none" },
        [id(3)]: { sessionId: id(3), managed: false, bindingRevision: 0, expert: null, state: "none" },
      };
      drafts.texts = { [`session:${id(2)}`]: "原会话草稿", [`session:${id(3)}`]: "另一个会话草稿" } as typeof drafts.texts;
      const originalTexts = drafts.texts;
      const destroy = vi.fn(); mocks.info.mockReturnValueOnce({ destroy });
      const prepare = vi.spyOn(resources, "execute").mockResolvedValue(true);
      const select = vi.spyOn(bindings, "select").mockResolvedValue(true);
      const scope = effectScope(), flow = scope.run(() => useExpertSummon())!;
      mocks.push.mockClear();
      try {
        await flow.summon(expertEntry, kind === "draft" ? "原会话参考问题" : undefined);
        const options = mocks.info.mock.calls[mocks.info.mock.calls.length - 1]![0];
        const confirm = kind === "draft" ? options.onNegativeClick : options.onPositiveClick;
        if (change === "navigate") mocks.route.query.from = `/chat/${id(3)}`;
        else if (change === "context") resources.contextId = id(4);
        else if (change === "scope") resources.scope = "scope-two";
        else scope.stop();
        expect(destroy).toHaveBeenCalledOnce();
        await confirm();
        expect(prepare).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
        expect(drafts.texts).toEqual(originalTexts); expect(mocks.push).not.toHaveBeenCalled();
      } finally { scope.stop(); prepare.mockRestore(); select.mockRestore(); }
    }
  });
});
