import type { NativeConversationView, NativeConversationViewEvent } from "../api/generated/native-conversation-private.gen";

type ItemTarget = { sessionId: string; turnId: string; itemId: string };

/** A live reading overlay. The canonical view and all history reads stay separate. */
export function createLiveAnswerPresentation() {
  let sessionId = "";
  let turnId = "";
  let overlay: NativeConversationView | undefined;
  const seen = new Set<string>();
  const arrivals = new Set<string>();
  function clear() {
    sessionId = ""; turnId = ""; overlay = undefined;
    seen.clear(); arrivals.clear();
  }
  function observe(event: NativeConversationViewEvent, previous?: NativeConversationView) {
    const view = event.view;
    const live = view.source === "native_observed" && view.statusSource === "runtime_notification" &&
      view.status === "inProgress" && !view.terminalObserved;
    if (!live && (sessionId !== view.sessionId || turnId !== view.turnId)) return;
    if (sessionId !== view.sessionId || turnId !== view.turnId) {
      clear();
      sessionId = view.sessionId;
      turnId = view.turnId;
      // A subscription attaching halfway through a turn must not replay earlier answers.
      for (const entry of previous?.items ?? []) {
        if (entry.lastMethod === "item/completed") seen.add(entry.item.id);
      }
    }
    const previews = live ? event.previews ?? [] : [];
    const known = new Map(view.items.map((entry, index) => [entry.item.id, index]));
    const items = [...view.items];
    for (const preview of previews) {
      if (!preview.text) continue;
      const index = known.get(preview.itemId);
      if (index === undefined) {
        if (items.length >= 512) continue;
        known.set(preview.itemId, items.length);
        items.push({item: {type: "agentMessage", id: preview.itemId, text: preview.text, availability: "available"},
          ordinal: items.length, lastMethod: "item/started"});
      } else {
        const entry = items[index]!;
        const body = entry.item.text ?? "";
        if (entry.item.type === "agentMessage" && entry.lastMethod === "item/started" &&
            preview.text.length > body.length && preview.text.startsWith(body)) {
          items[index] = {...entry, item: {...entry.item, text: preview.text,
            // The empty formal start alone cannot trigger automatic process folding.
            phase: body.trim() ? entry.item.phase : undefined}};
        }
      }
    }
    overlay = previews.length ? {...view, items} : undefined;
    const previousIds = new Set(previous?.items.map(entry => entry.item.id));
    for (const entry of items) {
      if (entry.item.type !== "agentMessage" || seen.has(entry.item.id)) continue;
      if (entry.lastMethod === "item/started" || (previous?.status === "inProgress" && !previousIds.has(entry.item.id))) {
        arrivals.add(entry.item.id);
      }
      seen.add(entry.item.id);
    }
  }
  return {
    clear, observe,
    view(canonical: NativeConversationView): NativeConversationView {
      return overlay && overlay.sessionId === canonical.sessionId && overlay.turnId === canonical.turnId &&
        overlay.revision === canonical.revision ? overlay : canonical;
    },
    take(target: ItemTarget): boolean {
      return target.sessionId === sessionId && target.turnId === turnId && arrivals.delete(target.itemId);
    },
  };
}
