package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Admin    AdminConfig    `yaml:"admin"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
}

type DatabaseConfig struct {
	DSN string `yaml:"dsn"`
}

type AdminConfig struct {
	Password string `yaml:"password"`
}

func Load() (Config, error) {
	path := os.Getenv("CONFIG")
	if strings.TrimSpace(path) == "" {
		path = "config.yaml"
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config file: %w", err)
	}

	cfg := Config{
		Server: ServerConfig{Addr: ":20080"},
	}
	if err := yaml.Unmarshal(content, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config file: %w", err)
	}

	if strings.TrimSpace(cfg.Server.Addr) == "" {
		cfg.Server.Addr = ":20080"
	}
	if strings.TrimSpace(cfg.Database.DSN) == "" {
		return Config{}, fmt.Errorf("database.dsn is required")
	}
	if strings.TrimSpace(cfg.Admin.Password) == "" {
		return Config{}, fmt.Errorf("admin.password is required")
	}

	return cfg, nil
}
