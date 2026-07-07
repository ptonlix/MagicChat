package config

import "testing"

func TestLoadFromEnvUsesDefaults(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		if key == "MYGOD_APP_SECRET" {
			return "secret"
		}

		return ""
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppID != DefaultAppID {
		t.Fatalf("AppID = %q, want %q", cfg.AppID, DefaultAppID)
	}
	if cfg.AppSecret != "secret" {
		t.Fatalf("AppSecret = %q, want secret", cfg.AppSecret)
	}
	if cfg.WebSocketURL != DefaultWebSocketURL {
		t.Fatalf("WebSocketURL = %q, want %q", cfg.WebSocketURL, DefaultWebSocketURL)
	}
}

func TestLoadFromEnvReadsExplicitValues(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		switch key {
		case "MYGOD_APP_ID":
			return "app-id"
		case "MYGOD_APP_SECRET":
			return "app-secret"
		case "MYGOD_WS_URL":
			return "wss://mygod.example.com/api/app/ws"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppID != "app-id" {
		t.Fatalf("AppID = %q, want app-id", cfg.AppID)
	}
	if cfg.AppSecret != "app-secret" {
		t.Fatalf("AppSecret = %q, want app-secret", cfg.AppSecret)
	}
	if cfg.WebSocketURL != "wss://mygod.example.com/api/app/ws" {
		t.Fatalf("WebSocketURL = %q, want wss://mygod.example.com/api/app/ws", cfg.WebSocketURL)
	}
}

func TestLoadFromEnvFallsBackToAIAssistantSecret(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		if key == "MYGOD_AI_ASSISTANT_SECRET" {
			return "ai-assistant-secret"
		}

		return ""
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppSecret != "ai-assistant-secret" {
		t.Fatalf("AppSecret = %q, want ai-assistant-secret", cfg.AppSecret)
	}
}

func TestLoadFromEnvRejectsMissingSecret(t *testing.T) {
	_, err := LoadFromEnv(func(string) string { return "" })
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want missing secret error")
	}
}

func TestLoadFromEnvRejectsInvalidWebSocketURL(t *testing.T) {
	_, err := LoadFromEnv(func(key string) string {
		switch key {
		case "MYGOD_APP_SECRET":
			return "app-secret"
		case "MYGOD_WS_URL":
			return "https://mygod.example.com/api/app/ws"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid websocket URL error")
	}
}
