package config

import (
	"fmt"
	"os"
	"strings"
)

const DefaultAddr = ":20090"

type Config struct {
	Addr      string
	AppSecret string
}

func Load() (Config, error) {
	return LoadFromEnv(os.Getenv)
}

func LoadFromEnv(getenv func(string) string) (Config, error) {
	addr := strings.TrimSpace(getenv("ADDR"))
	if addr == "" {
		addr = DefaultAddr
	}

	appSecret := strings.TrimSpace(getenv("APP_SECRET"))
	if appSecret == "" {
		appSecret = strings.TrimSpace(getenv("GODDESS_APP_SECRET"))
	}
	if appSecret == "" {
		return Config{}, fmt.Errorf("APP_SECRET is required")
	}

	return Config{
		Addr:      addr,
		AppSecret: appSecret,
	}, nil
}
