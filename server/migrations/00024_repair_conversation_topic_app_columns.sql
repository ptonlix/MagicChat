-- +goose Up
-- Repair databases that ran migration 00022 before app-owned topic columns
-- were added to that migration during development.
ALTER TABLE conversation_topics
  ADD COLUMN IF NOT EXISTS created_by_app_id uuid REFERENCES apps(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS archived_by_app_id uuid REFERENCES apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversation_topics_created_by_app_id_index
  ON conversation_topics (created_by_app_id);

-- +goose Down
-- These columns are part of the canonical 00022 schema. Rolling back this
-- repair must not remove them from databases created from the final 00022.
SELECT 1;
