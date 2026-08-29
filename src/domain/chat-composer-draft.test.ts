import { describe, expect, it } from "vitest";
import {
  CHAT_COMPOSER_NEW_DRAFT_KEY,
  chatComposerDraftKey,
  chatComposerDraftValue,
  clearChatComposerDraft,
  createChatComposerDrafts,
  updateChatComposerDraft,
} from "./chat-composer-draft";

describe("FEAT-135 composer draft authority", () => {
  it("derives stable new and session target keys", () => {
    expect(chatComposerDraftKey(null)).toBe(CHAT_COMPOSER_NEW_DRAFT_KEY);
    expect(chatComposerDraftKey("019c1a00-0000-7000-8000-000000000001"))
      .toBe("session:019c1a00-0000-7000-8000-000000000001");
  });

  it("isolates raw text by target without mutating an earlier snapshot", () => {
    const empty = createChatComposerDrafts();
    const withNew = updateChatComposerDraft(empty, CHAT_COMPOSER_NEW_DRAFT_KEY, "  新任务  ");
    const sessionKey = chatComposerDraftKey("019c1a00-0000-7000-8000-000000000001");
    const withSession = updateChatComposerDraft(withNew, sessionKey, "会话草稿");

    expect(chatComposerDraftValue(empty, CHAT_COMPOSER_NEW_DRAFT_KEY)).toBe("");
    expect(chatComposerDraftValue(withSession, CHAT_COMPOSER_NEW_DRAFT_KEY)).toBe("  新任务  ");
    expect(chatComposerDraftValue(withSession, sessionKey)).toBe("会话草稿");
    expect(Object.isFrozen(withSession)).toBe(true);
  });

  it("clears only the accepted target", () => {
    const sessionA = chatComposerDraftKey("019c1a00-0000-7000-8000-000000000001");
    const sessionB = chatComposerDraftKey("019c1a00-0000-7000-8000-000000000002");
    const drafts = updateChatComposerDraft(
      updateChatComposerDraft(createChatComposerDrafts(), sessionA, "A 草稿"),
      sessionB,
      "B 草稿",
    );

    const cleared = clearChatComposerDraft(drafts, sessionA);

    expect(chatComposerDraftValue(cleared, sessionA)).toBe("");
    expect(chatComposerDraftValue(cleared, sessionB)).toBe("B 草稿");
    expect(chatComposerDraftValue(drafts, sessionA)).toBe("A 草稿");
  });
});
