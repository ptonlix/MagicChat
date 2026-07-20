-- +goose Up
ALTER TABLE conversations
  ADD COLUMN created_by_app_id uuid REFERENCES apps(id) ON DELETE RESTRICT;

CREATE INDEX conversations_created_by_app_id_index
  ON conversations (created_by_app_id);

-- +goose Down
DROP INDEX conversations_created_by_app_id_index;

ALTER TABLE conversations
  DROP COLUMN created_by_app_id;
