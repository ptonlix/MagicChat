-- +goose Up
CREATE TABLE conversation_pins (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX conversation_pins_conversation_id_index
  ON conversation_pins (conversation_id, user_id);

-- +goose Down
DROP TABLE conversation_pins;
