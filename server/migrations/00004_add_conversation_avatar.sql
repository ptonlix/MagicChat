-- +goose Up
ALTER TABLE conversations
  ADD COLUMN avatar text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE conversations
  DROP COLUMN avatar;
