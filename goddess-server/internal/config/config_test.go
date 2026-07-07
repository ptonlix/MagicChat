package config

import "testing"

func TestLoadFromEnvUsesDefaults(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		if key == "APP_SECRET" {
			return "secret"
		}

		return ""
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.Addr != DefaultAddr {
		t.Fatalf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
	if cfg.AppSecret != "secret" {
		t.Fatalf("AppSecret = %q, want secret", cfg.AppSecret)
	}
}

func TestLoadFromEnvReadsExplicitValues(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		switch key {
		case "ADDR":
			return ":30090"
		case "APP_SECRET":
			return "app-secret"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.Addr != ":30090" {
		t.Fatalf("Addr = %q, want :30090", cfg.Addr)
	}
	if cfg.AppSecret != "app-secret" {
		t.Fatalf("AppSecret = %q, want app-secret", cfg.AppSecret)
	}
}

func TestLoadFromEnvFallsBackToGoddessSecret(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		if key == "GODDESS_APP_SECRET" {
			return "goddess-secret"
		}

		return ""
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppSecret != "goddess-secret" {
		t.Fatalf("AppSecret = %q, want goddess-secret", cfg.AppSecret)
	}
}

func TestLoadFromEnvRejectsMissingSecret(t *testing.T) {
	_, err := LoadFromEnv(func(string) string { return "" })
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want missing secret error")
	}
}
