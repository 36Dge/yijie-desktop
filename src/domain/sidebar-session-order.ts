import type { ChatSession } from "./chat-ipc";
import type { ChatSidebarHistory } from "./chat-sidebar-history";
import type { SidebarPreferenceStorage } from "./sidebar-preference";

export const PROJECT_SESSION_ORDER_KEY = "yijie.desktop.ui.project-session-order.v1";
export const SECTION_SESSION_ORDER_KEY = "yijie.desktop.ui.section-session-order.v1";
export type SessionOrders = Readonly<Record<string, readonly string[]>>;
export type MovePlacement = "before" | "after";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const orderKeys = { projects: PROJECT_SESSION_ORDER_KEY, sections: SECTION_SESSION_ORDER_KEY } as const;

export function isTaskSection(group: string): group is "pinned" | "other" {
  return group === "pinned" || group === "other";
}

function readOrders(storage: SidebarPreferenceStorage, kind: keyof typeof orderKeys): SessionOrders {
  const raw = storage.getItem(orderKeys[kind]);
  if (raw === null) return {};
  const value = JSON.parse(raw);
  const orders = value?.[kind];
  if (value?.schemaVersion !== 1 || !orders || typeof orders !== "object" || Array.isArray(orders)
    || !Object.entries(orders).every(([group, ids]) => (kind === "projects" ? uuid.test(group) : isTaskSection(group)) && Array.isArray(ids)
      && ids.every(id => typeof id === "string" && uuid.test(id)) && new Set(ids).size === ids.length)) {
    throw new Error("unsupported-sidebar-session-order");
  }
  return orders;
}

export function readSessionOrders(storage: SidebarPreferenceStorage): SessionOrders {
  const orders: Record<string, readonly string[]> = {};
  for (const kind of ["projects", "sections"] as const) {
    try { Object.assign(orders, readOrders(storage, kind)); }
    catch { /* Fall back independently. Writes reread the affected preference before saving. */ }
  }
  return orders;
}

/** Reorder saved members in their default slots. New and paged-in tasks keep their default positions. */
export function applySessionOrder(rows: ChatSession[], saved?: readonly string[]): ChatSession[] {
  if (!saved?.length || rows.length < 2) return rows;
  const byId = new Map(rows.map(row => [row.sessionId, row]));
  const ordered = saved.flatMap(id => byId.get(id) ?? []);
  const known = new Set(ordered.map(row => row.sessionId));
  let index = 0;
  return rows.map(row => known.has(row.sessionId) ? ordered[index++]! : row);
}

export function saveSessionMove(
  storage: SidebarPreferenceStorage, group: string, history: ChatSidebarHistory,
  sourceId: string, targetId: string, placement: MovePlacement,
): SessionOrders {
  const section = isTaskSection(group);
  const rows = group === "pinned" ? history.pinnedSessions : group === "other" ? history.otherSessions
    : history.groups.find(project => project.projectId === group)?.sessions;
  if (!rows || (!section && !uuid.test(group)) || !rows.every(row => uuid.test(row.sessionId))
    || !rows.some(row => row.sessionId === sourceId) || !rows.some(row => row.sessionId === targetId)) {
    throw new Error("invalid-sidebar-session-move");
  }
  const kind = section ? "sections" : "projects";
  const orders = readOrders(storage, kind);
  if (sourceId === targetId) return orders;
  const saved = orders[group] ?? [];
  const known = new Set(saved);
  // Place newly visible rows around their neighbours. Keep saved positions for rows absent from this page or group.
  const before = new Map<string, string[]>();
  let additions: string[] = [];
  for (const { sessionId } of rows) {
    if (!known.has(sessionId)) additions.push(sessionId);
    else if (additions.length) {
      before.set(sessionId, additions);
      additions = [];
    }
  }
  const merged = saved.flatMap(id => [...(before.get(id) ?? []), id]).concat(additions);
  const next = merged.filter(id => id !== sourceId);
  next.splice(next.indexOf(targetId) + (placement === "after" ? 1 : 0), 0, sourceId);
  const updated = { ...orders, [group]: next };
  storage.setItem(orderKeys[kind], JSON.stringify({ schemaVersion: 1, [kind]: updated }));
  return updated;
}
