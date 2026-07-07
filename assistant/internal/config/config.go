package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

const (
	DefaultAppID        = "00000000-0000-0000-0000-000000000001"
	DefaultWebSocketURL = "ws://server:20080/api/app/ws"
)

type Config struct {
	AppID        string
	AppSecret    string
	WebSocketURL string
}

func Load() (Config, error) {
	return LoadFromEnv(os.Getenv)
}

func LoadFromEnv(getenv func(string) string) (Config, error) {
	appID := strings.TrimSpace(getenv("MYGOD_APP_ID"))
	if appID == "" {
		appID = DefaultAppID
	}

	appSecret := strings.TrimSpace(getenv("MYGOD_APP_SECRET"))
	if appSecret == "" {
		appSecret = strings.TrimSpace(getenv("MYGOD_AI_ASSISTANT_SECRET"))
	}
	if appSecret == "" {
		appSecret = strings.TrimSpace(getenv("APP_SECRET"))
	}
	if appSecret == "" {
		return Config{}, fmt.Errorf("MYGOD_APP_SECRET is required")
	}

	webSocketURL := strings.TrimSpace(getenv("MYGOD_WS_URL"))
	if webSocketURL == "" {
		webSocketURL = DefaultWebSocketURL
	}
	if err := validateWebSocketURL(webSocketURL); err != nil {
		return Config{}, err
	}

	return Config{
		AppID:        appID,
		AppSecret:    appSecret,
		WebSocketURL: webSocketURL,
	}, nil
}

func validateWebSocketURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("MYGOD_WS_URL must be a ws or wss URL")
	}
	if parsed.Scheme != "ws" && parsed.Scheme != "wss" {
		return fmt.Errorf("MYGOD_WS_URL must be a ws or wss URL")
	}

	return nil
}
