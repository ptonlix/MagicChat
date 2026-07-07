-- +goose Up
ALTER TABLE conversation_members
  ADD COLUMN last_read_seq bigint NOT NULL DEFAULT 0;

UPDATE conversation_members cm
SET last_read_seq = c.last_message_seq
FROM conversations c
WHERE c.id = cm.conversation_id;

-- +goose Down
ALTER TABLE conversation_members
  DROP COLUMN last_read_seq;
