package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	DefaultConfigPath   = "config.yaml"
	DefaultAppID        = "00000000-0000-0000-0000-000000000001"
	DefaultWebSocketURL = "ws://server:20080/api/app/ws"
)

type Config struct {
	AppID        string
	AppSecret    string
	WebSocketURL string
	LLM          LLMConfig
}

type LLMConfig struct {
	BaseURL   string
	APIKey    string
	ModelName string
}

type fileConfig struct {
	App appFileConfig `yaml:"app"`
	LLM llmFileConfig `yaml:"llm"`
}

type appFileConfig struct {
	ID           string `yaml:"id"`
	Secret       string `yaml:"secret"`
	WebSocketURL string `yaml:"websocket_url"`
}

type llmFileConfig struct {
	BaseURL   string `yaml:"base_url"`
	APIKey    string `yaml:"api_key"`
	ModelName string `yaml:"model_name"`
}

func Load() (Config, error) {
	path := strings.TrimSpace(os.Getenv("CONFIG"))
	if path == "" {
		path = DefaultConfigPath
	}

	return LoadFromFile(path, os.Getenv)
}

func LoadFromFile(path string, getenv func(string) string) (Config, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultConfigPath
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config file: %w", err)
	}

	var file fileConfig
	if err := yaml.Unmarshal(content, &file); err != nil {
		return Config{}, fmt.Errorf("parse config file: %w", err)
	}

	return normalizeConfig(Config{
		AppID:        file.App.ID,
		AppSecret:    file.App.Secret,
		WebSocketURL: file.App.WebSocketURL,
		LLM: LLMConfig{
			BaseURL:   file.LLM.BaseURL,
			APIKey:    file.LLM.APIKey,
			ModelName: file.LLM.ModelName,
		},
	}, getenv)
}

func LoadFromEnv(getenv func(string) string) (Config, error) {
	return normalizeConfig(Config{}, getenv)
}

func normalizeConfig(cfg Config, getenv func(string) string) (Config, error) {
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.AppSecret = strings.TrimSpace(cfg.AppSecret)
	cfg.WebSocketURL = strings.TrimSpace(cfg.WebSocketURL)
	cfg.LLM = trimLLMConfig(cfg.LLM)

	if value := strings.TrimSpace(getenv("MYGOD_APP_ID")); value != "" {
		cfg.AppID = value
	}
	if value := firstNonEmpty(getenv, "MYGOD_APP_SECRET", "MYGOD_AI_ASSISTANT_SECRET", "APP_SECRET"); value != "" {
		cfg.AppSecret = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_WS_URL")); value != "" {
		cfg.WebSocketURL = value
	}

	if value := strings.TrimSpace(getenv("MYGOD_LLM_BASE_URL")); value != "" {
		cfg.LLM.BaseURL = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_LLM_API_KEY")); value != "" {
		cfg.LLM.APIKey = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_LLM_MODEL_NAME")); value != "" {
		cfg.LLM.ModelName = value
	}

	if cfg.AppID == "" {
		cfg.AppID = DefaultAppID
	}
	if cfg.AppSecret == "" {
		return Config{}, fmt.Errorf("app.secret is required")
	}
	if cfg.WebSocketURL == "" {
		cfg.WebSocketURL = DefaultWebSocketURL
	}
	if err := validateWebSocketURL(cfg.WebSocketURL, "app.websocket_url"); err != nil {
		return Config{}, err
	}
	if err := validateLLMConfig(cfg.LLM); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func firstNonEmpty(getenv func(string) string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(getenv(name)); value != "" {
			return value
		}
	}

	return ""
}

func trimLLMConfig(cfg LLMConfig) LLMConfig {
	return LLMConfig{
		BaseURL:   strings.TrimSpace(cfg.BaseURL),
		APIKey:    strings.TrimSpace(cfg.APIKey),
		ModelName: strings.TrimSpace(cfg.ModelName),
	}
}

func validateLLMConfig(cfg LLMConfig) error {
	if cfg.BaseURL == "" || cfg.APIKey == "" || cfg.ModelName == "" {
		return fmt.Errorf("llm.base_url, llm.api_key, and llm.model_name are required")
	}
	if err := validateHTTPURL(cfg.BaseURL, "llm.base_url"); err != nil {
		return err
	}

	return nil
}

func validateWebSocketURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be a ws or wss URL", name)
	}
	if parsed.Scheme != "ws" && parsed.Scheme != "wss" {
		return fmt.Errorf("%s must be a ws or wss URL", name)
	}

	return nil
}

func validateHTTPURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be an http or https URL", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must be an http or https URL", name)
	}

	return nil
}
