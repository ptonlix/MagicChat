-- +goose Up
CREATE TABLE IF NOT EXISTS third_party_login_providers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  key text NOT NULL,
  type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["openid","email","profile"]',
  config jsonb NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT third_party_login_providers_type_check CHECK (type IN ('dingtalk', 'wecom', 'feishu', 'github', 'google', 'oidc')),
  CONSTRAINT third_party_login_providers_scopes_array_check CHECK (jsonb_typeof(scopes) = 'array'),
  CONSTRAINT third_party_login_providers_config_object_check CHECK (jsonb_typeof(config) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS third_party_login_providers_key_unique ON third_party_login_providers (key);
CREATE INDEX IF NOT EXISTS third_party_login_providers_enabled_sort_index ON third_party_login_providers (enabled, sort_order, name);
CREATE INDEX IF NOT EXISTS third_party_login_providers_type_index ON third_party_login_providers (type);

CREATE TABLE IF NOT EXISTS third_party_login_states (
  state_hash text PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES third_party_login_providers(id) ON DELETE CASCADE,
  code_verifier text NOT NULL,
  redirect_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ip text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS third_party_login_states_provider_id_index ON third_party_login_states (provider_id);
CREATE INDEX IF NOT EXISTS third_party_login_states_expires_at_index ON third_party_login_states (expires_at);
CREATE INDEX IF NOT EXISTS third_party_login_states_consumed_at_index ON third_party_login_states (consumed_at);

CREATE TABLE IF NOT EXISTS third_party_accounts (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES third_party_login_providers(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT third_party_accounts_provider_external_unique UNIQUE (provider_id, external_user_id),
  CONSTRAINT third_party_accounts_profile_object_check CHECK (jsonb_typeof(profile) = 'object')
);

CREATE INDEX IF NOT EXISTS third_party_accounts_provider_id_index ON third_party_accounts (provider_id);
CREATE INDEX IF NOT EXISTS third_party_accounts_user_id_index ON third_party_accounts (user_id);

-- +goose Down
-- These tables may predate this compatibility migration, so rollback keeps them intact.
SELECT 1;
