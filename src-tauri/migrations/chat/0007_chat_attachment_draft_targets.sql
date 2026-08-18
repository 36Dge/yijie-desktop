-- Pre-v7 ready attachments have no route identity and cannot be restored without
-- risking disclosure in the wrong composer. Bound history remains untouched.
DELETE FROM chat_attachments WHERE state = 'ready' AND message_id IS NULL;

ALTER TABLE chat_attachments
  ADD COLUMN draft_target_kind TEXT
  CHECK (draft_target_kind IS NULL OR draft_target_kind IN ('new', 'session'));

ALTER TABLE chat_attachments
  ADD COLUMN draft_session_id TEXT
  REFERENCES chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE chat_attachments
  ADD COLUMN draft_ordinal INTEGER
  CHECK (draft_ordinal IS NULL OR draft_ordinal >= 0);

CREATE INDEX chat_attachments_draft_target_idx
  ON chat_attachments(
    owner_user_id,
    tenant_id,
    draft_target_kind,
    draft_session_id,
    state,
    expires_at,
    draft_ordinal
  );

CREATE UNIQUE INDEX chat_attachments_new_draft_ordinal_uq
  ON chat_attachments(owner_user_id, tenant_id, draft_ordinal)
  WHERE state = 'ready'
    AND message_id IS NULL
    AND draft_target_kind = 'new'
    AND draft_session_id IS NULL;

CREATE UNIQUE INDEX chat_attachments_session_draft_ordinal_uq
  ON chat_attachments(owner_user_id, tenant_id, draft_session_id, draft_ordinal)
  WHERE state = 'ready'
    AND message_id IS NULL
    AND draft_target_kind = 'session'
    AND draft_session_id IS NOT NULL;

CREATE TRIGGER chat_attachments_draft_target_insert_guard
BEFORE INSERT ON chat_attachments
WHEN CASE
  WHEN NEW.state = 'ready'
    AND NEW.message_id IS NULL
    AND NEW.draft_target_kind = 'new'
    AND NEW.draft_session_id IS NULL
    AND NEW.draft_ordinal IS NOT NULL THEN 1
  WHEN NEW.state = 'ready'
    AND NEW.message_id IS NULL
    AND NEW.draft_target_kind = 'session'
    AND NEW.draft_session_id IS NOT NULL
    AND NEW.draft_ordinal IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = NEW.draft_session_id
        AND s.owner_user_id = NEW.owner_user_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN 1
  WHEN NEW.state IN ('bound', 'expired')
    AND NEW.message_id IS NOT NULL
    AND NEW.draft_target_kind IS NULL
    AND NEW.draft_session_id IS NULL
    AND NEW.draft_ordinal IS NULL THEN 1
  ELSE 0
END = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid chat attachment draft target');
END;

CREATE TRIGGER chat_attachments_draft_target_update_guard
BEFORE UPDATE OF state, message_id, owner_user_id, tenant_id,
  draft_target_kind, draft_session_id, draft_ordinal ON chat_attachments
WHEN CASE
  WHEN NEW.state = 'ready'
    AND NEW.message_id IS NULL
    AND NEW.draft_target_kind = 'new'
    AND NEW.draft_session_id IS NULL
    AND NEW.draft_ordinal IS NOT NULL THEN 1
  WHEN NEW.state = 'ready'
    AND NEW.message_id IS NULL
    AND NEW.draft_target_kind = 'session'
    AND NEW.draft_session_id IS NOT NULL
    AND NEW.draft_ordinal IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = NEW.draft_session_id
        AND s.owner_user_id = NEW.owner_user_id
        AND s.tenant_id = NEW.tenant_id
    ) THEN 1
  WHEN NEW.state IN ('bound', 'expired')
    AND NEW.message_id IS NOT NULL
    AND NEW.draft_target_kind IS NULL
    AND NEW.draft_session_id IS NULL
    AND NEW.draft_ordinal IS NULL THEN 1
  ELSE 0
END = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid chat attachment draft target');
END;
