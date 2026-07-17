-- +goose Up
ALTER TABLE app_settings
  ADD COLUMN email_code_login_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN smtp_host text NOT NULL DEFAULT '',
  ADD COLUMN smtp_port integer NOT NULL DEFAULT 587,
  ADD COLUMN smtp_security text NOT NULL DEFAULT 'starttls',
  ADD COLUMN smtp_username text NOT NULL DEFAULT '',
  ADD COLUMN smtp_password text NOT NULL DEFAULT '',
  ADD COLUMN smtp_from_email text NOT NULL DEFAULT '',
  ADD COLUMN smtp_from_name text NOT NULL DEFAULT '',
  ADD CONSTRAINT app_settings_smtp_port_check CHECK (smtp_port BETWEEN 1 AND 65535),
  ADD CONSTRAINT app_settings_smtp_security_check CHECK (smtp_security IN ('none', 'starttls', 'tls'));

-- +goose Down
ALTER TABLE app_settings
  DROP CONSTRAINT app_settings_smtp_security_check,
  DROP CONSTRAINT app_settings_smtp_port_check,
  DROP COLUMN smtp_from_name,
  DROP COLUMN smtp_from_email,
  DROP COLUMN smtp_password,
  DROP COLUMN smtp_username,
  DROP COLUMN smtp_security,
  DROP COLUMN smtp_port,
  DROP COLUMN smtp_host,
  DROP COLUMN email_code_login_enabled;
