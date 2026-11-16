// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketChatError, type MarketHostNativeClient } from "../api/market-host-native-client";
import { marketDecisionFact, marketObservation, marketTestId as id } from "../test/market-chat-fixture";
import { useMarketChat } from "./useMarketChat";
const wrappers: ReturnType<typeof mount>[] = [];
function setup(client: MarketHostNativeClient, events = false, active = false) {
  const context = ref<string | null>(id(20)), session = ref<string | null>(id(21));
  const running = ref(active), nativeRevision = ref("initial");
  let flow!: ReturnType<typeof useMarketChat>;
  wrappers.push(mount(defineComponent({ setup() { flow = useMarketChat(() => context.value, () => session.value, () => running.value, client, events ? () => nativeRevision.value : undefined); return () => null; } })));
  return { flow, context, session, running, nativeRevision };
}
function client(): MarketHostNativeClient { return { observe: vi.fn(async () => marketObservation()), decide: vi.fn(), submit: vi.fn() }; }
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); });
describe("market approval observation", () => {
  it("drains an invalidation queued after the read settles but before its cleanup", async () => {
    const api = client(); let resolve!: (value: ReturnType<typeof marketObservation>) => void;
    const response = new Promise<ReturnType<typeof marketObservation>>(r => { resolve = r; });
    vi.mocked(api.observe).mockReturnValueOnce(response);
    const latest = marketObservation(); latest.approvals!.requests = []; latest.tools!.items[0]!.state = "completed";
    vi.mocked(api.observe).mockResolvedValue(latest);
    const { flow } = setup(api, true);
    const notification = response.then(() => flow.refresh("events"));
    const idle = marketObservation(); idle.approvals!.requests = [];
    resolve(idle); await notification; await flushPromises();
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(flow.tools.value[0]?.state).toBe("completed");
  });
  it("retains local evidence while a remote issue disables live decisions", async () => {
    const api = client(), observation = marketObservation();
    observation.approvals = undefined; observation.tools = undefined;
    observation.decisionFacts = [marketDecisionFact("acknowledged")]; observation.remoteIssue = "not_ready";
    vi.mocked(api.observe).mockResolvedValue(observation);
    const { flow } = setup(api, true); await flushPromises();
    expect(flow.observation.value?.decisionFacts).toEqual(observation.decisionFacts);
    expect(flow.connected.value).toBe(false); expect(flow.ready.value).toBe(false);
    await flow.decide(id(2), "approve_once"); expect(api.decide).not.toHaveBeenCalled();
  });
  it("does not resend an unresolved persisted decision after reload or block a different call", async () => {
    const api = client(), observation = marketObservation();
    observation.decisionFacts = [marketDecisionFact("unconfirmed")];
    vi.mocked(api.observe).mockResolvedValue(observation);
    const { flow } = setup(api, true); await flushPromises();
    expect(flow.actionable(flow.approvals.value[0]!)).toBe(false);
    await flow.decide(id(2), "approve_once"); expect(api.decide).not.toHaveBeenCalled();
    const next = structuredClone(observation);
    next.approvals!.requests[0]!.approvalId = id(42); next.approvals!.requests[0]!.identity.callRef = id(43);
    vi.mocked(api.observe).mockResolvedValue(next); await flow.refresh("none");
    expect(flow.actionable(flow.approvals.value[0]!)).toBe(true);
    expect(api.decide).not.toHaveBeenCalled();
  });
  it("keeps a managed conversation blocked when its Host read becomes unavailable", async () => {
    const api = client(), { flow } = setup(api); await flushPromises();
    expect(flow.managed.value).toBe(true);
    vi.mocked(api.observe).mockRejectedValueOnce(new MarketChatError("not_ready"));
    await flow.refresh();
    expect(flow.managed.value).toBe(true); expect(flow.ready.value).toBe(false);
    expect(flow.actionable(flow.approvals.value[0]!)).toBe(false);
  });
  it("reconciles an unknown decision without sending it again after context renewal", async () => {
    const api = client(), { flow, context } = setup(api); await flushPromises();
    vi.mocked(api.decide).mockRejectedValueOnce(new MarketChatError("operation_uncertain", true));
    await flow.decide(id(2), "approve_once");
    context.value = id(30); await flushPromises();
    await flow.decide(id(2), "approve_once");
    expect(api.decide).toHaveBeenCalledTimes(1); expect(flow.uncertain.value.has(id(2))).toBe(true);
  });
  it("rejects late observations after navigating to another session", async () => {
    const api = client(); let resolve!: (value: ReturnType<typeof marketObservation>) => void;
    vi.mocked(api.observe).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { flow, session } = setup(api);
    vi.mocked(api.observe).mockResolvedValueOnce({ managed: false, selectionDisplay: [] });
    session.value = id(22); await flushPromises();
    resolve(marketObservation()); await flushPromises();
    expect(flow.managed.value).toBe(false); expect(flow.approvals.value).toEqual([]);
  });
  it("keeps the actual tool Item separate from approval acceptance", async () => {
    const api = client(), { flow } = setup(api); await flushPromises();
    vi.mocked(api.decide).mockImplementation(async (_ctx, payload) => ({ ...marketObservation().approvals!.requests[0]!, state: "approved", revision: 2, decisionId: payload.decisionId, decision: payload.decision }));
    const next = marketObservation(); next.approvals!.requests[0]!.state = "approved";
    vi.mocked(api.observe).mockResolvedValue(next);
    await flow.decide(id(2), "approve_once");
    expect(flow.tools.value[0]?.state).toBe("in_progress");
    expect(flow.tools.value[0]?.callRef).toBeUndefined();
  });
  it("retains an unconfirmed decision when visiting another conversation and returning", async () => {
    const api = client(), { flow, session } = setup(api); await flushPromises();
    vi.mocked(api.decide).mockRejectedValueOnce(new MarketChatError("operation_uncertain", true));
    await flow.decide(id(2), "approve_once");
    session.value = id(22); await flushPromises();
    expect(flow.uncertain.value.size).toBe(0);
    session.value = id(21); await flushPromises();
    await flow.decide(id(2), "reject");
    expect(api.decide).toHaveBeenCalledTimes(1);
    expect(flow.uncertain.value.has(id(2))).toBe(true);
    vi.mocked(api.observe).mockResolvedValueOnce({ managed: true, selectionDisplay: [] });
    await flow.refresh();
    expect(flow.uncertain.value.has(id(2))).toBe(true);
  });
  it("reads only a known original turn and keeps historical approvals out of the current decision list", async () => {
    const api = client(), live = marketObservation();
    live.availableTurns = [{ nativeTurnId: id(40), selectionDisplay: [] }];
    vi.mocked(api.observe).mockResolvedValue(live);
    const { flow, session } = setup(api); await flushPromises();
    await flow.selectTurn(id(41)); expect(api.observe).toHaveBeenCalledTimes(1);
    let resolve!: (value: typeof live) => void;
    vi.mocked(api.observe).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const read = flow.selectTurn(id(40));
    expect(api.observe).toHaveBeenLastCalledWith(id(20), id(21), id(40), "history");
    expect(flow.approvals.value).toEqual(live.approvals!.requests);
    session.value = id(22); await flushPromises();
    resolve({ ...live, selectionDisplay: [] }); await read;
    expect(flow.selectedTurnId.value).toBe(null);
    expect(flow.toolObservation.value).toEqual(live);
  });
  it("disables new-mode decisions at A while preserving the later execution deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    try {
      const api = client(), observation = marketObservation();
      const approval = observation.approvals!.requests[0]!;
      approval.expiresAtUnixMs = 1_800_000_060_000;
      approval.executionExpiresAtUnixMs = approval.expiresAtUnixMs;
      approval.decisionExpiresAtUnixMs = 1_800_000_023_000;
      vi.mocked(api.observe).mockResolvedValue(observation);
      const { flow } = setup(api); await flushPromises();
      expect(flow.actionable(approval)).toBe(true);
      await vi.advanceTimersByTimeAsync(23000);
      expect(flow.actionable(approval)).toBe(false);
      await flow.decide(approval.approvalId, "approve_once");
      expect(api.decide).not.toHaveBeenCalled();
      expect(approval.expiresAtUnixMs).toBe(1_800_000_060_000);
    } finally { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); }
  });

  it("stops idle polling and refreshes from the existing native stream", async () => {
    vi.useFakeTimers();
    try {
      const api = client(), observation = marketObservation(); observation.approvals!.requests = [];
      vi.mocked(api.observe).mockResolvedValue(observation);
      const { nativeRevision } = setup(api, true); await flushPromises();
      await vi.advanceTimersByTimeAsync(10000);
      expect(api.observe).toHaveBeenCalledTimes(1);
      nativeRevision.value = "native-item-completed"; await flushPromises();
      expect(api.observe).toHaveBeenLastCalledWith(id(20), id(21), undefined, "events");
      await vi.advanceTimersByTimeAsync(10000);
      expect(api.observe).toHaveBeenCalledTimes(2);
      expect(api.decide).not.toHaveBeenCalled();
    } finally { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); }
  });
  it("polls only approvals while running and retains tools when intentionally omitted", async () => {
    vi.useFakeTimers();
    try {
      const api = client(), observation = marketObservation(); observation.approvals!.requests = [];
      vi.mocked(api.observe).mockImplementation(async (_context, _session, _turn, mode) => mode === "none" ? { ...observation, tools: undefined } : observation);
      const { flow, nativeRevision, running } = setup(api, true, true); await flushPromises();
      const original = flow.tools.value;
      await vi.advanceTimersByTimeAsync(3100);
      expect(vi.mocked(api.observe).mock.calls.slice(1).every(call => call[3] === "none")).toBe(true);
      expect(flow.tools.value).toEqual(original);
      observation.tools!.items[0]!.state = "completed";
      nativeRevision.value = "native-completed"; await flushPromises();
      expect(api.observe).toHaveBeenLastCalledWith(id(20), id(21), undefined, "events");
      expect(flow.tools.value[0]?.state).toBe("completed");
      running.value = false; await flushPromises();
      const count = vi.mocked(api.observe).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000); expect(api.observe).toHaveBeenCalledTimes(count);
    } finally { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); }
  });
  it("drains an event invalidation arriving during the first history read", async () => {
    const api = client(); let resolve!: (value: ReturnType<typeof marketObservation>) => void;
    vi.mocked(api.observe).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const latest = marketObservation(); latest.tools!.items[0]!.state = "completed"; latest.approvals!.requests = [];
    vi.mocked(api.observe).mockResolvedValueOnce(latest);
    const { flow, nativeRevision } = setup(api, true);
    nativeRevision.value = "native-completed"; await flushPromises();
    expect(api.observe).toHaveBeenCalledTimes(1);
    resolve(marketObservation()); await flushPromises();
    expect(api.observe).toHaveBeenCalledTimes(2);
    expect(api.observe).toHaveBeenLastCalledWith(id(20), id(21), undefined, "events");
    expect(flow.tools.value[0]?.state).toBe("completed");
  });
  it("reads history once on recovery after a lightweight read succeeds", async () => {
    const api = client(), observation = marketObservation(); observation.approvals!.requests = [];
    vi.mocked(api.observe).mockImplementation(async (_context, _session, _turn, mode) => mode === "none" ? { ...observation, tools: undefined } : observation);
    const { flow } = setup(api, true); await flushPromises();
    vi.mocked(api.observe).mockRejectedValueOnce(new MarketChatError("not_ready"));
    await flow.refresh("none");
    await flow.refresh("none");
    expect(vi.mocked(api.observe).mock.calls.map(call => call[3])).toEqual(["history", "none", "none", "history"]);
    expect(api.decide).not.toHaveBeenCalled();
  });
  it("recovers the initial unavailable read before stopping idle polling", async () => {
    vi.useFakeTimers();
    try {
      const api = client(), observation = marketObservation(); observation.approvals!.requests = [];
      vi.mocked(api.observe).mockRejectedValueOnce(new MarketChatError("not_ready"))
        .mockImplementation(async (_context, _session, _turn, mode) => mode === "none" ? { ...observation, tools: undefined } : observation);
      const { flow } = setup(api, true); await flushPromises();
      expect(flow.connected.value).toBe(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(vi.mocked(api.observe).mock.calls.map(call => call[3])).toEqual(["history", "none", "history"]);
      expect(flow.tools.value).toHaveLength(1); expect(flow.connected.value).toBe(true);
      await vi.advanceTimersByTimeAsync(9000); expect(api.observe).toHaveBeenCalledTimes(3);
    } finally { wrappers.splice(0).forEach(w => w.unmount()); vi.useRealTimers(); }
  });

});
