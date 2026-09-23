-- Unknown legacy creation times remain NULL; never infer from mutable clocks/IDs.
ALTER TABLE chat_scheduled_plans ADD COLUMN created_at INTEGER CHECK(created_at IS NULL OR created_at BETWEEN 0 AND 253402300799);
CREATE INDEX chat_scheduled_plans_created ON chat_scheduled_plans(owner_user_id, tenant_id, created_at, plan_id);
