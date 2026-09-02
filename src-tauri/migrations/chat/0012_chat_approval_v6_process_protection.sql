-- FEAT-137 v6 process content is a private Desktop safety projection. Older
-- v6 rows may predate the native projection boundary and therefore contain
-- model commentary, reasoning, or plan text inherited from the v4/v5 tables.
-- Only turns explicitly marked as v6 are rewritten; v4/v5 history is unchanged.

UPDATE chat_timeline_items_v4
SET text = '为保护命令、路径与审批上下文，模型过程内容已隐藏。'
WHERE source_schema_version = 5
  AND item_type = 'agentMessage'
  AND (phase IS NULL OR phase = 'commentary')
  AND turn_id IN (
    SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
  );

UPDATE chat_timeline_items_v4
SET text = ''
WHERE source_schema_version = 5
  AND item_type = 'reasoning'
  AND turn_id IN (
    SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
  );

UPDATE chat_timeline_reasoning_parts_v4
SET text = '为保护命令、路径与审批上下文，模型过程内容已隐藏。',
    byte_count = length(CAST('为保护命令、路径与审批上下文，模型过程内容已隐藏。' AS BLOB))
WHERE EXISTS (
  SELECT 1
  FROM chat_timeline_items_v4 item
  JOIN chat_turn_stream_versions_v6 version ON version.turn_id = item.turn_id
  WHERE item.turn_id = chat_timeline_reasoning_parts_v4.turn_id
    AND item.item_id = chat_timeline_reasoning_parts_v4.item_id
    AND item.source_schema_version = 5
    AND item.item_type = 'reasoning'
    AND version.schema_version = 6
);

DELETE FROM chat_timeline_reasoning_parts_v4
WHERE EXISTS (
  SELECT 1
  FROM chat_timeline_items_v4 item
  JOIN chat_turn_stream_versions_v6 version ON version.turn_id = item.turn_id
  WHERE item.turn_id = chat_timeline_reasoning_parts_v4.turn_id
    AND item.item_id = chat_timeline_reasoning_parts_v4.item_id
    AND item.source_schema_version = 5
    AND item.item_type = 'reasoning'
    AND item.reasoning_status = 'unavailable'
    AND version.schema_version = 6
);

DELETE FROM chat_timeline_reasoning_parts_v4
WHERE content_index <> 0
  AND EXISTS (
    SELECT 1
    FROM chat_timeline_items_v4 item
    JOIN chat_turn_stream_versions_v6 version ON version.turn_id = item.turn_id
    WHERE item.turn_id = chat_timeline_reasoning_parts_v4.turn_id
      AND item.item_id = chat_timeline_reasoning_parts_v4.item_id
      AND item.source_schema_version = 5
      AND item.item_type = 'reasoning'
      AND version.schema_version = 6
  );

UPDATE chat_reasoning_parts
SET text = '为保护命令、路径与审批上下文，模型过程内容已隐藏。',
    byte_count = length(CAST('为保护命令、路径与审批上下文，模型过程内容已隐藏。' AS BLOB))
WHERE turn_id IN (
  SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
);

DELETE FROM chat_reasoning_parts
WHERE EXISTS (
  SELECT 1
  FROM chat_reasoning_items item
  JOIN chat_turn_stream_versions_v6 version ON version.turn_id = item.turn_id
  WHERE item.turn_id = chat_reasoning_parts.turn_id
    AND item.item_id = chat_reasoning_parts.item_id
    AND item.status = 'unavailable'
    AND version.schema_version = 6
);

DELETE FROM chat_reasoning_parts
WHERE content_index <> 0
  AND turn_id IN (
    SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
  );

UPDATE chat_reasoning_items
SET total_bytes = CASE
  WHEN status = 'unavailable' THEN 0
  ELSE length(CAST('为保护命令、路径与审批上下文，模型过程内容已隐藏。' AS BLOB))
END
WHERE turn_id IN (
  SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
);

UPDATE chat_turn_plans_v4
SET explanation = CASE
  WHEN explanation IS NULL THEN NULL
  ELSE '为保护命令、路径与审批上下文，模型过程内容已隐藏。'
END
WHERE turn_id IN (
  SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
);

UPDATE chat_turn_plan_steps_v4
SET step = '为保护命令、路径与审批上下文，模型过程内容已隐藏。'
WHERE turn_id IN (
  SELECT turn_id FROM chat_turn_stream_versions_v6 WHERE schema_version = 6
);
