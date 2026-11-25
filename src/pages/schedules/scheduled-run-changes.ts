type Listener = (contextId: string, plans: ReadonlySet<string>) => void;
const listeners = new Set<Listener>();

export function onScheduledRunChanges(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishScheduledRunChanges(contextId: string, plans: ReadonlySet<string>) {
  if (plans.size) for (const listener of listeners) listener(contextId, plans);
}
