export const CHAT_COMPOSER_NEW_DRAFT_KEY = "new" as const;

export type ChatComposerDraftKey =
  | typeof CHAT_COMPOSER_NEW_DRAFT_KEY
  | `session:${string}`;

export type ChatComposerDrafts = Readonly<Record<ChatComposerDraftKey, string>>;

export function chatComposerDraftKey(sessionId: string | null): ChatComposerDraftKey {
  return sessionId === null ? CHAT_COMPOSER_NEW_DRAFT_KEY : `session:${sessionId}`;
}

export function createChatComposerDrafts(): ChatComposerDrafts {
  return Object.freeze({}) as ChatComposerDrafts;
}

export function chatComposerDraftValue(
  drafts: ChatComposerDrafts,
  target: ChatComposerDraftKey,
): string {
  return drafts[target] ?? "";
}

export function updateChatComposerDraft(
  drafts: ChatComposerDrafts,
  target: ChatComposerDraftKey,
  value: string,
): ChatComposerDrafts {
  if (chatComposerDraftValue(drafts, target) === value) return drafts;
  const next: Partial<Record<ChatComposerDraftKey, string>> = { ...drafts };
  if (value.length === 0) delete next[target];
  else next[target] = value;
  return Object.freeze(next) as ChatComposerDrafts;
}

export function clearChatComposerDraft(
  drafts: ChatComposerDrafts,
  target: ChatComposerDraftKey,
): ChatComposerDrafts {
  return updateChatComposerDraft(drafts, target, "");
}
