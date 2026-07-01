-- +goose Up
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT ''
);

CREATE INDEX admin_sessions_expires_at_index ON admin_sessions (expires_at);

-- +goose Down
DROP TABLE admin_sessions;
