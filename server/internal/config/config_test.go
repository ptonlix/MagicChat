package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadReadsConfigFromCONFIGPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	content := []byte(`
database:
  dsn: "postgres://app:app@localhost:5432/app?sslmode=disable"
admin:
  password: "secret-admin-password"
`)

	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CONFIG", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Addr != ":20080" {
		t.Fatalf("Server.Addr = %q, want :20080", cfg.Server.Addr)
	}
	if cfg.Database.DSN != "postgres://app:app@localhost:5432/app?sslmode=disable" {
		t.Fatalf("Database.DSN = %q", cfg.Database.DSN)
	}
	if cfg.Admin.Password != "secret-admin-password" {
		t.Fatalf("Admin.Password = %q", cfg.Admin.Password)
	}
}

func TestLoadRejectsMissingAdminPassword(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	content := []byte(`
database:
  dsn: "postgres://app:app@localhost:5432/app?sslmode=disable"
admin:
  password: ""
`)

	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CONFIG", path)

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want missing admin password error")
	}
	if !strings.Contains(err.Error(), "admin.password") {
		t.Fatalf("Load() error = %q, want admin.password", err.Error())
	}
}

func TestLoadRejectsMissingDatabaseDSN(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	content := []byte(`
database:
  dsn: ""
admin:
  password: "secret-admin-password"
`)

	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CONFIG", path)

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want missing database dsn error")
	}
	if !strings.Contains(err.Error(), "database.dsn") {
		t.Fatalf("Load() error = %q, want database.dsn", err.Error())
	}
}
