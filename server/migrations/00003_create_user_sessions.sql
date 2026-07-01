-- +goose Up
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT ''
);

CREATE INDEX user_sessions_user_id_index ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_at_index ON user_sessions (expires_at);

-- +goose Down
DROP TABLE user_sessions;
