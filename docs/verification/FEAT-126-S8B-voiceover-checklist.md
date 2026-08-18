# FEAT-126 S8B VoiceOver manual checklist

Use only the fixed test harness and synthetic fixture. Do not enable the production feature flag, connect MiniMax, or enter a real project path, prompt, message, key, or account identifier.

## Setup

1. Start the test-only visual harness documented in `FEAT-126-S8B-ui-verification.md`.
2. Use macOS VoiceOver with Safari-compatible WebView navigation enabled.
3. Run the checklist at 1180×760 in light and dark modes, then at 200% zoom.
4. Record macOS version, VoiceOver version, theme, zoom, and result without copying message/reasoning text into logs.

## New task

- [ ] The region is announced as “易界AI” and has one level-one heading.
- [ ] The sidebar has no expand/collapse control while Chat is active.
- [ ] Project selection has an accessible label and announces the selected safe project name.
- [ ] 输入面板左下角的“权限审批，只读访问，禁止写入” is reachable and does not offer writable approval.
- [ ] The permission dialog announces its title, dialog role, read-only/deny policy, and “知道了” action.
- [ ] Closing the permission dialog restores focus to the permission trigger.
- [ ] The task textarea is announced by its visible intent rather than placeholder alone.
- [ ] Empty, over-limit, unavailable, active-turn, storage, and authorization states disable send and announce stable localized copy.
- [ ] Plain Enter sends; Shift+Enter inserts a newline; IME composition does not send.

## Conversation flow

- [ ] The active session title is the page heading and the safe project name is announced separately.
- [ ] User messages are distinguishable as “用户消息”; no copy/edit actions are announced.
- [ ] Assistant messages are distinguishable as “模型回答”; no copy/like/dislike/fork actions are announced.
- [ ] “模型推理记录” announces expanded/collapsed state and complete/incomplete/unavailable status.
- [ ] Expanding historical reasoning announces loading before literal raw text.
- [ ] Streaming reasoning remains expanded and newly appended text does not steal focus.
- [ ] Interrupted/failed turns and cleanup pending/incomplete/completed use status or alert semantics without fabricated success.
- [ ] “滚动到对话底部” appears only when away from the bottom and is reachable by keyboard.
- [ ] Reduced-motion mode causes no smooth bottom-scroll or caret/loader animation.

## App Shell actions

- [ ] Project rows expose only expand, pin/unpin, and remove.
- [ ] Session rows expose only select, rename, pin/unpin, and permanent delete.
- [ ] Menus are keyboard reachable and Escape returns focus to the exact trigger.
- [ ] Rename is announced as a dialog, enforces 1–40 Unicode characters, and restores focus on close.
- [ ] Permanent delete is announced as an alert dialog and clearly states that the operation cannot be undone.
- [ ] Canceling delete restores focus to the exact session menu trigger.
- [ ] Cleanup completion uses the closed navigation disposition; focus lands in the destination page rather than a removed row.
- [ ] Loading more sessions and older history preserves the current reading position.

## Recovery and lifecycle

- [ ] Deep-link not-found, denied, stale, and invalid-project states announce stable recovery copy.
- [ ] Host unavailable, Runtime unavailable, version mismatch, read-only, full, corrupt, and migration-failed projections are distinguishable.
- [ ] Logout and tenant/revision changes clear the old conversation; late events are not announced in the new scope.
- [ ] Restart/resync announces progress once and does not duplicate assistant or reasoning text.
- [ ] At 200% zoom, project/session actions, permission, textarea, send/interrupt, reasoning disclosure, and delete confirmation remain reachable by scrolling.

## Result record

- Tester:
- Date:
- macOS / VoiceOver:
- Light 1180×760:
- Dark 1180×760:
- 200% zoom:
- Blocking findings:
- Non-blocking findings:
- Owner disposition:
