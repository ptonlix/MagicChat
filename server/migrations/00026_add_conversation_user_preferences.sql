-- +goose Up
CREATE TABLE conversation_user_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  notification_muted boolean NOT NULL DEFAULT false,
  hidden_through_seq bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, conversation_id),
  CONSTRAINT conversation_user_preferences_hidden_seq_check
    CHECK (hidden_through_seq IS NULL OR hidden_through_seq >= 0)
);

CREATE INDEX conversation_user_preferences_conversation_id_index
  ON conversation_user_preferences (conversation_id, user_id);

INSERT INTO conversation_user_preferences (
  user_id,
  conversation_id,
  pinned,
  notification_muted,
  hidden_through_seq,
  created_at,
  updated_at
)
SELECT
  user_id,
  conversation_id,
  true,
  false,
  NULL,
  created_at,
  created_at
FROM conversation_pins;

DROP TABLE conversation_pins;

-- +goose Down
CREATE TABLE conversation_pins (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX conversation_pins_conversation_id_index
  ON conversation_pins (conversation_id, user_id);

INSERT INTO conversation_pins (user_id, conversation_id, created_at)
SELECT user_id, conversation_id, created_at
FROM conversation_user_preferences
WHERE pinned = true;

DROP TABLE conversation_user_preferences;
