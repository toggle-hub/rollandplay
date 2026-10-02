package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr          string
	PublicBaseURL     string
	APIBaseURL        string
	DatabaseURL       string
	RedisAddr         string
	RedisPassword     string
	SessionCookieName string
	SessionTTL        time.Duration
	MagicLinkTTL      time.Duration
	SMTPAddr          string
	SMTPFrom          string
	SMTPUsername      string
	SMTPPassword      string
	AssetStorageDir   string
	RoomPasswordSalt  string
	LogLevel          string
	LogFormat         string
}

func Load() (Config, error) {
	_ = loadDotEnv(".env")
	c := Config{
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		PublicBaseURL:     env("PUBLIC_BASE_URL", "http://localhost:5173"),
		APIBaseURL:        env("API_BASE_URL", "http://localhost:8080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://rollandplay:rollandplay@localhost:5432/rollandplay?sslmode=disable"),
		RedisAddr:         env("REDIS_ADDR", "localhost:6379"),
		RedisPassword:     env("REDIS_PASSWORD", ""),
		SessionCookieName: env("SESSION_COOKIE_NAME", "rollandplay_session"),
		SMTPAddr:          env("SMTP_ADDR", "localhost:1025"),
		SMTPFrom:          env("SMTP_FROM", "rollandplay@localhost"),
		SMTPUsername:      env("SMTP_USERNAME", ""),
		SMTPPassword:      env("SMTP_PASSWORD", ""),
		AssetStorageDir:   env("ASSET_STORAGE_DIR", "./var/assets"),
		RoomPasswordSalt:  env("ROOM_PASSWORD_SALT", "dev-only-salt"),
		LogLevel:          env("LOG_LEVEL", "info"),
		LogFormat:         env("LOG_FORMAT", "json"),
	}
	sh, err := strconv.Atoi(env("SESSION_TTL_HOURS", "720"))
	if err != nil {
		return c, fmt.Errorf("SESSION_TTL_HOURS: %w", err)
	}
	ml, err := strconv.Atoi(env("MAGIC_LINK_TTL_MINUTES", "15"))
	if err != nil {
		return c, fmt.Errorf("MAGIC_LINK_TTL_MINUTES: %w", err)
	}
	c.SessionTTL = time.Duration(sh) * time.Hour
	c.MagicLinkTTL = time.Duration(ml) * time.Minute
	if c.RoomPasswordSalt == "" && !(strings.Contains(c.PublicBaseURL, "localhost") || strings.Contains(c.PublicBaseURL, "127.0.0.1")) {
		return c, fmt.Errorf("ROOM_PASSWORD_SALT is required outside localhost")
	}
	return c, nil
}

func env(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
