// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketChatError, type MarketHostNativeClient } from "../api/market-host-native-client";
import { marketObservation, marketTestId as id } from "../test/market-chat-fixture";
import { useMarketChat } from "./useMarketChat";
const wrappers: ReturnType<typeof mount>[] = [];
function setup(client: MarketHostNativeClient) {
  const context = ref<string | null>(id(20)), session = ref<string | null>(id(21));
  let flow!: ReturnType<typeof useMarketChat>;
  wrappers.push(mount(defineComponent({ setup() { flow = useMarketChat(() => context.value, () => session.value, () => false, client); return () => null; } })));
  return { flow, context, session };
}
function client(): MarketHostNativeClient { return { observe: vi.fn(async () => marketObservation()), decide: vi.fn(), submit: vi.fn() }; }
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); });
describe("market approval observation", () => {
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
    expect(api.observe).toHaveBeenLastCalledWith(id(20), id(21), id(40));
    expect(flow.approvals.value).toEqual(live.approvals!.requests);
    session.value = id(22); await flushPromises();
    resolve({ ...live, selectionDisplay: [] }); await read;
    expect(flow.selectedTurnId.value).toBe(null);
    expect(flow.toolObservation.value).toEqual(live);
  });
});
