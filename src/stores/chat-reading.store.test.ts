import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import type { ChatSession } from "../domain/chat-ipc";
import { CHAT_READING_STORAGE_KEY } from "../domain/chat-reading-preference";
import { useChatReadingStore } from "./chat-reading.store";

const SESSION: ChatSession = {
  sessionId: "019c1a00-0000-7000-8000-000000000001", projectId: null,
  title: "普通阅读样例", titleSource: "user", pinnedAt: null,
  lastActivityAt: 100, latestTurnStatus: "completed", projectAvailable: true,
};
const TURN = "019c1a00-0000-7000-8000-000000000002";
const NEXT_TURN = "019c1a00-0000-7000-8000-000000000003";

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const store = useChatReadingStore(createPinia());
  store.hydrate(storage);
  return { store, values, storage };
}

describe("local conversation reading receipts", () => {
  it("dismisses on a sidebar visit and keeps that receipt across reopening without saving conversation content", () => {
    const { store, values, storage } = setup();
    expect(store.hasUnreadCompletion(SESSION)).toBe(true);
    store.requestLatest(SESSION);
    expect(store.hasUnreadCompletion(SESSION)).toBe(false);
    store.finishLatest(store.latestRequest!.id, SESSION, TURN, true);
    const reopened = useChatReadingStore(createPinia());
    reopened.hydrate(storage);
    expect(reopened.hasUnreadCompletion(SESSION)).toBe(false);
    expect(JSON.parse(values.get(CHAT_READING_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, entries: [
      { sessionId: SESSION.sessionId, activityAt: 100, turnId: TURN },
    ] });
  });

  it("rearms for a new run even when activity timestamps have not advanced", () => {
    const { store } = setup();
    store.requestLatest(SESSION);
    store.finishLatest(store.latestRequest!.id, SESSION, TURN, true);
    store.observeSessions([{ ...SESSION, latestTurnStatus: "queued" }]);
    expect(store.hasUnreadCompletion({ ...SESSION, latestTurnStatus: "streaming" })).toBe(false);
    expect(store.hasUnreadCompletion(SESSION)).toBe(true);
  });

  it("does not turn a read refresh of the same turn into a new completion but detects a different turn", () => {
    const { store } = setup();
    store.requestLatest(SESSION);
    store.finishLatest(store.latestRequest!.id, SESSION, TURN, true);
    const refreshed = { ...SESSION, lastActivityAt: 200 };
    store.observeLatestTurn(refreshed, TURN, true);
    expect(store.hasUnreadCompletion(refreshed)).toBe(false);
    store.observeLatestTurn(refreshed, NEXT_TURN, true);
    expect(store.hasUnreadCompletion(refreshed)).toBe(true);
  });

  it("does not acknowledge a future completion when the clicked task is still running", () => {
    const { store } = setup();
    store.requestLatest({ ...SESSION, latestTurnStatus: "streaming" });
    store.finishLatest(store.latestRequest!.id, SESSION, TURN, true);
    expect(store.hasUnreadCompletion(SESSION)).toBe(true);
    store.requestLatest(SESSION);
    store.observeSessions([{ ...SESSION, latestTurnStatus: "queued" }]);
    store.finishLatest(store.latestRequest!.id, SESSION, NEXT_TURN, true);
    expect(store.hasUnreadCompletion(SESSION)).toBe(true);
  });

  it("keeps other sessions and a newer navigation request independent", () => {
    const { store } = setup();
    store.requestLatest(SESSION);
    const oldRequest = store.latestRequest!.id;
    const other = { ...SESSION, sessionId: "019c1a00-0000-7000-8000-000000000004" };
    store.requestLatest(other);
    store.finishLatest(oldRequest, SESSION, TURN, true);
    expect(store.latestRequest?.sessionId).toBe(other.sessionId);
    store.cancelLatest();
    store.observeSessions([{ ...other, latestTurnStatus: "queued" }]);
    expect(store.hasUnreadCompletion(SESSION)).toBe(false);
    expect(store.hasUnreadCompletion(other)).toBe(true);
  });

  it("preserves unsupported future preferences and still dismisses in memory if storage is unavailable", () => {
    const raw = JSON.stringify({ schemaVersion: 2, entries: [] });
    const save = vi.fn();
    const future = useChatReadingStore(createPinia());
    future.hydrate({ getItem: () => raw, setItem: save });
    future.requestLatest(SESSION);
    expect(save).not.toHaveBeenCalled();
    expect(future.hasUnreadCompletion(SESSION)).toBe(false);
    const unavailable = useChatReadingStore(createPinia());
    unavailable.hydrate({ getItem: () => null, setItem: () => { throw new Error("ordinary storage unavailable"); } });
    expect(() => unavailable.requestLatest(SESSION)).not.toThrow();
    expect(unavailable.hasUnreadCompletion(SESSION)).toBe(false);
  });
});
